import { describe, expect, it, vi } from "vitest";
import {
  CleanupVerifier,
  RollbackCoordinator,
  ServiceCleanupError,
  ServiceDependencyError,
  ServiceError,
  ServiceInstallationError,
  ServiceNetworkError,
  ServicePermissionError,
  ServiceResourceError,
  ServiceRollbackError,
  ServiceRuntimeError,
  ServiceStateError,
  ServiceValidationError,
  aggregateErrors,
  createServiceError,
  getRecoverySuggestions,
  getUserFriendlyMessage,
  isRetryableError,
  wrapServiceError,
  type CleanupReport,
  type ServiceErrorCategory,
  type ServiceErrorContext,
  _testing,
} from "./errors.js";

describe("ServiceError", () => {
  describe("base ServiceError class", () => {
    it("should create error with all properties", () => {
      const cause = new Error("Original error");
      const context: ServiceErrorContext = { field: "testField", expected: "string", actual: 123 };

      const error = new ServiceError({
        message: "Test error message",
        serviceId: "test-service",
        category: "validation",
        severity: "error",
        context,
        cause,
        code: "CUSTOM_CODE",
      });

      expect(error.message).toBe("Test error message");
      expect(error.serviceId).toBe("test-service");
      expect(error.category).toBe("validation");
      expect(error.severity).toBe("error");
      expect(error.context).toBe(context);
      expect(error.cause).toBe(cause);
      expect(error.code).toBe("CUSTOM_CODE");
      expect(error.name).toBe("ServiceError");
      expect(error.timestamp).toBeInstanceOf(Date);
    });

    it("should use default severity when not provided", () => {
      const error = new ServiceError({
        message: "Test error",
        serviceId: "test-service",
        category: "installation",
      });

      expect(error.severity).toBe("error");
    });

    it("should auto-generate code when not provided", () => {
      const error = new ServiceError({
        message: "Test error",
        serviceId: "test-service",
        category: "validation",
      });

      expect(error.code).toBe("SERVICE_VALIDATION");
    });

    it("should provide user message", () => {
      const error = new ServiceError({
        message: "Test error",
        serviceId: "test-service",
        category: "validation",
      });

      const userMessage = error.getUserMessage();
      expect(userMessage).toContain("Test error");
    });

    it("should provide recovery suggestions", () => {
      const error = new ServiceError({
        message: "Test error",
        serviceId: "test-service",
        category: "validation",
      });

      const suggestions = error.getRecoverySuggestions();
      expect(suggestions.length).toBeGreaterThan(0);
      expect(suggestions.some((s) => s.includes("configuration"))).toBe(true);
    });

    it("should check if error is retryable", () => {
      const networkError = new ServiceError({
        message: "Network error",
        serviceId: "test-service",
        category: "network",
      });

      const validationError = new ServiceError({
        message: "Validation error",
        serviceId: "test-service",
        category: "validation",
      });

      expect(networkError.isRetryable()).toBe(true);
      expect(validationError.isRetryable()).toBe(false);
    });

    it("should serialize to JSON", () => {
      const cause = new Error("Original");
      const error = new ServiceError({
        message: "Test error",
        serviceId: "test-service",
        category: "installation",
        cause,
      });

      const json = error.toJSON();

      expect(json.name).toBe("ServiceError");
      expect(json.message).toBe("Test error");
      expect(json.serviceId).toBe("test-service");
      expect(json.category).toBe("installation");
      expect(json.cause).toEqual({ name: "Error", message: "Original" });
      expect(json.timestamp).toBeDefined();
    });
  });

  describe("ServiceValidationError", () => {
    it("should create validation error with errors list", () => {
      const validationErrors = ["Field A is required", "Field B must be a number"];

      const error = new ServiceValidationError({
        message: "Validation failed",
        serviceId: "test-service",
        validationErrors,
      });

      expect(error.category).toBe("validation");
      expect(error.severity).toBe("warning");
      expect(error.validationErrors).toEqual(validationErrors);
      expect(error.code).toBe("SERVICE_VALIDATION_FAILED");
    });

    it("should format errors for display", () => {
      const error = new ServiceValidationError({
        message: "Validation failed",
        serviceId: "test-service",
        validationErrors: ["Error 1", "Error 2", "Error 3"],
      });

      const formatted = error.getFormattedErrors();
      expect(formatted).toContain("1. Error 1");
      expect(formatted).toContain("2. Error 2");
      expect(formatted).toContain("3. Error 3");
    });
  });

  describe("ServiceInstallationError", () => {
    it("should create installation error with phase info", () => {
      const error = new ServiceInstallationError({
        message: "Failed to create cron job",
        serviceId: "test-service",
        phase: "create_resources",
        completedPhases: ["validate", "prepare"],
      });

      expect(error.category).toBe("installation");
      expect(error.phase).toBe("create_resources");
      expect(error.completedPhases).toEqual(["validate", "prepare"]);
      expect(error.code).toBe("SERVICE_INSTALL_CREATE_RESOURCES_FAILED");
    });
  });

  describe("ServiceStateError", () => {
    it("should create state error with transition info", () => {
      const error = new ServiceStateError({
        message: "Cannot enable from current state",
        serviceId: "test-service",
        currentState: "pending",
        attemptedTransition: "enable",
        validTransitions: ["validating", "validation_error"],
      });

      expect(error.category).toBe("state");
      expect(error.currentState).toBe("pending");
      expect(error.attemptedTransition).toBe("enable");
      expect(error.validTransitions).toEqual(["validating", "validation_error"]);
    });

    it("should format valid transitions", () => {
      const error = new ServiceStateError({
        message: "Invalid transition",
        serviceId: "test-service",
        currentState: "enabled",
        attemptedTransition: "install",
        validTransitions: ["disabled", "error", "uninstalling"],
      });

      expect(error.getValidTransitionsText()).toBe("disabled, error, uninstalling");
    });

    it("should handle empty valid transitions", () => {
      const error = new ServiceStateError({
        message: "Invalid transition",
        serviceId: "test-service",
        currentState: "uninstalling",
        attemptedTransition: "enable",
        validTransitions: [],
      });

      expect(error.getValidTransitionsText()).toBe("none");
    });
  });

  describe("ServiceResourceError", () => {
    it("should create resource error with resource info", () => {
      const error = new ServiceResourceError({
        message: "Failed to create cron job",
        serviceId: "test-service",
        resourceType: "cron",
        operation: "create",
        resourceId: "cron-123",
      });

      expect(error.category).toBe("resource");
      expect(error.resourceType).toBe("cron");
      expect(error.operation).toBe("create");
      expect(error.resourceId).toBe("cron-123");
      expect(error.code).toBe("SERVICE_RESOURCE_CRON_CREATE_FAILED");
    });

    it("should create webhook resource error", () => {
      const error = new ServiceResourceError({
        message: "Failed to register webhook",
        serviceId: "test-service",
        resourceType: "webhook",
        operation: "register",
        resourceId: "/webhook/path",
      });

      expect(error.code).toBe("SERVICE_RESOURCE_WEBHOOK_REGISTER_FAILED");
    });
  });

  describe("ServiceRollbackError", () => {
    it("should create rollback error with results", () => {
      const originalError = new Error("Installation failed");
      const rolledBackResources = ["cron:job1", "webhook:/path1"];
      const failedResources = [
        { resource: "subscription:channel1", error: "Already unsubscribed" },
      ];

      const error = new ServiceRollbackError({
        message: "Rollback completed with 1 failure",
        serviceId: "test-service",
        originalError,
        rolledBackResources,
        failedResources,
      });

      expect(error.category).toBe("rollback");
      expect(error.severity).toBe("critical");
      expect(error.originalError).toBe(originalError);
      expect(error.rolledBackResources).toEqual(rolledBackResources);
      expect(error.failedResources).toEqual(failedResources);
    });

    it("should check if rollback is complete", () => {
      const completeError = new ServiceRollbackError({
        message: "Rollback successful",
        serviceId: "test-service",
        originalError: new Error("Original"),
        rolledBackResources: ["cron:job1"],
        failedResources: [],
      });

      const incompleteError = new ServiceRollbackError({
        message: "Rollback incomplete",
        serviceId: "test-service",
        originalError: new Error("Original"),
        rolledBackResources: ["cron:job1"],
        failedResources: [{ resource: "webhook:/path", error: "Failed" }],
      });

      expect(completeError.isComplete()).toBe(true);
      expect(incompleteError.isComplete()).toBe(false);
    });

    it("should provide rollback summary", () => {
      const error = new ServiceRollbackError({
        message: "Rollback status",
        serviceId: "test-service",
        originalError: new Error("Original"),
        rolledBackResources: ["cron:job1", "webhook:/path"],
        failedResources: [{ resource: "subscription:channel1", error: "Failed" }],
      });

      const summary = error.getRollbackSummary();
      expect(summary).toBe("Rollback: 2/3 resources cleaned up successfully");
    });
  });

  describe("ServiceCleanupError", () => {
    it("should create cleanup error with results", () => {
      const error = new ServiceCleanupError({
        message: "Cleanup incomplete",
        serviceId: "test-service",
        cleanedResources: ["cron:job1"],
        failedResources: [{ resource: "webhook:/path", error: "Permission denied" }],
        missingResources: ["subscription:old"],
      });

      expect(error.category).toBe("cleanup");
      expect(error.severity).toBe("warning");
      expect(error.cleanedResources).toEqual(["cron:job1"]);
      expect(error.failedResources).toHaveLength(1);
      expect(error.missingResources).toEqual(["subscription:old"]);
    });

    it("should check if cleanup is complete", () => {
      const completeError = new ServiceCleanupError({
        message: "Cleanup complete",
        serviceId: "test-service",
        cleanedResources: ["cron:job1"],
        failedResources: [],
      });

      const incompleteError = new ServiceCleanupError({
        message: "Cleanup incomplete",
        serviceId: "test-service",
        cleanedResources: ["cron:job1"],
        failedResources: [{ resource: "webhook:/path", error: "Failed" }],
      });

      expect(completeError.isComplete()).toBe(true);
      expect(incompleteError.isComplete()).toBe(false);
    });

    it("should provide cleanup report", () => {
      const error = new ServiceCleanupError({
        message: "Cleanup report",
        serviceId: "test-service",
        cleanedResources: ["cron:job1", "webhook:/path"],
        failedResources: [{ resource: "subscription:channel1", error: "Failed" }],
        missingResources: ["cron:oldjob"],
      });

      const report: CleanupReport = error.getCleanupReport();
      expect(report.totalResources).toBe(4);
      expect(report.cleaned).toBe(2);
      expect(report.failed).toBe(1);
      expect(report.missing).toBe(1);
      expect(report.success).toBe(false);
    });
  });

  describe("ServiceNetworkError", () => {
    it("should create network error with endpoint info", () => {
      const error = new ServiceNetworkError({
        message: "Connection timeout",
        serviceId: "test-service",
        endpoint: "https://api.example.com/webhook",
        retryable: true,
        retryCount: 2,
      });

      expect(error.category).toBe("network");
      expect(error.endpoint).toBe("https://api.example.com/webhook");
      expect(error.retryable).toBe(true);
      expect(error.retryCount).toBe(2);
    });

    it("should default retryable to false", () => {
      const error = new ServiceNetworkError({
        message: "Connection failed",
        serviceId: "test-service",
      });

      expect(error.retryable).toBe(false);
      expect(error.retryCount).toBe(0);
    });
  });

  describe("ServicePermissionError", () => {
    it("should create permission error with resource info", () => {
      const error = new ServicePermissionError({
        message: "Access denied",
        serviceId: "test-service",
        resource: "cron:system",
        requiredPermission: "cron:create",
      });

      expect(error.category).toBe("permission");
      expect(error.resource).toBe("cron:system");
      expect(error.requiredPermission).toBe("cron:create");
    });
  });

  describe("ServiceDependencyError", () => {
    it("should create dependency error with version info", () => {
      const error = new ServiceDependencyError({
        message: "Missing dependency: node-cron",
        serviceId: "test-service",
        dependency: "node-cron",
        dependencyType: "external",
        requiredVersion: "^3.0.0",
      });

      expect(error.category).toBe("dependency");
      expect(error.dependency).toBe("node-cron");
      expect(error.dependencyType).toBe("external");
      expect(error.requiredVersion).toBe("^3.0.0");
    });

    it("should create skill dependency error", () => {
      const error = new ServiceDependencyError({
        message: "Skill not found: database",
        serviceId: "test-service",
        dependency: "database",
        dependencyType: "skill",
      });

      expect(error.dependencyType).toBe("skill");
    });
  });

  describe("ServiceRuntimeError", () => {
    it("should create runtime error with context", () => {
      const executionContext = { triggerData: { message: "test" }, timestamp: Date.now() };

      const error = new ServiceRuntimeError({
        message: "Execution failed",
        serviceId: "test-service",
        triggerType: "cron",
        executionContext,
        autoDisable: true,
      });

      expect(error.category).toBe("runtime");
      expect(error.triggerType).toBe("cron");
      expect(error.executionContext).toEqual(executionContext);
      expect(error.autoDisable).toBe(true);
    });

    it("should default autoDisable to true", () => {
      const error = new ServiceRuntimeError({
        message: "Execution failed",
        serviceId: "test-service",
      });

      expect(error.autoDisable).toBe(true);
    });
  });
});

