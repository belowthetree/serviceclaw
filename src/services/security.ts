/**
 * Service Security Model
 *
 * Implements the security framework for Services including:
 * - Capability declarations and validation
 * - User confirmation for privileged operations
 * - Audit logging for all security-relevant actions
 * - Tool policy enforcement (cannot bypass denylist)
 *
 * Security Model (from T4):
 * - Services MUST declare capabilities upfront in manifest
 * - Privileged tools require user confirmation
 * - Audit logging for all privileged operations
 * - Tool policy enforcement (cannot bypass denylist)
 *
 * @see docs/services/architecture.md
 * @see src/services/schema.ts
 */

import crypto from "node:crypto";
import { normalizeToolName } from "../agents/tool-policy-shared.js";
import type { ToolPolicyLike } from "../agents/tool-policy.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import type { ServiceCapabilities, ServiceManifest, ServiceRequirements } from "./schema.js";

const logger = createSubsystemLogger("services:security");

// =============================================================================
// Security Types & Interfaces
// =============================================================================

/**
 * Risk levels for privileged operations
 */
export type RiskLevel = "low" | "medium" | "high" | "critical";

/**
 * Security validation result
 */
export interface SecurityValidationResult {
  valid: boolean;
  errors: SecurityError[];
  warnings: SecurityWarning[];
}

/**
 * Security error with context
 */
export interface SecurityError {
  code: SecurityErrorCode;
  message: string;
  field?: string;
  details?: Record<string, unknown>;
}

/**
 * Security warning with context
 */
export interface SecurityWarning {
  code: SecurityWarningCode;
  message: string;
  field?: string;
  details?: Record<string, unknown>;
}

/**
 * Security error codes
 */
export type SecurityErrorCode =
  | "CAPABILITY_NOT_DECLARED"
  | "TOOL_POLICY_VIOLATION"
  | "PRIVILEGED_TOOL_NOT_DECLARED"
  | "CONFIRMATION_REQUIRED_NOT_DECLARED"
  | "DENYLIST_VIOLATION"
  | "INVALID_CAPABILITY_VALUE"
  | "MISSING_REQUIRED_CAPABILITY";

/**
 * Security warning codes
 */
export type SecurityWarningCode =
  | "PRIVILEGED_CAPABILITY_DETECTED"
  | "NETWORK_ACCESS_DECLARED"
  | "SHELL_ACCESS_DECLARED"
  | "BROWSER_ACCESS_DECLARED"
  | "FILESYSTEM_ACCESS_DECLARED"
  | "WIDE_TOOL_PERMISSIONS";

/**
 * Confirmation request for privileged operations
 */
export interface ConfirmationRequest {
  serviceId: string;
  serviceName: string;
  toolName: string;
  params?: Record<string, unknown>;
  riskLevel: RiskLevel;
  description: string;
  timestamp: Date;
}

/**
 * Confirmation response
 */
export interface ConfirmationResponse {
  approved: boolean;
  approvedAt?: Date;
  deniedAt?: Date;
  reason?: string;
}

/**
 * Pre-approval record stored for a service
 */
export interface PreApprovalRecord {
  serviceId: string;
  toolName: string;
  approvedAt: Date;
  expiresAt?: Date;
  scope: "once" | "session" | "permanent";
}

/**
 * Audit log entry for security events
 */
export interface AuditLogEntry {
  id: string;
  timestamp: Date;
  eventType: AuditEventType;
  serviceId: string;
  toolName?: string;
  riskLevel?: RiskLevel;
  details: Record<string, unknown>;
  result: "success" | "failure" | "blocked" | "pending";
  errorMessage?: string;
}

/**
 * Audit event types
 */
export type AuditEventType =
  | "capability_validation"
  | "tool_invocation_attempt"
  | "tool_invocation_allowed"
  | "tool_invocation_blocked"
  | "tool_invocation_confirmed"
  | "tool_invocation_denied"
  | "confirmation_requested"
  | "confirmation_received"
  | "preapproval_checked"
  | "preapproval_granted"
  | "preapproval_revoked"
  | "policy_violation_detected";

/**
 * Security context for a service execution
 */
export interface ServiceSecurityContext {
  serviceId: string;
  capabilities: ServiceCapabilities;
  preApprovedTools: Set<string>;
  executionStartTime: Date;
  toolInvocationCounts: Map<string, number>;
}

