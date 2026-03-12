import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import type { ServiceManifest } from "./types.js";
import { validateServiceDirectory } from "./validator.js";

describe("validateServiceDirectory", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "service-test-"));
  });

  afterEach(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("returns valid=false when directory does not exist", () => {
    const nonExistentPath = path.join(tempDir, "non-existent-service");
    const result = validateServiceDirectory(nonExistentPath);

    expect(result.valid).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors![0]).toContain("does not exist");
  });

  it("returns valid=false when path is not a directory", () => {
    const filePath = path.join(tempDir, "not-a-directory.txt");
    fs.writeFileSync(filePath, "test content");

    const result = validateServiceDirectory(filePath);

    expect(result.valid).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors![0]).toContain("not a directory");
  });

  it("returns valid=false when manifest.json is missing", () => {
    const serviceDir = path.join(tempDir, "test-service");
    fs.mkdirSync(serviceDir, { recursive: true });

    const result = validateServiceDirectory(serviceDir);

    expect(result.valid).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors![0]).toContain("Missing manifest.json");
  });

  it("returns valid=false when manifest.json is invalid JSON", () => {
    const serviceDir = path.join(tempDir, "test-service");
    fs.mkdirSync(serviceDir, { recursive: true });
    fs.writeFileSync(path.join(serviceDir, "manifest.json"), "not valid json{");

    const result = validateServiceDirectory(serviceDir);

    expect(result.valid).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors![0]).toContain("Invalid JSON");
  });

  it("returns valid=false when required manifest fields are missing", () => {
    const serviceDir = path.join(tempDir, "test-service");
    fs.mkdirSync(serviceDir, { recursive: true });
    const incompleteManifest = { id: "test-service" };
    fs.writeFileSync(path.join(serviceDir, "manifest.json"), JSON.stringify(incompleteManifest));

    const result = validateServiceDirectory(serviceDir);

    expect(result.valid).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors![0]).toContain("Missing or invalid required manifest fields");
  });

  it("returns valid=false when entry file does not exist", () => {
    const serviceDir = path.join(tempDir, "test-service");
    fs.mkdirSync(serviceDir, { recursive: true });
    const manifest: ServiceManifest = {
      id: "test-service",
      name: "Test Service",
      version: "1.0.0",
      description: "A test service",
      entry: "script/entry.ts",
    };
    fs.writeFileSync(path.join(serviceDir, "manifest.json"), JSON.stringify(manifest));

    const result = validateServiceDirectory(serviceDir);

    expect(result.valid).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors![0]).toContain("Entry file not found");
  });

  it("returns valid=true for a valid service directory", () => {
    const serviceDir = path.join(tempDir, "test-service");
    const scriptDir = path.join(serviceDir, "script");
    fs.mkdirSync(scriptDir, { recursive: true });

    const manifest: ServiceManifest = {
      id: "test-service",
      name: "Test Service",
      version: "1.0.0",
      description: "A test service",
      entry: "script/entry.ts",
    };
    fs.writeFileSync(path.join(serviceDir, "manifest.json"), JSON.stringify(manifest));
    fs.writeFileSync(path.join(scriptDir, "entry.ts"), "export default {}");

    const result = validateServiceDirectory(serviceDir);

    expect(result.valid).toBe(true);
    expect(result.manifest).toBeDefined();
    expect(result.manifest!.id).toBe("test-service");
    expect(result.manifest!.name).toBe("Test Service");
    expect(result.manifest!.version).toBe("1.0.0");
    expect(result.manifest!.description).toBe("A test service");
    expect(result.manifest!.entry).toBe("script/entry.ts");
    expect(result.errors).toBeUndefined();
  });

  it("returns valid=true for service with UI", () => {
    const serviceDir = path.join(tempDir, "test-service");
    const scriptDir = path.join(serviceDir, "script");
    const uiDir = path.join(serviceDir, "ui");
    fs.mkdirSync(scriptDir, { recursive: true });
    fs.mkdirSync(uiDir, { recursive: true });

    const manifest: ServiceManifest = {
      id: "test-service",
      name: "Test Service",
      version: "1.0.0",
      description: "A test service with UI",
      entry: "script/entry.ts",
      ui: { index: "ui/index.html" },
    };
    fs.writeFileSync(path.join(serviceDir, "manifest.json"), JSON.stringify(manifest));
    fs.writeFileSync(path.join(scriptDir, "entry.ts"), "export default {}");
    fs.writeFileSync(path.join(uiDir, "index.html"), "<html></html>");

    const result = validateServiceDirectory(serviceDir);

    expect(result.valid).toBe(true);
    expect(result.manifest).toBeDefined();
    expect(result.manifest!.ui).toBeDefined();
    expect(result.manifest!.ui!.index).toBe("ui/index.html");
    expect(result.errors).toBeUndefined();
  });

  it("returns valid=false when UI index file does not exist", () => {
    const serviceDir = path.join(tempDir, "test-service");
    const scriptDir = path.join(serviceDir, "script");
    fs.mkdirSync(scriptDir, { recursive: true });

    const manifest: ServiceManifest = {
      id: "test-service",
      name: "Test Service",
      version: "1.0.0",
      description: "A test service with missing UI",
      entry: "script/entry.ts",
      ui: { index: "ui/index.html" },
    };
    fs.writeFileSync(path.join(serviceDir, "manifest.json"), JSON.stringify(manifest));
    fs.writeFileSync(path.join(scriptDir, "entry.ts"), "export default {}");

    const result = validateServiceDirectory(serviceDir);

    expect(result.valid).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors![0]).toContain("UI index file not found");
  });

  it("validates service with optional fields", () => {
    const serviceDir = path.join(tempDir, "test-service");
    const scriptDir = path.join(serviceDir, "script");
    fs.mkdirSync(scriptDir, { recursive: true });

    const manifest: ServiceManifest = {
      id: "test-service",
      name: "Test Service",
      version: "1.0.0",
      description: "A test service with all fields",
      entry: "script/entry.ts",
      author: "Test Author",
      license: "MIT",
      capabilities: ["http", "storage"],
    };
    fs.writeFileSync(path.join(serviceDir, "manifest.json"), JSON.stringify(manifest));
    fs.writeFileSync(path.join(scriptDir, "entry.ts"), "export default {}");

    const result = validateServiceDirectory(serviceDir);

    expect(result.valid).toBe(true);
    expect(result.manifest!.author).toBe("Test Author");
    expect(result.manifest!.license).toBe("MIT");
    expect(result.manifest!.capabilities).toEqual(["http", "storage"]);
  });
});
