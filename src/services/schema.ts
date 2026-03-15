import { z } from "zod";

export const ServiceCapabilityEnum = [
  "webhook",
  "cron",
  "message",
  "web",
  "network",
  "filesystem",
  "shell",
  "browser",
] as const;

export const ServiceCategories = [
  "productivity",
  "communication",
  "monitoring",
  "automation",
  "integration",
  "custom",
] as const;

const kebabCasePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const semverPattern = /^\d+\.\d+\.\d+(?:-[\w.]+)?$/;
const relativePathPattern = /^(?!\/)((?!\.\/).)*$/;

export const UISchema = z.object({
  entry: z.string().regex(relativePathPattern, "Entry must be a relative path").optional(),
});

// Trigger Schemas

export const CronTriggerSchema = z.object({
  type: z.literal("cron"),
  schedule: z.string(),
  timezone: z.string().optional(),
});

export const WebhookTriggerAuthSchema = z.object({
  type: z.enum(["none", "token", "hmac", "signature"]),
  secret: z.string().optional(),
  token: z.string().optional(),
  header: z.string().optional(),
});

export const WebhookTriggerSchema = z.object({
  type: z.literal("webhook"),
  path: z.string(),
  methods: z.array(z.string()).optional(),
  auth: WebhookTriggerAuthSchema.optional(),
});

export const MessageTriggerFiltersSchema = z.object({
  keywords: z.array(z.string()).optional(),
  patterns: z.array(z.string()).optional(),
  fromUsers: z.array(z.string()).optional(),
  hasAttachments: z.boolean().optional(),
});

export const MessageTriggerSchema = z.object({
  type: z.literal("message"),
  channels: z.array(z.string()),
  filters: MessageTriggerFiltersSchema.optional(),
});

export const WebTriggerSchema = z.object({
  type: z.literal("web"),
  path: z.string().optional(),
});

export const TriggerSchema = z.discriminatedUnion("type", [
  CronTriggerSchema,
  WebhookTriggerSchema,
  MessageTriggerSchema,
  WebTriggerSchema,
]);

export const TriggerTypeSchema = z.enum(["cron", "webhook", "message", "web"]);

// Execution and Requirements Schemas

export const ServiceExecutionConfigSchema = z.object({
  agentId: z.string().optional(),
  timeout: z.number().optional(),
  retries: z.number().optional(),
  concurrent: z.boolean().optional(),
  sessionTarget: z.string().optional(),
  retryPolicy: z.record(z.string(), z.unknown()).optional(),
});

export const ServiceRequirementsSchema = z.object({
  skills: z.array(z.string()).optional(),
  optionalSkills: z.array(z.string()).optional(),
  tools: z.array(z.string()).optional(),
  optionalTools: z.array(z.string()).optional(),
  services: z.array(z.string()).optional(),
  env: z.array(z.string()).optional(),
  config: z.array(z.string()).optional(),
});

// Config Field Schema

export const ConfigFieldSchema = z.object({
  type: z.enum(["string", "number", "boolean", "array", "object", "secret"]),
  required: z.boolean().optional(),
  default: z.unknown().optional(),
  description: z.string().optional(),
  enum: z.array(z.string()).optional(),
  items: z.record(z.string(), z.unknown()).optional(),
  properties: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
  pattern: z.string().optional(),
  minimum: z.number().optional(),
  maximum: z.number().optional(),
});

export const ServiceConfigSchema = z.record(z.string(), ConfigFieldSchema);

// Capabilities Schema (supports both array and object formats)

export const ServiceCapabilitiesObjectSchema = z.object({
  network: z.boolean().optional(),
  filesystem: z.boolean().optional(),
  shell: z.boolean().optional(),
  browser: z.boolean().optional(),
  webhook: z.boolean().optional(),
  cron: z.boolean().optional(),
  message: z.boolean().optional(),
  web: z.boolean().optional(),
  privilegedTools: z.array(z.string()).optional(),
  requiresConfirmation: z.array(z.string()).optional(),
});

export const ServiceCapabilitiesArraySchema = z.array(z.enum(ServiceCapabilityEnum));

export const ServiceCapabilitiesSchema = z.union([
  ServiceCapabilitiesArraySchema,
  ServiceCapabilitiesObjectSchema,
]);

// Service Manifest Schema

export const ServiceManifestSchema = z.object({
  id: z
    .string()
    .min(1, "Service ID cannot be empty")
    .regex(kebabCasePattern, "Service ID should be kebab-case"),

  name: z.string(),

  version: z.string().regex(semverPattern, "Version must follow semver"),

  description: z.string().optional(),

  entry: z.string().regex(relativePathPattern, "Entry must be a relative path").optional(),

  ui: UISchema.optional(),

  capabilities: ServiceCapabilitiesSchema.optional(),

  author: z.string().optional(),

  category: z.enum(ServiceCategories).optional(),

  trigger: TriggerSchema.optional(),

  execution: ServiceExecutionConfigSchema.optional(),

  requires: ServiceRequirementsSchema.optional(),

  config: z.record(z.string(), ConfigFieldSchema).optional(),
});

// Type Exports

export type UIConfig = z.infer<typeof UISchema>;
export type ServiceCapability = (typeof ServiceCapabilityEnum)[number];
export type ServiceCategory = (typeof ServiceCategories)[number];
export type ServiceManifest = z.infer<typeof ServiceManifestSchema>;

export type CronTrigger = z.infer<typeof CronTriggerSchema>;
export type WebhookTrigger = z.infer<typeof WebhookTriggerSchema>;
export type MessageTrigger = z.infer<typeof MessageTriggerSchema>;
export type WebTrigger = z.infer<typeof WebTriggerSchema>;
export type Trigger = z.infer<typeof TriggerSchema>;
export type TriggerType = z.infer<typeof TriggerTypeSchema>;

export type ServiceConfig = Record<string, unknown>;
export type ServiceExecutionConfig = z.infer<typeof ServiceExecutionConfigSchema>;
export type ServiceRequirements = z.infer<typeof ServiceRequirementsSchema>;
export type ConfigField = z.infer<typeof ConfigFieldSchema>;

export type ServiceType = "traditional" | "declarative";

export interface ServiceCapabilities {
  network?: boolean;
  filesystem?: boolean;
  shell?: boolean;
  browser?: boolean;
  webhook?: boolean;
  cron?: boolean;
  message?: boolean;
  web?: boolean;
  privilegedTools?: string[];
  requiresConfirmation?: string[];
}

// Validation Functions

export function validateServiceManifest(
  obj: unknown,
):
  | { success: true; data: ServiceManifest }
  | { success: false; errors: z.ZodError<ServiceManifest> } {
  const result = ServiceManifestSchema.safeParse(obj);

  if (result.success) {
    return { success: true, data: result.data };
  } else {
    return { success: false, errors: result.error };
  }
}

export function isServiceManifest(obj: unknown): obj is ServiceManifest {
  return ServiceManifestSchema.safeParse(obj).success;
}

export function formatValidationErrors(error: z.ZodError<ServiceManifest>): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "root";
      return `${path}: ${issue.message}`;
    })
    .join("\n");
}

export function isTraditionalService(manifest: ServiceManifest): boolean {
  return (
    (manifest.entry && typeof manifest.entry === "string") || (!manifest.entry && !manifest.trigger)
  );
}

export function isDeclarativeService(manifest: ServiceManifest): boolean {
  return !!manifest.trigger && !manifest.entry;
}

export default ServiceManifestSchema;
