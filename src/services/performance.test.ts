/**
 * Service Performance Tests
 *
 * Performance benchmarks for the Service lifecycle system.
 * Tests installation time, startup time, concurrent operations, and memory usage.
 *
 * Performance Criteria:
 * - Service install: <30 seconds
 * - Service startup: <5 seconds
 * - 10 concurrent Services: no degradation
 * - Memory usage: reasonable limits
 *
 * @see docs/services/performance.md
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { CronService } from "../cron/service.js";
import type { CronJob, CronJobCreate } from "../cron/types.js";
import { clearInternalHooks } from "../hooks/internal-hooks.js";
import type { PluginRegistry } from "../plugins/registry.js";
import { Service, type ServiceLifecycleDeps } from "./lifecycle.js";
import type { ServiceManifest, ServiceConfig } from "./schema.js";

// =============================================================================
// Performance Constants
// =============================================================================

const MAX_INSTALL_TIME_MS = 30_000;
const MAX_STARTUP_TIME_MS = 5_000;
const CONCURRENT_SERVICE_COUNT = 10;
const MAX_MEMORY_PER_SERVICE_BYTES = 5 * 1024 * 1024;
const MAX_CONCURRENT_OPERATION_TIME_MS = 1_000;

// =============================================================================
// Test Fixtures
// =============================================================================

function mockCronService(): CronService {
  const jobs: CronJob[] = [];
  let jobCounter = 0;

  return {
    add: vi.fn(async (input: CronJobCreate) => {
      const job: CronJob = {
        id: `${input.agentId}:cron:${jobCounter++}`,
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
    remove: vi.fn(async (jobId: string) => {
      const index = jobs.findIndex((j) => j.id === jobId);
      if (index >= 0) {
        jobs.splice(index, 1);
      }
      return { ok: true, removed: index >= 0 };
    }),
    list: vi.fn().mockResolvedValue([]),
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockReturnValue(undefined),
    status: vi.fn().mockResolvedValue({ status: "running", jobs: 0 }),
    update: vi.fn().mockResolvedValue(undefined),
    run: vi.fn().mockResolvedValue(undefined),
    enqueueRun: vi.fn().mockResolvedValue(undefined),
    getJob: vi.fn().mockReturnValue(undefined),
    wake: vi.fn().mockReturnValue(undefined),
    listPage: vi.fn().mockResolvedValue({ jobs: [], nextCursor: undefined }),
    disableByService: vi.fn().mockResolvedValue({ success: true, affectedCount: 0, errors: [] }),
    enableByService: vi.fn().mockResolvedValue({ success: true, affectedCount: 0, errors: [] }),
    listByService: vi.fn(async ({ serviceId }: { serviceId: string }) => {
      return jobs.filter((job) => job.metadata?.serviceId === serviceId);
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
  } as unknown as CronService;
}

const mockPluginRegistry = (): PluginRegistry =>
  ({
    httpRoutes: [],
    plugins: new Map(),
  }) as unknown as PluginRegistry;

const createMockDeps = (): ServiceLifecycleDeps => ({
  cronService: mockCronService(),
  pluginRegistry: mockPluginRegistry(),
});

const createBaseManifest = (id: string): ServiceManifest => ({
  id,
  name: `Test Service ${id}`,
  description: `A test service for performance testing (${id})`,
  version: "1.0.0",
  author: "Test",
  category: "custom",
  trigger: {
    type: "cron",
    schedule: "0 8 * * *",
    timezone: "auto",
  },
  config: {
    testField: {
      type: "string",
      description: "Test field",
      required: true,
    },
  },
  requires: {
    skills: [],
    tools: [],
  },
  capabilities: {
    network: false,
    filesystem: false,
  },
  execution: {
    agentId: `service:${id}`,
    sessionTarget: "isolated",
    timeout: 30000,
  },
});

const createWebhookManifest = (id: string): ServiceManifest => ({
  ...createBaseManifest(id),
  trigger: {
    type: "webhook",
    path: `/webhooks/${id}`,
    methods: ["POST"],
    auth: {
      type: "none",
    },
  },
});

const createMessageManifest = (id: string): ServiceManifest => ({
  ...createBaseManifest(id),
  trigger: {
    type: "message",
    channels: ["slack", "discord"],
    filters: {
      keywords: ["!test"],
    },
  },
});

const baseConfig: ServiceConfig = {
  testField: "test value",
};

// =============================================================================
// Performance Utilities
// =============================================================================

/**
 * Measure execution time of an async function
 */