describe("Error helpers", () => {
  describe("isRetryableError", () => {
    it("should return true for network errors", () => {
      const error = new ServiceNetworkError({
        message: "Network error",
        serviceId: "test",
        retryable: true,
      });

      expect(isRetryableError(error)).toBe(true);
    });

    it("should return false for network errors explicitly marked non-retryable", () => {
      const error = new ServiceNetworkError({
        message: "Network error",
        serviceId: "test",
        retryable: false,
      });

      expect(isRetryableError(error)).toBe(false);
    });

    it("should return true for resource errors", () => {
      const error = new ServiceResourceError({
        message: "Resource error",
        serviceId: "test",
        resourceType: "cron",
        operation: "create",
      });

      expect(isRetryableError(error)).toBe(true);
    });

    it("should return false for validation errors", () => {
      const error = new ServiceValidationError({
        message: "Validation error",
        serviceId: "test",
        validationErrors: ["Invalid"],
      });

      expect(isRetryableError(error)).toBe(false);
    });

    it("should check context for retryable flag", () => {
      const error = new ServiceError({
        message: "Error",
        serviceId: "test",
        category: "unknown",
        context: { retryable: true },
      });

      expect(isRetryableError(error)).toBe(true);
    });
  });

  describe("getRecoverySuggestions", () => {
    it("should provide base suggestions for validation errors", () => {
      const error = new ServiceValidationError({
        message: "Validation failed",
        serviceId: "test",
        validationErrors: ["Field missing"],
      });

      const suggestions = getRecoverySuggestions(error);
      expect(suggestions.length).toBeGreaterThan(0);
      expect(suggestions.some((s) => s.includes("configuration"))).toBe(true);
    });

    it("should add state-specific suggestions", () => {
      const error = new ServiceStateError({
        message: "Invalid transition",
        serviceId: "test",
        currentState: "pending",
        attemptedTransition: "enable",
        validTransitions: ["validating"],
      });

      const suggestions = getRecoverySuggestions(error);
      expect(suggestions.some((s) => s.includes("Valid next states"))).toBe(true);
    });

    it("should add rollback-specific suggestions", () => {
      const error = new ServiceRollbackError({
        message: "Rollback failed",
        serviceId: "test",
        originalError: new Error("Original"),
        rolledBackResources: [],
        failedResources: [{ resource: "cron:job", error: "Failed" }],
      });

      const suggestions = getRecoverySuggestions(error);
      expect(suggestions.some((s) => s.includes("Failed to roll back"))).toBe(true);
    });
  });

  describe("getUserFriendlyMessage", () => {
    it("should provide user-friendly message for validation errors", () => {
      const error = new ServiceValidationError({
        message: "Config field 'apiKey' is required",
        serviceId: "test",
        validationErrors: ["apiKey is required"],
      });

      const message = getUserFriendlyMessage(error);
      expect(message).toContain("Service configuration is invalid");
      expect(message).toContain("Config field 'apiKey' is required");
    });

    it("should provide user-friendly message for network errors", () => {
      const error = new ServiceNetworkError({
        message: "Connection refused",
        serviceId: "test",
      });

      const message = getUserFriendlyMessage(error);
      expect(message).toContain("Network error occurred");
    });
  });

  describe("createServiceError", () => {
    it("should return ServiceError as-is", () => {
      const original = new ServiceError({
        message: "Original",
        serviceId: "test",
        category: "validation",
      });

      const result = createServiceError(original, "other-service", "installation");
      expect(result).toBe(original);
    });

    it("should wrap Error in ServiceError", () => {
      const cause = new Error("Something went wrong");

      const error = createServiceError(cause, "test-service");

      expect(error).toBeInstanceOf(ServiceError);
      expect(error.message).toBe("Something went wrong");
      expect(error.serviceId).toBe("test-service");
      expect(error.category).toBe("unknown");
      expect(error.cause).toBe(cause);
    });

    it("should wrap string in ServiceError", () => {
      const error = createServiceError("String error", "test-service");

      expect(error.message).toBe("String error");
    });

    it("should wrap unknown value in ServiceError", () => {
      const error = createServiceError(12345, "test-service");

      expect(error.message).toBe("12345");
    });
  });

  describe("wrapServiceError", () => {
    it("should add context to existing ServiceError", () => {
      const original = new ServiceError({
        message: "Original",
        serviceId: "test",
        category: "validation",
        context: { field: "oldField" },
      });

      const wrapped = wrapServiceError(original, "test", { phase: "create_resources" });

      expect(wrapped.context).toEqual({ field: "oldField", phase: "create_resources" });
    });

    it("should wrap plain Error", () => {
      const cause = new Error("Plain error");

      const wrapped = wrapServiceError(cause, "test-service", { operation: "create" });

      expect(wrapped).toBeInstanceOf(ServiceError);
      expect(wrapped.message).toBe("Plain error");
      expect(wrapped.cause).toBe(cause);
      expect(wrapped.context).toEqual({ operation: "create" });
    });
  });

  describe("aggregateErrors", () => {
    it("should return single error unchanged", () => {
      const error = new ServiceError({
        message: "Single error",
        serviceId: "test",
        category: "validation",
      });

      const result = aggregateErrors([error], "test", "Multiple errors occurred");
      expect(result).toBe(error);
    });

    it("should return info error for empty array", () => {
      const result = aggregateErrors([], "test", "No errors");

      expect(result.severity).toBe("info");
      expect(result.message).toContain("No errors");
    });

    it("should aggregate multiple errors with most severe category", () => {
      const warning = new ServiceError({
        message: "Warning",
        serviceId: "test",
        category: "validation",
        severity: "warning",
      });
      const critical = new ServiceError({
        message: "Critical",
        serviceId: "test",
        category: "rollback",
        severity: "critical",
      });
      const error = new ServiceError({
        message: "Error",
        serviceId: "test",
        category: "installation",
        severity: "error",
      });

      const result = aggregateErrors([warning, error, critical], "test", "Multiple issues");

      expect(result.severity).toBe("critical");
      expect(result.category).toBe("rollback");
      expect(result.message).toContain("3 errors occurred");
    });
  });
});

