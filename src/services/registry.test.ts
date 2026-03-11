import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, afterEach } from "vitest";
import {
  ServiceRegistry,
  ServiceRegistryError,
  ServiceNotFoundError,
  ServiceAlreadyExistsError,
  InvalidStateTransitionError,
  getServiceRegistry,
  resetServiceRegistry,
  setServiceRegistry,
} from "./registry.js";
import type { ServiceManifest, ServiceConfig } from "./schema.js";

// =============================================================================
// Test Fixtures
// =============================================================================

const sampleManifest: ServiceManifest = {
  $schema: "https://openclaw.ai/schemas/service-v1.json",
  id: "test-service",
  name: "Test Service",
  description: "A test service for unit tests",
  version: "1.0.0",
  author: "Test Author",
  category: "productivity",
  trigger: {
    type: "cron",
    schedule: "0 8 * * *",
    timezone: "auto",
  },
  config: {
    greeting: {
      type: "string",
      description: "Greeting message",
      default: "Hello",
      required: true,
    },
    count: {
      type: "number",
      description: "Count value",
      default: 5,
      required: false,
    },
  },
  requires: {
    skills: ["weather"],
    tools: ["message.send"],
    env: [],
    config: [],
  },
  capabilities: {
    privilegedTools: ["message.send"],
    network: true,
    filesystem: false,
  },
  execution: {
    agentId: "service:test-service",
    sessionTarget: "isolated",
    timeout: 30000,
  },
};

const webhookManifest: ServiceManifest = {
  $schema: "https://openclaw.ai/schemas/service-v1.json",
  id: "webhook-service",
  name: "Webhook Service",
  description: "A webhook receiver service",
  version: "1.0.0",
  category: "integration",
  trigger: {
    type: "webhook",
    path: "/webhooks/test",
    methods: ["POST"],
  },
  config: {
    secret: {
      type: "secret",
      description: "Webhook secret",
      required: false,
    },
  },
  requires: {
    tools: ["webhook"],
  },
  capabilities: {
    network: true,
    filesystem: false,
  },
};

const messageManifest: ServiceManifest = {
  $schema: "https://openclaw.ai/schemas/service-v1.json",
  id: "message-service",
  name: "Message Service",
  description: "A message processor service",
  version: "1.0.0",
  category: "automation",
  trigger: {
    type: "message",
    channels: ["slack", "discord"],
    filters: {
      keywords: ["!test"],
    },
  },
  config: {
    prefix: {
      type: "string",
      description: "Command prefix",
      default: "!",
    },
  },
  requires: {
    tools: ["slack"],
  },
  capabilities: {
    network: true,
    filesystem: false,
  },
};

// =============================================================================
// Test Suite
// =============================================================================

