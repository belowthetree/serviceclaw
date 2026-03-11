import { Type, type Static } from "@sinclair/typebox";
import { NonEmptyString } from "./primitives.js";

// =============================================================================
// Service State and Types
// =============================================================================

/** Service lifecycle states - must match ServiceState in services/registry.ts */
const ServiceStateSchema = Type.Union([
  Type.Literal("pending"),
  Type.Literal("validating"),
  Type.Literal("installing"),
  Type.Literal("installed"),
  Type.Literal("enabled"),
  Type.Literal("disabled"),
  Type.Literal("error"),
  Type.Literal("validation_error"),
  Type.Literal("install_error"),
  Type.Literal("uninstalling"),
]);

/** Service category - matches ServiceCategories in services/schema.ts */
const ServiceCategorySchema = Type.Union([
  Type.Literal("productivity"),
  Type.Literal("communication"),
  Type.Literal("monitoring"),
  Type.Literal("automation"),
  Type.Literal("integration"),
  Type.Literal("custom"),
]);

/** Trigger type - matches TriggerTypes in services/schema.ts */
const TriggerTypeSchema = Type.Union([
  Type.Literal("cron"),
  Type.Literal("webhook"),
  Type.Literal("message"),
  Type.Literal("web"),
]);

// =============================================================================
// Service Summary Schema
// =============================================================================

/** Service summary - mirrors ServiceIndexEntry from services/registry.ts */
export const ServiceSummarySchema = Type.Object(
  {
    id: NonEmptyString,
    name: NonEmptyString,
    state: ServiceStateSchema,
    triggerType: TriggerTypeSchema,
    category: Type.Optional(ServiceCategorySchema),
    updatedAt: NonEmptyString,
  },
  { additionalProperties: false },
);

// =============================================================================
// Services Status Schemas
// =============================================================================

/** Request schema for services.status method */
export const ServicesStatusRequestSchema = Type.Object({}, { additionalProperties: false });

/** Response schema for services.status method */
export const ServicesStatusResponseSchema = Type.Object(
  {
    services: Type.Array(ServiceSummarySchema),
  },
  { additionalProperties: false },
);

// =============================================================================
// Services Enable Schemas
// =============================================================================

/** Request schema for services.enable method */
export const ServicesEnableRequestSchema = Type.Object(
  {
    serviceId: NonEmptyString,
  },
  { additionalProperties: false },
);

/** Response schema for services.enable method */
export const ServicesEnableResponseSchema = Type.Object(
  {
    ok: Type.Boolean(),
    serviceId: NonEmptyString,
  },
  { additionalProperties: false },
);

// =============================================================================
// Services Disable Schemas
// =============================================================================

/** Request schema for services.disable method */
export const ServicesDisableRequestSchema = Type.Object(
  {
    serviceId: NonEmptyString,
  },
  { additionalProperties: false },
);

/** Response schema for services.disable method */
export const ServicesDisableResponseSchema = Type.Object(
  {
    ok: Type.Boolean(),
    serviceId: NonEmptyString,
  },
  { additionalProperties: false },
);

// =============================================================================
// TypeScript Types
// =============================================================================

export type ServiceState = Static<typeof ServiceStateSchema>;
export type ServiceCategory = Static<typeof ServiceCategorySchema>;
export type TriggerType = Static<typeof TriggerTypeSchema>;
export type ServiceSummary = Static<typeof ServiceSummarySchema>;
export type ServicesStatusRequest = Static<typeof ServicesStatusRequestSchema>;
export type ServicesStatusResponse = Static<typeof ServicesStatusResponseSchema>;
export type ServicesEnableRequest = Static<typeof ServicesEnableRequestSchema>;
export type ServicesEnableResponse = Static<typeof ServicesEnableResponseSchema>;
export type ServicesDisableRequest = Static<typeof ServicesDisableRequestSchema>;
export type ServicesDisableResponse = Static<typeof ServicesDisableResponseSchema>;
