import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import type { ServiceManifest } from "./types.js";
import {
  validateServiceDirectory,
  validateTraditionalService,
  validateDeclarativeService,
} from "./validator.js";

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
    expect(result.errors![0]).toContain("Missing service.json or manifest.json");
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
    expect(result.errors![0]).toContain("Missing or invalid required field");
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

describe("validateTraditionalService", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "traditional-service-test-"));
  });

  afterEach(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("returns valid=true for a valid traditional service with entry", () => {
    const scriptDir = path.join(tempDir, "script");
    fs.mkdirSync(scriptDir, { recursive: true });
    fs.writeFileSync(path.join(scriptDir, "entry.ts"), "export default {}");

    const manifest: ServiceManifest = {
      id: "traditional-service",
      name: "Traditional Service",
      version: "1.0.0",
      description: "A valid traditional service",
      entry: "script/entry.ts",
    };

    const result = validateTraditionalService(tempDir, manifest, "manifest.json");

    expect(result.valid).toBe(true);
    expect(result.serviceType).toBe("traditional");
    expect(result.manifest).toBeDefined();
    expect(result.manifest!.id).toBe("traditional-service");
  });

  it("returns valid=false when entry is missing", () => {
    const manifest = {
      id: "traditional-service",
      name: "Traditional Service",
      version: "1.0.0",
    };

    const result = validateTraditionalService(tempDir, manifest, "manifest.json");

    expect(result.valid).toBe(false);
    expect(result.serviceType).toBe("traditional");
    expect(result.errors).toBeDefined();
    expect(result.errors![0]).toContain("requires an 'entry' field");
  });

  it("returns valid=false when entry file does not exist", () => {
    const manifest: ServiceManifest = {
      id: "traditional-service",
      name: "Traditional Service",
      version: "1.0.0",
      entry: "script/nonexistent.ts",
    };

    const result = validateTraditionalService(tempDir, manifest, "manifest.json");

    expect(result.valid).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors![0]).toContain("Entry file not found");
  });

  it("returns valid=false when manifest is not an object", () => {
    const result = validateTraditionalService(tempDir, "not an object", "manifest.json");

    expect(result.valid).toBe(false);
    expect(result.serviceType).toBe("traditional");
    expect(result.errors).toBeDefined();
    expect(result.errors![0]).toContain("must be a valid object");
  });

  it("returns valid=false when required base fields are missing", () => {
    const manifest = {
      id: "traditional-service",
      name: "Traditional Service",
      entry: "script/entry.ts",
    };

    const result = validateTraditionalService(tempDir, manifest, "manifest.json");

    expect(result.valid).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors!.some((e) => e.includes("version"))).toBe(true);
  });

  it("validates trigger field when present", () => {
    const scriptDir = path.join(tempDir, "script");
    fs.mkdirSync(scriptDir, { recursive: true });
    fs.writeFileSync(path.join(scriptDir, "entry.ts"), "export default {}");

    const manifest: ServiceManifest = {
      id: "traditional-service",
      name: "Traditional Service",
      version: "1.0.0",
      entry: "script/entry.ts",
      trigger: {
        type: "cron",
        schedule: "*/5 * * * *",
      },
    };

    const result = validateTraditionalService(tempDir, manifest, "manifest.json");

    expect(result.valid).toBe(true);
    expect(result.manifest!.trigger).toBeDefined();
    expect(result.manifest!.trigger!.type).toBe("cron");
  });
});

