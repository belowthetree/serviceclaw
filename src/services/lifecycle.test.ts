/* eslint-disable @typescript-eslint/unbound-method */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { CronService } from "../cron/service.js";
import { clearInternalHooks } from "../hooks/internal-hooks.js";
import type { PluginRegistry } from "../plugins/registry.js";
import type { ProcessSupervisor, ManagedRun } from "../process/supervisor/types.js";
import {
  Service,
  ServiceInstaller,
  ServiceError,
  ServiceInstallError,
  ServiceValidationError,
  ServiceStateError,
  type ServiceLifecycleDeps,
  ServiceLifecycleManager,
  ServiceLifecycleError,
  ServiceNotFoundError,
  InvalidProcessStateError,
  createServiceLifecycleManager,
  getServiceLifecycleManager,
  resetServiceLifecycleManager,
  setServiceLifecycleManager,
  type LifecycleHooks,
} from "./lifecycle.js";
import type { ServiceManifest } from "./schema.js";

// Type for service config (not exported from schema.js)
type ServiceConfig = Record<string, unknown>;

// =============================================================================
// Test Fixtures
// =============================================================================

const mockCronService = (): CronService =>
  ({
    add: vi.fn().mockResolvedValue({ id: "test-job-id" }),
    remove: vi.fn().mockResolvedValue(undefined),
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
    enableByService: vi.fn().mockResolvedValue({ success: true, count: 1 }),
    disableByService: vi.fn().mockResolvedValue({ success: true, count: 1 }),
    removeByService: vi.fn().mockResolvedValue({ success: true, count: 1 }),
    listByService: vi.fn().mockResolvedValue([]),
  }) as unknown as CronService;

const mockPluginRegistry = (): PluginRegistry =>
  ({
    httpRoutes: [],
    plugins: new Map(),
  }) as unknown as PluginRegistry;

const createMockDeps = (): ServiceLifecycleDeps => ({
  cronService: mockCronService(),
  pluginRegistry: mockPluginRegistry(),
});

const baseManifest: ServiceManifest = {
  id: "test-service",
  name: "Test Service",
  description: "A test service for unit testing",
  version: "1.0.0",
  entry: "index.js",
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
    agentId: "service:test-service",
    sessionTarget: "isolated",
    timeout: 30000,
  },
};

const webhookManifest: ServiceManifest = {
  ...baseManifest,
  id: "webhook-service",
  trigger: {
    type: "webhook",
    path: "/webhooks/test",
    methods: ["POST"],
    auth: {
      type: "none",
    },
  },
};

const messageManifest: ServiceManifest = {
  ...baseManifest,
  id: "message-service",
  trigger: {
    type: "message",
    channels: ["slack", "discord"],
    filters: {
      keywords: ["!test"],
      patterns: ["^!test"],
    },
  },
};

const baseConfig: ServiceConfig = {
  testField: "test value",
};

// =============================================================================
// Service Class Tests
// =============================================================================

