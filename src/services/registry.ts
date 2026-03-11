/**
 * Service Registry - Manages Service lifecycle and persistence
 *
 * The Service Registry provides:
 * - CRUD operations for Services
 * - File-based persistence at ~/.openclaw/services/
 * - State management with history tracking
 * - Resource reference tracking
 * - Fast lookups via index.json
 *
 * Storage Structure:
 * ~/.openclaw/services/
 * ├── {serviceId}/
 * │   ├── manifest.json    # Original manifest
 * │   ├── config.json      # User configuration
 * │   ├── state.json       # Current state + history
 * │   └── refs.json        # Runtime references
 * └── index.json           # Registry index
 *
 * @see docs/services/architecture.md
 */

import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import JSON5 from "json5";
import { CONFIG_DIR } from "../utils.js";
import type { ServiceManifest, ServiceConfig, ServiceCategory, TriggerType } from "./schema.js";

// =============================================================================
// Types
// =============================================================================

/** Service lifecycle states */
export type ServiceState =
  | "pending" // Service created but not yet validated
  | "validating" // Checking requirements, dependencies
  | "installing" // Creating cron jobs, webhooks, etc.
  | "installed" // All resources created, but not running
  | "enabled" // Service is active and processing triggers
  | "disabled" // Installed but not processing triggers
  | "error" // Runtime error occurred
  | "validation_error" // Requirements not met
  | "install_error" // Installation failed, rolled back
  | "uninstalling"; // Cleaning up resources

/** State transition record */
export interface StateTransition {
  from: ServiceState;
  to: ServiceState;
  timestamp: string;
  reason?: string;
}

/** Execution statistics */
export interface ServiceExecutionStats {
  totalRuns: number;
  successfulRuns: number;
  failedRuns: number;
  lastError?: {
    message: string;
    timestamp: string;
    stack?: string;
  };
}

/** Runtime references for a service */
export interface ServiceRuntimeRefs {
  /** Service agent ID */
  agentId: string;
  /** Cron job IDs created by this service */
  cronJobIds?: string[];
  /** Webhook paths registered by this service */
  webhookPaths?: string[];
  /** Message subscription channels */
  messageSubscriptions?: Array<{
    channel: string;
    filter?: string;
  }>;
}

/** Service instance data */
export interface ServiceInstance {
  /** Unique service identifier */
  id: string;
  /** Original service manifest */
  manifest: ServiceManifest;
  /** Current service state */
  state: ServiceState;
  /** State transition history */
  stateHistory: StateTransition[];
  /** User configuration values */
  config: ServiceConfig;
  /** When the service was first created */
  createdAt: string;
  /** When the service was last updated */
  updatedAt: string;
  /** Execution statistics */
  executionStats: ServiceExecutionStats;
  /** Runtime references */
  runtimeRefs: ServiceRuntimeRefs;
  /** Last run timestamp */
  lastRunAt?: string;
  /** Next scheduled run timestamp */
  nextRunAt?: string;
}

/** Registry index entry for fast lookup */
export interface ServiceIndexEntry {
  id: string;
  name: string;
  state: ServiceState;
  triggerType: TriggerType;
  category?: ServiceCategory;
  updatedAt: string;
}

/** Registry index file structure */
export interface ServiceRegistryIndex {
  version: 1;
  services: ServiceIndexEntry[];
}

/** State file structure (persisted to state.json) */
export interface ServiceStateFile {
  serviceId: string;
  state: ServiceState;
  stateHistory: StateTransition[];
  createdAt: string;
  updatedAt: string;
  executionStats: ServiceExecutionStats;
  lastRunAt?: string;
  nextRunAt?: string;
}

/** Refs file structure (persisted to refs.json) */
export interface ServiceRefsFile {
  serviceId: string;
  agentId: string;
  cronJobIds?: string[];
  webhookPaths?: string[];
  messageSubscriptions?: Array<{
    channel: string;
    filter?: string;
  }>;
}

/** Options for listing services */
export interface ListServicesOptions {
  /** Filter by state */
  state?: ServiceState;
  /** Filter by category */
  category?: ServiceCategory;
  /** Filter by trigger type */
  triggerType?: TriggerType;
  /** Search by name or id */
  search?: string;
}

