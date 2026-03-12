/**
 * Service Security Tests
 *
 * Comprehensive test suite for the Service Security Model including:
 * - Capability validation
 * - Tool policy enforcement
 * - User confirmation flow
 * - Audit logging
 * - Privilege escalation prevention
 */

import { describe, expect, it, beforeEach } from "vitest";
import type { ToolPolicyLike } from "../agents/tool-policy.js";
import type { ServiceManifest, ServiceCapabilities } from "./schema.js";
import {
  ServiceSecurityManager,
  validateServiceCapabilities,
  wouldViolateSecurityPolicy,
  getToolsRequiringConfirmation,
  createSecuritySummary,
  DEFAULT_SECURITY_CONFIG,
  type SecurityConfig,
  type ConfirmationRequest,
  type ConfirmationResponse,
} from "./security.js";

// =============================================================================
// Test Fixtures
// =============================================================================

function createTestManifest(overrides: Partial<ServiceManifest> = {}): ServiceManifest {
  return {
    id: "test-service",
    name: "Test Service",
    description: "A test service",
    version: "1.0.0",
    entry: "index.js",
    trigger: { type: "cron", schedule: "0 8 * * *" },
    config: {},
    requires: {},
    capabilities: {
      privilegedTools: [],
      requiresConfirmation: [],
      network: false,
      filesystem: false,
      shell: false,
      browser: false,
    },
    ...overrides,
  };
}

function createCapabilities(overrides: Partial<ServiceCapabilities> = {}): ServiceCapabilities {
  return {
    privilegedTools: [],
    requiresConfirmation: [],
    network: false,
    filesystem: false,
    shell: false,
    browser: false,
    ...overrides,
  };
}

// =============================================================================
// Capability Validation Tests
// =============================================================================

