import fs from "node:fs/promises";
import path from "node:path";
import type { LoadedService, ServiceDirectory, ServiceManifest } from "./types.js";
import { validateServiceDirectory } from "./validator.js";

const logger = {
  warn: (message: string) => console.warn(`[discovery] ${message}`),
  error: (message: string) => console.error(`[discovery] ${message}`),
};

const scanCache = new Map<string, { timestamp: number; services: ServiceDirectory[] }>();

const DEFAULT_CACHE_TTL_MS = 5000;

const DEFAULT_SERVICES_DIR = path.join(
  process.env.HOME || process.env.USERPROFILE || "",
  ".openclaw",
  "services",
);

export type ScanOptions = {
  cacheTtlMs?: number;
  useCache?: boolean;
};

export type LoadOptions = {
  skipValidation?: boolean;
};

export function clearCache(): void {
  scanCache.clear();
}

function buildCacheKey(rootPath: string): string {
  return path.resolve(rootPath);
}

function isCacheValid(cached: { timestamp: number }, ttlMs: number): boolean {
  return Date.now() - cached.timestamp < ttlMs;
}

export function getDefaultServicesDir(): string {
  return DEFAULT_SERVICES_DIR;
}

export async function scanServices(
  rootPath: string = DEFAULT_SERVICES_DIR,
  options: ScanOptions = {},
): Promise<ServiceDirectory[]> {
  const { cacheTtlMs = DEFAULT_CACHE_TTL_MS, useCache = true } = options;
  const resolvedPath = path.resolve(rootPath);

  if (useCache) {
    const cacheKey = buildCacheKey(resolvedPath);
    const cached = scanCache.get(cacheKey);
    if (cached && isCacheValid(cached, cacheTtlMs)) {
      return cached.services;
    }
  }

  const services: ServiceDirectory[] = [];

  try {
    const stat = await fs.stat(resolvedPath);
    if (!stat.isDirectory()) {
      logger.warn(`Path is not a directory: ${resolvedPath}`);
      return [];
    }
  } catch {
    return [];
  }

  let entries;
  try {
    entries = await fs.readdir(resolvedPath, { withFileTypes: true });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    logger.error(`Failed to read directory: ${errorMessage}`);
    return [];
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) {
      continue;
    }
    if (shouldIgnoreDirectory(entry.name)) {
      continue;
    }

    const servicePath = path.join(resolvedPath, entry.name);

    try {
      const validation = validateServiceDirectory(servicePath);

      if (validation.valid) {
        services.push({
          path: servicePath,
          name: entry.name,
          manifest: validation.manifest,
          valid: true,
        });
      } else {
        services.push({
          path: servicePath,
          name: entry.name,
          valid: false,
          errors: validation.errors,
        });
        logger.warn(`Invalid service "${entry.name}": ${validation.errors?.join(", ")}`);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      services.push({
        path: servicePath,
        name: entry.name,
        valid: false,
        errors: [`Validation error: ${errorMessage}`],
      });
      logger.error(`Error validating service "${entry.name}": ${errorMessage}`);
    }
  }

  if (useCache) {
    const cacheKey = buildCacheKey(resolvedPath);
    scanCache.set(cacheKey, { timestamp: Date.now(), services });
  }

  return services;
}

function shouldIgnoreDirectory(dirName: string): boolean {
  const normalized = dirName.toLowerCase();
  const ignoredPatterns = [
    "node_modules",
    "__tests__",
    "__mocks__",
    "test",
    "tests",
    "dist",
    "build",
  ];
  return ignoredPatterns.some((pattern) => normalized === pattern || normalized.includes(pattern));
}

export async function loadService(
  servicePath: string,
  options: LoadOptions = {},
): Promise<LoadedService> {
  const { skipValidation = false } = options;
  const resolvedPath = path.resolve(servicePath);

  if (!skipValidation) {
    const validation = validateServiceDirectory(resolvedPath);
    if (!validation.valid) {
      throw new Error(`Invalid service at ${resolvedPath}: ${validation.errors?.join(", ")}`);
    }
  }

  const manifestPath = path.join(resolvedPath, "manifest.json");
  let manifest: ServiceManifest;
  try {
    const content = await fs.readFile(manifestPath, "utf-8");
    manifest = JSON.parse(content) as ServiceManifest;
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to read manifest.json: ${errorMessage}`, { cause: err });
  }

  if (!manifest.id || !manifest.name || !manifest.version) {
    throw new Error("Manifest is missing required fields (id, name, version)");
  }

  const entryPath = path.join(resolvedPath, manifest.entry);
  let serviceModule: unknown;
  try {
    serviceModule = await import(entryPath);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to load entry module "${manifest.entry}": ${errorMessage}`, { cause: err });
  }

  return {
    manifest,
    path: resolvedPath,
    state: "active",
    module: serviceModule,
  };
}

export async function getValidServices(
  rootPath: string = DEFAULT_SERVICES_DIR,
  options: ScanOptions = {},
): Promise<Array<ServiceDirectory & { valid: true; manifest: ServiceManifest }>> {
  const services = await scanServices(rootPath, options);
  return services.filter(
    (s): s is ServiceDirectory & { valid: true; manifest: ServiceManifest } =>
      s.valid && s.manifest !== undefined,
  );
}

export async function isValidService(servicePath: string): Promise<boolean> {
  try {
    const validation = validateServiceDirectory(servicePath);
    return validation.valid;
  } catch {
    return false;
  }
}

export type { LoadedService, ServiceDirectory, ServiceManifest };
