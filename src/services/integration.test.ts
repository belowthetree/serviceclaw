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
import type { IncomingMessage } from "node:http";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { WebSocket } from "ws";
import type { SCPMessage } from "../../packages/service-sdk/src/types.js";
import type { CronService } from "../cron/service.js";
import { clearInternalHooks } from "../hooks/internal-hooks.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import type { PluginRegistry } from "../plugins/registry.js";
import type { ProcessSupervisor } from "../process/supervisor/types.js";
import {
  Service,
  ServiceInstallError,
  ServiceStateError,
  ServiceLifecycleManager,
  ServiceLifecycleError,
  type ServiceLifecycleDeps,
} from "./lifecycle.js";
import { ServiceRegistry, ServiceAlreadyExistsError, resetServiceRegistry } from "./registry.js";
import type { ServiceManifest } from "./schema.js";
import { createSCPServer, SCPErrorCodes } from "./scp-server.js";
import { ServiceSecurityManager } from "./security.js";

// Type for service config (not exported from schema.js)
type ServiceConfig = Record<string, unknown>;

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

  // ===========================================================================
  // End-to-End Service Framework Integration Tests
  // ===========================================================================

  describe("End-to-End Service Workflow with SCP Communication", () => {
    // Mock WebSocket class for testing
    class MockWebSocket {
      readyState = 1;
      OPEN = 1;
      CLOSED = 3;
      private listeners: Map<string, Array<(...args: unknown[]) => void>> = new Map();
      sentMessages: string[] = [];
      closed = false;
      closeCode?: number;
      closeReason?: string;

      on(event: string, handler: (...args: unknown[]) => void): void {
        if (!this.listeners.has(event)) {
          this.listeners.set(event, []);
        }
        this.listeners.get(event)!.push(handler);
      }

      once(event: string, handler: (...args: unknown[]) => void): void {
        const onceHandler = (...args: unknown[]) => {
          handler(...args);
          this.off(event, onceHandler);
        };
        this.on(event, onceHandler);
      }

      off(event: string, handler: (...args: unknown[]) => void): void {
        const handlers = this.listeners.get(event);
        if (handlers) {
          const index = handlers.indexOf(handler);
          if (index > -1) {
            handlers.splice(index, 1);
          }
        }
      }

      emit(event: string, ...args: unknown[]): void {
        const handlers = this.listeners.get(event);
        if (handlers) {
          handlers.forEach((h) => h(...args));
        }
      }

      send(data: string): void {
        this.sentMessages.push(data);
      }

      close(code = 1000, reason = "Normal closure"): void {
        this.closed = true;
        this.closeCode = code;
        this.closeReason = reason;
        this.emit("close", code, Buffer.from(reason));
      }

      terminate(): void {
        this.closed = true;
      }

      simulateMessage(data: string): void {
        this.emit("message", Buffer.from(data));
      }

      simulateError(err: Error): void {
        this.emit("error", err);
      }

      simulateOpen(): void {
        this.emit("open");
      }
    }

    // Mock ProcessSupervisor for testing
    const createMockProcessSupervisor = (
      opts: { shouldFail?: boolean; exitCode?: number | null } = {},
    ) => {
      const runs = new Map<
        string,
        {
          runId: string;
          pid: number;
          wait: () => Promise<{ exitCode: number | null; stderr: string }>;
          cancel: (reason?: string) => void;
        }
      >();

      return {
        spawn: vi.fn().mockImplementation(async (input) => {
          if (opts.shouldFail) {
            throw new Error("Failed to start");
          }

          const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2)}`;
          const pid = 12345 + runs.size;

          // Create a wait function that doesn't resolve immediately (keeps service running)
          let resolveWait: (value: { exitCode: number | null; stderr: string }) => void;
          const waitPromise = new Promise<{ exitCode: number | null; stderr: string }>(
            (resolve) => {
              resolveWait = resolve;
            },
          );

          const run = {
            runId,
            pid,
            wait: () => waitPromise,
            cancel: vi.fn().mockImplementation(() => {
              resolveWait({ exitCode: opts.exitCode ?? 0, stderr: "" });
            }),
          };

          runs.set(runId, run);

          // Simulate stdout/stderr callbacks
          if (input.onStdout) {
            setTimeout(() => input.onStdout!("Service process started"), 10);
          }
          if (input.onStderr) {
            setTimeout(() => input.onStderr!(""), 10);
          }

          return run;
        }),
        cancel: vi.fn(),
        cancelScope: vi.fn(),
        reconcileOrphans: vi.fn().mockResolvedValue(undefined),
        getRecord: vi.fn().mockReturnValue(undefined),
      };
    };

    // Helper to safely stop a service (handles already stopped services)
    const safeStopService = async (
      lifecycleManager: ServiceLifecycleManager,
      serviceId: string,
    ) => {
      const state = lifecycleManager.getServiceState(serviceId);
      if (state?.state === "started" || state?.state === "starting") {
        try {
          await lifecycleManager.stopService(serviceId);
        } catch (err) {
          // Service might already be stopped
        }
      }
    };

    // Helper to create SCP message
    const createSCPMessage = (
      type: string,
      serviceId: string,
      payload: Record<string, unknown>,
    ) => ({
      type,
      serviceId,
      requestId: `req-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      timestamp: new Date().toISOString(),
      payload,
    });

    it("should complete full workflow: start service → SCP connect → service.started → service.action → agent.response → service.stopped → stop service", async () => {
      // Setup mocks
      const mockSupervisor = createMockProcessSupervisor();
      const lifecycleManager = new ServiceLifecycleManager({
        supervisor: mockSupervisor as unknown as ProcessSupervisor,
        servicesDir: tempDir,
        getServices: async () => [
          {
            manifest: { id: "test-service", entry: "index.js" },
            path: tempDir,
          },
        ],
      });

      // Create mock logger for SCP server
      const scpLogger = {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        child: vi.fn().mockReturnThis(),
      } as unknown as ReturnType<typeof createSubsystemLogger>;

      // Track action handler invocations
      const actionResults: Array<{
        serviceId: string;
        action: string;
        params: unknown;
        success: boolean;
      }> = [];

      // Create SCP server with action handler
      const scpServer = createSCPServer({
        logger: scpLogger,
        onServiceStarted: async (serviceId, payload) => {
          expect(serviceId).toBe("test-service");
          expect(payload.name).toBe("Test Service");
          expect(payload.version).toBe("1.0.0");
          expect(payload.actions).toContain("create-task");
        },
        onServiceAction: async (serviceId, action, params) => {
          actionResults.push({ serviceId, action, params, success: true });
          return { taskId: `task-${Date.now()}`, status: "created" };
        },
        onServiceStopped: async (serviceId, payload) => {
          expect(serviceId).toBe("test-service");
          expect(payload.reason).toBe("shutdown");
        },
        onDisconnect: async (serviceId) => {
          expect(serviceId).toBe("test-service");
        },
      });

      // Step 1: Start the service via lifecycle manager
      const startPromise = lifecycleManager.startService("test-service");

      // Wait for service to start
      const instance = await startPromise;
      expect(instance.serviceId).toBe("test-service");
      expect(instance.state).toBe("started");
      expect(instance.pid).toBeDefined();

      // Step 2: Simulate SCP WebSocket connection
      const mockSocket = new MockWebSocket();
      const mockRequest = {
        url: "/__openclaw__/scp?serviceId=test-service",
        socket: { remoteAddress: "127.0.0.1" },
      } as unknown as IncomingMessage;

      scpServer.handleUpgrade(mockRequest, mockSocket as unknown as WebSocket);

      // Verify connection was established
      expect(scpLogger.info).toHaveBeenCalledWith(expect.stringContaining("test-service"));

      // Step 3: Send service.started message
      const startedMessage = createSCPMessage("service.started", "test-service", {
        name: "Test Service",
        version: "1.0.0",
        actions: ["create-task", "send-message"],
      });

      mockSocket.simulateMessage(JSON.stringify(startedMessage));

      // Wait for response
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify agent.response was sent
      const startedResponse = mockSocket.sentMessages.find((msg) => {
        const parsed = JSON.parse(msg);
        return parsed.type === "agent.response" && parsed.requestId === startedMessage.requestId;
      });
      expect(startedResponse).toBeDefined();
      expect(JSON.parse(startedResponse!).payload.success).toBe(true);

      // Step 4: Send service.action (create-task)
      const actionMessage = createSCPMessage("service.action", "test-service", {
        action: "create-task",
        params: { title: "Test Task", description: "Test Description" },
        timeout: 30000,
      });

      mockSocket.simulateMessage(JSON.stringify(actionMessage));

      // Wait for action to be processed
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify action was handled and response sent
      expect(actionResults).toHaveLength(1);
      expect(actionResults[0].serviceId).toBe("test-service");
      expect(actionResults[0].action).toBe("create-task");
      expect(actionResults[0].success).toBe(true);

      const actionResponse = mockSocket.sentMessages.find((msg) => {
        const parsed = JSON.parse(msg);
        return parsed.type === "agent.response" && parsed.requestId === actionMessage.requestId;
      });
      expect(actionResponse).toBeDefined();
      const actionResponseParsed = JSON.parse(actionResponse!);
      expect(actionResponseParsed.payload.success).toBe(true);
      expect(actionResponseParsed.payload.data.taskId).toBeDefined();

      // Step 5: Send service.stopped message
      const stoppedMessage = createSCPMessage("service.stopped", "test-service", {
        reason: "shutdown",
        exitCode: 0,
      });

      mockSocket.simulateMessage(JSON.stringify(stoppedMessage));

      // Wait for response
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify agent.response was sent and socket was closed
      const stoppedResponse = mockSocket.sentMessages.find((msg) => {
        const parsed = JSON.parse(msg);
        return parsed.type === "agent.response" && parsed.requestId === stoppedMessage.requestId;
      });
      expect(stoppedResponse).toBeDefined();
      expect(JSON.parse(stoppedResponse!).payload.success).toBe(true);

      // Step 6: Stop service via lifecycle manager
      await safeStopService(lifecycleManager, "test-service");

      const finalState = lifecycleManager.getServiceState("test-service");
      expect(finalState?.state).toBe("stopped");
      expect(finalState?.stoppedAt).toBeDefined();

      // Cleanup
      await scpServer.close();
    });

    it("should handle service that fails to start", async () => {
      const mockSupervisor = createMockProcessSupervisor({ shouldFail: true });
      const lifecycleManager = new ServiceLifecycleManager({
        supervisor: mockSupervisor as unknown as ProcessSupervisor,
        servicesDir: tempDir,
        getServices: async () => [
          {
            manifest: { id: "failing-service", entry: "index.js" },
            path: tempDir,
          },
        ],
      });

      // Attempt to start service that will fail
      await expect(lifecycleManager.startService("failing-service")).rejects.toThrow(
        ServiceLifecycleError,
      );

      // Verify service is in error state
      const state = lifecycleManager.getServiceState("failing-service");
      expect(state?.state).toBe("error");
      expect(state?.error).toContain("Failed to start");
    });

    it("should handle WebSocket disconnection during operation", async () => {
      const mockSupervisor = createMockProcessSupervisor();
      const lifecycleManager = new ServiceLifecycleManager({
        supervisor: mockSupervisor as unknown as ProcessSupervisor,
        servicesDir: tempDir,
        getServices: async () => [
          {
            manifest: { id: "disconnect-service", entry: "index.js" },
            path: tempDir,
          },
        ],
      });

      const scpLogger = {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        child: vi.fn().mockReturnThis(),
      } as unknown as ReturnType<typeof createSubsystemLogger>;

      let disconnectCalled = false;
      const scpServer = createSCPServer({
        logger: scpLogger,
        onDisconnect: async (serviceId) => {
          expect(serviceId).toBe("disconnect-service");
          disconnectCalled = true;
        },
      });

      // Start service
      await lifecycleManager.startService("disconnect-service");

      // Connect WebSocket
      const mockSocket = new MockWebSocket();
      const mockRequest = {
        url: "/__openclaw__/scp?serviceId=disconnect-service",
        socket: { remoteAddress: "127.0.0.1" },
      } as unknown as IncomingMessage;

      scpServer.handleUpgrade(mockRequest, mockSocket as unknown as WebSocket);

      // Send started message
      const startedMessage = createSCPMessage("service.started", "disconnect-service", {
        name: "Disconnect Test Service",
        version: "1.0.0",
      });
      mockSocket.simulateMessage(JSON.stringify(startedMessage));

      await new Promise((resolve) => setTimeout(resolve, 50));

      // Simulate abrupt disconnection
      mockSocket.simulateError(new Error("Connection lost"));

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(disconnectCalled).toBe(true);

      // Cleanup
      await safeStopService(lifecycleManager, "disconnect-service");
      await scpServer.close();
    });

    it("should handle invalid message format", async () => {
      const mockSupervisor = createMockProcessSupervisor();
      const lifecycleManager = new ServiceLifecycleManager({
        supervisor: mockSupervisor as unknown as ProcessSupervisor,
        servicesDir: tempDir,
        getServices: async () => [
          {
            manifest: { id: "invalid-msg-service", entry: "index.js" },
            path: tempDir,
          },
        ],
      });

      const scpLogger = {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        child: vi.fn().mockReturnThis(),
      } as unknown as ReturnType<typeof createSubsystemLogger>;

      const scpServer = createSCPServer({
        logger: scpLogger,
      });

      // Start service and connect
      await lifecycleManager.startService("invalid-msg-service");

      const mockSocket = new MockWebSocket();
      const mockRequest = {
        url: "/__openclaw__/scp?serviceId=invalid-msg-service",
        socket: { remoteAddress: "127.0.0.1" },
      } as unknown as IncomingMessage;

      scpServer.handleUpgrade(mockRequest, mockSocket as unknown as WebSocket);

      // Test 1: Invalid JSON
      mockSocket.simulateMessage("not valid json{{");
      await new Promise((resolve) => setTimeout(resolve, 50));

      let errorResponse = mockSocket.sentMessages.find((msg) => {
        const parsed = JSON.parse(msg);
        return parsed.type === "agent.response" && parsed.payload.success === false;
      });
      expect(errorResponse).toBeDefined();
      expect(JSON.parse(errorResponse!).payload.error.code).toBe(SCPErrorCodes.INVALID_MESSAGE);

      // Clear sent messages
      mockSocket.sentMessages = [];

      // Test 2: Missing required fields
      mockSocket.simulateMessage(JSON.stringify({ type: "service.started" })); // Missing serviceId, requestId, timestamp
      await new Promise((resolve) => setTimeout(resolve, 50));

      errorResponse = mockSocket.sentMessages.find((msg) => {
        const parsed = JSON.parse(msg);
        return parsed.type === "agent.response" && parsed.payload.success === false;
      });
      expect(errorResponse).toBeDefined();
      expect(JSON.parse(errorResponse!).payload.error.code).toBe(
        SCPErrorCodes.MISSING_REQUIRED_FIELD,
      );

      // Clear sent messages
      mockSocket.sentMessages = [];

      // Test 3: Service ID mismatch
      mockSocket.simulateMessage(
        JSON.stringify({
          type: "service.started",
          serviceId: "wrong-service-id",
          requestId: "req-123",
          timestamp: new Date().toISOString(),
          payload: { name: "Test", version: "1.0.0" },
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 50));

      errorResponse = mockSocket.sentMessages.find((msg) => {
        const parsed = JSON.parse(msg);
        return parsed.type === "agent.response" && parsed.payload.success === false;
      });
      expect(errorResponse).toBeDefined();
      expect(JSON.parse(errorResponse!).payload.error.code).toBe(SCPErrorCodes.SERVICE_ID_MISMATCH);

      // Cleanup
      await safeStopService(lifecycleManager, "invalid-msg-service");
      await scpServer.close();
    });

    it("should handle action handler not found", async () => {
      const mockSupervisor = createMockProcessSupervisor();
      const lifecycleManager = new ServiceLifecycleManager({
        supervisor: mockSupervisor as unknown as ProcessSupervisor,
        servicesDir: tempDir,
        getServices: async () => [
          {
            manifest: { id: "no-action-service", entry: "index.js" },
            path: tempDir,
          },
        ],
      });

      const scpLogger = {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        child: vi.fn().mockReturnThis(),
      } as unknown as ReturnType<typeof createSubsystemLogger>;

      // Create SCP server WITHOUT action handler
      const scpServer = createSCPServer({
        logger: scpLogger,
      });

      // Start service and connect
      await lifecycleManager.startService("no-action-service");

      const mockSocket = new MockWebSocket();
      const mockRequest = {
        url: "/__openclaw__/scp?serviceId=no-action-service",
        socket: { remoteAddress: "127.0.0.1" },
      } as unknown as IncomingMessage;

      scpServer.handleUpgrade(mockRequest, mockSocket as unknown as WebSocket);

      // Send started message first
      const startedMessage = createSCPMessage("service.started", "no-action-service", {
        name: "No Action Service",
        version: "1.0.0",
      });
      mockSocket.simulateMessage(JSON.stringify(startedMessage));
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Clear sent messages
      mockSocket.sentMessages = [];

      // Send action request for non-existent handler
      const actionMessage = createSCPMessage("service.action", "no-action-service", {
        action: "unknown-action",
        params: {},
      });
      mockSocket.simulateMessage(JSON.stringify(actionMessage));
      await new Promise((resolve) => setTimeout(resolve, 50));

      const errorResponse = mockSocket.sentMessages.find((msg) => {
        const parsed = JSON.parse(msg);
        return parsed.type === "agent.response" && parsed.requestId === actionMessage.requestId;
      });
      expect(errorResponse).toBeDefined();
      const parsed = JSON.parse(errorResponse!);
      expect(parsed.payload.success).toBe(false);
      expect(parsed.payload.error.code).toBe(SCPErrorCodes.ACTION_NOT_FOUND);

      // Cleanup
      await safeStopService(lifecycleManager, "no-action-service");
      await scpServer.close();
    });

    it("should ensure isolation between multiple services", async () => {
      const mockSupervisor = createMockProcessSupervisor();
      const lifecycleManager = new ServiceLifecycleManager({
        supervisor: mockSupervisor as unknown as ProcessSupervisor,
        servicesDir: tempDir,
        getServices: async () => [
          { manifest: { id: "service-a", entry: "index.js" }, path: tempDir },
          { manifest: { id: "service-b", entry: "index.js" }, path: tempDir },
        ],
      });

      const scpLogger = {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        child: vi.fn().mockReturnThis(),
      } as unknown as ReturnType<typeof createSubsystemLogger>;

      const serviceAActions: string[] = [];
      const serviceBActions: string[] = [];

      const scpServer = createSCPServer({
        logger: scpLogger,
        onServiceAction: async (serviceId, action) => {
          if (serviceId === "service-a") {
            serviceAActions.push(action);
          } else if (serviceId === "service-b") {
            serviceBActions.push(action);
          }
          return { received: true };
        },
      });

      // Start both services
      await lifecycleManager.startService("service-a");
      await lifecycleManager.startService("service-b");

      // Connect both services
      const mockSocketA = new MockWebSocket();
      const mockSocketB = new MockWebSocket();

      scpServer.handleUpgrade(
        {
          url: "/__openclaw__/scp?serviceId=service-a",
          socket: { remoteAddress: "127.0.0.1" },
        } as unknown as IncomingMessage,
        mockSocketA as unknown as WebSocket,
      );
      scpServer.handleUpgrade(
        {
          url: "/__openclaw__/scp?serviceId=service-b",
          socket: { remoteAddress: "127.0.0.1" },
        } as unknown as IncomingMessage,
        mockSocketB as unknown as WebSocket,
      );

      // Send started messages
      mockSocketA.simulateMessage(
        JSON.stringify(
          createSCPMessage("service.started", "service-a", {
            name: "Service A",
            version: "1.0.0",
            actions: ["action-1"],
          }),
        ),
      );
      mockSocketB.simulateMessage(
        JSON.stringify(
          createSCPMessage("service.started", "service-b", {
            name: "Service B",
            version: "1.0.0",
            actions: ["action-2"],
          }),
        ),
      );

      await new Promise((resolve) => setTimeout(resolve, 50));

      // Send actions to each service
      mockSocketA.simulateMessage(
        JSON.stringify(
          createSCPMessage("service.action", "service-a", {
            action: "action-1",
            params: { data: "from-a" },
          }),
        ),
      );
      mockSocketB.simulateMessage(
        JSON.stringify(
          createSCPMessage("service.action", "service-b", {
            action: "action-2",
            params: { data: "from-b" },
          }),
        ),
      );

      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify isolation - each service only received its own actions
      expect(serviceAActions).toHaveLength(1);
      expect(serviceAActions[0]).toBe("action-1");
      expect(serviceBActions).toHaveLength(1);
      expect(serviceBActions[0]).toBe("action-2");

      // Verify responses went to correct services
      const responseA = mockSocketA.sentMessages.filter((msg) => {
        const parsed = JSON.parse(msg);
        return parsed.type === "agent.response" && parsed.payload.success === true;
      });
      const responseB = mockSocketB.sentMessages.filter((msg) => {
        const parsed = JSON.parse(msg);
        return parsed.type === "agent.response" && parsed.payload.success === true;
      });

      expect(responseA.length).toBeGreaterThanOrEqual(1);
      expect(responseB.length).toBeGreaterThanOrEqual(1);

      // Cleanup
      await safeStopService(lifecycleManager, "test-service");
      await scpServer.close();
    });

    it("should handle service process crash and cleanup", async () => {
      // Create a supervisor that auto-exits after a delay to simulate crash
      const runs = new Map<string, { cancel: (reason?: string) => void }>();
      const mockSupervisor = {
        spawn: vi.fn().mockImplementation(async (input) => {
          const runId = `run-${Date.now()}`;
          const pid = 12345;

          let resolveWait: (value: { exitCode: number | null; stderr: string }) => void;
          const waitPromise = new Promise<{ exitCode: number | null; stderr: string }>(
            (resolve) => {
              resolveWait = resolve;
            },
          );

          const run = {
            runId,
            pid,
            wait: () => waitPromise,
            cancel: vi.fn().mockImplementation(() => {
              resolveWait({ exitCode: 1, stderr: "" });
            }),
          };

          runs.set(runId, run);

          if (input.onStdout) {
            setTimeout(() => input.onStdout!("Service process started"), 10);
          }

          // Auto-exit after delay to simulate crash
          setTimeout(() => {
            resolveWait({ exitCode: 1, stderr: "" });
          }, 50);

          return run;
        }),
        cancel: vi.fn(),
        cancelScope: vi.fn(),
        reconcileOrphans: vi.fn().mockResolvedValue(undefined),
        getRecord: vi.fn().mockReturnValue(undefined),
      };

      const lifecycleManager = new ServiceLifecycleManager({
        supervisor: mockSupervisor as unknown as ProcessSupervisor,
        servicesDir: tempDir,
        getServices: async () => [
          {
            manifest: { id: "crash-service", entry: "index.js" },
            path: tempDir,
          },
        ],
      });

      let unexpectedExitCalled = false;
      lifecycleManager.registerLifecycleHooks({
        onUnexpectedExit: (serviceId) => {
          expect(serviceId).toBe("crash-service");
          unexpectedExitCalled = true;
        },
      });

      // Start service
      await lifecycleManager.startService("crash-service");

      // Wait for the process exit handling (auto-exit after 50ms + processing time)
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Verify unexpected exit was detected
      expect(unexpectedExitCalled).toBe(true);

      // Verify service state was updated to error
      const state = lifecycleManager.getServiceState("crash-service");
      expect(state?.state).toBe("error");
    });

    it("should handle concurrent service starts and stops", async () => {
      const mockSupervisor = createMockProcessSupervisor();
      const lifecycleManager = new ServiceLifecycleManager({
        supervisor: mockSupervisor as unknown as ProcessSupervisor,
        servicesDir: tempDir,
        getServices: async () => [
          { manifest: { id: "concurrent-1", entry: "index.js" }, path: tempDir },
          { manifest: { id: "concurrent-2", entry: "index.js" }, path: tempDir },
          { manifest: { id: "concurrent-3", entry: "index.js" }, path: tempDir },
        ],
      });

      // Start all services concurrently
      const startPromises = [
        lifecycleManager.startService("concurrent-1"),
        lifecycleManager.startService("concurrent-2"),
        lifecycleManager.startService("concurrent-3"),
      ];

      const instances = await Promise.all(startPromises);

      // Verify all started
      expect(instances.every((i) => i.state === "started")).toBe(true);
      expect(lifecycleManager.listRunningServices()).toHaveLength(3);

      // Stop all concurrently
      const stopPromises = [
        safeStopService(lifecycleManager, "concurrent-1"),
        safeStopService(lifecycleManager, "concurrent-2"),
        safeStopService(lifecycleManager, "concurrent-3"),
      ];

      await Promise.all(stopPromises);

      // Verify all stopped
      expect(lifecycleManager.listRunningServices()).toHaveLength(0);
    });

    it("should broadcast messages to specific services", async () => {
      const mockSupervisor = createMockProcessSupervisor();
      const lifecycleManager = new ServiceLifecycleManager({
        supervisor: mockSupervisor as unknown as ProcessSupervisor,
        servicesDir: tempDir,
        getServices: async () => [
          {
            manifest: { id: "broadcast-service", entry: "index.js" },
            path: tempDir,
          },
        ],
      });

      const scpLogger = {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        child: vi.fn().mockReturnThis(),
      } as unknown as ReturnType<typeof createSubsystemLogger>;

      const scpServer = createSCPServer({
        logger: scpLogger,
      });

      // Start and connect service
      await lifecycleManager.startService("broadcast-service");

      const mockSocket = new MockWebSocket();
      scpServer.handleUpgrade(
        {
          url: "/__openclaw__/scp?serviceId=broadcast-service",
          socket: { remoteAddress: "127.0.0.1" },
        } as unknown as IncomingMessage,
        mockSocket as unknown as WebSocket,
      );

      // Send started message
      mockSocket.simulateMessage(
        JSON.stringify(
          createSCPMessage("service.started", "broadcast-service", {
            name: "Broadcast Service",
            version: "1.0.0",
          }),
        ),
      );
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Broadcast a message to the service
      const broadcastMessage = {
        type: "agent.stop-request",
        serviceId: "broadcast-service",
        requestId: `req-${Date.now()}`,
        timestamp: new Date().toISOString(),
        payload: { reason: "Maintenance", force: false },
      };

      const sent = scpServer.broadcastToService(
        "broadcast-service",
        broadcastMessage as SCPMessage,
      );
      expect(sent).toBe(true);

      // Verify message was received
      const received = mockSocket.sentMessages.find((msg) => {
        const parsed = JSON.parse(msg);
        return parsed.type === "agent.stop-request";
      });
      expect(received).toBeDefined();
      expect(JSON.parse(received!).payload.reason).toBe("Maintenance");

      // Try broadcasting to non-existent service
      const notSent = scpServer.broadcastToService("non-existent", broadcastMessage as SCPMessage);
      expect(notSent).toBe(false);

      // Cleanup
      await safeStopService(lifecycleManager, "broadcast-service");
      await scpServer.close();
    });

    it("should provide accurate connection statistics", async () => {
      const mockSupervisor = createMockProcessSupervisor();
      const lifecycleManager = new ServiceLifecycleManager({
        supervisor: mockSupervisor as unknown as ProcessSupervisor,
        servicesDir: tempDir,
        getServices: async () => [
          { manifest: { id: "stats-1", entry: "index.js" }, path: tempDir },
          { manifest: { id: "stats-2", entry: "index.js" }, path: tempDir },
        ],
      });

      const scpLogger = {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        child: vi.fn().mockReturnThis(),
      } as unknown as ReturnType<typeof createSubsystemLogger>;

      const scpServer = createSCPServer({
        logger: scpLogger,
      });

      // Initial stats should be empty
      let stats = scpServer.getConnectionStats();
      expect(stats.totalConnections).toBe(0);
      expect(stats.services.size).toBe(0);

      // Start and connect services
      await lifecycleManager.startService("stats-1");
      await lifecycleManager.startService("stats-2");

      const mockSocket1 = new MockWebSocket();
      const mockSocket2 = new MockWebSocket();

      scpServer.handleUpgrade(
        {
          url: "/__openclaw__/scp?serviceId=stats-1",
          socket: { remoteAddress: "127.0.0.1" },
        } as unknown as IncomingMessage,
        mockSocket1 as unknown as WebSocket,
      );
      scpServer.handleUpgrade(
        {
          url: "/__openclaw__/scp?serviceId=stats-2",
          socket: { remoteAddress: "127.0.0.1" },
        } as unknown as IncomingMessage,
        mockSocket2 as unknown as WebSocket,
      );

      // Stats should show both connections
      stats = scpServer.getConnectionStats();
      expect(stats.totalConnections).toBe(2);
      expect(stats.services.has("stats-1")).toBe(true);
      expect(stats.services.has("stats-2")).toBe(true);

      // Close one connection
      mockSocket1.close();
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Stats should be updated
      stats = scpServer.getConnectionStats();
      expect(stats.totalConnections).toBe(1);
      expect(stats.services.has("stats-1")).toBe(false);
      expect(stats.services.has("stats-2")).toBe(true);

      // Cleanup
      await safeStopService(lifecycleManager, "stats-1");
      await safeStopService(lifecycleManager, "stats-2");
      await scpServer.close();
    });
  });

  // ===========================================================================
  // Tool Invocation Integration Tests
  // ===========================================================================

  describe("Tool Invocation Integration", () => {
    it("should invoke tools through agent integration", async () => {
      const toolCalls: Array<{ toolName: string; params: Record<string, unknown> }> = [];

      const mockToolInvoker = async (toolName: string, params: Record<string, unknown>) => {
        toolCalls.push({ toolName, params });
        return {
          content: [{ type: "text" as const, text: `Executed ${toolName}` }],
          details: { result: `Executed ${toolName}` },
        };
      };

      const { createAgentIntegration } = await import("./agent-integration.js");
      const agentIntegration = createAgentIntegration({
        toolInvoker: mockToolInvoker,
      });

      const message = {
        type: "service.action" as const,
        serviceId: "tool-test-service",
        requestId: "req-123",
        timestamp: new Date().toISOString(),
        payload: {
          action: "create-task",
          params: { title: "Test Task", description: "Test" },
        },
      };

      const connection = {
        serviceId: "tool-test-service",
        socket: { readyState: 1, send: vi.fn() } as unknown as WebSocket,
        connId: "conn-123",
        connectedAt: new Date(),
      };

      const response = await agentIntegration.handleServiceAction(message, connection);

      expect(response.type).toBe("agent.response");
      expect(response.payload.success).toBe(true);
      expect(toolCalls).toHaveLength(1);
      expect(toolCalls[0].toolName).toBe("task_create");
    });

    it("should handle tool invocation errors gracefully", async () => {
      const mockToolInvoker = async () => {
        throw new Error("Tool execution failed");
      };

      const { createAgentIntegration } = await import("./agent-integration.js");
      const agentIntegration = createAgentIntegration({
        toolInvoker: mockToolInvoker,
      });

      const message = {
        type: "service.action" as const,
        serviceId: "tool-error-service",
        requestId: "req-456",
        timestamp: new Date().toISOString(),
        payload: {
          action: "create-task",
          params: { title: "Test Task" },
        },
      };

      const connection = {
        serviceId: "tool-error-service",
        socket: { readyState: 1, send: vi.fn() } as unknown as WebSocket,
        connId: "conn-456",
        connectedAt: new Date(),
      };

      const response = await agentIntegration.handleServiceAction(message, connection);

      expect(response.type).toBe("agent.response");
      expect(response.payload.success).toBe(false);
      expect(response.payload.error?.message).toContain("Tool execution failed");
    });
  });
});