describe("validateDeclarativeService", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "declarative-service-test-"));
  });

  afterEach(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("returns valid=true for a valid declarative service with trigger", () => {
    const manifest: ServiceManifest = {
      id: "declarative-service",
      name: "Declarative Service",
      version: "1.0.0",
      description: "A valid declarative service",
      trigger: {
        type: "cron",
        schedule: "0 9 * * *",
      },
    };

    const result = validateDeclarativeService(tempDir, manifest, "service.json");

    expect(result.valid).toBe(true);
    expect(result.serviceType).toBe("declarative");
    expect(result.manifest).toBeDefined();
    expect(result.manifest!.id).toBe("declarative-service");
    expect(result.manifest!.trigger).toBeDefined();
  });

  it("returns valid=false when trigger is missing", () => {
    const manifest = {
      id: "declarative-service",
      name: "Declarative Service",
      version: "1.0.0",
    };

    const result = validateDeclarativeService(tempDir, manifest, "service.json");

    expect(result.valid).toBe(false);
    expect(result.serviceType).toBe("declarative");
    expect(result.errors).toBeDefined();
    expect(result.errors!.some((e) => e.includes("trigger"))).toBe(true);
  });

  it("returns valid=false when trigger type is invalid", () => {
    const manifest = {
      id: "declarative-service",
      name: "Declarative Service",
      version: "1.0.0",
      trigger: {
        type: "invalid-type",
      },
    };

    const result = validateDeclarativeService(tempDir, manifest, "service.json");

    expect(result.valid).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors!.some((e) => e.includes("Invalid trigger type"))).toBe(true);
  });

  it("returns valid=false when manifest is not an object", () => {
    const result = validateDeclarativeService(tempDir, "not an object", "service.json");

    expect(result.valid).toBe(false);
    expect(result.serviceType).toBe("declarative");
    expect(result.errors).toBeDefined();
    expect(result.errors![0]).toContain("must be a valid object");
  });

  it("returns valid=false when required base fields are missing", () => {
    const manifest = {
      id: "declarative-service",
      name: "Declarative Service",
      trigger: {
        type: "webhook",
        path: "/webhook",
      },
    };

    const result = validateDeclarativeService(tempDir, manifest, "service.json");

    expect(result.valid).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors!.some((e) => e.includes("version"))).toBe(true);
  });

  it("validates optional entry file when present", () => {
    const scriptDir = path.join(tempDir, "script");
    fs.mkdirSync(scriptDir, { recursive: true });
    fs.writeFileSync(path.join(scriptDir, "handler.ts"), "export default {}");

    const manifest: ServiceManifest = {
      id: "declarative-service",
      name: "Declarative Service",
      version: "1.0.0",
      entry: "script/handler.ts",
      trigger: {
        type: "webhook",
        path: "/webhook",
      },
    };

    const result = validateDeclarativeService(tempDir, manifest, "service.json");

    expect(result.valid).toBe(true);
    expect(result.manifest!.entry).toBe("script/handler.ts");
  });

  it("validates UI fields when present", () => {
    const uiDir = path.join(tempDir, "ui");
    fs.mkdirSync(uiDir, { recursive: true });
    fs.writeFileSync(path.join(uiDir, "index.html"), "<html></html>");

    const manifest: ServiceManifest = {
      id: "declarative-service",
      name: "Declarative Service",
      version: "1.0.0",
      trigger: {
        type: "message",
        channels: ["discord"],
      },
      ui: {
        index: "ui/index.html",
      },
    };

    const result = validateDeclarativeService(tempDir, manifest, "service.json");

    expect(result.valid).toBe(true);
    expect(result.manifest!.ui).toBeDefined();
    expect(result.manifest!.ui!.index).toBe("ui/index.html");
  });
});

