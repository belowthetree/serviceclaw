import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";
import { ServiceManifestSchema, isServiceManifest, type ServiceManifest } from "./schema.js";

// =============================================================================
// Test Fixtures - 4 Example Services from docs/services/examples.md
// =============================================================================

const dailyBriefingService: ServiceManifest = {
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
      description: "City or location for weather",
      default: "New York",
      required: true,
    },
    newsSources: {
      type: "array",
      items: { type: "string" },
      description: "News RSS feeds or keywords",
      default: ["tech", "world"],
      required: false,
    },
    calendarIds: {
      type: "array",
      items: { type: "string" },
      description: "Calendar identifiers to include",
      default: ["primary"],
      required: false,
    },
    taskSources: {
      type: "array",
      items: {
        type: "string",
        enum: ["apple-reminders", "things", "todoist"],
      },
      default: [],
      required: false,
    },
    delivery: {
      type: "object",
      required: true,
      properties: {
        channel: {
          type: "string",
          enum: ["slack", "discord", "telegram", "whatsapp", "email"],
          description: "Where to send the briefing",
        },
        target: {
          type: "string",
          description: "Channel ID, DM, or email address",
        },
      },
    },
    format: {
      type: "string",
      enum: ["concise", "detailed", "bullet-points"],
      default: "bullet-points",
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
    requiresConfirmation: ["message.send"],
    network: true,
    filesystem: false,
  },

  execution: {
    agentId: "service:daily-briefing",
    sessionTarget: "isolated",
    timeout: 30000,
    retryPolicy: {
      maxRetries: 3,
      backoff: "exponential",
    },
  },
};

const webhookReceiverService: ServiceManifest = {
  $schema: "https://openclaw.ai/schemas/service-v1.json",
  id: "webhook-receiver",
  name: "Webhook Receiver",
  description: "Receive and process webhooks from external services",
  version: "1.0.0",
  category: "integration",

  trigger: {
    type: "webhook",
    path: "/webhooks/custom/{hookId}",
    methods: ["POST"],
    auth: {
      type: "signature",
      header: "X-Webhook-Signature",
    },
  },

  config: {
    hookName: {
      type: "string",
      description: "Name for this webhook endpoint",
      required: true,
    },
    secret: {
      type: "secret",
      description: "Secret for signature validation",
      required: false,
    },
    source: {
      type: "string",
      enum: ["generic", "github", "stripe", "zapier", "custom"],
      default: "generic",
      description: "Expected webhook format",
    },
    actions: {
      type: "array",
      description: "Actions to take when webhook is received",
      items: {
        type: "object",
        properties: {
          condition: {
            type: "string",
            description: "JSONPath condition (e.g., $.event == 'push')",
          },
          action: {
            type: "string",
            enum: ["notify", "store", "forward", "script"],
          },
          target: {
            type: "string",
            description: "Target for action (channel, DB, URL)",
          },
          template: {
            type: "string",
            description: "Message template with {{variable}} substitution",
          },
        },
      },
      default: [
        {
          action: "notify",
          target: "default",
          template: "Webhook received from {{source}}",
        },
      ],
    },
    rateLimit: {
      type: "object",
      properties: {
        requestsPerMinute: { type: "number", default: 60 },
        burst: { type: "number", default: 10 },
      },
    },
  },

  requires: {
    skills: [],
    tools: ["webhook"],
    env: [],
    config: ["gateway.webhooks.enabled"],
  },

  capabilities: {
    privilegedTools: [],
    network: true,
    filesystem: false,
  },
};

