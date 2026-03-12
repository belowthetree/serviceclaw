import fs from "node:fs";
import path from "node:path";
import type { ServiceManifest, ValidationResult } from "./types.js";

const REQUIRED_MANIFEST_FIELDS = ["id", "name", "version", "description", "entry"] as const;

function isValidManifest(obj: unknown): obj is ServiceManifest {
  if (typeof obj !== "object" || obj === null) {
    return false;
  }
  const manifest = obj as Record<string, unknown>;
  for (const field of REQUIRED_MANIFEST_FIELDS) {
    if (typeof manifest[field] !== "string" || manifest[field] === "") {
      return false;
    }
  }
  if (manifest.ui !== undefined) {
    if (typeof manifest.ui !== "object" || manifest.ui === null) {
      return false;
    }
    const ui = manifest.ui as Record<string, unknown>;
    if (typeof ui.index !== "string" || ui.index === "") {
      return false;
    }
  }
  if (manifest.capabilities !== undefined) {
    if (!Array.isArray(manifest.capabilities)) {
      return false;
    }
  }
  return true;
}

export function validateServiceDirectory(servicePath: string): ValidationResult {
  const errors: string[] = [];

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

  const manifestPath = path.join(servicePath, "manifest.json");
  if (!fs.existsSync(manifestPath)) {
    return {
      valid: false,
      errors: [`Missing manifest.json in ${servicePath}`],
    };
  }

  let manifest: unknown;
  try {
    const content = fs.readFileSync(manifestPath, "utf-8");
    manifest = JSON.parse(content);
  } catch (err) {
    return {
      valid: false,
      errors: [`Invalid JSON in manifest.json: ${String(err)}`],
    };
  }

  if (!isValidManifest(manifest)) {
    const missing: string[] = [];
    for (const field of REQUIRED_MANIFEST_FIELDS) {
      const value = (manifest as Record<string, unknown>)?.[field];
      if (typeof value !== "string" || value === "") {
        missing.push(field);
      }
    }
    if (missing.length > 0) {
      errors.push(`Missing or invalid required manifest fields: ${missing.join(", ")}`);
    }
    const ui = (manifest as Record<string, unknown>)?.ui;
    if (ui !== undefined) {
      if (
        typeof ui !== "object" ||
        ui === null ||
        typeof (ui as Record<string, unknown>).index !== "string"
      ) {
        errors.push("Invalid ui.index field: must be a non-empty string");
      }
    }
    return {
      valid: false,
      errors,
    };
  }

  const entryPath = path.join(servicePath, manifest.entry);
  if (!fs.existsSync(entryPath)) {
    errors.push(`Entry file not found: ${manifest.entry}`);
  }

  if (manifest.ui?.index) {
    const uiIndexPath = path.join(servicePath, manifest.ui.index);
    if (!fs.existsSync(uiIndexPath)) {
      errors.push(`UI index file not found: ${manifest.ui.index}`);
    }
  }

  if (errors.length > 0) {
    return {
      valid: false,
      errors,
    };
  }

  return {
    valid: true,
    manifest,
  };
}
