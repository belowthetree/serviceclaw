/**
 * Service Error Handling Module
 *
 * Provides comprehensive error handling for service operations including:
 * - Error classification and categorization
 * - User-friendly error messages
 * - Error context and recovery suggestions
 * - Rollback coordination and verification
 *
 * @see src/services/lifecycle.ts
 * @see src/services/schema.ts
 */

import { formatErrorMessage } from "../infra/errors.js";
import type { InstallationPhase, ServiceRuntimeRefs, ServiceState } from "./lifecycle.js";
import type { ServiceManifest, TriggerType } from "./schema.js";

// =============================================================================
// Error Categories
// =============================================================================

/**
 * Service error categories for classification and handling
 */
export type ServiceErrorCategory =
  | "validation" // Configuration or manifest validation failed
  | "installation" // Installation phase failed
  | "runtime" // Runtime execution error
  | "state" // Invalid state transition
  | "resource" // Resource management error (cron, webhooks, etc.)
  | "network" // Network-related error
  | "permission" // Permission denied
  | "dependency" // Missing or incompatible dependency
  | "rollback" // Rollback operation failed
  | "cleanup" // Cleanup verification failed
  | "unknown"; // Uncategorized error

/**
 * Severity levels for error handling
 */
export type ErrorSeverity =
  | "critical" // System-level failure, requires immediate attention
  | "error" // Operation failed, needs recovery
  | "warning" // Non-fatal issue, operation may continue
  | "info"; // Informational, for logging only

// =============================================================================
// Error Context Interfaces
// =============================================================================

/**
 * Context for validation errors
 */
export interface ValidationErrorContext {
  /** Field that failed validation */
  field?: string;
  /** Expected value or format */
  expected?: string;
  /** Actual value received */
  actual?: unknown;
  /** Validation constraints that failed */
  constraints?: string[];
}

/**
 * Context for resource errors
 */
export interface ResourceErrorContext {
  /** Resource type that failed */
  resourceType: "cron" | "webhook" | "message_subscription" | "agent" | "session";
  /** Resource identifier */
  resourceId?: string;
  /** Operation being performed */
  operation: "create" | "read" | "update" | "delete" | "register" | "unregister";
  /** Whether the resource was partially created */
  partialCreation?: boolean;
}

/**
 * Context for installation errors
 */
export interface InstallationErrorContext {
  /** Phase where error occurred */
  phase: InstallationPhase;
  /** Previous phases that succeeded */
  completedPhases?: InstallationPhase[];
  /** Resources created before failure */
  createdResources?: Partial<ServiceRuntimeRefs>;
  /** Whether rollback was attempted */
  rollbackAttempted?: boolean;
  /** Whether rollback succeeded */
  rollbackSuccess?: boolean;
}

/**
 * Context for network errors
 */
export interface NetworkErrorContext {
  /** URL or endpoint */
  endpoint?: string;
  /** HTTP method */
  method?: string;
  /** Response status code */
  statusCode?: number;
  /** Whether retry is possible */
  retryable: boolean;
  /** Number of retry attempts made */
  retryCount?: number;
}

/**
 * Combined error context
 */
export type ServiceErrorContext =
  | ValidationErrorContext
  | ResourceErrorContext
  | InstallationErrorContext
  | NetworkErrorContext
  | Record<string, unknown>;

// =============================================================================
// Service Error Class Hierarchy
// =============================================================================

/**
 * Base class for all service-related errors
 *
 * Provides:
 * - Service identification
 * - Error categorization
 * - Severity levels
 * - User-friendly messages
 * - Recovery suggestions
 * - Nested error support
 */
export class ServiceError extends Error {
  /** Error category for classification */
  public readonly category: ServiceErrorCategory;

  /** Error severity level */
  public readonly severity: ErrorSeverity;

  /** Service ID where error occurred */
  public readonly serviceId: string;

  /** Additional error context */
  public readonly context?: ServiceErrorContext;

  /** Original error that caused this error */
  public readonly cause?: Error;

  /** Timestamp when error occurred */
  public readonly timestamp: Date;

  /** Error code for programmatic handling */
  public readonly code: string;

