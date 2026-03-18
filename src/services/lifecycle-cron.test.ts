import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { CronService } from "../cron/service.js";
import type { CronJob, CronSchedule, CronPayload, CronJobMetadata } from "../cron/types.js";
import type { PluginRegistry } from "../plugins/registry.js";
import { discoverCronTasks } from "./cron-loader.js";
import {
  Service,
  ServiceInstaller,
  ServiceValidationError,
  ServiceInstallError,
  type ServiceLifecycleDeps,
} from "./lifecycle.js";
import type { ServiceManifest, CronTaskConfig } from "./schema.js";

interface MockCronService extends CronService {
  _jobs: Map<string, CronJob>;
  _reset(): void;
}

function createMockCronService(): MockCronService {
  const jobs = new Map<string, CronJob>();
  let idCounter = 0;

  return {
    _jobs: jobs,

    _reset() {
      jobs.clear();
      idCounter = 0;
    },

    async add(job: {
      name: string;
      agentId: string;
      enabled?: boolean;
      schedule: CronSchedule;
      payload: CronPayload;
      metadata?: CronJobMetadata;
      description?: string;
    }) {
      const id = `job-${++idCounter}`;
      const now = Date.now();
      const mockJob: CronJob = {
        id,
        name: job.name,
        agentId: job.agentId,
        enabled: job.enabled ?? true,
        schedule: job.schedule,
        payload: job.payload,
        metadata: job.metadata,
        description: job.description,
        sessionTarget: "isolated",
        wakeMode: "next-heartbeat",
        createdAtMs: now,
        updatedAtMs: now,
        state: {
          nextRunAtMs: undefined,
          runningAtMs: undefined,
          lastRunAtMs: undefined,
        },
      };
      jobs.set(id, mockJob);
      return { id };
    },

    async remove(jobId: string) {
      jobs.delete(jobId);
    },

    async list(opts?: { includeDisabled?: boolean }) {
      const allJobs = Array.from(jobs.values());
      if (opts?.includeDisabled) {
        return allJobs;
      }
      return allJobs.filter((j) => j.enabled);
    },

    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockReturnValue(undefined),

    async status() {
      return { status: "running" as const, jobs: jobs.size };
    },

    async update(id: string, patch: Partial<CronJob>) {
      const job = jobs.get(id);
      if (job) {
        Object.assign(job, patch, { updatedAtMs: Date.now() });
      }
    },

    async run() {
      return undefined;
    },

    async enqueueRun() {
      return undefined;
    },

    getJob() {
      return undefined;
    },

    wake() {
      return undefined;
    },

    async listPage() {
      return { jobs: Array.from(jobs.values()), nextCursor: undefined };
    },

    async enableByService(serviceId: string) {
      let count = 0;
      for (const job of jobs.values()) {
        if (job.metadata?.serviceId === serviceId) {
          job.enabled = true;
          count++;
        }
      }
      return { success: true, count, errors: [] };
    },

    async disableByService(serviceId: string) {
      let count = 0;
      for (const job of jobs.values()) {
        if (job.metadata?.serviceId === serviceId) {
          job.enabled = false;
          count++;
        }
      }
      return { success: true, count, errors: [] };
    },

    async removeByService(serviceId: string) {
      let count = 0;
      for (const [id, job] of jobs.entries()) {
        if (job.metadata?.serviceId === serviceId) {
          jobs.delete(id);
          count++;
        }
      }
      return { success: true, count, errors: [] };
    },

    async listByService(opts: { serviceId: string; includeDisabled?: boolean }) {
      return Array.from(jobs.values()).filter((job) => {
        if (job.metadata?.serviceId !== opts.serviceId) {
          return false;
        }
        if (!opts.includeDisabled && !job.enabled) {
          return false;
        }
        return true;
      });
    },
  } as unknown as MockCronService;
}

const mockPluginRegistry = (): PluginRegistry =>
  ({
    httpRoutes: [],
    plugins: new Map(),
  }) as unknown as PluginRegistry;

async function createTempServiceDir(): Promise<string> {
  return await fs.promises.mkdtemp(path.join(os.tmpdir(), "lifecycle-cron-test-"));
}