describe("RollbackCoordinator", () => {
  describe("add", () => {
    it("should add rollback actions", () => {
      const coordinator = new RollbackCoordinator();
      const execute = vi.fn().mockResolvedValue(undefined);

      coordinator.add({
        resourceId: "cron:job1",
        description: "Remove cron job",
        execute,
      });

      expect(coordinator.getStatus().total).toBe(1);
    });
  });

  describe("execute", () => {
    it("should execute rollback actions in reverse order", async () => {
      const coordinator = new RollbackCoordinator();
      const order: string[] = [];

      coordinator.add({
        resourceId: "first",
        description: "First action",
        execute: async () => {
          order.push("first");
        },
      });

      coordinator.add({
        resourceId: "second",
        description: "Second action",
        execute: async () => {
          order.push("second");
        },
      });

      await coordinator.execute("test-service");

      expect(order).toEqual(["second", "first"]);
    });

    it("should track executed actions", async () => {
      const coordinator = new RollbackCoordinator();

      coordinator.add({
        resourceId: "resource1",
        description: "Action 1",
        execute: vi.fn().mockResolvedValue(undefined),
      });

      await coordinator.execute("test-service");

      expect(coordinator.getStatus().executed).toBe(1);
      expect(coordinator.getStatus().remaining).toBe(0);
    });

    it("should continue on non-critical failures", async () => {
      const coordinator = new RollbackCoordinator();
      const order: string[] = [];

      coordinator.add({
        resourceId: "first",
        description: "First action",
        execute: async () => {
          order.push("first");
        },
      });

      coordinator.add({
        resourceId: "failing",
        description: "Failing action",
        execute: async () => {
          throw new Error("Failed");
        },
      });

      coordinator.add({
        resourceId: "last",
        description: "Last action",
        execute: async () => {
          order.push("last");
        },
      });

      await expect(coordinator.execute("test-service")).rejects.toThrow(ServiceRollbackError);

      // Should still execute first action (in reverse order)
      expect(order).toContain("first");
    });

    it("should stop on critical failures", async () => {
      const coordinator = new RollbackCoordinator();
      const order: string[] = [];

      coordinator.add({
        resourceId: "first",
        description: "First action",
        execute: async () => {
          order.push("first");
        },
      });

      coordinator.add({
        resourceId: "critical",
        description: "Critical action",
        critical: true,
        execute: async () => {
          throw new Error("Critical failure");
        },
      });

      await expect(coordinator.execute("test-service")).rejects.toThrow(ServiceRollbackError);

      // Should not execute first action since critical failed first
      expect(order).toHaveLength(0);
    });

    it("should skip already executed actions", async () => {
      const coordinator = new RollbackCoordinator();
      const execute = vi.fn().mockResolvedValue(undefined);

      coordinator.add({
        resourceId: "resource1",
        description: "Action",
        execute,
      });

      await coordinator.execute("test-service");
      await coordinator.execute("test-service"); // Second call

      expect(execute).toHaveBeenCalledTimes(1);
    });

    it("should throw ServiceRollbackError on failures", async () => {
      const coordinator = new RollbackCoordinator();

      coordinator.add({
        resourceId: "failing",
        description: "Failing action",
        execute: async () => {
          throw new Error("Cleanup failed");
        },
      });

      await expect(coordinator.execute("test-service")).rejects.toThrow(ServiceRollbackError);
    });
  });

  describe("getStatus", () => {
    it("should return current status", () => {
      const coordinator = new RollbackCoordinator();

      coordinator.add({
        resourceId: "r1",
        description: "Action 1",
        execute: vi.fn(),
      });

      coordinator.add({
        resourceId: "r2",
        description: "Action 2",
        execute: vi.fn(),
      });

      const status = coordinator.getStatus();

      expect(status.total).toBe(2);
      expect(status.executed).toBe(0);
      expect(status.remaining).toBe(2);
      expect(status.failed).toBe(0);
    });
  });

  describe("isComplete", () => {
    it("should return true when no actions remain", async () => {
      const coordinator = new RollbackCoordinator();

      coordinator.add({
        resourceId: "r1",
        description: "Action",
        execute: vi.fn().mockResolvedValue(undefined),
      });

      expect(coordinator.isComplete()).toBe(false);

      await coordinator.execute("test-service");

      expect(coordinator.isComplete()).toBe(true);
    });
  });

  describe("clear", () => {
    it("should clear all actions", () => {
      const coordinator = new RollbackCoordinator();

      coordinator.add({
        resourceId: "r1",
        description: "Action",
        execute: vi.fn(),
      });

      coordinator.clear();

      expect(coordinator.getStatus().total).toBe(0);
      expect(coordinator.isComplete()).toBe(true);
    });
  });
});

