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
  /** Unique service identifier (kebab-case recommended) */
  id: string;
  /** Human-readable service name */
  name: string;
  /** Semantic version */
  version: string;
  /** Brief description of the service */
  description: string;
  /** Entry point for the service script (relative to service root) */
  entry: string;
  /** UI configuration */
  ui?: {
    /** Path to the HTML entry point (relative to service root) */
    index: string;
  };
  /** Service capabilities */
  capabilities?: ServiceCapability[];
  /** Optional author information */
  author?: string;
  /** Optional license */
  license?: string;
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
    }
  | {
      valid: false;
      errors: string[];
      manifest?: undefined;
    };