/**
 * Security configuration options
 */
export interface SecurityConfig {
  /** Require confirmation for all privileged tools (default: true) */
  requireConfirmation: boolean;
  /** Default risk level for tools not explicitly categorized */
  defaultRiskLevel: RiskLevel;
  /** Maximum executions per minute per service */
  maxExecutionsPerMinute: number;
  /** Maximum concurrent executions per service */
  maxConcurrentExecutions: number;
  /** Tools that always require confirmation regardless of manifest */
  alwaysRequireConfirmation: string[];
  /** Tools that are completely blocked for services */
  blockedTools: string[];
  /** Whether to log all tool invocations (not just privileged) */
  auditAllToolCalls: boolean;
}

// =============================================================================
// Default Security Configuration
// =============================================================================

export const DEFAULT_SECURITY_CONFIG: SecurityConfig = {
  requireConfirmation: true,
  defaultRiskLevel: "medium",
  maxExecutionsPerMinute: 60,
  maxConcurrentExecutions: 5,
  alwaysRequireConfirmation: [
    "bash.exec",
    "shell.exec",
    "process.exec",
    "file.delete",
    "gateway.restart",
    "config.set",
  ],
  blockedTools: [
    // Tools that services should never use
    "gateway.shutdown",
  ],
  auditAllToolCalls: false,
};

// =============================================================================
// High-Risk Tools Mapping
// =============================================================================

/**
 * Maps tool names to their inherent risk levels
 */
const TOOL_RISK_LEVELS: Record<string, RiskLevel> = {
  // Critical risk - can cause significant harm
  "bash.exec": "critical",
  "shell.exec": "critical",
  "process.exec": "critical",
  "system.run": "critical",
  "file.delete": "critical",
  "gateway.restart": "critical",
  "gateway.shutdown": "critical",
  "config.set": "critical",

  // High risk - can affect user data or privacy
  "message.send": "high",
  "email.send": "high",
  "browser.navigate": "high",
  "browser.click": "high",
  "browser.type": "high",
  write: "high",
  edit: "high",

  // Medium risk - can access external resources
  "web.fetch": "medium",
  "web.scrape": "medium",
  "web.search": "medium",
  read: "medium",
  "sessions.send": "medium",

  // Low risk - generally safe operations
  "sessions.list": "low",
  "sessions.history": "low",
  "weather.fetch": "low",
  "calendar.list": "low",
};

// =============================================================================
// Security Manager
// =============================================================================

/**
 * Manages security for Services
 *
 * Responsibilities:
 * - Validating capability declarations during installation
 * - Enforcing tool policy (respecting denylist)
 * - Managing user confirmation flows
 * - Recording audit logs
 * - Preventing privilege escalation
 */
export class ServiceSecurityManager {
  private config: SecurityConfig;
  private preApprovals: Map<string, PreApprovalRecord[]> = new Map();
  private auditLog: AuditLogEntry[] = [];
  private securityContexts: Map<string, ServiceSecurityContext> = new Map();
  private globalToolPolicy: ToolPolicyLike | undefined;

  constructor(config: Partial<SecurityConfig> = {}, globalToolPolicy?: ToolPolicyLike) {
    this.config = { ...DEFAULT_SECURITY_CONFIG, ...config };
    this.globalToolPolicy = globalToolPolicy;
  }

  /**
   * Update the global tool policy
   */
  setGlobalToolPolicy(policy: ToolPolicyLike | undefined): void {
    this.globalToolPolicy = policy;
    logger.debug("Global tool policy updated");
  }