  constructor(options: {
    message: string;
    serviceId: string;
    category: ServiceErrorCategory;
    severity?: ErrorSeverity;
    context?: ServiceErrorContext;
    cause?: Error;
    code?: string;
  }) {
    super(options.message);
    this.name = "ServiceError";
    this.serviceId = options.serviceId;
    this.category = options.category;
    this.severity = options.severity ?? "error";
    this.context = options.context;
    this.cause = options.cause;
    this.code = options.code ?? `SERVICE_${options.category.toUpperCase()}`;
    this.timestamp = new Date();

    // Maintain proper stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ServiceError);
    }
  }

  /**
   * Get a user-friendly error message
   */
  getUserMessage(): string {
    return formatErrorMessage(this);
  }

  /**
   * Get recovery suggestions for this error
   */
  getRecoverySuggestions(): string[] {
    return getRecoverySuggestions(this);
  }

  /**
   * Check if this error is retryable
   */
  isRetryable(): boolean {
    return isRetryableError(this);
  }

  /**
   * Convert to JSON-serializable object
   */
  toJSON(): ServiceErrorSerialized {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      category: this.category,
      severity: this.severity,
      serviceId: this.serviceId,
      timestamp: this.timestamp.toISOString(),
      context: this.context,
      cause: this.cause
        ? {
            name: this.cause.name,
            message: this.cause.message,
          }
        : undefined,
      stack: this.stack,
    };
  }
}

/**
 * Error during service validation
 */
export class ServiceValidationError extends ServiceError {
  /** List of validation errors */
  public readonly validationErrors: string[];

  /** Manifest being validated */
  public readonly manifest?: ServiceManifest;

  constructor(options: {
    message: string;
    serviceId: string;
    validationErrors: string[];
    manifest?: ServiceManifest;
    context?: ValidationErrorContext;
    cause?: Error;
  }) {
    super({
      message: options.message,
      serviceId: options.serviceId,
      category: "validation",
      severity: "warning",
      context: options.context,
      cause: options.cause,
      code: "SERVICE_VALIDATION_FAILED",
    });
    this.name = "ServiceValidationError";
    this.validationErrors = options.validationErrors;
    this.manifest = options.manifest;
  }

  /**
   * Get formatted validation errors for display
   */
  getFormattedErrors(): string {
    return this.validationErrors.map((err, i) => `${i + 1}. ${err}`).join("\n");
  }
}

/**
 * Error during service installation
 */
export class ServiceInstallationError extends ServiceError {
  /** Installation phase where error occurred */
  public readonly phase: InstallationPhase;

  /** Phases completed before failure */
  public readonly completedPhases: InstallationPhase[];

  constructor(options: {
    message: string;
    serviceId: string;
    phase: InstallationPhase;
    completedPhases?: InstallationPhase[];
    context?: InstallationErrorContext;
    cause?: Error;
  }) {
    super({
      message: options.message,
      serviceId: options.serviceId,
      category: "installation",
      severity: "error",
      context: options.context,
      cause: options.cause,
      code: `SERVICE_INSTALL_${options.phase.toUpperCase()}_FAILED`,
    });
    this.name = "ServiceInstallationError";
    this.phase = options.phase;
    this.completedPhases = options.completedPhases ?? [];
  }
}

/**
 * Error for invalid state transitions
 */
export class ServiceStateError extends ServiceError {
  /** Current service state */
  public readonly currentState: ServiceState;

  /** Attempted transition */
  public readonly attemptedTransition: string;

  /** Valid transitions from current state */
  public readonly validTransitions: ServiceState[];

  constructor(options: {
    message: string;
    serviceId: string;
    currentState: ServiceState;
    attemptedTransition: string;
    validTransitions: ServiceState[];
  }) {
    super({
      message: options.message,
      serviceId: options.serviceId,
      category: "state",
      severity: "warning",
      code: "SERVICE_INVALID_STATE_TRANSITION",
    });
    this.name = "ServiceStateError";
    this.currentState = options.currentState;
    this.attemptedTransition = options.attemptedTransition;
    this.validTransitions = options.validTransitions;
  }

  /**
   * Get a formatted list of valid next states
   */
  getValidTransitionsText(): string {
    return this.validTransitions.join(", ") || "none";
  }
}

/**
 * Error during resource management (cron, webhooks, etc.)
 */
