import fs from "node:fs";
import path from "node:path";
import { isTraditionalService, isDeclarativeService } from "./schema.js";
import type { ServiceManifest, ValidationResult } from "./types.js";

const REQUIRED_BASE_FIELDS = ["id", "name", "version"] as const;

interface ManifestLoadResult {
  manifest: unknown;
  manifestPath: string;
  manifestFile: string;
}

function validateBaseFields(manifest: Record<string, unknown>): string[] {
  const errors: string[] = [];
  for (const field of REQUIRED_BASE_FIELDS) {
    if (typeof manifest[field] !== "string" || manifest[field] === "") {
      errors.push(`Missing or invalid required field: ${field}`);
    }
  }
  return errors;
}

function validateUIFields(manifest: Record<string, unknown>, servicePath: string): string[] {
  const errors: string[] = [];
  const ui = manifest.ui;

  if (ui !== undefined) {
    if (typeof ui !== "object" || ui === null) {
      errors.push("Invalid ui field: must be an object");
    } else {
      const uiRecord = ui as Record<string, unknown>;
      if (uiRecord.index !== undefined) {
        if (typeof uiRecord.index !== "string" || uiRecord.index === "") {
          errors.push("Invalid ui.index field: must be a non-empty string");
        } else {
          const uiIndexPath = path.join(servicePath, uiRecord.index);
          if (!fs.existsSync(uiIndexPath)) {
            errors.push(`UI index file not found: ${uiRecord.index}`);
          }
        }
      }
      if (uiRecord.entry !== undefined) {
        if (typeof uiRecord.entry !== "string" || uiRecord.entry === "") {
          errors.push("Invalid ui.entry field: must be a non-empty string");
        }
      }
    }
  }

  return errors;
}

function validateCapabilities(manifest: Record<string, unknown>): string[] {
  const errors: string[] = [];
  if (manifest.capabilities !== undefined) {
    if (!Array.isArray(manifest.capabilities) && typeof manifest.capabilities !== "object") {
      errors.push("Invalid capabilities field: must be an array or object");
    }
  }
  return errors;
}

function validateEntryFile(servicePath: string, entry: string): string | null {
  const entryPath = path.join(servicePath, entry);
  if (!fs.existsSync(entryPath)) {
    return `Entry file not found: ${entry}`;
  }
  return null;
}

function validateTrigger(manifest: Record<string, unknown>): string[] {
  const errors: string[] = [];
  const trigger = manifest.trigger;

  if (trigger !== undefined) {
    if (typeof trigger !== "object" || trigger === null) {
      errors.push("Invalid trigger field: must be an object");
      return errors;
    }

    const triggerRecord = trigger as Record<string, unknown>;
    if (typeof triggerRecord.type !== "string" || triggerRecord.type === "") {
      errors.push("Invalid trigger: type is required and must be a non-empty string");
    }

    const validTypes = ["cron", "webhook", "message", "web"];
    const typeValue = triggerRecord.type;
    if (typeValue && typeof typeValue === "string" && !validTypes.includes(typeValue)) {
      errors.push(`Invalid trigger type: ${typeValue}. Must be one of: ${validTypes.join(", ")}`);
    }
  }

  return errors;
}

export function validateDeclarativeService(
  servicePath: string,
  manifest: unknown,
  _manifestFile: string,
): ValidationResult {
  const errors: string[] = [];

  if (typeof manifest !== "object" || manifest === null) {
    return {
      valid: false,
      errors: ["Manifest must be a valid object"],
      serviceType: "declarative",
    };
  }

  const manifestRecord = manifest as Record<string, unknown>;
  errors.push(...validateBaseFields(manifestRecord));

  const triggerErrors = validateTrigger(manifestRecord);
  errors.push(...triggerErrors);

  if (!manifestRecord.trigger) {
    errors.push("Declarative service requires a 'trigger' field");
  }

  errors.push(...validateUIFields(manifestRecord, servicePath));
  errors.push(...validateCapabilities(manifestRecord));

  if (manifestRecord.entry !== undefined) {
    if (typeof manifestRecord.entry !== "string" || manifestRecord.entry === "") {
      errors.push("Invalid entry field: must be a non-empty string");
    } else {
      const entryError = validateEntryFile(servicePath, manifestRecord.entry);
      if (entryError) {
        errors.push(entryError);
      }
    }
  }

  if (errors.length > 0) {
    return {
      valid: false,
      errors,
      serviceType: "declarative",
    };
  }

  return {
    valid: true,
    manifest: manifest as ServiceManifest,
    serviceType: "declarative",
  };
}

