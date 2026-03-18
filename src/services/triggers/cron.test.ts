/* eslint-disable @typescript-eslint/unbound-method */
import { describe, expect, it, vi } from "vitest";
import type { CronService } from "../../cron/service.js";
import type { CronJob, CronJobCreate } from "../../cron/types.js";
import type { CronTaskConfig, CronTrigger, ServiceManifest } from "../schema.js";
import { ServiceCronTrigger, createServiceCronTrigger } from "./cron.js";

// Type for task input (before schema parsing with defaults)
type CronTaskInput = {
  name: string;
  schedule: string;
  command: string;
  enabled?: boolean;
  timezone?: string;
  description?: string;
  options?: { waitForCompletion?: boolean; maxExecutions?: number | null };
};

function createMockCronService(): CronService {
  const jobs: CronJob[] = [];

  return {
    add: vi.fn(async (input: CronJobCreate) => {
      const job: CronJob = {
        id: `job-${Math.random().toString(36).substring(7)}`,
        agentId: input.agentId,
        name: input.name,
        description: input.description,
        enabled: input.enabled ?? true,
        deleteAfterRun: input.deleteAfterRun,
        createdAtMs: Date.now(),
        updatedAtMs: Date.now(),
        schedule: input.schedule,
        sessionTarget: input.sessionTarget,
        wakeMode: input.wakeMode,
        payload: input.payload,
        delivery: input.delivery,
        failureAlert: input.failureAlert,
        metadata: input.metadata,
        state: {
          nextRunAtMs: Date.now() + 60000,
        },
      };
      jobs.push(job);
      return job;
    }),
    listByService: vi.fn(async ({ serviceId }: { serviceId: string }) => {
      return jobs.filter((job) => job.metadata?.serviceId === serviceId);
    }),
    disableByService: vi.fn(async (serviceId: string) => {
      const serviceJobs = jobs.filter((job) => job.metadata?.serviceId === serviceId);
      serviceJobs.forEach((job) => {
        job.enabled = false;
      });
      return { success: true, affectedCount: serviceJobs.length, errors: [] };
    }),
    enableByService: vi.fn(async (serviceId: string) => {
      const serviceJobs = jobs.filter((job) => job.metadata?.serviceId === serviceId);
      serviceJobs.forEach((job) => {
        job.enabled = true;
      });
      return { success: true, affectedCount: serviceJobs.length, errors: [] };
    }),
    removeByService: vi.fn(async (serviceId: string) => {
      const beforeCount = jobs.length;
      for (let i = jobs.length - 1; i >= 0; i--) {
        if (jobs[i]?.metadata?.serviceId === serviceId) {
          jobs.splice(i, 1);
        }
      }
      const affectedCount = beforeCount - jobs.length;
      return { success: true, affectedCount, errors: [] };
    }),
    remove: vi.fn(async (jobId: string) => {
      const index = jobs.findIndex((j) => j.id === jobId);
      if (index >= 0) {
        jobs.splice(index, 1);
      }
      return { ok: true, removed: index >= 0 };
    }),
    update: vi.fn(async (jobId: string, patch: Partial<CronJob>) => {
      const job = jobs.find((j) => j.id === jobId);
      if (!job) {
        throw new Error(`Job not found: ${jobId}`);
      }
      Object.assign(job, patch);
      return job;
    }),
  } as unknown as CronService;
}

function createTestManifest(schedule: string, timezone?: string): ServiceManifest {
  return {
    id: "test-service",
    name: "Test Service",
    description: "A test service for cron triggers",
    version: "1.0.0",
    trigger: {
      type: "cron",
      schedule,
      timezone: timezone ?? "auto",
    } as CronTrigger,
    execution: {
      agentId: "test-agent",
      sessionTarget: "isolated",
    },
    config: {},
    requires: {},
    capabilities: {
      network: false,
      filesystem: false,
      shell: false,
      browser: false,
    },
  };
}