describe("ServiceSecurityManager - Capability Validation", () => {
  let manager: ServiceSecurityManager;

  beforeEach(() => {
    manager = new ServiceSecurityManager();
  });

  describe("Basic Validation", () => {
    it("should pass validation for minimal valid manifest", () => {
      const manifest = createTestManifest();
      const result = manager.validateCapabilities(manifest);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should record audit log entry for validation", () => {
      const manifest = createTestManifest();
      manager.validateCapabilities(manifest);

      const auditLog = manager.getAuditLog({ serviceId: "test-service" });
      expect(auditLog).toHaveLength(1);
      expect(auditLog[0].eventType).toBe("capability_validation");
      expect(auditLog[0].result).toBe("success");
    });
  });

  describe("Privileged Tool Declaration", () => {
    it("should fail when privileged tool is not declared in capabilities", () => {
      const manifest = createTestManifest({
        requires: { tools: ["message.send", "bash.exec"] },
        capabilities: createCapabilities({
          privilegedTools: ["message.send"], // missing bash.exec
        }),
      });

      const result = manager.validateCapabilities(manifest);

      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].code).toBe("PRIVILEGED_TOOL_NOT_DECLARED");
      expect(result.errors[0].field).toBe("capabilities.privilegedTools");
    });

    it("should pass when all privileged tools are declared", () => {
      const manifest = createTestManifest({
        requires: { tools: ["message.send", "bash.exec"] },
        capabilities: createCapabilities({
          privilegedTools: ["message.send", "bash.exec"],
        }),
      });

      const result = manager.validateCapabilities(manifest);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should detect multiple undeclared privileged tools", () => {
      const manifest = createTestManifest({
        requires: {
          tools: ["message.send", "email.send", "bash.exec", "browser.navigate"],
        },
        capabilities: createCapabilities(),
      });

      const result = manager.validateCapabilities(manifest);

      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(4);
      expect(result.errors.every((e) => e.code === "PRIVILEGED_TOOL_NOT_DECLARED")).toBe(true);
    });
  });

  describe("Confirmation Requirements", () => {
    it("should fail when confirmation tool is not in privilegedTools", () => {
      const manifest = createTestManifest({
        requires: { tools: ["message.send"] },
        capabilities: createCapabilities({
          requiresConfirmation: ["message.send"],
          // privilegedTools is empty - should fail
        }),
      });

      const result = manager.validateCapabilities(manifest);

      expect(result.valid).toBe(false);
      // Both errors apply - privileged tool not declared AND confirmation not declared
      expect(result.errors.some((e) => e.code === "PRIVILEGED_TOOL_NOT_DECLARED")).toBe(true);
      expect(result.errors.some((e) => e.code === "CONFIRMATION_REQUIRED_NOT_DECLARED")).toBe(true);
    });

    it("should pass when confirmation tools are subset of privilegedTools", () => {
      const manifest = createTestManifest({
        requires: { tools: ["message.send", "email.send"] },
        capabilities: createCapabilities({
          privilegedTools: ["message.send", "email.send"],
          requiresConfirmation: ["message.send"],
        }),
      });

      const result = manager.validateCapabilities(manifest);

      expect(result.valid).toBe(true);
    });
  });

  describe("Security Warnings", () => {
    it("should warn about network capability", () => {
      const manifest = createTestManifest({
        capabilities: createCapabilities({ network: true }),
      });

      const result = manager.validateCapabilities(manifest);

      expect(result.valid).toBe(true);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0].code).toBe("NETWORK_ACCESS_DECLARED");
    });

    it("should warn about filesystem capability", () => {
      const manifest = createTestManifest({
        capabilities: createCapabilities({ filesystem: true }),
      });

      const result = manager.validateCapabilities(manifest);

      expect(result.valid).toBe(true);
      expect(result.warnings.some((w) => w.code === "FILESYSTEM_ACCESS_DECLARED")).toBe(true);
    });

    it("should warn about shell capability", () => {
      const manifest = createTestManifest({
        capabilities: createCapabilities({ shell: true }),
      });

      const result = manager.validateCapabilities(manifest);

      expect(result.valid).toBe(true);
      expect(result.warnings.some((w) => w.code === "SHELL_ACCESS_DECLARED")).toBe(true);
    });

    it("should warn about browser capability", () => {
      const manifest = createTestManifest({
        capabilities: createCapabilities({ browser: true }),
      });

      const result = manager.validateCapabilities(manifest);

      expect(result.valid).toBe(true);
      expect(result.warnings.some((w) => w.code === "BROWSER_ACCESS_DECLARED")).toBe(true);
    });

    it("should warn about wide tool permissions", () => {
      const manifest = createTestManifest({
        capabilities: createCapabilities({
          privilegedTools: ["*"],
        }),
      });

      const result = manager.validateCapabilities(manifest);

      expect(result.valid).toBe(true);
      expect(result.warnings.some((w) => w.code === "WIDE_TOOL_PERMISSIONS")).toBe(true);
    });
  });
});

// =============================================================================
// Tool Policy Enforcement Tests
// =============================================================================