export class ServiceResourceError extends ServiceError {
  /** Resource type */
  public readonly resourceType: ResourceErrorContext["resourceType"];

  /** Resource ID */
  public readonly resourceId?: string;

  /** Operation being performed */
  public readonly operation: ResourceErrorContext["operation"];

  constructor(options: {
    message: string;
    serviceId: string;
    resourceType: ResourceErrorContext["resourceType"];
    operation: ResourceErrorContext["operation"];
    resourceId?: string;
    context?: ResourceErrorContext;
    cause?: Error;
  }) {
    super({
      message: options.message,
      serviceId: options.serviceId,
      category: "resource",
      severity: "error",
      context: options.context,
      cause: options.cause,
      code: `SERVICE_RESOURCE_${options.resourceType.toUpperCase()}_${options.operation.toUpperCase()}_FAILED`,
    });
    this.name = "ServiceResourceError";
    this.resourceType = options.resourceType;
    this.resourceId = options.resourceId;
    this.operation = options.operation;
  }
}

/**
 * Error during rollback operations
 */
export class ServiceRollbackError extends ServiceError {
  /** Original error that triggered rollback */
  public readonly originalError: Error;

  /** Resources that were rolled back successfully */
  public readonly rolledBackResources: string[];

  /** Resources that failed to roll back */
  public readonly failedResources: Array<{ resource: string; error: string }>;

  constructor(options: {
    message: string;
    serviceId: string;
    originalError: Error;
    rolledBackResources?: string[];
    failedResources?: Array<{ resource: string; error: string }>;
    cause?: Error;
  }) {
    super({
      message: options.message,
      serviceId: options.serviceId,
      category: "rollback",
      severity: "critical",
      cause: options.cause,
      code: "SERVICE_ROLLBACK_FAILED",
    });
    this.name = "ServiceRollbackError";
    this.originalError = options.originalError;
    this.rolledBackResources = options.rolledBackResources ?? [];
    this.failedResources = options.failedResources ?? [];
  }

  /**
   * Check if rollback was fully successful
   */
  isComplete(): boolean {
    return this.failedResources.length === 0;
  }

  /**
   * Get a summary of rollback results
   */
  getRollbackSummary(): string {
    const total = this.rolledBackResources.length + this.failedResources.length;
    return `Rollback: ${this.rolledBackResources.length}/${total} resources cleaned up successfully`;
  }
}

/**
 * Error during cleanup verification
 */
export class ServiceCleanupError extends ServiceError {
  /** Resources that were successfully cleaned up */
  public readonly cleanedResources: string[];

  /** Resources that failed to clean up */
  public readonly failedResources: Array<{ resource: string; error: string }>;

  /** Resources that were not found (already cleaned) */
  public readonly missingResources: string[];

  constructor(options: {
    message: string;
    serviceId: string;
    cleanedResources?: string[];
    failedResources?: Array<{ resource: string; error: string }>;
    missingResources?: string[];
    cause?: Error;
  }) {
    super({
      message: options.message,
      serviceId: options.serviceId,
      category: "cleanup",
      severity: "warning",
      cause: options.cause,
      code: "SERVICE_CLEANUP_INCOMPLETE",
    });
    this.name = "ServiceCleanupError";
    this.cleanedResources = options.cleanedResources ?? [];
    this.failedResources = options.failedResources ?? [];
    this.missingResources = options.missingResources ?? [];
  }

  /**
   * Check if cleanup was fully successful
   */
  isComplete(): boolean {
    return this.failedResources.length === 0;
  }

  /**
   * Get cleanup verification report
   */
  getCleanupReport(): CleanupReport {
    return {
      totalResources:
        this.cleanedResources.length + this.failedResources.length + this.missingResources.length,
      cleaned: this.cleanedResources.length,
      failed: this.failedResources.length,
      missing: this.missingResources.length,
      success: this.isComplete(),
    };
  }
}

/**
 * Error for network-related failures
 */
export class ServiceNetworkError extends ServiceError {
  /** Endpoint that failed */
  public readonly endpoint?: string;

  /** Whether the error is retryable */
  public readonly retryable: boolean;

  /** Number of retry attempts made */
  public readonly retryCount: number;

