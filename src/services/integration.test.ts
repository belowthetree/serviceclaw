/**
 * Service Integration Tests
 *
 * Comprehensive integration tests for Service full lifecycle:
 * - Full lifecycle: install → enable → trigger → verify → disable → uninstall
 * - All 4 example services (Daily Briefing, Webhook Receiver, Message Processor, Data Dashboard)
 * - Error scenarios (invalid manifest, missing deps, rollback on failure)
 * - Concurrent operations
 * - Service state persistence across restarts
 *
 * Test fixtures: examples/daily-briefing/service.json and others
 * Implementation: src/services/lifecycle.ts
 * Registry: src/services/registry.ts
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { CronService } from "../cron/service.js";
import { clearInternalHooks } from "../hooks/internal-hooks.js";
import type { PluginRegistry } from "../plugins/registry.js";
import {
  Service,
  ServiceInstallError,
  ServiceStateError,
  type ServiceLifecycleDeps,
} from "./lifecycle.js";
import { ServiceRegistry, ServiceAlreadyExistsError, resetServiceRegistry } from "./registry.js";
import type { ServiceManifest, ServiceConfig } from "./schema.js";
import { ServiceSecurityManager } from "./security.js";

// =============================================================================
// Test Fixtures - Real Example Service Manifests
// =============================================================================

const dailyBriefingManifest: ServiceManifest = {
  $schema: "https://openclaw.ai/schemas/service-v1.json",
  id: "daily-briefing",
  name: "Daily Briefing",
  description: "Your personalized morning briefing with weather, calendar, news, and tasks",
  version: "1.0.0",
  author: "OpenClaw",
  category: "productivity",
  trigger: {
    type: "cron",
    schedule: "0 8 * * *",
    timezone: "auto",
  },
  config: {
    weatherLocation: {
      type: "string",
      description: "City or location for weather forecast",
      default: "New York",
      required: true,
    },
    newsSources: {
      type: "array",
      items: { type: "string" },
      description: "News categories or RSS feed URLs to include",
      default: ["tech", "world"],
      required: false,
    },
    calendarIds: {
      type: "array",
      items: { type: "string" },
      description: "Calendar identifiers to fetch events from",
      default: ["primary"],
      required: false,
    },
    taskSources: {
      type: "array",
      items: {
        type: "string",
        enum: ["apple-reminders", "things", "todoist"],
      },
      description: "Task sources to include in briefing",
      default: [],
      required: false,
    },
    delivery: {
      type: "object",
      description: "Where to deliver the briefing",
      required: true,
      properties: {
        channel: {
          type: "string",
          enum: ["slack", "discord", "telegram", "whatsapp", "email"],
          description: "Channel to send the briefing to",
        },
        target: {
          type: "string",
          description: "Channel ID, DM handle, or email address",
        },
      },
    },
    format: {
      type: "string",
      enum: ["concise", "detailed", "bullet-points"],
      default: "bullet-points",
      description: "Briefing format style",
    },
  },
  requires: {
    skills: ["weather"],
    optionalSkills: ["gog", "apple-reminders", "things-mac"],
    tools: ["web_fetch", "message.send"],
    env: [],
    config: [],
  },
  capabilities: {
    privilegedTools: ["message.send"],
    requiresConfirmation: [],
    network: true,
    filesystem: false,
    shell: false,
    browser: false,
  },
  execution: {
    agentId: "service:daily-briefing",
    sessionTarget: "isolated",
    timeout: 60000,
    retryPolicy: {
      maxRetries: 3,
      backoff: "exponential",
      initialDelayMs: 1000,
    },
  },
};

const webhookReceiverManifest: ServiceManifest = {
  $schema: "https://openclaw.ai/schemas/service-v1.json",
  id: "webhook-receiver",
  name: "Webhook Receiver",
  description:
    "Receive and process webhooks from external services like GitHub, Slack, Stripe, Zapier, or custom sources",
  version: "1.0.0",
  author: "OpenClaw",
  category: "integration",
  trigger: {
    type: "webhook",
    path: "/webhooks/receiver/{hookId}",
    methods: ["POST"],
    auth: {
      type: "signature",
      header: "X-Webhook-Signature",
      secret: "${config.secret}",
    },
  },
  config: {
    hookName: {
      type: "string",
      description: "Name for this webhook endpoint (used in notifications and logs)",
      required: true,
      default: "My Webhook",
    },
    hookId: {
      type: "string",
      description: "Unique identifier for this webhook endpoint (auto-generated if empty)",
      required: false,
      pattern: "^[a-z0-9-]+$",
    },
    secret: {
      type: "secret",
      description: "Secret key for HMAC signature validation (leave empty to disable validation)",
      required: false,
    },
    source: {
      type: "string",
      description: "Expected webhook source format (determines payload parsing)",
      enum: ["generic", "github", "slack", "stripe", "zapier"],
      default: "generic",
      required: true,
    },
    notifyOnReceive: {
      type: "boolean",
      description: "Send a notification when webhook is received",
      default: true,
      required: false,
    },
    notificationChannel: {
      type: "string",
      description: "Channel to send notifications (e.g., 'slack', 'discord', or session ID)",
      default: "main",
      required: false,
    },
    storePayloads: {
      type: "boolean",
      description: "Store received webhook payloads for later review",
      default: true,
      required: false,
    },
    rateLimitPerMinute: {
      type: "number",
      description: "Maximum webhook requests per minute (0 = unlimited)",
      default: 60,
      minimum: 0,
      maximum: 1000,
      required: false,
    },
    processingRules: {
      type: "array",
      description: "Rules for processing webhook payloads",
      items: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "Name for this rule",
          },
          condition: {
            type: "string",
            description: "JSONPath condition to match (e.g., '$.event == push')",
          },
          action: {
            type: "string",
            enum: ["notify", "store", "forward", "script"],
            description: "Action to take when condition matches",
          },
          target: {
            type: "string",
            description: "Target for the action (channel, URL, or script name)",
          },
          template: {
            type: "string",
            description: "Message template with {{variable}} substitution",
          },
        },
      },
      default: [
        {
          name: "Default Notification",
          condition: "",
          action: "notify",
          target: "main",
          template: "Webhook received from {{source}} at {{timestamp}}",
        },
      ],
      required: false,
    },
  },
  requires: {
    skills: ["webhook-receiver"],
    optionalSkills: [],
    tools: ["message.send"],
    optionalTools: ["web_fetch", "db.store"],
    env: [],
    config: ["gateway.webhooks.enabled"],
  },
  capabilities: {
    network: true,
    filesystem: false,
    shell: false,
    browser: false,
    privilegedTools: ["message.send"],
    requiresConfirmation: [],
  },
  execution: {
    agentId: "service:webhook-receiver",
    sessionTarget: "isolated",
    timeout: 30000,
    retryPolicy: {
      maxRetries: 3,
      backoff: "exponential",
      initialDelayMs: 1000,
    },
  },
};

const messageProcessorManifest: ServiceManifest = {
  $schema: "https://openclaw.ai/schemas/service-v1.json",
  id: "message-processor",
  name: "Message Processor",
  description: "Watch channels and automatically process messages, attachments, and commands",
  version: "1.0.0",
  author: "OpenClaw",
  category: "automation",
  trigger: {
    type: "message",
    channels: ["slack", "discord", "telegram"],
    filters: {
      keywords: ["!summary", "!transcribe"],
      patterns: ["^!\\w+"],
      hasAttachments: false,
    },
  },
  config: {
    channels: {
      type: "array",
      description: "Channel IDs to monitor for messages",
      required: true,
      items: {
        type: "string",
      },
      default: [],
    },
    filterPatterns: {
      type: "array",
      description: "Regex patterns to match message content for processing",
      required: false,
      items: {
        type: "string",
      },
      default: ["^!\\w+"],
    },
    responseMode: {
      type: "string",
      description: "How to respond to processed messages",
      enum: ["thread", "dm", "channel", "silent"],
      default: "thread",
      required: true,
    },
    commands: {
      type: "object",
      description: "Command configuration",
      required: true,
      properties: {
        enabled: {
          type: "boolean",
          default: true,
        },
        prefix: {
          type: "string",
          default: "!",
        },
      },
      default: {
        enabled: true,
        prefix: "!",
      },
    },
    processAttachments: {
      type: "boolean",
      description: "Whether to process attachments (PDFs, audio files)",
      default: false,
      required: false,
    },
    maxAttachmentSize: {
      type: "string",
      description: "Maximum attachment size to process (e.g., '5MB', '25MB')",
      default: "10MB",
      pattern: "^\\d+(MB|GB|KB)$",
    },
    rateLimitPerMinute: {
      type: "number",
      description: "Maximum number of requests per user per minute",
      default: 10,
      minimum: 1,
      maximum: 100,
    },
  },
  requires: {
    skills: [],
    optionalSkills: ["summarize", "nano-pdf", "openai-whisper"],
    tools: ["message.send"],
    config: [],
  },
  capabilities: {
    privilegedTools: ["message.send"],
    network: true,
    filesystem: true,
    shell: false,
    browser: false,
  },
  execution: {
    sessionTarget: "isolated",
    timeout: 60000,
    retryPolicy: {
      maxRetries: 2,
      backoff: "exponential",
      initialDelayMs: 1000,
    },
  },
};

const dataDashboardManifest: ServiceManifest = {
  $schema: "https://openclaw.ai/schemas/service-v1.json",
  id: "data-dashboard",
  name: "Data Dashboard",
  description:
    "Real-time web dashboard with configurable widgets for weather, tasks, calendar, and system metrics",
  version: "1.0.0",
  author: "OpenClaw",
  category: "monitoring",
  trigger: {
    type: "web",
    path: "/dashboard/data",
    auth: "gateway",
  },
  config: {
    title: {
      type: "string",
      description: "Dashboard title displayed in the header",
      default: "My Dashboard",
      required: true,
    },
    widgets: {
      type: "array",
      description: "Widgets to display on the dashboard",
      items: {
        type: "object",
        properties: {
          type: {
            type: "string",
            enum: ["weather", "tasks", "calendar", "clock", "text", "system"],
            description: "Widget type",
          },
          title: {
            type: "string",
            description: "Widget title",
          },
          config: {
            type: "object",
            description: "Widget-specific configuration",
          },
        },
      },
      default: [
        { type: "clock", title: "Current Time" },
        { type: "weather", title: "Weather" },
        { type: "tasks", title: "Tasks" },
      ],
    },
    refreshInterval: {
      type: "number",
      description: "Auto-refresh interval in seconds",
      default: 60,
      minimum: 10,
      maximum: 3600,
    },
    theme: {
      type: "string",
      enum: ["light", "dark", "auto"],
      default: "auto",
      description: "Dashboard color theme",
    },
    layout: {
      type: "string",
      enum: ["grid", "list"],
      default: "grid",
      description: "Widget layout style",
    },
  },
  requires: {
    skills: [],
    optionalSkills: ["weather", "tasks", "calendar"],
    tools: ["web_fetch"],
    config: [],
  },
  capabilities: {
    privilegedTools: [],
    network: true,
    filesystem: false,
    shell: false,
    browser: false,
  },
  execution: {
    sessionTarget: "main",
    timeout: 30000,
  },
};

// =============================================================================
// Mock Dependencies
// =============================================================================

const mockCronService = (): CronService =>
  ({
    add: vi.fn().mockResolvedValue({ id: "test-cron-job-id" }),
    remove: vi.fn().mockResolvedValue(undefined),
    removeByService: vi.fn().mockResolvedValue({ success: true, count: 1 }),
    list: vi.fn().mockResolvedValue([]),
    listByService: vi.fn().mockResolvedValue([]),
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockReturnValue(undefined),
    status: vi.fn().mockResolvedValue({ status: "running", jobs: 0 }),
    update: vi.fn().mockResolvedValue(undefined),
    run: vi.fn().mockResolvedValue(undefined),
    enqueueRun: vi.fn().mockResolvedValue(undefined),
    getJob: vi.fn().mockReturnValue(undefined),
    wake: vi.fn().mockReturnValue(undefined),
    listPage: vi.fn().mockResolvedValue({ jobs: [], nextCursor: undefined }),
    disableByService: vi.fn().mockResolvedValue({ success: true, count: 1 }),
    enableByService: vi.fn().mockResolvedValue({ success: true, count: 1 }),
  }) as unknown as CronService;

const mockPluginRegistry = (): PluginRegistry =>
  ({
    httpRoutes: [],
    plugins: new Map(),
  }) as unknown as PluginRegistry;

const createMockDeps = (): ServiceLifecycleDeps => ({
  cronService: mockCronService(),
  pluginRegistry: mockPluginRegistry(),
});

// =============================================================================
// Integration Test Suite
// =============================================================================

describe("Service Integration Tests", () => {
  let tempDir: string;
  let registry: ServiceRegistry;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "service-integration-test-"));
    registry = new ServiceRegistry({
      fs,
      servicesDir: tempDir,
    });
    clearInternalHooks();
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
    resetServiceRegistry();
  });

  // ===========================================================================
  // Daily Briefing Service - Full Lifecycle
  // ===========================================================================

  describe("Daily Briefing Service", () => {
    const validConfig: ServiceConfig = {
      weatherLocation: "San Francisco",
      newsSources: ["tech", "business"],
      calendarIds: ["primary", "work"],
      taskSources: ["todoist"],
      delivery: {
        channel: "slack",
        target: "#daily-briefing",
      },
      format: "bullet-points",
    };

    it("should complete full lifecycle: install → enable → disable → uninstall", async () => {
      const deps = createMockDeps();
      const service = new Service(dailyBriefingManifest, validConfig, deps);

      // Install
      const installResult = await service.install();
      expect(installResult.success).toBe(true);
      expect(service.state).toBe("installed");
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(vi.mocked(deps.cronService).add).toHaveBeenCalledTimes(1);
      expect(service.runtimeRefs.cronJobIds).toHaveLength(1);

      // Enable
      await service.enable();
      expect(service.state).toBe("enabled");
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(vi.mocked(deps.cronService).enableByService).toHaveBeenCalled();

      // Disable
      await service.disable();
      expect(service.state).toBe("disabled");
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(vi.mocked(deps.cronService).disableByService).toHaveBeenCalled();

      // Re-enable
      await service.enable();
      expect(service.state).toBe("enabled");

      // Uninstall
      await service.uninstall();
      expect(service.state).toBe("pending");
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(vi.mocked(deps.cronService).removeByService).toHaveBeenCalled();
      expect(service.runtimeRefs.cronJobIds).toHaveLength(0);
    });

    it("should validate configuration correctly", async () => {
      const deps = createMockDeps();
      const service = new Service(dailyBriefingManifest, validConfig, deps);

      const result = await service.validate();

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should fail validation with missing required fields", async () => {
      const deps = createMockDeps();
      const invalidConfig = {
        weatherLocation: "New York",
        // Missing required 'delivery' field
      };
      const service = new Service(dailyBriefingManifest, invalidConfig, deps);

      const result = await service.validate();

      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Required config field 'delivery' is missing");
    });

    it("should fail validation with invalid enum value", async () => {
      const deps = createMockDeps();
      const invalidConfig = {
        ...validConfig,
        format: "invalid-format", // Not in enum
      };
      const service = new Service(dailyBriefingManifest, invalidConfig, deps);

      const result = await service.validate();

      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        "Config field 'format' must be one of: concise, detailed, bullet-points",
      );
    });

    it("should create cron job with correct schedule", async () => {
      const deps = createMockDeps();
      const service = new Service(dailyBriefingManifest, validConfig, deps);

      await service.install();

      const cronCall = vi.mocked(deps.cronService).add.mock.calls[0][0];
      expect(cronCall.schedule).toEqual({
        kind: "cron",
        expr: "0 8 * * *",
        tz: undefined, // auto timezone
      });
      expect(cronCall.agentId).toBe("service:daily-briefing");
      expect(cronCall.sessionTarget).toBe("isolated");
    });

    it("should track execution statistics", async () => {
      const deps = createMockDeps();
      const service = new Service(dailyBriefingManifest, validConfig, deps);

      await service.install();
      await service.enable();

      // Record successful execution
      service.recordSuccess();
      expect(service.executionStats.successfulRuns).toBe(1);
      expect(service.executionStats.totalRuns).toBe(1); // totalRuns incremented by recordSuccess

      // Record failed execution (doesn't increment totalRuns, only failedRuns)
      service.recordFailure(new Error("Test error"));
      expect(service.executionStats.failedRuns).toBe(1);
      expect(service.executionStats.lastError).toBeDefined();
      expect(service.state).toBe("error");
    });
  });

  // ===========================================================================
  // Webhook Receiver Service - Full Lifecycle
  // ===========================================================================

  describe("Webhook Receiver Service", () => {
    const validConfig: ServiceConfig = {
      hookName: "GitHub Webhook",
      hookId: "github-events",
      secret: "my-webhook-secret",
      source: "github",
      notifyOnReceive: true,
      notificationChannel: "main",
      storePayloads: true,
      rateLimitPerMinute: 60,
      processingRules: [
        {
          name: "Push Event",
          condition: "$.event == push",
          action: "notify",
          target: "main",
          template: "Push to {{repository}} by {{pusher}}",
        },
      ],
    };

    it("should complete full lifecycle: install → enable → trigger simulation → uninstall", async () => {
      const deps = createMockDeps();
      const service = new Service(webhookReceiverManifest, validConfig, deps);

      // Install
      const installResult = await service.install();
      expect(installResult.success).toBe(true);
      expect(service.state).toBe("installed");
      expect(service.runtimeRefs.webhookPaths).toContain("/webhooks/receiver/{hookId}");
      expect(service.runtimeRefs.webhookUnregisterFns).toHaveLength(1);

      // Enable
      await service.enable();
      expect(service.state).toBe("enabled");

      // Disable
      await service.disable();
      expect(service.state).toBe("disabled");

      // Uninstall
      await service.uninstall();
      expect(service.state).toBe("pending");
      expect(service.runtimeRefs.webhookPaths).toHaveLength(0);
      expect(service.runtimeRefs.webhookUnregisterFns).toHaveLength(0);
    });

    it("should register webhook with correct path pattern", async () => {
      const deps = createMockDeps();
      const service = new Service(webhookReceiverManifest, validConfig, deps);

      await service.install();

      expect(service.runtimeRefs.webhookPaths).toHaveLength(1);
      expect(service.runtimeRefs.webhookPaths[0]).toBe("/webhooks/receiver/{hookId}");
    });

    it("should provide callable unregister function", async () => {
      const deps = createMockDeps();
      const service = new Service(webhookReceiverManifest, validConfig, deps);

      await service.install();

      const unregisterFn = service.runtimeRefs.webhookUnregisterFns[0];
      expect(typeof unregisterFn).toBe("function");

      // Should not throw when called
      expect(() => unregisterFn()).not.toThrow();
    });

    it("should validate webhook configuration", async () => {
      const deps = createMockDeps();
      const service = new Service(webhookReceiverManifest, validConfig, deps);

      const result = await service.validate();

      expect(result.valid).toBe(true);
    });
  });

  // ===========================================================================
  // Message Processor Service - Full Lifecycle
  // ===========================================================================

  describe("Message Processor Service", () => {
    const validConfig: ServiceConfig = {
      channels: ["#general", "#support"],
      filterPatterns: ["^!\\w+"],
      responseMode: "thread",
      commands: {
        enabled: true,
        prefix: "!",
      },
      processAttachments: true,
      maxAttachmentSize: "10MB",
      rateLimitPerMinute: 10,
    };

    it("should complete full lifecycle: install → enable → message simulation → uninstall", async () => {
      const deps = createMockDeps();
      const service = new Service(messageProcessorManifest, validConfig, deps);

      // Install
      const installResult = await service.install();
      expect(installResult.success).toBe(true);
      expect(service.state).toBe("installed");
      expect(service.runtimeRefs.messageSubscriptions).toHaveLength(3);
      expect(service.runtimeRefs.messageSubscriptions.map((s) => s.channel)).toContain("slack");
      expect(service.runtimeRefs.messageSubscriptions.map((s) => s.channel)).toContain("discord");
      expect(service.runtimeRefs.messageSubscriptions.map((s) => s.channel)).toContain("telegram");

      // Enable
      await service.enable();
      expect(service.state).toBe("enabled");

      // Disable
      await service.disable();
      expect(service.state).toBe("disabled");

      // Uninstall
      await service.uninstall();
      expect(service.state).toBe("pending");
      expect(service.runtimeRefs.messageSubscriptions).toHaveLength(0);
    });

    it("should create message subscriptions for each channel", async () => {
      const deps = createMockDeps();
      const service = new Service(messageProcessorManifest, validConfig, deps);

      await service.install();

      // Should have subscriptions for each channel
      expect(service.runtimeRefs.messageSubscriptions).toHaveLength(3);
      expect(service.runtimeRefs.messageSubscriptions.map((s) => s.channel)).toContain("slack");
      expect(service.runtimeRefs.messageSubscriptions.map((s) => s.channel)).toContain("discord");
      expect(service.runtimeRefs.messageSubscriptions.map((s) => s.channel)).toContain("telegram");
    });

    it("should validate message trigger configuration", async () => {
      const deps = createMockDeps();
      const service = new Service(messageProcessorManifest, validConfig, deps);

      const result = await service.validate();

      expect(result.valid).toBe(true);
    });

    it("should require at least one channel for message trigger", async () => {
      const deps = createMockDeps();
      const invalidManifest = {
        ...messageProcessorManifest,
        trigger: {
          ...messageProcessorManifest.trigger,
          channels: [],
        },
      };
      const service = new Service(invalidManifest, validConfig, deps);

      const result = await service.validate();

      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Message trigger must specify at least one channel");
    });
  });

  // ===========================================================================
  // Data Dashboard Service - Full Lifecycle
  // ===========================================================================

  describe("Data Dashboard Service", () => {
    const validConfig: ServiceConfig = {
      title: "My Analytics Dashboard",
      widgets: [
        { type: "clock", title: "Current Time" },
        { type: "weather", title: "Weather", config: { location: "NYC" } },
        { type: "tasks", title: "My Tasks" },
        { type: "calendar", title: "Upcoming Events" },
      ],
      refreshInterval: 120,
      theme: "dark",
      layout: "grid",
    };

    it("should complete full lifecycle: install → enable → disable → uninstall", async () => {
      const deps = createMockDeps();
      const service = new Service(dataDashboardManifest, validConfig, deps);

      // Install
      const installResult = await service.install();
      expect(installResult.success).toBe(true);
      expect(service.state).toBe("installed");

      // Web UI services don't create cron jobs
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(vi.mocked(deps.cronService).add).not.toHaveBeenCalled();

      // Enable
      await service.enable();
      expect(service.state).toBe("enabled");

      // Disable
      await service.disable();
      expect(service.state).toBe("disabled");

      // Uninstall
      await service.uninstall();
      expect(service.state).toBe("pending");
    });

    it("should validate dashboard configuration", async () => {
      const deps = createMockDeps();
      const service = new Service(dataDashboardManifest, validConfig, deps);

      const result = await service.validate();

      expect(result.valid).toBe(true);
    });

    it("should accept various widget configurations", async () => {
      const deps = createMockDeps();
      const configWithWidgets: ServiceConfig = {
        ...validConfig,
        widgets: [
          { type: "clock", title: "Time" },
          { type: "weather", title: "Weather" },
          { type: "tasks", title: "Tasks" },
          { type: "calendar", title: "Calendar" },
          { type: "text", title: "Notes", config: { content: "Hello" } },
          { type: "system", title: "System Metrics" },
        ],
      };
      const service = new Service(dataDashboardManifest, configWithWidgets, deps);

      const result = await service.validate();

      expect(result.valid).toBe(true);
    });
  });

  // ===========================================================================
  // Error Scenarios
  // ===========================================================================

  describe("Error Scenarios", () => {
    it("should handle invalid manifest - missing required fields", async () => {
      const deps = createMockDeps();
      const invalidManifest = {
        ...dailyBriefingManifest,
        id: "", // Empty ID
      };
      const service = new Service(invalidManifest, {}, deps);

      const result = await service.validate();

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it("should handle invalid manifest - invalid version format", async () => {
      const deps = createMockDeps();
      const invalidManifest = {
        ...dailyBriefingManifest,
        id: "test-invalid-version",
        version: "invalid", // Not semver
      };
      const service = new Service(invalidManifest, {}, deps);

      const result = await service.validate();

      expect(result.valid).toBe(false);
    });

    it("should handle missing required config fields", async () => {
      const deps = createMockDeps();
      const service = new Service(dailyBriefingManifest, {}, deps);

      const result = await service.validate();

      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Required config field 'weatherLocation' is missing");
      expect(result.errors).toContain("Required config field 'delivery' is missing");
    });

    it("should handle wrong config types", async () => {
      const deps = createMockDeps();
      const invalidConfig = {
        weatherLocation: 123, // Should be string
        delivery: { channel: "slack", target: "#test" },
        format: "bullet-points",
      };
      const service = new Service(dailyBriefingManifest, invalidConfig, deps);

      const result = await service.validate();

      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Config field 'weatherLocation' must be a string");
    });

    it("should rollback on installation failure", async () => {
      const deps = createMockDeps();
      vi.mocked(deps.cronService).add.mockRejectedValue(new Error("Cron service unavailable"));

      const service = new Service(
        dailyBriefingManifest,
        {
          weatherLocation: "NYC",
          delivery: { channel: "slack", target: "#test" },
          format: "bullet-points",
        },
        deps,
      );

      try {
        await service.install();
        expect.fail("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(ServiceInstallError);
        expect(service.state).toBe("install_error");
        expect(service.runtimeRefs.cronJobIds).toHaveLength(0);
      }
    });

    it("should reject invalid state transitions", async () => {
      const deps = createMockDeps();
      const service = new Service(
        dailyBriefingManifest,
        {
          weatherLocation: "NYC",
          delivery: { channel: "slack", target: "#test" },
          format: "bullet-points",
        },
        deps,
      );

      // Cannot enable from pending (throws ServiceStateError)
      await expect(service.enable()).rejects.toThrow(ServiceStateError);

      // Install the service first
      await service.install();
      expect(service.state).toBe("installed");

      // Now enable should work
      await service.enable();
      expect(service.state).toBe("enabled");

      // Cannot enable from enabled (already enabled)
      await expect(service.enable()).rejects.toThrow(ServiceStateError);
    });

    it("should handle cron service errors gracefully", async () => {
      const deps = createMockDeps();
      vi.mocked(deps.cronService).add.mockRejectedValue(new Error("Service unavailable"));

      const service = new Service(
        dailyBriefingManifest,
        {
          weatherLocation: "NYC",
          delivery: { channel: "slack", target: "#test" },
          format: "bullet-points",
        },
        deps,
      );

      await expect(service.install()).rejects.toThrow(ServiceInstallError);
    });
  });

  // ===========================================================================
  // Concurrent Operations Tests
  // ===========================================================================

  describe("Concurrent Operations", () => {
    const validConfig: ServiceConfig = {
      weatherLocation: "NYC",
      delivery: { channel: "slack", target: "#test" },
      format: "bullet-points",
    };

    it("should handle concurrent service installations", async () => {
      const deps = createMockDeps();
      const services = [
        new Service(dailyBriefingManifest, validConfig, deps),
        new Service(
          webhookReceiverManifest,
          {
            hookName: "Test",
            source: "generic",
          },
          deps,
        ),
        new Service(
          messageProcessorManifest,
          {
            channels: ["#test"],
            responseMode: "thread",
            commands: { enabled: true, prefix: "!" },
          },
          deps,
        ),
      ];

      const results = await Promise.all(
        services.map((s) =>
          s
            .install()
            .then(() => ({ success: true, id: s.id }))
            .catch((e) => ({ success: false, error: e.message })),
        ),
      );

      expect(results.every((r) => r.success)).toBe(true);
      expect(services.every((s) => s.state === "installed")).toBe(true);
    });

    it("should handle concurrent enable/disable operations on different services", async () => {
      const deps = createMockDeps();
      const service1 = new Service(dailyBriefingManifest, validConfig, deps);
      const service2 = new Service(
        webhookReceiverManifest,
        {
          hookName: "Test",
          source: "generic",
        },
        deps,
      );

      await service1.install();
      await service2.install();

      // Concurrent enable
      await Promise.all([service1.enable(), service2.enable()]);

      expect(service1.state).toBe("enabled");
      expect(service2.state).toBe("enabled");

      // Concurrent disable
      await Promise.all([service1.disable(), service2.disable()]);

      expect(service1.state).toBe("disabled");
      expect(service2.state).toBe("disabled");
    });

    it("should handle sequential registry operations", async () => {
      const timestamp = Date.now();
      const manifests = [
        { ...dailyBriefingManifest, id: `daily-briefing-${timestamp}` },
        { ...webhookReceiverManifest, id: `webhook-receiver-${timestamp}` },
        { ...messageProcessorManifest, id: `message-processor-${timestamp}` },
        { ...dataDashboardManifest, id: `data-dashboard-${timestamp}` },
      ];

      for (const m of manifests) {
        await registry.register(m);
      }

      const allServices = await registry.getAll();
      expect(allServices.length).toBe(4);
    });

    it("should prevent duplicate service registration", async () => {
      await registry.register(dailyBriefingManifest);

      await expect(registry.register(dailyBriefingManifest)).rejects.toThrow(
        ServiceAlreadyExistsError,
      );
    });
  });

  // ===========================================================================
  // Persistence Tests
  // ===========================================================================

  describe("State Persistence Across Restarts", () => {
    it("should persist service state to disk", async () => {
      await registry.register(dailyBriefingManifest, {
        weatherLocation: "NYC",
        delivery: { channel: "slack", target: "#test" },
        format: "bullet-points",
      });

      // Follow valid state transitions: pending -> validating -> installing -> installed -> enabled
      await registry.updateState("daily-briefing", "validating");
      await registry.updateState("daily-briefing", "installing");
      await registry.updateState("daily-briefing", "installed");
      await registry.updateState("daily-briefing", "enabled");

      // Create new registry instance (simulating restart)
      const newRegistry = new ServiceRegistry({
        fs,
        servicesDir: tempDir,
      });

      const service = await newRegistry.get("daily-briefing");

      expect(service).toBeDefined();
      expect(service?.state).toBe("enabled");
      expect(service?.stateHistory).toHaveLength(4);
    });

    it("should persist configuration changes", async () => {
      await registry.register(dailyBriefingManifest);

      const newConfig = {
        weatherLocation: "Los Angeles",
        delivery: { channel: "discord", target: "#general" },
        format: "detailed",
      };

      await registry.updateConfig("daily-briefing", newConfig);

      // Create new registry instance
      const newRegistry = new ServiceRegistry({
        fs,
        servicesDir: tempDir,
      });

      const config = await newRegistry.getConfig("daily-briefing");

      expect(config).toEqual(newConfig);
    });

    it("should persist runtime references", async () => {
      await registry.register(dailyBriefingManifest);

      await registry.updateRuntimeRefs("daily-briefing", {
        cronJobIds: ["job-1", "job-2"],
        webhookPaths: ["/webhook/test"],
      });

      // Create new registry instance
      const newRegistry = new ServiceRegistry({
        fs,
        servicesDir: tempDir,
      });

      const refs = await newRegistry.getRuntimeRefs("daily-briefing");

      expect(refs?.cronJobIds).toEqual(["job-1", "job-2"]);
      expect(refs?.webhookPaths).toEqual(["/webhook/test"]);
    });

    it("should persist execution statistics", async () => {
      await registry.register(dailyBriefingManifest);

      await registry.recordSuccess("daily-briefing");
      await registry.recordSuccess("daily-briefing");
      await registry.recordFailure("daily-briefing", new Error("Test error"));

      // Create new registry instance
      const newRegistry = new ServiceRegistry({
        fs,
        servicesDir: tempDir,
      });

      const service = await newRegistry.get("daily-briefing");

      expect(service?.executionStats.totalRuns).toBe(3);
      expect(service?.executionStats.successfulRuns).toBe(2);
      expect(service?.executionStats.failedRuns).toBe(1);
      expect(service?.executionStats.lastError?.message).toBe("Test error");
    });

    it("should recover registry index after restart", async () => {
      await registry.register(dailyBriefingManifest);
      await registry.register(webhookReceiverManifest);
      await registry.register(messageProcessorManifest);

      // Create new registry and recover
      const newRegistry = new ServiceRegistry({
        fs,
        servicesDir: tempDir,
      });
      await newRegistry.recover();

      const services = await newRegistry.list();

      expect(services).toHaveLength(3);
      expect(services.map((s) => s.id)).toContain("daily-briefing");
      expect(services.map((s) => s.id)).toContain("webhook-receiver");
      expect(services.map((s) => s.id)).toContain("message-processor");
    });

    it("should maintain state history across restarts", async () => {
      await registry.register(dailyBriefingManifest);

      await registry.updateState("daily-briefing", "validating");
      await registry.updateState("daily-briefing", "installing");
      await registry.updateState("daily-briefing", "installed");
      await registry.updateState("daily-briefing", "enabled");

      // Create new registry instance
      const newRegistry = new ServiceRegistry({
        fs,
        servicesDir: tempDir,
      });

      const service = await newRegistry.get("daily-briefing");

      expect(service?.stateHistory).toHaveLength(4);
      expect(service?.stateHistory[0].from).toBe("pending");
      expect(service?.stateHistory[0].to).toBe("validating");
      expect(service?.stateHistory[3].from).toBe("installed");
      expect(service?.stateHistory[3].to).toBe("enabled");
    });
  });

  // ===========================================================================
  // Security Tests
  // ===========================================================================

  describe("Security Validation", () => {
    it("should validate security capabilities for Daily Briefing", async () => {
      const deps = createMockDeps();
      deps.securityManager = new ServiceSecurityManager({});

      const service = new Service(
        dailyBriefingManifest,
        {
          weatherLocation: "NYC",
          delivery: { channel: "slack", target: "#test" },
          format: "bullet-points",
        },
        deps,
      );

      const result = await service.validate();

      expect(result.valid).toBe(true);
      // message.send is a privileged tool and should be declared
      expect(dailyBriefingManifest.capabilities.privilegedTools).toContain("message.send");
    });

    it("should detect missing privileged tool declarations", async () => {
      const deps = createMockDeps();
      deps.securityManager = new ServiceSecurityManager({});

      const insecureManifest = {
        ...dailyBriefingManifest,
        id: "insecure-service",
        capabilities: {
          ...dailyBriefingManifest.capabilities,
          privilegedTools: [], // Missing message.send
        },
      };

      const service = new Service(
        insecureManifest,
        {
          weatherLocation: "NYC",
          delivery: { channel: "slack", target: "#test" },
          format: "bullet-points",
        },
        deps,
      );

      const result = await service.validate();

      // Should have security warning about privileged tool
      expect(result.warnings?.length).toBeGreaterThan(0);
    });
  });

  // ===========================================================================
  // ServiceInstaller Integration
  // ===========================================================================

  describe("ServiceInstaller Integration", () => {
    it("should install service using Service class directly", async () => {
      const deps = createMockDeps();
      const service = new Service(
        dailyBriefingManifest,
        {
          weatherLocation: "NYC",
          delivery: { channel: "slack", target: "#test" },
          format: "bullet-points",
        },
        deps,
      );

      const result = await service.install();

      expect(result.success).toBe(true);
      expect(service.state).toBe("installed");
      expect(service.id).toBe("daily-briefing");
    });
  });

  // ===========================================================================
  // Edge Cases
  // ===========================================================================

  describe("Edge Cases", () => {
    it("should handle empty configuration objects with defaults", async () => {
      const deps = createMockDeps();
      const service = new Service(dataDashboardManifest, { title: "My Dashboard" }, deps);

      const result = await service.validate();

      expect(result.valid).toBe(true);
    });

    it("should handle config with only default values", async () => {
      const deps = createMockDeps();
      const configWithDefaults = {
        weatherLocation: "New York", // Default value
        format: "bullet-points", // Default value
        delivery: { channel: "slack", target: "#general" },
      };

      const service = new Service(dailyBriefingManifest, configWithDefaults, deps);

      const result = await service.validate();

      expect(result.valid).toBe(true);
    });

    it("should handle very long webhook paths", async () => {
      const deps = createMockDeps();
      const longPathManifest = {
        ...webhookReceiverManifest,
        trigger: {
          ...webhookReceiverManifest.trigger,
          path: "/webhooks/very/long/path/that/keeps/going/for/a/while",
        },
      };

      const service = new Service(
        longPathManifest,
        {
          hookName: "Test",
          source: "generic",
        },
        deps,
      );

      const result = await service.validate();

      expect(result.valid).toBe(true);
    });

    it("should handle special characters in config strings", async () => {
      const deps = createMockDeps();
      const configWithSpecialChars = {
        weatherLocation: "São Paulo (SP) @ Brazil!",
        delivery: { channel: "slack", target: "#test-channel" },
        format: "bullet-points",
      };

      const service = new Service(dailyBriefingManifest, configWithSpecialChars, deps);

      const result = await service.validate();

      expect(result.valid).toBe(true);
    });

    it("should handle uninstalling service from installed state", async () => {
      const deps = createMockDeps();
      const service = new Service(
        dailyBriefingManifest,
        {
          weatherLocation: "NYC",
          delivery: { channel: "slack", target: "#test" },
          format: "bullet-points",
        },
        deps,
      );

      await service.install();
      expect(service.state).toBe("installed");

      await service.uninstall();
      expect(service.state).toBe("pending");
    });

    it("should handle updating config multiple times", async () => {
      const deps = createMockDeps();
      const service = new Service(
        dailyBriefingManifest,
        {
          weatherLocation: "NYC",
          delivery: { channel: "slack", target: "#test" },
          format: "bullet-points",
        },
        deps,
      );

      await service.install();

      service.updateConfig({ weatherLocation: "LA" });
      expect(service.config.weatherLocation).toBe("LA");

      service.updateConfig({ weatherLocation: "Chicago" });
      expect(service.config.weatherLocation).toBe("Chicago");

      service.updateConfig({ format: "detailed" });
      expect(service.config.format).toBe("detailed");
    });
  });

  // ===========================================================================
  // Summary Test
  // ===========================================================================

  describe("Complete Integration Summary", () => {
    it("should pass all lifecycle tests for all 4 example services", async () => {
      const services = [
        {
          manifest: dailyBriefingManifest,
          config: {
            weatherLocation: "NYC",
            delivery: { channel: "slack", target: "#test" },
            format: "bullet-points",
          },
          name: "Daily Briefing",
        },
        {
          manifest: webhookReceiverManifest,
          config: {
            hookName: "Test Webhook",
            source: "github",
          },
          name: "Webhook Receiver",
        },
        {
          manifest: messageProcessorManifest,
          config: {
            channels: ["#general"],
            responseMode: "thread",
            commands: { enabled: true, prefix: "!" },
          },
          name: "Message Processor",
        },
        {
          manifest: dataDashboardManifest,
          config: {
            title: "Test Dashboard",
            theme: "dark",
          },
          name: "Data Dashboard",
        },
      ];

      const results = await Promise.all(
        services.map(async ({ manifest, config, name }) => {
          const deps = createMockDeps();
          const service = new Service(manifest, config, deps);

          try {
            // Full lifecycle test
            await service.install();
            if (service.state !== "installed") {
              return { name, success: false, error: "Install failed" };
            }

            await service.enable();
            if ((service as unknown as { state: string }).state !== "enabled") {
              return { name, success: false, error: "Enable failed" };
            }

            await service.disable();
            if ((service as unknown as { state: string }).state !== "disabled") {
              return { name, success: false, error: "Disable failed" };
            }

            await service.uninstall();
            if ((service as unknown as { state: string }).state !== "pending") {
              return { name, success: false, error: "Uninstall failed" };
            }

            return { name, success: true };
          } catch (error) {
            return { name, success: false, error: (error as Error).message };
          }
        }),
      );

      for (const result of results) {
        expect(result.success).toBe(true);
      }
    });
  });
});
