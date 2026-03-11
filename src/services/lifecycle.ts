/**
 * Service Lifecycle Manager
 *
 * Implements the Service class with full lifecycle management:
 * - State machine: pending → validating → installing → installed → enabled/disabled → uninstalling
 * - Atomic installation with 4-phase commit and rollback
 * - Integration with CronService, webhook registry, and hook system
 *
 * @see docs/services/architecture.md
 * @see src/services/schema.ts
 */

import type { ToolPolicyLike } from "../agents/tool-policy.js";
import type { CronService } from "../cron/service.js";
import {
  registerInternalHook,
  type InternalHookHandler,
  type MessageReceivedHookContext,
} from "../hooks/internal-hooks.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { registerPluginHttpRoute, type PluginHttpRouteHandler } from "../plugins/http-registry.js";
import type { PluginRegistry } from "../plugins/registry.js";
import type {
  CronTrigger,
  MessageTrigger,
  ServiceConfig,
  ServiceExecutionConfig,
  ServiceManifest,
  WebhookTrigger,
} from "./schema.js";
import { ServiceSecurityManager } from "./security.js";
import { createServiceCronTrigger, ServiceCronTrigger } from "./triggers/cron.js";

const logger = createSubsystemLogger("services:lifecycle");

// =============================================================================
// Service State Definitions
// =============================================================================

/**
 * Service lifecycle states
 *
 * State transitions:
 * - pending → validating (install initiated)
 * - validating → installing (validation passed)
 * - validating → validation_error (validation failed)
 * - installing → installed (installation succeeded)
 * - installing → install_error (installation failed, rolled back)
 * - installed → enabled (user enabled)
 * - installed → disabled (user disabled)
 * - enabled → disabled (user disabled)
 * - disabled → enabled (user enabled)
 * - enabled → error (runtime error)
 * - error → disabled (auto-disabled after error)
 * - disabled → uninstalling (uninstall initiated)
 * - enabled → uninstalling (uninstall initiated)
 */
export type ServiceState =
  | "pending"
  | "validating"
  | "installing"
  | "installed"
  | "enabled"
  | "disabled"
  | "error"
  | "validation_error"
  | "install_error"
  | "uninstalling";

/**
 * State transition record for tracking history
 */
export interface StateTransition {
  from: ServiceState;
  to: ServiceState;
  timestamp: Date;
  reason?: string;
}

// =============================================================================
// Error Classes
// =============================================================================

/**
 * Base error for service operations
 */
export class ServiceError extends Error {
  constructor(
    message: string,
    public readonly serviceId: string,
    public readonly cause?: Error,
  ) {
    super(message);
    this.name = "ServiceError";
  }
}

/**
 * Error during service installation
 */
export class ServiceInstallError extends ServiceError {
  constructor(
    message: string,
    serviceId: string,
    public readonly phase: InstallationPhase,
    cause?: Error,
  ) {
    super(message, serviceId, cause);
    this.name = "ServiceInstallError";
  }
}

/**
 * Error during service validation
 */
export class ServiceValidationError extends ServiceError {
  constructor(
    message: string,
    serviceId: string,
    public readonly validationErrors: string[],
  ) {
    super(message, serviceId);
    this.name = "ServiceValidationError";
  }
}

/**
 * Error for invalid state transitions
 */
export class ServiceStateError extends ServiceError {
  constructor(
    message: string,
    serviceId: string,
    public readonly currentState: ServiceState,
    public readonly attemptedTransition: string,
  ) {
    super(message, serviceId);
    this.name = "ServiceStateError";
  }
}

// =============================================================================
// Runtime References
// =============================================================================

/**
 * Runtime references created during service installation
 * These are used for cleanup during uninstall/rollback
 */
export interface ServiceRuntimeRefs {
  /** Cron job IDs created for this service */
  cronJobIds: string[];

  /** Webhook paths registered */
  webhookPaths: string[];

  /** Webhook unregister functions */
  webhookUnregisterFns: Array<() => void>;

