import { describe, expect, it } from "vitest";
import { discoverCronTasks, loadCronTaskConfig, validateCronExpression } from "./cron-loader.js";
import type { CronTaskConfig } from "./schema.js";

// Helper to create temp directory structure for tests
async function createTempServiceDir(
  tmpDir: string,
  files: Record<string, string | null>,
): Promise<string> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");

  await fs.mkdir(tmpDir, { recursive: true });

  for (const [filePath, content] of Object.entries(files)) {
    if (content === null) {
      continue;
    }
    const fullPath = path.join(tmpDir, filePath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content, "utf-8");
  }

  return tmpDir;
}

async function cleanupTempDir(tmpDir: string): Promise<void> {
  const fs = await import("node:fs/promises");
  await fs.rm(tmpDir, { recursive: true, force: true });
}

describe("validateCronExpression", () => {
  it("should return true for valid 5-field cron expression", () => {
    expect(validateCronExpression("0 2 * * *")).toBe(true);
    expect(validateCronExpression("*/5 * * * *")).toBe(true);
    expect(validateCronExpression("0 0 * * 1")).toBe(true);
  });

  it("should return true for valid 6-field cron expression with seconds", () => {
    expect(validateCronExpression("0 0 2 * * *")).toBe(true);
    expect(validateCronExpression("*/30 0 0 * * *")).toBe(true);
  });

  it("should return true for valid 7-field cron expression with year", () => {
    expect(validateCronExpression("0 0 2 * * * *")).toBe(true);
  });

  it("should return false for invalid cron expression", () => {
    expect(validateCronExpression("invalid")).toBe(false);
    expect(validateCronExpression("* * *")).toBe(false);
    expect(validateCronExpression("")).toBe(false);
  });

  it("should return false for empty or whitespace-only expression", () => {
    expect(validateCronExpression("")).toBe(false);
    expect(validateCronExpression("   ")).toBe(false);
  });

  it("should return false for non-string values", () => {
    expect(validateCronExpression(null as unknown as string)).toBe(false);
    expect(validateCronExpression(undefined as unknown as string)).toBe(false);
    expect(validateCronExpression(123 as unknown as string)).toBe(false);
  });

  it("should handle special characters in cron expressions", () => {
    expect(validateCronExpression("0 2 L * *")).toBe(true);
    expect(validateCronExpression("0 2 * * 1L")).toBe(true);
    expect(validateCronExpression("0 2 15W * *")).toBe(true);
    expect(validateCronExpression("0 2 * * 1#2")).toBe(true);
  });
});

describe("loadCronTaskConfig", () => {
  const tmpDir = `/tmp/cron-loader-test-${Date.now()}`;

  it("should load and validate a valid cron config file", async () => {
    const config: CronTaskConfig = {
      name: "cleanup",
      schedule: "0 2 * * *",
      command: "cleanup-old-data",
      enabled: true,
      timezone: "UTC",
      description: "Clean up old data daily",
    };

    const testDir = await createTempServiceDir(tmpDir, {
      "cleanup.json": JSON.stringify(config),
    });

    const result = await loadCronTaskConfig(`${testDir}/cleanup.json`);

    expect(result).not.toBeNull();
    expect(result?.name).toBe("cleanup");
    expect(result?.schedule).toBe("0 2 * * *");
    expect(result?.command).toBe("cleanup-old-data");

    await cleanupTempDir(tmpDir);
  });

  it("should return null for malformed JSON", async () => {
    const testDir = await createTempServiceDir(tmpDir, {
      "invalid.json": "{ invalid json }",
    });

    const result = await loadCronTaskConfig(`${testDir}/invalid.json`);

    expect(result).toBeNull();

    await cleanupTempDir(tmpDir);
  });

  it("should return null for config missing required fields", async () => {
    const testDir = await createTempServiceDir(tmpDir, {
      "incomplete.json": JSON.stringify({ name: "test", schedule: "0 2 * * *" }),
    });

    const result = await loadCronTaskConfig(`${testDir}/incomplete.json`);

    expect(result).toBeNull();

    await cleanupTempDir(tmpDir);
  });

  it("should return null for invalid cron expression", async () => {
    const config = {
      name: "bad-schedule",
      schedule: "invalid-cron",
      command: "test",
    };

    const testDir = await createTempServiceDir(tmpDir, {
      "bad-schedule.json": JSON.stringify(config),
    });

    const result = await loadCronTaskConfig(`${testDir}/bad-schedule.json`);

    expect(result).toBeNull();

    await cleanupTempDir(tmpDir);
  });

  it("should use default values for optional fields", async () => {
    const config = {
      name: "minimal",
      schedule: "0 * * * *",
      command: "test",
    };

    const testDir = await createTempServiceDir(tmpDir, {
      "minimal.json": JSON.stringify(config),
    });

    const result = await loadCronTaskConfig(`${testDir}/minimal.json`);

    expect(result).not.toBeNull();
    expect(result?.enabled).toBe(true);
    expect(result?.timezone).toBe("UTC");

    await cleanupTempDir(tmpDir);
  });

  it("should return null for non-existent file", async () => {
    const result = await loadCronTaskConfig("/nonexistent/path/config.json");
    expect(result).toBeNull();
  });
});

