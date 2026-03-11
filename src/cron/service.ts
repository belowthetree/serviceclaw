import * as ops from "./service/ops.js";
import { type CronServiceDeps, createCronServiceState } from "./service/state.js";
import type {
  CronBulkOperationResult,
  CronJob,
  CronJobCreate,
  CronJobPatch,
  CronListByServiceOptions,
} from "./types.js";

export type { CronEvent, CronServiceDeps } from "./service/state.js";

export class CronService {
  private readonly state;
  constructor(deps: CronServiceDeps) {
    this.state = createCronServiceState(deps);
  }

  async start() {
    await ops.start(this.state);
  }

  stop() {
    ops.stop(this.state);
  }

  async status() {
    return await ops.status(this.state);
  }

  async list(opts?: { includeDisabled?: boolean }) {
    return await ops.list(this.state, opts);
  }

  async listPage(opts?: ops.CronListPageOptions) {
    return await ops.listPage(this.state, opts);
  }

  async listByService(opts: CronListByServiceOptions): Promise<CronJob[]> {
    const allJobs = await this.list({ includeDisabled: opts.includeDisabled });
    return allJobs.filter((job) => job.metadata?.serviceId === opts.serviceId);
  }

  async add(input: CronJobCreate) {
    return await ops.add(this.state, input);
  }

  async update(id: string, patch: CronJobPatch) {
    return await ops.update(this.state, id, patch);
  }

  async remove(id: string) {
    return await ops.remove(this.state, id);
  }

  async disableByService(serviceId: string): Promise<CronBulkOperationResult> {
    const jobs = await this.listByService({ serviceId, includeDisabled: false });
    const result: CronBulkOperationResult = {
      success: true,
      affectedCount: 0,
      errors: [],
    };

    for (const job of jobs) {
      try {
        await this.update(job.id, { enabled: false });
        result.affectedCount++;
      } catch (error) {
        result.errors.push({
          jobId: job.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    result.success = result.errors.length === 0;
    return result;
  }

  async enableByService(serviceId: string): Promise<CronBulkOperationResult> {
    const jobs = await this.listByService({ serviceId, includeDisabled: true });
    const result: CronBulkOperationResult = {
      success: true,
      affectedCount: 0,
      errors: [],
    };

    for (const job of jobs) {
      if (job.enabled) {
        continue;
      }
      try {
        await this.update(job.id, { enabled: true });
        result.affectedCount++;
      } catch (error) {
        result.errors.push({
          jobId: job.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    result.success = result.errors.length === 0;
    return result;
  }

  async removeByService(serviceId: string): Promise<CronBulkOperationResult> {
    const jobs = await this.listByService({ serviceId, includeDisabled: true });
    const result: CronBulkOperationResult = {
      success: true,
      affectedCount: 0,
      errors: [],
    };

    for (const job of jobs) {
      try {
        await this.remove(job.id);
        result.affectedCount++;
      } catch (error) {
        result.errors.push({
          jobId: job.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    result.success = result.errors.length === 0;
    return result;
  }

  async run(id: string, mode?: "due" | "force") {
    return await ops.run(this.state, id, mode);
  }

  async enqueueRun(id: string, mode?: "due" | "force") {
    return await ops.enqueueRun(this.state, id, mode);
  }

  getJob(id: string): CronJob | undefined {
    return this.state.store?.jobs.find((job) => job.id === id);
  }

  wake(opts: { mode: "now" | "next-heartbeat"; text: string }) {
    return ops.wakeNow(this.state, opts);
  }
}