describe("ServiceSecurityManager - Tool Policy Enforcement", () => {
  describe("Blocked Tools", () => {
    it("should block installation of blocked tools", () => {
      const manager = new ServiceSecurityManager({
        blockedTools: ["gateway.shutdown"],
      });

      const manifest = createTestManifest({
        requires: { tools: ["gateway.shutdown"] },
      });

      const result = manager.validateCapabilities(manifest);

      expect(result.valid).toBe(false);
      expect(result.errors[0].code).toBe("DENYLIST_VIOLATION");
    });

    it("should block invocation of blocked tools at runtime", () => {
      const manager = new ServiceSecurityManager({
        blockedTools: ["gateway.shutdown"],
      });

      const capabilities = createCapabilities();
      const check = manager.checkToolInvocation("test-service", "gateway.shutdown", capabilities);

      expect(check.allowed).toBe(false);
      expect(check.reason).toContain("blocked");
      expect(check.requiresConfirmation).toBe(false);
    });
  });

  describe("Global Tool Policy Denylist", () => {
    it("should enforce global tool policy denylist during validation", () => {
      const globalPolicy: ToolPolicyLike = {
        deny: ["bash.exec", "shell.*"],
      };
      const manager = new ServiceSecurityManager({}, globalPolicy);

      const manifest = createTestManifest({
        requires: { tools: ["bash.exec", "message.send"] },
      });

      const result = manager.validateCapabilities(manifest);

      expect(result.valid).toBe(false);
      expect(result.errors[0].code).toBe("TOOL_POLICY_VIOLATION");
    });

    it("should enforce wildcard deny patterns", () => {
      const globalPolicy: ToolPolicyLike = {
        deny: ["shell.*"],
      };
      const manager = new ServiceSecurityManager({}, globalPolicy);

      const manifest = createTestManifest({
        requires: { tools: ["shell.exec", "shell.run"] },
      });

      const result = manager.validateCapabilities(manifest);

      expect(result.valid).toBe(false);
      // Both tools trigger TOOL_POLICY_VIOLATION
      // Both tools are privileged (shell.* pattern matches critical/high risk tools)
      // So both also trigger PRIVILEGED_TOOL_NOT_DECLARED
      const policyViolations = result.errors.filter((e) => e.code === "TOOL_POLICY_VIOLATION");
      expect(policyViolations.length).toBeGreaterThanOrEqual(2);
    });

    it("should block all tools when denylist contains wildcard", () => {
      const globalPolicy: ToolPolicyLike = {
        deny: ["*"],
      };
      const manager = new ServiceSecurityManager({}, globalPolicy);

      const capabilities = createCapabilities();
      const check = manager.checkToolInvocation("test-service", "message.send", capabilities);

      expect(check.allowed).toBe(false);
      expect(check.reason).toContain("denied");
    });

    it("should record policy violation in audit log", () => {
      const globalPolicy: ToolPolicyLike = {
        deny: ["bash.exec"],
      };
      const manager = new ServiceSecurityManager({}, globalPolicy);

      const capabilities = createCapabilities();
      manager.checkToolInvocation("test-service", "bash.exec", capabilities);

      const auditLog = manager.getAuditLog({ eventType: "tool_invocation_blocked" });
      expect(auditLog).toHaveLength(1);
      expect(auditLog[0].result).toBe("blocked");
    });
  });
});

// =============================================================================
// User Confirmation Tests
// =============================================================================

