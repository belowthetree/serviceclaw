/**
 * Service Manifest JSON Schema
 *
 * Defines the complete schema for Service manifests (service.json) in OpenClaw.
 * Services are declarative automations that bundle skills, tools, and triggers
 * to provide user-friendly "set and forget" automation.
 *
 * @see docs/services/architecture.md
 * @see docs/services/examples.md
 */

import { Type, type Static } from "@sinclair/typebox";
import { stringEnum } from "../agents/schema/typebox.js";

// =============================================================================
// JSON Value Type (recursive type for any valid JSON)
// =============================================================================

const JsonValue = Type.Recursive((Self) =>
  Type.Union([
    Type.String(),
    Type.Number(),
    Type.Boolean(),
    Type.Null(),
    Type.Array(Self),
    Type.Record(Type.String(), Self),
  ]),
);

// =============================================================================
// Enums and Constants
// =============================================================================

/** Valid service categories for grouping */
export const ServiceCategories = [
  "productivity",
  "communication",
  "monitoring",
  "automation",
  "integration",
  "custom",
] as const;

/** Valid trigger types */
export const TriggerTypes = ["cron", "webhook", "message", "web"] as const;

/** Valid config field types (JSON Schema types + OpenClaw extensions) */
export const ConfigFieldTypes = [
  "string",
  "number",
  "boolean",
  "array",
  "object",
  "secret",
] as const;

/** Valid webhook auth types */
export const WebhookAuthTypes = ["none", "token", "hmac", "signature"] as const;

/** Valid session targets */
export const SessionTargets = ["main", "isolated"] as const;

/** Valid backoff strategies */
export const BackoffStrategies = ["fixed", "linear", "exponential"] as const;

/** Valid match types for message triggers */
export const MatchTypes = ["keyword", "regex", "command", "attachment"] as const;

/** Valid response modes */
export const ResponseModes = ["thread", "dm", "channel", "silent"] as const;

/** Valid widget types for dashboard service */
export const WidgetTypes = [
  "weather",
  "tasks",
  "calendar",
  "clock",
  "text",
  "chart",
  "list",
] as const;

// =============================================================================
// Trigger Schemas
// =============================================================================

/** Cron trigger - scheduled execution */
export const CronTriggerSchema = Type.Object(
  {
    type: Type.Literal("cron"),
    schedule: Type.String({
      description: "Cron expression (e.g., '0 8 * * *' for 8 AM daily)",
      examples: ["0 8 * * *", "*/15 * * * *", "0 9 * * 1"],
    }),
    timezone: Type.Optional(
      Type.String({
        description: "IANA timezone or 'auto' for automatic detection",
        default: "auto",
        examples: ["auto", "America/New_York", "Europe/London"],
      }),
    ),
  },
  { description: "Cron-based scheduled trigger" },
);

/** Webhook trigger - HTTP endpoint */
export const WebhookTriggerSchema = Type.Object(
  {
    type: Type.Literal("webhook"),
    path: Type.String({
      description: "URL path for the webhook endpoint (e.g., '/webhooks/github')",
      examples: ["/webhooks/github", "/webhooks/stripe"],
    }),
    methods: Type.Optional(
      Type.Array(Type.String(), {
        description: "HTTP methods to accept",
        default: ["POST"],
        examples: [["POST"], ["POST", "PUT"]],
      }),
    ),
    auth: Type.Optional(
      Type.Object(
        {
          type: stringEnum(WebhookAuthTypes, {
            description: "Authentication type for webhook requests",
            default: "none",
          }),
          header: Type.Optional(
            Type.String({
              description: "Header name for auth token/signature",
              examples: ["X-Webhook-Signature", "Authorization"],
            }),
          ),
          secret: Type.Optional(
            Type.String({
              description: "Reference to stored secret (not the actual secret)",
            }),
          ),
        },
        { description: "Webhook authentication configuration" },
      ),
    ),
  },
  { description: "HTTP webhook trigger" },
);