async function measureTime<T>(fn: () => Promise<T>): Promise<{ result: T; durationMs: number }> {
  const start = performance.now();
  const result = await fn();
  const durationMs = performance.now() - start;
  return { result, durationMs };
}

/**
 * Get current memory usage (Node.js only)
 */
function getMemoryUsage(): {
  heapUsed: number;
  heapTotal: number;
  external: number;
  rss: number;
} {
  const usage = process.memoryUsage();
  return {
    heapUsed: usage.heapUsed,
    heapTotal: usage.heapTotal,
    external: usage.external,
    rss: usage.rss,
  };
}

/**
 * Calculate memory delta between two measurements
 */
function calculateMemoryDelta(
  before: ReturnType<typeof getMemoryUsage>,
  after: ReturnType<typeof getMemoryUsage>,
): {
  heapUsedDelta: number;
  heapTotalDelta: number;
  externalDelta: number;
  rssDelta: number;
} {
  return {
    heapUsedDelta: after.heapUsed - before.heapUsed,
    heapTotalDelta: after.heapTotal - before.heapTotal,
    externalDelta: after.external - before.external,
    rssDelta: after.rss - before.rss,
  };
}

/**
 * Run garbage collection if available
 */
function forceGarbageCollection(): void {
  if (global.gc) {
    global.gc();
  }
}

// =============================================================================
// Installation Performance Tests
// =============================================================================