  constructor(options: {
    message: string;
    serviceId: string;
    endpoint?: string;
    retryable?: boolean;
    retryCount?: number;
    context?: NetworkErrorContext;
    cause?: Error;
  }) {
    super({
      message: options.message,
      serviceId: options.serviceId,
      category: "network",
      severity: "error",
      context: options.context,
      cause: options.cause,
      code: "SERVICE_NETWORK_ERROR",
    });
    this.name = "ServiceNetworkError";
    this.endpoint = options.endpoint;
    this.retryable = options.retryable ?? false;
    this.retryCount = options.retryCount ?? 0;
  }
}

/**
 * Error for permission/access failures
 */
export class ServicePermissionError extends ServiceError {
  /** Resource that requires permission */
  public readonly resource?: string;

  /** Required permission */
  public readonly requiredPermission?: string;

  constructor(options: {
    message: string;
    serviceId: string;
    resource?: string;
    requiredPermission?: string;
    cause?: Error;
  }) {
    super({
      message: options.message,
      serviceId: options.serviceId,
      category: "permission",
      severity: "error",
      cause: options.cause,
      code: "SERVICE_PERMISSION_DENIED",
    });
    this.name = "ServicePermissionError";
    this.resource = options.resource;
    this.requiredPermission = options.requiredPermission;
  }
}

/**
 * Error for dependency failures
 */
export class ServiceDependencyError extends ServiceError {
  /** Missing or failed dependency */
  public readonly dependency: string;

  /** Type of dependency */
  public readonly dependencyType: "skill" | "tool" | "service" | "external";

  /** Required version */
  public readonly requiredVersion?: string;

  /** Installed version (if any) */
  public readonly installedVersion?: string;

  constructor(options: {
    message: string;
    serviceId: string;
    dependency: string;
    dependencyType: "skill" | "tool" | "service" | "external";
    requiredVersion?: string;
    installedVersion?: string;
    cause?: Error;
  }) {
    super({
      message: options.message,
      serviceId: options.serviceId,
      category: "dependency",
      severity: "error",
      cause: options.cause,
      code: "SERVICE_DEPENDENCY_MISSING",
    });
    this.name = "ServiceDependencyError";
    this.dependency = options.dependency;
    this.dependencyType = options.dependencyType;
    this.requiredVersion = options.requiredVersion;
    this.installedVersion = options.installedVersion;
  }
}

/**
 * Error for runtime execution failures
 */
export class ServiceRuntimeError extends ServiceError {
  /** Trigger type that caused the error */
  public readonly triggerType?: TriggerType;

  /** Execution context */
  public readonly executionContext?: Record<string, unknown>;

  /** Whether the service should be auto-disabled */
  public readonly autoDisable: boolean;

  constructor(options: {
    message: string;
    serviceId: string;
    triggerType?: TriggerType;
    executionContext?: Record<string, unknown>;
    autoDisable?: boolean;
    cause?: Error;
  }) {
    super({
      message: options.message,
      serviceId: options.serviceId,
      category: "runtime",
      severity: "error",
      cause: options.cause,
      code: "SERVICE_RUNTIME_ERROR",
    });
    this.name = "ServiceRuntimeError";
    this.triggerType = options.triggerType;
    this.executionContext = options.executionContext;
    this.autoDisable = options.autoDisable ?? true;
  }
}

// =============================================================================
// Serialized Error Type
// =============================================================================

export interface ServiceErrorSerialized {
  name: string;
  message: string;
  code: string;
  category: ServiceErrorCategory;
  severity: ErrorSeverity;
  serviceId: string;
  timestamp: string;
  context?: ServiceErrorContext;
  cause?: {
    name: string;
    message: string;
  };
  stack?: string;
}

// =============================================================================
// Cleanup Report
// =============================================================================

export interface CleanupReport {
  totalResources: number;
  cleaned: number;
  failed: number;
  missing: number;
  success: boolean;
}

// =============================================================================
// Error Message Helpers
// =============================================================================

/**
 * User-friendly error messages for each error category
 */