describe("ServiceSecurityManager - User Confirmation", () => {
  let manager: ServiceSecurityManager;

  beforeEach(() => {
    manager = new ServiceSecurityManager();
  });

  describe("Confirmation Requirements", () => {
    it("should require confirmation for always-require tools", () => {
      const capabilities = createCapabilities();
      const requires = manager.requiresConfirmation("test-service", "bash.exec", capabilities);

      expect(requires).toBe(true);
    });

    it("should require confirmation for tools in requiresConfirmation list", () => {
      const capabilities = createCapabilities({
        privilegedTools: ["message.send"],
        requiresConfirmation: ["message.send"],
      });

      const requires = manager.requiresConfirmation("test-service", "message.send", capabilities);

      expect(requires).toBe(true);
    });

    it("should require confirmation for high-risk tools when enabled", () => {
      const capabilities = createCapabilities({
        privilegedTools: ["message.send"],
      });

      const requires = manager.requiresConfirmation("test-service", "message.send", capabilities);

      expect(requires).toBe(true);
    });

    it("should not require confirmation for low-risk tools", () => {
      const capabilities = createCapabilities();

      const requires = manager.requiresConfirmation("test-service", "weather.fetch", capabilities);

      expect(requires).toBe(false);
    });

    it("should respect disabled confirmation config", () => {
      const config: Partial<SecurityConfig> = {
        requireConfirmation: false,
      };
      const customManager = new ServiceSecurityManager(config);
      const capabilities = createCapabilities({
        privilegedTools: ["message.send"],
      });

      const requires = customManager.requiresConfirmation(
        "test-service",
        "message.send",
        capabilities,
      );

      expect(requires).toBe(false);
    });
  });

  describe("Pre-Approval", () => {
    it("should grant pre-approval", () => {
      const record = manager.grantPreApproval("test-service", "message.send", "session");

      expect(record.serviceId).toBe("test-service");
      expect(record.toolName).toBe("message.send");
      expect(record.scope).toBe("session");
      expect(record.approvedAt).toBeInstanceOf(Date);
    });

    it("should check pre-approval status", () => {
      manager.grantPreApproval("test-service", "message.send", "session");

      const hasApproval = manager.hasPreApproval("test-service", "message.send");

      expect(hasApproval).toBe(true);
    });

    it("should not find pre-approval for unapproved tools", () => {
      const hasApproval = manager.hasPreApproval("test-service", "message.send");

      expect(hasApproval).toBe(false);
    });

    it("should revoke pre-approval", () => {
      manager.grantPreApproval("test-service", "message.send", "session");

      const revoked = manager.revokePreApproval("test-service", "message.send");
      const hasApproval = manager.hasPreApproval("test-service", "message.send");

      expect(revoked).toBe(true);
      expect(hasApproval).toBe(false);
    });

    it("should handle pre-approval expiration", () => {
      // Grant with 1ms duration
      manager.grantPreApproval("test-service", "message.send", "session", 1);

      // Wait for expiration
      return new Promise((resolve) => {
        setTimeout(() => {
          const hasApproval = manager.hasPreApproval("test-service", "message.send");
          expect(hasApproval).toBe(false);
          resolve(undefined);
        }, 10);
      });
    });

    it("should replace existing pre-approval when granting new one", () => {
      manager.grantPreApproval("test-service", "message.send", "session");
      manager.grantPreApproval("test-service", "message.send", "permanent");

      const approvals = manager.getAuditLog({ eventType: "preapproval_granted" });
      expect(approvals).toHaveLength(2);
    });
  });

  describe("Confirmation Flow", () => {
    it("should create confirmation request", () => {
      const request = manager.createConfirmationRequest(
        "test-service",
        "Test Service",
        "bash.exec",
        { command: "ls" },
      );

      expect(request.serviceId).toBe("test-service");
      expect(request.serviceName).toBe("Test Service");
      expect(request.toolName).toBe("bash.exec");
      expect(request.riskLevel).toBe("critical");
      expect(request.description).toContain("CRITICAL");
    });

    it("should process approved confirmation", () => {
      const request: ConfirmationRequest = {
        serviceId: "test-service",
        serviceName: "Test Service",
        toolName: "message.send",
        params: { to: "user123", message: "Hello" },
        riskLevel: "high",
        description: "Test description",
        timestamp: new Date(),
      };

      const response: ConfirmationResponse = {
        approved: true,
        approvedAt: new Date(),
      };

      manager.processConfirmationResponse(request, response);

      // Should grant pre-approval
      const hasApproval = manager.hasPreApproval("test-service", "message.send");
      expect(hasApproval).toBe(true);

      // Should log audit entry
      const auditLog = manager.getAuditLog({ eventType: "confirmation_received" });
      expect(auditLog).toHaveLength(1);
      expect(auditLog[0].result).toBe("success");
    });

    it("should process denied confirmation", () => {
      const request: ConfirmationRequest = {
        serviceId: "test-service",
        serviceName: "Test Service",
        toolName: "message.send",
        riskLevel: "high",
        description: "Test description",
        timestamp: new Date(),
      };

      const response: ConfirmationResponse = {
        approved: false,
        deniedAt: new Date(),
        reason: "User declined",
      };

      manager.processConfirmationResponse(request, response);

      // Should not grant pre-approval
      const hasApproval = manager.hasPreApproval("test-service", "message.send");
      expect(hasApproval).toBe(false);

      // Should log blocked audit entry
      const auditLog = manager.getAuditLog({ eventType: "tool_invocation_denied" });
      expect(auditLog).toHaveLength(1);
      expect(auditLog[0].result).toBe("blocked");
    });
  });
});

// =============================================================================
// Tool Invocation Security Tests
// =============================================================================