describe("Service Installation Performance", () => {
  beforeEach(() => {
    clearInternalHooks();
    vi.clearAllMocks();
    forceGarbageCollection();
  });

  afterEach(() => {
    forceGarbageCollection();
  });

  describe("Single Service Installation", () => {
    it("should install cron service in under 30 seconds", async () => {
      const deps = createMockDeps();
      const manifest = createBaseManifest("perf-cron-test");
      const service = new Service(manifest, baseConfig, deps);

      const { durationMs } = await measureTime(() => service.install());

      expect(durationMs).toBeLessThan(MAX_INSTALL_TIME_MS);
      expect(service.state).toBe("installed");

      console.log(`Cron service installation time: ${durationMs.toFixed(2)}ms`);
    });

    it("should install webhook service in under 30 seconds", async () => {
      const deps = createMockDeps();
      const manifest = createWebhookManifest("perf-webhook-test");
      const service = new Service(manifest, baseConfig, deps);

      const { durationMs } = await measureTime(() => service.install());

      expect(durationMs).toBeLessThan(MAX_INSTALL_TIME_MS);
      expect(service.state).toBe("installed");

      console.log(`Webhook service installation time: ${durationMs.toFixed(2)}ms`);
    });

    it("should install message service in under 30 seconds", async () => {
      const deps = createMockDeps();
      const manifest = createMessageManifest("perf-message-test");
      const service = new Service(manifest, baseConfig, deps);

      const { durationMs } = await measureTime(() => service.install());

      expect(durationMs).toBeLessThan(MAX_INSTALL_TIME_MS);
      expect(service.state).toBe("installed");

      console.log(`Message service installation time: ${durationMs.toFixed(2)}ms`);
    });
  });

  describe("Installation Memory Usage", () => {
    it("should use reasonable memory during installation", async () => {
      const deps = createMockDeps();
      const manifest = createBaseManifest("perf-memory-test");

      forceGarbageCollection();
      const memoryBefore = getMemoryUsage();

      const service = new Service(manifest, baseConfig, deps);
      await service.install();

      forceGarbageCollection();
      const memoryAfter = getMemoryUsage();
      const delta = calculateMemoryDelta(memoryBefore, memoryAfter);

      // Memory increase should be reasonable (less than 10MB)
      expect(delta.heapUsedDelta).toBeLessThan(10 * 1024 * 1024);
      expect(delta.rssDelta).toBeLessThan(10 * 1024 * 1024);

      console.log(
        `Installation memory delta: ${(delta.heapUsedDelta / 1024 / 1024).toFixed(2)}MB heap`,
      );
    });
  });

  describe("Installation Phase Performance", () => {
    it("should complete validation phase quickly", async () => {
      const deps = createMockDeps();
      const manifest = createBaseManifest("perf-validation-test");
      const service = new Service(manifest, baseConfig, deps);

      const { durationMs } = await measureTime(() => service.validate());

      // Validation should be very fast (<100ms)
      expect(durationMs).toBeLessThan(100);
      console.log(`Validation phase time: ${durationMs.toFixed(2)}ms`);
    });

    it("should track installation phases efficiently", async () => {
      const deps = createMockDeps();
      const manifest = createBaseManifest("perf-phases-test");

      const phaseTimings: Array<{ phase: string; durationMs: number }> = [];
      const startTime = performance.now();

      // Track validation phase separately (validation + install through ServiceInstaller)
      const validationStart = performance.now();
      const service = new Service(manifest, baseConfig, deps);
      await service.validate();
      phaseTimings.push({ phase: "validation", durationMs: performance.now() - validationStart });

      // Track installation phase (separate service instance to avoid double validation)
      const installStart = performance.now();
      const service2 = new Service(manifest, baseConfig, deps);
      await service2.install();
      phaseTimings.push({ phase: "installation", durationMs: performance.now() - installStart });

      const totalDuration = performance.now() - startTime;

      expect(totalDuration).toBeLessThan(MAX_INSTALL_TIME_MS);

      console.log(
        "Installation phase timings:",
        phaseTimings.map((p) => `${p.phase}: ${p.durationMs.toFixed(2)}ms`).join(", "),
      );
    });
  });
});

// =============================================================================
// Startup Performance Tests
// =============================================================================

describe("Service Startup Performance", () => {
  beforeEach(() => {
    clearInternalHooks();
    vi.clearAllMocks();
    forceGarbageCollection();
  });

  afterEach(() => {
    forceGarbageCollection();
  });

  describe("Service Enable/Disable Performance", () => {
    it("should enable service in under 5 seconds", async () => {
      const deps = createMockDeps();
      const manifest = createBaseManifest("perf-startup-test");
      const service = new Service(manifest, baseConfig, deps);

      await service.install();

      const { durationMs } = await measureTime(() => service.enable());

      expect(durationMs).toBeLessThan(MAX_STARTUP_TIME_MS);
      expect(service.state).toBe("enabled");

      console.log(`Service enable time: ${durationMs.toFixed(2)}ms`);
    });

    it("should disable service quickly", async () => {
      const deps = createMockDeps();
      const manifest = createBaseManifest("perf-disable-test");
      const service = new Service(manifest, baseConfig, deps);

      await service.install();
      await service.enable();

      const { durationMs } = await measureTime(() => service.disable());

      expect(durationMs).toBeLessThan(1000);
      expect(service.state).toBe("disabled");

      console.log(`Service disable time: ${durationMs.toFixed(2)}ms`);
    });
  });

  describe("Full Startup Sequence", () => {
    it("should complete install + enable in under 30 seconds", async () => {
      const deps = createMockDeps();
      const manifest = createBaseManifest("perf-full-startup-test");
      const service = new Service(manifest, baseConfig, deps);

      const { durationMs } = await measureTime(async () => {
        await service.install();
        await service.enable();
      });

      expect(durationMs).toBeLessThan(MAX_INSTALL_TIME_MS);
      expect(service.state).toBe("enabled");

      console.log(`Full startup time (install + enable): ${durationMs.toFixed(2)}ms`);
    });

    it("should handle multiple start/stop cycles efficiently", async () => {
      const deps = createMockDeps();
      const manifest = createBaseManifest("perf-cycles-test");
      const service = new Service(manifest, baseConfig, deps);

      await service.install();

      const cycleTimings: number[] = [];

      for (let i = 0; i < 5; i++) {
        const startTime = performance.now();
        await service.enable();
        await service.disable();
        cycleTimings.push(performance.now() - startTime);
      }

      const avgCycleTime = cycleTimings.reduce((a, b) => a + b, 0) / cycleTimings.length;

      expect(avgCycleTime).toBeLessThan(MAX_STARTUP_TIME_MS);

      console.log(`Average enable/disable cycle time: ${avgCycleTime.toFixed(2)}ms`);
      console.log(`Cycle times: ${cycleTimings.map((t) => `${t.toFixed(0)}ms`).join(", ")}`);
    });
  });
});