  /**
   * Validate service capabilities during installation
   *
   * Checks:
   * 1. All required tools are declared in capabilities
   * 2. Privileged tools are properly declared
   * 3. No violation of global tool policy denylist
   * 4. Confirmation requirements are consistent
   */
  validateCapabilities(manifest: ServiceManifest): SecurityValidationResult {
    const errors: SecurityError[] = [];
    const warnings: SecurityWarning[] = [];
    const { capabilities, requires } = manifest;

    logger.debug(`Validating capabilities for service ${manifest.id}`);

    // Check 1: Required tools must be accounted for in capabilities
    if (requires.tools) {
      for (const tool of requires.tools) {
        const normalizedTool = normalizeToolName(tool);

        // Check if tool is in blocked list
        if (this.isToolBlocked(normalizedTool)) {
          errors.push({
            code: "DENYLIST_VIOLATION",
            message: `Tool '${tool}' is blocked by security policy`,
            field: "requires.tools",
            details: { tool, reason: "Tool is in blocked list" },
          });
          continue;
        }

        // Check global tool policy denylist
        if (this.isToolDeniedByPolicy(normalizedTool)) {
          errors.push({
            code: "TOOL_POLICY_VIOLATION",
            message: `Tool '${tool}' is denied by global tool policy`,
            field: "requires.tools",
            details: { tool, policy: this.globalToolPolicy },
          });
        }

        // Check if privileged tool is declared
        if (this.isPrivilegedTool(normalizedTool)) {
          const declaredPrivileged =
            capabilities.privilegedTools?.some((t) => normalizeToolName(t) === normalizedTool) ??
            false;

          if (!declaredPrivileged) {
            errors.push({
              code: "PRIVILEGED_TOOL_NOT_DECLARED",
              message: `Privileged tool '${tool}' must be declared in capabilities.privilegedTools`,
              field: "capabilities.privilegedTools",
              details: { tool, riskLevel: this.getToolRiskLevel(tool) },
            });
          }
        }
      }
    }

    // Check 2: Confirmation requirements must be subset of privileged tools
    if (capabilities.requiresConfirmation) {
      for (const tool of capabilities.requiresConfirmation) {
        const normalizedTool = normalizeToolName(tool);
        const declaredPrivileged =
          capabilities.privilegedTools?.some((t) => normalizeToolName(t) === normalizedTool) ??
          false;

        if (!declaredPrivileged) {
          errors.push({
            code: "CONFIRMATION_REQUIRED_NOT_DECLARED",
            message: `Tool '${tool}' in requiresConfirmation must also be in privilegedTools`,
            field: "capabilities.requiresConfirmation",
            details: { tool },
          });
        }
      }
    }

    // Check 3: Validate capability flags are consistent with requirements
    if (
      capabilities.shell &&
      !requires.tools?.some((t) => {
        const nt = normalizeToolName(t);
        return nt.includes("bash") || nt.includes("shell") || nt.includes("exec");
      })
    ) {
      warnings.push({
        code: "SHELL_ACCESS_DECLARED",
        message: "Shell capability declared but no shell tools required",
        field: "capabilities.shell",
        details: { requires: requires.tools },
      });
    }

    // Check 4: Warn about wide permissions
    if (capabilities.privilegedTools?.includes("*")) {
      warnings.push({
        code: "WIDE_TOOL_PERMISSIONS",
        message: "Service declares all tools as privileged - review security implications",
        field: "capabilities.privilegedTools",
      });
    }

    // Check 5: Warn about sensitive capabilities
    if (capabilities.network) {
      warnings.push({
        code: "NETWORK_ACCESS_DECLARED",
        message: "Service requires network access",
        field: "capabilities.network",
      });
    }

    if (capabilities.filesystem) {
      warnings.push({
        code: "FILESYSTEM_ACCESS_DECLARED",
        message: "Service requires filesystem access",
        field: "capabilities.filesystem",
      });
    }

    if (capabilities.browser) {
      warnings.push({
        code: "BROWSER_ACCESS_DECLARED",
        message: "Service requires browser automation access",
        field: "capabilities.browser",
      });
    }

    // Check 6: Validate capabilities against tool policy at install time
    const allTools = [...(requires.tools ?? []), ...(requires.optionalTools ?? [])];
    for (const tool of allTools) {
      if (this.isToolDeniedByPolicy(normalizeToolName(tool))) {
        errors.push({
          code: "TOOL_POLICY_VIOLATION",
          message: `Service cannot use tool '${tool}' - denied by policy`,
          field: "requires.tools",
          details: { tool },
        });
      }
    }

    const result: SecurityValidationResult = {
      valid: errors.length === 0,
      errors,
      warnings,
    };

    // Audit log the validation
    this.logAuditEvent({
      eventType: "capability_validation",
      serviceId: manifest.id,
      riskLevel: errors.length > 0 ? "high" : "low",
      details: {
        manifestId: manifest.id,
        errorCount: errors.length,
        warningCount: warnings.length,
        capabilities,
      },
      result: errors.length > 0 ? "failure" : "success",
    });

    return result;
  }