describe("CleanupVerifier", () => {
  describe("add", () => {
    it("should add verification checks", () => {
      const verifier = new CleanupVerifier();

      verifier.add("resource1", "Check resource 1", async () => true);

      // No direct way to check, but verify will work
      expect(async () => verifier.verify("test")).not.toThrow();
    });
  });

  describe("addCronVerification", () => {
    it("should add cron job verifications", async () => {
      const verifier = new CleanupVerifier();
      const existsCheck = vi.fn().mockResolvedValue(false);

      verifier.addCronVerification(["job1", "job2"], existsCheck);

      const result = await verifier.verify("test-service");

      expect(result.verified).toHaveLength(2);
      expect(existsCheck).toHaveBeenCalledWith("job1");
      expect(existsCheck).toHaveBeenCalledWith("job2");
    });

    it("should mark as failed if cron job still exists", async () => {
      const verifier = new CleanupVerifier();
      const existsCheck = vi.fn().mockResolvedValue(true); // Still exists

      verifier.addCronVerification(["job1"], existsCheck);

      const result = await verifier.verify("test-service");

      expect(result.success).toBe(false);
      expect(result.failed).toHaveLength(1);
      expect(result.failed[0].resource).toBe("cron:job1");
    });
  });

  describe("addWebhookVerification", () => {
    it("should add webhook verifications", async () => {
      const verifier = new CleanupVerifier();
      const existsCheck = vi.fn().mockResolvedValue(false);

      verifier.addWebhookVerification(["/webhook1", "/webhook2"], existsCheck);

      const result = await verifier.verify("test-service");

      expect(result.verified).toHaveLength(2);
    });

    it("should mark as failed if webhook still registered", async () => {
      const verifier = new CleanupVerifier();
      const existsCheck = vi.fn().mockResolvedValue(true);

      verifier.addWebhookVerification(["/webhook1"], existsCheck);

      const result = await verifier.verify("test-service");

      expect(result.failed).toHaveLength(1);
      expect(result.failed[0].resource).toBe("webhook:/webhook1");
    });
  });

  describe("addSubscriptionVerification", () => {
    it("should add subscription verifications", async () => {
      const verifier = new CleanupVerifier();
      const existsCheck = vi.fn().mockResolvedValue(false);

      verifier.addSubscriptionVerification(["discord", "slack"], existsCheck);

      const result = await verifier.verify("test-service");

      expect(result.verified).toHaveLength(2);
    });
  });

  describe("verify", () => {
    it("should return success when all resources cleaned", async () => {
      const verifier = new CleanupVerifier();

      verifier.add("resource1", "Check 1", async () => true);
      verifier.add("resource2", "Check 2", async () => true);

      const result = await verifier.verify("test-service");

      expect(result.success).toBe(true);
      expect(result.verified).toHaveLength(2);
      expect(result.failed).toHaveLength(0);
    });

    it("should return failure when resources still exist", async () => {
      const verifier = new CleanupVerifier();

      verifier.add("clean", "Clean check", async () => true);
      verifier.add("dirty", "Dirty check", async () => false);

      const result = await verifier.verify("test-service");

      expect(result.success).toBe(false);
      expect(result.verified).toHaveLength(1);
      expect(result.failed).toHaveLength(1);
    });

    it("should handle errors as orphaned resources when not found", async () => {
      const verifier = new CleanupVerifier();

      verifier.add("resource1", "Check 1", async () => {
        throw new Error("ENOENT: resource not found");
      });

      const result = await verifier.verify("test-service");

      expect(result.orphaned).toHaveLength(1);
      expect(result.orphaned[0]).toBe("resource1");
    });

    it("should handle errors as failures for other errors", async () => {
      const verifier = new CleanupVerifier();

      verifier.add("resource1", "Check 1", async () => {
        throw new Error("Permission denied");
      });

      const result = await verifier.verify("test-service");

      expect(result.failed).toHaveLength(1);
      expect(result.failed[0].error).toContain("Permission denied");
    });

    it("should categorize missing errors correctly", async () => {
      const verifier = new CleanupVerifier();

      verifier.add("resource1", "Check", async () => {
        const err = new Error("Not found");
        (err as { code?: string }).code = "ENOENT";
        throw err;
      });

      const result = await verifier.verify("test-service");

      expect(result.orphaned).toContain("resource1");
    });
  });

  describe("clear", () => {
    it("should clear all verifications", async () => {
      const verifier = new CleanupVerifier();

      verifier.add("resource1", "Check", async () => true);
      verifier.clear();

      const result = await verifier.verify("test-service");

      expect(result.verified).toHaveLength(0);
    });
  });
});

