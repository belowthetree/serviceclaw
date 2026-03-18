import type { Dirent } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { CronPattern } from "croner";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { CronTaskConfigSchema, type CronTaskConfig } from "./schema.js";

const logger = createSubsystemLogger("services:cron-loader");

/**
 * Validates a cron expression using the croner library.
 * @param expression - The cron expression to validate (e.g., "0 2 * * *")
 * @returns true if the expression is valid, false otherwise
 */
export function validateCronExpression(expression: string): boolean {
  if (!expression || typeof expression !== "string") {
    return false;
  }

  const trimmed = expression.trim();
  if (!trimmed) {
    return false;
  }

  try {
    // CronPattern constructor throws on invalid patterns
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const _pattern = new CronPattern(trimmed);
    return true;
  } catch {
    return false;
  }
}

/**
 * Loads and validates a single cron task configuration from a JSON file.
 * @param filePath - Absolute path to the JSON configuration file
 * @returns The validated CronTaskConfig if successful, null if invalid or malformed
 */
export async function loadCronTaskConfig(filePath: string): Promise<CronTaskConfig | null> {
  const fileName = path.basename(filePath);

  try {
    const content = await fs.readFile(filePath, "utf-8");
    let parsed: unknown;

    try {
      parsed = JSON.parse(content);
    } catch (parseError) {
      const errorMsg = parseError instanceof Error ? parseError.message : String(parseError);
      logger.warn(`Skipping malformed JSON file ${fileName}: ${errorMsg}`);
      return null;
    }

    // Validate against schema
    const schemaResult = CronTaskConfigSchema.safeParse(parsed);
    if (!schemaResult.success) {
      const errors = schemaResult.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join(", ");
      logger.warn(`Skipping invalid cron config ${fileName}: ${errors}`);
      return null;
    }

    const config = schemaResult.data;

    // Validate cron expression
    if (!validateCronExpression(config.schedule)) {
      logger.warn(`Skipping cron config ${fileName}: invalid cron expression "${config.schedule}"`);
      return null;
    }

    return config;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.warn(`Failed to load cron config ${fileName}: ${errorMsg}`);
    return null;
  }
}

/**
 * Discovers all cron task configurations from a service's cron/ directory.
 * Scans for *.json files, skipping hidden files and non-JSON files.
 * Malformed or invalid configurations are skipped with warnings logged.
 * @param servicePath - Absolute path to the service directory
 * @returns Array of validated CronTaskConfig objects
 */
export async function discoverCronTasks(servicePath: string): Promise<CronTaskConfig[]> {
  const cronDir = path.join(servicePath, "cron");

  // Check if cron directory exists
  try {
    const stat = await fs.stat(cronDir);
    if (!stat.isDirectory()) {
      return [];
    }
  } catch {
    // Directory doesn't exist - return empty array (not an error)
    return [];
  }

  // Read directory contents
  let entries: Dirent[];
  try {
    entries = await fs.readdir(cronDir, { withFileTypes: true });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.warn(`Failed to read cron directory: ${errorMsg}`);
    return [];
  }

  const configs: CronTaskConfig[] = [];

  for (const entry of entries) {
    // Skip non-files, hidden files, and non-JSON files
    if (!entry.isFile()) {
      continue;
    }
    if (entry.name.startsWith(".")) {
      continue;
    }
    if (!entry.name.endsWith(".json")) {
      continue;
    }

    const filePath = path.join(cronDir, entry.name);
    const config = await loadCronTaskConfig(filePath);

    if (config) {
      configs.push(config);
    }
  }

  return configs;
}