describe("service type detection from file types", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "service-type-test-"));
  });

  afterEach(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("detects traditional service from manifest.json with entry field", () => {
    const serviceDir = path.join(tempDir, "traditional-service");
    const scriptDir = path.join(serviceDir, "script");
    fs.mkdirSync(scriptDir, { recursive: true });

    const manifest: ServiceManifest = {
      id: "traditional-service",
      name: "Traditional Service",
      version: "1.0.0",
      entry: "script/entry.ts",
    };
    fs.writeFileSync(path.join(serviceDir, "manifest.json"), JSON.stringify(manifest));
    fs.writeFileSync(path.join(scriptDir, "entry.ts"), "export default {}");

    const result = validateServiceDirectory(serviceDir);

    expect(result.valid).toBe(true);
    expect(result.serviceType).toBe("traditional");
  });

  it("detects declarative service from service.json with trigger field", () => {
    const serviceDir = path.join(tempDir, "declarative-service");
    fs.mkdirSync(serviceDir, { recursive: true });

    const manifest: ServiceManifest = {
      id: "declarative-service",
      name: "Declarative Service",
      version: "1.0.0",
      trigger: {
        type: "cron",
        schedule: "0 9 * * *",
      },
    };
    fs.writeFileSync(path.join(serviceDir, "service.json"), JSON.stringify(manifest));

    const result = validateServiceDirectory(serviceDir);

    expect(result.valid).toBe(true);
    expect(result.serviceType).toBe("declarative");
  });

  it("defaults to traditional for manifest.json without clear type indicators", () => {
    const serviceDir = path.join(tempDir, "ambiguous-service");
    const scriptDir = path.join(serviceDir, "script");
    fs.mkdirSync(scriptDir, { recursive: true });

    const manifest: ServiceManifest = {
      id: "ambiguous-service",
      name: "Ambiguous Service",
      version: "1.0.0",
      entry: "script/entry.ts",
    };
    fs.writeFileSync(path.join(serviceDir, "manifest.json"), JSON.stringify(manifest));
    fs.writeFileSync(path.join(scriptDir, "entry.ts"), "export default {}");

    const result = validateServiceDirectory(serviceDir);

    expect(result.valid).toBe(true);
    expect(result.serviceType).toBe("traditional");
  });

  it("defaults to traditional for service.json without trigger when no entry present", () => {
    const serviceDir = path.join(tempDir, "ambiguous-service");
    fs.mkdirSync(serviceDir, { recursive: true });

    // A service with neither entry nor trigger defaults to traditional
    const manifest = {
      id: "ambiguous-service",
      name: "Ambiguous Service",
      version: "1.0.0",
    };
    fs.writeFileSync(path.join(serviceDir, "service.json"), JSON.stringify(manifest));

    const result = validateServiceDirectory(serviceDir);

    // Service without entry and without trigger validates as traditional (which requires entry)
    expect(result.valid).toBe(false);
    expect(result.serviceType).toBe("traditional");
  });

  it("prefers service.json over manifest.json when both exist", () => {
    const serviceDir = path.join(tempDir, "dual-manifest-service");
    fs.mkdirSync(serviceDir, { recursive: true });

    const serviceManifest: ServiceManifest = {
      id: "declarative-service",
      name: "Declarative Service",
      version: "1.0.0",
      trigger: {
        type: "webhook",
        path: "/webhook",
      },
    };

    const traditionalManifest: ServiceManifest = {
      id: "traditional-service",
      name: "Traditional Service",
      version: "1.0.0",
      entry: "script/entry.ts",
    };

    fs.writeFileSync(path.join(serviceDir, "service.json"), JSON.stringify(serviceManifest));
    fs.writeFileSync(path.join(serviceDir, "manifest.json"), JSON.stringify(traditionalManifest));

    const result = validateServiceDirectory(serviceDir);

    expect(result.valid).toBe(true);
    expect(result.serviceType).toBe("declarative");
    expect(result.manifest!.id).toBe("declarative-service");
  });

  it("correctly identifies webhook trigger type in declarative service", () => {
    const serviceDir = path.join(tempDir, "webhook-service");
    fs.mkdirSync(serviceDir, { recursive: true });

    const manifest: ServiceManifest = {
      id: "webhook-service",
      name: "Webhook Service",
      version: "1.0.0",
      trigger: {
        type: "webhook",
        path: "/api/webhook",
      },
    };
    fs.writeFileSync(path.join(serviceDir, "service.json"), JSON.stringify(manifest));

    const result = validateServiceDirectory(serviceDir);

    expect(result.valid).toBe(true);
    expect(result.serviceType).toBe("declarative");
    expect(result.manifest!.trigger!.type).toBe("webhook");
  });

  it("correctly identifies message trigger type in declarative service", () => {
    const serviceDir = path.join(tempDir, "message-service");
    fs.mkdirSync(serviceDir, { recursive: true });

    const manifest: ServiceManifest = {
      id: "message-service",
      name: "Message Service",
      version: "1.0.0",
      trigger: {
        type: "message",
        channels: ["telegram", "discord"],
      },
    };
    fs.writeFileSync(path.join(serviceDir, "service.json"), JSON.stringify(manifest));

    const result = validateServiceDirectory(serviceDir);

    expect(result.valid).toBe(true);
    expect(result.serviceType).toBe("declarative");
    expect(result.manifest!.trigger!.type).toBe("message");
  });

  it("correctly identifies web trigger type in declarative service", () => {
    const serviceDir = path.join(tempDir, "web-trigger-service");
    fs.mkdirSync(serviceDir, { recursive: true });

    const manifest: ServiceManifest = {
      id: "web-trigger-service",
      name: "Web Trigger Service",
      version: "1.0.0",
      trigger: {
        type: "web",
        path: "/ui",
      },
    };
    fs.writeFileSync(path.join(serviceDir, "service.json"), JSON.stringify(manifest));

    const result = validateServiceDirectory(serviceDir);

    expect(result.valid).toBe(true);
    expect(result.serviceType).toBe("declarative");
    expect(result.manifest!.trigger!.type).toBe("web");
  });
});