describe("Service", () => {
  beforeEach(() => {
    clearInternalHooks();
    vi.clearAllMocks();
  });

  describe("Constructor", () => {
    it("should create service with initial state", () => {
      const deps = createMockDeps();
      const service = new Service(baseManifest, baseConfig, deps);

      expect(service.id).toBe("test-service");
      expect(service.state).toBe("pending");
      expect(service.manifest).toBe(baseManifest);
      expect(service.config).toBe(baseConfig);
      expect(service.agentId).toBe("service:test-service");
    });

    it("should create service with custom initial state", () => {
      const deps = createMockDeps();
      const service = new Service(baseManifest, baseConfig, deps, "installed");

      expect(service.state).toBe("installed");
    });

    it("should initialize runtime refs", () => {
      const deps = createMockDeps();
      const service = new Service(baseManifest, baseConfig, deps);

      expect(service.runtimeRefs.cronJobIds).toEqual([]);
      expect(service.runtimeRefs.webhookPaths).toEqual([]);
      expect(service.runtimeRefs.webhookUnregisterFns).toEqual([]);
      expect(service.runtimeRefs.messageSubscriptions).toEqual([]);
    });

    it("should initialize execution stats", () => {
      const deps = createMockDeps();
      const service = new Service(baseManifest, baseConfig, deps);

      expect(service.executionStats.totalRuns).toBe(0);
      expect(service.executionStats.successfulRuns).toBe(0);
      expect(service.executionStats.failedRuns).toBe(0);
    });

    it("should auto-generate agentId from manifest", () => {
      const manifestWithoutAgent = {
        ...baseManifest,
        execution: undefined,
      };
      const deps = createMockDeps();
      const service = new Service(manifestWithoutAgent, baseConfig, deps);

      expect(service.agentId).toBe("service:test-service");
    });
  });

  describe("State Management", () => {
    it("should track state transitions", () => {
      const deps = createMockDeps();
      const service = new Service(baseManifest, baseConfig, deps);

      service.setState("validating", "Test transition");

      expect(service.state).toBe("validating");
      expect(service.stateHistory).toHaveLength(1);
      expect(service.stateHistory[0].from).toBe("pending");
      expect(service.stateHistory[0].to).toBe("validating");
      expect(service.stateHistory[0].reason).toBe("Test transition");
    });

    it("should reject invalid state transitions", () => {
      const deps = createMockDeps();
      const service = new Service(baseManifest, baseConfig, deps);

      expect(() => service.setState("enabled")).toThrow(ServiceStateError);
    });

    it("should allow valid state transitions", () => {
      const deps = createMockDeps();
      const service = new Service(baseManifest, baseConfig, deps);

      // pending → validating
      service.setState("validating");
      expect(service.state).toBe("validating");

      // validating → installing
      service.setState("installing");
      expect(service.state).toBe("installing");

      // installing → installed
      service.setState("installed");
      expect(service.state).toBe("installed");

      // installed → enabled
      service.setState("enabled");
      expect(service.state).toBe("enabled");

      // enabled → disabled
      service.setState("disabled");
      expect(service.state).toBe("disabled");

      // disabled → enabled
      service.setState("enabled");
      expect(service.state).toBe("enabled");

      // enabled → uninstalling
      service.setState("uninstalling");
      expect(service.state).toBe("uninstalling");
    });

    it("should update timestamps on state change", () => {
      vi.useFakeTimers();
      const deps = createMockDeps();
      const service = new Service(baseManifest, baseConfig, deps);
      const beforeUpdate = service.updatedAt;

      // Small delay to ensure timestamp difference
      vi.advanceTimersByTime(10);
      service.setState("validating");

      expect(service.updatedAt.getTime()).toBeGreaterThanOrEqual(beforeUpdate.getTime());
      vi.useRealTimers();
    });
  });

  describe("Enable/Disable", () => {
    it("should enable service from installed state", async () => {
      const deps = createMockDeps();
      const service = new Service(baseManifest, baseConfig, deps, "installed");

      await service.enable();

      expect(service.state).toBe("enabled");
    });

    it("should enable service from disabled state", async () => {
      const deps = createMockDeps();
      const service = new Service(baseManifest, baseConfig, deps, "disabled");

      await service.enable();

      expect(service.state).toBe("enabled");
    });

    it("should disable service from enabled state", async () => {
      const deps = createMockDeps();
      const service = new Service(baseManifest, baseConfig, deps, "enabled");

      await service.disable();

      expect(service.state).toBe("disabled");
    });

    it("should reject enable from invalid state", async () => {
      const deps = createMockDeps();
      const service = new Service(baseManifest, baseConfig, deps, "pending");

      await expect(service.enable()).rejects.toThrow(ServiceStateError);
    });

    it("should reject disable from invalid state", async () => {
      const deps = createMockDeps();
      const service = new Service(baseManifest, baseConfig, deps, "pending");

      await expect(service.disable()).rejects.toThrow(ServiceStateError);
    });
  });

  describe("Validation", () => {
    it("should validate successfully with valid config", async () => {
      const deps = createMockDeps();
      const service = new Service(baseManifest, baseConfig, deps);

      const result = await service.validate();

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(service.state).toBe("validating");
    });

    it("should fail validation with missing required field", async () => {
      const deps = createMockDeps();
      const invalidConfig = {};
      const service = new Service(baseManifest, invalidConfig, deps);

      const result = await service.validate();

      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Required config field 'testField' is missing");
    });

    it("should fail validation with wrong type", async () => {
      const deps = createMockDeps();
      const invalidConfig = { testField: 123 };
      const service = new Service(baseManifest, invalidConfig, deps);

      const result = await service.validate();

      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Config field 'testField' must be a string");
    });

    it("should track validation_error state on failure", async () => {
      const deps = createMockDeps();
      const invalidConfig = {};
      const service = new Service(baseManifest, invalidConfig, deps);

      await service.validate();

      expect(service.state).toBe("validation_error");
    });

    it("should validate webhook trigger path", async () => {
      const deps = createMockDeps();
      const invalidWebhookManifest = {
        ...webhookManifest,
        trigger: {
          ...webhookManifest.trigger,
          path: "invalid-path", // Missing leading /
        },
      };
      const service = new Service(invalidWebhookManifest, baseConfig, deps);

      const result = await service.validate();

      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Webhook path must start with /");
    });

    it("should validate message trigger channels", async () => {
      const deps = createMockDeps();
      const invalidMessageManifest = {
        ...messageManifest,
        trigger: {
          ...messageManifest.trigger,
          channels: [],
        },
      };
      const service = new Service(invalidMessageManifest, baseConfig, deps);

      const result = await service.validate();

      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Message trigger must specify at least one channel");
    });

    it("should validate cron trigger schedule", async () => {
      const deps = createMockDeps();
      const invalidCronManifest = {
        ...baseManifest,
        trigger: {
          type: "cron" as const,
          schedule: "", // Empty schedule
        },
      };
      const service = new Service(invalidCronManifest, baseConfig, deps);

      const result = await service.validate();

      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        "Cron schedule is required and must be a valid cron expression",
      );
    });
  });

  describe("Installation - Cron Trigger", () => {
    it("should install cron trigger successfully", async () => {
      const deps = createMockDeps();
      const service = new Service(baseManifest, baseConfig, deps);

      const result = await service.install();

      expect(result.success).toBe(true);
      expect(service.state).toBe("installed");
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(vi.mocked(deps.cronService).add).toHaveBeenCalledTimes(1);

      const cronCall = vi.mocked(deps.cronService).add.mock.calls[0][0];
      expect(cronCall.agentId).toBe("service:test-service");
      expect(cronCall.schedule).toEqual({
        kind: "cron",
        expr: "0 8 * * *",
        tz: undefined,
      });
    });

    it("should store cron job ID in runtime refs", async () => {
      const deps = createMockDeps();
      const service = new Service(baseManifest, baseConfig, deps);

      await service.install();

      expect(service.runtimeRefs.cronJobIds).toContain("test-job-id");
    });

    it("should handle cron service errors", async () => {
      const deps = createMockDeps();
      vi.mocked(deps.cronService).add.mockRejectedValue(new Error("Cron service error"));

      const service = new Service(baseManifest, baseConfig, deps);

      await expect(service.install()).rejects.toThrow(ServiceInstallError);
      expect(service.state).toBe("install_error");
    });

    it("should rollback cron job on failure", async () => {
      const deps = createMockDeps();
      vi.mocked(deps.cronService).add.mockRejectedValue(new Error("Cron service error"));

      const service = new Service(baseManifest, baseConfig, deps);

      try {
        await service.install();
      } catch {
        // Expected
      }

      // After rollback, runtime refs should be cleared
      expect(service.runtimeRefs.cronJobIds).toHaveLength(0);
    });
  });

  describe("Installation - Webhook Trigger", () => {
    it("should install webhook trigger", async () => {
      const deps = createMockDeps();
      const service = new Service(webhookManifest, baseConfig, deps);

      const result = await service.install();

      expect(result.success).toBe(true);
      expect(service.state).toBe("installed");
      expect(service.runtimeRefs.webhookPaths).toContain("/webhooks/test");
      expect(service.runtimeRefs.webhookUnregisterFns).toHaveLength(1);
    });

    it("should replace {serviceId} in webhook path", async () => {
      const deps = createMockDeps();
      const manifestWithPlaceholder = {
        ...webhookManifest,
        trigger: {
          ...webhookManifest.trigger,
          path: "/webhooks/{serviceId}/events",
        },
      };
      const service = new Service(manifestWithPlaceholder, baseConfig, deps);

      await service.install();

      expect(service.runtimeRefs.webhookPaths).toContain("/webhooks/webhook-service/events");
    });

    it("should rollback webhook on failure", async () => {
      const deps = createMockDeps();
      const service = new Service(webhookManifest, baseConfig, deps);

      // Mock the cron add to succeed initially then fail to test rollback
      const _unregisterMock = vi.fn();

      await service.install();

      // Manually test rollback
      const rollbackAction = service.runtimeRefs.webhookUnregisterFns[0];
      if (rollbackAction) {
        rollbackAction();
      }

      expect(service.runtimeRefs.webhookPaths).toHaveLength(1);
    });
  });

  describe("Installation - Message Trigger", () => {
    it("should install message trigger", async () => {
      const deps = createMockDeps();
      const service = new Service(messageManifest, baseConfig, deps);

      const result = await service.install();

      expect(result.success).toBe(true);
      expect(service.state).toBe("installed");
      expect(service.runtimeRefs.messageSubscriptions).toHaveLength(2);
      expect(service.runtimeRefs.messageSubscriptions[0].channel).toBe("slack");
      expect(service.runtimeRefs.messageSubscriptions[1].channel).toBe("discord");
    });

    it("should provide unsubscribe function for message subscriptions", async () => {
      const deps = createMockDeps();
      const service = new Service(messageManifest, baseConfig, deps);

      await service.install();

      const sub = service.runtimeRefs.messageSubscriptions[0];
      expect(sub.channel).toBe("slack");
      expect(sub.eventKey).toBe("message:received:slack");
      expect(typeof sub.handler).toBe("function");
    });
  });

  describe("Uninstallation", () => {
    it("should remove cron jobs on uninstall", async () => {
      const deps = createMockDeps();
      const service = new Service(baseManifest, baseConfig, deps);

      await service.install();
      await service.uninstall();

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(vi.mocked(deps.cronService).removeByService).toHaveBeenCalledWith("test-service");
    });

    it("should clear runtime refs on uninstall", async () => {
      const deps = createMockDeps();
      const service = new Service(baseManifest, baseConfig, deps);

      await service.install();
      expect(service.runtimeRefs.cronJobIds).toHaveLength(1);

      await service.uninstall();

      expect(service.runtimeRefs.cronJobIds).toHaveLength(0);
    });

    it("should handle uninstall from any state", async () => {
      const deps = createMockDeps();
      const service = new Service(baseManifest, baseConfig, deps, "disabled");

      await service.uninstall();

      expect(service.state).toBe("pending");
    });

    it("should continue uninstall even if resource removal fails", async () => {
      const deps = createMockDeps();
      vi.mocked(deps.cronService).remove.mockRejectedValue(new Error("Remove failed"));

      const service = new Service(baseManifest, baseConfig, deps);
      await service.install();

      // Should not throw despite remove failing
      await expect(service.uninstall()).resolves.not.toThrow();
    });
  });

  describe("Execution Statistics", () => {
    it("should record successful execution", () => {
      const deps = createMockDeps();
      const service = new Service(baseManifest, baseConfig, deps);

      service.recordSuccess();

      expect(service.executionStats.totalRuns).toBe(1);
      expect(service.executionStats.successfulRuns).toBe(1);
      expect(service.executionStats.failedRuns).toBe(0);
      expect(service.executionStats.lastRunAt).toBeInstanceOf(Date);
    });

    it("should record failed execution", () => {
      const deps = createMockDeps();
      const service = new Service(baseManifest, baseConfig, deps, "enabled");

      const error = new Error("Test error");
      service.recordFailure(error);

      expect(service.executionStats.totalRuns).toBe(1);
      expect(service.executionStats.successfulRuns).toBe(0);
      expect(service.executionStats.failedRuns).toBe(1);
      expect(service.executionStats.lastError).toBeDefined();
      expect(service.executionStats.lastError?.message).toBe("Test error");
    });

    it("should transition to error state on failure", () => {
      const deps = createMockDeps();
      const service = new Service(baseManifest, baseConfig, deps, "enabled");

      service.recordFailure(new Error("Test error"));

      expect(service.state).toBe("error");
    });

    it("should update timestamp on execution record", () => {
      vi.useFakeTimers();
      const deps = createMockDeps();
      const service = new Service(baseManifest, baseConfig, deps);
      const beforeUpdate = service.updatedAt;

      vi.advanceTimersByTime(10);
      service.recordSuccess();

      expect(service.updatedAt.getTime()).toBeGreaterThanOrEqual(beforeUpdate.getTime());
      vi.useRealTimers();
    });
  });

  describe("Configuration Management", () => {
    it("should update configuration", () => {
      const deps = createMockDeps();
      const service = new Service(baseManifest, baseConfig, deps);

      service.updateConfig({ newField: "new value" });

      expect(service.config).toEqual({
        testField: "test value",
        newField: "new value",
      });
    });

    it("should update timestamp on config update", () => {
      vi.useFakeTimers();
      const deps = createMockDeps();
      const service = new Service(baseManifest, baseConfig, deps);
      const beforeUpdate = service.updatedAt;

      vi.advanceTimersByTime(10);
      service.updateConfig({});

      expect(service.updatedAt.getTime()).toBeGreaterThanOrEqual(beforeUpdate.getTime());
      vi.useRealTimers();
    });
  });

  describe("Serialization", () => {
    it("should serialize to JSON", async () => {
      const deps = createMockDeps();
      const service = new Service(baseManifest, baseConfig, deps);
      await service.install();

      const json = service.toJSON();

      expect(json.id).toBe("test-service");
      expect(json.manifest).toBe(baseManifest);
      expect(json.state).toBe("installed");
      expect(json.config).toBe(baseConfig);
      expect(json.runtimeRefs.agentId).toBe("service:test-service");
      expect(typeof json.createdAt).toBe("string");
      expect(typeof json.updatedAt).toBe("string");
    });

    it("should not include unregister functions in JSON", async () => {
      const deps = createMockDeps();
      const service = new Service(webhookManifest, baseConfig, deps);
      await service.install();

      const json = service.toJSON();

      expect(json.runtimeRefs).not.toHaveProperty("webhookUnregisterFns");
      expect(json.runtimeRefs).not.toHaveProperty("messageSubscriptions");
    });
  });
});

