/**
 * Agent Integration for SCP Services
 *
 * Handles SCP messages from services and invokes OpenClaw tools.
 * Bridges the Service Communication Protocol with OpenClaw's tool system.
 */

import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import type {
  AgentResponseMessage,
  SCPError,
  ServiceActionMessage,
  ServiceEventMessage,
  ServiceStartedMessage,
  ServiceStoppedMessage,
} from "../../packages/service-sdk/src/types.js";
import { loadConfig } from "../config/config.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import type { ServiceConnection } from "./scp-server.js";
import { SCPErrorCodes } from "./scp-server.js";

// ============================================================================
// Type Definitions
// ============================================================================

/** Custom action handler function type */
export type ActionHandler = (
  serviceId: string,
  params: unknown,
  connection: ServiceConnection,
) => Promise<unknown>;

/** Tool invocation function type */
export type ToolInvoker = (
  toolName: string,
  params: Record<string, unknown>,
) => Promise<AgentToolResult<unknown>>;

/** Message sender function type */
export type MessageSender = (
  content: string,
  options?: { channel?: string; threadId?: string },
) => Promise<void>;

/** Configuration reader function type */
export type ConfigReader = (key: string) => unknown;

/** Integration options */
export interface AgentIntegrationOptions {
  /** Logger instance */
  logger?: ReturnType<typeof createSubsystemLogger>;
  /** Tool invoker for executing OpenClaw tools */
  toolInvoker?: ToolInvoker;
  /** Message sender for sending messages to channels */
  messageSender?: MessageSender;
  /** Config reader for reading OpenClaw configuration */
  configReader?: ConfigReader;
}

/** Agent integration interface */
export interface AgentIntegration {
  /** Handle service.action messages */
  handleServiceAction(
    message: ServiceActionMessage,
    connection: ServiceConnection,
  ): Promise<AgentResponseMessage>;

  /** Handle service.started messages */
  handleServiceStarted(
    message: ServiceStartedMessage,
    connection: ServiceConnection,
  ): Promise<AgentResponseMessage>;

  /** Handle service.stopped messages */
  handleServiceStopped(
    message: ServiceStoppedMessage,
    connection: ServiceConnection,
  ): Promise<AgentResponseMessage>;

  /** Handle service.event messages */
  handleServiceEvent(message: ServiceEventMessage, connection: ServiceConnection): Promise<void>;

  /** Register a custom action handler */
  registerActionHandler(action: string, handler: ActionHandler): void;

  /** Unregister a custom action handler */
  unregisterActionHandler(action: string): void;

  /** Get registered action handlers */
  getRegisteredActions(): string[];
}

// ============================================================================
// Response Helpers
// ============================================================================

function createSuccessResponse(
  serviceId: string,
  requestId: string,
  data?: unknown,
): AgentResponseMessage {
  return {
    type: "agent.response",
    serviceId,
    requestId,
    timestamp: new Date().toISOString(),
    payload: {
      success: true,
      data,
    },
  };
}

function createErrorResponse(
  serviceId: string,
  requestId: string,
  error: SCPError,
): AgentResponseMessage {
  return {
    type: "agent.response",
    serviceId,
    requestId,
    timestamp: new Date().toISOString(),
    payload: {
      success: false,
      error,
    },
  };
}

function createSCPError(
  code: number,
  message: string,
  details?: Record<string, unknown>,
): SCPError {
  return { code, message, details };
}

// ============================================================================
// Built-in Action Handlers
// ============================================================================

/** Built-in action: create-task */
async function handleCreateTask(
  _serviceId: string,
  params: unknown,
  toolInvoker?: ToolInvoker,
): Promise<unknown> {
  if (!toolInvoker) {
    throw new Error("Tool invoker not configured");
  }

  const taskParams = params as Record<string, unknown>;
  const title = String(taskParams.title ?? "Untitled Task");
  const description = String(taskParams.description ?? "");

  // Create task using the task tool if available
  const result = await toolInvoker("task_create", {
    title,
    description,
    ...taskParams,
  });

  return {
    taskId: `task-${Date.now()}`,
    title,
    status: "created",
    result,
  };
}

