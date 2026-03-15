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

import { exec } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import JSON5 from "json5";
import { CONFIG_DIR } from "../utils.js";
import type {
  ServiceManifest,
  ServiceConfig,
  ServiceCategory,
  TriggerType,
  ServiceType,
} from "./schema.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import { isDeclarativeService } from "./schema.js";

const execAsync = promisify(exec);

// =============================================================================
// Types
// =============================================================================

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
  /** Service type: traditional or declarative */
  serviceType: ServiceType;
}

/** Registry index entry for fast lookup */
export interface ServiceIndexEntry {
  id: string;
  name: string;
  triggerType: TriggerType;
  category?: ServiceCategory;
  updatedAt: string;
}

/** Registry index file structure */
export interface ServiceRegistryIndex {
  version: 1;
  services: ServiceIndexEntry[];
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

// =============================================================================
// Constants
// =============================================================================

export const DEFAULT_SERVICES_DIR = path.join(CONFIG_DIR, "services");
/** @deprecated Index file is no longer used. Kept for backward compatibility. */
export const INDEX_FILENAME = "index.json";
export const MANIFEST_FILENAME = "manifest.json";
export const CONFIG_FILENAME = "config.json";
export const STATE_FILENAME = "state.json";
export const REFS_FILENAME = "refs.json";

// =============================================================================
// ServiceRegistry Class
// =============================================================================

export interface ServiceRegistryDeps {
  fs: typeof fs;
  servicesDir: string;
}

export class ServiceRegistry {
  private deps: ServiceRegistryDeps;

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

  /** @deprecated Index file is no longer used. Kept for backward compatibility. */
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

  private async scanServiceDirectories(): Promise<
    Array<{ serviceId: string; manifest: ServiceManifest | null }>
  > {
    const results: Array<{ serviceId: string; manifest: ServiceManifest | null }> = [];

    try {
      await this.ensureServicesDir();
      const entries = await this.deps.fs.readdir(this.deps.servicesDir, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith(".")) {
          continue;
        }
        if (this.shouldSkipDirectory(entry.name)) {
          continue;
        }

        const serviceId = entry.name;
        const manifest = await this.readJsonFile<ServiceManifest>(
          this.getManifestPath(serviceId),
        ).catch(() => null);
        results.push({ serviceId, manifest });
      }
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === "ENOENT") {
        return [];
      }
      throw err;
    }