  /** Message subscription unregistration functions */
  messageSubscriptions: Array<{
    channel: string;
    unsubscribe: () => void;
  }>;

  /** Service agent ID */
  agentId: string;

  /** Session key for the service agent */
  sessionKey?: string;

  cronTrigger?: ServiceCronTrigger;
}

/**
 * Execution statistics for a service
 */
export interface ServiceExecutionStats {
  totalRuns: number;
  successfulRuns: number;
  failedRuns: number;
  lastRunAt?: Date;
  nextRunAt?: Date;
  lastError?: {
    message: string;
    timestamp: Date;
    stack?: string;
  };
}

// =============================================================================
// Installation Types
// =============================================================================

/**
 * Installation phases for atomic installation
 */
export type InstallationPhase = "validate" | "prepare" | "create_resources" | "commit" | "rollback";

/**
 * Rollback action for cleaning up resources
 */
type RollbackAction = () => Promise<void>;

/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings?: string[];
}

/**
 * Installation result
 */
export interface InstallResult {
  success: boolean;
  agentId: string;
  cronJobIds?: string[];
  webhookPaths?: string[];
}

// =============================================================================
// Service Dependencies
// =============================================================================

/**
 * Dependencies required for service lifecycle operations
 */
export interface ServiceLifecycleDeps {
  /** CronService for scheduled job management */
  cronService: CronService;

  /** Plugin registry for webhook registration */
  pluginRegistry: PluginRegistry;

  /** Hook registration function (defaults to registerInternalHook) */
  registerHook?: (eventKey: string, handler: InternalHookHandler) => () => void;

  /** Hook unregistration function (defaults to unregisterInternalHook) */
  unregisterHook?: (eventKey: string, handler: InternalHookHandler) => void;

  /** Logger instance */
  logger?: typeof logger;

  /** Security manager for capability validation */
  securityManager?: ServiceSecurityManager;

  /** Global tool policy for security enforcement */
  globalToolPolicy?: ToolPolicyLike;
}

// =============================================================================
// Service Class
// =============================================================================

/**
 * Service instance representing an installed/automation service
 *
 * Manages the full lifecycle of a service including:
 * - State transitions with history tracking
 * - Runtime reference management
 * - Execution statistics
 * - Configuration management
 */
export class Service {
  // Identity
  public readonly id: string;
  public readonly manifest: ServiceManifest;

  // State
  private _state: ServiceState;
  private readonly _stateHistory: StateTransition[];

  // Timestamps
  public readonly createdAt: Date;
  private _updatedAt: Date;

  // Configuration
  private _config: ServiceConfig;

  // Runtime references
  private _runtimeRefs: ServiceRuntimeRefs;

  // Execution tracking
  private _executionStats: ServiceExecutionStats;

  // Dependencies
  private readonly deps: ServiceLifecycleDeps;

  constructor(
    manifest: ServiceManifest,
    config: ServiceConfig,
    deps: ServiceLifecycleDeps,
    initialState: ServiceState = "pending",
  ) {
    this.id = manifest.id;
    this.manifest = manifest;
    this._config = config;
    this.deps = deps;

    this._state = initialState;
    this._stateHistory = [];
    this.createdAt = new Date();
    this._updatedAt = new Date();

    this._runtimeRefs = {
      cronJobIds: [],
      webhookPaths: [],
      webhookUnregisterFns: [],
      messageSubscriptions: [],
      agentId: manifest.execution?.agentId ?? `service:${manifest.id}`,
    };

    this._executionStats = {
      totalRuns: 0,
      successfulRuns: 0,
      failedRuns: 0,
    };

    logger.info(`Service ${this.id} created in state: ${initialState}`);
  }

  // ===========================================================================
  // Getters
  // ===========================================================================

  get state(): ServiceState {
    return this._state;
  }

  get stateHistory(): readonly StateTransition[] {
    return this._stateHistory;
  }

  get updatedAt(): Date {
    return this._updatedAt;
  }