/** Built-in action: send-message */
async function handleSendMessage(
  _serviceId: string,
  params: unknown,
  _toolInvoker: ToolInvoker | undefined,
  messageSender?: MessageSender,
): Promise<unknown> {
  if (!messageSender) {
    throw new Error("Message sender not configured");
  }

  const messageParams = params as Record<string, unknown>;
  const content = String(messageParams.content ?? "");
  const channel = messageParams.channel ? String(messageParams.channel) : undefined;
  const threadId = messageParams.threadId ? String(messageParams.threadId) : undefined;

  if (!content) {
    throw new Error("Message content is required");
  }

  await messageSender(content, { channel, threadId });

  return {
    sent: true,
    channel,
    timestamp: new Date().toISOString(),
  };
}

/** Built-in action: get-config */
async function handleGetConfig(
  _serviceId: string,
  params: unknown,
  _toolInvoker: ToolInvoker | undefined,
  _messageSender: MessageSender | undefined,
  configReader?: ConfigReader,
): Promise<unknown> {
  const configParams = params as Record<string, unknown>;
  const key = String(configParams.key ?? "");

  if (!key) {
    throw new Error("Config key is required");
  }

  // Use provided config reader or fall back to loadConfig
  let value: unknown;
  if (configReader) {
    value = configReader(key);
  } else {
    const config = loadConfig();
    value = key.split(".").reduce((obj: unknown, k: string) => {
      if (obj && typeof obj === "object" && k in obj) {
        return (obj as Record<string, unknown>)[k];
      }
      return undefined;
    }, config as unknown);
  }

  return {
    key,
    value,
    exists: value !== undefined,
  };
}

/** Built-in action: log */
async function handleLog(
  serviceId: string,
  params: unknown,
  logger: ReturnType<typeof createSubsystemLogger>,
): Promise<unknown> {
  const logParams = params as Record<string, unknown>;
  const level = String(logParams.level ?? "info") as "debug" | "info" | "warn" | "error";
  const message = String(logParams.message ?? "");
  const meta = (logParams.meta as Record<string, unknown>) ?? {};

  if (!message) {
    throw new Error("Log message is required");
  }

  // Validate log level
  const validLevels = ["debug", "info", "warn", "error"];
  if (!validLevels.includes(level)) {
    throw new Error(`Invalid log level: ${level}. Must be one of: ${validLevels.join(", ")}`);
  }

  logger[level](`[Service ${serviceId}] ${message}`, meta as Record<string, unknown> | undefined);

  return {
    logged: true,
    level,
    timestamp: new Date().toISOString(),
  };
}

// ============================================================================
// Agent Integration Implementation
// ============================================================================