/** Validation result */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/** Registry error types */
export class ServiceRegistryError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ServiceRegistryError";
  }
}

export class ServiceNotFoundError extends ServiceRegistryError {
  constructor(serviceId: string) {
    super(`Service not found: ${serviceId}`);
    this.name = "ServiceNotFoundError";
  }
}

export class ServiceAlreadyExistsError extends ServiceRegistryError {
  constructor(serviceId: string) {
    super(`Service already exists: ${serviceId}`);
    this.name = "ServiceAlreadyExistsError";
  }
}

export class InvalidStateTransitionError extends ServiceRegistryError {
  constructor(from: ServiceState, to: ServiceState) {
    super(`Invalid state transition from ${from} to ${to}`);
    this.name = "InvalidStateTransitionError";
  }
}

// =============================================================================
// Constants
// =============================================================================

export const DEFAULT_SERVICES_DIR = path.join(CONFIG_DIR, "services");
export const INDEX_FILENAME = "index.json";
export const MANIFEST_FILENAME = "manifest.json";
export const CONFIG_FILENAME = "config.json";
export const STATE_FILENAME = "state.json";
export const REFS_FILENAME = "refs.json";

// Valid state transitions
const VALID_STATE_TRANSITIONS: Record<ServiceState, ServiceState[]> = {
  pending: ["validating", "validation_error", "uninstalling"],
  validating: ["installing", "validation_error"],
  installing: ["installed", "install_error"],
  installed: ["enabled", "disabled", "uninstalling"],
  enabled: ["disabled", "error"],
  disabled: ["enabled", "uninstalling"],
  error: ["disabled", "validating"],
  validation_error: ["validating", "uninstalling"],
  install_error: ["validating", "uninstalling"],
  uninstalling: [],
};

// =============================================================================
// ServiceRegistry Class
// =============================================================================

export interface ServiceRegistryDeps {
  fs: typeof fs;
  servicesDir: string;
}

export class ServiceRegistry {
  private deps: ServiceRegistryDeps;
  private indexCache: ServiceRegistryIndex | null = null;
  private indexCacheValid = false;

  constructor(deps: Partial<ServiceRegistryDeps> = {}) {
    this.deps = {
      fs: deps.fs ?? fs,
      servicesDir: deps.servicesDir ?? DEFAULT_SERVICES_DIR,
    };
  }

  // ---------------------------------------------------------------------------
  // Service Directory Helpers
  // ---------------------------------------------------------------------------

  private getServiceDir(serviceId: string): string {
    return path.join(this.deps.servicesDir, serviceId);
  }

  private getManifestPath(serviceId: string): string {
    return path.join(this.getServiceDir(serviceId), MANIFEST_FILENAME);
  }

  private getConfigPath(serviceId: string): string {
    return path.join(this.getServiceDir(serviceId), CONFIG_FILENAME);
  }

  private getStatePath(serviceId: string): string {
    return path.join(this.getServiceDir(serviceId), STATE_FILENAME);
  }

  private getRefsPath(serviceId: string): string {
    return path.join(this.getServiceDir(serviceId), REFS_FILENAME);
  }

  private getIndexPath(): string {
    return path.join(this.deps.servicesDir, INDEX_FILENAME);
  }

  // ---------------------------------------------------------------------------
  // File Operations
  // ---------------------------------------------------------------------------

  private async ensureServicesDir(): Promise<void> {
    await this.deps.fs.mkdir(this.deps.servicesDir, { recursive: true, mode: 0o700 });
  }

  private async ensureServiceDir(serviceId: string): Promise<void> {
    const dir = this.getServiceDir(serviceId);
    await this.deps.fs.mkdir(dir, { recursive: true, mode: 0o700 });
  }

