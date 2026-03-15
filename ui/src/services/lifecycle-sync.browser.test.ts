import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { ServiceModal } from "../components/service-modal.js";
import {
  LifecycleSyncManager,
  syncModalWithService,
  openServiceModal,
  closeServiceModal,
  createLifecycleSyncManager,
  resetLifecycleSyncManager,
  LifecycleSyncError,
} from "./lifecycle-sync.js";

// Mock types for ServiceLifecycleManager (avoid importing Node.js modules)
interface MockServiceProcessInstance {
  serviceId: string;
  pid?: number;
  state: "inactive" | "starting" | "started" | "stopping" | "stopped" | "error";
  startedAt?: Date;
  stoppedAt?: Date;
  exitCode?: number | null;
  error?: string;
}

interface MockLifecycleHooks {
  onStateChange?: (
    serviceId: string,
    oldState: string,
    newState: string,
    instance: MockServiceProcessInstance,
  ) => void;
  onUnexpectedExit?: (
    serviceId: string,
    instance: MockServiceProcessInstance,
    exitCode: number | null,
  ) => void;
}

// Mock ServiceNotFoundError
class MockServiceNotFoundError extends Error {
  constructor(serviceId: string) {
    super(`Service not found: ${serviceId}`);
    this.name = "ServiceNotFoundError";
  }
}

// Mock the lifecycle manager
const createMockLifecycleManager = () => {
  const hooks: MockLifecycleHooks[] = [];
  const instances = new Map<string, MockServiceProcessInstance>();

  return {
    startService: vi.fn(async (serviceId: string) => {
      const instance: MockServiceProcessInstance = {
        serviceId,
        state: "started",
        pid: 12345,
        startedAt: new Date(),
      };
      instances.set(serviceId, instance);

      for (const hook of hooks) {
        hook.onStateChange?.(serviceId, "starting", "started", instance);
      }

      return instance;
    }),

    stopService: vi.fn(async (serviceId: string) => {
      const instance = instances.get(serviceId);
      if (instance) {
        instance.state = "stopped";
        instance.stoppedAt = new Date();

        for (const hook of hooks) {
          hook.onStateChange?.(serviceId, "started", "stopped", instance);
        }
      }
    }),

    getServiceState: vi.fn((serviceId: string) => {
      return instances.get(serviceId);
    }),

    listRunningServices: vi.fn(() => {
      return Array.from(instances.values()).filter(
        (i) => i.state === "started" || i.state === "starting",
      );
    }),

    registerLifecycleHooks: vi.fn((hook: MockLifecycleHooks) => {
      hooks.push(hook);
      return () => {
        const index = hooks.indexOf(hook);
        if (index > -1) {
          hooks.splice(index, 1);
        }
      };
    }),

    simulateCrash: (serviceId: string, exitCode: number | null = 1) => {
      const instance = instances.get(serviceId);
      if (instance) {
        instance.state = "error";
        instance.error = `Process exited with code ${exitCode}`;
        instance.stoppedAt = new Date();

        for (const hook of hooks) {
          hook.onStateChange?.(serviceId, "started", "error", instance);
          hook.onUnexpectedExit?.(serviceId, instance, exitCode);
        }
      }
    },

    simulateStartFailure: (serviceId: string, error: Error) => {
      for (const hook of hooks) {
        const instance: MockServiceProcessInstance = {
          serviceId,
          state: "error",
          error: error.message,
          startedAt: new Date(),
          stoppedAt: new Date(),
        };
        hook.onStateChange?.(serviceId, "starting", "error", instance);
      }
    },

    instances,
    hooks,
  };
};

type MockLifecycleManager = ReturnType<typeof createMockLifecycleManager>;

