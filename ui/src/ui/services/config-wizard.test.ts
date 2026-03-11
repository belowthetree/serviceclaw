import { describe, expect, it } from "vitest";
import { getInputType, validateField, humanize, type ServiceConfigField } from "./config-wizard.ts";

describe("config-wizard", () => {
  describe("humanize", () => {
    it("should convert camelCase to readable text", () => {
      expect(humanize("weatherLocation")).toBe("Weather Location");
      expect(humanize("newsSources")).toBe("News Sources");
    });

    it("should convert snake_case to readable text", () => {
      expect(humanize("task_sources")).toBe("Task Sources");
    });

    it("should capitalize first letter", () => {
      expect(humanize("enabled")).toBe("Enabled");
    });

    it("should handle empty string", () => {
      expect(humanize("")).toBe("");
    });
  });

  describe("getInputType", () => {
    it("should return toggle for boolean type", () => {
      const field: ServiceConfigField = {
        type: "boolean",
        description: "Enable feature",
      };
      expect(getInputType(field)).toBe("toggle");
    });

    it("should return number for number type", () => {
      const field: ServiceConfigField = {
        type: "number",
        description: "Count",
      };
      expect(getInputType(field)).toBe("number");
    });

    it("should return multiselect for array type", () => {
      const field: ServiceConfigField = {
        type: "array",
        description: "Tags",
      };
      expect(getInputType(field)).toBe("multiselect");
    });

    it("should return select for string with enum", () => {
      const field: ServiceConfigField = {
        type: "string",
        description: "Mode",
        enum: ["light", "dark", "auto"],
      };
      expect(getInputType(field)).toBe("select");
    });

    it("should return text for string without enum", () => {
      const field: ServiceConfigField = {
        type: "string",
        description: "Name",
      };
      expect(getInputType(field)).toBe("text");
    });

    it("should respect x-openclaw inputType hint", () => {
      const field: ServiceConfigField = {
        type: "string",
        description: "Channel",
        "x-openclaw": {
          inputType: "channel-picker",
        },
      };
      expect(getInputType(field)).toBe("channel-picker");
    });

    it("should return toggle from x-openclaw hint even for string", () => {
      const field: ServiceConfigField = {
        type: "string",
        description: "Enable",
        "x-openclaw": {
          inputType: "toggle",
        },
      };
      expect(getInputType(field)).toBe("toggle");
    });
  });

  describe("validateField", () => {
    describe("required validation", () => {
      it("should return error for empty required field", () => {
        const field: ServiceConfigField = {
          type: "string",
          description: "Name",
          required: true,
        };
        expect(validateField(field, "")).toBe("This field is required");
        expect(validateField(field, null)).toBe("This field is required");
        expect(validateField(field, undefined)).toBe("This field is required");
      });

      it("should return null for empty optional field", () => {
        const field: ServiceConfigField = {
          type: "string",
          description: "Name",
          required: false,
        };
        expect(validateField(field, "")).toBe(null);
        expect(validateField(field, null)).toBe(null);
      });
    });

    describe("string validation", () => {
      it("should validate string type", () => {
        const field: ServiceConfigField = {
          type: "string",
          description: "Name",
        };
        expect(validateField(field, "test")).toBe(null);
        expect(validateField(field, 123)).toBe("Must be a string");
      });

      it("should validate minLength", () => {
        const field: ServiceConfigField = {
          type: "string",
          description: "Name",
          minLength: 3,
        };
        expect(validateField(field, "ab")).toBe("Must be at least 3 characters");
        expect(validateField(field, "abc")).toBe(null);
      });

      it("should validate maxLength", () => {
        const field: ServiceConfigField = {
          type: "string",
          description: "Name",
          maxLength: 5,
        };
        expect(validateField(field, "abcdef")).toBe("Must be at most 5 characters");
        expect(validateField(field, "abc")).toBe(null);
      });

      it("should validate pattern", () => {
        const field: ServiceConfigField = {
          type: "string",
          description: "Email",
          pattern: "^\\S+@\\S+\\.\\S+$",
        };
        expect(validateField(field, "invalid")).toBe("Invalid format");
        expect(validateField(field, "test@example.com")).toBe(null);
      });

      it("should validate enum", () => {
        const field: ServiceConfigField = {
          type: "string",
          description: "Mode",
          enum: ["light", "dark"],
        };
        expect(validateField(field, "auto")).toBe("Must be one of: light, dark");
        expect(validateField(field, "light")).toBe(null);
      });
    });

    describe("number validation", () => {
      it("should validate number type", () => {
        const field: ServiceConfigField = {
          type: "number",
          description: "Count",
        };
        expect(validateField(field, 42)).toBe(null);
        expect(validateField(field, "not a number")).toBe("Must be a number");
        expect(validateField(field, NaN)).toBe("Must be a number");
      });

      it("should validate minimum", () => {
        const field: ServiceConfigField = {
          type: "number",
          description: "Age",
          minimum: 0,
        };
        expect(validateField(field, -1)).toBe("Must be at least 0");
        expect(validateField(field, 0)).toBe(null);
      });

      it("should validate maximum", () => {
        const field: ServiceConfigField = {
          type: "number",
          description: "Percentage",
          maximum: 100,
        };
        expect(validateField(field, 101)).toBe("Must be at most 100");
        expect(validateField(field, 50)).toBe(null);
      });
    });

    describe("boolean validation", () => {
      it("should validate boolean type", () => {
        const field: ServiceConfigField = {
          type: "boolean",
          description: "Enabled",
        };
        expect(validateField(field, true)).toBe(null);
        expect(validateField(field, false)).toBe(null);
        expect(validateField(field, "true")).toBe("Must be a boolean");
      });
    });

    describe("array validation", () => {
      it("should validate array type", () => {
        const field: ServiceConfigField = {
          type: "array",
          description: "Tags",
        };
        expect(validateField(field, [])).toBe(null);
        expect(validateField(field, ["a", "b"])).toBe(null);
        expect(validateField(field, "not an array")).toBe("Must be an array");
      });
    });

    describe("secret validation", () => {
      it("should validate secret as string", () => {
        const field: ServiceConfigField = {
          type: "secret",
          description: "API Key",
        };
        expect(validateField(field, "secret123")).toBe(null);
        expect(validateField(field, 123)).toBe("Must be a string");
      });
    });
  });
});