// =============================================================================
// Concurrent Service Performance Tests
// =============================================================================

describe("Concurrent Service Performance", () => {
  beforeEach(() => {
    clearInternalHooks();
    vi.clearAllMocks();
    forceGarbageCollection();
  });

  afterEach(() => {
    forceGarbageCollection();
  });

  describe("Concurrent Installation", () => {
    it("should handle 10 concurrent service installations", async () => {
      const deps = createMockDeps();
      const services: Service[] = [];

      // Create 10 services
      for (let i = 0; i < CONCURRENT_SERVICE_COUNT; i++) {
        const manifest = createBaseManifest(`concurrent-${i}`);
        services.push(new Service(manifest, baseConfig, deps));
      }

      const startTime = performance.now();

      // Install all services concurrently
      const results = await Promise.all(services.map((service) => service.install()));

      const totalDuration = performance.now() - startTime;
      const avgDuration = totalDuration / CONCURRENT_SERVICE_COUNT;

      // All services should be installed
      expect(results.every((r) => r.success)).toBe(true);
      expect(services.every((s) => s.state === "installed")).toBe(true);

      // Average time per service should not degrade significantly
      expect(avgDuration).toBeLessThan(MAX_CONCURRENT_OPERATION_TIME_MS);

      console.log(`Concurrent installation of ${CONCURRENT_SERVICE_COUNT} services:`);
      console.log(`  Total time: ${totalDuration.toFixed(2)}ms`);
      console.log(`  Average per service: ${avgDuration.toFixed(2)}ms`);
    });

    it("should handle mixed trigger types concurrently", async () => {
      const deps = createMockDeps();
      const services: Service[] = [];

      // Create services with different trigger types
      for (let i = 0; i < CONCURRENT_SERVICE_COUNT; i++) {
        let manifest: ServiceManifest;
        if (i % 3 === 0) {
          manifest = createBaseManifest(`mixed-cron-${i}`);
        } else if (i % 3 === 1) {
          manifest = createWebhookManifest(`mixed-webhook-${i}`);
        } else {
          manifest = createMessageManifest(`mixed-message-${i}`);
        }
        services.push(new Service(manifest, baseConfig, deps));
      }

      const startTime = performance.now();

      await Promise.all(services.map((service) => service.install()));

      const totalDuration = performance.now() - startTime;

      expect(totalDuration).toBeLessThan(MAX_INSTALL_TIME_MS * 2); // Allow some overhead

      console.log(`Mixed trigger concurrent installation: ${totalDuration.toFixed(2)}ms`);
    });
  });

  describe("Concurrent Enable/Disable", () => {
    it("should handle concurrent enable operations", async () => {
      const deps = createMockDeps();
      const services: Service[] = [];

      // Create and install 10 services
      for (let i = 0; i < CONCURRENT_SERVICE_COUNT; i++) {
        const manifest = createBaseManifest(`concurrent-enable-${i}`);
        const service = new Service(manifest, baseConfig, deps);
        await service.install();
        services.push(service);
      }

      const startTime = performance.now();

      // Enable all services concurrently
      await Promise.all(services.map((service) => service.enable()));

      const totalDuration = performance.now() - startTime;

      expect(services.every((s) => s.state === "enabled")).toBe(true);
      expect(totalDuration).toBeLessThan(MAX_STARTUP_TIME_MS * 2);

      console.log(
        `Concurrent enable of ${CONCURRENT_SERVICE_COUNT} services: ${totalDuration.toFixed(2)}ms`,
      );
    });

    it("should handle concurrent lifecycle operations without interference", async () => {
      const deps = createMockDeps();
      const services: Service[] = [];

      const startTime = performance.now();

      // Install and enable services sequentially but quickly
      for (let i = 0; i < CONCURRENT_SERVICE_COUNT; i++) {
        const manifest = createBaseManifest(`lifecycle-${i}`);
        const service = new Service(manifest, baseConfig, deps);
        await service.install();
        await service.enable();
        services.push(service);
      }

      const installDuration = performance.now() - startTime;

      // All services should be enabled
      expect(services.every((s) => s.state === "enabled")).toBe(true);

      // Should complete within reasonable time (< 30 seconds total)
      expect(installDuration).toBeLessThan(MAX_INSTALL_TIME_MS);

      console.log(
        `Sequential full lifecycle (${CONCURRENT_SERVICE_COUNT} services): ${installDuration.toFixed(2)}ms`,
      );
    });
  });

  describe("Performance Under Load", () => {
    it("should maintain performance with 10 active services", async () => {
      const deps = createMockDeps();
      const services: Service[] = [];

      // Install and enable 10 services
      for (let i = 0; i < CONCURRENT_SERVICE_COUNT; i++) {
        const manifest = createBaseManifest(`load-test-${i}`);
        const service = new Service(manifest, baseConfig, deps);
        await service.install();
        await service.enable();
        services.push(service);
      }

      // Measure time to execute an operation with 10 active services
      const operationStart = performance.now();

      // Simulate some operations on all services
      for (const service of services) {
        service.recordSuccess();
      }

      const operationDuration = performance.now() - operationStart;

      // Operations should complete quickly even with many active services
      expect(operationDuration).toBeLessThan(100);

      console.log(
        `Operation time with ${CONCURRENT_SERVICE_COUNT} active services: ${operationDuration.toFixed(2)}ms`,
      );
    });

    it("should not show degradation with sequential operations", async () => {
      const deps = createMockDeps();
      const timings: number[] = [];

      // Install services one by one and measure time
      for (let i = 0; i < CONCURRENT_SERVICE_COUNT; i++) {
        const manifest = createBaseManifest(`sequential-${i}`);
        const service = new Service(manifest, baseConfig, deps);

        const { durationMs } = await measureTime(() => service.install());
        timings.push(durationMs);
      }

      // Calculate average and variance
      const avg = timings.reduce((a, b) => a + b, 0) / timings.length;
      const variance = timings.reduce((sum, t) => sum + Math.pow(t - avg, 2), 0) / timings.length;
      const stdDev = Math.sqrt(variance);

      // Standard deviation should be low (consistent performance)
      expect(stdDev / avg).toBeLessThan(0.5); // CV < 50%

      console.log(
        `Sequential installation times: ${timings.map((t) => `${t.toFixed(0)}ms`).join(", ")}`,
      );
      console.log(`Average: ${avg.toFixed(2)}ms, StdDev: ${stdDev.toFixed(2)}ms`);
    });
  });
});