describe("LifecycleSyncManager", () => {
  let modal: ServiceModal;
  let mockLifecycleManager: MockLifecycleManager;
  let syncManager: LifecycleSyncManager;

  beforeEach(() => {
    vi.useFakeTimers();
    modal = new ServiceModal();
    document.body.appendChild(modal);
    mockLifecycleManager = createMockLifecycleManager();
    syncManager = new LifecycleSyncManager(
      mockLifecycleManager as unknown as import("../../../src/services/lifecycle.js").ServiceLifecycleManager,
    );
  });

  afterEach(() => {
    syncManager.dispose();
    modal.remove();
    vi.useRealTimers();
    resetLifecycleSyncManager();
  });

  describe("syncModalWithService", () => {
    it("should register modal for service", () => {
      const unregister = syncManager.syncModalWithService(modal, "test-service");

      expect(syncManager.isSyncing("test-service")).toBe(true);
      expect(mockLifecycleManager.registerLifecycleHooks).toHaveBeenCalledOnce();

      unregister();
    });

    it("should return unregister function that cleans up sync", () => {
      const unregister = syncManager.syncModalWithService(modal, "test-service");

      expect(syncManager.isSyncing("test-service")).toBe(true);

      unregister();

      expect(syncManager.isSyncing("test-service")).toBe(false);
    });

    it("should register lifecycle hooks", () => {
      syncManager.syncModalWithService(modal, "test-service");

      expect(mockLifecycleManager.registerLifecycleHooks).toHaveBeenCalledOnce();
      const registeredHook = mockLifecycleManager.registerLifecycleHooks.mock.calls[0][0];
      expect(registeredHook).toHaveProperty("onStateChange");
      expect(registeredHook).toHaveProperty("onUnexpectedExit");
    });
  });

  describe("openServiceModal", () => {
    beforeEach(() => {
      syncManager.syncModalWithService(modal, "test-service");
    });

    it("should open modal and start service", async () => {
      const openSpy = vi.spyOn(modal, "open");

      await syncManager.openServiceModal("test-service", "Test Service");

      expect(openSpy).toHaveBeenCalledWith("test-service", "Test Service");
      expect(mockLifecycleManager.startService).toHaveBeenCalledWith("test-service");
      expect(modal.isOpen()).toBe(true);
    });

    it("should show loading state when opening", async () => {
      await syncManager.openServiceModal("test-service", "Test Service");

      expect(modal.getState()).toBe("loading");
    });

    it("should throw error if modal not registered", async () => {
      await expect(
        syncManager.openServiceModal("unregistered-service", "Unregistered"),
      ).rejects.toThrow(LifecycleSyncError);
    });

    it("should throw error if operation already in progress", async () => {
      const startPromise = syncManager.openServiceModal("test-service", "Test Service");

      await expect(syncManager.openServiceModal("test-service", "Test Service")).rejects.toThrow(
        LifecycleSyncError,
      );

      await startPromise;
    });

    it("should handle service start failure", async () => {
      const errorMessage = "Failed to start: Service not found";
      mockLifecycleManager.startService.mockRejectedValueOnce(new Error(errorMessage));

      const errorListener = vi.fn();
      modal.addEventListener("service-error", errorListener);

      await expect(syncManager.openServiceModal("test-service", "Test Service")).rejects.toThrow(
        LifecycleSyncError,
      );

      expect(errorListener).toHaveBeenCalled();
      const event = errorListener.mock.calls[0][0] as CustomEvent;
      expect(event.detail.error).toContain(errorMessage);

      vi.advanceTimersByTime(3000);
      expect(modal.isOpen()).toBe(false);
    });

    it("should timeout if service takes too long to start", async () => {
      // Make startService hang to simulate slow start
      mockLifecycleManager.startService.mockImplementationOnce(() => new Promise(() => {}));

      // Start the open operation but don't await it since it will hang
      syncManager.openServiceModal("test-service", "Test Service").catch(() => {
        // Expected to fail - this is the failure path from startService rejection
      });

      // Modal should be loading
      expect(modal.getState()).toBe("loading");

      // Fast-forward to trigger the timeout (30 seconds for start timeout)
      vi.advanceTimersByTime(30000);

      // Wait a tick for the setTimeout in handleStartTimeout to schedule modal close
      await Promise.resolve();

      // Modal should still show error state (not closed yet)
      expect(modal.isOpen()).toBe(true);

      // Advance past the 3-second delay for closing the modal after error
      vi.advanceTimersByTime(3000);

      // Modal should now be closed
      expect(modal.isOpen()).toBe(false);
    });

    it("should handle user closing modal while service starting", async () => {
      mockLifecycleManager.startService.mockImplementationOnce(async () => {
        await new Promise((resolve) => setTimeout(resolve, 5000));
        return {
          serviceId: "test-service",
          state: "started",
          pid: 12345,
        } as MockServiceProcessInstance;
      });

      const startPromise = syncManager.openServiceModal("test-service", "Test Service");

      modal.close();
      expect(modal.isOpen()).toBe(false);

      vi.advanceTimersByTime(5000);
      await startPromise;
    });
  });

  describe("closeServiceModal", () => {
    beforeEach(async () => {
      syncManager.syncModalWithService(modal, "test-service");
      await syncManager.openServiceModal("test-service", "Test Service");
    });

    it("should close modal and stop service", async () => {
      expect(modal.isOpen()).toBe(true);

      await syncManager.closeServiceModal("test-service");

      expect(modal.isOpen()).toBe(false);
      expect(mockLifecycleManager.stopService).toHaveBeenCalledWith("test-service");
    });

    it("should handle modal already closed", async () => {
      modal.close();
      expect(modal.isOpen()).toBe(false);

      await syncManager.closeServiceModal("test-service");

      expect(mockLifecycleManager.stopService).toHaveBeenCalled();
    });

    it("should handle service not running", async () => {
      mockLifecycleManager.stopService.mockRejectedValueOnce(
        new MockServiceNotFoundError("test-service"),
      );

      await syncManager.closeServiceModal("test-service");
      expect(modal.isOpen()).toBe(false);
    });

    it("should handle multiple rapid close calls", async () => {
      const close1 = syncManager.closeServiceModal("test-service");
      const close2 = syncManager.closeServiceModal("test-service");
      const close3 = syncManager.closeServiceModal("test-service");

      await Promise.all([close1, close2, close3]);

      expect(modal.isOpen()).toBe(false);
    });
  });

  describe("service crash handling", () => {
    beforeEach(async () => {
      syncManager.syncModalWithService(modal, "test-service");
      await syncManager.openServiceModal("test-service", "Test Service");
    });

    it("should show error when service crashes", () => {
      const errorListener = vi.fn();
      modal.addEventListener("service-error", errorListener);

      mockLifecycleManager.simulateCrash("test-service", 1);

      expect(errorListener).toHaveBeenCalled();
      const event = errorListener.mock.calls[0][0] as CustomEvent;
      // The error message comes from handleServiceStateChange which shows "Service error: {message}"
      expect(event.detail.error).toContain("Service error:");
      expect(event.detail.error).toContain("Process exited with code 1");
    });

    it("should not close modal on crash by default", () => {
      expect(modal.isOpen()).toBe(true);

      mockLifecycleManager.simulateCrash("test-service", 1);

      expect(modal.isOpen()).toBe(true);
    });

    it("should close modal on crash when configured", async () => {
      syncManager.dispose();
      syncManager = new LifecycleSyncManager(
        mockLifecycleManager as unknown as import("../../../src/services/lifecycle.js").ServiceLifecycleManager,
        { closeOnUnexpectedStop: true },
      );
      syncManager.syncModalWithService(modal, "test-service");
      await syncManager.openServiceModal("test-service", "Test Service");

      mockLifecycleManager.simulateCrash("test-service", 1);

      vi.advanceTimersByTime(3000);
      expect(modal.isOpen()).toBe(false);
    });

    it("should track last error in sync state", () => {
      mockLifecycleManager.simulateCrash("test-service", 1);

      const syncState = syncManager.getSyncState("test-service");
      expect(syncState?.lastError).toContain("stopped unexpectedly");
    });
  });

  describe("state tracking", () => {
    it("should track sync state correctly", () => {
      syncManager.syncModalWithService(modal, "test-service");

      const state = syncManager.getSyncState("test-service");
      expect(state).toBeDefined();
      expect(state?.serviceId).toBe("test-service");
      expect(state?.isSyncing).toBe(true);
      expect(state?.pendingOperation).toBeNull();
    });

    it("should track pending operations", async () => {
      syncManager.syncModalWithService(modal, "test-service");

      mockLifecycleManager.startService.mockImplementationOnce(async () => {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        return {
          serviceId: "test-service",
          state: "started",
          pid: 12345,
        } as MockServiceProcessInstance;
      });

      const startPromise = syncManager.openServiceModal("test-service", "Test Service");

      expect(syncManager.hasPendingOperation("test-service")).toBe(true);

      vi.advanceTimersByTime(1000);
      await startPromise;

      expect(syncManager.hasPendingOperation("test-service")).toBe(false);
    });
  });

  describe("dispose", () => {
    it("should clean up all syncs", () => {
      syncManager.syncModalWithService(modal, "service1");
      syncManager.syncModalWithService(modal, "service2");

      expect(syncManager.isSyncing("service1")).toBe(true);
      expect(syncManager.isSyncing("service2")).toBe(true);

      syncManager.dispose();

      expect(syncManager.isSyncing("service1")).toBe(false);
      expect(syncManager.isSyncing("service2")).toBe(false);
    });
  });

  describe("edge cases", () => {
    it("should handle service transitioning to error state", () => {
      syncManager.syncModalWithService(modal, "test-service");

      const errorListener = vi.fn();
      modal.addEventListener("service-error", errorListener);

      mockLifecycleManager.simulateStartFailure("test-service", new Error("Config error"));

      modal.open("test-service", "Test Service");
      mockLifecycleManager.simulateStartFailure("test-service", new Error("Config error"));
    });

    it("should handle rapid open/close sequences", async () => {
      syncManager.syncModalWithService(modal, "test-service");

      for (let i = 0; i < 5; i++) {
        await syncManager.openServiceModal("test-service", "Test Service");
        expect(modal.isOpen()).toBe(true);

        await syncManager.closeServiceModal("test-service");
        expect(modal.isOpen()).toBe(false);
      }
    });

    it("should handle user closing modal while service starting", async () => {
      syncManager.syncModalWithService(modal, "test-service");

      mockLifecycleManager.startService.mockImplementationOnce(async () => {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        const instance: MockServiceProcessInstance = {
          serviceId: "test-service",
          state: "started",
          pid: 12345,
          startedAt: new Date(),
        };
        mockLifecycleManager.instances.set("test-service", instance);
        return instance;
      });

      const startPromise = syncManager.openServiceModal("test-service", "Test Service");

      modal.close();

      vi.advanceTimersByTime(1000);
      await startPromise;

      expect(mockLifecycleManager.instances.get("test-service")?.state).toBe("started");
    });
  });
});