/** Message trigger - channel message events */
export const MessageTriggerSchema = Type.Object(
  {
    type: Type.Literal("message"),
    channels: Type.Array(Type.String(), {
      description: "Channel types to monitor (e.g., 'slack', 'discord', 'telegram')",
      examples: [["slack"], ["discord", "telegram"]],
    }),
    filters: Type.Optional(
      Type.Object(
        {
          patterns: Type.Optional(
            Type.Array(Type.String(), {
              description: "Regex patterns to match message content",
            }),
          ),
          keywords: Type.Optional(
            Type.Array(Type.String(), {
              description: "Keywords to watch for in messages",
            }),
          ),
          fromUsers: Type.Optional(
            Type.Array(Type.String(), {
              description: "Specific user IDs to monitor",
            }),
          ),
          hasAttachments: Type.Optional(
            Type.Boolean({
              description: "Only trigger on messages with attachments",
            }),
          ),
        },
        { description: "Message filtering criteria" },
      ),
    ),
  },
  { description: "Message-based trigger for channel events" },
);

/** Web UI trigger - dashboard/web page */
export const WebUITriggerSchema = Type.Object(
  {
    type: Type.Literal("web"),
    path: Type.String({
      description: "URL path for the dashboard/web page",
      examples: ["/dashboards/my-dashboard", "/services/status"],
    }),
    auth: Type.Optional(
      stringEnum(["gateway", "public", "password"], {
        description: "Authentication mode for web access",
        default: "gateway",
      }),
    ),
  },
  { description: "Web UI/dashboard trigger" },
);

/** Union of all trigger types */
export const ServiceTriggerSchema = Type.Union([
  CronTriggerSchema,
  WebhookTriggerSchema,
  MessageTriggerSchema,
  WebUITriggerSchema,
]);

// =============================================================================
// Config Field Schema
// =============================================================================

/** OpenClaw UI extensions for config fields */
export const ConfigFieldExtensionsSchema = Type.Object(
  {
    inputType: Type.Optional(
      stringEnum(
        [
          "text",
          "select",
          "multiselect",
          "channel-picker",
          "skill-picker",
          "number",
          "textarea",
          "toggle",
        ],
        {
          description: "UI input type hint",
        },
      ),
    ),
    dataSource: Type.Optional(
      Type.Object(
        {
          skill: Type.Optional(Type.String()),
          tool: Type.Optional(Type.String()),
          config: Type.Optional(Type.String()),
        },
        { description: "Dynamic data source for select options" },
      ),
    ),
    validateOn: Type.Optional(
      stringEnum(["blur", "change", "submit"], {
        description: "When to validate the field",
        default: "change",
      }),
    ),
  },
  { description: "OpenClaw UI extensions for config fields" },
);

/** Base configuration field schema */
export const ServiceConfigFieldSchema = Type.Object(
  {
    type: stringEnum(ConfigFieldTypes, {
      description: "Field data type",
    }),
    description: Type.String({
      description: "Human-readable description of the field",
    }),
    required: Type.Optional(
      Type.Boolean({
        description: "Whether this field is required",
        default: false,
      }),
    ),
    default: Type.Optional(JsonValue),
    // Type-specific properties
    enum: Type.Optional(
      Type.Array(Type.String(), {
        description: "Allowed values for string type",
      }),
    ),
    items: Type.Optional(JsonValue),
    properties: Type.Optional(Type.Record(Type.String(), JsonValue)),
    minimum: Type.Optional(Type.Number()),
    maximum: Type.Optional(Type.Number()),
    minLength: Type.Optional(Type.Number()),
    maxLength: Type.Optional(Type.Number()),
    pattern: Type.Optional(Type.String()),
    // OpenClaw extensions
    "x-openclaw": Type.Optional(ConfigFieldExtensionsSchema),
  },
  { description: "Service configuration field definition" },
);

// =============================================================================
// Requirements Schema
// =============================================================================

/** Service requirements block */
export const ServiceRequirementsSchema = Type.Object(
  {
    skills: Type.Optional(
      Type.Array(Type.String(), {
        description: "Required skill IDs",
        examples: [["weather"], ["weather", "calendar"]],
      }),
    ),
    optionalSkills: Type.Optional(
      Type.Array(Type.String(), {
        description: "Optional skills (service works with degraded functionality if unavailable)",
      }),
    ),
    tools: Type.Optional(
      Type.Array(Type.String(), {
        description: "Required tool names",
        examples: [["message.send"], ["web_fetch", "message.send"]],
      }),
    ),
    optionalTools: Type.Optional(
      Type.Array(Type.String(), {
        description: "Optional tools",
      }),
    ),
    env: Type.Optional(
      Type.Array(Type.String(), {
        description: "Required environment variables",
        examples: [["OPENWEATHER_API_KEY"]],
      }),
    ),
    config: Type.Optional(
      Type.Array(Type.String(), {
        description: "Required OpenClaw config paths",
        examples: [["channels.slack"]],
      }),
    ),
  },
  { description: "Service capability requirements" },
);