// =============================================================================
// Memory Usage Tests
// =============================================================================

describe("Service Memory Usage", () => {
  beforeEach(() => {
    clearInternalHooks();
    vi.clearAllMocks();
    forceGarbageCollection();
  });

  afterEach(() => {
    forceGarbageCollection();
  });

  describe("Per-Service Memory Overhead", () => {
    it("should have reasonable memory overhead per service", async () => {
      const deps = createMockDeps();

      forceGarbageCollection();
      const memoryBefore = getMemoryUsage();

      // Install multiple services
      const services: Service[] = [];
      for (let i = 0; i < 5; i++) {
        const manifest = createBaseManifest(`memory-test-${i}`);
        const service = new Service(manifest, baseConfig, deps);
        await service.install();
        services.push(service);
      }

      forceGarbageCollection();
      const memoryAfter = getMemoryUsage();
      const delta = calculateMemoryDelta(memoryBefore, memoryAfter);

      // Calculate per-service overhead
      const perServiceHeap = delta.heapUsedDelta / 5;
      const perServiceRSS = delta.rssDelta / 5;

      expect(perServiceHeap).toBeLessThan(MAX_MEMORY_PER_SERVICE_BYTES);
      expect(perServiceRSS).toBeLessThan(MAX_MEMORY_PER_SERVICE_BYTES);

      console.log(`Per-service memory overhead:`);
      console.log(`  Heap: ${(perServiceHeap / 1024).toFixed(2)}KB`);
      console.log(`  RSS: ${(perServiceRSS / 1024).toFixed(2)}KB`);
    });

    it("should release memory on uninstall", async () => {
      const deps = createMockDeps();

      // Install a service
      const manifest = createBaseManifest("memory-release-test");
      const service = new Service(manifest, baseConfig, deps);
      await service.install();

      forceGarbageCollection();
      const memoryAfterInstall = getMemoryUsage();

      // Uninstall the service
      await service.uninstall();

      forceGarbageCollection();
      const memoryAfterUninstall = getMemoryUsage();

      // Memory should be released (or at least not significantly increased)
      const delta = calculateMemoryDelta(memoryAfterInstall, memoryAfterUninstall);

      expect(delta.heapUsedDelta).toBeLessThan(1024 * 1024); // Less than 1MB increase

      console.log(`Memory delta after uninstall: ${(delta.heapUsedDelta / 1024).toFixed(2)}KB`);
    });
  });

  describe("Memory with Concurrent Services", () => {
    it("should scale memory linearly with concurrent services", async () => {
      const deps = createMockDeps();
      const serviceCounts = [1, 5, 10];
      const memoryMeasurements: Array<{ count: number; heapUsed: number; rss: number }> = [];

      for (const count of serviceCounts) {
        forceGarbageCollection();
        const memoryBefore = getMemoryUsage();

        // Install services
        const services: Service[] = [];
        for (let i = 0; i < count; i++) {
          const manifest = createBaseManifest(`scale-test-${count}-${i}`);
          const service = new Service(manifest, baseConfig, deps);
          await service.install();
          services.push(service);
        }

        forceGarbageCollection();
        const memoryAfter = getMemoryUsage();
        const delta = calculateMemoryDelta(memoryBefore, memoryAfter);

        memoryMeasurements.push({
          count,
          heapUsed: delta.heapUsedDelta,
          rss: delta.rssDelta,
        });

        // Cleanup
        for (const service of services) {
          await service.uninstall();
        }
      }

      // Check that memory scales roughly linearly
      if (memoryMeasurements.length >= 2) {
        const first = memoryMeasurements[0];
        const last = memoryMeasurements[memoryMeasurements.length - 1];
        const ratio = last.heapUsed / first.heapUsed;
        const expectedRatio = last.count / first.count;

        // Allow 2x variance for non-linear scaling detection
        expect(ratio).toBeLessThan(expectedRatio * 2);

        console.log("Memory scaling measurements:");
        for (const m of memoryMeasurements) {
          console.log(`  ${m.count} services: ${(m.heapUsed / 1024).toFixed(2)}KB heap`);
        }
        console.log(`Scaling ratio: ${ratio.toFixed(2)} (expected ~${expectedRatio})`);
      }
    });
  });

  describe("Runtime Memory Stability", () => {
    it("should have stable memory during operations", async () => {
      const deps = createMockDeps();
      const manifest = createBaseManifest("stability-test");
      const service = new Service(manifest, baseConfig, deps);

      await service.install();
      await service.enable();

      forceGarbageCollection();
      const memoryBefore = getMemoryUsage();

      // Perform multiple operations
      for (let i = 0; i < 100; i++) {
        service.recordSuccess();
      }

      forceGarbageCollection();
      const memoryAfter = getMemoryUsage();
      const delta = calculateMemoryDelta(memoryBefore, memoryAfter);

      // Memory increase should be minimal (<100KB for 100 operations)
      expect(delta.heapUsedDelta).toBeLessThan(100 * 1024);

      console.log(
        `Memory delta after 100 operations: ${(delta.heapUsedDelta / 1024).toFixed(2)}KB`,
      );
    });
  });
});

