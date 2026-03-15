/**
 * Service types for OpenClaw service framework
 * Services are user-defined extensions with a manifest, script entry point, and optional UI
 */

export type ServiceCapability =
  | "http"
  | "websocket"
  | "cron"
  | "webhook"
  | "storage"
  | "mcp"
  | "tool";

export type ServiceManifest = {
  id: string;
  name: string;
  version: string;
  description?: string;
  entry?: string;
  ui?: {
    index?: string;
    entry?: string;
  };
  capabilities?:
    | ServiceCapability[]
    | {
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
      };
  author?: string;
  license?: string;
  category?: string;
  trigger?: {
    type: string;
    [key: string]: unknown;
  };
  execution?: {
    agentId?: string;
    timeout?: number;
    retries?: number;
    concurrent?: boolean;
    sessionTarget?: string;
    retryPolicy?: Record<string, unknown>;
  };
  requires?: {
    skills?: string[];
    optionalSkills?: string[];
    tools?: string[];
    optionalTools?: string[];
    services?: string[];
    env?: string[];
    config?: string[];
  };
  config?: Record<
    string,
    {
      type: "string" | "number" | "boolean" | "array" | "object" | "secret";
      required?: boolean;
      default?: unknown;
      description?: string;
      enum?: string[];
      items?: Record<string, unknown>;
      properties?: Record<string, Record<string, unknown>>;
      pattern?: string;
      minimum?: number;
      maximum?: number;
    }
  >;
};

export type ServiceDirectory = {
  /** Absolute path to the service directory */
  path: string;
  /** Service name (directory name) */
  name: string;
  /** Loaded manifest if valid */
  manifest?: ServiceManifest;
  /** Validation status */
  valid: boolean;
  /** Validation errors if invalid */
  errors?: string[];
  /** Service type: 'traditional' for manifest.json, 'declarative' for service.json */
  serviceType?: "traditional" | "declarative";
};

export type Service = {
  /** Service manifest */
  manifest: ServiceManifest;
  /** Absolute path to service directory */
  path: string;
  /** Service state */
  state: "inactive" | "loading" | "active" | "error";
  /** Error message if state is 'error' */
  error?: string;
};

export type LoadedService = Service & {
  /** Module exports from the service entry point */
  module: unknown;
  /** Service is active and running */
  state: "active";
};

export type ValidationResult =
  | {
      valid: true;
      errors?: undefined;
      manifest: ServiceManifest;
      serviceType?: "traditional" | "declarative";
    }
  | {
      valid: false;
      errors: string[];
      manifest?: undefined;
      serviceType?: "traditional" | "declarative";
    };