const ERROR_MESSAGES: Record<ServiceErrorCategory, string> = {
  validation: "Service configuration is invalid. Please check your settings.",
  installation: "Service installation failed. All changes have been rolled back.",
  runtime: "Service encountered an error while running and has been automatically disabled.",
  state: "Service state transition is not allowed from the current state.",
  resource: "Failed to create or manage service resources.",
  network: "Network error occurred while communicating with external services.",
  permission: "Permission denied. Please check your access credentials.",
  dependency: "Required dependency is missing or incompatible.",
  rollback: "Failed to roll back service installation. Manual cleanup may be required.",
  cleanup: "Service cleanup incomplete. Some resources may remain.",
  unknown: "An unexpected error occurred.",
};

/**
 * Recovery suggestions for each error category
 */
const RECOVERY_SUGGESTIONS: Record<ServiceErrorCategory, string[]> = {
  validation: [
    "Check that all required configuration fields are provided",
    "Verify that configuration values match the expected types",
    "Review the service manifest for any missing or invalid fields",
  ],
  installation: [
    "Check the service logs for detailed error information",
    "Verify that all required dependencies are installed",
    "Ensure the service manifest is valid",
    "Try installing the service again after fixing any issues",
  ],
  runtime: [
    "Check the service configuration for any errors",
    "Review recent changes to the service or its dependencies",
    "Re-enable the service after fixing the underlying issue",
    "Check the logs for more detailed error information",
  ],
  state: [
    "Check the current service state before attempting the transition",
    "Use 'service status' to see the current state and valid transitions",
    "Disable the service before attempting to uninstall it",
  ],
  resource: [
    "Check that the resource name/ID is unique and valid",
    "Verify that required services (cron, webhook) are running",
    "Check for any permission issues with resource creation",
    "Try uninstalling and reinstalling the service",
  ],
  network: [
    "Check your network connection",
    "Verify that the remote service is accessible",
    "Check firewall settings that may block the connection",
    "Retry the operation after network issues are resolved",
  ],
  permission: [
    "Verify that you have the required permissions",
    "Check that credentials are valid and not expired",
    "Ensure the service has access to the required resources",
    "Contact your administrator if you need additional permissions",
  ],
  dependency: [
    "Install the missing dependency",
    "Check that the installed version meets the requirements",
    "Update the dependency to a compatible version",
    "Review the service documentation for dependency requirements",
  ],
  rollback: [
    "Check the logs for which resources failed to roll back",
    "Manually clean up any remaining resources if needed",
    "Contact support if resources cannot be cleaned up",
    "Review the service state before retrying installation",
  ],
  cleanup: [
    "Check the cleanup report for details on failed resources",
    "Manually remove any remaining resources if necessary",
    "Verify that the service is fully uninstalled",
    "Retry the uninstall operation if needed",
  ],
  unknown: [
    "Check the service logs for more information",
    "Try the operation again",
    "Contact support if the issue persists",
  ],
};

/**
 * Retryable error categories
 */
const RETRYABLE_CATEGORIES: ServiceErrorCategory[] = ["network", "resource"];

/**
 * Check if an error is retryable
 */
export function isRetryableError(error: ServiceError): boolean {
  // Network errors are generally retryable
  if (error.category === "network") {
    return (error as ServiceNetworkError).retryable;
  }

  // Resource creation errors may be retryable
  if (error.category === "resource") {
    return true;
  }

  // Check if error explicitly indicates retry is possible
  if (error.context && "retryable" in error.context) {
    return Boolean(error.context.retryable);
  }

  return RETRYABLE_CATEGORIES.includes(error.category);
}

/**
 * Get recovery suggestions for an error
 */
export function getRecoverySuggestions(error: ServiceError): string[] {
  const baseSuggestions = RECOVERY_SUGGESTIONS[error.category] ?? RECOVERY_SUGGESTIONS.unknown;

  // Add specific suggestions based on error type
  const specificSuggestions: string[] = [];

  if (error instanceof ServiceStateError) {
    specificSuggestions.push(`Valid next states: ${error.getValidTransitionsText()}`);
  }

  if (error instanceof ServiceRollbackError && !error.isComplete()) {
    specificSuggestions.push(
      `Failed to roll back: ${error.failedResources.map((r) => r.resource).join(", ")}`,
    );
  }

  if (error instanceof ServiceCleanupError && !error.isComplete()) {
    specificSuggestions.push(
      `Failed to clean up: ${error.failedResources.map((r) => r.resource).join(", ")}`,
    );
  }

  return [...specificSuggestions, ...baseSuggestions];
}

