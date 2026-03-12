import { describe, expect, it } from "vitest";
import {
  ServiceManifestSchema,
  validateServiceManifest,
  isServiceManifest,
  formatValidationErrors,
  type ServiceManifest,
} from "./schema.js";

const validManifest: ServiceManifest = {
  id: "test-service",
  name: "Test Service",
  version: "1.0.0",
  entry: "script/entry.ts",
};

const fullManifest: ServiceManifest = {
  id: "webhook-service",
  name: "Webhook Handler",
  version: "2.1.0",
  description: "Handles incoming webhooks",
  entry: "index.js",
  ui: {
    entry: "ui/index.html",
  },
  capabilities: {
    webhook: true,
    network: true,
  },
  author: "OpenClaw",
  category: "integration",
};

describe("ServiceManifest Schema", () => {
  describe("ServiceManifestSchema validation", () => {
    it("should validate a minimal manifest", () => {
      const result = ServiceManifestSchema.safeParse(validManifest);
      expect(result.success).toBe(true);
    });

    it("should validate a full manifest with all fields", () => {
      const result = ServiceManifestSchema.safeParse(fullManifest);
      expect(result.success).toBe(true);
    });

    it("should reject missing required fields", () => {
      const invalid = { id: "test-service" };
      const result = ServiceManifestSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it("should reject empty id", () => {
      const invalid = { ...validManifest, id: "" };
      const result = ServiceManifestSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it("should reject invalid kebab-case id", () => {
      const invalid = { ...validManifest, id: "Invalid_Service_ID" };
      const result = ServiceManifestSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it("should accept valid kebab-case id", () => {
      const valid = { ...validManifest, id: "my-test-service" };
      const result = ServiceManifestSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });

    it("should reject invalid semver version", () => {
      const invalid = { ...validManifest, version: "1.0" };
      const result = ServiceManifestSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it("should accept valid semver version", () => {
      const valid = { ...validManifest, version: "1.0.0-beta.1" };
      const result = ServiceManifestSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });

    it("should reject absolute path in entry", () => {
      const invalid = { ...validManifest, entry: "/absolute/path.ts" };
      const result = ServiceManifestSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it("should accept relative path in entry", () => {
      const valid = { ...validManifest, entry: "script/entry.ts" };
      const result = ServiceManifestSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });

    it("should accept valid capabilities", () => {
      const valid = { ...validManifest, capabilities: ["webhook", "network", "filesystem"] };
      const result = ServiceManifestSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });

    it("should reject invalid capabilities", () => {
      const invalid = { ...validManifest, capabilities: ["invalid-capability"] };
      const result = ServiceManifestSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it("should accept valid category", () => {
      const valid = { ...validManifest, category: "automation" };
      const result = ServiceManifestSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });

    it("should reject invalid category", () => {
      const invalid = { ...validManifest, category: "invalid-category" };
      const result = ServiceManifestSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });
  });

  describe("validateServiceManifest", () => {
    it("should return success for valid manifest", () => {
      const result = validateServiceManifest(validManifest);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(validManifest);
      }
    });

    it("should return failure for invalid manifest", () => {
      const result = validateServiceManifest({ id: "test" });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errors).toBeDefined();
      }
    });
  });

  describe("isServiceManifest type guard", () => {
    it("should return true for valid manifest", () => {
      expect(isServiceManifest(validManifest)).toBe(true);
    });

    it("should return false for null", () => {
      expect(isServiceManifest(null)).toBe(false);
    });

    it("should return false for undefined", () => {
      expect(isServiceManifest(undefined)).toBe(false);
    });

    it("should return false for empty object", () => {
      expect(isServiceManifest({})).toBe(false);
    });

    it("should return false for invalid manifest", () => {
      expect(isServiceManifest({ id: "test" })).toBe(false);
    });
  });

  describe("formatValidationErrors", () => {
    it("should format validation errors", () => {
      const result = ServiceManifestSchema.safeParse({ id: "" });
      if (!result.success) {
        const formatted = formatValidationErrors(result.error);
        expect(formatted).toContain("id");
        expect(typeof formatted).toBe("string");
      }
    });
  });

  describe("Type inference", () => {
    it("should export correct types", () => {
      const manifest: ServiceManifest = {
        id: "typed-service",
        name: "Typed Service",
        version: "1.0.0",
        entry: "index.ts",
        ui: { entry: "ui.html" },
        capabilities: {
          web: true,
          network: true,
        },
      };
      expect(manifest.id).toBe("typed-service");
    });
  });
});