  get config(): ServiceConfig {
    return this._config;
  }

  get runtimeRefs(): ServiceRuntimeRefs {
    return this._runtimeRefs;
  }

  get executionStats(): ServiceExecutionStats {
    return this._executionStats;
  }

  get agentId(): string {
    return this._runtimeRefs.agentId;
  }

  // ===========================================================================
  // State Management
  // ===========================================================================

  /**
   * Transition to a new state with history tracking
   */
  private transitionTo(newState: ServiceState, reason?: string): void {
    const oldState = this._state;
    this._state = newState;
    this._updatedAt = new Date();

    const transition: StateTransition = {
      from: oldState,
      to: newState,
      timestamp: new Date(),
      reason,
    };

    this._stateHistory.push(transition);
    logger.info(
      `Service ${this.id} state: ${oldState} → ${newState}${reason ? ` (${reason})` : ""}`,
    );
  }

  /**
   * Validate that a state transition is allowed
   */
  private validateStateTransition(from: ServiceState, to: ServiceState): boolean {
    // Define allowed transitions
    const allowedTransitions: Record<ServiceState, ServiceState[]> = {
      pending: ["validating", "validation_error"],
      validating: ["installing", "validation_error"],
      installing: ["installed", "install_error"],
      installed: ["enabled", "disabled", "uninstalling"],
      enabled: ["disabled", "error", "uninstalling"],
      disabled: ["enabled", "uninstalling", "installed"],
      error: ["disabled"],
      validation_error: ["validating", "uninstalling"],
      install_error: ["validating", "uninstalling"],
      uninstalling: ["pending"], // After uninstall, service is removed, but we transition to pending as final state
    };

    return allowedTransitions[from]?.includes(to) ?? false;
  }

  /**
   * Set state with validation
   */
  setState(newState: ServiceState, reason?: string): void {
    if (!this.validateStateTransition(this._state, newState)) {
      throw new ServiceStateError(
        `Invalid state transition from ${this._state} to ${newState}`,
        this.id,
        this._state,
        `to ${newState}`,
      );
    }
    this.transitionTo(newState, reason);
  }

  // ===========================================================================
  // Validation
  // ===========================================================================