/**
 * Get user-friendly error message
 */
export function getUserFriendlyMessage(error: ServiceError): string {
  const baseMessage = ERROR_MESSAGES[error.category] ?? ERROR_MESSAGES.unknown;
  return `${baseMessage}\n\nDetails: ${error.message}`;
}

// =============================================================================
// Error Factory Functions
// =============================================================================

/**
 * Create an error from an unknown value
 */
export function createServiceError(
  error: unknown,
  serviceId: string,
  category: ServiceErrorCategory = "unknown",
): ServiceError {
  if (error instanceof ServiceError) {
    return error;
  }

  const message = formatErrorMessage(error);

  return new ServiceError({
    message,
    serviceId,
    category,
    severity: "error",
    cause: error instanceof Error ? error : undefined,
  });
}

/**
 * Wrap an error with additional context
 */
export function wrapServiceError(
  error: Error,
  serviceId: string,
  context: ServiceErrorContext,
): ServiceError {
  if (error instanceof ServiceError) {
    // Create new error with merged context
    return new ServiceError({
      message: error.message,
      serviceId: error.serviceId,
      category: error.category,
      severity: error.severity,
      context: { ...error.context, ...context },
      cause: error.cause,
      code: error.code,
    });
  }

  return new ServiceError({
    message: error.message,
    serviceId,
    category: "unknown",
    severity: "error",
    context,
    cause: error,
  });
}

// =============================================================================
// Rollback and Cleanup Types
// =============================================================================

/**
 * Rollback action with metadata
 */
export interface RollbackAction {
  /** Unique identifier for the resource */
  resourceId: string;
  /** Human-readable description */
  description: string;
  /** The rollback function */
  execute: () => Promise<void>;
  /** Whether this action is critical */
  critical?: boolean;
}

/**
 * Rollback coordinator manages rollback actions
 */
export class RollbackCoordinator {
  private actions: RollbackAction[] = [];
  private executed: Set<string> = new Set();
  private failed: Array<{ resourceId: string; error: Error }> = [];

  /**
   * Add a rollback action
   */
  add(action: RollbackAction): void {
    this.actions.push(action);
  }

  /**
   * Execute all rollback actions in reverse order
   */
  async execute(serviceId: string): Promise<void> {
    // Execute in reverse order (LIFO)
    while (this.actions.length > 0) {
      const action = this.actions.pop()!;

      if (this.executed.has(action.resourceId)) {
        continue;
      }

      try {
        await action.execute();
        this.executed.add(action.resourceId);
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        this.failed.push({ resourceId: action.resourceId, error: err });

        // Continue with other rollbacks even if one fails
        // unless it's a critical resource
        if (action.critical) {
          throw new ServiceRollbackError({
            message: `Critical rollback failed for ${action.resourceId}: ${err.message}`,
            serviceId,
            originalError: err,
            rolledBackResources: Array.from(this.executed),
            failedResources: this.failed.map((f) => ({
              resource: f.resourceId,
              error: f.error.message,
            })),
            cause: err,
          });
        }
      }
    }

    // If any rollbacks failed, throw error
    if (this.failed.length > 0) {
      throw new ServiceRollbackError({
        message: `Rollback completed with ${this.failed.length} failures`,
        serviceId,
        originalError: new Error("Installation failed"),
        rolledBackResources: Array.from(this.executed),
        failedResources: this.failed.map((f) => ({
          resource: f.resourceId,
          error: f.error.message,
        })),
      });
    }
  }

  /**
   * Get rollback status
   */
  getStatus(): {
    total: number;
    executed: number;
    remaining: number;
    failed: number;
  } {
    return {
      total: this.actions.length + this.executed.size + this.failed.length,
      executed: this.executed.size,
      remaining: this.actions.length,
      failed: this.failed.length,
    };
  }

  /**
   * Check if rollback is complete
   */
  isComplete(): boolean {
    return this.actions.length === 0;
  }

  /**
   * Clear all actions
   */
  clear(): void {
    this.actions = [];
    this.executed.clear();
    this.failed = [];
  }
}

// =============================================================================
// Cleanup Verification
// =============================================================================