describe("convenience functions", () => {
  let modal: ServiceModal;
  let mockLifecycleManager: MockLifecycleManager;

  beforeEach(() => {
    vi.useFakeTimers();
    modal = new ServiceModal();
    document.body.appendChild(modal);
    mockLifecycleManager = createMockLifecycleManager();
  });

  afterEach(() => {
    modal.remove();
    vi.useRealTimers();
    resetLifecycleSyncManager();
  });

  describe("syncModalWithService", () => {
    it("should create default manager and sync modal", () => {
      const unregister = syncModalWithService(
        modal,
        "test-service",
        mockLifecycleManager as unknown as import("../../../src/services/lifecycle.js").ServiceLifecycleManager,
      );

      expect(unregister).toBeTypeOf("function");

      unregister();
    });
  });

  describe("openServiceModal", () => {
    it("should open modal and start service", async () => {
      syncModalWithService(
        modal,
        "test-service",
        mockLifecycleManager as unknown as import("../../../src/services/lifecycle.js").ServiceLifecycleManager,
      );

      await openServiceModal(
        "test-service",
        "Test Service",
        mockLifecycleManager as unknown as import("../../../src/services/lifecycle.js").ServiceLifecycleManager,
      );

      expect(modal.isOpen()).toBe(true);
      expect(mockLifecycleManager.startService).toHaveBeenCalledWith("test-service");
    });
  });

  describe("closeServiceModal", () => {
    it("should close modal and stop service", async () => {
      syncModalWithService(
        modal,
        "test-service",
        mockLifecycleManager as unknown as import("../../../src/services/lifecycle.js").ServiceLifecycleManager,
      );
      await openServiceModal(
        "test-service",
        "Test Service",
        mockLifecycleManager as unknown as import("../../../src/services/lifecycle.js").ServiceLifecycleManager,
      );

      await closeServiceModal(
        "test-service",
        mockLifecycleManager as unknown as import("../../../src/services/lifecycle.js").ServiceLifecycleManager,
      );

      expect(modal.isOpen()).toBe(false);
      expect(mockLifecycleManager.stopService).toHaveBeenCalledWith("test-service");
    });
  });

  describe("createLifecycleSyncManager", () => {
    it("should create new manager instance", () => {
      const manager = createLifecycleSyncManager(
        mockLifecycleManager as unknown as import("../../../src/services/lifecycle.js").ServiceLifecycleManager,
        { closeOnUnexpectedStop: true },
      );

      expect(manager).toBeInstanceOf(LifecycleSyncManager);

      manager.dispose();
    });
  });
});

describe("LifecycleSyncError", () => {
  it("should create error with serviceId", () => {
    const error = new LifecycleSyncError("Test error", "test-service");

    expect(error.message).toBe("Test error");
    expect(error.serviceId).toBe("test-service");
    expect(error.name).toBe("LifecycleSyncError");
  });

  it("should create error with cause", () => {
    const cause = new Error("Original error");
    const error = new LifecycleSyncError("Test error", "test-service", cause);

    expect(error.cause).toBe(cause);
  });
});