// =============================================================================
// Capabilities Schema (Security)
// =============================================================================

/** Service capabilities and security declarations */
export const ServiceCapabilitiesSchema = Type.Object(
  {
    privilegedTools: Type.Optional(
      Type.Array(Type.String(), {
        description: "Tools that require explicit user confirmation",
        examples: [["message.send"], ["message.send", "email.send"]],
      }),
    ),
    requiresConfirmation: Type.Optional(
      Type.Array(Type.String(), {
        description: "Tools that will always prompt for user confirmation before execution",
      }),
    ),
    network: Type.Optional(
      Type.Boolean({
        description: "Whether service requires internet access",
        default: false,
      }),
    ),
    filesystem: Type.Optional(
      Type.Boolean({
        description: "Whether service requires filesystem access",
        default: false,
      }),
    ),
    shell: Type.Optional(
      Type.Boolean({
        description: "Whether service requires shell command execution",
        default: false,
      }),
    ),
    browser: Type.Optional(
      Type.Boolean({
        description: "Whether service requires browser automation",
        default: false,
      }),
    ),
  },
  { description: "Service security capabilities and permissions" },
);

// =============================================================================
// Execution Config Schema
// =============================================================================

/** Retry policy configuration */
export const RetryPolicySchema = Type.Object(
  {
    maxRetries: Type.Number({
      description: "Maximum number of retry attempts",
      default: 3,
      minimum: 0,
      maximum: 10,
    }),
    backoff: stringEnum(BackoffStrategies, {
      description: "Backoff strategy between retries",
      default: "exponential",
    }),
    initialDelayMs: Type.Optional(
      Type.Number({
        description: "Initial delay before first retry (milliseconds)",
        default: 1000,
      }),
    ),
  },
  { description: "Retry policy for failed executions" },
);

/** Service execution configuration */
export const ServiceExecutionConfigSchema = Type.Object(
  {
    agentId: Type.Optional(
      Type.String({
        description: "Agent ID for execution (auto-generated if not specified)",
        examples: ["service:daily-briefing"],
      }),
    ),
    sessionTarget: Type.Optional(
      stringEnum(SessionTargets, {
        description: "Session isolation level",
        default: "isolated",
      }),
    ),
    timeout: Type.Optional(
      Type.Number({
        description: "Execution timeout in milliseconds",
        default: 30000,
        minimum: 1000,
        maximum: 300000,
      }),
    ),
    retryPolicy: Type.Optional(RetryPolicySchema),
  },
  { description: "Service execution settings" },
);

// =============================================================================
// Main Service Manifest Schema
// =============================================================================

/** Service manifest schema - the complete service definition */
export const ServiceManifestSchema = Type.Object(
  {
    $schema: Type.Optional(
      Type.String({
        description: "Schema URL for validation",
        examples: ["https://openclaw.ai/schemas/service-v1.json"],
      }),
    ),

    // Identity
    id: Type.String({
      description: "Unique identifier for the service (kebab-case)",
      examples: ["daily-briefing", "webhook-receiver", "message-processor"],
      pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$",
    }),
    name: Type.String({
      description: "Human-readable name",
      examples: ["Daily Briefing", "Webhook Receiver"],
    }),
    description: Type.String({
      description: "What the service does",
      examples: ["Your personalized morning briefing with weather, calendar, news, and tasks"],
    }),
    version: Type.String({
      description: "Semver version",
      examples: ["1.0.0", "2.1.3"],
      pattern: "^\\d+\\.\\d+\\.\\d+(?:-[\\w.]+)?$",
    }),
    author: Type.Optional(
      Type.String({
        description: "Creator/organization",
        examples: ["OpenClaw", "Your Name"],
      }),
    ),
    category: Type.Optional(
      stringEnum(ServiceCategories, {
        description: "Category for grouping",
        default: "custom",
      }),
    ),

    // Trigger configuration
    trigger: ServiceTriggerSchema,

    // User configuration schema
    config: Type.Record(Type.String(), ServiceConfigFieldSchema, {
      description: "Configuration schema for user-customizable parameters",
    }),

    // Requirements
    requires: ServiceRequirementsSchema,

    // Security capabilities
    capabilities: ServiceCapabilitiesSchema,

    // Execution settings (optional)
    execution: Type.Optional(ServiceExecutionConfigSchema),
  },
  {
    description: "OpenClaw Service Manifest - declarative automation definition",
    additionalProperties: false,
  },
);