// =============================================================================
// ServiceInstaller Tests
// =============================================================================

describe("ServiceInstaller", () => {
  beforeEach(() => {
    clearInternalHooks();
    vi.clearAllMocks();
  });

  describe("install", () => {
    it("should install service successfully", async () => {
      const deps = createMockDeps();
      const installer = new ServiceInstaller(deps);

      const service = await installer.install(baseManifest, baseConfig);

      expect(service).toBeInstanceOf(Service);
      expect(service.state).toBe("installed");
      expect(service.id).toBe("test-service");
    });

    it("should throw on validation failure", async () => {
      const deps = createMockDeps();
      const installer = new ServiceInstaller(deps);

      const invalidConfig = {}; // Missing required field

      await expect(installer.install(baseManifest, invalidConfig)).rejects.toThrow(
        ServiceValidationError,
      );
    });

    it("should track installation phase", async () => {
      const deps = createMockDeps();
      const installer = new ServiceInstaller(deps);

      expect(installer.getCurrentPhase()).toBe("validate");

      await installer.install(baseManifest, baseConfig);

      expect(installer.getCurrentPhase()).toBe("prepare");
    });
  });
});

// =============================================================================
// Error Classes Tests
// =============================================================================

describe("Error Classes", () => {
  describe("ServiceError", () => {
    it("should create base service error", () => {
      const error = new ServiceError("Test error", "service-id");

      expect(error.message).toBe("Test error");
      expect(error.serviceId).toBe("service-id");
      expect(error.name).toBe("ServiceError");
    });

    it("should include cause", () => {
      const cause = new Error("Original error");
      const error = new ServiceError("Test error", "service-id", cause);

      expect(error.cause).toBe(cause);
    });
  });

  describe("ServiceInstallError", () => {
    it("should create install error with phase", () => {
      const error = new ServiceInstallError("Install failed", "service-id", "create_resources");

      expect(error.message).toBe("Install failed");
      expect(error.serviceId).toBe("service-id");
      expect(error.phase).toBe("create_resources");
      expect(error.name).toBe("ServiceInstallError");
    });
  });

  describe("ServiceValidationError", () => {
    it("should create validation error with errors array", () => {
      const validationErrors = ["Error 1", "Error 2"];
      const error = new ServiceValidationError("Validation failed", "service-id", validationErrors);

      expect(error.message).toBe("Validation failed");
      expect(error.serviceId).toBe("service-id");
      expect(error.validationErrors).toEqual(validationErrors);
      expect(error.name).toBe("ServiceValidationError");
    });
  });

  describe("ServiceStateError", () => {
    it("should create state error with transition info", () => {
      const error = new ServiceStateError(
        "Invalid transition",
        "service-id",
        "pending",
        "to enabled",
      );

      expect(error.message).toBe("Invalid transition");
      expect(error.serviceId).toBe("service-id");
      expect(error.currentState).toBe("pending");
      expect(error.attemptedTransition).toBe("to enabled");
      expect(error.name).toBe("ServiceStateError");
    });
  });
});