  /**
   * Check if a tool requires user confirmation before execution
   */
  requiresConfirmation(
    serviceId: string,
    toolName: string,
    capabilities: ServiceCapabilities,
  ): boolean {
    const normalizedTool = normalizeToolName(toolName);

    // Check global always-require list
    if (
      this.config.alwaysRequireConfirmation.some((t) => normalizeToolName(t) === normalizedTool)
    ) {
      return true;
    }

    // Check if tool is in service's requiresConfirmation list
    const declaredConfirmation =
      capabilities.requiresConfirmation?.some((t) => normalizeToolName(t) === normalizedTool) ??
      false;

    if (declaredConfirmation) {
      return true;
    }

    // Check if tool is privileged and confirmation is enabled
    if (this.config.requireConfirmation && this.isPrivilegedTool(normalizedTool)) {
      const declaredPrivileged =
        capabilities.privilegedTools?.some((t) => normalizeToolName(t) === normalizedTool) ?? false;

      if (declaredPrivileged) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check if a tool has been pre-approved for a service
   */
  hasPreApproval(serviceId: string, toolName: string): boolean {
    const normalizedTool = normalizeToolName(toolName);
    const approvals = this.preApprovals.get(serviceId) ?? [];

    for (const approval of approvals) {
      if (normalizeToolName(approval.toolName) !== normalizedTool) {
        continue;
      }

      // Check if approval has expired
      if (approval.expiresAt && approval.expiresAt < new Date()) {
        continue;
      }

      return true;
    }

    return false;
  }

  /**
   * Grant pre-approval for a tool
   */
  grantPreApproval(
    serviceId: string,
    toolName: string,
    scope: PreApprovalRecord["scope"] = "session",
    durationMs?: number,
  ): PreApprovalRecord {
    const normalizedTool = normalizeToolName(toolName);
    const now = new Date();
    const record: PreApprovalRecord = {
      serviceId,
      toolName: normalizedTool,
      approvedAt: now,
      scope,
      expiresAt: durationMs ? new Date(now.getTime() + durationMs) : undefined,
    };

    const existing = this.preApprovals.get(serviceId) ?? [];
    // Remove any existing approval for this tool
    const filtered = existing.filter((a) => normalizeToolName(a.toolName) !== normalizedTool);
    filtered.push(record);
    this.preApprovals.set(serviceId, filtered);

    this.logAuditEvent({
      eventType: "preapproval_granted",
      serviceId,
      toolName: normalizedTool,
      details: { scope, durationMs },
      result: "success",
    });

    logger.info(`Pre-approval granted for ${serviceId} to use ${normalizedTool}`);
    return record;
  }

  /**
   * Revoke pre-approval for a tool
   */
  revokePreApproval(serviceId: string, toolName: string): boolean {
    const normalizedTool = normalizeToolName(toolName);
    const existing = this.preApprovals.get(serviceId) ?? [];
    const filtered = existing.filter((a) => normalizeToolName(a.toolName) !== normalizedTool);

    if (filtered.length < existing.length) {
      this.preApprovals.set(serviceId, filtered);

      this.logAuditEvent({
        eventType: "preapproval_revoked",
        serviceId,
        toolName: normalizedTool,
        result: "success",
        details: { toolName: normalizedTool },
      });

      logger.info(`Pre-approval revoked for ${serviceId} to use ${normalizedTool}`);
      return true;
    }

    return false;
  }

  /**
   * Create a confirmation request for a privileged operation
   */
  createConfirmationRequest(
    serviceId: string,
    serviceName: string,
    toolName: string,
    params?: Record<string, unknown>,
  ): ConfirmationRequest {
    const riskLevel = this.getToolRiskLevel(toolName);
    const description = this.buildConfirmationDescription(serviceName, toolName, params);

    return {
      serviceId,
      serviceName,
      toolName: normalizeToolName(toolName),
      params,
      riskLevel,
      description,
      timestamp: new Date(),
    };
  }

  /**
   * Process a confirmation response
   */
  processConfirmationResponse(request: ConfirmationRequest, response: ConfirmationResponse): void {
    const eventType: AuditEventType = response.approved
      ? "confirmation_received"
      : "tool_invocation_denied";

    this.logAuditEvent({
      eventType,
      serviceId: request.serviceId,
      toolName: request.toolName,
      riskLevel: request.riskLevel,
      details: {
        serviceName: request.serviceName,
        reason: response.reason,
        approvedAt: response.approvedAt,
        deniedAt: response.deniedAt,
      },
      result: response.approved ? "success" : "blocked",
    });

    if (response.approved) {
      // Grant temporary pre-approval for this session
      this.grantPreApproval(request.serviceId, request.toolName, "session", 5 * 60 * 1000); // 5 minutes
    }
  }

  /**
   * Check if a tool invocation is allowed
   *
   * This is the main security checkpoint for tool execution
   */
  checkToolInvocation(
    serviceId: string,
    toolName: string,
    capabilities: ServiceCapabilities,
    params?: Record<string, unknown>,
  ): {
    allowed: boolean;
    reason?: string;
    requiresConfirmation: boolean;
    request?: ConfirmationRequest;
  } {
    const normalizedTool = normalizeToolName(toolName);

    // Check 1: Tool is not blocked
    if (this.isToolBlocked(normalizedTool)) {
      this.logAuditEvent({
        eventType: "tool_invocation_blocked",
        serviceId,
        toolName: normalizedTool,
        riskLevel: "critical",
        details: { reason: "Tool is in blocked list", params },
        result: "blocked",
      });

      return {
        allowed: false,
        reason: `Tool '${toolName}' is blocked by security policy`,
        requiresConfirmation: false,
      };
    }

    // Check 2: Tool is not denied by global policy
    if (this.isToolDeniedByPolicy(normalizedTool)) {
      this.logAuditEvent({
        eventType: "tool_invocation_blocked",
        serviceId,
        toolName: normalizedTool,
        riskLevel: "critical",
        details: { reason: "Tool is denied by global policy", params },
        result: "blocked",
      });

      return {
        allowed: false,
        reason: `Tool '${toolName}' is denied by global tool policy`,
        requiresConfirmation: false,
      };
    }

    // Check 3: Tool is declared in capabilities (for privileged tools)
    if (this.isPrivilegedTool(normalizedTool)) {
      const declaredPrivileged =
        capabilities.privilegedTools?.some(
          (t) => normalizeToolName(t) === normalizedTool || t === "*",
        ) ?? false;

      if (!declaredPrivileged) {
        this.logAuditEvent({
          eventType: "tool_invocation_blocked",
          serviceId,
          toolName: normalizedTool,
          riskLevel: "high",
          details: { reason: "Privileged tool not declared in capabilities", params },
          result: "blocked",
        });

        return {
          allowed: false,
          reason: `Privileged tool '${toolName}' not declared in service capabilities`,
          requiresConfirmation: false,
        };
      }
    }

    // Check 4: Confirmation required
    const needsConfirmation = this.requiresConfirmation(serviceId, normalizedTool, capabilities);

    if (needsConfirmation) {
      // Check pre-approval
      if (this.hasPreApproval(serviceId, normalizedTool)) {
        this.logAuditEvent({
          eventType: "preapproval_checked",
          serviceId,
          toolName: normalizedTool,
          details: { approved: true },
          result: "success",
        });

        return {
          allowed: true,
          requiresConfirmation: false,
        };
      }

      // Need user confirmation
      const request = this.createConfirmationRequest(
        serviceId,
        serviceId, // Use ID as name if not available
        normalizedTool,
        params,
      );

      this.logAuditEvent({
        eventType: "confirmation_requested",
        serviceId,
        toolName: normalizedTool,
        riskLevel: request.riskLevel,
        details: { description: request.description },
        result: "pending",
      });

      return {
        allowed: false,
        reason: `User confirmation required for tool '${toolName}'`,
        requiresConfirmation: true,
        request,
      };
    }

    // All checks passed
    this.logAuditEvent({
      eventType: "tool_invocation_allowed",
      serviceId,
      toolName: normalizedTool,
      riskLevel: this.getToolRiskLevel(normalizedTool),
      details: { params },
      result: "success",
    });

    return {
      allowed: true,
      requiresConfirmation: false,
    };
  }

  /**
   * Create a security context for service execution
   */
  createSecurityContext(
    serviceId: string,
    capabilities: ServiceCapabilities,
  ): ServiceSecurityContext {
    const context: ServiceSecurityContext = {
      serviceId,
      capabilities,
      preApprovedTools: new Set(),
      executionStartTime: new Date(),
      toolInvocationCounts: new Map(),
    };

    this.securityContexts.set(serviceId, context);
    return context;
  }

  /**
   * Clean up security context for a service
   */
  cleanupSecurityContext(serviceId: string): void {
    this.securityContexts.delete(serviceId);
    this.preApprovals.delete(serviceId);
  }

  /**
   * Get the audit log
   */
  getAuditLog(options?: {
    serviceId?: string;
    eventType?: AuditEventType;
    since?: Date;
    limit?: number;
  }): AuditLogEntry[] {
    let entries = [...this.auditLog];

    if (options?.serviceId) {
      entries = entries.filter((e) => e.serviceId === options.serviceId);
    }

    if (options?.eventType) {
      entries = entries.filter((e) => e.eventType === options.eventType);
    }

    if (options?.since) {
      entries = entries.filter((e) => e.timestamp >= options.since!);
    }

    if (options?.limit) {
      entries = entries.slice(-options.limit);
    }

    return entries;
  }

  /**
   * Clear the audit log (useful for testing)
   */
  clearAuditLog(): void {
    this.auditLog = [];
  }

  // =============================================================================
  // Private Helpers
  // =============================================================================

  /**
   * Check if a tool is blocked
   */
  private isToolBlocked(toolName: string): boolean {
    const normalized = normalizeToolName(toolName);
    return this.config.blockedTools.some((t) => normalizeToolName(t) === normalized);
  }

  /**
   * Check if a tool is denied by global tool policy
   */
  private isToolDeniedByPolicy(toolName: string): boolean {
    if (!this.globalToolPolicy?.deny) {
      return false;
    }

    const normalized = normalizeToolName(toolName);

    // Check explicit deny list
    for (const denied of this.globalToolPolicy.deny) {
      if (normalizeToolName(denied) === normalized) {
        return true;
      }
      // Check wildcards
      if (denied.endsWith(".*")) {
        const prefix = denied.slice(0, -2);
        if (normalized.startsWith(prefix)) {
          return true;
        }
      }
      if (denied === "*") {
        return true;
      }
    }

    return false;
  }

  /**
   * Check if a tool is considered privileged
   */
  private isPrivilegedTool(toolName: string): boolean {
    const normalized = normalizeToolName(toolName);
    const riskLevel = TOOL_RISK_LEVELS[normalized];

    // Tools with high or critical risk are privileged
    if (riskLevel === "high" || riskLevel === "critical") {
      return true;
    }

    // Tools in always-require list are privileged
    if (this.config.alwaysRequireConfirmation.some((t) => normalizeToolName(t) === normalized)) {
      return true;
    }

    return false;
  }

  /**
   * Get the risk level for a tool
   */
  private getToolRiskLevel(toolName: string): RiskLevel {
    const normalized = normalizeToolName(toolName);
    return TOOL_RISK_LEVELS[normalized] ?? this.config.defaultRiskLevel;
  }

  /**
   * Build a human-readable confirmation description
   */
  private buildConfirmationDescription(
    serviceName: string,
    toolName: string,
    params?: Record<string, unknown>,
  ): string {
    const riskLevel = this.getToolRiskLevel(toolName);
    const riskText = riskLevel === "critical" ? "CRITICAL" : riskLevel.toUpperCase();

    let description = `Service "${serviceName}" wants to execute ${toolName} (${riskText} risk)`;

    // Add parameter summary for certain tools
    if (params && Object.keys(params).length > 0) {
      const paramSummary = Object.entries(params)
        .slice(0, 3)
        .map(([k, v]) => `${k}: ${String(v).slice(0, 50)}`)
        .join(", ");
      description += `\nParameters: ${paramSummary}`;
    }

    return description;
  }

  /**
   * Log an audit event
   */
  private logAuditEvent(params: {
    eventType: AuditEventType;
    serviceId: string;
    toolName?: string;
    riskLevel?: RiskLevel;
    details: Record<string, unknown>;
    result: "success" | "failure" | "blocked" | "pending";
    errorMessage?: string;
  }): void {
    const entry: AuditLogEntry = {
      id: this.generateAuditId(),
      timestamp: new Date(),
      eventType: params.eventType,
      serviceId: params.serviceId,
      toolName: params.toolName,
      riskLevel: params.riskLevel,
      details: params.details,
      result: params.result,
    };

    this.auditLog.push(entry);

    // Also log to subsystem logger
    const logMessage = `[AUDIT] ${params.eventType} for ${params.serviceId}`;
    if (params.result === "blocked") {
      logger.warn(logMessage, { tool: params.toolName, reason: params.details.reason });
    } else if (params.result === "failure") {
      logger.error(logMessage, { error: params.errorMessage });
    } else {
      logger.debug(logMessage);
    }
  }

  /**
   * Generate a unique audit entry ID
   */
  private generateAuditId(): string {
    return `audit-${crypto.randomUUID()}`;
  }
}

// =============================================================================
// Security Utilities
// =============================================================================

/**
 * Validate capabilities against requirements
 * Standalone function for use during validation phase
 */
export function validateServiceCapabilities(
  manifest: ServiceManifest,
  globalToolPolicy?: ToolPolicyLike,
): SecurityValidationResult {
  const manager = new ServiceSecurityManager({}, globalToolPolicy);
  return manager.validateCapabilities(manifest);
}

/**
 * Check if installing a service would violate security policy
 */
export function wouldViolateSecurityPolicy(
  manifest: ServiceManifest,
  globalToolPolicy?: ToolPolicyLike,
): { violates: boolean; reasons: string[] } {
  const result = validateServiceCapabilities(manifest, globalToolPolicy);

  return {
    violates: !result.valid,
    reasons: result.errors.map((e) => e.message),
  };
}

/**
 * Get the list of tools that require confirmation for a service
 */
export function getToolsRequiringConfirmation(
  manifest: ServiceManifest,
  config: Partial<SecurityConfig> = {},
): string[] {
  const fullConfig = { ...DEFAULT_SECURITY_CONFIG, ...config };
  const manager = new ServiceSecurityManager(fullConfig);
  const { capabilities, requires } = manifest;

  const allTools = [...(requires.tools ?? []), ...(requires.optionalTools ?? [])];

  return allTools.filter((tool) => manager.requiresConfirmation(manifest.id, tool, capabilities));
}

/**
 * Create a security summary for a service manifest
 */
export function createSecuritySummary(manifest: ServiceManifest): {
  riskLevel: RiskLevel;
  requiresConfirmation: string[];
  privilegedTools: string[];
  warnings: string[];
} {
  const manager = new ServiceSecurityManager();
  const { capabilities, requires } = manifest;

  const allTools = [...(requires.tools ?? []), ...(requires.optionalTools ?? [])];

  const toolsNeedingConfirmation: string[] = [];
  const privilegedTools: string[] = [];
  let maxRiskLevel: RiskLevel = "low";

  for (const tool of allTools) {
    const normalized = normalizeToolName(tool);

    if (manager["isPrivilegedTool"](normalized)) {
      privilegedTools.push(normalized);
    }

    const risk = TOOL_RISK_LEVELS[normalized] ?? "low";
    if (
      (risk === "critical" && maxRiskLevel !== "critical") ||
      (risk === "high" && maxRiskLevel === "low") ||
      (risk === "medium" && maxRiskLevel === "low")
    ) {
      maxRiskLevel = risk;
    }

    if (manager.requiresConfirmation(manifest.id, normalized, capabilities)) {
      toolsNeedingConfirmation.push(normalized);
    }
  }

  const warnings: string[] = [];
  if (capabilities.network) {
    warnings.push("Requires network access");
  }
  if (capabilities.filesystem) {
    warnings.push("Requires filesystem access");
  }
  if (capabilities.shell) {
    warnings.push("Requires shell access");
  }
  if (capabilities.browser) {
    warnings.push("Requires browser automation");
  }

  return {
    riskLevel: maxRiskLevel,
    requiresConfirmation: toolsNeedingConfirmation,
    privilegedTools,
    warnings,
  };
}

// =============================================================================
// Export Types
// =============================================================================

export type { ServiceCapabilities, ServiceManifest, ServiceRequirements, ToolPolicyLike };
