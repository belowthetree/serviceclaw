import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Command } from "commander";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ServiceRegistry, resetServiceRegistry, setServiceRegistry } from "../services/registry.js";
import type { ServiceManifest } from "../services/schema.js";
import { theme } from "../terminal/theme.js";
import {
  registerServiceCli,
  formatState,
  formatDate,
  parseConfigOption,
  isGitUrl,
  loadManifestFromPath,
} from "./service.js";

describe("service CLI", () => {
  let tempDir: string;
  let registry: ServiceRegistry;
  let capturedOutput: string[];
  let capturedErrors: string[];

  const sampleManifest: ServiceManifest = {
    id: "test-service",
    name: "Test Service",
    description: "A test service for unit tests",
    version: "1.0.0",
    trigger: {
      type: "cron",
      schedule: "0 8 * * *",
    },
    config: {
      greeting: {
        type: "string",
        description: "Greeting message",
        default: "Hello",
      },
    },
    requires: {
      skills: [],
      tools: [],
    },
    capabilities: {
      network: false,
      filesystem: false,
      shell: false,
      browser: false,
    },
  };

  beforeEach(async () => {
    tempDir = path.join(os.tmpdir(), `service-test-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });

    // Create a fresh registry for each test
    registry = new ServiceRegistry({
      fs,
      servicesDir: path.join(tempDir, "services"),
    });
    resetServiceRegistry();
    setServiceRegistry(registry);

    // Capture output
    capturedOutput = [];
    capturedErrors = [];

    // Mock defaultRuntime
    const mod = await import("../runtime.js");
    const originalLog = mod.defaultRuntime.log;
    const originalError = mod.defaultRuntime.error;

    mod.defaultRuntime.log = (...args: unknown[]) => {
      capturedOutput.push(args.join(" "));
    };
    mod.defaultRuntime.error = (...args: unknown[]) => {
      capturedErrors.push(args.join(" "));
    };

    // Register cleanup
    afterEach(async () => {
      mod.defaultRuntime.log = originalLog;
      mod.defaultRuntime.error = originalError;
      await fs.rm(tempDir, { recursive: true, force: true });
      resetServiceRegistry();
    });
  });

  afterEach(async () => {
    // Cleanup handled in beforeEach
  });

  describe("formatState", () => {
    it("should format enabled state with success color", () => {
      const result = formatState("enabled");
      expect(result).toBe(theme.success("enabled"));
    });

    it("should format disabled state with warning color", () => {
      const result = formatState("disabled");
      expect(result).toBe(theme.warn("disabled"));
    });

    it("should format error states with error color", () => {
      expect(formatState("error")).toBe(theme.error("error"));
      expect(formatState("validation_error")).toBe(theme.error("validation_error"));
      expect(formatState("install_error")).toBe(theme.error("install_error"));
    });

    it("should format transitional states with accent color", () => {
      expect(formatState("pending")).toBe(theme.accent("pending"));
      expect(formatState("installing")).toBe(theme.accent("installing"));
    });
  });

  describe("formatDate", () => {
    it("should format ISO date strings", () => {
      const dateStr = "2024-01-15T10:30:00.000Z";
      const result = formatDate(dateStr);
      expect(result).not.toBe(theme.muted("never"));
      expect(result).toContain("2024");
    });

    it("should return 'never' for undefined dates", () => {
      const result = formatDate(undefined);
      expect(result).toBe(theme.muted("never"));
    });
  });

  describe("parseConfigOption", () => {
    it("should parse JSON config", () => {
      const result = parseConfigOption('{"key": "value", "num": 42}');
      expect(result).toEqual({ key: "value", num: 42 });
    });

    it("should parse key=value pairs", () => {
      const result = parseConfigOption("name=test,enabled=true,count=5");
      expect(result).toEqual({
        name: "test",
        enabled: true,
        count: 5,
      });
    });

    it("should parse numbers correctly", () => {
      const result = parseConfigOption("int=42,float=3.14,negative=-10");
      expect(result).toEqual({
        int: 42,
        float: 3.14,
        negative: -10,
      });
    });

    it("should return empty object for undefined input", () => {
      const result = parseConfigOption(undefined);
      expect(result).toEqual({});
    });
  });

  describe("isGitUrl", () => {
    it("should detect SSH git URLs", () => {
      expect(isGitUrl("git@github.com:user/repo.git")).toBe(true);
    });

    it("should detect HTTPS git URLs", () => {
      expect(isGitUrl("https://github.com/user/repo.git")).toBe(true);
    });

    it("should detect git+https URLs", () => {
      expect(isGitUrl("git+https://github.com/user/repo.git")).toBe(true);
    });

    it("should detect GitHub shorthand", () => {
      expect(isGitUrl("github:user/repo")).toBe(true);
    });

    it("should not match local paths", () => {
      expect(isGitUrl("/path/to/service")).toBe(false);
      expect(isGitUrl("./local/service.json")).toBe(false);
    });
  });

  describe("loadManifestFromPath", () => {
    it("should load valid service.json", async () => {
      const manifestPath = path.join(tempDir, "service.json");
      await fs.writeFile(manifestPath, JSON.stringify(sampleManifest, null, 2));

      const result = await loadManifestFromPath(manifestPath);
      expect(result).not.toBeNull();
      expect(result?.id).toBe("test-service");
      expect(result?.name).toBe("Test Service");
    });

    it("should return null for non-existent files", async () => {
      const result = await loadManifestFromPath(path.join(tempDir, "nonexistent.json"));
      expect(result).toBeNull();
    });

    it("should return null for invalid manifests", async () => {
      const manifestPath = path.join(tempDir, "invalid.json");
      await fs.writeFile(manifestPath, JSON.stringify({ invalid: true }));

      const result = await loadManifestFromPath(manifestPath);
      expect(result).toBeNull();
    });

    it("should support JSON5 syntax", async () => {
      const manifestPath = path.join(tempDir, "service.json5");
      const json5Content = `
        {
          // This is a comment
          id: "json5-service",
          name: "JSON5 Service",
          description: "Test",
          version: "1.0.0",
          trigger: { type: "web" },
          config: {},
          requires: {},
          capabilities: {},
        }
      `;
      await fs.writeFile(manifestPath, json5Content);

      const result = await loadManifestFromPath(manifestPath);
      expect(result).not.toBeNull();
      expect(result?.id).toBe("json5-service");
    });
  });
});

describe("service CLI integration", () => {
  let tempDir: string;
  let registry: ServiceRegistry;
  let program: Command;

  const sampleManifest: ServiceManifest = {
    id: "integration-sample",
    name: "Integration Sample Service",
    description: "A sample service for integration tests",
    version: "1.0.0",
    trigger: {
      type: "cron",
      schedule: "0 8 * * *",
    },
    config: {},
    requires: {
      skills: [],
      tools: [],
    },
    capabilities: {
      network: false,
      filesystem: false,
      shell: false,
      browser: false,
    },
  };

  beforeEach(async () => {
    tempDir = path.join(os.tmpdir(), `service-integration-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });

    registry = new ServiceRegistry({
      fs,
      servicesDir: path.join(tempDir, "services"),
    });
    resetServiceRegistry();
    setServiceRegistry(registry);

    program = new Command();
    registerServiceCli(program);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
    resetServiceRegistry();
  });

  describe("CLI structure", () => {
    it("should have 'service' command", () => {
      const serviceCmd = program.commands.find((cmd) => cmd.name() === "service");
      expect(serviceCmd).toBeDefined();
    });

    it("should have all 7 subcommands", () => {
      const serviceCmd = program.commands.find((cmd) => cmd.name() === "service");
      expect(serviceCmd).toBeDefined();

      const subcommands = serviceCmd!.commands.map((cmd) => cmd.name());
      expect(subcommands).toContain("list");
      expect(subcommands).toContain("install");
      expect(subcommands).toContain("remove");
      expect(subcommands).toContain("enable");
      expect(subcommands).toContain("disable");
      expect(subcommands).toContain("status");
      expect(subcommands).toContain("logs");
    });
  });

  describe("service lifecycle", () => {
    const lifecycleManifest: ServiceManifest = {
      id: "integration-test",
      name: "Integration Test Service",
      description: "Testing service lifecycle",
      version: "1.0.0",
      trigger: {
        type: "web",
        path: "/test",
      },
      config: {},
      requires: {
        skills: [],
        tools: [],
      },
      capabilities: {
        network: false,
        filesystem: false,
        shell: false,
        browser: false,
      },
    };

    it("should install a service from local path", async () => {
      // Create service.json
      const serviceDir = path.join(tempDir, "my-service");
      await fs.mkdir(serviceDir, { recursive: true });
      await fs.writeFile(
        path.join(serviceDir, "service.json"),
        JSON.stringify(lifecycleManifest, null, 2),
      );

      // Register the service
      const service = await registry.register(lifecycleManifest);
      expect(service.id).toBe("integration-test");
      expect(service.state).toBe("pending");
    });

    it("should enable and disable a service", async () => {
      await registry.register(lifecycleManifest);

      await registry.enable("integration-test");
      let service = await registry.get("integration-test");
      expect(service?.state).toBe("enabled");

      await registry.disable("integration-test");
      service = await registry.get("integration-test");
      expect(service?.state).toBe("disabled");
    });

    it("should track state history", async () => {
      await registry.register(lifecycleManifest);
      await registry.enable("integration-test");
      await registry.disable("integration-test");

      const service = await registry.get("integration-test");
      expect(service?.stateHistory.length).toBeGreaterThanOrEqual(2);
    });

    it("should remove a service", async () => {
      await registry.register(lifecycleManifest);
      expect(await registry.exists("integration-test")).toBe(true);

      await registry.unregister("integration-test");
      expect(await registry.exists("integration-test")).toBe(false);
    });
  });

  describe("registry operations", () => {
    it("should list services with filtering", async () => {
      const manifest1 = {
        ...sampleManifest,
        id: "service-1",
        trigger: { type: "cron" as const, schedule: "0 8 * * *" },
      };
      const manifest2 = {
        ...sampleManifest,
        id: "service-2",
        trigger: { type: "web" as const, path: "/test" },
      };

      await registry.register(manifest1);
      await registry.register(manifest2);

      const allServices = await registry.list();
      expect(allServices.length).toBe(2);

      const cronServices = await registry.list({ triggerType: "cron" });
      expect(cronServices.length).toBe(1);
      expect(cronServices[0]?.id).toBe("service-1");
    });

    it("should provide registry statistics", async () => {
      await registry.register({
        ...sampleManifest,
        id: "stats-test",
      });

      const stats = await registry.getStats();
      expect(stats.totalServices).toBe(1);
      expect(stats.byState.pending).toBe(1);
    });
  });
});