describe("ServiceSecurityManager - Tool Invocation", () => {
  let manager: ServiceSecurityManager;

  beforeEach(() => {
    manager = new ServiceSecurityManager();
  });

  describe("Basic Invocation Checks", () => {
    it("should allow invocation of safe tools", () => {
      const capabilities = createCapabilities();
      const result = manager.checkToolInvocation("test-service", "weather.fetch", capabilities, {
        location: "NYC",
      });

      expect(result.allowed).toBe(true);
      expect(result.requiresConfirmation).toBe(false);
    });

    it("should block invocation of blocked tools", () => {
      const blockedManager = new ServiceSecurityManager({
        blockedTools: ["dangerous.tool"],
      });
      const capabilities = createCapabilities();
      const result = blockedManager.checkToolInvocation(
        "test-service",
        "dangerous.tool",
        capabilities,
      );

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("blocked");
    });

    it("should require confirmation for privileged tools without pre-approval", () => {
      const capabilities = createCapabilities({
        privilegedTools: ["message.send"],
      });
      const result = manager.checkToolInvocation("test-service", "message.send", capabilities, {
        to: "user",
        message: "hi",
      });

      expect(result.allowed).toBe(false);
      expect(result.requiresConfirmation).toBe(true);
      expect(result.request).toBeDefined();
    });

    it("should allow privileged tools with pre-approval", () => {
      const capabilities = createCapabilities({
        privilegedTools: ["message.send"],
      });

      manager.grantPreApproval("test-service", "message.send", "session");

      const result = manager.checkToolInvocation("test-service", "message.send", capabilities);

      expect(result.allowed).toBe(true);
      expect(result.requiresConfirmation).toBe(false);
    });

    it("should block privileged tools not declared in capabilities", () => {
      const capabilities = createCapabilities(); // empty privilegedTools
      const result = manager.checkToolInvocation("test-service", "message.send", capabilities);

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("not declared");
    });
  });

  describe("Audit Logging", () => {
    it("should log allowed invocations", () => {
      const capabilities = createCapabilities();
      manager.checkToolInvocation("test-service", "weather.fetch", capabilities);

      const auditLog = manager.getAuditLog({ eventType: "tool_invocation_allowed" });
      expect(auditLog).toHaveLength(1);
      expect(auditLog[0].serviceId).toBe("test-service");
      expect(auditLog[0].toolName).toBe("weather.fetch");
    });

    it("should log blocked invocations", () => {
      const blockedManager = new ServiceSecurityManager({
        blockedTools: ["blocked.tool"],
      });
      const capabilities = createCapabilities();
      blockedManager.checkToolInvocation("test-service", "blocked.tool", capabilities);

      const auditLog = blockedManager.getAuditLog({ eventType: "tool_invocation_blocked" });
      expect(auditLog).toHaveLength(1);
      expect(auditLog[0].result).toBe("blocked");
    });

    it("should log confirmation requests", () => {
      const capabilities = createCapabilities({
        privilegedTools: ["message.send"],
      });
      manager.checkToolInvocation("test-service", "message.send", capabilities);

      const auditLog = manager.getAuditLog({ eventType: "confirmation_requested" });
      expect(auditLog).toHaveLength(1);
      expect(auditLog[0].result).toBe("pending");
    });
  });
});

// =============================================================================
// Security Context Tests
// =============================================================================

describe("ServiceSecurityManager - Security Context", () => {
  it("should create security context", () => {
    const manager = new ServiceSecurityManager();
    const capabilities = createCapabilities({ network: true });

    const context = manager.createSecurityContext("test-service", capabilities);

    expect(context.serviceId).toBe("test-service");
    expect(context.capabilities.network).toBe(true);
    expect(context.preApprovedTools).toBeInstanceOf(Set);
    expect(context.executionStartTime).toBeInstanceOf(Date);
  });

  it("should clean up security context", () => {
    const manager = new ServiceSecurityManager();
    const capabilities = createCapabilities();

    manager.createSecurityContext("test-service", capabilities);
    manager.cleanupSecurityContext("test-service");

    // Pre-approvals should be cleared
    const hasApproval = manager.hasPreApproval("test-service", "any.tool");
    expect(hasApproval).toBe(false);
  });
});

