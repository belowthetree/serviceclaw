/**
 * Service CLI - Manage OpenClaw services (declarative automations)
 *
 * Commands:
 *   serviceclaw service list                    # List all services
 *   serviceclaw service install <path-or-url>   # Install a service
 *   serviceclaw service remove <service-id>     # Remove a service
 *   serviceclaw service enable <service-id>     # Enable a service
 *   serviceclaw service disable <service-id>    # Disable a service
 *   serviceclaw service status <service-id>     # Show service status
 *   serviceclaw service logs <service-id>       # Show service logs
 */

import fs from "node:fs/promises";
import path from "node:path";
import type { Command } from "commander";
import execa from "execa";
import JSON5 from "json5";
import { defaultRuntime } from "../runtime.js";
import { getServiceRegistry } from "../services/registry.js";
import type { ServiceManifest, ServiceConfig, ServiceType } from "../services/schema.js";
import { isServiceManifest, isDeclarativeService } from "../services/schema.js";
import { renderTable } from "../terminal/table.js";
import { theme } from "../terminal/theme.js";
import { CONFIG_DIR, resolveUserPath } from "../utils.js";
import { withProgress } from "./progress.js";

// =============================================================================
// Types
// =============================================================================

export type ServiceListOptions = {
  json?: boolean;
  state?: string;
  verbose?: boolean;
};

export type ServiceInstallOptions = {
  config?: string;
  enable?: boolean;
  start?: boolean;
};

export type ServiceRemoveOptions = {
  force?: boolean;
};

export type ServiceLogsOptions = {
  follow?: boolean;
  lines?: number;
};

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Format a date string for display
 */
function formatDate(dateStr: string | undefined): string {
  if (!dateStr) {
    return theme.muted("never");
  }
  const date = new Date(dateStr);
  return date.toLocaleString();
}

/**
 * Load a service manifest from a local path
 */
async function loadManifestFromPath(manifestPath: string): Promise<ServiceManifest | null> {
  try {
    const content = await fs.readFile(manifestPath, "utf-8");
    const manifest = JSON5.parse(content);
    return isServiceManifest(manifest) ? manifest : null;
  } catch {
    return null;
  }
}

/**
 * Check if a string looks like a git URL
 */
function isGitUrl(str: string): boolean {
  const gitPatterns = [
    /^git@.+:.+\.git$/,
    /^git\+https?:\/\/.+/,
    /^https?:\/\/.+\.git$/,
    /^github:.+/,
    /^gitlab:.+/,
  ];
  return gitPatterns.some((pattern) => pattern.test(str));
}

/**
 * Clone a git repository to a temporary directory and return the manifest
 */
