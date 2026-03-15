import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, afterEach } from "vitest";
import {
  ServiceRegistry,
  ServiceRegistryError,
  ServiceNotFoundError,
  ServiceAlreadyExistsError,
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
      const refsPath = path.join(serviceDir, "refs.json");

      const manifestExists = await fs
        .access(manifestPath)
        .then(() => true)
        .catch(() => false);
      const configExists = await fs
        .access(configPath)
        .then(() => true)
        .catch(() => false);
      const refsExists = await fs
        .access(refsPath)
        .then(() => true)
        .catch(() => false);

      expect(manifestExists).toBe(true);
      expect(configExists).toBe(true);
      expect(refsExists).toBe(true);
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

      // Get fresh instance
      const service = await registry.get("test-service");

      expect(service?.config).toEqual(initialConfig);
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
    });
  });

  // ============================================================================
  // GetAll with Directory Scanning
  // ============================================================================

  describe("getAll with directory scanning", () => {
    it("should return ServiceInstance[] array from directory scan", async () => {
      // Manually create service directories without using register()
      const service1Dir = path.join(tempDir, "scan-service-1");
      const service2Dir = path.join(tempDir, "scan-service-2");

      // Create service 1 directory with all required files
      await fs.mkdir(service1Dir, { recursive: true });
      await fs.writeFile(
        path.join(service1Dir, "manifest.json"),
        JSON.stringify({
          $schema: "https://openclaw.ai/schemas/service-v1.json",
          id: "scan-service-1",
          name: "Scan Service 1",
          description: "A test service for directory scanning",
          version: "1.0.0",
          category: "productivity",
          trigger: { type: "cron", schedule: "0 8 * * *", timezone: "auto" },
          requires: { tools: [] },
          capabilities: { network: false, filesystem: false },
        }),
      );
      await fs.writeFile(
        path.join(service1Dir, "config.json"),
        JSON.stringify({ greeting: "Hello" }),
      );
      await fs.writeFile(
        path.join(service1Dir, "state.json"),
        JSON.stringify({
          state: "enabled",
          stateHistory: [{ from: "pending", to: "enabled", at: new Date().toISOString() }],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }),
      );
      await fs.writeFile(
        path.join(service1Dir, "refs.json"),
        JSON.stringify({ agentId: "service:scan-service-1" }),
      );

      // Create service 2 directory with all required files
      await fs.mkdir(service2Dir, { recursive: true });
      await fs.writeFile(
        path.join(service2Dir, "manifest.json"),
        JSON.stringify({
          $schema: "https://openclaw.ai/schemas/service-v1.json",
          id: "scan-service-2",
          name: "Scan Service 2",
          description: "Another test service for directory scanning",
          version: "1.0.0",
          category: "integration",
          trigger: { type: "webhook", path: "/test", methods: ["POST"] },
          requires: { tools: [] },
          capabilities: { network: true, filesystem: false },
        }),
      );
      await fs.writeFile(path.join(service2Dir, "config.json"), JSON.stringify({ count: 42 }));
      await fs.writeFile(
        path.join(service2Dir, "state.json"),
        JSON.stringify({
          state: "pending",
          stateHistory: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }),
      );
      await fs.writeFile(
        path.join(service2Dir, "refs.json"),
        JSON.stringify({ agentId: "service:scan-service-2" }),
      );

      // Create new registry instance to force fresh directory scan
      const scanRegistry = new ServiceRegistry({
        fs,
        servicesDir: tempDir,
      });

      const services = await scanRegistry.getAll();

      expect(Array.isArray(services)).toBe(true);
      expect(services).toHaveLength(2);

      const service1 = services.find((s: { id: string }) => s.id === "scan-service-1");
      const service2 = services.find((s: { id: string }) => s.id === "scan-service-2");

      expect(service1).toBeDefined();
      expect(service2).toBeDefined();
    });

    it("should include complete manifest, config, and state data", async () => {
      // Create a service with full data
      const serviceDir = path.join(tempDir, "complete-service");
      const now = new Date().toISOString();

      await fs.mkdir(serviceDir, { recursive: true });
      await fs.writeFile(
        path.join(serviceDir, "manifest.json"),
        JSON.stringify({
          $schema: "https://openclaw.ai/schemas/service-v1.json",
          id: "complete-service",
          name: "Complete Service",
          description: "Service with complete data",
          version: "2.0.0",
          author: "Test Author",
          category: "automation",
          trigger: { type: "cron", schedule: "0 9 * * *", timezone: "UTC" },
          config: {
            apiKey: { type: "secret", description: "API key", required: true },
            timeout: { type: "number", description: "Timeout", default: 30 },
          },
          requires: { skills: ["weather"], tools: ["message.send"], env: [], config: [] },
          capabilities: { privilegedTools: ["message.send"], network: true, filesystem: true },
          execution: {
            agentId: "service:complete-service",
            sessionTarget: "isolated",
            timeout: 60000,
          },
        }),
      );
      await fs.writeFile(
        path.join(serviceDir, "config.json"),
        JSON.stringify({ apiKey: "secret123", timeout: 60 }),
      );
      await fs.writeFile(
        path.join(serviceDir, "state.json"),
        JSON.stringify({
          state: "installed",
          stateHistory: [
            { from: "pending", to: "validating", at: now, reason: "Starting validation" },
            { from: "validating", to: "installing", at: now, reason: "Validation passed" },
            { from: "installing", to: "installed", at: now, reason: "Installation complete" },
          ],
          createdAt: now,
          updatedAt: now,
          executionStats: { totalRuns: 5, successfulRuns: 4, failedRuns: 1 },
          lastRunAt: now,
          nextRunAt: new Date(Date.now() + 3600000).toISOString(),
        }),
      );
      await fs.writeFile(
        path.join(serviceDir, "refs.json"),
        JSON.stringify({
          agentId: "service:complete-service",
          cronJobIds: ["job1", "job2"],
          webhookPaths: ["/webhook1"],
        }),
      );

      const scanRegistry = new ServiceRegistry({
        fs,
        servicesDir: tempDir,
      });

      const services = await scanRegistry.getAll();
      expect(services).toHaveLength(1);

      const service = services[0];

      // Verify ServiceInstance structure
      expect(service.id).toBe("complete-service");
      expect(service.manifest).toBeDefined();
      expect(service.manifest.id).toBe("complete-service");
      expect(service.manifest.name).toBe("Complete Service");
      expect(service.manifest.version).toBe("2.0.0");
      expect(service.config).toEqual({ apiKey: "secret123", timeout: 60 });
      expect(service.createdAt).toBeDefined();
      expect(service.updatedAt).toBeDefined();
      expect(service.runtimeRefs).toBeDefined();
      expect(service.runtimeRefs.agentId).toBe("service:complete-service");
      expect(service.runtimeRefs.cronJobIds).toEqual(["job1", "job2"]);
    });

    it("should return empty array for empty directory", async () => {
      // Create a new empty temp directory
      const emptyDir = await fs.mkdtemp(path.join(os.tmpdir(), "empty-registry-test-"));

      const emptyRegistry = new ServiceRegistry({
        fs,
        servicesDir: emptyDir,
      });

      const services = await emptyRegistry.getAll();

      expect(Array.isArray(services)).toBe(true);
      expect(services).toHaveLength(0);

      // Clean up
      await fs.rm(emptyDir, { recursive: true, force: true });
    });

    it("should gracefully handle invalid service directories", async () => {
      // Create valid service
      const validDir = path.join(tempDir, "valid-service");
      await fs.mkdir(validDir, { recursive: true });
      await fs.writeFile(
        path.join(validDir, "manifest.json"),
        JSON.stringify({
          $schema: "https://openclaw.ai/schemas/service-v1.json",
          id: "valid-service",
          name: "Valid Service",
          version: "1.0.0",
          category: "productivity",
          trigger: { type: "cron", schedule: "0 8 * * *", timezone: "auto" },
          requires: { tools: [] },
          capabilities: { network: false, filesystem: false },
        }),
      );
      await fs.writeFile(path.join(validDir, "config.json"), JSON.stringify({}));
      await fs.writeFile(
        path.join(validDir, "state.json"),
        JSON.stringify({
          state: "pending",
          stateHistory: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }),
      );
      await fs.writeFile(
        path.join(validDir, "refs.json"),
        JSON.stringify({ agentId: "service:valid-service" }),
      );

      // Create invalid service (missing manifest.json)
      const invalidDir1 = path.join(tempDir, "invalid-service-1");
      await fs.mkdir(invalidDir1, { recursive: true });
      await fs.writeFile(path.join(invalidDir1, "config.json"), JSON.stringify({}));
      await fs.writeFile(
        path.join(invalidDir1, "state.json"),
        JSON.stringify({ state: "pending" }),
      );

      // Create invalid service (corrupt JSON)
      const invalidDir2 = path.join(tempDir, "invalid-service-2");
      await fs.mkdir(invalidDir2, { recursive: true });
      await fs.writeFile(path.join(invalidDir2, "manifest.json"), "not valid json");
      await fs.writeFile(path.join(invalidDir2, "config.json"), JSON.stringify({}));
      await fs.writeFile(
        path.join(invalidDir2, "state.json"),
        JSON.stringify({ state: "pending" }),
      );

      // Create a file instead of directory (should be ignored)
      await fs.writeFile(path.join(tempDir, "not-a-service.txt"), "I am not a service");

      const scanRegistry = new ServiceRegistry({
        fs,
        servicesDir: tempDir,
      });

      // Should not throw, should return only valid services
      const services = await scanRegistry.getAll();

      expect(Array.isArray(services)).toBe(true);
      expect(services).toHaveLength(1);
      expect(services[0].id).toBe("valid-service");
    });

    it("should work without index.json dependency", async () => {
      // Create service directory
      const serviceDir = path.join(tempDir, "no-index-service");
      await fs.mkdir(serviceDir, { recursive: true });
      await fs.writeFile(
        path.join(serviceDir, "manifest.json"),
        JSON.stringify({
          $schema: "https://openclaw.ai/schemas/service-v1.json",
          id: "no-index-service",
          name: "No Index Service",
          version: "1.0.0",
          category: "productivity",
          trigger: { type: "cron", schedule: "0 8 * * *", timezone: "auto" },
          requires: { tools: [] },
          capabilities: { network: false, filesystem: false },
        }),
      );
      await fs.writeFile(path.join(serviceDir, "config.json"), JSON.stringify({ test: true }));
      await fs.writeFile(
        path.join(serviceDir, "state.json"),
        JSON.stringify({
          state: "enabled",
          stateHistory: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }),
      );
      await fs.writeFile(
        path.join(serviceDir, "refs.json"),
        JSON.stringify({ agentId: "service:no-index-service" }),
      );

      // Delete index.json if it exists
      const indexPath = path.join(tempDir, "index.json");
      try {
        await fs.unlink(indexPath);
      } catch {
        // Ignore if doesn't exist
      }

      const scanRegistry = new ServiceRegistry({
        fs,
        servicesDir: tempDir,
      });

      // Should still work without index.json
      const services = await scanRegistry.getAll();

      expect(services).toHaveLength(1);
      expect(services[0].id).toBe("no-index-service");
      expect(services[0].config.test).toBe(true);
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
    });

    it("should return registry statistics", async () => {
      const stats = await registry.getStats();

      expect(stats.totalServices).toBe(2);
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
  // Directory Scanning
  // ============================================================================

  describe("directory scanning", () => {
    let scanTempDir: string;
    let scanRegistry: ServiceRegistry;

    beforeEach(async () => {
      scanTempDir = await fs.mkdtemp(path.join(os.tmpdir(), "registry-scan-test-"));
      scanRegistry = new ServiceRegistry({
        fs,
        servicesDir: scanTempDir,
      });
    });

    afterEach(async () => {
      await fs.rm(scanTempDir, { recursive: true, force: true });
    });

    it("should return empty array for empty directory", async () => {
      // @ts-expect-error - accessing private method for testing
      const result = await scanRegistry.scanServiceDirectories();
      expect(result).toEqual([]);
    });

    it("should discover a single valid service directory", async () => {
      // Create a service directory with required files
      const serviceDir = path.join(scanTempDir, "my-service");
      await fs.mkdir(serviceDir, { recursive: true });
      await fs.writeFile(path.join(serviceDir, "manifest.json"), JSON.stringify(sampleManifest));
      await fs.writeFile(
        path.join(serviceDir, "state.json"),
        JSON.stringify({
          serviceId: "test-service",
          state: "enabled",
          stateHistory: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          executionStats: { totalRuns: 0, successfulRuns: 0, failedRuns: 0 },
        }),
      );

      // @ts-expect-error - accessing private method for testing
      const result = await scanRegistry.scanServiceDirectories();

      expect(result).toHaveLength(1);
      expect(result[0].serviceId).toBe("my-service");
      expect(result[0].manifest).toBeDefined();
    });

    it("should discover multiple service directories", async () => {
      // Create multiple service directories
      for (const serviceId of ["service-a", "service-b", "service-c"]) {
        const serviceDir = path.join(scanTempDir, serviceId);
        await fs.mkdir(serviceDir, { recursive: true });
        await fs.writeFile(
          path.join(serviceDir, "manifest.json"),
          JSON.stringify({ ...sampleManifest, id: serviceId }),
        );
        await fs.writeFile(
          path.join(serviceDir, "state.json"),
          JSON.stringify({
            serviceId,
            state: "enabled",
            stateHistory: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            executionStats: { totalRuns: 0, successfulRuns: 0, failedRuns: 0 },
          }),
        );
      }

      // @ts-expect-error - accessing private method for testing
      const result = await scanRegistry.scanServiceDirectories();

      expect(result).toHaveLength(3);
      const serviceIds = result.map((s: { serviceId: string }) => s.serviceId).toSorted();
      expect(serviceIds).toEqual(["service-a", "service-b", "service-c"]);
    });

    it("should skip hidden directories (starting with .)", async () => {
      // Create visible service
      const visibleDir = path.join(scanTempDir, "visible-service");
      await fs.mkdir(visibleDir, { recursive: true });
      await fs.writeFile(path.join(visibleDir, "manifest.json"), JSON.stringify(sampleManifest));
      await fs.writeFile(
        path.join(visibleDir, "state.json"),
        JSON.stringify({
          serviceId: "visible-service",
          state: "enabled",
          stateHistory: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          executionStats: { totalRuns: 0, successfulRuns: 0, failedRuns: 0 },
        }),
      );

      // Create hidden directory
      const hiddenDir = path.join(scanTempDir, ".hidden-service");
      await fs.mkdir(hiddenDir, { recursive: true });
      await fs.writeFile(
        path.join(hiddenDir, "manifest.json"),
        JSON.stringify({ ...sampleManifest, id: "hidden" }),
      );

      // @ts-expect-error - accessing private method for testing
      const result = await scanRegistry.scanServiceDirectories();

      expect(result).toHaveLength(1);
      expect(result[0].serviceId).toBe("visible-service");
    });

    it("should skip non-directory entries (files)", async () => {
      // Create service directory
      const serviceDir = path.join(scanTempDir, "real-service");
      await fs.mkdir(serviceDir, { recursive: true });
      await fs.writeFile(path.join(serviceDir, "manifest.json"), JSON.stringify(sampleManifest));
      await fs.writeFile(
        path.join(serviceDir, "state.json"),
        JSON.stringify({
          serviceId: "real-service",
          state: "enabled",
          stateHistory: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          executionStats: { totalRuns: 0, successfulRuns: 0, failedRuns: 0 },
        }),
      );

      // Create a file (not a directory)
      await fs.writeFile(path.join(scanTempDir, "not-a-service.txt"), "test");

      // @ts-expect-error - accessing private method for testing
      const result = await scanRegistry.scanServiceDirectories();

      expect(result).toHaveLength(1);
      expect(result[0].serviceId).toBe("real-service");
    });

    it("should handle directories without manifest.json gracefully", async () => {
      // Create directory without manifest
      const incompleteDir = path.join(scanTempDir, "incomplete-service");
      await fs.mkdir(incompleteDir, { recursive: true });
      await fs.writeFile(
        path.join(incompleteDir, "state.json"),
        JSON.stringify({
          serviceId: "incomplete-service",
          state: "enabled",
          stateHistory: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          executionStats: { totalRuns: 0, successfulRuns: 0, failedRuns: 0 },
        }),
      );

      // @ts-expect-error - accessing private method for testing
      const result = await scanRegistry.scanServiceDirectories();

      // Should still include the directory but with null manifest
      expect(result).toHaveLength(1);
      expect(result[0].serviceId).toBe("incomplete-service");
      expect(result[0].manifest).toBeNull();
    });
  });

  // ============================================================================
  // List with Directory Scanning
  // ============================================================================

  describe("list with directory scanning", () => {
    // Helper function to create a service directory with manifest.json
    async function createServiceDirectory(
      baseDir: string,
      serviceId: string,
      manifest: Partial<ServiceManifest>,
    ) {
      const serviceDir = path.join(baseDir, serviceId);
      await fs.mkdir(serviceDir, { recursive: true });

      const fullManifest = {
        $schema: "https://openclaw.ai/schemas/service-v1.json",
        id: serviceId,
        name: manifest.name || serviceId,
        description: manifest.description || "Test service",
        version: "1.0.0",
        category: manifest.category || "productivity",
        trigger: manifest.trigger || { type: "cron", schedule: "0 8 * * *" },
        requires: {},
        capabilities: {},
        ...manifest,
      };

      await fs.writeFile(
        path.join(serviceDir, "manifest.json"),
        JSON.stringify(fullManifest, null, 2),
      );

      const configData = { config: {} };
      await fs.writeFile(path.join(serviceDir, "config.json"), JSON.stringify(configData, null, 2));

      const refsData = { agentId: `service:${serviceId}` };
      await fs.writeFile(path.join(serviceDir, "refs.json"), JSON.stringify(refsData, null, 2));
    }

    it("should list all services from directory scanning without index.json", async () => {
      // Create services directly on disk without using register() or index.json
      await createServiceDirectory(tempDir, "service-a", {
        name: "Service A",
        category: "productivity",
        trigger: { type: "cron", schedule: "0 8 * * *" },
      });
      await createServiceDirectory(tempDir, "service-b", {
        name: "Service B",
        category: "integration",
        trigger: { type: "webhook", path: "/test" },
      });
      await createServiceDirectory(tempDir, "service-c", {
        name: "Service C",
        category: "automation",
        trigger: { type: "message", channels: ["slack"] },
      });

      // Ensure index.json does not exist
      const indexPath = path.join(tempDir, "index.json");
      try {
        await fs.unlink(indexPath);
      } catch {
        // Ignore if doesn't exist
      }

      const services = await registry.list();

      expect(services).toHaveLength(3);
      expect(services.map((s) => s.id).toSorted()).toEqual(["service-a", "service-b", "service-c"]);

      // Verify ServiceIndexEntry structure
      const serviceA = services.find((s) => s.id === "service-a");
      expect(serviceA).toBeDefined();
      expect(serviceA).toHaveProperty("id");
      expect(serviceA).toHaveProperty("name");
      expect(serviceA).toHaveProperty("triggerType");
      expect(serviceA).toHaveProperty("category");
      expect(serviceA).toHaveProperty("updatedAt");
      expect(serviceA?.name).toBe("Service A");
      expect(serviceA?.triggerType).toBe("cron");
      expect(serviceA?.category).toBe("productivity");
    });

    it("should filter by category", async () => {
      await createServiceDirectory(tempDir, "productivity-service", {
        name: "Productivity Service",
        category: "productivity",
      });
      await createServiceDirectory(tempDir, "integration-service", {
        name: "Integration Service",
        category: "integration",
      });
      await createServiceDirectory(tempDir, "automation-service", {
        name: "Automation Service",
        category: "automation",
      });

      const productivityServices = await registry.list({ category: "productivity" });
      expect(productivityServices).toHaveLength(1);
      expect(productivityServices[0].id).toBe("productivity-service");

      const integrationServices = await registry.list({ category: "integration" });
      expect(integrationServices).toHaveLength(1);
      expect(integrationServices[0].id).toBe("integration-service");

      const automationServices = await registry.list({ category: "automation" });
      expect(automationServices).toHaveLength(1);
      expect(automationServices[0].id).toBe("automation-service");
    });

    it("should filter by triggerType", async () => {
      await createServiceDirectory(tempDir, "cron-service", {
        name: "Cron Service",
        trigger: { type: "cron", schedule: "0 8 * * *" },
      });
      await createServiceDirectory(tempDir, "webhook-service", {
        name: "Webhook Service",
        trigger: { type: "webhook", path: "/test" },
      });
      await createServiceDirectory(tempDir, "message-service", {
        name: "Message Service",
        trigger: { type: "message", channels: ["slack"] },
      });

      const cronServices = await registry.list({ triggerType: "cron" });
      expect(cronServices).toHaveLength(1);
      expect(cronServices[0].id).toBe("cron-service");

      const webhookServices = await registry.list({ triggerType: "webhook" });
      expect(webhookServices).toHaveLength(1);
      expect(webhookServices[0].id).toBe("webhook-service");

      const messageServices = await registry.list({ triggerType: "message" });
      expect(messageServices).toHaveLength(1);
      expect(messageServices[0].id).toBe("message-service");
    });

    it("should filter by search term (case-insensitive)", async () => {
      await createServiceDirectory(tempDir, "my-test-service", { name: "My Test Service" });
      await createServiceDirectory(tempDir, "another-service", { name: "Another Service" });
      await createServiceDirectory(tempDir, "test-runner", { name: "Test Runner" });

      // Search by name substring
      const searchResults = await registry.list({ search: "test" });
      expect(searchResults).toHaveLength(2);
      expect(searchResults.map((s) => s.id).toSorted()).toEqual(["my-test-service", "test-runner"]);

      // Search by id substring
      const idSearchResults = await registry.list({ search: "another" });
      expect(idSearchResults).toHaveLength(1);
      expect(idSearchResults[0].id).toBe("another-service");

      // Case insensitive search
      const caseInsensitiveResults = await registry.list({ search: "TEST" });
      expect(caseInsensitiveResults).toHaveLength(2);
    });

    it("should combine multiple filters", async () => {
      await createServiceDirectory(tempDir, "enabled-cron-productivity", {
        name: "Enabled Cron Productivity",
        category: "productivity",
        trigger: { type: "cron", schedule: "0 8 * * *" },
      });
      await createServiceDirectory(tempDir, "disabled-cron-productivity", {
        name: "Disabled Cron Productivity",
        category: "productivity",
        trigger: { type: "cron", schedule: "0 9 * * *" },
      });
      await createServiceDirectory(tempDir, "enabled-webhook-productivity", {
        name: "Enabled Webhook Productivity",
        category: "productivity",
        trigger: { type: "webhook", path: "/test" },
      });
      await createServiceDirectory(tempDir, "enabled-cron-integration", {
        name: "Enabled Cron Integration",
        category: "integration",
        trigger: { type: "cron", schedule: "0 10 * * *" },
      });

      // Filter by category + triggerType
      const results = await registry.list({
        category: "productivity",
        triggerType: "cron",
      });
      expect(results).toHaveLength(2);
      expect(results.map((r) => r.id).toSorted()).toEqual([
        "disabled-cron-productivity",
        "enabled-cron-productivity",
      ]);

      // Filter by search
      const searchResults = await registry.list({
        search: "integration",
      });
      expect(searchResults).toHaveLength(1);
      expect(searchResults[0].id).toBe("enabled-cron-integration");
    });

    it("should return empty array when no services match filters", async () => {
      await createServiceDirectory(tempDir, "service-1", {
        name: "Service 1",
        category: "productivity",
      });

      const results = await registry.list({ category: "nonexistent" });
      expect(results).toHaveLength(0);

      const searchResults = await registry.list({ search: "nonexistent" });
      expect(searchResults).toHaveLength(0);
    });

    it("should return empty array when services directory is empty", async () => {
      const emptyRegistry = new ServiceRegistry({
        fs,
        servicesDir: tempDir,
      });

      const services = await emptyRegistry.list();
      expect(services).toHaveLength(0);
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
  });
});