// =============================================================================
// Utility Function Tests
// =============================================================================

describe("Security Utility Functions", () => {
  describe("validateServiceCapabilities", () => {
    it("should validate manifest using standalone function", () => {
      const manifest = createTestManifest();
      const result = validateServiceCapabilities(manifest);

      expect(result.valid).toBe(true);
    });

    it("should accept global tool policy", () => {
      const manifest = createTestManifest({
        requires: { tools: ["bash.exec"] },
      });
      const globalPolicy: ToolPolicyLike = {
        deny: ["bash.exec"],
      };

      const result = validateServiceCapabilities(manifest, globalPolicy);

      expect(result.valid).toBe(false);
      expect(result.errors[0].code).toBe("TOOL_POLICY_VIOLATION");
    });
  });

  describe("wouldViolateSecurityPolicy", () => {
    it("should return false for safe manifest", () => {
      const manifest = createTestManifest();
      const result = wouldViolateSecurityPolicy(manifest);

      expect(result.violates).toBe(false);
      expect(result.reasons).toHaveLength(0);
    });

    it("should return true for violating manifest", () => {
      const manifest = createTestManifest({
        requires: { tools: ["bash.exec"] },
        capabilities: createCapabilities(), // missing bash.exec in privilegedTools
      });
      const result = wouldViolateSecurityPolicy(manifest);

      expect(result.violates).toBe(true);
      expect(result.reasons.length).toBeGreaterThan(0);
    });
  });

  describe("getToolsRequiringConfirmation", () => {
    it("should return tools requiring confirmation", () => {
      const manifest = createTestManifest({
        requires: { tools: ["message.send", "weather.fetch", "bash.exec"] },
        capabilities: createCapabilities({
          privilegedTools: ["message.send", "bash.exec"],
        }),
      });

      const tools = getToolsRequiringConfirmation(manifest);

      expect(tools).toContain("message.send");
      expect(tools).toContain("bash.exec");
      expect(tools).not.toContain("weather.fetch");
    });
  });

  describe("createSecuritySummary", () => {
    it("should create security summary", () => {
      const manifest = createTestManifest({
        requires: { tools: ["message.send", "bash.exec", "weather.fetch"] },
        capabilities: createCapabilities({
          privilegedTools: ["message.send", "bash.exec"],
          network: true,
        }),
      });

      const summary = createSecuritySummary(manifest);

      expect(summary.riskLevel).toBe("critical"); // bash.exec is critical
      expect(summary.privilegedTools).toContain("message.send");
      expect(summary.privilegedTools).toContain("bash.exec");
      expect(summary.requiresConfirmation).toContain("message.send");
      expect(summary.requiresConfirmation).toContain("bash.exec");
      expect(summary.warnings).toContain("Requires network access");
    });

    it("should handle empty manifest", () => {
      const manifest = createTestManifest();
      const summary = createSecuritySummary(manifest);

      expect(summary.riskLevel).toBe("low");
      expect(summary.privilegedTools).toHaveLength(0);
      expect(summary.requiresConfirmation).toHaveLength(0);
      expect(summary.warnings).toHaveLength(0);
    });
  });
});

// =============================================================================
// Privilege Escalation Prevention Tests
// =============================================================================