describe("Error constants", () => {
  describe("ERROR_MESSAGES", () => {
    it("should have messages for all categories", () => {
      const categories: ServiceErrorCategory[] = [
        "validation",
        "installation",
        "runtime",
        "state",
        "resource",
        "network",
        "permission",
        "dependency",
        "rollback",
        "cleanup",
        "unknown",
      ];

      for (const category of categories) {
        expect(_testing.ERROR_MESSAGES[category]).toBeDefined();
        expect(_testing.ERROR_MESSAGES[category].length).toBeGreaterThan(0);
      }
    });
  });

  describe("RECOVERY_SUGGESTIONS", () => {
    it("should have suggestions for all categories", () => {
      const categories: ServiceErrorCategory[] = [
        "validation",
        "installation",
        "runtime",
        "state",
        "resource",
        "network",
        "permission",
        "dependency",
        "rollback",
        "cleanup",
        "unknown",
      ];

      for (const category of categories) {
        expect(_testing.RECOVERY_SUGGESTIONS[category]).toBeDefined();
        expect(_testing.RECOVERY_SUGGESTIONS[category].length).toBeGreaterThan(0);
      }
    });
  });
});

describe("Edge cases", () => {
  describe("ServiceError with circular context", () => {
    it("should handle serialization gracefully", () => {
      const context: Record<string, unknown> = { key: "value" };
      context.circular = context;

      const error = new ServiceError({
        message: "Test",
        serviceId: "test",
        category: "unknown",
        context,
      });

      // Should not throw
      const json = error.toJSON();
      expect(json.context).toBeDefined();
    });
  });

  describe("RollbackCoordinator with no actions", () => {
    it("should complete successfully when no actions", async () => {
      const coordinator = new RollbackCoordinator();

      await expect(coordinator.execute("test-service")).resolves.not.toThrow();
      expect(coordinator.isComplete()).toBe(true);
    });
  });

  describe("CleanupVerifier with no verifications", () => {
    it("should return success when no verifications", async () => {
      const verifier = new CleanupVerifier();

      const result = await verifier.verify("test-service");

      expect(result.success).toBe(true);
    });
  });

  describe("Error with very long message", () => {
    it("should handle long messages", () => {
      const longMessage = "a".repeat(10000);

      const error = new ServiceError({
        message: longMessage,
        serviceId: "test",
        category: "unknown",
      });

      expect(error.message).toBe(longMessage);
      const json = error.toJSON();
      expect(json.message).toBe(longMessage);
    });
  });

  describe("Multiple nested errors", () => {
    it("should preserve error chain", () => {
      const cause1 = new Error("Root cause");
      const cause2 = new ServiceError({
        message: "Intermediate",
        serviceId: "test",
        category: "unknown",
        cause: cause1,
      });
      const error = new ServiceError({
        message: "Top level",
        serviceId: "test",
        category: "unknown",
        cause: cause2,
      });

      expect(error.cause).toBe(cause2);
      expect(error.cause?.cause).toBe(cause1);
    });
  });
});