export function validateTraditionalService(
  servicePath: string,
  manifest: unknown,
  _manifestFile: string,
): ValidationResult {
  const errors: string[] = [];

  if (typeof manifest !== "object" || manifest === null) {
    return {
      valid: false,
      errors: ["Manifest must be a valid object"],
      serviceType: "traditional",
    };
  }

  const manifestRecord = manifest as Record<string, unknown>;
  errors.push(...validateBaseFields(manifestRecord));

  if (!manifestRecord.entry) {
    errors.push("Traditional service requires an 'entry' field");
  } else if (typeof manifestRecord.entry !== "string" || manifestRecord.entry === "") {
    errors.push("Invalid entry field: must be a non-empty string");
  } else {
    const entryError = validateEntryFile(servicePath, manifestRecord.entry);
    if (entryError) {
      errors.push(entryError);
    }
  }

  errors.push(...validateUIFields(manifestRecord, servicePath));
  errors.push(...validateCapabilities(manifestRecord));

  if (manifestRecord.trigger !== undefined) {
    const triggerErrors = validateTrigger(manifestRecord);
    errors.push(...triggerErrors);
  }

  if (errors.length > 0) {
    return {
      valid: false,
      errors,
      serviceType: "traditional",
    };
  }

  return {
    valid: true,
    manifest: manifest as ServiceManifest,
    serviceType: "traditional",
  };
}

function loadManifest(
  servicePath: string,
): { success: true; result: ManifestLoadResult } | { success: false; errors: string[] } {
  const manifestFiles = ["service.json", "manifest.json"];

  for (const manifestFile of manifestFiles) {
    const manifestPath = path.join(servicePath, manifestFile);
    if (fs.existsSync(manifestPath)) {
      try {
        const content = fs.readFileSync(manifestPath, "utf-8");
        const manifest = JSON.parse(content);
        return {
          success: true,
          result: { manifest, manifestPath, manifestFile },
        };
      } catch (err) {
        return {
          success: false,
          errors: [`Invalid JSON in ${manifestFile}: ${String(err)}`],
        };
      }
    }
  }

  return {
    success: false,
    errors: [`Missing service.json or manifest.json in ${servicePath}`],
  };
}

export function validateServiceDirectory(servicePath: string): ValidationResult {
  if (!fs.existsSync(servicePath)) {
    return {
      valid: false,
      errors: [`Directory does not exist: ${servicePath}`],
    };
  }

  const stat = fs.statSync(servicePath);
  if (!stat.isDirectory()) {
    return {
      valid: false,
      errors: [`Path is not a directory: ${servicePath}`],
    };
  }

  const loadResult = loadManifest(servicePath);
  if (!loadResult.success) {
    return {
      valid: false,
      errors: loadResult.errors,
    };
  }

  const { manifest, manifestFile } = loadResult.result;

  if (typeof manifest !== "object" || manifest === null) {
    return {
      valid: false,
      errors: ["Manifest must be a valid object"],
    };
  }

  const manifestRecord = manifest as Record<string, unknown>;

  const baseFieldErrors: string[] = [];
  for (const field of REQUIRED_BASE_FIELDS) {
    if (typeof manifestRecord[field] !== "string" || manifestRecord[field] === "") {
      baseFieldErrors.push(`Missing or invalid required field: ${field}`);
    }
  }

  if (baseFieldErrors.length > 0) {
    return {
      valid: false,
      errors: baseFieldErrors,
    };
  }

  const typedManifest = manifest as ServiceManifest;
  const isDeclarative = isDeclarativeService(
    typedManifest as import("./schema.js").ServiceManifest,
  );
  const isTraditional = isTraditionalService(
    typedManifest as import("./schema.js").ServiceManifest,
  );

  if (isDeclarative) {
    return validateDeclarativeService(servicePath, manifest, manifestFile);
  } else if (isTraditional) {
    return validateTraditionalService(servicePath, manifest, manifestFile);
  }

  if (manifestFile === "service.json") {
    return validateDeclarativeService(servicePath, manifest, manifestFile);
  }

  return validateTraditionalService(servicePath, manifest, manifestFile);
}