// =============================================================================
// Integration Tests
// =============================================================================

describe("Service Lifecycle Integration", () => {
  beforeEach(() => {
    clearInternalHooks();
    vi.clearAllMocks();
  });

  it("should complete full lifecycle: install → enable → disable → uninstall", async () => {
    const deps = createMockDeps();
    const service = new Service(baseManifest, baseConfig, deps);

    // Install
    await service.install();
    expect(service.state).toBe("installed");
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(vi.mocked(deps.cronService).add).toHaveBeenCalledTimes(1);

    // Enable
    await service.enable();
    expect(service.state).toBe("enabled");

    // Disable
    await service.disable();
    expect(service.state).toBe("disabled");

    // Re-enable
    await service.enable();
    expect(service.state).toBe("enabled");

    // Uninstall
    await service.uninstall();
    expect(service.state).toBe("pending");
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(vi.mocked(deps.cronService).removeByService).toHaveBeenCalledTimes(1);
  });

  it("should handle error recovery", async () => {
    const deps = createMockDeps();
    const service = new Service(baseManifest, baseConfig, deps);

    // Install and enable
    await service.install();
    await service.enable();
    expect(service.state).toBe("enabled");

    // Simulate runtime error
    service.recordFailure(new Error("Runtime error"));
    expect(service.state).toBe("error");
    expect(service.executionStats.failedRuns).toBe(1);
    expect(service.executionStats.lastError).toBeDefined();

    // Recover by disabling and re-enabling
    service.setState("disabled");
    await service.enable();
    expect(service.state).toBe("enabled");
  });

  it("should track complete state history", async () => {
    const deps = createMockDeps();
    const service = new Service(baseManifest, baseConfig, deps);

    await service.install();
    await service.enable();
    await service.disable();

    const history = service.stateHistory;
    expect(history.length).toBeGreaterThanOrEqual(3);

    // Should have transitions for: pending→validating→installing→installed→enabled→disabled
    const transitions = history.map((h) => `${h.from}→${h.to}`);
    expect(transitions).toContain("pending→validating");
    expect(transitions).toContain("validating→installing");
    expect(transitions).toContain("installing→installed");
    expect(transitions).toContain("installed→enabled");
    expect(transitions).toContain("enabled→disabled");
  });
});

