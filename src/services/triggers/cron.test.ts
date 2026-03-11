import { describe, expect, it, vi } from "vitest";
import type { CronService } from "../../cron/service.js";
import type { CronJob, CronJobCreate } from "../../cron/types.js";
import type { CronTrigger, ServiceManifest } from "../schema.js";
import { ServiceCronTrigger, createServiceCronTrigger } from "./cron.js";

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