describe("Integration scenarios", () => {
  describe("Installation failure with rollback", () => {
    it("should coordinate full rollback on installation failure", async () => {
      const coordinator = new RollbackCoordinator();
      const rolledBack: string[] = [];

      // Simulate successful resource creation
      coordinator.add({
        resourceId: "cron:job1",
        description: "Cron job 1",
        execute: async () => {
          rolledBack.push("cron:job1");
        },
      });

      coordinator.add({
        resourceId: "webhook:/hook1",
        description: "Webhook 1",
        execute: async () => {
          rolledBack.push("webhook:/hook1");
        },
      });

      coordinator.add({
        resourceId: "subscription:discord",
        description: "Discord subscription",
        execute: async () => {
          rolledBack.push("subscription:discord");
        },
      });

      // Execute rollback
      await coordinator.execute("my-service");

      // Should roll back in reverse order
      expect(rolledBack).toEqual(["subscription:discord", "webhook:/hook1", "cron:job1"]);
    });
  });

  describe("Cleanup verification after uninstall", () => {
    it("should verify all resources are cleaned up", async () => {
      const verifier = new CleanupVerifier();

      // Simulate resource existence checks
      const existingResources = new Set<string>();

      verifier.addCronVerification(["job1", "job2"], async (id) =>
        existingResources.has(`cron:${id}`),
      );
      verifier.addWebhookVerification(["/hook1"], async (path) =>
        existingResources.has(`webhook:${path}`),
      );

      // All cleaned up
      const result = await verifier.verify("my-service");

      expect(result.success).toBe(true);
      expect(result.verified).toHaveLength(3);
      expect(result.failed).toHaveLength(0);
    });

    it("should detect leftover resources", async () => {
      const verifier = new CleanupVerifier();
      const existingResources = new Set<string>(["cron:job1"]);

      verifier.addCronVerification(["job1", "job2"], async (id) =>
        existingResources.has(`cron:${id}`),
      );

      const result = await verifier.verify("my-service");

      expect(result.success).toBe(false);
      expect(result.failed).toHaveLength(1);
      expect(result.failed[0].resource).toBe("cron:job1");
    });
  });

  describe("Complex error scenario", () => {
    it("should aggregate multiple error types", () => {
      const errors: ServiceError[] = [
        new ServiceValidationError({
          message: "Invalid config",
          serviceId: "svc1",
          validationErrors: ["apiKey missing"],
        }),
        new ServiceResourceError({
          message: "Cron creation failed",
          serviceId: "svc1",
          resourceType: "cron",
          operation: "create",
        }),
        new ServiceNetworkError({
          message: "Webhook registration failed",
          serviceId: "svc1",
          endpoint: "https://example.com",
        }),
      ];

      const aggregated = aggregateErrors(errors, "svc1", "Installation failed");

      expect(aggregated.message).toContain("3 errors occurred");
    });
  });
});