describe("Privilege Escalation Prevention", () => {
  it("should prevent using undeclared privileged tools", () => {
    const manager = new ServiceSecurityManager();
    const capabilities = createCapabilities({
      privilegedTools: ["message.send"],
      // email.send is NOT declared
    });

    // Try to use email.send which is not declared
    const result = manager.checkToolInvocation("test-service", "email.send", capabilities);

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("not declared");
  });

  it("should prevent bypassing denylist with wildcard capability", () => {
    const globalPolicy: ToolPolicyLike = {
      deny: ["dangerous.tool"],
    };
    const manager = new ServiceSecurityManager({}, globalPolicy);

    // Even with wildcard privilegedTools, denylist should still apply
    const capabilities = createCapabilities({
      privilegedTools: ["*"],
    });

    const result = manager.checkToolInvocation("test-service", "dangerous.tool", capabilities);

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("denied");
  });

  it("should prevent runtime privilege escalation via pre-approval manipulation", () => {
    const manager = new ServiceSecurityManager();

    // Grant pre-approval for message.send
    manager.grantPreApproval("test-service", "message.send", "session");

    // Pre-approval should not apply to different tool
    const hasApproval = manager.hasPreApproval("test-service", "bash.exec");
    expect(hasApproval).toBe(false);
  });

  it("should isolate pre-approvals between services", () => {
    const manager = new ServiceSecurityManager();

    // Grant pre-approval for service A
    manager.grantPreApproval("service-a", "message.send", "session");

    // Service B should not have pre-approval
    const hasApproval = manager.hasPreApproval("service-b", "message.send");
    expect(hasApproval).toBe(false);
  });
});

// =============================================================================
// Default Configuration Tests
// =============================================================================

describe("Default Security Configuration", () => {
  it("should have sensible defaults", () => {
    expect(DEFAULT_SECURITY_CONFIG.requireConfirmation).toBe(true);
    expect(DEFAULT_SECURITY_CONFIG.defaultRiskLevel).toBe("medium");
    expect(DEFAULT_SECURITY_CONFIG.maxExecutionsPerMinute).toBe(60);
    expect(DEFAULT_SECURITY_CONFIG.maxConcurrentExecutions).toBe(5);
    expect(DEFAULT_SECURITY_CONFIG.auditAllToolCalls).toBe(false);
  });

  it("should include critical tools in always-require list", () => {
    expect(DEFAULT_SECURITY_CONFIG.alwaysRequireConfirmation).toContain("bash.exec");
    expect(DEFAULT_SECURITY_CONFIG.alwaysRequireConfirmation).toContain("config.set");
    expect(DEFAULT_SECURITY_CONFIG.alwaysRequireConfirmation).toContain("gateway.restart");
  });

  it("should block gateway.shutdown by default", () => {
    expect(DEFAULT_SECURITY_CONFIG.blockedTools).toContain("gateway.shutdown");
  });
});

// =============================================================================
// Audit Log Tests
// =============================================================================

describe("Audit Log", () => {
  it("should filter audit log by service", () => {
    const manager = new ServiceSecurityManager();

    manager.validateCapabilities(createTestManifest({ id: "service-a" }));
    manager.validateCapabilities(createTestManifest({ id: "service-b" }));

    const serviceALog = manager.getAuditLog({ serviceId: "service-a" });
    expect(serviceALog).toHaveLength(1);
    expect(serviceALog[0].serviceId).toBe("service-a");
  });

  it("should filter audit log by event type", () => {
    const manager = new ServiceSecurityManager();

    manager.validateCapabilities(createTestManifest({ id: "test-service" }));

    const validationLog = manager.getAuditLog({ eventType: "capability_validation" });
    expect(validationLog).toHaveLength(1);

    const blockedLog = manager.getAuditLog({ eventType: "tool_invocation_blocked" });
    expect(blockedLog).toHaveLength(0);
  });

  it("should limit audit log results", () => {
    const manager = new ServiceSecurityManager();

    // Create multiple entries
    for (let i = 0; i < 5; i++) {
      manager.validateCapabilities(createTestManifest({ id: `service-${i}` }));
    }

    const limitedLog = manager.getAuditLog({ limit: 3 });
    expect(limitedLog).toHaveLength(3);
  });

  it("should clear audit log", () => {
    const manager = new ServiceSecurityManager();

    manager.validateCapabilities(createTestManifest());
    manager.clearAuditLog();

    const auditLog = manager.getAuditLog();
    expect(auditLog).toHaveLength(0);
  });
});
