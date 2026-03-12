/**
 * Service Communication Protocol (SCP) Type Definitions
 *
 * Types for communication between OpenClaw Agent and Services
 */

// ============================================================================
// Base Types
// ============================================================================

/** Unique identifier for a service instance */
export type ServiceId = string;

/** Unique identifier for a request/response pair */
export type RequestId = string;

/** Timestamp in ISO 8601 format */
export type Timestamp = string;

/** Error codes for SCP protocol
 *
 * 1000-1999: Protocol errors
 * 2000-2999: Service errors
 * 3000-3999: Agent errors
 * 4000-4999: System errors
 */
export type ErrorCode = number;

// ============================================================================
// Message Discriminators
// ============================================================================

/** Service-to-Agent message types */
export type ServiceMessageType =
  | "service.started"
  | "service.stopped"
  | "service.event"
  | "service.action";

/** Agent-to-Service message types */
export type AgentMessageType = "agent.response" | "agent.stop-request";

/** All SCP message types */
export type SCPMessageType = ServiceMessageType | AgentMessageType;

// ============================================================================
// Error Type
// ============================================================================

/**
 * SCP Error structure
 */
export interface SCPError {
  /** Error code following SCP conventions */
  code: ErrorCode;
  /** Human-readable error message */
  message: string;
  /** Additional error details */
  details?: Record<string, unknown>;
}

// ============================================================================
// Base Message Interface
// ============================================================================

/**
 * Base interface for all SCP messages
 */
export interface SCPMessageBase {
  /** Message type discriminator */
  type: SCPMessageType;
  /** Service identifier */
  serviceId: ServiceId;
  /** Request ID for correlation */
  requestId: RequestId;
  /** Message timestamp */
  timestamp: Timestamp;
}

// ============================================================================
// Service-to-Agent Messages
// ============================================================================

/**
 * Service has started and is ready to receive commands
 */
export interface ServiceStartedMessage extends SCPMessageBase {
  type: "service.started";
  payload: {
    /** Service name */
    name: string;
    /** Service version */
    version: string;
    /** Available actions the service can perform */
    actions?: string[];
    /** Service metadata */
    metadata?: Record<string, unknown>;
  };
}

/**
 * Service has stopped or disconnected
 */
export interface ServiceStoppedMessage extends SCPMessageBase {
  type: "service.stopped";
  payload: {
    /** Reason for stopping */
    reason: "shutdown" | "error" | "disconnected" | "killed";
    /** Exit code or error code if applicable */
    exitCode?: number;
    /** Error details if stopped due to error */
    error?: SCPError;
  };
}

/**
 * Service is emitting an event
 */
export interface ServiceEventMessage extends SCPMessageBase {
  type: "service.event";
  payload: {
    /** Event name */
    event: string;
    /** Event data */
    data: unknown;
  };
}

/**
 * Service is requesting an action from the Agent
 */
export interface ServiceActionMessage extends SCPMessageBase {
  type: "service.action";
  payload: {
    /** Action to perform */
    action: string;
    /** Action parameters */
    params: unknown;
    /** Timeout in milliseconds */
    timeout?: number;
  };
}

// ============================================================================
// Agent-to-Service Messages
// ============================================================================

/**
 * Agent response to a service action request
 */
export interface AgentResponseMessage extends SCPMessageBase {
  type: "agent.response";
  payload: {
    /** Whether the action was successful */
    success: boolean;
    /** Response data on success */
    data?: unknown;
    /** Error details on failure */
    error?: SCPError;
  };
}

/**
 * Agent is requesting the service to stop
 */
export interface AgentStopRequestMessage extends SCPMessageBase {
  type: "agent.stop-request";
  payload: {
    /** Reason for stopping */
    reason: string;
    /** Whether to force stop (kill) */
    force?: boolean;
  };
}

// ============================================================================
// Union Types
// ============================================================================

/** All service-to-agent messages */
export type ServiceMessage =
  | ServiceStartedMessage
  | ServiceStoppedMessage
  | ServiceEventMessage
  | ServiceActionMessage;