// =============================================================================
// Stress Tests
// =============================================================================

describe("Service Stress Tests", () => {
  beforeEach(() => {
    clearInternalHooks();
    vi.clearAllMocks();
    forceGarbageCollection();
  });

  afterEach(() => {
    forceGarbageCollection();
  });

  describe("Rapid Lifecycle Operations", () => {
    it("should handle rapid install/uninstall cycles", async () => {
      const deps = createMockDeps();
      const manifest = createBaseManifest("rapid-lifecycle-test");
      const timings: number[] = [];

      for (let i = 0; i < 10; i++) {
        const service = new Service(manifest, baseConfig, deps);

        const cycleStart = performance.now();
        await service.install();
        await service.enable();
        await service.disable();
        await service.uninstall();
        timings.push(performance.now() - cycleStart);
      }

      const avgTime = timings.reduce((a, b) => a + b, 0) / timings.length;

      expect(avgTime).toBeLessThan(MAX_INSTALL_TIME_MS / 2);

      console.log(`Rapid lifecycle average: ${avgTime.toFixed(2)}ms`);
    });
  });

  describe("Bulk Operations", () => {
    it("should handle bulk enable/disable efficiently", async () => {
      const deps = createMockDeps();
      const services: Service[] = [];

      // Create and install 20 services
      for (let i = 0; i < 20; i++) {
        const manifest = createBaseManifest(`bulk-${i}`);
        const service = new Service(manifest, baseConfig, deps);
        await service.install();
        services.push(service);
      }

      // Bulk enable
      const enableStart = performance.now();
      await Promise.all(services.map((s) => s.enable()));
      const enableDuration = performance.now() - enableStart;

      // Bulk disable
      const disableStart = performance.now();
      await Promise.all(services.map((s) => s.disable()));
      const disableDuration = performance.now() - disableStart;

      expect(enableDuration).toBeLessThan(MAX_STARTUP_TIME_MS * 3);
      expect(disableDuration).toBeLessThan(MAX_STARTUP_TIME_MS);

      console.log(`Bulk enable 20 services: ${enableDuration.toFixed(2)}ms`);
      console.log(`Bulk disable 20 services: ${disableDuration.toFixed(2)}ms`);
    });
  });

  describe("Large Configuration Performance", () => {
    it("should handle services with large configs", async () => {
      const deps = createMockDeps();
      const manifest = createBaseManifest("large-config-test");

      // Create a large config
      const largeConfig: ServiceConfig = {
        testField: "test",
        largeArray: Array.from({ length: 1000 }, (_, i) => `item-${i}`),
        largeObject: Object.fromEntries(
          Array.from({ length: 100 }, (_, i) => [`key-${i}`, `value-${i}`]),
        ),
      };

      const service = new Service(manifest, largeConfig, deps);

      const { durationMs } = await measureTime(() => service.install());

      expect(durationMs).toBeLessThan(MAX_INSTALL_TIME_MS);

      console.log(`Large config installation time: ${durationMs.toFixed(2)}ms`);
    });
  });
});