// =============================================================================
// ServiceLifecycleManager Tests (Process Lifecycle)
// =============================================================================

describe("ServiceLifecycleManager", () => {
  let manager: ServiceLifecycleManager;
  let mockSupervisor: ProcessSupervisor;

  const createMockManagedRun = (pid = 12345): ManagedRun => {
    let waitResolve: ((value: Awaited<ReturnType<ManagedRun["wait"]>>) => void) | undefined;
    const waitPromise = new Promise<Awaited<ReturnType<ManagedRun["wait"]>>>((resolve) => {
      waitResolve = resolve;
    });

    return {
      runId: `test-run-${pid}`,
      pid,
      startedAtMs: Date.now(),
      wait: vi.fn().mockReturnValue(waitPromise),
      cancel: vi.fn().mockImplementation(() => {
        waitResolve?.({
          reason: "exit" as const,
          exitCode: 0,
          exitSignal: null,
          durationMs: 1000,
          stdout: "",
          stderr: "",
          timedOut: false,
          noOutputTimedOut: false,
        });
      }),
    };
  };

  const createMockService = (id: string, entry = "index.js") => ({
    manifest: { id, entry },
    path: `/mock/services/${id}`,
  });

  beforeEach(() => {
    mockSupervisor = {
      spawn: vi.fn(),
      cancel: vi.fn(),
      cancelScope: vi.fn(),
      reconcileOrphans: vi.fn(),
      getRecord: vi.fn(),
    } as unknown as ProcessSupervisor;

    const mockGetServices = vi
      .fn()
      .mockResolvedValue([
        createMockService("test-service"),
        createMockService("service-1"),
        createMockService("service-2"),
      ]);

    manager = new ServiceLifecycleManager({
      supervisor: mockSupervisor,
      sessionId: "test-session",
      backendId: "test-backend",
      getServices: mockGetServices as (
        servicesDir?: string,
      ) => Promise<Array<{ manifest: { id: string; entry: string }; path: string }>>,
    });
  });

  afterEach(async () => {
    await manager.dispose();
  });

  describe("Constructor", () => {
    it("should create manager with default dependencies", () => {
      const defaultManager = new ServiceLifecycleManager();
      expect(defaultManager).toBeInstanceOf(ServiceLifecycleManager);
    });

    it("should create manager with custom dependencies", () => {
      const customManager = new ServiceLifecycleManager({
        supervisor: mockSupervisor,
        sessionId: "custom-session",
        backendId: "custom-backend",
      });
      expect(customManager).toBeInstanceOf(ServiceLifecycleManager);
    });
  });

  describe("startService", () => {
    it("should start a service and return instance", async () => {
      const mockRun = createMockManagedRun(12345);
      vi.mocked(mockSupervisor).spawn.mockResolvedValue(mockRun);

      const instance = await manager.startService("test-service");

      expect(instance).toBeDefined();
      expect(instance.serviceId).toBe("test-service");
      expect(instance.state).toBe("started");
      expect(instance.pid).toBe(12345);
      expect(instance.startedAt).toBeInstanceOf(Date);
    });

    it("should throw if service is already started", async () => {
      const mockRun = createMockManagedRun(12345);
      vi.mocked(mockSupervisor).spawn.mockResolvedValue(mockRun);

      await manager.startService("test-service");

      await expect(manager.startService("test-service")).rejects.toThrow(ServiceLifecycleError);
    });

    it("should throw if service is already started", async () => {
      const mockRun = createMockManagedRun(12345);
      vi.mocked(mockSupervisor).spawn.mockResolvedValue(mockRun);

      await manager.startService("test-service");

      await expect(manager.startService("test-service")).rejects.toThrow(ServiceLifecycleError);
    });

    it("should call ProcessSupervisor.spawn with correct arguments", async () => {
      const mockRun = createMockManagedRun(12345);
      vi.mocked(mockSupervisor).spawn.mockResolvedValue(mockRun);

      await manager.startService("test-service");

      expect(vi.mocked(mockSupervisor).spawn).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: "child",
          argv: expect.arrayContaining(["node"]),
          sessionId: "test-session",
          backendId: "test-backend",
          scopeKey: "service:test-service",
          replaceExistingScope: true,
        }),
      );
    });

    it("should transition through starting state", async () => {
      const mockRun = createMockManagedRun(12345);
      const states: string[] = [];

      manager.registerLifecycleHooks({
        onStateChange: (serviceId, oldState, newState) => {
          states.push(`${oldState}→${newState}`);
        },
      });

      vi.mocked(mockSupervisor).spawn.mockResolvedValue(mockRun);

      await manager.startService("test-service");

      expect(states).toContain("inactive→starting");
      expect(states).toContain("starting→started");
    });

    it("should transition to error state on spawn failure", async () => {
      vi.mocked(mockSupervisor).spawn.mockRejectedValue(new Error("Spawn failed"));

      await expect(manager.startService("test-service")).rejects.toThrow(ServiceLifecycleError);

      const instance = manager.getServiceState("test-service");
      expect(instance?.state).toBe("error");
      expect(instance?.error).toContain("Spawn failed");
    });
  });

  describe("stopService", () => {
    it("should stop a running service", async () => {
      const mockRun = createMockManagedRun(12345);
      vi.mocked(mockSupervisor).spawn.mockResolvedValue(mockRun);

      await manager.startService("test-service");
      await manager.stopService("test-service");

      const instance = manager.getServiceState("test-service");
      expect(instance?.state).toBe("stopped");
      expect(mockRun.cancel).toHaveBeenCalled();
    });

    it("should throw if service not found", async () => {
      await expect(manager.stopService("non-existent")).rejects.toThrow(ServiceNotFoundError);
    });

    it("should throw if service is not running", async () => {
      await expect(manager.stopService("test-service")).rejects.toThrow(ServiceLifecycleError);
    });

    it("should transition through stopping state", async () => {
      const mockRun = createMockManagedRun(12345);
      const states: string[] = [];

      manager.registerLifecycleHooks({
        onStateChange: (serviceId, oldState, newState) => {
          states.push(`${oldState}→${newState}`);
        },
      });

      vi.mocked(mockSupervisor).spawn.mockResolvedValue(mockRun);

      await manager.startService("test-service");
      await manager.stopService("test-service");

      expect(states).toContain("started→stopping");
      expect(states).toContain("stopping→stopped");
    });
  });

  describe("getServiceState", () => {
    it("should return undefined for non-existent service", () => {
      expect(manager.getServiceState("non-existent")).toBeUndefined();
    });

    it("should return instance for running service", async () => {
      const mockRun = createMockManagedRun(12345);
      vi.mocked(mockSupervisor).spawn.mockResolvedValue(mockRun);

      await manager.startService("test-service");

      const instance = manager.getServiceState("test-service");
      expect(instance).toBeDefined();
      expect(instance?.serviceId).toBe("test-service");
      expect(instance?.state).toBe("started");
    });
  });

  describe("listRunningServices", () => {
    it("should return empty array when no services running", () => {
      expect(manager.listRunningServices()).toEqual([]);
    });

    it("should return running services only", async () => {
      const mockRun1 = createMockManagedRun(12345);
      const mockRun2 = createMockManagedRun(12346);

      vi.mocked(mockSupervisor)
        .spawn.mockResolvedValueOnce(mockRun1)
        .mockResolvedValueOnce(mockRun2);

      await manager.startService("service-1");
      await manager.startService("service-2");

      const running = manager.listRunningServices();
      expect(running).toHaveLength(2);
      expect(running.map((s) => s.serviceId)).toContain("service-1");
      expect(running.map((s) => s.serviceId)).toContain("service-2");
    });

    it("should not include stopped services", async () => {
      const mockRun = createMockManagedRun(12345);
      vi.mocked(mockSupervisor).spawn.mockResolvedValue(mockRun);

      await manager.startService("test-service");
      await manager.stopService("test-service");

      expect(manager.listRunningServices()).toHaveLength(0);
    });
  });

  describe("listAllServices", () => {
    it("should return all services including stopped", async () => {
      const mockRun = createMockManagedRun(12345);
      vi.mocked(mockSupervisor).spawn.mockResolvedValue(mockRun);

      await manager.startService("test-service");
      await manager.stopService("test-service");

      const all = manager.listAllServices();
      expect(all).toHaveLength(1);
      expect(all[0]?.state).toBe("stopped");
    });
  });

  describe("isRunning", () => {
    it("should return false for non-existent service", () => {
      expect(manager.isRunning("non-existent")).toBe(false);
    });

    it("should return true for started service", async () => {
      const mockRun = createMockManagedRun(12345);
      vi.mocked(mockSupervisor).spawn.mockResolvedValue(mockRun);

      await manager.startService("test-service");

      expect(manager.isRunning("test-service")).toBe(true);
    });

    it("should return false for stopped service", async () => {
      const mockRun = createMockManagedRun(12345);
      vi.mocked(mockSupervisor).spawn.mockResolvedValue(mockRun);

      await manager.startService("test-service");
      await manager.stopService("test-service");

      expect(manager.isRunning("test-service")).toBe(false);
    });
  });

  describe("registerLifecycleHooks", () => {
    it("should register hooks and return unregister function", () => {
      const hooks: LifecycleHooks = {
        onStart: vi.fn(),
        onStop: vi.fn(),
      };

      const unregister = manager.registerLifecycleHooks(hooks);
      expect(typeof unregister).toBe("function");

      // Unregister should work
      unregister();
    });

    it("should call onStart hook when service starts", async () => {
      const onStart = vi.fn();
      const mockRun = createMockManagedRun(12345);

      manager.registerLifecycleHooks({ onStart });
      vi.mocked(mockSupervisor).spawn.mockResolvedValue(mockRun);

      await manager.startService("test-service");

      expect(onStart).toHaveBeenCalledWith(
        "test-service",
        expect.objectContaining({
          serviceId: "test-service",
          state: "started",
        }),
      );
    });

    it("should call onStop hook when service stops", async () => {
      const onStop = vi.fn();
      const mockRun = createMockManagedRun(12345);

      manager.registerLifecycleHooks({ onStop });
      vi.mocked(mockSupervisor).spawn.mockResolvedValue(mockRun);

      await manager.startService("test-service");
      await manager.stopService("test-service");

      expect(onStop).toHaveBeenCalledWith(
        "test-service",
        expect.objectContaining({
          serviceId: "test-service",
          state: "stopped",
        }),
      );
    });

    it("should call onStateChange on state transitions", async () => {
      const onStateChange = vi.fn();
      const mockRun = createMockManagedRun(12345);

      manager.registerLifecycleHooks({ onStateChange });
      vi.mocked(mockSupervisor).spawn.mockResolvedValue(mockRun);

      await manager.startService("test-service");

      expect(onStateChange).toHaveBeenCalledWith(
        "test-service",
        "inactive",
        "starting",
        expect.any(Object),
      );
      expect(onStateChange).toHaveBeenCalledWith(
        "test-service",
        "starting",
        "started",
        expect.any(Object),
      );
    });

    it("should call onStdout hook on stdout output", async () => {
      const onStdout = vi.fn();
      let capturedStdout: ((chunk: string) => void) | undefined;

      vi.mocked(mockSupervisor).spawn.mockImplementation(async (input) => {
        capturedStdout = input.onStdout;
        return createMockManagedRun(12345);
      });

      manager.registerLifecycleHooks({ onStdout });
      await manager.startService("test-service");

      capturedStdout?.("test output");

      expect(onStdout).toHaveBeenCalledWith("test-service", "test output");
    });

    it("should call onStderr hook on stderr output", async () => {
      const onStderr = vi.fn();
      let capturedStderr: ((chunk: string) => void) | undefined;

      vi.mocked(mockSupervisor).spawn.mockImplementation(async (input) => {
        capturedStderr = input.onStderr;
        return createMockManagedRun(12345);
      });

      manager.registerLifecycleHooks({ onStderr });
      await manager.startService("test-service");

      capturedStderr?.("test error");

      expect(onStderr).toHaveBeenCalledWith("test-service", "test error");
    });
  });

  describe("stopAllServices", () => {
    it("should stop all running services", async () => {
      const mockRun1 = createMockManagedRun(12345);
      const mockRun2 = createMockManagedRun(12346);

      vi.mocked(mockSupervisor)
        .spawn.mockResolvedValueOnce(mockRun1)
        .mockResolvedValueOnce(mockRun2);

      await manager.startService("service-1");
      await manager.startService("service-2");

      await manager.stopAllServices();

      expect(manager.listRunningServices()).toHaveLength(0);
    });

    it("should handle errors when stopping services", async () => {
      const mockRun = createMockManagedRun(12345);
      mockRun.cancel = vi.fn().mockImplementation(() => {
        throw new Error("Cancel failed");
      });

      vi.mocked(mockSupervisor).spawn.mockResolvedValue(mockRun);

      await manager.startService("test-service");

      // Should not throw
      await expect(manager.stopAllServices()).resolves.not.toThrow();
    });
  });

  describe("cleanupStoppedServices", () => {
    it("should remove stopped services from memory", async () => {
      const mockRun = createMockManagedRun(12345);
      vi.mocked(mockSupervisor).spawn.mockResolvedValue(mockRun);

      await manager.startService("test-service");
      await manager.stopService("test-service");

      expect(manager.listAllServices()).toHaveLength(1);

      manager.cleanupStoppedServices();

      expect(manager.listAllServices()).toHaveLength(0);
    });

    it("should not remove running services", async () => {
      const mockRun = createMockManagedRun(12345);
      vi.mocked(mockSupervisor).spawn.mockResolvedValue(mockRun);

      await manager.startService("test-service");
      manager.cleanupStoppedServices();

      expect(manager.getServiceState("test-service")).toBeDefined();
    });
  });

  describe("dispose", () => {
    it("should stop all services and clear state", async () => {
      const mockRun = createMockManagedRun(12345);
      vi.mocked(mockSupervisor).spawn.mockResolvedValue(mockRun);

      await manager.startService("test-service");
      await manager.dispose();

      expect(manager.listAllServices()).toHaveLength(0);
    });
  });

  describe("Error Classes", () => {
    describe("ServiceLifecycleError", () => {
      it("should create error with serviceId", () => {
        const error = new ServiceLifecycleError("Test error", "service-1");
        expect(error.message).toBe("Test error");
        expect(error.serviceId).toBe("service-1");
        expect(error.name).toBe("ServiceLifecycleError");
      });

      it("should include cause", () => {
        const cause = new Error("Original error");
        const error = new ServiceLifecycleError("Test error", "service-1", cause);
        expect(error.cause).toBe(cause);
      });
    });

    describe("ServiceNotFoundError", () => {
      it("should create not found error", () => {
        const error = new ServiceNotFoundError("service-1");
        expect(error.message).toBe("Service not found: service-1");
        expect(error.serviceId).toBe("service-1");
        expect(error.name).toBe("ServiceNotFoundError");
      });
    });

    describe("InvalidProcessStateError", () => {
      it("should create state error with transition info", () => {
        const error = new InvalidProcessStateError("service-1", "started", "starting");
        expect(error.message).toContain("Invalid state transition from started to starting");
        expect(error.serviceId).toBe("service-1");
        expect(error.currentState).toBe("started");
        expect(error.attemptedState).toBe("starting");
        expect(error.name).toBe("InvalidProcessStateError");
      });
    });
  });

  describe("Factory Functions", () => {
    it("createServiceLifecycleManager should create new instance", () => {
      const instance = createServiceLifecycleManager();
      expect(instance).toBeInstanceOf(ServiceLifecycleManager);
    });

    it("getServiceLifecycleManager should return singleton", () => {
      const instance1 = getServiceLifecycleManager();
      const instance2 = getServiceLifecycleManager();
      expect(instance1).toBe(instance2);
    });

    it("resetServiceLifecycleManager should reset singleton", () => {
      const instance1 = getServiceLifecycleManager();
      resetServiceLifecycleManager();
      const instance2 = getServiceLifecycleManager();
      expect(instance1).not.toBe(instance2);
    });

    it("setServiceLifecycleManager should set custom singleton", () => {
      const customManager = new ServiceLifecycleManager();
      setServiceLifecycleManager(customManager);
      expect(getServiceLifecycleManager()).toBe(customManager);
    });
  });
});