async function createTestService(
  baseDir: string,
  serviceId: string,
  cronTasks: CronTaskConfig[],
): Promise<{ servicePath: string; manifest: ServiceManifest }> {
  const servicePath = path.join(baseDir, serviceId);
  const cronDir = path.join(servicePath, "cron");

  await fs.promises.mkdir(cronDir, { recursive: true });

  for (const task of cronTasks) {
    const taskPath = path.join(cronDir, `${task.name}.json`);
    await fs.promises.writeFile(taskPath, JSON.stringify(task, null, 2));
  }

  const manifest: ServiceManifest = {
    id: serviceId,
    name: `${serviceId}-name`,
    description: `Test service ${serviceId}`,
    version: "1.0.0",
    entry: "script/entry.ts",
    capabilities: {
      network: true,
      filesystem: true,
      cron: true,
    },
    category: "custom",
    trigger: {
      type: "cron",
      schedule: "0 8 * * *",
    },
  };

  await fs.promises.writeFile(
    path.join(servicePath, "manifest.json"),
    JSON.stringify(manifest, null, 2),
  );

  return { servicePath, manifest };
}

async function cleanupTempDir(dir: string): Promise<void> {
  try {
    await fs.promises.rm(dir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

describe("Service Lifecycle - Cron Integration", () => {
  let mockCronService: MockCronService;
  let tempDir: string;
  let deps: ServiceLifecycleDeps;

  beforeEach(async () => {
    mockCronService = createMockCronService();
    mockCronService._reset();
    tempDir = await createTempServiceDir();

    deps = {
      cronService: mockCronService,
      pluginRegistry: mockPluginRegistry(),
    };
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  describe("Full Lifecycle Flow", () => {
    it("should complete install → enable → execute → disable → uninstall flow", async () => {
      const cronTasks: CronTaskConfig[] = [
        {
          name: "cleanup",
          schedule: "0 2 * * *",
          command: "cleanup-temp-files",
          enabled: true,
          timezone: "UTC",
          description: "Clean up temporary files daily at 2 AM",
        },
        {
          name: "sync",
          schedule: "*/5 * * * *",
          command: "sync-data",
          enabled: true,
          timezone: "UTC",
          description: "Sync data every 5 minutes",
        },
      ];

      const { servicePath, manifest } = await createTestService(tempDir, "test-service", cronTasks);

      const discoveredTasks = await discoverCronTasks(servicePath);
      expect(discoveredTasks).toHaveLength(2);

      const service = new Service(manifest, {}, deps, "pending", servicePath);
      const installResult = await service.install();

      expect(installResult.success).toBe(true);
      expect(service.state).toBe("installed");
      expect(service.runtimeRefs.cronJobIds).toHaveLength(2);
      expect(service.runtimeRefs.cronTaskJobIds?.size).toBe(2);

      const jobsAfterInstall = await mockCronService.listByService({
        serviceId: "test-service",
        includeDisabled: true,
      });
      expect(jobsAfterInstall).toHaveLength(2);

      const cleanupJob = jobsAfterInstall.find((j) => j.metadata?.taskName === "cleanup");
      const syncJob = jobsAfterInstall.find((j) => j.metadata?.taskName === "sync");

      expect(cleanupJob).toBeDefined();
      expect(cleanupJob?.name).toBe("test-service:cleanup");
      expect(cleanupJob?.enabled).toBe(true);
      if (cleanupJob?.schedule.kind === "cron") {
        expect(cleanupJob.schedule.expr).toBe("0 2 * * *");
      }
      if (cleanupJob?.payload.kind === "agentTurn") {
        expect(cleanupJob.payload.taskName).toBe("cleanup");
      }

      expect(syncJob).toBeDefined();
      expect(syncJob?.name).toBe("test-service:sync");
      expect(syncJob?.enabled).toBe(true);
      if (syncJob?.schedule.kind === "cron") {
        expect(syncJob.schedule.expr).toBe("*/5 * * * *");
      }
      if (syncJob?.payload.kind === "agentTurn") {
        expect(syncJob.payload.taskName).toBe("sync");
      }

      await service.enable();
      expect(service.state).toBe("enabled");

      const jobsAfterEnable = await mockCronService.listByService({
        serviceId: "test-service",
        includeDisabled: false,
      });
      expect(jobsAfterEnable).toHaveLength(2);

      await service.disable();
      expect(service.state).toBe("disabled");

      const jobsAfterDisable = await mockCronService.listByService({
        serviceId: "test-service",
        includeDisabled: false,
      });
      expect(jobsAfterDisable).toHaveLength(0);

      const allJobsAfterDisable = await mockCronService.listByService({
        serviceId: "test-service",
        includeDisabled: true,
      });
      expect(allJobsAfterDisable).toHaveLength(2);
      expect(allJobsAfterDisable.every((j) => !j.enabled)).toBe(true);

      await service.enable();
      expect(service.state).toBe("enabled");

      const jobsAfterReEnable = await mockCronService.listByService({
        serviceId: "test-service",
        includeDisabled: false,
      });
      expect(jobsAfterReEnable).toHaveLength(2);

      await service.uninstall();
      expect(service.state).toBe("pending");

      const jobsAfterUninstall = await mockCronService.listByService({
        serviceId: "test-service",
        includeDisabled: true,
      });
      expect(jobsAfterUninstall).toHaveLength(0);
      expect(service.runtimeRefs.cronJobIds).toHaveLength(0);
    });

    it("should create jobs with correct payload containing taskName", async () => {
      const cronTasks: CronTaskConfig[] = [
        {
          name: "data-backup",
          schedule: "0 0 * * *",
          command: "backup-database",
          enabled: true,
          timezone: "America/New_York",
        },
      ];

      const { servicePath, manifest } = await createTestService(tempDir, "payload-test", cronTasks);

      const service = new Service(manifest, {}, deps, "pending", servicePath);
      await service.install();

      const jobs = await mockCronService.listByService({
        serviceId: "payload-test",
        includeDisabled: true,
      });

      expect(jobs).toHaveLength(1);
      const job = jobs[0];
      expect(job?.metadata?.taskName).toBe("data-backup");
      if (job?.payload.kind === "agentTurn") {
        expect(job.payload.message).toContain("data-backup");
        expect(job.payload.taskName).toBe("data-backup");
        expect(job.payload.deliver).toBe(false);
      }
    });
  });

  describe("Duplicate Prevention", () => {
    it("should not create duplicate jobs on re-install", async () => {
      const cronTasks: CronTaskConfig[] = [
        {
          name: "task1",
          schedule: "0 * * * *",
          command: "command1",
          enabled: true,
          timezone: "UTC",
        },
        {
          name: "task2",
          schedule: "30 * * * *",
          command: "command2",
          enabled: true,
          timezone: "UTC",
        },
      ];

      const { servicePath, manifest } = await createTestService(
        tempDir,
        "duplicate-test",
        cronTasks,
      );

      const service1 = new Service(manifest, {}, deps, "pending", servicePath);
      await service1.install();

      const jobIdsFirst = [...service1.runtimeRefs.cronJobIds];
      expect(jobIdsFirst).toHaveLength(2);

      const service2 = new Service(manifest, {}, deps, "pending", servicePath);
      await service2.install();

      const allJobs = await mockCronService.listByService({
        serviceId: "duplicate-test",
        includeDisabled: true,
      });
      expect(allJobs).toHaveLength(2);

      // Service2 should not have created new jobs since they already exist
      const jobIdsSecond = service2.runtimeRefs.cronJobIds;
      expect(jobIdsSecond.length).toBeLessThanOrEqual(2);

      // Total unique jobs in cron service should still be 2 (not 4)
      const uniqueJobIds = new Set(allJobs.map((j) => j.id));
      expect(uniqueJobIds.size).toBe(2);
    });

    it("should handle partial re-install when some tasks already exist", async () => {
      const initialTasks: CronTaskConfig[] = [
        {
          name: "existing-task",
          schedule: "0 12 * * *",
          command: "existing",
          enabled: true,
          timezone: "UTC",
        },
      ];

      const { servicePath, manifest } = await createTestService(
        tempDir,
        "partial-test",
        initialTasks,
      );

      const service1 = new Service(manifest, {}, deps, "pending", servicePath);
      await service1.install();

      const existingJobId = service1.runtimeRefs.cronJobIds[0];
      expect(existingJobId).toBeDefined();

      const newTask: CronTaskConfig = {
        name: "new-task",
        schedule: "0 15 * * *",
        command: "new-command",
        enabled: true,
        timezone: "UTC",
      };
      await fs.promises.writeFile(
        path.join(servicePath, "cron", "new-task.json"),
        JSON.stringify(newTask, null, 2),
      );

      const service2 = new Service(manifest, {}, deps, "pending", servicePath);
      await service2.install();

      const allJobs = await mockCronService.listByService({
        serviceId: "partial-test",
        includeDisabled: true,
      });
      expect(allJobs).toHaveLength(2);

      const existingJob = allJobs.find((j) => j.metadata?.taskName === "existing-task");
      expect(existingJob?.id).toBe(existingJobId);

      const newJob = allJobs.find((j) => j.metadata?.taskName === "new-task");
      expect(newJob?.id).not.toBe(existingJobId);
    });
  });

  describe("Error Handling", () => {
    it("should handle malformed cron config gracefully during install", async () => {
      const servicePath = path.join(tempDir, "error-test");
      const cronDir = path.join(servicePath, "cron");
      await fs.promises.mkdir(cronDir, { recursive: true });

      const validTask: CronTaskConfig = {
        name: "valid-task",
        schedule: "0 9 * * *",
        command: "valid-command",
        enabled: true,
        timezone: "UTC",
      };
      await fs.promises.writeFile(
        path.join(cronDir, "valid-task.json"),
        JSON.stringify(validTask, null, 2),
      );

      await fs.promises.writeFile(path.join(cronDir, "malformed.json"), "not valid json {{{");

      await fs.promises.writeFile(
        path.join(cronDir, "invalid-schedule.json"),
        JSON.stringify({
          name: "invalid-schedule",
          schedule: "not-a-valid-cron",
          command: "some-command",
        }),
      );

      const manifest: ServiceManifest = {
        id: "error-test",
        name: "Error Test Service",
        description: "Service with malformed configs",
        version: "1.0.0",
        entry: "script/entry.ts",
        capabilities: { cron: true },
        category: "custom",
        trigger: { type: "cron", schedule: "0 8 * * *" },
      };

      await fs.promises.writeFile(
        path.join(servicePath, "manifest.json"),
        JSON.stringify(manifest, null, 2),
      );

      const service = new Service(manifest, {}, deps, "pending", servicePath);
      const result = await service.install();

      expect(result.success).toBe(true);
      expect(service.state).toBe("installed");

      const jobs = await mockCronService.listByService({
        serviceId: "error-test",
        includeDisabled: true,
      });
      expect(jobs).toHaveLength(1);
      expect(jobs[0]?.metadata?.taskName).toBe("valid-task");
    });

    it("should handle missing cron directory gracefully", async () => {
      const servicePath = path.join(tempDir, "no-cron-dir");
      await fs.promises.mkdir(servicePath, { recursive: true });

      const manifest: ServiceManifest = {
        id: "no-cron-dir",
        name: "No Cron Dir Service",
        description: "Service without cron directory",
        version: "1.0.0",
        entry: "script/entry.ts",
        capabilities: { cron: true },
        category: "custom",
        trigger: { type: "cron", schedule: "0 8 * * *" },
      };

      await fs.promises.writeFile(
        path.join(servicePath, "manifest.json"),
        JSON.stringify(manifest, null, 2),
      );

      const service = new Service(manifest, {}, deps, "pending", servicePath);
      const result = await service.install();

      expect(result.success).toBe(true);
      expect(service.state).toBe("installed");

      const jobs = await mockCronService.listByService({
        serviceId: "no-cron-dir",
        includeDisabled: true,
      });
      expect(jobs).toHaveLength(1);
    });

    it("should throw when all cron tasks fail to create", async () => {
      const cronTasks: CronTaskConfig[] = [
        {
          name: "failing-task",
          schedule: "0 8 * * *",
          command: "command",
          enabled: true,
          timezone: "UTC",
        },
      ];

      const { servicePath, manifest } = await createTestService(
        tempDir,
        "failing-service",
        cronTasks,
      );

      const failingMock = createMockCronService();
      failingMock.add = vi.fn().mockRejectedValue(new Error("Cron service unavailable"));

      const failingDeps: ServiceLifecycleDeps = {
        cronService: failingMock as unknown as CronService,
        pluginRegistry: mockPluginRegistry(),
      };

      const service = new Service(manifest, {}, failingDeps, "pending", servicePath);

      await expect(service.install()).rejects.toThrow(ServiceInstallError);
      expect(service.state).toBe("install_error");
    });
  });

  describe("ServiceInstaller Integration", () => {
    it("should install service with cron tasks using ServiceInstaller", async () => {
      const cronTasks: CronTaskConfig[] = [
        {
          name: "installer-task",
          schedule: "0 10 * * *",
          command: "installer-command",
          enabled: true,
          timezone: "UTC",
        },
      ];

      const { servicePath, manifest } = await createTestService(
        tempDir,
        "installer-test",
        cronTasks,
      );

      const installer = new ServiceInstaller(deps);
      const service = await installer.install(manifest, {}, servicePath);

      expect(service).toBeInstanceOf(Service);
      expect(service.state).toBe("installed");
      expect(service.id).toBe("installer-test");

      const jobs = await mockCronService.listByService({
        serviceId: "installer-test",
        includeDisabled: true,
      });
      expect(jobs).toHaveLength(1);
      expect(jobs[0]?.metadata?.taskName).toBe("installer-task");
    });

    it("should track installation phase during cron setup", async () => {
      const cronTasks: CronTaskConfig[] = [
        {
          name: "phase-task",
          schedule: "0 11 * * *",
          command: "phase-command",
          enabled: true,
          timezone: "UTC",
        },
      ];

      const { servicePath, manifest } = await createTestService(tempDir, "phase-test", cronTasks);

      const installer = new ServiceInstaller(deps);

      expect(installer.getCurrentPhase()).toBe("validate");

      await installer.install(manifest, {}, servicePath);
      expect(installer.getCurrentPhase()).toBe("prepare");
    });

    it("should throw validation error for invalid cron manifest", async () => {
      const manifest: ServiceManifest = {
        id: "invalid-cron",
        name: "Invalid Cron Service",
        description: "Service with invalid cron",
        version: "1.0.0",
        capabilities: { cron: true },
        category: "custom",
        trigger: {
          type: "cron",
          schedule: "",
        },
      };

      const installer = new ServiceInstaller(deps);

      await expect(installer.install(manifest, {})).rejects.toThrow(ServiceValidationError);
    });
  });

  describe("Cron Task Discovery", () => {
    it("should discover all valid cron tasks from directory", async () => {
      const cronTasks: CronTaskConfig[] = [
        {
          name: "task-a",
          schedule: "0 1 * * *",
          command: "cmd-a",
          enabled: true,
          timezone: "UTC",
        },
        {
          name: "task-b",
          schedule: "0 2 * * *",
          command: "cmd-b",
          enabled: false,
          timezone: "UTC",
        },
        {
          name: "task-c",
          schedule: "0 3 * * *",
          command: "cmd-c",
          enabled: true,
          timezone: "America/New_York",
        },
      ];

      const { servicePath } = await createTestService(tempDir, "discovery-test", cronTasks);

      const discovered = await discoverCronTasks(servicePath);

      expect(discovered).toHaveLength(3);
      expect(discovered.map((t) => t.name)).toContain("task-a");
      expect(discovered.map((t) => t.name)).toContain("task-b");
      expect(discovered.map((t) => t.name)).toContain("task-c");

      const taskC = discovered.find((t) => t.name === "task-c");
      expect(taskC?.timezone).toBe("America/New_York");
    });

    it("should ignore non-JSON files in cron directory", async () => {
      const servicePath = path.join(tempDir, "ignore-test");
      const cronDir = path.join(servicePath, "cron");
      await fs.promises.mkdir(cronDir, { recursive: true });

      await fs.promises.writeFile(
        path.join(cronDir, "valid.json"),
        JSON.stringify({
          name: "valid",
          schedule: "0 8 * * *",
          command: "valid",
          enabled: true,
          timezone: "UTC",
        }),
      );

      await fs.promises.writeFile(path.join(cronDir, "readme.md"), "# Readme");
      await fs.promises.writeFile(path.join(cronDir, "script.js"), "console.log('hello');");
      await fs.promises.writeFile(path.join(cronDir, ".hidden"), "hidden");

      const discovered = await discoverCronTasks(servicePath);

      expect(discovered).toHaveLength(1);
      expect(discovered[0]?.name).toBe("valid");
    });
  });

  describe("State Transitions with Cron", () => {
    it("should track complete state history through lifecycle", async () => {
      const cronTasks: CronTaskConfig[] = [
        {
          name: "history-task",
          schedule: "0 12 * * *",
          command: "history",
          enabled: true,
          timezone: "UTC",
        },
      ];

      const { servicePath, manifest } = await createTestService(tempDir, "history-test", cronTasks);
      const service = new Service(manifest, {}, deps, "pending", servicePath);

      await service.install();
      expect(service.stateHistory.some((h) => h.from === "pending" && h.to === "validating")).toBe(
        true,
      );
      expect(
        service.stateHistory.some((h) => h.from === "installing" && h.to === "installed"),
      ).toBe(true);

      await service.enable();
      expect(service.stateHistory.some((h) => h.from === "installed" && h.to === "enabled")).toBe(
        true,
      );

      await service.disable();
      expect(service.stateHistory.some((h) => h.from === "enabled" && h.to === "disabled")).toBe(
        true,
      );

      await service.enable();
      expect(service.stateHistory.filter((h) => h.to === "enabled")).toHaveLength(2);

      await service.uninstall();
      expect(service.stateHistory.some((h) => h.to === "uninstalling")).toBe(true);
    });
  });
});