describe("ServiceRegistry", () => {
  let tempDir: string;
  let registry: ServiceRegistry;

  beforeEach(async () => {
    // Create temporary directory for tests
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "service-registry-test-"));
    registry = new ServiceRegistry({
      fs,
      servicesDir: tempDir,
    });
  });

  afterEach(async () => {
    // Clean up temp directory
    await fs.rm(tempDir, { recursive: true, force: true });
    resetServiceRegistry();
  });

  // ============================================================================
  // Registration
  // ============================================================================

  describe("register", () => {
    it("should register a new service", async () => {
      const service = await registry.register(sampleManifest);

      expect(service.id).toBe("test-service");
      expect(service.manifest).toEqual(sampleManifest);
      expect(service.state).toBe("pending");
      expect(service.config).toEqual({});
      expect(service.runtimeRefs.agentId).toBe("service:test-service");
      expect(service.createdAt).toBeDefined();
      expect(service.updatedAt).toBeDefined();
    });

    it("should register a service with initial config", async () => {
      const initialConfig: ServiceConfig = {
        greeting: "Hi",
        count: 10,
      };

      const service = await registry.register(sampleManifest, initialConfig);

      expect(service.config).toEqual(initialConfig);
    });

    it("should create required files on disk", async () => {
      await registry.register(sampleManifest);

      const serviceDir = path.join(tempDir, "test-service");
      const manifestPath = path.join(serviceDir, "manifest.json");
      const configPath = path.join(serviceDir, "config.json");
      const statePath = path.join(serviceDir, "state.json");
      const refsPath = path.join(serviceDir, "refs.json");

      const manifestExists = await fs
        .access(manifestPath)
        .then(() => true)
        .catch(() => false);
      const configExists = await fs
        .access(configPath)
        .then(() => true)
        .catch(() => false);
      const stateExists = await fs
        .access(statePath)
        .then(() => true)
        .catch(() => false);
      const refsExists = await fs
        .access(refsPath)
        .then(() => true)
        .catch(() => false);

      expect(manifestExists).toBe(true);
      expect(configExists).toBe(true);
      expect(stateExists).toBe(true);
      expect(refsExists).toBe(true);
    });

    it("should update the index", async () => {
      await registry.register(sampleManifest);

      const indexPath = path.join(tempDir, "index.json");
      const indexData = await fs.readFile(indexPath, "utf-8");
      const index = JSON.parse(indexData);

      expect(index.version).toBe(1);
      expect(index.services).toHaveLength(1);
      expect(index.services[0].id).toBe("test-service");
      expect(index.services[0].name).toBe("Test Service");
      expect(index.services[0].state).toBe("pending");
      expect(index.services[0].triggerType).toBe("cron");
      expect(index.services[0].category).toBe("productivity");
    });

    it("should throw ServiceAlreadyExistsError for duplicate service", async () => {
      await registry.register(sampleManifest);

      await expect(registry.register(sampleManifest)).rejects.toThrow(ServiceAlreadyExistsError);
    });
  });

  // ============================================================================
  // Unregistration
  // ============================================================================

  describe("unregister", () => {
    it("should unregister an existing service", async () => {
      await registry.register(sampleManifest);
      await registry.unregister("test-service");

      const serviceDir = path.join(tempDir, "test-service");
      const exists = await fs
        .access(serviceDir)
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(false);
    });

    it("should remove service from index", async () => {
      await registry.register(sampleManifest);
      await registry.unregister("test-service");

      const indexPath = path.join(tempDir, "index.json");
      const indexData = await fs.readFile(indexPath, "utf-8");
      const index = JSON.parse(indexData);

      expect(index.services).toHaveLength(0);
    });

    it("should throw ServiceNotFoundError for non-existent service", async () => {
      await expect(registry.unregister("non-existent")).rejects.toThrow(ServiceNotFoundError);
    });
  });

  // ============================================================================
  // Get and Exists
  // ============================================================================

  describe("get", () => {
    it("should return service instance for existing service", async () => {
      await registry.register(sampleManifest);
      const service = await registry.get("test-service");

      expect(service).toBeDefined();
      expect(service?.id).toBe("test-service");
      expect(service?.manifest.name).toBe("Test Service");
    });

    it("should return undefined for non-existent service", async () => {
      const service = await registry.get("non-existent");
      expect(service).toBeUndefined();
    });

    it("should return full service data from disk", async () => {
      const initialConfig = { greeting: "Hello" };
      await registry.register(sampleManifest, initialConfig);

      // Modify state through valid transitions
      await registry.updateState("test-service", "validating");
      await registry.updateState("test-service", "installing");
      await registry.updateState("test-service", "installed");
      await registry.updateState("test-service", "enabled");

      // Get fresh instance
      const service = await registry.get("test-service");

      expect(service?.state).toBe("enabled");
      expect(service?.config).toEqual(initialConfig);
      expect(service?.stateHistory).toHaveLength(4);
    });
  });

  describe("exists", () => {
    it("should return true for existing service", async () => {
      await registry.register(sampleManifest);
      const exists = await registry.exists("test-service");
      expect(exists).toBe(true);
    });

    it("should return false for non-existent service", async () => {
      const exists = await registry.exists("non-existent");
      expect(exists).toBe(false);
    });
  });

  // ============================================================================
  // State Transitions
  // ============================================================================

  describe("updateState", () => {
    beforeEach(async () => {
      await registry.register(sampleManifest);
    });

    it("should update service state", async () => {
      await registry.updateState("test-service", "validating");
      const service = await registry.get("test-service");
      expect(service?.state).toBe("validating");
    });

    it("should record state transitions", async () => {
      await registry.updateState("test-service", "validating", "Starting validation");
      await registry.updateState("test-service", "installing", "Validation passed");

      const service = await registry.get("test-service");
      expect(service?.stateHistory).toHaveLength(2);
      expect(service?.stateHistory[0].from).toBe("pending");
      expect(service?.stateHistory[0].to).toBe("validating");
      expect(service?.stateHistory[0].reason).toBe("Starting validation");
      expect(service?.stateHistory[1].from).toBe("validating");
      expect(service?.stateHistory[1].to).toBe("installing");
    });

    it("should update updatedAt timestamp", async () => {
      const before = Date.now();
      await new Promise((r) => setTimeout(r, 10)); // Small delay

      await registry.updateState("test-service", "validating");

      const service = await registry.get("test-service");
      expect(new Date(service?.updatedAt ?? 0).getTime()).toBeGreaterThanOrEqual(before);
    });

    it("should throw InvalidStateTransitionError for invalid transitions", async () => {
      // First get to installed state through valid transitions
      await registry.updateState("test-service", "validating");
      await registry.updateState("test-service", "installing");
      await registry.updateState("test-service", "installed");

      // Now try an invalid transition from installed back to pending
      await expect(registry.updateState("test-service", "pending")).rejects.toThrow(
        InvalidStateTransitionError,
      );
    });

    it("should throw ServiceNotFoundError for non-existent service", async () => {
      await expect(registry.updateState("non-existent", "enabled")).rejects.toThrow(
        ServiceNotFoundError,
      );
    });

    it("should allow same-state transitions", async () => {
      await registry.updateState("test-service", "validating");
      await registry.updateState("test-service", "validating"); // Should not throw

      const service = await registry.get("test-service");
      expect(service?.stateHistory).toHaveLength(2);
    });
  });

  // ============================================================================
  // Configuration
  // ============================================================================

  describe("updateConfig", () => {
    beforeEach(async () => {
      await registry.register(sampleManifest);
    });

    it("should update service config", async () => {
      await registry.updateConfig("test-service", { greeting: "Hi" });

      const config = await registry.getConfig("test-service");
      expect(config).toEqual({ greeting: "Hi" });
    });

    it("should merge config with existing", async () => {
      await registry.updateConfig("test-service", { greeting: "Hi" });
      await registry.updateConfig("test-service", { count: 10 });

      const config = await registry.getConfig("test-service");
      expect(config).toEqual({ greeting: "Hi", count: 10 });
    });

    it("should overwrite existing keys", async () => {
      await registry.updateConfig("test-service", { greeting: "Hi" });
      await registry.updateConfig("test-service", { greeting: "Hello" });

      const config = await registry.getConfig("test-service");
      expect(config).toEqual({ greeting: "Hello" });
    });

    it("should throw ServiceNotFoundError for non-existent service", async () => {
      await expect(registry.updateConfig("non-existent", {})).rejects.toThrow(ServiceNotFoundError);
    });
  });

  describe("validateConfig", () => {
    beforeEach(async () => {
      await registry.register(sampleManifest);
    });

    it("should validate valid config", async () => {
      const result = await registry.validateConfig("test-service", {
        greeting: "Hello",
        count: 5,
      });

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should report missing required fields", async () => {
      const result = await registry.validateConfig("test-service", {
        count: 5,
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Missing required config field: greeting");
    });

    it("should warn about unknown fields", async () => {
      const result = await registry.validateConfig("test-service", {
        greeting: "Hello",
        unknownField: "value",
      });

      expect(result.valid).toBe(true);
      expect(result.warnings).toContain("Unknown config field: unknownField");
    });

    it("should validate using current config if none provided", async () => {
      await registry.updateConfig("test-service", { greeting: "Hi" });
      const result = await registry.validateConfig("test-service");

      expect(result.valid).toBe(true);
    });

    it("should return invalid for non-existent service", async () => {
      const result = await registry.validateConfig("non-existent");
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Service not found: non-existent");
    });
  });

  // ============================================================================
  // Runtime References
  // ============================================================================

  describe("updateRuntimeRefs", () => {
    beforeEach(async () => {
      await registry.register(sampleManifest);
    });

    it("should update runtime refs", async () => {
      await registry.updateRuntimeRefs("test-service", {
        cronJobIds: ["job1", "job2"],
      });

      const refs = await registry.getRuntimeRefs("test-service");
      expect(refs?.cronJobIds).toEqual(["job1", "job2"]);
      expect(refs?.agentId).toBe("service:test-service");
    });

    it("should merge refs with existing", async () => {
      await registry.updateRuntimeRefs("test-service", {
        cronJobIds: ["job1"],
      });
      await registry.updateRuntimeRefs("test-service", {
        webhookPaths: ["/webhook1"],
      });

      const refs = await registry.getRuntimeRefs("test-service");
      expect(refs?.cronJobIds).toEqual(["job1"]);
      expect(refs?.webhookPaths).toEqual(["/webhook1"]);
    });

    it("should throw ServiceNotFoundError for non-existent service", async () => {
      await expect(registry.updateRuntimeRefs("non-existent", {})).rejects.toThrow(
        ServiceNotFoundError,
      );
    });
  });

  // ============================================================================
  // Execution Statistics
  // ============================================================================

  describe("recordSuccess", () => {
    beforeEach(async () => {
      await registry.register(sampleManifest);
    });

    it("should record successful execution", async () => {
      await registry.recordSuccess("test-service");

      const service = await registry.get("test-service");
      expect(service?.executionStats.totalRuns).toBe(1);
      expect(service?.executionStats.successfulRuns).toBe(1);
      expect(service?.executionStats.failedRuns).toBe(0);
      expect(service?.lastRunAt).toBeDefined();
    });

    it("should accumulate multiple successes", async () => {
      await registry.recordSuccess("test-service");
      await registry.recordSuccess("test-service");

      const service = await registry.get("test-service");
      expect(service?.executionStats.totalRuns).toBe(2);
      expect(service?.executionStats.successfulRuns).toBe(2);
    });

    it("should throw ServiceNotFoundError for non-existent service", async () => {
      await expect(registry.recordSuccess("non-existent")).rejects.toThrow(ServiceNotFoundError);
    });
  });

  describe("recordFailure", () => {
    beforeEach(async () => {
      await registry.register(sampleManifest);
    });

    it("should record failed execution", async () => {
      const error = new Error("Test error");
      await registry.recordFailure("test-service", error);

      const service = await registry.get("test-service");
      expect(service?.executionStats.totalRuns).toBe(1);
      expect(service?.executionStats.successfulRuns).toBe(0);
      expect(service?.executionStats.failedRuns).toBe(1);
      expect(service?.executionStats.lastError?.message).toBe("Test error");
      expect(service?.executionStats.lastError?.stack).toBeDefined();
    });

    it("should throw ServiceNotFoundError for non-existent service", async () => {
      await expect(registry.recordFailure("non-existent", new Error())).rejects.toThrow(
        ServiceNotFoundError,
      );
    });
  });

  describe("updateNextRun", () => {
    beforeEach(async () => {
      await registry.register(sampleManifest);
    });

    it("should update next run time", async () => {
      const nextRun = new Date(Date.now() + 3600000).toISOString();
      await registry.updateNextRun("test-service", nextRun);

      const service = await registry.get("test-service");
      expect(service?.nextRunAt).toBe(nextRun);
    });

    it("should throw ServiceNotFoundError for non-existent service", async () => {
      await expect(
        registry.updateNextRun("non-existent", new Date().toISOString()),
      ).rejects.toThrow(ServiceNotFoundError);
    });
  });

  // ============================================================================
  // Listing and Querying
  // ============================================================================

  describe("list", () => {
    beforeEach(async () => {
      await registry.register(sampleManifest);
      await registry.register(webhookManifest);
      await registry.register(messageManifest);
    });

    it("should list all services", async () => {
      const services = await registry.list();
      expect(services).toHaveLength(3);
    });

    it("should filter by state", async () => {
      await registry.updateState("test-service", "validating");
      await registry.updateState("test-service", "installing");
      await registry.updateState("test-service", "installed");
      await registry.updateState("test-service", "enabled");

      const services = await registry.list({ state: "enabled" });
      expect(services).toHaveLength(1);
      expect(services[0].id).toBe("test-service");
    });

    it("should filter by category", async () => {
      const services = await registry.list({ category: "integration" });
      expect(services).toHaveLength(1);
      expect(services[0].id).toBe("webhook-service");
    });

    it("should filter by trigger type", async () => {
      const services = await registry.list({ triggerType: "cron" });
      expect(services).toHaveLength(1);
      expect(services[0].id).toBe("test-service");
    });

    it("should search by name", async () => {
      const services = await registry.list({ search: "Webhook" });
      expect(services).toHaveLength(1);
      expect(services[0].id).toBe("webhook-service");
    });

    it("should search by id", async () => {
      const services = await registry.list({ search: "message-service" });
      expect(services).toHaveLength(1);
      expect(services[0].id).toBe("message-service");
    });

    it("should perform case-insensitive search", async () => {
      const services = await registry.list({ search: "TEST" });
      expect(services.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("getByState", () => {
    beforeEach(async () => {
      await registry.register(sampleManifest);
      await registry.updateState("test-service", "validating");
      await registry.updateState("test-service", "installing");
      await registry.updateState("test-service", "installed");
      await registry.updateState("test-service", "enabled");
    });

    it("should return services in specified state", async () => {
      const services = await registry.getByState("enabled");
      expect(services).toHaveLength(1);
      expect(services[0].id).toBe("test-service");
    });

    it("should return empty array when no matches", async () => {
      const services = await registry.getByState("error");
      expect(services).toHaveLength(0);
    });
  });

  describe("getAll", () => {
    beforeEach(async () => {
      await registry.register(sampleManifest);
      await registry.register(webhookManifest);
    });

    it("should return all full service instances", async () => {
      const services = await registry.getAll();
      expect(services).toHaveLength(2);
      expect(services[0]).toHaveProperty("manifest");
      expect(services[0]).toHaveProperty("config");
      expect(services[0]).toHaveProperty("stateHistory");
    });
  });

  // ============================================================================
  // Lifecycle Helpers
  // ============================================================================

  describe("enable/disable", () => {
    beforeEach(async () => {
      await registry.register(sampleManifest);
    });

    it("should enable service", async () => {
      await registry.updateState("test-service", "validating");
      await registry.updateState("test-service", "installing");
      await registry.updateState("test-service", "installed");
      await registry.enable("test-service");
      const service = await registry.get("test-service");
      expect(service?.state).toBe("enabled");
    });

    it("should disable service", async () => {
      await registry.updateState("test-service", "validating");
      await registry.updateState("test-service", "installing");
      await registry.updateState("test-service", "installed");
      await registry.enable("test-service");
      await registry.disable("test-service");
      const service = await registry.get("test-service");
      expect(service?.state).toBe("disabled");
    });
  });

  describe("markInstalling/installed", () => {
    beforeEach(async () => {
      await registry.register(sampleManifest);
    });

    it("should mark as installing", async () => {
      // First transition to validating, then to installing
      await registry.updateState("test-service", "validating");
      await registry.markInstalling("test-service");
      const service = await registry.get("test-service");
      expect(service?.state).toBe("installing");
    });

    it("should mark as installed", async () => {
      await registry.updateState("test-service", "validating");
      await registry.updateState("test-service", "installing");
      await registry.markInstalled("test-service");
      const service = await registry.get("test-service");
      expect(service?.state).toBe("installed");
    });
  });

  describe("markError", () => {
    beforeEach(async () => {
      await registry.register(sampleManifest);
      // Transition through valid states: pending -> validating -> installing -> installed -> enabled
      await registry.updateState("test-service", "validating");
      await registry.updateState("test-service", "installing");
      await registry.updateState("test-service", "installed");
      await registry.enable("test-service");
    });

    it("should mark service as error", async () => {
      await registry.markError("test-service", "Connection failed");
      const service = await registry.get("test-service");
      expect(service?.state).toBe("error");
    });
  });

  // ============================================================================
  // State Persistence and Recovery
  // ============================================================================

  describe("recover", () => {
    it("should rebuild index from disk", async () => {
      // Create services
      await registry.register(sampleManifest);
      await registry.register(webhookManifest);

      // Create new registry instance pointing to same directory
      const newRegistry = new ServiceRegistry({
        fs,
        servicesDir: tempDir,
      });

      // Recover
      await newRegistry.recover();

      // Verify services are accessible
      const services = await newRegistry.list();
      expect(services).toHaveLength(2);
    });

    it("should handle empty directory", async () => {
      await registry.recover();
      const services = await registry.list();
      expect(services).toHaveLength(0);
    });
  });

  describe("getStats", () => {
    beforeEach(async () => {
      await registry.register(sampleManifest);
      await registry.register(webhookManifest);
      // Transition through valid states to enable
      await registry.updateState("test-service", "validating");
      await registry.updateState("test-service", "installing");
      await registry.updateState("test-service", "installed");
      await registry.updateState("test-service", "enabled");
    });

    it("should return registry statistics", async () => {
      const stats = await registry.getStats();

      expect(stats.totalServices).toBe(2);
      expect(stats.byState.enabled).toBe(1);
      expect(stats.byState.pending).toBe(1);
      expect(stats.byCategory.productivity).toBe(1);
      expect(stats.byCategory.integration).toBe(1);
      expect(stats.byTriggerType.cron).toBe(1);
      expect(stats.byTriggerType.webhook).toBe(1);
    });
  });

  describe("clear", () => {
    it("should clear all services", async () => {
      await registry.register(sampleManifest);
      await registry.clear();

      const services = await registry.list();
      expect(services).toHaveLength(0);
    });
  });

  // ============================================================================
  // Singleton
  // ============================================================================

  describe("singleton", () => {
    it("getServiceRegistry should return same instance", () => {
      const r1 = getServiceRegistry();
      const r2 = getServiceRegistry();
      expect(r1).toBe(r2);
    });

    it("resetServiceRegistry should create new instance on next get", () => {
      const r1 = getServiceRegistry();
      resetServiceRegistry();
      const r2 = getServiceRegistry();
      expect(r1).not.toBe(r2);
    });

    it("setServiceRegistry should set custom registry", () => {
      const custom = new ServiceRegistry();
      setServiceRegistry(custom);
      expect(getServiceRegistry()).toBe(custom);
    });
  });

  // ============================================================================
  // Error Classes
  // ============================================================================

  describe("error classes", () => {
    it("ServiceRegistryError should have correct name", () => {
      const error = new ServiceRegistryError("test");
      expect(error.name).toBe("ServiceRegistryError");
      expect(error.message).toBe("test");
    });

    it("ServiceNotFoundError should have correct name", () => {
      const error = new ServiceNotFoundError("my-service");
      expect(error.name).toBe("ServiceNotFoundError");
      expect(error.message).toBe("Service not found: my-service");
    });

    it("ServiceAlreadyExistsError should have correct name", () => {
      const error = new ServiceAlreadyExistsError("my-service");
      expect(error.name).toBe("ServiceAlreadyExistsError");
      expect(error.message).toBe("Service already exists: my-service");
    });

    it("InvalidStateTransitionError should have correct name", () => {
      const error = new InvalidStateTransitionError("pending", "enabled");
      expect(error.name).toBe("InvalidStateTransitionError");
      expect(error.message).toBe("Invalid state transition from pending to enabled");
    });
  });
});