/** All agent-to-service messages */
export type AgentMessage = AgentResponseMessage | AgentStopRequestMessage;

/** All SCP messages */
export type SCPMessage = ServiceMessage | AgentMessage;

// ============================================================================
// Service Client Interface
// ============================================================================

/**
 * Event handler function type
 */
export type EventHandler<T = unknown> = (data: T) => void | Promise<void>;

/**
 * Interface for a Service Client that communicates with the OpenClaw Agent
 */
export interface ServiceClient {
  /**
   * Connect to the Agent
   * @param url - WebSocket URL or connection endpoint
   * @param serviceId - Unique identifier for this service
   */
  connect(url: string, serviceId: ServiceId): Promise<void>;

  /**
   * Disconnect from the Agent
   */
  disconnect(): void;

  /**
   * Emit an event to the Agent
   * @param event - Event name
   * @param payload - Event payload data
   */
  emit(event: string, payload: unknown): void;

  /**
   * Call an action on the Agent
   * @param action - Action name
   * @param params - Action parameters
   * @returns Promise resolving to the action result
   */
  callAction(action: string, params: unknown): Promise<unknown>;

  /**
   * Register an event handler
   * @param event - Event name to listen for
   * @param handler - Handler function
   */
  on(event: string, handler: EventHandler): void;

  /**
   * Remove an event handler
   * @param event - Event name
   * @param handler - Handler function to remove (if not provided, removes all handlers)
   */
  off(event: string, handler?: EventHandler): void;
}

// ============================================================================
// Agent API Interface
// ============================================================================

/**
 * Tool call parameters
 */
export interface ToolCallParams {
  /** Tool name */
  tool: string;
  /** Tool parameters */
  params: Record<string, unknown>;
}

/**
 * Tool call result
 */
export interface ToolCallResult<T = unknown> {
  /** Whether the call was successful */
  success: boolean;
  /** Result data on success */
  data?: T;
  /** Error details on failure */
  error?: SCPError;
}

/**
 * Interface for Agent tool API
 * Services use this to call OpenClaw tools/functions
 */
export interface AgentAPI {
  /**
   * Call a tool/function on the Agent
   * @param params - Tool call parameters
   * @returns Promise resolving to the tool result
   */
  callTool<T = unknown>(params: ToolCallParams): Promise<ToolCallResult<T>>;

  /**
   * Get available tools from the Agent
   * @returns Promise resolving to list of available tool names
   */
  getAvailableTools(): Promise<string[]>;

  /**
   * Get tool schema/information
   * @param toolName - Name of the tool
   * @returns Promise resolving to tool metadata
   */
  getToolInfo(toolName: string): Promise<{
    name: string;
    description: string;
    parameters: unknown;
  }>;

  /**
   * Send a message to the Agent
   * @param content - Message content
   * @param options - Additional options
   * @returns Promise resolving when message is sent
   */
  sendMessage(
    content: string,
    options?: {
      channel?: string;
      threadId?: string;
    },
  ): Promise<void>;

  /**
   * Log a message through the Agent
   * @param level - Log level
   * @param message - Log message
   * @param meta - Additional metadata
   */
  log(
    level: "debug" | "info" | "warn" | "error",
    message: string,
    meta?: Record<string, unknown>,
  ): void;
}

// ============================================================================
// Service Configuration Types
// ============================================================================

/**
 * Service configuration options
 */
export interface ServiceConfig {
  /** Service name */
  name: string;
  /** Service version */
  version: string;
  /** Service description */
  description?: string;
  /** Agent connection URL */
  agentUrl: string;
  /** Reconnect options */
  reconnect?: {
    /** Whether to auto-reconnect */
    enabled: boolean;
    /** Maximum retry attempts (0 = infinite) */
    maxRetries: number;
    /** Delay between retries in ms */
    retryDelay: number;
  };
  /** Heartbeat options */
  heartbeat?: {
    /** Whether to send heartbeats */
    enabled: boolean;
    /** Interval in ms */
    interval: number;
  };
}