describe("ServiceCronTrigger", () => {
  describe("create", () => {
    it("should create a cron job with service metadata", async () => {
      const cronService = createMockCronService();
      const manifest = createTestManifest("0 9 * * *");
      const trigger = createServiceCronTrigger({
        serviceId: "test-service",
        manifest,
        cronService,
      });

      const result = await trigger.create("test-agent");

      expect(result.success).toBe(true);
      expect(result.jobId).toBeDefined();
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(vi.mocked(cronService).add).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Test Service",
          agentId: "test-agent",
          metadata: expect.objectContaining({
            serviceId: "test-service",
            managedBy: "service-registry",
            triggerType: "cron",
          }),
        }),
      );
    });

    it("should validate invalid cron schedule", async () => {
      const cronService = createMockCronService();
      const manifest = createTestManifest("invalid");
      const trigger = createServiceCronTrigger({
        serviceId: "test-service",
        manifest,
        cronService,
      });

      const result = await trigger.create("test-agent");

      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid cron schedule");
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(vi.mocked(cronService).add).not.toHaveBeenCalled();
    });

    it("should handle CronService.add errors", async () => {
      const cronService = createMockCronService();
      vi.mocked(cronService).add.mockRejectedValueOnce(new Error("Service unavailable"));

      const manifest = createTestManifest("0 9 * * *");
      const trigger = createServiceCronTrigger({
        serviceId: "test-service",
        manifest,
        cronService,
      });

      const result = await trigger.create("test-agent");

      expect(result.success).toBe(false);
      expect(result.error).toBe("Service unavailable");
    });

    it("should support timezone configuration", async () => {
      const cronService = createMockCronService();
      const manifest = createTestManifest("0 9 * * *", "America/New_York");
      const trigger = createServiceCronTrigger({
        serviceId: "test-service",
        manifest,
        cronService,
      });

      const result = await trigger.create("test-agent");

      expect(result.success).toBe(true);
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(vi.mocked(cronService).add).toHaveBeenCalledWith(
        expect.objectContaining({
          schedule: expect.objectContaining({
            kind: "cron",
            expr: "0 9 * * *",
            tz: "America/New_York",
          }),
        }),
      );
    });

    it("should handle auto timezone by leaving tz undefined", async () => {
      const cronService = createMockCronService();
      const manifest = createTestManifest("0 9 * * *", "auto");
      const trigger = createServiceCronTrigger({
        serviceId: "test-service",
        manifest,
        cronService,
      });

      await trigger.create("test-agent");

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(vi.mocked(cronService).add).toHaveBeenCalledWith(
        expect.objectContaining({
          schedule: expect.objectContaining({
            tz: undefined,
          }),
        }),
      );
    });
  });

  describe("validateSchedule", () => {
    it("should accept valid 5-field cron expression", () => {
      const trigger = createServiceCronTrigger({
        serviceId: "test",
        manifest: createTestManifest("* * * * *"),
        cronService: createMockCronService(),
      });

      const result = trigger.validateSchedule("0 9 * * 1");
      expect(result.valid).toBe(true);
    });

    it("should accept valid 6-field cron expression", () => {
      const trigger = createServiceCronTrigger({
        serviceId: "test",
        manifest: createTestManifest("* * * * * *"),
        cronService: createMockCronService(),
      });

      const result = trigger.validateSchedule("0 0 9 * * 1");
      expect(result.valid).toBe(true);
    });

    it("should reject too few fields", () => {
      const trigger = createServiceCronTrigger({
        serviceId: "test",
        manifest: createTestManifest("* * * *"),
        cronService: createMockCronService(),
      });

      const result = trigger.validateSchedule("* * * *");
      expect(result.valid).toBe(false);
      expect(result.error).toContain("expected 5-6 fields");
    });

    it("should reject too many fields", () => {
      const trigger = createServiceCronTrigger({
        serviceId: "test",
        manifest: createTestManifest("* * * * * * *"),
        cronService: createMockCronService(),
      });

      const result = trigger.validateSchedule("* * * * * * *");
      expect(result.valid).toBe(false);
    });

    it("should reject empty schedule", () => {
      const trigger = createServiceCronTrigger({
        serviceId: "test",
        manifest: createTestManifest(""),
        cronService: createMockCronService(),
      });

      const result = trigger.validateSchedule("");
      expect(result.valid).toBe(false);
    });

    it("should reject special cron strings that don't have 5-6 fields", () => {
      const trigger = createServiceCronTrigger({
        serviceId: "test",
        manifest: createTestManifest("@yearly"),
        cronService: createMockCronService(),
      });

      // @yearly is a single field, so it fails the 5-6 field check
      expect(trigger.validateSchedule("@yearly").valid).toBe(false);
    });

    it("should reject invalid special characters in cron fields", () => {
      const trigger = createServiceCronTrigger({
        serviceId: "test",
        manifest: createTestManifest("* * * * *"),
        cronService: createMockCronService(),
      });

      const result = trigger.validateSchedule("0 0 * * !");
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Invalid cron field");
    });
  });

  describe("validateTimezone", () => {
    it("should accept valid timezone", () => {
      const trigger = createServiceCronTrigger({
        serviceId: "test",
        manifest: createTestManifest("* * * * *"),
        cronService: createMockCronService(),
      });

      expect(trigger.validateTimezone("America/New_York").valid).toBe(true);
      expect(trigger.validateTimezone("UTC").valid).toBe(true);
      expect(trigger.validateTimezone("Europe/London").valid).toBe(true);
    });

    it("should accept auto timezone", () => {
      const trigger = createServiceCronTrigger({
        serviceId: "test",
        manifest: createTestManifest("* * * * *"),
        cronService: createMockCronService(),
      });

      expect(trigger.validateTimezone("auto").valid).toBe(true);
    });

    it("should accept undefined timezone", () => {
      const trigger = createServiceCronTrigger({
        serviceId: "test",
        manifest: createTestManifest("* * * * *"),
        cronService: createMockCronService(),
      });

      expect(trigger.validateTimezone(undefined as unknown as string).valid).toBe(true);
    });

    it("should reject invalid timezone", () => {
      const trigger = createServiceCronTrigger({
        serviceId: "test",
        manifest: createTestManifest("* * * * *"),
        cronService: createMockCronService(),
      });

      const result = trigger.validateTimezone("Invalid/Timezone");
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Invalid timezone");
    });
  });

  describe("bulk operations", () => {
    it("should disable all cron jobs for service", async () => {
      const cronService = createMockCronService();
      const trigger = createServiceCronTrigger({
        serviceId: "test-service",
        manifest: createTestManifest("0 9 * * *"),
        cronService,
      });

      await trigger.create("agent-1");
      await trigger.create("agent-2");

      const result = await trigger.disable();

      expect(result.success).toBe(true);
      expect(result.affectedCount).toBe(2);
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(vi.mocked(cronService).disableByService).toHaveBeenCalledWith("test-service");
    });

    it("should enable all cron jobs for service", async () => {
      const cronService = createMockCronService();
      const trigger = createServiceCronTrigger({
        serviceId: "test-service",
        manifest: createTestManifest("0 9 * * *"),
        cronService,
      });

      await trigger.create("agent-1");
      await trigger.disable();

      const result = await trigger.enable();

      expect(result.success).toBe(true);
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(vi.mocked(cronService).enableByService).toHaveBeenCalledWith("test-service");
    });

    it("should remove all cron jobs for service", async () => {
      const cronService = createMockCronService();
      const trigger = createServiceCronTrigger({
        serviceId: "test-service",
        manifest: createTestManifest("0 9 * * *"),
        cronService,
      });

      await trigger.create("agent-1");
      await trigger.create("agent-2");

      const result = await trigger.remove();

      expect(result.success).toBe(true);
      expect(result.affectedCount).toBe(2);
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(vi.mocked(cronService).removeByService).toHaveBeenCalledWith("test-service");
    });
  });

  describe("getJobs", () => {
    it("should return all jobs for the service", async () => {
      const cronService = createMockCronService();
      const trigger = createServiceCronTrigger({
        serviceId: "test-service",
        manifest: createTestManifest("0 9 * * *"),
        cronService,
      });

      await trigger.create("agent-1");
      await trigger.create("agent-2");

      const jobs = await trigger.getJobs();

      expect(jobs).toHaveLength(2);
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(vi.mocked(cronService).listByService).toHaveBeenCalledWith({
        serviceId: "test-service",
        includeDisabled: true,
      });
    });
  });

  describe("hasJobs", () => {
    it("should return true when jobs exist", async () => {
      const cronService = createMockCronService();
      const trigger = createServiceCronTrigger({
        serviceId: "test-service",
        manifest: createTestManifest("0 9 * * *"),
        cronService,
      });

      await trigger.create("agent-1");

      expect(await trigger.hasJobs()).toBe(true);
    });

    it("should return false when no jobs exist", async () => {
      const trigger = createServiceCronTrigger({
        serviceId: "test-service",
        manifest: createTestManifest("0 9 * * *"),
        cronService: createMockCronService(),
      });

      expect(await trigger.hasJobs()).toBe(false);
    });
  });

  describe("getJobCount", () => {
    it("should return correct count", async () => {
      const cronService = createMockCronService();
      const trigger = createServiceCronTrigger({
        serviceId: "test-service",
        manifest: createTestManifest("0 9 * * *"),
        cronService,
      });

      expect(await trigger.getJobCount()).toBe(0);

      await trigger.create("agent-1");
      expect(await trigger.getJobCount()).toBe(1);

      await trigger.create("agent-2");
      expect(await trigger.getJobCount()).toBe(2);
    });
  });
});