describe("discoverCronTasks", () => {
  const tmpDir = `/tmp/cron-discovery-test-${Date.now()}`;

  it("should discover multiple valid cron configs", async () => {
    const testDir = await createTempServiceDir(tmpDir, {
      "cron/cleanup.json": JSON.stringify({
        name: "cleanup",
        schedule: "0 2 * * *",
        command: "cleanup-old-data",
      }),
      "cron/sync.json": JSON.stringify({
        name: "sync",
        schedule: "0 */6 * * *",
        command: "sync-data",
        timezone: "America/New_York",
      }),
    });

    const results = await discoverCronTasks(testDir);

    expect(results).toHaveLength(2);
    expect(results.map((r) => r.name)).toContain("cleanup");
    expect(results.map((r) => r.name)).toContain("sync");

    await cleanupTempDir(tmpDir);
  });

  it("should return empty array when cron directory does not exist", async () => {
    const testDir = await createTempServiceDir(tmpDir, {
      "manifest.json": "{}",
    });

    const results = await discoverCronTasks(testDir);

    expect(results).toEqual([]);

    await cleanupTempDir(tmpDir);
  });

  it("should return empty array when cron path exists but is not a directory", async () => {
    const testDir = await createTempServiceDir(tmpDir, {
      cron: "this is a file, not a directory",
    });

    const results = await discoverCronTasks(testDir);

    expect(results).toEqual([]);

    await cleanupTempDir(tmpDir);
  });

  it("should return empty array when cron directory cannot be read", async () => {
    const testDir = await createTempServiceDir(tmpDir, {
      "cron/.gitkeep": "",
    });

    // Make directory unreadable (remove read permissions)
    const fs = await import("node:fs/promises");
    await fs.chmod(`${testDir}/cron`, 0o000);

    const results = await discoverCronTasks(testDir);

    // Should return empty array, not throw
    expect(results).toEqual([]);

    // Restore permissions for cleanup
    await fs.chmod(`${testDir}/cron`, 0o755);
    await cleanupTempDir(tmpDir);
  });

  it("should return empty array when cron directory is empty", async () => {
    const testDir = await createTempServiceDir(tmpDir, {
      "cron/.gitkeep": "",
    });

    const results = await discoverCronTasks(testDir);

    expect(results).toEqual([]);

    await cleanupTempDir(tmpDir);
  });

  it("should skip hidden files", async () => {
    const testDir = await createTempServiceDir(tmpDir, {
      "cron/.hidden.json": JSON.stringify({
        name: "hidden",
        schedule: "0 2 * * *",
        command: "hidden-cmd",
      }),
      "cron/visible.json": JSON.stringify({
        name: "visible",
        schedule: "0 3 * * *",
        command: "visible-cmd",
      }),
    });

    const results = await discoverCronTasks(testDir);

    expect(results).toHaveLength(1);
    expect(results[0]?.name).toBe("visible");

    await cleanupTempDir(tmpDir);
  });

  it("should skip non-JSON files", async () => {
    const testDir = await createTempServiceDir(tmpDir, {
      "cron/readme.md": "# Cron Tasks",
      "cron/config.yaml": "name: test",
      "cron/valid.json": JSON.stringify({
        name: "valid",
        schedule: "0 2 * * *",
        command: "valid-cmd",
      }),
    });

    const results = await discoverCronTasks(testDir);

    expect(results).toHaveLength(1);
    expect(results[0]?.name).toBe("valid");

    await cleanupTempDir(tmpDir);
  });

  it("should skip directories inside cron folder", async () => {
    const testDir = await createTempServiceDir(tmpDir, {
      "cron/valid.json": JSON.stringify({
        name: "valid",
        schedule: "0 2 * * *",
        command: "valid-cmd",
      }),
      "cron/subdir/config.json": JSON.stringify({
        name: "nested",
        schedule: "0 3 * * *",
        command: "nested-cmd",
      }),
    });

    const results = await discoverCronTasks(testDir);

    expect(results).toHaveLength(1);
    expect(results[0]?.name).toBe("valid");

    await cleanupTempDir(tmpDir);
  });

  it("should handle mixed valid and invalid configs", async () => {
    const testDir = await createTempServiceDir(tmpDir, {
      "cron/valid.json": JSON.stringify({
        name: "valid",
        schedule: "0 2 * * *",
        command: "valid-cmd",
      }),
      "cron/invalid.json": "{ bad json }",
      "cron/bad-schedule.json": JSON.stringify({
        name: "bad-schedule",
        schedule: "not-a-cron",
        command: "test",
      }),
    });

    const results = await discoverCronTasks(testDir);

    expect(results).toHaveLength(1);
    expect(results[0]?.name).toBe("valid");

    await cleanupTempDir(tmpDir);
  });

  it("should handle configs with all optional fields", async () => {
    const config: CronTaskConfig = {
      name: "full-config",
      schedule: "0 2 * * *",
      command: "run-task",
      enabled: false,
      timezone: "Europe/London",
      description: "A fully configured task",
      options: {
        waitForCompletion: true,
        maxExecutions: 100,
      },
    };

    const testDir = await createTempServiceDir(tmpDir, {
      "cron/full.json": JSON.stringify(config),
    });

    const results = await discoverCronTasks(testDir);

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      name: "full-config",
      enabled: false,
      timezone: "Europe/London",
      description: "A fully configured task",
      options: {
        waitForCompletion: true,
        maxExecutions: 100,
      },
    });

    await cleanupTempDir(tmpDir);
  });
});