  private async writeJsonFile(filePath: string, data: unknown): Promise<void> {
    const dir = path.dirname(filePath);
    await this.deps.fs.mkdir(dir, { recursive: true, mode: 0o700 });

    const tmp = `${filePath}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`;
    const json = JSON.stringify(data, null, 2);

    try {
      await this.deps.fs.writeFile(tmp, json, { encoding: "utf-8", mode: 0o600 });
      await this.deps.fs.rename(tmp, filePath);
    } catch (err) {
      // Clean up temp file on error
      await this.deps.fs.unlink(tmp).catch(() => undefined);
      throw err;
    }
  }

  private async readJsonFile<T>(filePath: string): Promise<T | null> {
    try {
      const raw = await this.deps.fs.readFile(filePath, "utf-8");
      return JSON5.parse(raw);
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === "ENOENT") {
        return null;
      }
      throw err;
    }
  }

  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await this.deps.fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Index Management
  // ---------------------------------------------------------------------------

  private async loadIndex(): Promise<ServiceRegistryIndex> {
    if (this.indexCacheValid && this.indexCache) {
      return this.indexCache;
    }

    const indexPath = this.getIndexPath();
    const index = await this.readJsonFile<ServiceRegistryIndex>(indexPath);

    if (index && index.version === 1) {
      this.indexCache = index;
      this.indexCacheValid = true;
      return index;
    }

    // Create new index
    const newIndex: ServiceRegistryIndex = { version: 1, services: [] };
    this.indexCache = newIndex;
    this.indexCacheValid = true;
    return newIndex;
  }

  private async saveIndex(index: ServiceRegistryIndex): Promise<void> {
    await this.ensureServicesDir();
    await this.writeJsonFile(this.getIndexPath(), index);
    this.indexCache = index;
    this.indexCacheValid = true;
  }

  private async updateIndexEntry(service: ServiceInstance): Promise<void> {
    const index = await this.loadIndex();
    const entry: ServiceIndexEntry = {
      id: service.id,
      name: service.manifest.name,
      state: service.state,
      triggerType: service.manifest.trigger.type,
      category: service.manifest.category,
      updatedAt: service.updatedAt,
    };

    const existingIndex = index.services.findIndex((s) => s.id === service.id);
    if (existingIndex >= 0) {
      index.services[existingIndex] = entry;
    } else {
      index.services.push(entry);
    }

    await this.saveIndex(index);
  }

  private async removeIndexEntry(serviceId: string): Promise<void> {
    const index = await this.loadIndex();
    index.services = index.services.filter((s) => s.id !== serviceId);
    await this.saveIndex(index);
  }

  private invalidateCache(): void {
    this.indexCacheValid = false;
  }

  // ---------------------------------------------------------------------------
  // State Management
  // ---------------------------------------------------------------------------

  private isValidStateTransition(from: ServiceState, to: ServiceState): boolean {
    if (from === to) {
      return true;
    }
    const validTransitions = VALID_STATE_TRANSITIONS[from];
    return validTransitions?.includes(to) ?? false;
  }

  private async loadState(serviceId: string): Promise<ServiceStateFile | null> {
    return this.readJsonFile<ServiceStateFile>(this.getStatePath(serviceId));
  }

  private async saveState(state: ServiceStateFile): Promise<void> {
    await this.writeJsonFile(this.getStatePath(state.serviceId), state);
  }

  private async loadRefs(serviceId: string): Promise<ServiceRefsFile | null> {
    return this.readJsonFile<ServiceRefsFile>(this.getRefsPath(serviceId));
  }

  private async saveRefs(refs: ServiceRefsFile): Promise<void> {
    await this.writeJsonFile(this.getRefsPath(refs.serviceId), refs);
  }

  // ---------------------------------------------------------------------------
  // Service CRUD Operations
  // ---------------------------------------------------------------------------

  /**
   * Register a new service
   * @param manifest - Service manifest
   * @param initialConfig - Optional initial configuration
   * @returns The created service instance
   * @throws ServiceAlreadyExistsError if service already exists
   */
  async register(
    manifest: ServiceManifest,
    initialConfig?: ServiceConfig,
  ): Promise<ServiceInstance> {
    const serviceId = manifest.id;

    // Check if service already exists
    const exists = await this.fileExists(this.getManifestPath(serviceId));
    if (exists) {
      throw new ServiceAlreadyExistsError(serviceId);
    }

    const now = new Date().toISOString();
    const agentId = `service:${serviceId}`;

    // Create service directory
    await this.ensureServiceDir(serviceId);

    // Write manifest
    await this.writeJsonFile(this.getManifestPath(serviceId), manifest);

    // Write config
    const config = initialConfig ?? {};
    await this.writeJsonFile(this.getConfigPath(serviceId), config);

    // Write initial state
    const state: ServiceStateFile = {
      serviceId,
      state: "pending",
      stateHistory: [],
      createdAt: now,
      updatedAt: now,
      executionStats: {
        totalRuns: 0,
        successfulRuns: 0,
        failedRuns: 0,
      },
    };
    await this.saveState(state);

    // Write initial refs
    const refs: ServiceRefsFile = {
      serviceId,
      agentId,
    };
    await this.saveRefs(refs);

    // Build and return service instance
    const service: ServiceInstance = {
      id: serviceId,
      manifest,
      state: "pending",
      stateHistory: [],
      config,
      createdAt: now,
      updatedAt: now,
      executionStats: state.executionStats,
      runtimeRefs: refs,
    };

    // Update index
    await this.updateIndexEntry(service);

    return service;
  }

  /**
   * Unregister (delete) a service
   * @param serviceId - Service identifier
   * @throws ServiceNotFoundError if service doesn't exist
   */
  async unregister(serviceId: string): Promise<void> {
    const exists = await this.fileExists(this.getManifestPath(serviceId));
    if (!exists) {
      throw new ServiceNotFoundError(serviceId);
    }

    // Remove service directory
    const serviceDir = this.getServiceDir(serviceId);
    await this.deps.fs.rm(serviceDir, { recursive: true, force: true });

    // Update index
    await this.removeIndexEntry(serviceId);
    this.invalidateCache();
  }

  /**
   * Get a service by ID
   * @param serviceId - Service identifier
   * @returns Service instance or undefined if not found
   */
  async get(serviceId: string): Promise<ServiceInstance | undefined> {
    const manifest = await this.readJsonFile<ServiceManifest>(this.getManifestPath(serviceId));
    if (!manifest) {
      return undefined;
    }

    const [config, state, refs] = await Promise.all([
      this.readJsonFile<ServiceConfig>(this.getConfigPath(serviceId)),
      this.loadState(serviceId),
      this.loadRefs(serviceId),
    ]);

    if (!state) {
      return undefined;
    }

    return {
      id: serviceId,
      manifest,
      config: config ?? {},
      state: state.state,
      stateHistory: state.stateHistory ?? [],
      createdAt: state.createdAt,
      updatedAt: state.updatedAt,
      executionStats: state.executionStats,
      lastRunAt: state.lastRunAt,
      nextRunAt: state.nextRunAt,
      runtimeRefs: refs ?? { agentId: `service:${serviceId}` },
    };
  }

  /**
   * Check if a service exists
   * @param serviceId - Service identifier
   * @returns True if service exists
   */
  async exists(serviceId: string): Promise<boolean> {
    return this.fileExists(this.getManifestPath(serviceId));
  }

  // ---------------------------------------------------------------------------
  // State Transitions
  // ---------------------------------------------------------------------------

  /**
   * Update service state
   * @param serviceId - Service identifier
   * @param newState - New state to transition to
   * @param reason - Optional reason for the transition
   * @throws ServiceNotFoundError if service doesn't exist
   * @throws InvalidStateTransitionError if transition is invalid
   */
  async updateState(serviceId: string, newState: ServiceState, reason?: string): Promise<void> {
    const state = await this.loadState(serviceId);
    if (!state) {
      throw new ServiceNotFoundError(serviceId);
    }

    const currentState = state.state;

    // Validate state transition
    if (!this.isValidStateTransition(currentState, newState)) {
      throw new InvalidStateTransitionError(currentState, newState);
    }

    // Record transition
    const transition: StateTransition = {
      from: currentState,
      to: newState,
      timestamp: new Date().toISOString(),
      reason,
    };

    state.state = newState;
    state.stateHistory.push(transition);
    state.updatedAt = new Date().toISOString();

    await this.saveState(state);

    // Update index if state changed
    if (currentState !== newState) {
      const index = await this.loadIndex();
      const entry = index.services.find((s) => s.id === serviceId);
      if (entry) {
        entry.state = newState;
        entry.updatedAt = state.updatedAt;
        await this.saveIndex(index);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Configuration
  // ---------------------------------------------------------------------------

  /**
   * Update service configuration
   * @param serviceId - Service identifier
   * @param config - New configuration (merged with existing)
   * @throws ServiceNotFoundError if service doesn't exist
   */
  async updateConfig(serviceId: string, config: ServiceConfig): Promise<void> {
    const exists = await this.fileExists(this.getManifestPath(serviceId));
    if (!exists) {
      throw new ServiceNotFoundError(serviceId);
    }

    const currentConfig =
      (await this.readJsonFile<ServiceConfig>(this.getConfigPath(serviceId))) ?? {};

    const mergedConfig = { ...currentConfig, ...config };
    await this.writeJsonFile(this.getConfigPath(serviceId), mergedConfig);

    // Update timestamp
    const state = await this.loadState(serviceId);
    if (state) {
      state.updatedAt = new Date().toISOString();
      await this.saveState(state);

      // Update index
      const index = await this.loadIndex();
      const entry = index.services.find((s) => s.id === serviceId);
      if (entry) {
        entry.updatedAt = state.updatedAt;
        await this.saveIndex(index);
      }
    }
  }

  /**
   * Get service configuration
   * @param serviceId - Service identifier
   * @returns Configuration object or undefined if not found
   */
  async getConfig(serviceId: string): Promise<ServiceConfig | undefined> {
    return this.readJsonFile<ServiceConfig>(this.getConfigPath(serviceId)) ?? {};
  }

  /**
   * Validate configuration against manifest schema
   * @param serviceId - Service identifier
   * @param config - Configuration to validate (defaults to current config)
   * @returns Validation result
   */
  async validateConfig(serviceId: string, config?: ServiceConfig): Promise<ValidationResult> {
    const manifest = await this.readJsonFile<ServiceManifest>(this.getManifestPath(serviceId));
    if (!manifest) {
      return {
        valid: false,
        errors: [`Service not found: ${serviceId}`],
        warnings: [],
      };
    }

    const configToValidate = config ?? (await this.getConfig(serviceId)) ?? {};
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check required fields
    for (const [key, field] of Object.entries(manifest.config)) {
      if (field.required && !(key in configToValidate)) {
        errors.push(`Missing required config field: ${key}`);
      }
    }

    // Type validation (basic)
    for (const [key, value] of Object.entries(configToValidate)) {
      const field = manifest.config[key];
      if (!field) {
        warnings.push(`Unknown config field: ${key}`);
        continue;
      }

      const expectedType = field.type;
      const actualType = Array.isArray(value) ? "array" : typeof value;

      if (expectedType !== actualType && expectedType !== "secret") {
        errors.push(`Invalid type for ${key}: expected ${expectedType}, got ${actualType}`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  // ---------------------------------------------------------------------------
  // Runtime References
  // ---------------------------------------------------------------------------

  /**
   * Update runtime references for a service
   * @param serviceId - Service identifier
   * @param refs - Partial refs to update (merged with existing)
   * @throws ServiceNotFoundError if service doesn't exist
   */
  async updateRuntimeRefs(serviceId: string, refs: Partial<ServiceRuntimeRefs>): Promise<void> {
    const exists = await this.fileExists(this.getManifestPath(serviceId));
    if (!exists) {
      throw new ServiceNotFoundError(serviceId);
    }

    const currentRefs = (await this.loadRefs(serviceId)) ?? {
      serviceId,
      agentId: `service:${serviceId}`,
    };

    const mergedRefs: ServiceRefsFile = {
      ...currentRefs,
      ...refs,
      serviceId,
    };

    await this.saveRefs(mergedRefs);
  }

  /**
   * Get runtime references for a service
   * @param serviceId - Service identifier
   * @returns Runtime refs or undefined if not found
   */
  async getRuntimeRefs(serviceId: string): Promise<ServiceRuntimeRefs | undefined> {
    return this.loadRefs(serviceId) ?? undefined;
  }

  // ---------------------------------------------------------------------------
  // Execution Statistics
  // ---------------------------------------------------------------------------

  /**
   * Record a successful execution
   * @param serviceId - Service identifier
   * @throws ServiceNotFoundError if service doesn't exist
   */
  async recordSuccess(serviceId: string): Promise<void> {
    const state = await this.loadState(serviceId);
    if (!state) {
      throw new ServiceNotFoundError(serviceId);
    }

    state.executionStats.totalRuns++;
    state.executionStats.successfulRuns++;
    state.lastRunAt = new Date().toISOString();
    state.updatedAt = state.lastRunAt;

    await this.saveState(state);
  }

  /**
   * Record a failed execution
   * @param serviceId - Service identifier
   * @param error - Error that occurred
   * @throws ServiceNotFoundError if service doesn't exist
   */
  async recordFailure(serviceId: string, error: Error): Promise<void> {
    const state = await this.loadState(serviceId);
    if (!state) {
      throw new ServiceNotFoundError(serviceId);
    }

    state.executionStats.totalRuns++;
    state.executionStats.failedRuns++;
    state.lastRunAt = new Date().toISOString();
    state.updatedAt = state.lastRunAt;
    state.executionStats.lastError = {
      message: error.message,
      timestamp: state.lastRunAt,
      stack: error.stack,
    };

    await this.saveState(state);
  }

  /**
   * Update next scheduled run time
   * @param serviceId - Service identifier
   * @param nextRunAt - ISO timestamp of next run
   * @throws ServiceNotFoundError if service doesn't exist
   */
  async updateNextRun(serviceId: string, nextRunAt: string): Promise<void> {
    const state = await this.loadState(serviceId);
    if (!state) {
      throw new ServiceNotFoundError(serviceId);
    }

    state.nextRunAt = nextRunAt;
    state.updatedAt = new Date().toISOString();

    await this.saveState(state);
  }

  // ---------------------------------------------------------------------------
  // Listing and Querying
  // ---------------------------------------------------------------------------

  /**
   * List all services with optional filtering
   * @param opts - Filter options
   * @returns Array of service instances (lightweight - only index data)
   */
  async list(opts: ListServicesOptions = {}): Promise<ServiceIndexEntry[]> {
    const index = await this.loadIndex();
    let services = index.services;

    if (opts.state) {
      services = services.filter((s) => s.state === opts.state);
    }

    if (opts.category) {
      services = services.filter((s) => s.category === opts.category);
    }

    if (opts.triggerType) {
      services = services.filter((s) => s.triggerType === opts.triggerType);
    }

    if (opts.search) {
      const search = opts.search.toLowerCase();
      services = services.filter(
        (s) => s.id.toLowerCase().includes(search) || s.name.toLowerCase().includes(search),
      );
    }

    return services;
  }

  /**
   * Get services by state
   * @param state - State to filter by
   * @returns Array of service index entries
   */
  async getByState(state: ServiceState): Promise<ServiceIndexEntry[]> {
    return this.list({ state });
  }

  /**
   * Get all services (full instances)
   * @returns Array of full service instances
   */
  async getAll(): Promise<ServiceInstance[]> {
    const index = await this.loadIndex();
    const services: ServiceInstance[] = [];

    for (const entry of index.services) {
      const service = await this.get(entry.id);
      if (service) {
        services.push(service);
      }
    }

    return services;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle Helpers
  // ---------------------------------------------------------------------------

  /**
   * Enable a service (transition to enabled state)
   * @param serviceId - Service identifier
   * @throws ServiceNotFoundError if service doesn't exist
   */
  async enable(serviceId: string): Promise<void> {
    await this.updateState(serviceId, "enabled", "User enabled service");
  }

  /**
   * Disable a service (transition to disabled state)
   * @param serviceId - Service identifier
   * @throws ServiceNotFoundError if service doesn't exist
   */
  async disable(serviceId: string): Promise<void> {
    await this.updateState(serviceId, "disabled", "User disabled service");
  }

  /**
   * Mark service as installing
   * @param serviceId - Service identifier
   * @throws ServiceNotFoundError if service doesn't exist
   */
  async markInstalling(serviceId: string): Promise<void> {
    await this.updateState(serviceId, "installing", "Installation started");
  }

  /**
   * Mark service as installed
   * @param serviceId - Service identifier
   * @throws ServiceNotFoundError if service doesn't exist
   */
  async markInstalled(serviceId: string): Promise<void> {
    await this.updateState(serviceId, "installed", "Installation completed");
  }

  /**
   * Mark service as having an error
   * @param serviceId - Service identifier
   * @param errorMessage - Error message
   * @throws ServiceNotFoundError if service doesn't exist
   */
  async markError(serviceId: string, errorMessage: string): Promise<void> {
    await this.updateState(serviceId, "error", errorMessage);
  }

  // ---------------------------------------------------------------------------
  // State Persistence and Recovery
  // ---------------------------------------------------------------------------

  /**
   * Recover registry state from disk
   * Rebuilds index from service directories if needed
   */
  async recover(): Promise<void> {
    this.invalidateCache();

    try {
      await this.ensureServicesDir();
      const entries = await this.deps.fs.readdir(this.deps.servicesDir, {
        withFileTypes: true,
      });

      const index: ServiceRegistryIndex = { version: 1, services: [] };

      for (const entry of entries) {
        if (!entry.isDirectory()) {
          continue;
        }

        const serviceId = entry.name;
        const manifest = await this.readJsonFile<ServiceManifest>(this.getManifestPath(serviceId));
        const state = await this.loadState(serviceId);

        if (manifest && state) {
          index.services.push({
            id: serviceId,
            name: manifest.name,
            state: state.state,
            triggerType: manifest.trigger.type,
            category: manifest.category,
            updatedAt: state.updatedAt,
          });
        }
      }

      await this.saveIndex(index);
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code !== "ENOENT") {
        throw err;
      }
    }
  }

  /**
   * Get registry statistics
   * @returns Statistics about the registry
   */
  async getStats(): Promise<{
    totalServices: number;
    byState: Record<ServiceState, number>;
    byCategory: Record<string, number>;
    byTriggerType: Record<string, number>;
  }> {
    const index = await this.loadIndex();

    const byState: Record<string, number> = {};
    const byCategory: Record<string, number> = {};
    const byTriggerType: Record<string, number> = {};

    for (const service of index.services) {
      byState[service.state] = (byState[service.state] ?? 0) + 1;
      byCategory[service.category ?? "custom"] =
        (byCategory[service.category ?? "custom"] ?? 0) + 1;
      byTriggerType[service.triggerType] = (byTriggerType[service.triggerType] ?? 0) + 1;
    }

    return {
      totalServices: index.services.length,
      byState: byState as Record<ServiceState, number>,
      byCategory,
      byTriggerType,
    };
  }

  /**
   * Clear the entire registry (use with caution - mainly for testing)
   */
  async clear(): Promise<void> {
    try {
      await this.deps.fs.rm(this.deps.servicesDir, { recursive: true, force: true });
    } catch {
      // best-effort
    }
    this.indexCache = null;
    this.indexCacheValid = false;
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let defaultRegistry: ServiceRegistry | null = null;

/**
 * Get the default ServiceRegistry instance
 * @returns ServiceRegistry singleton
 */
export function getServiceRegistry(): ServiceRegistry {
  if (!defaultRegistry) {
    defaultRegistry = new ServiceRegistry();
  }
  return defaultRegistry;
}

/**
 * Reset the default registry instance (mainly for testing)
 */
export function resetServiceRegistry(): void {
  defaultRegistry = null;
}

/**
 * Set a custom default registry (mainly for testing)
 * @param registry - Registry to use as default
 */
export function setServiceRegistry(registry: ServiceRegistry): void {
  defaultRegistry = registry;
}

export default ServiceRegistry;