  /**
   * Validate the service manifest and configuration
   *
   * Phase 1 of atomic installation - no side effects
   */
  async validate(): Promise<ValidationResult> {
    this.setState("validating", "Starting validation");

    const errors: string[] = [];
    const warnings: string[] = [];

    try {
      // Validate manifest structure
      if (!this.manifest.id || typeof this.manifest.id !== "string") {
        errors.push("Service ID is required");
      }

      if (!this.manifest.name || typeof this.manifest.name !== "string") {
        errors.push("Service name is required");
      }

      if (!this.manifest.trigger || typeof this.manifest.trigger !== "object") {
        errors.push("Service trigger is required");
      }

      // Validate config against schema
      const configErrors = this.validateConfig();
      errors.push(...configErrors);

      // Validate trigger-specific requirements
      const triggerErrors = await this.validateTrigger();
      errors.push(...triggerErrors);

      // Check for required capabilities/tools (soft check - just warnings for now)
      if (this.manifest.requires.skills?.length) {
        logger.debug(
          `Service ${this.id} requires skills: ${this.manifest.requires.skills.join(", ")}`,
        );
      }

      if (this.manifest.requires.tools?.length) {
        logger.debug(
          `Service ${this.id} requires tools: ${this.manifest.requires.tools.join(", ")}`,
        );
      }

      // Validate security capabilities
      const securityManager =
        this.deps.securityManager ?? new ServiceSecurityManager({}, this.deps.globalToolPolicy);
      const securityResult = securityManager.validateCapabilities(this.manifest);

      if (!securityResult.valid) {
        for (const error of securityResult.errors) {
          errors.push(`Security: ${error.message}`);
        }
      }

      for (const warning of securityResult.warnings) {
        warnings.push(`Security: ${warning.message}`);
      }

      if (errors.length > 0) {
        this.transitionTo("validation_error", `Validation failed: ${errors.join(", ")}`);
        return { valid: false, errors, warnings };
      }

      return { valid: true, errors: [], warnings };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`Validation error: ${message}`);
      this.transitionTo("validation_error", message);
      return { valid: false, errors, warnings };
    }
  }

  /**
   * Validate user configuration against the manifest schema
   */
  private validateConfig(): string[] {
    const errors: string[] = [];
    const configSchema = this.manifest.config;

    for (const [key, fieldSchema] of Object.entries(configSchema)) {
      const value = this._config[key];

      // Check required fields
      if (fieldSchema.required && (value === undefined || value === null)) {
        errors.push(`Required config field '${key}' is missing`);
        continue;
      }

      // Skip further validation if value is not provided and not required
      if (value === undefined || value === null) {
        continue;
      }

      // Type validation
      const typeError = this.validateConfigType(key, value, fieldSchema.type);
      if (typeError) {
        errors.push(typeError);
      }

      // Enum validation for strings
      if (
        fieldSchema.type === "string" &&
        fieldSchema.enum &&
        !fieldSchema.enum.includes(value as string)
      ) {
        errors.push(`Config field '${key}' must be one of: ${fieldSchema.enum.join(", ")}`);
      }
    }

    return errors;
  }

  /**
   * Validate a config value's type
   */
  private validateConfigType(key: string, value: unknown, expectedType: string): string | null {
    const _actualType = Array.isArray(value) ? "array" : typeof value;

    switch (expectedType) {
      case "string":
      case "secret":
        return typeof value === "string" ? null : `Config field '${key}' must be a string`;
      case "number":
        return typeof value === "number" ? null : `Config field '${key}' must be a number`;
      case "boolean":
        return typeof value === "boolean" ? null : `Config field '${key}' must be a boolean`;
      case "array":
        return Array.isArray(value) ? null : `Config field '${key}' must be an array`;
      case "object":
        return typeof value === "object" && value !== null && !Array.isArray(value)
          ? null
          : `Config field '${key}' must be an object`;
      default:
        return null;
    }
  }

  /**
   * Validate trigger-specific requirements
   */
  private async validateTrigger(): Promise<string[]> {
    const errors: string[] = [];
    const trigger = this.manifest.trigger;

    switch (trigger.type) {
      case "cron": {
        const cronTrigger = trigger;
        // Validate cron expression format (basic check)
        if (!cronTrigger.schedule || cronTrigger.schedule.length < 3) {
          errors.push("Cron schedule is required and must be a valid cron expression");
        }
        break;
      }
      case "webhook": {
        const webhookTrigger = trigger;
        if (!webhookTrigger.path || !webhookTrigger.path.startsWith("/")) {
          errors.push("Webhook path must start with /");
        }
        break;
      }
      case "message": {
        const messageTrigger = trigger;
        if (!messageTrigger.channels?.length) {
          errors.push("Message trigger must specify at least one channel");
        }
        break;
      }
      case "web":
        // Web triggers are always valid (just a path)
        break;
      default:
        errors.push(`Unknown trigger type: ${(trigger as { type: string }).type}`);
    }

    return errors;
  }

  // ===========================================================================
  // Installation
  // ===========================================================================

  /**
   * Install the service
   *
   * Performs atomic 4-phase installation:
   * 1. Validation (no side effects)
   * 2. Preparation (reversible)
   * 3. Resource Creation (tracked for rollback)
   * 4. Commit
   *
   * On failure, automatically rolls back all created resources.
   */
  async install(): Promise<InstallResult> {
    const rollbackStack: RollbackAction[] = [];

    try {
      // Phase 1: Validation
      const validation = await this.validate();
      if (!validation.valid) {
        throw new ServiceValidationError(
          `Service validation failed: ${validation.errors.join(", ")}`,
          this.id,
          validation.errors,
        );
      }

      // Phase 2: Preparation
      this.setState("installing", "Starting installation");
      await this.prepareInstallation();

      // Phase 3: Resource Creation
      const trigger = this.manifest.trigger;

      switch (trigger.type) {
        case "cron":
          await this.installCronTrigger(rollbackStack);
          break;
        case "webhook":
          await this.installWebhookTrigger(rollbackStack);
          break;
        case "message":
          await this.installMessageTrigger(rollbackStack);
          break;
        case "web":
          // Web UI triggers don't need special installation
          logger.debug(`Service ${this.id} uses web UI trigger - no runtime installation needed`);
          break;
      }

      // Phase 4: Commit
      this.setState("installed", "Installation completed successfully");

      return {
        success: true,
        agentId: this._runtimeRefs.agentId,
        cronJobIds: this._runtimeRefs.cronJobIds,
        webhookPaths: this._runtimeRefs.webhookPaths,
      };
    } catch (error) {
      // Rollback on failure
      await this.rollback(rollbackStack, error as Error);

      if (error instanceof ServiceError) {
        throw error;
      }

      throw new ServiceInstallError(
        `Installation failed: ${error instanceof Error ? error.message : String(error)}`,
        this.id,
        "create_resources",
        error instanceof Error ? error : undefined,
      );
    }
  }

  /**
   * Phase 2: Preparation - create agent session, validate permissions
   */
  private async prepareInstallation(): Promise<void> {
    logger.debug(`Service ${this.id}: Preparing installation`);

    // Generate agent ID if not specified
    if (!this._runtimeRefs.agentId) {
      this._runtimeRefs.agentId = `service:${this.id}`;
    }

    // Additional preparation could include:
    // - Creating agent session
    // - Validating tool permissions
    // - Loading service skill

    logger.debug(`Service ${this.id}: Preparation complete, agentId=${this._runtimeRefs.agentId}`);
  }

  private async installCronTrigger(rollbackStack: RollbackAction[]): Promise<void> {
    const trigger = createServiceCronTrigger({
      serviceId: this.id,
      manifest: this.manifest,
      cronService: this.deps.cronService,
    });

    const result = await trigger.create(this._runtimeRefs.agentId);
    if (!result.success) {
      throw new ServiceInstallError(
        `Failed to create cron job: ${result.error}`,
        this.id,
        "create_resources",
      );
    }

    this._runtimeRefs.cronJobIds.push(result.jobId!);
    this._runtimeRefs.cronTrigger = trigger;

    rollbackStack.push(async () => {
      logger.debug(`Service ${this.id}: Rolling back cron trigger`);
      await trigger.remove();
    });
  }

  /**
   * Install webhook trigger - registers with HTTP registry
   */
  private async installWebhookTrigger(rollbackStack: RollbackAction[]): Promise<void> {
    const trigger = this.manifest.trigger as WebhookTrigger;
    const path = trigger.path.replace("{serviceId}", this.id);

    const handler: PluginHttpRouteHandler = async (req, res) => {
      // Validate auth if configured
      if (trigger.auth?.type !== "none" && trigger.auth?.type !== undefined) {
        const valid = await this.validateWebhookAuth(req, trigger.auth);
        if (!valid) {
          res.writeHead(401);
          res.end(JSON.stringify({ error: "Unauthorized" }));
          return true;
        }
      }

      // Parse payload
      let _payload: unknown;
      try {
        const chunks: Buffer[] = [];
        for await (const chunk of req) {
          chunks.push(chunk);
        }
        const body = Buffer.concat(chunks).toString();
        _payload = body ? JSON.parse(body) : {};
      } catch {
        _payload = {};
      }

      // Execute service (if enabled)
      if (this._state !== "enabled") {
        res.writeHead(503);
        res.end(JSON.stringify({ error: "Service is not enabled" }));
        return true;
      }

      // Update stats
      this._executionStats.totalRuns++;

      // Respond with success
      res.writeHead(200);
      res.end(
        JSON.stringify({
          success: true,
          serviceId: this.id,
          triggerType: "webhook",
          timestamp: new Date().toISOString(),
        }),
      );

      return true;
    };

    try {
      const unregister = registerPluginHttpRoute({
        path,
        handler,
        auth: trigger.auth?.type === "none" || trigger.auth?.type === undefined ? "none" : "token",
        pluginId: `service:${this.id}`,
        source: "service-trigger",
        registry: this.deps.pluginRegistry,
      });

      this._runtimeRefs.webhookPaths.push(path);
      this._runtimeRefs.webhookUnregisterFns.push(unregister);

      // Add rollback action
      rollbackStack.push(async () => {
        logger.debug(`Service ${this.id}: Rolling back webhook ${path}`);
        unregister();
      });

      logger.info(`Service ${this.id}: Registered webhook at ${path}`);
    } catch (error) {
      throw new ServiceInstallError(
        `Failed to register webhook: ${error instanceof Error ? error.message : String(error)}`,
        this.id,
        "create_resources",
        error instanceof Error ? error : undefined,
      );
    }
  }

  /**
   * Validate webhook authentication
   */
  private async validateWebhookAuth(
    _req: import("http").IncomingMessage,
    _auth: WebhookTrigger["auth"],
  ): Promise<boolean> {
    // TODO: Implement actual webhook auth validation
    // This is a placeholder - real implementation would check:
    // - Token-based auth
    // - HMAC signatures
    // - Custom signature schemes
    return true;
  }

  /**
   * Install message trigger - subscribe to message hooks
   */
  private async installMessageTrigger(rollbackStack: RollbackAction[]): Promise<void> {
    const trigger = this.manifest.trigger as MessageTrigger;
    const registerHook = this.deps.registerHook ?? registerInternalHook;

    for (const channelType of trigger.channels) {
      const handler: InternalHookHandler = async (event) => {
        // Only process if service is enabled
        if (this._state !== "enabled") {
          return;
        }

        const context = event.context as MessageReceivedHookContext;

        // Check if message matches filters
        if (!this.matchesMessageFilters(context, trigger.filters)) {
          return;
        }

        // Update stats
        this._executionStats.totalRuns++;

        logger.debug(`Service ${this.id}: Message trigger fired on ${channelType}`);
      };

      try {
        const eventKey = `message:received:${channelType}`;
        const unsubscribe = registerHook(eventKey, handler);

        this._runtimeRefs.messageSubscriptions.push({
          channel: channelType,
          unsubscribe,
        });

        // Add rollback action
        rollbackStack.push(async () => {
          logger.debug(`Service ${this.id}: Rolling back message subscription for ${channelType}`);
          unsubscribe();
        });

        logger.info(`Service ${this.id}: Subscribed to messages on ${channelType}`);
      } catch (error) {
        throw new ServiceInstallError(
          `Failed to subscribe to messages: ${error instanceof Error ? error.message : String(error)}`,
          this.id,
          "create_resources",
          error instanceof Error ? error : undefined,
        );
      }
    }
  }

  /**
   * Check if a message matches the trigger filters
   */
  private matchesMessageFilters(
    context: MessageReceivedHookContext,
    filters?: MessageTrigger["filters"],
  ): boolean {
    if (!filters) {
      return true;
    }

    // Check keywords
    if (filters.keywords?.length) {
      const content = context.content.toLowerCase();
      const hasKeyword = filters.keywords.some((kw) => content.includes(kw.toLowerCase()));
      if (!hasKeyword) {
        return false;
      }
    }

    // Check patterns (regex)
    if (filters.patterns?.length) {
      const hasMatch = filters.patterns.some((pattern) => {
        try {
          const regex = new RegExp(pattern);
          return regex.test(context.content);
        } catch {
          return false;
        }
      });
      if (!hasMatch) {
        return false;
      }
    }

    // Check fromUsers
    if (filters.fromUsers?.length) {
      if (!filters.fromUsers.includes(context.from)) {
        return false;
      }
    }

    // Check attachments
    if (filters.hasAttachments) {
      // TODO: Check if message has attachments
      // This would require additional context from the hook system
    }

    return true;
  }

  /**
   * Rollback installation on failure
   */
  private async rollback(rollbackStack: RollbackAction[], error: Error): Promise<void> {
    logger.error(`Service ${this.id}: Installation failed, rolling back...`, error);

    // Execute rollback actions in reverse order
    while (rollbackStack.length > 0) {
      const action = rollbackStack.pop();
      if (action) {
        try {
          await action();
        } catch (rollbackError) {
          // Log rollback errors but continue with other rollbacks
          logger.error(`Service ${this.id}: Rollback action failed`, rollbackError);
        }
      }
    }

    // Clear runtime refs
    this._runtimeRefs = {
      cronJobIds: [],
      webhookPaths: [],
      webhookUnregisterFns: [],
      messageSubscriptions: [],
      agentId: this._runtimeRefs.agentId,
    };

    this.transitionTo("install_error", `Installation failed: ${error.message}`);
  }

  // ===========================================================================
  // Enable/Disable
  // ===========================================================================

  /**
   * Enable the service (start processing triggers)
   */
  async enable(): Promise<void> {
    if (this._state !== "installed" && this._state !== "disabled") {
      throw new ServiceStateError(
        `Cannot enable service from state ${this._state}`,
        this.id,
        this._state,
        "enable",
      );
    }

    if (this._runtimeRefs.cronTrigger) {
      await this._runtimeRefs.cronTrigger.enable();
    }

    this.setState("enabled", "Service enabled by user");
    logger.info(`Service ${this.id} is now enabled and processing triggers`);
  }

  async disable(): Promise<void> {
    if (this._state !== "enabled") {
      throw new ServiceStateError(
        `Cannot disable service from state ${this._state}`,
        this.id,
        this._state,
        "disable",
      );
    }

    if (this._runtimeRefs.cronTrigger) {
      await this._runtimeRefs.cronTrigger.disable();
    }

    this.setState("disabled", "Service disabled by user");
    logger.info(`Service ${this.id} is now disabled`);
  }

  // ===========================================================================
  // Uninstall
  // ===========================================================================

  /**
   * Uninstall the service and clean up all resources
   */
  async uninstall(): Promise<void> {
    const previousState = this._state;
    this.setState("uninstalling", "Starting uninstallation");

    try {
      if (this._runtimeRefs.cronTrigger) {
        await this._runtimeRefs.cronTrigger.remove();
      } else {
        for (const jobId of this._runtimeRefs.cronJobIds) {
          try {
            await this.deps.cronService.remove(jobId);
            logger.debug(`Service ${this.id}: Removed cron job ${jobId}`);
          } catch (error) {
            logger.error(`Service ${this.id}: Failed to remove cron job ${jobId}`, error);
          }
        }
      }

      // Unregister webhooks
      for (const unregister of this._runtimeRefs.webhookUnregisterFns) {
        try {
          unregister();
          logger.debug(`Service ${this.id}: Unregistered webhook`);
        } catch (error) {
          logger.error(`Service ${this.id}: Failed to unregister webhook`, error);
        }
      }

      // Unsubscribe from messages
      for (const sub of this._runtimeRefs.messageSubscriptions) {
        try {
          sub.unsubscribe();
          logger.debug(`Service ${this.id}: Unsubscribed from ${sub.channel}`);
        } catch (error) {
          logger.error(`Service ${this.id}: Failed to unsubscribe from ${sub.channel}`, error);
        }
      }

      // Clear runtime refs
      this._runtimeRefs = {
        cronJobIds: [],
        webhookPaths: [],
        webhookUnregisterFns: [],
        messageSubscriptions: [],
        agentId: this._runtimeRefs.agentId,
      };

      // Final state transition (service will be removed from registry)
      this.transitionTo("pending", `Uninstalled from ${previousState}`);

      logger.info(`Service ${this.id} uninstalled successfully`);
    } catch (error) {
      logger.error(`Service ${this.id}: Uninstallation failed`, error);
      throw new ServiceError(
        `Uninstall failed: ${error instanceof Error ? error.message : String(error)}`,
        this.id,
        error instanceof Error ? error : undefined,
      );
    }
  }

  // ===========================================================================
  // Execution
  // ===========================================================================

  /**
   * Record a successful execution
   */
  recordSuccess(): void {
    this._executionStats.successfulRuns++;
    this._executionStats.lastRunAt = new Date();
    this._updatedAt = new Date();
  }

  /**
   * Record a failed execution
   */
  recordFailure(error: Error): void {
    this._executionStats.failedRuns++;
    this._executionStats.lastError = {
      message: error.message,
      timestamp: new Date(),
      stack: error.stack,
    };
    this._updatedAt = new Date();

    // Transition to error state
    this.transitionTo("error", `Execution failed: ${error.message}`);
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig: ServiceConfig): void {
    this._config = { ...this._config, ...newConfig };
    this._updatedAt = new Date();
    logger.debug(`Service ${this.id}: Configuration updated`);
  }

  /**
   * Serialize service state for persistence
   */
  toJSON(): {
    id: string;
    manifest: ServiceManifest;
    state: ServiceState;
    stateHistory: StateTransition[];
    createdAt: string;
    updatedAt: string;
    config: ServiceConfig;
    runtimeRefs: Omit<ServiceRuntimeRefs, "webhookUnregisterFns" | "messageSubscriptions">;
    executionStats: ServiceExecutionStats;
  } {
    return {
      id: this.id,
      manifest: this.manifest,
      state: this._state,
      stateHistory: this._stateHistory,
      createdAt: this.createdAt.toISOString(),
      updatedAt: this._updatedAt.toISOString(),
      config: this._config,
      runtimeRefs: {
        cronJobIds: this._runtimeRefs.cronJobIds,
        webhookPaths: this._runtimeRefs.webhookPaths,
        agentId: this._runtimeRefs.agentId,
        sessionKey: this._runtimeRefs.sessionKey,
      },
      executionStats: this._executionStats,
    };
  }
}