describe("createServiceCronTrigger", () => {
  it("should create a ServiceCronTrigger instance", () => {
    const manifest = createTestManifest("0 9 * * *");
    const trigger = createServiceCronTrigger({
      serviceId: "test-service",
      manifest,
      cronService: createMockCronService(),
    });

    expect(trigger).toBeInstanceOf(ServiceCronTrigger);
  });
});

describe("ServiceCronTrigger createMultiple", () => {
  function createTestManifestWithoutTrigger(): ServiceManifest {
    return {
      id: "test-service",
      name: "Test Service",
      description: "A test service for cron triggers",
      version: "1.0.0",
      execution: {
        agentId: "test-agent",
        sessionTarget: "isolated",
      },
      config: {},
      requires: {},
      capabilities: {
        network: false,
        filesystem: false,
        shell: false,
        browser: false,
      },
    };
  }

  it("should create multiple cron jobs for all tasks", async () => {
    const cronService = createMockCronService();
    const manifest = createTestManifestWithoutTrigger();
    const trigger = createServiceCronTrigger({
      serviceId: "test-service",
      manifest,
      cronService,
    });

    const tasks: CronTaskInput[] = [
      { name: "cleanup", schedule: "0 2 * * *", command: "cleanup-data" },
      { name: "sync", schedule: "0 */6 * * *", command: "sync-data" },
      { name: "report", schedule: "0 9 * * 1", command: "generate-report" },
    ];

    const result = await trigger.createMultiple(tasks as CronTaskConfig[], "test-agent");

    expect(result.success).toBe(true);
    expect(result.jobIds).toHaveLength(3);
    expect(result.errors).toHaveLength(0);
  });

  it("should return success true for empty tasks array", async () => {
    const cronService = createMockCronService();
    const manifest = createTestManifestWithoutTrigger();
    const trigger = createServiceCronTrigger({
      serviceId: "test-service",
      manifest,
      cronService,
    });

    const result = await trigger.createMultiple([], "test-agent");

    expect(result.success).toBe(true);
    expect(result.jobIds).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });

  it("should use {serviceId}:{taskName} format for job names", async () => {
    const cronService = createMockCronService();
    const manifest = createTestManifestWithoutTrigger();
    const trigger = createServiceCronTrigger({
      serviceId: "my-service",
      manifest,
      cronService,
    });

    const tasks: CronTaskInput[] = [{ name: "cleanup", schedule: "0 2 * * *", command: "cleanup" }];

    await trigger.createMultiple(tasks as CronTaskConfig[], "test-agent");

    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(vi.mocked(cronService).add).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "my-service:cleanup",
      }),
    );
  });

  it("should include taskName in payload", async () => {
    const cronService = createMockCronService();
    const manifest = createTestManifestWithoutTrigger();
    const trigger = createServiceCronTrigger({
      serviceId: "test-service",
      manifest,
      cronService,
    });

    const tasks: CronTaskInput[] = [
      { name: "cleanup", schedule: "0 2 * * *", command: "cleanup-data" },
    ];

    await trigger.createMultiple(tasks as CronTaskConfig[], "test-agent");

    expect(vi.mocked(cronService).add).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          taskName: "cleanup",
        }),
      }),
    );
  });

  it("should include taskName in metadata", async () => {
    const cronService = createMockCronService();
    const manifest = createTestManifestWithoutTrigger();
    const trigger = createServiceCronTrigger({
      serviceId: "test-service",
      manifest,
      cronService,
    });

    const tasks: CronTaskInput[] = [
      { name: "cleanup", schedule: "0 2 * * *", command: "cleanup-data" },
    ];

    await trigger.createMultiple(tasks as CronTaskConfig[], "test-agent");

    expect(vi.mocked(cronService).add).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          serviceId: "test-service",
          managedBy: "service-registry",
          triggerType: "cron",
          taskName: "cleanup",
        }),
      }),
    );
  });

  it("should handle tasks with all optional fields", async () => {
    const cronService = createMockCronService();
    const manifest = createTestManifestWithoutTrigger();
    const trigger = createServiceCronTrigger({
      serviceId: "test-service",
      manifest,
      cronService,
    });

    const tasks = [
      {
        name: "full-task",
        schedule: "0 2 * * *",
        command: "run-command",
        enabled: false,
        timezone: "Europe/London",
        description: "A task with all fields set",
        options: { waitForCompletion: true, maxExecutions: 100 },
      },
    ];

    const result = await trigger.createMultiple(tasks, "test-agent");

    expect(result.success).toBe(true);
    expect(vi.mocked(cronService).add).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: false,
        description: "A task with all fields set",
        schedule: expect.objectContaining({
          tz: "Europe/London",
        }),
      }),
    );
  });

  it("should skip tasks with invalid cron schedules and report errors", async () => {
    const cronService = createMockCronService();
    const manifest = createTestManifestWithoutTrigger();
    const trigger = createServiceCronTrigger({
      serviceId: "test-service",
      manifest,
      cronService,
    });

    const tasks: CronTaskInput[] = [
      { name: "valid", schedule: "0 2 * * *", command: "valid-cmd" },
      { name: "invalid", schedule: "not-a-cron", command: "invalid-cmd" },
    ];

    const result = await trigger.createMultiple(tasks as CronTaskConfig[], "test-agent");

    expect(result.success).toBe(false);
    expect(result.jobIds).toHaveLength(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({
      taskName: "invalid",
      error: expect.stringContaining("Invalid cron schedule"),
    });
  });

  it("should skip tasks with invalid timezones and report errors", async () => {
    const cronService = createMockCronService();
    const manifest = createTestManifestWithoutTrigger();
    const trigger = createServiceCronTrigger({
      serviceId: "test-service",
      manifest,
      cronService,
    });

    const tasks: CronTaskInput[] = [
      { name: "valid", schedule: "0 2 * * *", command: "valid-cmd", timezone: "UTC" },
      {
        name: "invalid",
        schedule: "0 3 * * *",
        command: "invalid-cmd",
        timezone: "Invalid/Timezone",
      },
    ];

    const result = await trigger.createMultiple(tasks as CronTaskConfig[], "test-agent");

    expect(result.success).toBe(false);
    expect(result.jobIds).toHaveLength(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({
      taskName: "invalid",
      error: expect.stringContaining("Invalid timezone"),
    });
  });

  it("should handle auto timezone by leaving tz undefined", async () => {
    const cronService = createMockCronService();
    const manifest = createTestManifestWithoutTrigger();
    const trigger = createServiceCronTrigger({
      serviceId: "test-service",
      manifest,
      cronService,
    });

    const tasks: CronTaskInput[] = [
      { name: "auto-tz", schedule: "0 2 * * *", command: "cmd", timezone: "auto" },
    ];

    await trigger.createMultiple(tasks as CronTaskConfig[], "test-agent");

    expect(vi.mocked(cronService).add).toHaveBeenCalledWith(
      expect.objectContaining({
        schedule: expect.objectContaining({
          tz: undefined,
        }),
      }),
    );
  });

  it("should handle undefined timezone by leaving tz undefined", async () => {
    const cronService = createMockCronService();
    const manifest = createTestManifestWithoutTrigger();
    const trigger = createServiceCronTrigger({
      serviceId: "test-service",
      manifest,
      cronService,
    });

    const tasks: CronTaskInput[] = [{ name: "no-tz", schedule: "0 2 * * *", command: "cmd" }];

    await trigger.createMultiple(tasks as CronTaskConfig[], "test-agent");

    expect(vi.mocked(cronService).add).toHaveBeenCalledWith(
      expect.objectContaining({
        schedule: expect.objectContaining({
          tz: undefined,
        }),
      }),
    );
  });

  it("should default enabled to true when not specified", async () => {
    const cronService = createMockCronService();
    const manifest = createTestManifestWithoutTrigger();
    const trigger = createServiceCronTrigger({
      serviceId: "test-service",
      manifest,
      cronService,
    });

    const tasks: CronTaskInput[] = [
      { name: "default-enabled", schedule: "0 2 * * *", command: "cmd" },
    ];

    await trigger.createMultiple(tasks as CronTaskConfig[], "test-agent");

    expect(vi.mocked(cronService).add).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: true,
      }),
    );
  });

  it("should handle CronService.add errors gracefully", async () => {
    const cronService = createMockCronService();
    vi.mocked(cronService).add.mockRejectedValueOnce(new Error("Database error"));

    const manifest = createTestManifestWithoutTrigger();
    const trigger = createServiceCronTrigger({
      serviceId: "test-service",
      manifest,
      cronService,
    });

    const tasks: CronTaskInput[] = [{ name: "failing", schedule: "0 2 * * *", command: "cmd" }];

    const result = await trigger.createMultiple(tasks as CronTaskConfig[], "test-agent");

    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({
      taskName: "failing",
      error: "Database error",
    });
  });

  it("should include service name in payload message", async () => {
    const cronService = createMockCronService();
    const manifest = createTestManifestWithoutTrigger();
    const trigger = createServiceCronTrigger({
      serviceId: "test-service",
      manifest,
      cronService,
    });

    const tasks: CronTaskInput[] = [
      { name: "cleanup", schedule: "0 2 * * *", command: "cleanup-data" },
    ];

    await trigger.createMultiple(tasks as CronTaskConfig[], "test-agent");

    expect(vi.mocked(cronService).add).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          message: "[Service Trigger] Test Service - cleanup",
        }),
      }),
    );
  });

  it("should use sessionTarget from manifest", async () => {
    const cronService = createMockCronService();
    const manifest: ServiceManifest = {
      ...createTestManifestWithoutTrigger(),
      execution: { agentId: "test-agent", sessionTarget: "main" },
    };
    const trigger = createServiceCronTrigger({
      serviceId: "test-service",
      manifest,
      cronService,
    });

    const tasks: CronTaskInput[] = [
      { name: "main-session", schedule: "0 2 * * *", command: "cmd" },
    ];

    await trigger.createMultiple(tasks as CronTaskConfig[], "test-agent");

    expect(vi.mocked(cronService).add).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionTarget: "main",
      }),
    );
  });

  it("should default to isolated session target", async () => {
    const cronService = createMockCronService();
    const manifest = createTestManifestWithoutTrigger();
    delete (manifest as { execution?: { sessionTarget?: string } }).execution?.sessionTarget;

    const trigger = createServiceCronTrigger({
      serviceId: "test-service",
      manifest,
      cronService,
    });

    const tasks: CronTaskInput[] = [
      { name: "isolated-session", schedule: "0 2 * * *", command: "cmd" },
    ];

    await trigger.createMultiple(tasks as CronTaskConfig[], "test-agent");

    expect(vi.mocked(cronService).add).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionTarget: "isolated",
      }),
    );
  });

  it("should handle tasks without description (no description field in job)", async () => {
    const cronService = createMockCronService();
    const manifest = createTestManifestWithoutTrigger();
    const trigger = createServiceCronTrigger({
      serviceId: "test-service",
      manifest,
      cronService,
    });

    const tasks: CronTaskInput[] = [{ name: "no-desc", schedule: "0 2 * * *", command: "cmd" }];

    await trigger.createMultiple(tasks as CronTaskConfig[], "test-agent");

    const call = vi.mocked(cronService).add.mock.calls[0][0] as { description?: string };
    expect(call.description).toBeUndefined();
  });
});
