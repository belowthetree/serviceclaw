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
import { getServiceRegistry, type ServiceState } from "../services/registry.js";
import type { ServiceManifest, ServiceConfig } from "../services/schema.js";
import { isServiceManifest } from "../services/schema.js";
import { renderTable } from "../terminal/table.js";
import { theme } from "../terminal/theme.js";
import { resolveUserPath } from "../utils.js";
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
 * Format a service state with appropriate color
 */
function formatState(state: ServiceState): string {
  switch (state) {
    case "enabled":
      return theme.success(state);
    case "disabled":
      return theme.warn(state);
    case "error":
    case "validation_error":
    case "install_error":
      return theme.error(state);
    case "pending":
    case "validating":
    case "installing":
    case "installed":
      return theme.accent(state);
    case "uninstalling":
      return theme.muted(state);
    default:
      return state;
  }
}

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
): Promise<{ manifest: ServiceManifest; tempDir: string } | null> {
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

    // Look for service.json in the cloned repo
    const manifestPath = path.join(tempDir, "service.json");
    const manifest = await loadManifestFromPath(manifestPath);

    if (!manifest) {
      // Try alternative locations
      const altPaths = [
        path.join(tempDir, "manifest.json"),
        path.join(tempDir, "service", "service.json"),
        path.join(tempDir, "src", "service.json"),
      ];

      for (const altPath of altPaths) {
        const altManifest = await loadManifestFromPath(altPath);
        if (altManifest) {
          return { manifest: altManifest, tempDir };
        }
      }
    }

    if (!manifest) {
      await fs.rm(tempDir, { recursive: true, force: true });
      return null;
    }

    return { manifest, tempDir };
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
 * Get service logs (placeholder - would integrate with actual logging system)
 */
async function getServiceLogs(_serviceId: string, _options: ServiceLogsOptions): Promise<string[]> {
  // This is a placeholder implementation
  // In a real implementation, this would read from:
  // - ~/.openclaw/services/{serviceId}/logs/
  // - Or query the gateway's logging system
  return ["Logs feature requires gateway integration"];
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
    State: formatState(service.state),
    Trigger: String(service.triggerType ?? ""),
    Updated: formatDate(service.updatedAt),
  }));

  defaultRuntime.log(
    renderTable({
      width: tableWidth,
      columns: [
        { key: "ID", header: "ID", minWidth: 16, flex: true },
        { key: "Name", header: "Name", minWidth: 20, flex: true },
        { key: "State", header: "State", minWidth: 12 },
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
    for (const [state, count] of Object.entries(stats.byState)) {
      defaultRuntime.log(`  ${formatState(state as ServiceState)}: ${count}`);
    }
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

  // Determine if it's a git URL or local path
  if (isGitUrl(source)) {
    const result = await cloneGitRepoAndLoadManifest(source, "Installing service");
    if (!result) {
      defaultRuntime.error(`Could not find service.json in cloned repository: ${source}`);
      process.exit(1);
    }
    manifest = result.manifest;
    tempDir = result.tempDir;
  } else {
    // Local path
    const resolvedPath = resolveUserPath(source);

    // Check if it's a file or directory
    const stats = await fs.stat(resolvedPath).catch(() => null);
    if (!stats) {
      defaultRuntime.error(`Path not found: ${source}`);
      process.exit(1);
    }

    let manifestPath: string;
    if (stats.isDirectory()) {
      manifestPath = path.join(resolvedPath, "service.json");
    } else {
      manifestPath = resolvedPath;
    }

    manifest = await loadManifestFromPath(manifestPath);

    if (!manifest) {
      defaultRuntime.error(`Invalid service manifest at: ${manifestPath}`);
      defaultRuntime.error("Make sure the file exists and contains a valid service.json schema.");
      process.exit(1);
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
      { label: `Installing service: ${manifest.name}...`, indeterminate: true },
      async () => {
        return await registry.register(manifest, config);
      },
    );

    defaultRuntime.log(`${theme.success("✓")} Installed service: ${theme.command(service.id)}`);
    defaultRuntime.log(`  Name: ${service.manifest.name}`);
    defaultRuntime.log(`  Description: ${service.manifest.description}`);
    defaultRuntime.log(`  Trigger: ${service.manifest.trigger?.type ?? "none"}`);

    // Enable if requested
    if (options.enable) {
      await registry.enable(service.id);
      defaultRuntime.log(`  State: ${theme.success("enabled")}`);
    } else {
      defaultRuntime.log(`  State: ${theme.warn("disabled")} (use --enable to enable immediately)`);
    }

    defaultRuntime.log("");
    defaultRuntime.log(`Use 'serviceclaw service enable ${service.id}' to enable this service.`);
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

  if (service.state === "enabled") {
    defaultRuntime.log(`Service ${theme.command(serviceId)} is already enabled.`);
    return;
  }

  try {
    await registry.enable(serviceId);
    defaultRuntime.log(`${theme.success("✓")} Enabled service: ${theme.command(serviceId)}`);
  } catch (error) {
    defaultRuntime.error(
      `Failed to enable service: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  }
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

  if (service.state === "disabled") {
    defaultRuntime.log(`Service ${theme.command(serviceId)} is already disabled.`);
    return;
  }

  try {
    await registry.disable(serviceId);
    defaultRuntime.log(`${theme.success("✓")} Disabled service: ${theme.command(serviceId)}`);
  } catch (error) {
    defaultRuntime.error(
      `Failed to disable service: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  }
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
  lines.push(`${theme.muted("State:")} ${formatState(service.state)}`);
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

  if (service.stateHistory.length > 0) {
    lines.push("");
    lines.push(theme.muted("State History (last 5):"));
    for (const transition of service.stateHistory.slice(-5)) {
      const arrow = theme.muted("→");
      lines.push(
        `  ${transition.from} ${arrow} ${formatState(transition.to)} ${theme.muted(formatDate(transition.timestamp))}`,
      );
    }
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
    .option("-e, --enable", "Enable the service immediately after installation", false)
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
    .option("-n, --lines <number>", "Number of lines to show", "50")
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
  formatState,
  formatDate,
  parseConfigOption,
  isGitUrl,
  loadManifestFromPath,
};