// =============================================================================
// ServiceInstaller - High-level installation coordinator
// =============================================================================

/**
 * ServiceInstaller coordinates atomic installation of services
 *
 * Provides a higher-level API for installing services with full
 * rollback support and phase tracking.
 */
export class ServiceInstaller {
  private currentPhase: InstallationPhase = "validate";
  private rollbackStack: RollbackAction[] = [];

  constructor(
    private readonly deps: ServiceLifecycleDeps,
    private readonly logger = createSubsystemLogger("services:installer"),
  ) {}

  /**
   * Install a service atomically with automatic rollback on failure
   */
  async install(manifest: ServiceManifest, config: ServiceConfig): Promise<Service> {
    const service = new Service(manifest, config, this.deps);

    try {
      // Phase 1: Validation
      this.currentPhase = "validate";
      const validation = await service.validate();
      if (!validation.valid) {
        throw new ServiceValidationError(
          `Validation failed: ${validation.errors.join(", ")}`,
          manifest.id,
          validation.errors,
        );
      }

      // Phase 2-4: Installation (handled by Service.install)
      this.currentPhase = "prepare";
      await service.install();

      this.logger.info(`Service ${manifest.id} installed successfully`);
      return service;
    } catch (error) {
      // Rollback is handled within Service.install, but we do additional cleanup here if needed
      this.logger.error(`Service ${manifest.id} installation failed`, error);
      throw error;
    }
  }

  /**
   * Get current installation phase
   */
  getCurrentPhase(): InstallationPhase {
    return this.currentPhase;
  }
}

// Export types for consumers
export type {
  ServiceManifest,
  ServiceConfig,
  ServiceExecutionConfig,
  CronTrigger,
  WebhookTrigger,
  MessageTrigger,
} from "./schema.js";