/**
 * Cleanup verification result
 */
export interface CleanupVerificationResult {
  /** Whether cleanup was fully successful */
  success: boolean;
  /** Resources that were verified as cleaned */
  verified: string[];
  /** Resources that failed verification */
  failed: Array<{ resource: string; error: string }>;
  /** Resources that were already missing (orphaned) */
  orphaned: string[];
}

/**
 * Cleanup verifier for post-uninstall verification
 */
export class CleanupVerifier {
  private verifications: Array<{
    resourceId: string;
    description: string;
    verify: () => Promise<boolean>;
  }> = [];

  /**
   * Add a verification check
   */
  add(resourceId: string, description: string, verify: () => Promise<boolean>): void {
    this.verifications.push({ resourceId, description, verify });
  }

  /**
   * Add verification for cron jobs
   */
  addCronVerification(cronJobIds: string[], existsCheck: (id: string) => Promise<boolean>): void {
    for (const jobId of cronJobIds) {
      this.add(`cron:${jobId}`, `Verify cron job ${jobId} is removed`, async () => {
        const exists = await existsCheck(jobId);
        return !exists; // Should NOT exist
      });
    }
  }

  /**
   * Add verification for webhooks
   */
  addWebhookVerification(paths: string[], existsCheck: (path: string) => Promise<boolean>): void {
    for (const path of paths) {
      this.add(`webhook:${path}`, `Verify webhook ${path} is unregistered`, async () => {
        const exists = await existsCheck(path);
        return !exists; // Should NOT exist
      });
    }
  }

  /**
   * Add verification for message subscriptions
   */
  addSubscriptionVerification(
    channels: string[],
    existsCheck: (channel: string) => Promise<boolean>,
  ): void {
    for (const channel of channels) {
      this.add(
        `subscription:${channel}`,
        `Verify subscription to ${channel} is removed`,
        async () => {
          const exists = await existsCheck(channel);
          return !exists; // Should NOT exist
        },
      );
    }
  }

  /**
   * Execute all verification checks
   */
  async verify(_serviceId: string): Promise<CleanupVerificationResult> {
    const verified: string[] = [];
    const failed: Array<{ resource: string; error: string }> = [];
    const orphaned: string[] = [];

    for (const verification of this.verifications) {
      try {
        const isClean = await verification.verify();

        if (isClean) {
          verified.push(verification.resourceId);
        } else {
          // Resource still exists (cleanup failed)
          failed.push({
            resource: verification.resourceId,
            error: "Resource still exists after cleanup",
          });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        // Check if this is a "not found" error (resource already cleaned)
        if (message.includes("not found") || message.includes("ENOENT")) {
          orphaned.push(verification.resourceId);
        } else {
          failed.push({
            resource: verification.resourceId,
            error: message,
          });
        }
      }
    }

    return {
      success: failed.length === 0,
      verified,
      failed,
      orphaned,
    };
  }

  /**
   * Clear all verifications
   */
  clear(): void {
    this.verifications = [];
  }
}

// =============================================================================
// Error Aggregation
// =============================================================================

/**
 * Aggregate multiple errors into a single error
 */
export function aggregateErrors(
  errors: ServiceError[],
  serviceId: string,
  message: string,
): ServiceError {
  if (errors.length === 0) {
    return new ServiceError({
      message: "No errors to aggregate",
      serviceId,
      category: "unknown",
      severity: "info",
    });
  }

  if (errors.length === 1) {
    return errors[0];
  }

  // Find most severe error
  const severityOrder: ErrorSeverity[] = ["critical", "error", "warning", "info"];
  const mostSevere = errors.reduce((most, current) => {
    const mostIndex = severityOrder.indexOf(most.severity);
    const currentIndex = severityOrder.indexOf(current.severity);
    return currentIndex < mostIndex ? current : most;
  });

  return new ServiceError({
    message: `${message} (${errors.length} errors occurred)`,
    serviceId,
    category: mostSevere.category,
    severity: mostSevere.severity,
    cause: mostSevere,
  });
}

// =============================================================================
// Export for testing
// =============================================================================

export const _testing = {
  ERROR_MESSAGES,
  RECOVERY_SUGGESTIONS,
  RETRYABLE_CATEGORIES,
};