const messageProcessorService: ServiceManifest = {
  $schema: "https://openclaw.ai/schemas/service-v1.json",
  id: "message-processor",
  name: "Message Processor",
  description: "Watch channels and automatically process messages, attachments, and commands",
  version: "1.0.0",
  category: "automation",

  trigger: {
    type: "message",
    channels: ["slack", "discord", "telegram"],
    filters: {
      keywords: ["!summarize", "!archive"],
      hasAttachments: true,
    },
  },

  config: {
    watches: {
      type: "array",
      description: "Channels/DMs to monitor",
      items: {
        type: "object",
        properties: {
          channelId: { type: "string" },
          channelType: {
            type: "string",
            enum: ["channel", "dm", "thread"],
          },
        },
      },
      required: true,
    },
    rules: {
      type: "array",
      description: "Processing rules",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          enabled: { type: "boolean", default: true },
          match: {
            type: "object",
            properties: {
              type: {
                type: "string",
                enum: ["keyword", "regex", "command", "attachment"],
              },
              pattern: { type: "string" },
              caseSensitive: { type: "boolean", default: false },
            },
          },
          process: {
            type: "object",
            properties: {
              action: {
                type: "string",
                enum: ["summarize", "transcribe", "extract", "archive", "reply"],
              },
              skill: { type: "string" },
              prompt: { type: "string" },
            },
          },
          respond: {
            type: "object",
            properties: {
              mode: {
                type: "string",
                enum: ["thread", "dm", "channel", "silent"],
              },
              template: { type: "string" },
              reaction: { type: "string" },
            },
          },
        },
      },
    },
    commands: {
      type: "object",
      description: "Command prefix settings",
      properties: {
        prefix: { type: "string", default: "!" },
        requireMention: { type: "boolean", default: false },
      },
    },
    rateLimit: {
      type: "object",
      properties: {
        perUserPerMinute: { type: "number", default: 10 },
        maxAttachmentSize: { type: "string", default: "25MB" },
      },
    },
  },

  requires: {
    skills: [],
    optionalSkills: ["summarize", "nano-pdf", "openai-whisper", "notion"],
    tools: ["slack", "discord"],
    config: ["channels.slack"],
  },

  capabilities: {
    privilegedTools: ["message.send"],
    network: true,
    filesystem: false,
  },
};

const dataDashboardService: ServiceManifest = {
  $schema: "https://openclaw.ai/schemas/service-v1.json",
  id: "data-dashboard",
  name: "Data Dashboard",
  description: "Personal dashboard with widgets for weather, tasks, calendar, and custom data",
  version: "1.0.0",
  category: "productivity",

  trigger: {
    type: "web",
    path: "/dashboards/{dashboardId}",
    auth: "gateway",
  },

  config: {
    title: {
      type: "string",
      default: "My Dashboard",
      required: true,
    },
    layout: {
      type: "string",
      enum: ["grid", "list", "compact"],
      default: "grid",
    },
    theme: {
      type: "string",
      enum: ["auto", "light", "dark"],
      default: "auto",
    },
    refreshInterval: {
      type: "number",
      description: "Auto-refresh interval in seconds",
      default: 300,
    },
    widgets: {
      type: "array",
      description: "Dashboard widgets",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          type: {
            type: "string",
            enum: ["weather", "tasks", "calendar", "clock", "text", "chart", "list"],
          },
          title: { type: "string" },
          position: {
            type: "object",
            properties: {
              x: { type: "number" },
              y: { type: "number" },
              w: { type: "number", default: 1 },
              h: { type: "number", default: 1 },
            },
          },
          config: {
            type: "object",
            description: "Widget-specific configuration",
          },
        },
      },
      default: [
        {
          id: "clock-1",
          type: "clock",
          title: "Time",
          position: { x: 0, y: 0, w: 1, h: 1 },
        },
        {
          id: "weather-1",
          type: "weather",
          title: "Weather",
          position: { x: 1, y: 0, w: 2, h: 2 },
          config: { location: "auto" },
        },
      ],
    },
    access: {
      type: "object",
      properties: {
        public: { type: "boolean", default: false },
        password: { type: "string" },
        allowedUsers: { type: "array", items: { type: "string" } },
      },
    },
  },

  requires: {
    skills: ["canvas"],
    optionalSkills: ["weather", "apple-reminders", "things-mac", "gog", "github"],
    tools: ["web"],
    config: ["gateway.web.enabled"],
  },

  capabilities: {
    network: true,
    filesystem: false,
  },
};

// =============================================================================
// Test Suite
// =============================================================================