// =============================================================================
// Performance Summary
// =============================================================================

describe("Performance Summary", () => {
  it("should meet all performance criteria", async () => {
    const results = {
      installTime: { passed: false, value: 0 },
      startupTime: { passed: false, value: 0 },
      concurrentServices: { passed: false, value: 0 },
      memoryUsage: { passed: false, value: 0 },
    };

    // Test installation time
    {
      const deps = createMockDeps();
      const manifest = createBaseManifest("summary-install");
      const service = new Service(manifest, baseConfig, deps);
      const { durationMs } = await measureTime(() => service.install());
      results.installTime = { passed: durationMs < MAX_INSTALL_TIME_MS, value: durationMs };
    }

    // Test startup time
    {
      const deps = createMockDeps();
      const manifest = createBaseManifest("summary-startup");
      const service = new Service(manifest, baseConfig, deps);
      await service.install();
      const { durationMs } = await measureTime(() => service.enable());
      results.startupTime = { passed: durationMs < MAX_STARTUP_TIME_MS, value: durationMs };
    }

    // Test concurrent services
    {
      const deps = createMockDeps();
      const startTime = performance.now();
      const _services = await Promise.all(
        Array.from({ length: CONCURRENT_SERVICE_COUNT }, async (_, i) => {
          const manifest = createBaseManifest(`summary-concurrent-${i}`);
          const service = new Service(manifest, baseConfig, deps);
          await service.install();
          return service;
        }),
      );
      const durationMs = performance.now() - startTime;
      const avgTime = durationMs / CONCURRENT_SERVICE_COUNT;
      results.concurrentServices = {
        passed: avgTime < MAX_CONCURRENT_OPERATION_TIME_MS,
        value: durationMs,
      };
    }

    // Test memory usage
    {
      const deps = createMockDeps();
      forceGarbageCollection();
      const memoryBefore = getMemoryUsage();

      for (let i = 0; i < 5; i++) {
        const manifest = createBaseManifest(`summary-memory-${i}`);
        const service = new Service(manifest, baseConfig, deps);
        await service.install();
      }

      forceGarbageCollection();
      const memoryAfter = getMemoryUsage();
      const perServiceBytes = (memoryAfter.heapUsed - memoryBefore.heapUsed) / 5;
      results.memoryUsage = {
        passed: perServiceBytes < MAX_MEMORY_PER_SERVICE_BYTES,
        value: perServiceBytes,
      };
    }

    // Log results
    console.log("\n=== Performance Summary ===");
    console.log(
      `Install Time (<${MAX_INSTALL_TIME_MS}ms): ${results.installTime.passed ? "PASS" : "FAIL"} (${results.installTime.value.toFixed(2)}ms)`,
    );
    console.log(
      `Startup Time (<${MAX_STARTUP_TIME_MS}ms): ${results.startupTime.passed ? "PASS" : "FAIL"} (${results.startupTime.value.toFixed(2)}ms)`,
    );
    console.log(
      `Concurrent Services (${CONCURRENT_SERVICE_COUNT}): ${results.concurrentServices.passed ? "PASS" : "FAIL"} (${results.concurrentServices.value.toFixed(2)}ms total)`,
    );
    console.log(
      `Memory Usage (<${(MAX_MEMORY_PER_SERVICE_BYTES / 1024 / 1024).toFixed(1)}MB/service): ${results.memoryUsage.passed ? "PASS" : "FAIL"} (${(results.memoryUsage.value / 1024).toFixed(2)}KB)`,
    );
    console.log("===========================\n");

    // All criteria must pass
    expect(results.installTime.passed).toBe(true);
    expect(results.startupTime.passed).toBe(true);
    expect(results.concurrentServices.passed).toBe(true);
    expect(results.memoryUsage.passed).toBe(true);
  });
});
