import type { CronService } from "../../cron/service.js";
import type {
  CronBulkOperationResult,
  CronJob,
  CronJobCreate,
  CronJobMetadata,
} from "../../cron/types.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import type { CronTaskConfig, CronTrigger, ServiceManifest } from "../schema.js";

const logger = createSubsystemLogger("services:triggers:cron");

export type CronTriggerCreateResult = {
  success: boolean;
  jobId?: string;
  error?: string;
};

export type CronMultipleCreateResult = {
  success: boolean;
  jobIds: string[];
  errors: Array<{ taskName: string; error: string }>;
};

export class ServiceCronTrigger {
  private readonly cronService: CronService;
  private readonly serviceId: string;
  private readonly manifest: ServiceManifest;
  private jobIds: string[] = [];

  constructor(params: { serviceId: string; manifest: ServiceManifest; cronService: CronService }) {
    this.serviceId = params.serviceId;
    this.manifest = params.manifest;
    this.cronService = params.cronService;
  }

  async create(agentId: string): Promise<CronTriggerCreateResult> {
    const trigger = this.manifest.trigger as CronTrigger;

    const validation = this.validateSchedule(trigger.schedule);
    if (!validation.valid) {
      return {
        success: false,
        error: `Invalid cron schedule: ${validation.error}`,
      };
    }

    const metadata: CronJobMetadata = {
      serviceId: this.serviceId,
      managedBy: "service-registry",
      triggerType: "cron",
    };

    const sessionTarget = this.manifest.execution?.sessionTarget;
    const cronJob: CronJobCreate = {
      name: this.manifest.name,
      agentId,
      sessionTarget:
        sessionTarget === "main" || sessionTarget === "isolated" ? sessionTarget : "isolated",
      enabled: true,
      wakeMode: "next-heartbeat",
      schedule: {
        kind: "cron",
        expr: trigger.schedule,
        tz: trigger.timezone === "auto" ? undefined : trigger.timezone,
      },
      payload: {
        kind: "agentTurn",
        message: `[Service Trigger] ${this.manifest.name}`,
        deliver: false,
      },
      metadata,
    };

    try {
      const job = await this.cronService.add(cronJob);
      this.jobIds.push(job.id);
      logger.info(`Created cron job ${job.id} for service ${this.serviceId}`);
      return { success: true, jobId: job.id };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to create cron job for service ${this.serviceId}: ${errorMsg}`);
      return { success: false, error: errorMsg };
    }
  }

  /**
   * Creates multiple cron jobs for a service based on task configurations.
   * Each task gets a unique job name in the format `{serviceId}:{taskName}`.
   * @param tasks - Array of cron task configurations
   * @param agentId - The agent ID to associate with the jobs
   * @returns Result object with job IDs and any errors
   */
  async createMultiple(
    tasks: CronTaskConfig[],
    agentId: string,
  ): Promise<CronMultipleCreateResult> {
    const result: CronMultipleCreateResult = {
      success: true,
      jobIds: [],
      errors: [],
    };

    if (tasks.length === 0) {
      return result;
    }

    const sessionTarget = this.manifest.execution?.sessionTarget;

    for (const task of tasks) {
      if (!this.validateSchedule(task.schedule).valid) {
        const error = `Invalid cron schedule: "${task.schedule}"`;
        logger.warn(`Skipping task "${task.name}" for service ${this.serviceId}: ${error}`);
        result.errors.push({ taskName: task.name, error });
        result.success = false;
        continue;
      }

      const tzValidation = this.validateTimezone(task.timezone);
      if (!tzValidation.valid) {
        logger.warn(
          `Skipping task "${task.name}" for service ${this.serviceId}: ${tzValidation.error}`,
        );
        result.errors.push({
          taskName: task.name,
          error: tzValidation.error ?? "Invalid timezone",
        });
        result.success = false;
        continue;
      }

      const metadata: CronJobMetadata = {
        serviceId: this.serviceId,
        managedBy: "service-registry",
        triggerType: "cron",
        taskName: task.name,
      };

      const jobName = `${this.serviceId}:${task.name}`;
      const cronJob: CronJobCreate = {
        name: jobName,
        agentId,
        sessionTarget:
          sessionTarget === "main" || sessionTarget === "isolated" ? sessionTarget : "isolated",
        enabled: task.enabled ?? true,
        wakeMode: "next-heartbeat",
        schedule: {
          kind: "cron",
          expr: task.schedule,
          tz: task.timezone === "auto" || !task.timezone ? undefined : task.timezone,
        },
        payload: {
          kind: "agentTurn",
          message: `[Service Trigger] ${this.manifest.name} - ${task.name}`,
          taskName: task.name,
          deliver: false,
        },
        metadata,
        ...(task.description && { description: task.description }),
      };

      try {
        const job = await this.cronService.add(cronJob);
        this.jobIds.push(job.id);
        result.jobIds.push(job.id);
        logger.info(
          `Created cron job ${job.id} for task "${task.name}" in service ${this.serviceId}`,
        );
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.error(
          `Failed to create cron job for task "${task.name}" in service ${this.serviceId}: ${errorMsg}`,
        );
        result.errors.push({ taskName: task.name, error: errorMsg });
        result.success = false;
      }
    }

    return result;
  }

  validateSchedule(schedule: string): { valid: boolean; error?: string } {
    if (!schedule || schedule.length < 3) {
      return { valid: false, error: "Schedule must be at least 3 characters" };
    }

    const parts = schedule.split(/\s+/);
    if (parts.length < 5 || parts.length > 6) {
      return {
        valid: false,
        error: `Invalid cron expression: expected 5-6 fields, got ${parts.length}`,
      };
    }

    const specialChars = /^[\d*,\-/]+$/;
    for (const part of parts) {
      if (!specialChars.test(part) && !this.isValidCronField(part)) {
        return { valid: false, error: `Invalid cron field: ${part}` };
      }
    }

    return { valid: true };
  }

  private isValidCronField(field: string): boolean {
    const validSpecials = new Set(["*", "?", "L", "W", "#"]);
    const validStrings = [
      "@yearly",
      "@annually",
      "@monthly",
      "@weekly",
      "@daily",
      "@hourly",
      "@reboot",
    ];

    if (validStrings.includes(field)) {
      return true;
    }

    for (const char of field) {
      if (validSpecials.has(char)) {
        continue;
      }
      if (/\d/.test(char)) {
        continue;
      }
      if (",-/.".includes(char)) {
        continue;
      }
      return false;
    }

    return true;
  }

  validateTimezone(timezone: string): { valid: boolean; error?: string } {
    if (timezone === "auto" || timezone === undefined) {
      return { valid: true };
    }

    try {
      Intl.DateTimeFormat(undefined, { timeZone: timezone });
      return { valid: true };
    } catch {
      return { valid: false, error: `Invalid timezone: ${timezone}` };
    }
  }

  async getJobs(): Promise<CronJob[]> {
    return this.cronService.listByService({
      serviceId: this.serviceId,
      includeDisabled: true,
    });
  }

  async disable(): Promise<CronBulkOperationResult> {
    logger.info(`Disabling cron jobs for service ${this.serviceId}`);
    return this.cronService.disableByService(this.serviceId);
  }

  async enable(): Promise<CronBulkOperationResult> {
    logger.info(`Enabling cron jobs for service ${this.serviceId}`);
    return this.cronService.enableByService(this.serviceId);
  }

  async remove(): Promise<CronBulkOperationResult> {
    logger.info(`Removing cron jobs for service ${this.serviceId}`);
    return this.cronService.removeByService(this.serviceId);
  }

  async hasJobs(): Promise<boolean> {
    const jobs = await this.getJobs();
    return jobs.length > 0;
  }

  async getJobCount(): Promise<number> {
    const jobs = await this.getJobs();
    return jobs.length;
  }
}

export function createServiceCronTrigger(params: {
  serviceId: string;
  manifest: ServiceManifest;
  cronService: CronService;
}): ServiceCronTrigger {
  return new ServiceCronTrigger(params);
}
