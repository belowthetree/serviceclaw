import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  scanServices,
  loadService,
  clearCache,
  getDefaultServicesDir,
  getValidServices,
  isValidService,
} from "./discovery.js";
import type { ServiceManifest } from "./types.js";

describe("discovery", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "discovery-test-"));
    clearCache();
  });

  afterEach(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    clearCache();
  });

  function createValidService(
    serviceName: string,
    manifestOverrides: Partial<ServiceManifest> = {},
  ) {
    const serviceDir = path.join(tempDir, serviceName);
    const scriptDir = path.join(serviceDir, "script");
    fs.mkdirSync(scriptDir, { recursive: true });

    const manifest: ServiceManifest = {
      id: serviceName,
      name: serviceName,
      version: "1.0.0",
      description: `Test service ${serviceName}`,
      entry: "script/entry.ts",
      ...manifestOverrides,
    };

    fs.writeFileSync(path.join(serviceDir, "manifest.json"), JSON.stringify(manifest));
    fs.writeFileSync(path.join(scriptDir, "entry.ts"), "export default { activate: () => {} };");

    return serviceDir;
  }

  function createInvalidService(serviceName: string) {
    const serviceDir = path.join(tempDir, serviceName);
    fs.mkdirSync(serviceDir, { recursive: true });
    fs.writeFileSync(path.join(serviceDir, "manifest.json"), JSON.stringify({ id: serviceName }));
    return serviceDir;
  }

  describe("scanServices", () => {
    it("returns empty array for non-existent directory", async () => {
      const nonExistentDir = path.join(tempDir, "non-existent");
      const services = await scanServices(nonExistentDir);
      expect(services).toEqual([]);
    });

    it("returns empty array for empty directory", async () => {
      const services = await scanServices(tempDir);
      expect(services).toEqual([]);
    });

    it("discovers a single valid service", async () => {
      createValidService("my-service");

      const services = await scanServices(tempDir);

      expect(services).toHaveLength(1);
      expect(services[0].name).toBe("my-service");
      expect(services[0].valid).toBe(true);
      expect(services[0].manifest).toBeDefined();
      expect(services[0].manifest!.id).toBe("my-service");
    });

    it("discovers multiple services", async () => {
      createValidService("service-a");
      createValidService("service-b");
      createValidService("service-c");

      const services = await scanServices(tempDir);

      expect(services).toHaveLength(3);
      const names = services.map((s) => s.name).toSorted();
      expect(names).toEqual(["service-a", "service-b", "service-c"]);
    });

    it("includes invalid services with error details", async () => {
      createValidService("valid-service");
      createInvalidService("invalid-service");

      const services = await scanServices(tempDir);

      expect(services).toHaveLength(2);

      const validService = services.find((s) => s.name === "valid-service");
      expect(validService!.valid).toBe(true);

      const invalidService = services.find((s) => s.name === "invalid-service");
      expect(invalidService!.valid).toBe(false);
      expect(invalidService!.errors).toBeDefined();
      expect(invalidService!.errors!.length).toBeGreaterThan(0);
    });

    it("skips hidden directories", async () => {
      createValidService("visible-service");

      const hiddenServiceDir = path.join(tempDir, ".hidden-service");
      fs.mkdirSync(hiddenServiceDir, { recursive: true });
      fs.writeFileSync(
        path.join(hiddenServiceDir, "manifest.json"),
        JSON.stringify({ id: "hidden" }),
      );

      const services = await scanServices(tempDir);

      expect(services).toHaveLength(1);
      expect(services[0].name).toBe("visible-service");
    });

    it("skips ignored directories", async () => {
      createValidService("valid-service");

      const ignoredDirs = ["node_modules", "__tests__", "dist", "build", "test"];
      for (const dirName of ignoredDirs) {
        const ignoredDir = path.join(tempDir, dirName);
        fs.mkdirSync(ignoredDir, { recursive: true });
        fs.writeFileSync(path.join(ignoredDir, "manifest.json"), JSON.stringify({ id: dirName }));
      }

      const services = await scanServices(tempDir);

      expect(services).toHaveLength(1);
      expect(services[0].name).toBe("valid-service");
    });

    it("returns absolute paths", async () => {
      createValidService("my-service");

      const services = await scanServices(tempDir);

      expect(services[0].path).toBe(path.join(tempDir, "my-service"));
      expect(path.isAbsolute(services[0].path)).toBe(true);
    });

    it("uses cache on subsequent calls", async () => {
      createValidService("service-a");

      const services1 = await scanServices(tempDir);
      expect(services1).toHaveLength(1);

      createValidService("service-b");

      const services2 = await scanServices(tempDir);
      expect(services2).toHaveLength(1);

      clearCache();
      const services3 = await scanServices(tempDir);
      expect(services3).toHaveLength(2);
    });

    it("bypasses cache when useCache is false", async () => {
      createValidService("service-a");

      const services1 = await scanServices(tempDir);
      expect(services1).toHaveLength(1);

      createValidService("service-b");

      const services2 = await scanServices(tempDir, { useCache: false });
      expect(services2).toHaveLength(2);
    });

    it("respects custom cache TTL", async () => {
      createValidService("service-a");

      await scanServices(tempDir, { cacheTtlMs: 50 });

      createValidService("service-b");

      await new Promise((resolve) => setTimeout(resolve, 100));

      const services = await scanServices(tempDir, { cacheTtlMs: 50 });
      expect(services).toHaveLength(2);
    });

    it("continues scanning when one service fails validation", async () => {
      createValidService("service-a");

      const badServiceDir = path.join(tempDir, "bad-service");
      fs.mkdirSync(badServiceDir, { recursive: true });
      fs.writeFileSync(path.join(badServiceDir, "manifest.json"), "invalid json");

      createValidService("service-b");

      const services = await scanServices(tempDir);

      expect(services).toHaveLength(3);
      const validServices = services.filter((s) => s.valid);
      expect(validServices).toHaveLength(2);
    });
  });

  describe("loadService", () => {
    it("loads a valid service", async () => {
      const serviceDir = createValidService("loadable-service");

      const loaded = await loadService(serviceDir);

      expect(loaded.manifest.id).toBe("loadable-service");
      expect(loaded.manifest.name).toBe("loadable-service");
      expect(loaded.path).toBe(serviceDir);
      expect(loaded.state).toBe("active");
      expect(loaded.module).toBeDefined();
    });

    it("throws for invalid service", async () => {
      const invalidDir = createInvalidService("invalid");

      await expect(loadService(invalidDir)).rejects.toThrow("Invalid service");
    });

    it("throws when manifest.json is missing", async () => {
      const emptyDir = path.join(tempDir, "empty");
      fs.mkdirSync(emptyDir, { recursive: true });

      await expect(loadService(emptyDir)).rejects.toThrow("Invalid service");
    });

    it("throws when entry file does not exist", async () => {
      const serviceDir = path.join(tempDir, "no-entry");
      fs.mkdirSync(serviceDir, { recursive: true });

      const manifest: ServiceManifest = {
        id: "no-entry",
        name: "No Entry Service",
        version: "1.0.0",
        description: "Test",
        entry: "nonexistent.js",
      };
      fs.writeFileSync(path.join(serviceDir, "manifest.json"), JSON.stringify(manifest));

      await expect(loadService(serviceDir)).rejects.toThrow("Invalid service");
    });

    it("skips validation when skipValidation is true", async () => {
      const serviceDir = path.join(tempDir, "skip-valid");
      fs.mkdirSync(serviceDir, { recursive: true });

      const manifest: ServiceManifest = {
        id: "skip-valid",
        name: "Skip Valid",
        version: "1.0.0",
        description: "Test",
        entry: "entry.js",
      };
      fs.writeFileSync(path.join(serviceDir, "manifest.json"), JSON.stringify(manifest));
      fs.writeFileSync(path.join(serviceDir, "entry.js"), "module.exports = {};");

      const loaded = await loadService(serviceDir, { skipValidation: true });

      expect(loaded.manifest.id).toBe("skip-valid");
    });
  });

  describe("getValidServices", () => {
    it("returns only valid services", async () => {
      createValidService("valid-1");
      createValidService("valid-2");
      createInvalidService("invalid");

      const services = await getValidServices(tempDir);

      expect(services).toHaveLength(2);
      expect(services.every((s) => s.valid)).toBe(true);
      expect(services.every((s) => s.manifest !== undefined)).toBe(true);
    });

    it("returns empty array when no valid services", async () => {
      createInvalidService("invalid-1");
      createInvalidService("invalid-2");

      const services = await getValidServices(tempDir);

      expect(services).toEqual([]);
    });

    it("returns empty array for empty directory", async () => {
      const services = await getValidServices(tempDir);
      expect(services).toEqual([]);
    });
  });

  describe("isValidService", () => {
    it("returns true for valid service", async () => {
      const serviceDir = createValidService("valid-check");

      const result = await isValidService(serviceDir);

      expect(result).toBe(true);
    });

    it("returns false for invalid service", async () => {
      const serviceDir = createInvalidService("invalid-check");

      const result = await isValidService(serviceDir);

      expect(result).toBe(false);
    });

    it("returns false for non-existent path", async () => {
      const result = await isValidService(path.join(tempDir, "non-existent"));

      expect(result).toBe(false);
    });
  });

  describe("getDefaultServicesDir", () => {
    it("returns path to ~/.openclaw/services", () => {
      const defaultDir = getDefaultServicesDir();

      expect(defaultDir).toContain(".openclaw");
      expect(defaultDir).toContain("services");
      expect(path.isAbsolute(defaultDir)).toBe(true);
    });
  });

  describe("clearCache", () => {
    it("clears the discovery cache", async () => {
      createValidService("service-a");

      await scanServices(tempDir);
      createValidService("service-b");

      clearCache();

      const services = await scanServices(tempDir);
      expect(services).toHaveLength(2);
    });
  });

  describe("integration", () => {
    it("full workflow: scan, filter valid, load service", async () => {
      const serviceDir = createValidService("workflow-service", {
        name: "Workflow Test Service",
        capabilities: ["http", "storage"],
      });
      createInvalidService("broken-service");

      const allServices = await scanServices(tempDir);
      expect(allServices).toHaveLength(2);

      const validServices = await getValidServices(tempDir);
      expect(validServices).toHaveLength(1);
      expect(validServices[0].manifest.capabilities).toEqual(["http", "storage"]);

      const loaded = await loadService(validServices[0].path);
      expect(loaded.manifest.name).toBe("Workflow Test Service");
      expect(loaded.state).toBe("active");
    });

    it("services with UI are discovered correctly", async () => {
      const serviceDir = path.join(tempDir, "ui-service");
      const scriptDir = path.join(serviceDir, "script");
      const uiDir = path.join(serviceDir, "ui");
      fs.mkdirSync(scriptDir, { recursive: true });
      fs.mkdirSync(uiDir, { recursive: true });

      const manifest: ServiceManifest = {
        id: "ui-service",
        name: "UI Service",
        version: "1.0.0",
        description: "Service with UI",
        entry: "script/entry.ts",
        ui: { index: "ui/index.html" },
      };
      fs.writeFileSync(path.join(serviceDir, "manifest.json"), JSON.stringify(manifest));
      fs.writeFileSync(path.join(scriptDir, "entry.ts"), "export default {};");
      fs.writeFileSync(path.join(uiDir, "index.html"), "<html></html>");

      const services = await scanServices(tempDir);

      expect(services).toHaveLength(1);
      expect(services[0].valid).toBe(true);
      expect(services[0].manifest!.ui).toBeDefined();
    });

    it("handles service with complex manifest", async () => {
      const serviceDir = createValidService("complex-service", {
        name: "Complex Service",
        description: "A service with all optional fields",
        author: "Test Author",
        license: "MIT",
        capabilities: ["http", "websocket", "cron", "storage"],
      });

      const loaded = await loadService(serviceDir);

      expect(loaded.manifest.author).toBe("Test Author");
      expect(loaded.manifest.license).toBe("MIT");
      expect(loaded.manifest.capabilities).toEqual(["http", "websocket", "cron", "storage"]);
    });
  });
});