// =============================================================================
// TypeScript Types
// =============================================================================

/** Service category type */
export type ServiceCategory = (typeof ServiceCategories)[number];

/** Trigger type */
export type TriggerType = (typeof TriggerTypes)[number];

/** Config field type */
export type ConfigFieldType = (typeof ConfigFieldTypes)[number];

/** Webhook auth type */
export type WebhookAuthType = (typeof WebhookAuthTypes)[number];

/** Session target */
export type SessionTarget = (typeof SessionTargets)[number];

/** Backoff strategy */
export type BackoffStrategy = (typeof BackoffStrategies)[number];

/** Match type for message triggers */
export type MatchType = (typeof MatchTypes)[number];

/** Response mode */
export type ResponseMode = (typeof ResponseModes)[number];

/** Widget type */
export type WidgetType = (typeof WidgetTypes)[number];

/** Cron trigger */
export type CronTrigger = Static<typeof CronTriggerSchema>;

/** Webhook trigger */
export type WebhookTrigger = Static<typeof WebhookTriggerSchema>;

/** Message trigger */
export type MessageTrigger = Static<typeof MessageTriggerSchema>;

/** Web UI trigger */
export type WebUITrigger = Static<typeof WebUITriggerSchema>;

/** Service trigger union */
export type ServiceTrigger = Static<typeof ServiceTriggerSchema>;

/** Config field extensions */
export type ConfigFieldExtensions = Static<typeof ConfigFieldExtensionsSchema>;

/** Service config field */
export type ServiceConfigField = Static<typeof ServiceConfigFieldSchema>;

/** Service requirements */
export type ServiceRequirements = Static<typeof ServiceRequirementsSchema>;

/** Service capabilities */
export type ServiceCapabilities = Static<typeof ServiceCapabilitiesSchema>;

/** Retry policy */
export type RetryPolicy = Static<typeof RetryPolicySchema>;

/** Service execution config */
export type ServiceExecutionConfig = Static<typeof ServiceExecutionConfigSchema>;

/** Service manifest */
export type ServiceManifest = Static<typeof ServiceManifestSchema>;

/** Service configuration values (user-provided) */
export type ServiceConfig = Record<string, unknown>;

// =============================================================================
// Schema Export
// =============================================================================

/** JSON Schema representation of ServiceManifest */
export const ServiceManifestJSONSchema = ServiceManifestSchema;

/**
 * Validate a service manifest object against the schema.
 * Note: This is a type guard. Runtime validation should use a proper validator.
 */
export function isServiceManifest(obj: unknown): obj is ServiceManifest {
  if (!obj || typeof obj !== "object") {
    return false;
  }

  const manifest = obj as Record<string, unknown>;

  // Required fields check
  if (
    typeof manifest.id !== "string" ||
    typeof manifest.name !== "string" ||
    typeof manifest.description !== "string" ||
    typeof manifest.version !== "string" ||
    !manifest.trigger ||
    typeof manifest.trigger !== "object" ||
    !manifest.config ||
    typeof manifest.config !== "object" ||
    !manifest.requires ||
    typeof manifest.requires !== "object" ||
    !manifest.capabilities ||
    typeof manifest.capabilities !== "object"
  ) {
    return false;
  }

  // Validate id format (kebab-case)
  const idPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
  if (!idPattern.test(manifest.id)) {
    return false;
  }

  // Validate semver version
  const versionPattern = /^\d+\.\d+\.\d+(?:-[\w.]+)?$/;
  if (!versionPattern.test(manifest.version)) {
    return false;
  }

  // Validate trigger type
  const trigger = manifest.trigger as Record<string, unknown>;
  const validTriggerTypes = ["cron", "webhook", "message", "web"];
  if (
    !trigger.type ||
    typeof trigger.type !== "string" ||
    !validTriggerTypes.includes(trigger.type)
  ) {
    return false;
  }

  return true;
}

/**
 * Get the JSON Schema for Service manifests.
 * This can be used for documentation or external validation.
 */
export function getServiceManifestJSONSchema(): Record<string, unknown> {
  return ServiceManifestSchema;
}

export default ServiceManifestSchema;