    return results;
  }

  private shouldSkipDirectory(dirName: string): boolean {
    const normalized = dirName.toLowerCase();
    const skipPatterns = ["node_modules", "dist", "build", "__tests__", "__mocks__"];
    return skipPatterns.some((p) => normalized === p || normalized.includes(p));
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
   * @param sourcePath - Optional source path to copy service files from
   * @returns The created service instance
   * @throws ServiceAlreadyExistsError if service already exists
   */
  async register(
    manifest: ServiceManifest,
    initialConfig?: ServiceConfig,
    sourcePath?: string,
  ): Promise<ServiceInstance> {
    const serviceId = manifest.id;

    // Check if service already exists
    const exists = await this.fileExists(this.getManifestPath(serviceId));
    if (exists) {
      throw new ServiceAlreadyExistsError(serviceId);
    }

    // Detect service type
    const serviceType: ServiceType = isDeclarativeService(manifest) ? "declarative" : "traditional";

    const now = new Date().toISOString();
    const agentId = `service:${serviceId}`;

    // Create service directory
    await this.ensureServiceDir(serviceId);

    // Copy service files from source if provided
    if (sourcePath) {
      await this.copyServiceFiles(sourcePath, serviceId);
      // Install dependencies after copying (only for traditional services)
      await this.installDependencies(serviceId, serviceType);
    }

    // Write manifest
    await this.writeJsonFile(this.getManifestPath(serviceId), manifest);

    // Write config
    const config = initialConfig ?? {};
    await this.writeJsonFile(this.getConfigPath(serviceId), config);

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
      config,
      createdAt: now,
      updatedAt: now,
      executionStats: {
        totalRuns: 0,
        successfulRuns: 0,
        failedRuns: 0,
      },
      runtimeRefs: refs,
      serviceType,
    };

    return service;
  }

  /**
   * Copy service files from source directory
   * @param sourcePath - Source directory path
   * @param serviceId - Service identifier
   */
  private async copyServiceFiles(sourcePath: string, serviceId: string): Promise<void> {
    const targetPath = this.getServiceDir(serviceId);

    // Files and directories to skip
    const skipList = new Set([".git", "node_modules", "dist", ".openclaw"]);

    async function copyDir(src: string, dest: string, fsImpl: typeof fs): Promise<void> {
      await fsImpl.mkdir(dest, { recursive: true });

      const entries = await fsImpl.readdir(src, { withFileTypes: true });

      for (const entry of entries) {
        if (skipList.has(entry.name)) {
          continue;
        }

        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);

        if (entry.isDirectory()) {
          await copyDir(srcPath, destPath, fsImpl);
        } else {
          await fsImpl.copyFile(srcPath, destPath);
        }
      }
    }

    await copyDir(sourcePath, targetPath, this.deps.fs);
  }

  /**
   * Install npm dependencies for a service
   * @param serviceId - Service identifier
   * @param serviceType - Type of service (traditional or declarative)
   */
  private async installDependencies(serviceId: string, serviceType: ServiceType): Promise<void> {
    // Skip npm install for declarative services
    if (serviceType === "declarative") {
      return;
    }

    const serviceDir = this.getServiceDir(serviceId);
    const packageJsonPath = path.join(serviceDir, "package.json");

    // Check if package.json exists
    const hasPackageJson = await this.fileExists(packageJsonPath);
    if (!hasPackageJson) {
      return;
    }

    try {
      await execAsync("npm install --production", {
        cwd: serviceDir,
        timeout: 120000,
      });

      // Create symlink for @openclaw/service-sdk if it uses file: protocol
      const packageJson = await this.readJsonFile<{ dependencies?: Record<string, string> }>(
        packageJsonPath,
      );
      const sdkPath = packageJson?.dependencies?.["@openclaw/service-sdk"];

      if (sdkPath?.startsWith("file:")) {
        // Remove the broken symlink/npm installed version
        const sdkNodePath = path.join(serviceDir, "node_modules", "@openclaw", "service-sdk");
        await this.deps.fs.rm(sdkNodePath, { recursive: true, force: true }).catch(() => undefined);

        // Ensure @openclaw directory exists
        const openclawDir = path.join(serviceDir, "node_modules", "@openclaw");
        await this.deps.fs.mkdir(openclawDir, { recursive: true });

        // Try multiple possible locations for the SDK
        const possibleSdkPaths = [
          // From current file (works in dev mode)
          path.resolve(__dirname, "..", "..", "packages", "service-sdk"),
          // From process.cwd() (when running from project root)
          path.join(process.cwd(), "packages", "service-sdk"),
          // From OPENCLAW_ROOT environment variable
          process.env.OPENCLAW_ROOT
            ? path.join(process.env.OPENCLAW_ROOT, "packages", "service-sdk")
            : null,
          // Common development paths
          "/home/zgg/project/serviceclaw/packages/service-sdk",
          path.join(require("os").homedir(), "project", "serviceclaw", "packages", "service-sdk"),
        ].filter(Boolean) as string[];

        // Find the first existing SDK path
        let sdkTarget: string | null = null;
        for (const tryPath of possibleSdkPaths) {
          try {
            await this.deps.fs.access(tryPath);
            sdkTarget = tryPath;
            console.log(`[registry] Found service-sdk at: ${tryPath}`);
            break;
          } catch {
            // Path doesn't exist, try next
          }
        }

        if (sdkTarget) {
          // Create symlink
          await this.deps.fs.symlink(sdkTarget, sdkNodePath, "dir").catch((err) => {
            console.warn(`[registry] Failed to create symlink: ${err}`);
          });
        } else {
          console.warn(
            `[registry] Could not find @openclaw/service-sdk. Tried: ${possibleSdkPaths.join(", ")}`,
          );
        }
      }
    } catch (error) {
      // Log error but don't fail installation - service might work without npm install
      console.warn(`[registry] Failed to install dependencies for ${serviceId}:`, error);
    }
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

    const [config, refs] = await Promise.all([
      this.readJsonFile<ServiceConfig>(this.getConfigPath(serviceId)),
      this.loadRefs(serviceId),
    ]);

    // Detect service type from manifest
    const serviceType: ServiceType = isDeclarativeService(manifest) ? "declarative" : "traditional";

    return {
      id: serviceId,
      manifest,
      config: config ?? {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      executionStats: {
        totalRuns: 0,
        successfulRuns: 0,
        failedRuns: 0,
      },
      runtimeRefs: refs ?? { agentId: `service:${serviceId}` },
      serviceType,
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
  }

  /**
   * Get service configuration
   * @param serviceId - Service identifier
   * @returns Configuration object or undefined if not found
   */
  async getConfig(serviceId: string): Promise<ServiceConfig | null> {
    return this.readJsonFile<ServiceConfig>(this.getConfigPath(serviceId));
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
  async getRuntimeRefs(serviceId: string): Promise<ServiceRefsFile | null> {
    return this.loadRefs(serviceId);
  }

  // ---------------------------------------------------------------------------
  // Execution Statistics
  // ---------------------------------------------------------------------------

  // ---------------------------------------------------------------------------
  // Listing and Querying
  // ---------------------------------------------------------------------------

  /**
   * List all services with optional filtering
   * @param opts - Filter options
   * @returns Array of service instances (lightweight - only index data)
   */
  async list(opts: ListServicesOptions = {}): Promise<ServiceIndexEntry[]> {
    const scannedServices = await this.scanServiceDirectories();

    // Convert scanned results to ServiceIndexEntry format
    let services: ServiceIndexEntry[] = scannedServices
      .filter((s) => s.manifest !== null) // Only include services with valid manifests
      .map((s) => ({
        id: s.serviceId,
        name: s.manifest!.name,
        triggerType: s.manifest!.trigger?.type ?? "webhook",
        category: s.manifest!.category,
        updatedAt: new Date().toISOString(),
      }));

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
   * Get all services (full instances)
   * @returns Array of full service instances
   */
  async getAll(): Promise<ServiceInstance[]> {
    const entries = await this.scanServiceDirectories();
    const services: ServiceInstance[] = [];

    for (const entry of entries) {
      // Skip if manifest is null (invalid service)
      if (!entry.manifest) {
        continue;
      }

      const service = await this.get(entry.serviceId);
      if (service) {
        services.push(service);
      }
    }

    return services;
  }

  // ---------------------------------------------------------------------------
  // State Persistence and Recovery
  // ---------------------------------------------------------------------------

  /**
   * Recover registry state from disk
   * @deprecated This method is kept for backward compatibility. Index file is no longer used.
   */
  async recover(): Promise<void> {
    // No-op: Index file is no longer used
  }

  /**
   * Get registry statistics
   * @returns Statistics about the registry
   */
  async getStats(): Promise<{
    totalServices: number;
    byCategory: Record<string, number>;
    byTriggerType: Record<string, number>;
  }> {
    const entries = await this.scanServiceDirectories();

    const byCategory: Record<string, number> = {};
    const byTriggerType: Record<string, number> = {};

    for (const entry of entries) {
      if (!entry.manifest) {
        continue;
      }

      const category = entry.manifest.category ?? "custom";
      const triggerType = entry.manifest.trigger?.type ?? "webhook";

      byCategory[category] = (byCategory[category] ?? 0) + 1;
      byTriggerType[triggerType] = (byTriggerType[triggerType] ?? 0) + 1;
    }

    return {
      totalServices: entries.filter((e) => e.manifest !== null).length,
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