describe("ServiceManifest Schema", () => {
  describe("TypeBox Schema Validation", () => {
    it("should validate Daily Briefing service", () => {
      const result = Value.Check(ServiceManifestSchema, dailyBriefingService);
      expect(result).toBe(true);
    });

    it("should validate Webhook Receiver service", () => {
      const result = Value.Check(ServiceManifestSchema, webhookReceiverService);
      expect(result).toBe(true);
    });

    it("should validate Message Processor service", () => {
      const result = Value.Check(ServiceManifestSchema, messageProcessorService);
      expect(result).toBe(true);
    });

    it("should validate Data Dashboard service", () => {
      const result = Value.Check(ServiceManifestSchema, dataDashboardService);
      expect(result).toBe(true);
    });
  });

  describe("isServiceManifest Type Guard", () => {
    it("should return true for valid Daily Briefing service", () => {
      expect(isServiceManifest(dailyBriefingService)).toBe(true);
    });

    it("should return true for valid Webhook Receiver service", () => {
      expect(isServiceManifest(webhookReceiverService)).toBe(true);
    });

    it("should return true for valid Message Processor service", () => {
      expect(isServiceManifest(messageProcessorService)).toBe(true);
    });

    it("should return true for valid Data Dashboard service", () => {
      expect(isServiceManifest(dataDashboardService)).toBe(true);
    });

    it("should return false for null", () => {
      expect(isServiceManifest(null)).toBe(false);
    });

    it("should return false for undefined", () => {
      expect(isServiceManifest(undefined)).toBe(false);
    });

    it("should return false for empty object", () => {
      expect(isServiceManifest({})).toBe(false);
    });

    it("should return false for missing required fields", () => {
      expect(
        isServiceManifest({
          id: "test-service",
          name: "Test Service",
        }),
      ).toBe(false);
    });

    it("should return false for invalid id format", () => {
      const invalidService = {
        ...dailyBriefingService,
        id: "Invalid_Service_ID", // Not kebab-case
      };
      expect(isServiceManifest(invalidService)).toBe(false);
    });

    it("should return false for invalid version format", () => {
      const invalidService = {
        ...dailyBriefingService,
        version: "1.0", // Not semver
      };
      expect(isServiceManifest(invalidService)).toBe(false);
    });

    it("should return false for invalid trigger type", () => {
      const invalidService = {
        ...dailyBriefingService,
        trigger: { type: "invalid" },
      };
      expect(isServiceManifest(invalidService)).toBe(false);
    });
  });

  describe("Required Fields Validation", () => {
    it("should require id field", () => {
      const { id: _id, ...invalidService } = dailyBriefingService;
      const result = Value.Check(ServiceManifestSchema, invalidService);
      expect(result).toBe(false);
    });

    it("should require name field", () => {
      const { name: _name, ...invalidService } = dailyBriefingService;
      const result = Value.Check(ServiceManifestSchema, invalidService);
      expect(result).toBe(false);
    });

    it("should require description field", () => {
      const { description: _description, ...invalidService } = dailyBriefingService;
      const result = Value.Check(ServiceManifestSchema, invalidService);
      expect(result).toBe(false);
    });

    it("should require version field", () => {
      const { version: _version, ...invalidService } = dailyBriefingService;
      const result = Value.Check(ServiceManifestSchema, invalidService);
      expect(result).toBe(false);
    });

    it("should require trigger field", () => {
      const { trigger: _trigger, ...invalidService } = dailyBriefingService;
      const result = Value.Check(ServiceManifestSchema, invalidService);
      expect(result).toBe(false);
    });

    it("should require config field", () => {
      const { config: _config, ...invalidService } = dailyBriefingService;
      const result = Value.Check(ServiceManifestSchema, invalidService);
      expect(result).toBe(false);
    });

    it("should require requires field", () => {
      const { requires: _requires, ...invalidService } = dailyBriefingService;
      const result = Value.Check(ServiceManifestSchema, invalidService);
      expect(result).toBe(false);
    });

    it("should require capabilities field", () => {
      const { capabilities: _capabilities, ...invalidService } = dailyBriefingService;
      const result = Value.Check(ServiceManifestSchema, invalidService);
      expect(result).toBe(false);
    });
  });

  describe("Trigger Type Validation", () => {
    it("should accept valid cron trigger", () => {
      const service = {
        ...dailyBriefingService,
        trigger: {
          type: "cron" as const,
          schedule: "0 */6 * * *",
          timezone: "UTC",
        },
      };
      expect(Value.Check(ServiceManifestSchema, service)).toBe(true);
    });

    it("should accept valid webhook trigger", () => {
      const service = {
        ...dailyBriefingService,
        trigger: {
          type: "webhook" as const,
          path: "/webhooks/test",
          methods: ["POST", "PUT"],
        },
      };
      expect(Value.Check(ServiceManifestSchema, service)).toBe(true);
    });

    it("should accept valid message trigger", () => {
      const service = {
        ...dailyBriefingService,
        trigger: {
          type: "message" as const,
          channels: ["slack"],
          filters: {
            patterns: ["^!command"],
            keywords: ["help"],
          },
        },
      };
      expect(Value.Check(ServiceManifestSchema, service)).toBe(true);
    });

    it("should accept valid web trigger", () => {
      const service = {
        ...dailyBriefingService,
        trigger: {
          type: "web" as const,
          path: "/dashboards/test",
          auth: "public" as const,
        },
      };
      expect(Value.Check(ServiceManifestSchema, service)).toBe(true);
    });
  });

  describe("Category Validation", () => {
    it("should accept all valid categories", () => {
      const validCategories = [
        "productivity",
        "communication",
        "monitoring",
        "automation",
        "integration",
        "custom",
      ];

      for (const category of validCategories) {
        const service = { ...dailyBriefingService, category };
        expect(Value.Check(ServiceManifestSchema, service)).toBe(true);
      }
    });
  });

  describe("Config Field Types", () => {
    it("should accept all valid config field types", () => {
      const validTypes = ["string", "number", "boolean", "array", "object", "secret"];

      for (const type of validTypes) {
        const service = {
          ...dailyBriefingService,
          config: {
            testField: {
              type,
              description: "Test field",
            },
          },
        };
        expect(Value.Check(ServiceManifestSchema, service)).toBe(true);
      }
    });
  });

  describe("Optional Fields", () => {
    it("should accept service without $schema", () => {
      const { $schema: _$schema, ...service } = dailyBriefingService;
      expect(Value.Check(ServiceManifestSchema, service)).toBe(true);
    });

    it("should accept service without author", () => {
      const { author: _author, ...service } = dailyBriefingService;
      expect(Value.Check(ServiceManifestSchema, service)).toBe(true);
    });

    it("should accept service without category", () => {
      const { category: _category, ...service } = dailyBriefingService;
      expect(Value.Check(ServiceManifestSchema, service)).toBe(true);
    });

    it("should accept service without execution config", () => {
      const { execution: _execution, ...service } = dailyBriefingService;
      expect(Value.Check(ServiceManifestSchema, service)).toBe(true);
    });
  });

  describe("Edge Cases", () => {
    it("should accept empty config object", () => {
      const service = { ...dailyBriefingService, config: {} };
      expect(Value.Check(ServiceManifestSchema, service)).toBe(true);
    });

    it("should accept empty requires object", () => {
      const service = { ...dailyBriefingService, requires: {} };
      expect(Value.Check(ServiceManifestSchema, service)).toBe(true);
    });

    it("should accept empty capabilities object", () => {
      const service = { ...dailyBriefingService, capabilities: {} };
      expect(Value.Check(ServiceManifestSchema, service)).toBe(true);
    });

    it("should accept complex nested config structures", () => {
      const service = {
        ...dailyBriefingService,
        config: {
          nested: {
            type: "object",
            description: "Nested object",
            properties: {
              deeply: {
                type: "object",
                description: "Deeply nested",
                properties: {
                  value: { type: "string", description: "Deep value" },
                },
              },
            },
          },
          arrayField: {
            type: "array",
            description: "Array field",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                value: { type: "number" },
              },
            },
          },
        },
      };
      expect(Value.Check(ServiceManifestSchema, service)).toBe(true);
    });
  });

  describe("JSON Schema Export", () => {
    it("should export valid JSON Schema object", () => {
      const schema = ServiceManifestSchema;
      expect(schema).toBeDefined();
      expect(typeof schema).toBe("object");
    });

    it("should have required properties in schema", () => {
      const schema = ServiceManifestSchema as Record<string, unknown>;
      expect(schema.type).toBe("object");
      expect(Array.isArray(schema.required)).toBe(true);
      expect((schema.required as string[]).toSorted()).toEqual(
        [
          "id",
          "name",
          "description",
          "version",
          "trigger",
          "config",
          "requires",
          "capabilities",
        ].toSorted(),
      );
    });
  });
});