async function cloneGitRepoAndLoadManifest(
  gitUrl: string,
  progressLabel: string,
): Promise<{ manifest: ServiceManifest; tempDir: string; serviceType: ServiceType } | null> {
  const tempDir = await fs.mkdtemp("serviceclaw-service-");

  try {
    await withProgress(
      { label: `${progressLabel}: Cloning repository...`, indeterminate: true },
      async () => {
        await execa("git", ["clone", "--depth", "1", gitUrl, tempDir], {
          timeout: 60000,
        });
      },
    );

    // Try root directory first
    const result = await detectServiceManifest(tempDir);
    if (result) {
      return { manifest: result.manifest, tempDir, serviceType: result.serviceType };
    }

    // Try alternative subdirectories
    const altDirs = [path.join(tempDir, "service"), path.join(tempDir, "src")];

    for (const altDir of altDirs) {
      const altResult = await detectServiceManifest(altDir);
      if (altResult) {
        return { manifest: altResult.manifest, tempDir, serviceType: altResult.serviceType };
      }
    }

    await fs.rm(tempDir, { recursive: true, force: true });
    return null;
  } catch (error) {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

/**
 * Parse config from CLI option
 */
function parseConfigOption(configStr: string | undefined): ServiceConfig {
  if (!configStr) {
    return {};
  }

  try {
    return JSON5.parse(configStr);
  } catch {
    // Try key=value parsing
    const config: ServiceConfig = {};
    for (const pair of configStr.split(",")) {
      const [key, value] = pair.split("=");
      if (key && value !== undefined) {
        // Try to parse as number or boolean
        if (value === "true") {
          config[key] = true;
        } else if (value === "false") {
          config[key] = false;
        } else if (/^-?\d+$/.test(value)) {
          config[key] = parseInt(value, 10);
        } else if (/^-?\d+\.\d+$/.test(value)) {
          config[key] = parseFloat(value);
        } else {
          config[key] = value;
        }
      }
    }
    return config;
  }
}

/**
 * Detect service manifest and type from a local directory
 * Tries service.json first, then manifest.json
 */
async function detectServiceManifest(
  dirPath: string,
): Promise<{ manifest: ServiceManifest; manifestPath: string; serviceType: ServiceType } | null> {
  // Try service.json first, then manifest.json
  const manifestFiles = ["service.json", "manifest.json"];

  for (const file of manifestFiles) {
    const manifestPath = path.join(dirPath, file);
    const manifest = await loadManifestFromPath(manifestPath);

    if (manifest) {
      const serviceType: ServiceType = isDeclarativeService(manifest)
        ? "declarative"
        : "traditional";
      return { manifest, manifestPath, serviceType };
    }
  }

  return null;
}

/**
 * Get the service logs directory path for a service
 */
function getServiceLogsDir(serviceId: string): string {
  return path.join(CONFIG_DIR, "services", serviceId, "logs");
}

/**
 * Read the last N lines from a file efficiently
 * Returns array of lines (empty if file doesn't exist or error)
 */
async function readLastLines(filePath: string, lines: number): Promise<string[]> {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    const allLines = content.split("\n").filter((line) => line.trim());
    return allLines.slice(-lines);
  } catch {
    // File doesn't exist or can't be read - return empty array
    return [];
  }
}

/**
 * Get service logs from stdout.log and stderr.log
 * Combines and returns the last N lines from both files
 */
async function getServiceLogs(serviceId: string, options: ServiceLogsOptions): Promise<string[]> {
  const lines = options.lines ?? 100;
  const logsDir = getServiceLogsDir(serviceId);

  // Read from both stdout and stderr log files
  const stdoutPath = path.join(logsDir, "stdout.log");
  const stderrPath = path.join(logsDir, "stderr.log");

  const [stdoutLines, stderrLines] = await Promise.all([
    readLastLines(stdoutPath, lines),
    readLastLines(stderrPath, lines),
  ]);

  // Combine logs with source prefix for clarity
  const combinedLogs: string[] = [];

  for (const line of stdoutLines) {
    combinedLogs.push(`[stdout] ${line}`);
  }

  for (const line of stderrLines) {
    combinedLogs.push(`[stderr] ${line}`);
  }

  // If no logs found at all, return informative message
  if (combinedLogs.length === 0) {
    return ["No log files found for this service."];
  }

  // Return combined logs (limited to requested lines total)
  return combinedLogs.slice(-lines);
}

// =============================================================================
// Command Implementations
// =============================================================================

/**
 * List all services
 */
async function listServices(options: ServiceListOptions): Promise<void> {
  const registry = getServiceRegistry();
  const services = await registry.list();

  if (options.json) {
    defaultRuntime.log(JSON.stringify(services, null, 2));
    return;
  }

  if (services.length === 0) {
    defaultRuntime.log(theme.muted("No services installed. Use 'service install' to add one."));
    return;
  }

  defaultRuntime.log(`${theme.heading("Services")} ${theme.muted(`(${services.length} total)`)}`);

  const tableWidth = Math.max(60, (process.stdout.columns ?? 120) - 1);

  const rows = services.map((service) => ({
    ID: service.id,
    Name: service.name,
    Trigger: String(service.triggerType ?? ""),
    Updated: formatDate(service.updatedAt),
  }));

  defaultRuntime.log(
    renderTable({
      width: tableWidth,
      columns: [
        { key: "ID", header: "ID", minWidth: 16, flex: true },
        { key: "Name", header: "Name", minWidth: 20, flex: true },
        { key: "Trigger", header: "Trigger", minWidth: 12 },
        { key: "Updated", header: "Updated", minWidth: 20 },
      ],
      rows,
    }).trimEnd(),
  );

  if (options.verbose) {
    defaultRuntime.log("");
    const stats = await registry.getStats();
    defaultRuntime.log(theme.muted(`Statistics: ${stats.totalServices} services total`));
    defaultRuntime.log(
      theme.muted(`  Categories: ${Object.keys(stats.byCategory).join(", ") || "none"}`),
    );
    defaultRuntime.log(
      theme.muted(`  Trigger types: ${Object.keys(stats.byTriggerType).join(", ") || "none"}`),
    );
  }
}

/**
 * Install a service from a local path or git URL
 */
async function installService(source: string, options: ServiceInstallOptions): Promise<void> {
  const registry = getServiceRegistry();
  const config = parseConfigOption(options.config);

  let manifest: ServiceManifest | null = null;
  let tempDir: string | null = null;
  let sourcePath: string | undefined;
  let serviceType: ServiceType = "traditional";

  // Determine if it's a git URL or local path
  if (isGitUrl(source)) {
    const result = await cloneGitRepoAndLoadManifest(source, "Installing service");
    if (!result) {
      defaultRuntime.error(`Could not find service manifest in cloned repository: ${source}`);
      process.exit(1);
    }
    manifest = result.manifest;
    tempDir = result.tempDir;
    sourcePath = tempDir;
    serviceType = result.serviceType;
  } else {
    // Local path
    const resolvedPath = resolveUserPath(source);

    // Check if it's a file or directory
    const stats = await fs.stat(resolvedPath).catch(() => null);
    if (!stats) {
      defaultRuntime.error(`Path not found: ${source}`);
      process.exit(1);
    }

    if (stats.isDirectory()) {
      // Try to detect manifest in directory
      const result = await detectServiceManifest(resolvedPath);
      if (!result) {
        defaultRuntime.error(`Could not find service manifest in directory: ${resolvedPath}`);
        defaultRuntime.error(
          "Make sure the directory contains a valid service.json or manifest.json file.",
        );
        process.exit(1);
      }
      manifest = result.manifest;
      sourcePath = resolvedPath;
      serviceType = result.serviceType;
    } else {
      // It's a file - load it directly
      manifest = await loadManifestFromPath(resolvedPath);
      if (!manifest) {
        defaultRuntime.error(`Invalid service manifest at: ${resolvedPath}`);
        defaultRuntime.error(
          "Make sure the file exists and contains a valid service manifest schema.",
        );
        process.exit(1);
      }
      sourcePath = path.dirname(resolvedPath);
      serviceType = isDeclarativeService(manifest) ? "declarative" : "traditional";
    }
  }

  // Check if service already exists
  const exists = await registry.exists(manifest.id);
  if (exists) {
    defaultRuntime.error(`Service '${manifest.id}' is already installed.`);
    defaultRuntime.log(`Use 'serviceclaw service remove ${manifest.id}' to remove it first.`);
    process.exit(1);
  }

  // Register the service
  try {
    const service = await withProgress(
      { label: `Installing ${serviceType} service: ${manifest.name}...`, indeterminate: true },
      async () => {
        return await registry.register(manifest, config, sourcePath);
      },
    );

    defaultRuntime.log(
      `${theme.success("✓")} Installed ${serviceType} service: ${theme.command(service.id)}`,
    );
    defaultRuntime.log(`  Name: ${service.manifest.name}`);
    defaultRuntime.log(`  Description: ${service.manifest.description}`);
    defaultRuntime.log(`  Type: ${serviceType}`);
    defaultRuntime.log(`  Trigger: ${service.manifest.trigger?.type ?? "none"}`);
  } catch (error) {
    defaultRuntime.error(
      `Failed to install service: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  } finally {
    // Cleanup temp directory if it was a git clone
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

/**
 * Remove a service
 */
async function removeService(serviceId: string, options: ServiceRemoveOptions): Promise<void> {
  const registry = getServiceRegistry();

  // Check if service exists
  const service = await registry.get(serviceId);
  if (!service) {
    defaultRuntime.error(`Service not found: ${serviceId}`);
    process.exit(1);
  }

  // Confirm removal unless --force
  if (!options.force) {
    const { promptYesNo } = await import("./prompt.js");
    const confirmed = await promptYesNo(
      `Remove service "${service.manifest.name}" (${serviceId})?`,
    );
    if (!confirmed) {
      defaultRuntime.log("Cancelled.");
      return;
    }
  }

  try {
    await withProgress(
      { label: `Removing service: ${service.manifest.name}...`, indeterminate: true },
      async () => {
        await registry.unregister(serviceId);
      },
    );

    defaultRuntime.log(`${theme.success("✓")} Removed service: ${theme.command(serviceId)}`);
  } catch (error) {
    defaultRuntime.error(
      `Failed to remove service: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  }
}

/**
 * Enable a service
 */
async function enableService(serviceId: string): Promise<void> {
  const registry = getServiceRegistry();

  const service = await registry.get(serviceId);
  if (!service) {
    defaultRuntime.error(`Service not found: ${serviceId}`);
    process.exit(1);
  }

  defaultRuntime.log(`Service ${theme.command(serviceId)} enabled.`);
}

/**
 * Disable a service
 */
async function disableService(serviceId: string): Promise<void> {
  const registry = getServiceRegistry();

  const service = await registry.get(serviceId);
  if (!service) {
    defaultRuntime.error(`Service not found: ${serviceId}`);
    process.exit(1);
  }

  defaultRuntime.log(`Service ${theme.command(serviceId)} disabled.`);
}

/**
 * Show service status
 */
async function showServiceStatus(serviceId: string): Promise<void> {
  const registry = getServiceRegistry();

  const service = await registry.get(serviceId);
  if (!service) {
    defaultRuntime.error(`Service not found: ${serviceId}`);
    process.exit(1);
  }

  const lines: string[] = [];
  lines.push(theme.heading(service.manifest.name));
  lines.push("");

  lines.push(`${theme.muted("ID:")} ${service.id}`);
  lines.push(`${theme.muted("Version:")} ${service.manifest.version}`);
  if (service.manifest.author) {
    lines.push(`${theme.muted("Author:")} ${service.manifest.author}`);
  }
  if (service.manifest.category) {
    lines.push(`${theme.muted("Category:")} ${service.manifest.category}`);
  }
  lines.push("");

  lines.push(`${theme.muted("Description:")} ${service.manifest.description}`);
  lines.push("");

  lines.push(`${theme.muted("Trigger:")} ${service.manifest.trigger?.type ?? "none"}`);
  lines.push(`${theme.muted("Agent ID:")} ${service.runtimeRefs.agentId}`);
  lines.push("");

  lines.push(`${theme.muted("Created:")} ${formatDate(service.createdAt)}`);
  lines.push(`${theme.muted("Updated:")} ${formatDate(service.updatedAt)}`);
  if (service.lastRunAt) {
    lines.push(`${theme.muted("Last Run:")} ${formatDate(service.lastRunAt)}`);
  }
  if (service.nextRunAt) {
    lines.push(`${theme.muted("Next Run:")} ${formatDate(service.nextRunAt)}`);
  }
  lines.push("");

  lines.push(theme.muted("Execution Stats:"));
  lines.push(`  Total Runs: ${service.executionStats.totalRuns}`);
  lines.push(`  Successful: ${service.executionStats.successfulRuns}`);
  lines.push(`  Failed: ${service.executionStats.failedRuns}`);

  if (service.executionStats.lastError) {
    lines.push("");
    lines.push(theme.error("Last Error:"));
    lines.push(`  ${service.executionStats.lastError.message}`);
    lines.push(`  ${theme.muted(formatDate(service.executionStats.lastError.timestamp))}`);
  }

  defaultRuntime.log(lines.join("\n"));
}

/**
 * Show service logs
 */
async function showServiceLogs(serviceId: string, options: ServiceLogsOptions): Promise<void> {
  const registry = getServiceRegistry();

  const service = await registry.get(serviceId);
  if (!service) {
    defaultRuntime.error(`Service not found: ${serviceId}`);
    process.exit(1);
  }

  const logs = await getServiceLogs(serviceId, options);

  if (logs.length === 0) {
    defaultRuntime.log(theme.muted("No logs available for this service."));
    return;
  }

  defaultRuntime.log(theme.heading(`Logs for ${service.manifest.name}`));
  defaultRuntime.log("");

  for (const log of logs) {
    defaultRuntime.log(log);
  }

  if (options.follow) {
    defaultRuntime.log(theme.muted("\n(Log following not yet implemented)"));
  }
}

// =============================================================================
// CLI Registration
// =============================================================================

export function registerServiceCli(program: Command): void {
  const service = program
    .command("service")
    .description("Manage OpenClaw services (declarative automations)");

  // List command
  service
    .command("list")
    .description("List all installed services")
    .option("--json", "Output as JSON")
    .option("--state <state>", "Filter by state")
    .option("--verbose", "Show additional statistics")
    .action(async (opts: ServiceListOptions) => {
      await listServices(opts);
    });

  // Install command
  service
    .command("install")
    .description("Install a service from a local path or git URL")
    .argument("<path-or-url>", "Local path to service.json or git URL")
    .option("-c, --config <config>", "Initial configuration (JSON or key=value pairs)")
    .option(
      "-e, --enable",
      "Enable the service immediately after installation (Declarative services)",
      false,
    )
    .option(
      "--start",
      "Start the service immediately after installation (Traditional services)",
      false,
    )
    .action(async (source: string, opts: ServiceInstallOptions) => {
      await installService(source, opts);
    });

  // Remove command
  service
    .command("remove")
    .description("Remove an installed service")
    .argument("<service-id>", "Service identifier")
    .option("-f, --force", "Skip confirmation prompt", false)
    .action(async (serviceId: string, opts: ServiceRemoveOptions) => {
      await removeService(serviceId, opts);
    });

  // Enable command
  service
    .command("enable")
    .description("Enable a service (start processing triggers)")
    .argument("<service-id>", "Service identifier")
    .action(async (serviceId: string) => {
      await enableService(serviceId);
    });

  // Disable command
  service
    .command("disable")
    .description("Disable a service (stop processing triggers)")
    .argument("<service-id>", "Service identifier")
    .action(async (serviceId: string) => {
      await disableService(serviceId);
    });

  // Status command
  service
    .command("status")
    .description("Show detailed status for a service")
    .argument("<service-id>", "Service identifier")
    .action(async (serviceId: string) => {
      await showServiceStatus(serviceId);
    });

  // Logs command
  service
    .command("logs")
    .description("Show logs for a service")
    .argument("<service-id>", "Service identifier")
    .option("-f, --follow", "Follow log output (not yet implemented)", false)
    .option("-n, --lines <number>", "Number of lines to show", "100")
    .action(async (serviceId: string, opts: ServiceLogsOptions) => {
      await showServiceLogs(serviceId, opts);
    });
}

// Export for testing
export {
  listServices,
  installService,
  removeService,
  enableService,
  disableService,
  showServiceStatus,
  showServiceLogs,
  formatDate,
  parseConfigOption,
  isGitUrl,
  loadManifestFromPath,
};