export function createAgentIntegration(options: AgentIntegrationOptions = {}): AgentIntegration {
  const logger = options.logger ?? createSubsystemLogger("services:agent-integration");
  const customHandlers = new Map<string, ActionHandler>();

  // Store references for built-in handlers
  const toolInvoker = options.toolInvoker;
  const messageSender = options.messageSender;
  const configReader = options.configReader;

  /**
   * Handle service.action messages
   * Routes action requests to appropriate handlers (built-in or custom)
   */
  async function handleServiceAction(
    message: ServiceActionMessage,
    connection: ServiceConnection,
  ): Promise<AgentResponseMessage> {
    const { serviceId, requestId, payload } = message;
    const { action, params } = payload;

    logger.debug(`Handling action '${action}' from service ${serviceId}`);

    try {
      let result: unknown;

      // Check for custom handler first
      const customHandler = customHandlers.get(action);
      if (customHandler) {
        logger.debug(`Using custom handler for action '${action}'`);
        result = await customHandler(serviceId, params, connection);
      } else {
        // Use built-in handlers
        switch (action) {
          case "create-task": {
            result = await handleCreateTask(serviceId, params, toolInvoker);
            break;
          }

          case "send-message": {
            result = await handleSendMessage(serviceId, params, toolInvoker, messageSender);
            break;
          }

          case "get-config": {
            result = await handleGetConfig(
              serviceId,
              params,
              toolInvoker,
              messageSender,
              configReader,
            );
            break;
          }

          case "log": {
            result = await handleLog(serviceId, params, logger);
            break;
          }

          default: {
            const error = createSCPError(
              SCPErrorCodes.ACTION_NOT_FOUND,
              `Unknown action: ${action}`,
              { availableActions: getRegisteredActions() },
            );
            return createErrorResponse(serviceId, requestId, error);
          }
        }
      }

      logger.debug(`Action '${action}' completed successfully for service ${serviceId}`);
      return createSuccessResponse(serviceId, requestId, result);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      logger.error(`Action '${action}' failed for service ${serviceId}: ${errorMessage}`);

      const error = createSCPError(SCPErrorCodes.ACTION_FAILED, errorMessage, { action, params });
      return createErrorResponse(serviceId, requestId, error);
    }
  }

  /**
   * Handle service.started messages
   * Logs service startup and updates connection metadata
   */
  async function handleServiceStarted(
    message: ServiceStartedMessage,
    connection: ServiceConnection,
  ): Promise<AgentResponseMessage> {
    const { serviceId, requestId, payload } = message;
    const { name, version, actions, metadata } = payload;

    // Update connection metadata
    connection.metadata = {
      name,
      version,
      actions,
    };

    logger.info(
      `Service ${serviceId} started: ${name} v${version}${actions ? ` (actions: ${actions.join(", ")})` : ""}`,
    );

    if (metadata) {
      logger.debug(`Service ${serviceId} metadata:`, metadata);
    }

    return createSuccessResponse(serviceId, requestId, {
      acknowledged: true,
      agentTime: new Date().toISOString(),
    });
  }

  /**
   * Handle service.stopped messages
   * Logs service shutdown
   */
  async function handleServiceStopped(
    message: ServiceStoppedMessage,
    _connection: ServiceConnection,
  ): Promise<AgentResponseMessage> {
    const { serviceId, requestId, payload } = message;
    const { reason, exitCode, error: errorInfo } = payload;

    if (errorInfo) {
      logger.error(
        `Service ${serviceId} stopped with error (reason: ${reason}, exitCode: ${exitCode}): ${errorInfo.message}`,
        errorInfo.details,
      );
    } else {
      logger.info(`Service ${serviceId} stopped (reason: ${reason}, exitCode: ${exitCode})`);
    }

    return createSuccessResponse(serviceId, requestId, {
      acknowledged: true,
    });
  }

  /**
   * Handle service.event messages
   * Processes events from services (fire-and-forget, no response needed)
   */
  async function handleServiceEvent(
    message: ServiceEventMessage,
    _connection: ServiceConnection,
  ): Promise<void> {
    const { serviceId, payload } = message;
    const { event, data } = payload;

    logger.debug(
      `Service ${serviceId} event: ${event}`,
      data as Record<string, unknown> | undefined,
    );

    // Events are fire-and-forget - no response required
    // This is where event processing logic would go (e.g., forwarding to hooks, triggers)
  }

  /**
   * Register a custom action handler
   */
  function registerActionHandler(action: string, handler: ActionHandler): void {
    if (typeof action !== "string" || action.trim().length === 0) {
      throw new Error("Action name must be a non-empty string");
    }
    if (typeof handler !== "function") {
      throw new Error("Handler must be a function");
    }

    logger.debug(`Registering custom handler for action: ${action}`);
    customHandlers.set(action, handler);
  }

  /**
   * Unregister a custom action handler
   */
  function unregisterActionHandler(action: string): void {
    if (customHandlers.has(action)) {
      logger.debug(`Unregistering custom handler for action: ${action}`);
      customHandlers.delete(action);
    }
  }

  /**
   * Get list of registered custom action names
   */
  function getRegisteredActions(): string[] {
    return Array.from(customHandlers.keys());
  }

  return {
    handleServiceAction,
    handleServiceStarted,
    handleServiceStopped,
    handleServiceEvent,
    registerActionHandler,
    unregisterActionHandler,
    getRegisteredActions,
  };
}

export default createAgentIntegration;
