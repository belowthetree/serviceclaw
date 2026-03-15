import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { WebSocket } from "ws";
import { z } from "zod";
import type { ServiceId, SCPError, SCPMessage } from "../../packages/service-sdk/src/types.js";
import type { createSubsystemLogger } from "../logging/subsystem.js";

export const SCPErrorCodes = {
  CONNECTION_FAILED: 1000,
  CONNECTION_TIMEOUT: 1001,
  INVALID_MESSAGE: 1002,
  UNKNOWN_MESSAGE_TYPE: 1003,
  MISSING_REQUIRED_FIELD: 1004,
  INVALID_FIELD_TYPE: 1005,
  SERVICE_ID_MISMATCH: 1006,
  REQUEST_ID_MISSING: 1007,
  SERVICE_NOT_FOUND: 2000,
  SERVICE_START_FAILED: 2002,
  SERVICE_RUNTIME_ERROR: 2003,
  ACTION_NOT_FOUND: 3000,
  ACTION_FAILED: 3001,
  INVALID_PARAMS: 3002,
  PERMISSION_DENIED: 3003,
  TIMEOUT: 3004,
  AGENT_BUSY: 3005,
  RATE_LIMITED: 3006,
  PROCESS_SPAWN_FAILED: 4000,
  INTERNAL_ERROR: 4004,
} as const;

const SCPMessageBaseSchema = z.object({
  type: z.string(),
  serviceId: z.string().min(1, "serviceId is required"),
  requestId: z.string().min(1, "requestId is required"),
  timestamp: z.string().datetime(),
});

const ServiceStartedPayloadSchema = z.object({
  name: z.string(),
  version: z.string(),
  actions: z.array(z.string()).optional(),
  metadata: z.object({}).catchall(z.unknown()).optional(),
});

const ServiceStoppedPayloadSchema = z.object({
  reason: z.enum(["shutdown", "error", "disconnected", "killed"]),
  exitCode: z.number().optional(),
  error: z
    .object({
      code: z.number(),
      message: z.string(),
      details: z.object({}).catchall(z.unknown()).optional(),
    })
    .optional(),
});

const ServiceEventPayloadSchema = z.object({
  event: z.string().min(1, "event name is required"),
  data: z.unknown(),
});

const ServiceActionPayloadSchema = z.object({
  action: z.string().min(1, "action name is required"),
  params: z.unknown(),
  timeout: z.number().positive().optional(),
});

export const ServiceStartedMessageSchema = SCPMessageBaseSchema.extend({
  type: z.literal("service.started"),
  payload: ServiceStartedPayloadSchema,
});

export const ServiceStoppedMessageSchema = SCPMessageBaseSchema.extend({
  type: z.literal("service.stopped"),
  payload: ServiceStoppedPayloadSchema,
});

export const ServiceEventMessageSchema = SCPMessageBaseSchema.extend({
  type: z.literal("service.event"),
  payload: ServiceEventPayloadSchema,
});

export const ServiceActionMessageSchema = SCPMessageBaseSchema.extend({
  type: z.literal("service.action"),
  payload: ServiceActionPayloadSchema,
});

export const ServiceMessageSchema = z.discriminatedUnion("type", [
  ServiceStartedMessageSchema,
  ServiceStoppedMessageSchema,
  ServiceEventMessageSchema,
  ServiceActionMessageSchema,
]);

const AgentResponsePayloadSchema = z.object({
  success: z.boolean(),
  data: z.unknown().optional(),
  error: z
    .object({
      code: z.number(),
      message: z.string(),
      details: z.object({}).catchall(z.unknown()).optional(),
    })
    .optional(),
});

const AgentStopRequestPayloadSchema = z.object({
  reason: z.string(),
  force: z.boolean().optional(),
});

export const AgentResponseMessageSchema = SCPMessageBaseSchema.extend({
  type: z.literal("agent.response"),
  payload: AgentResponsePayloadSchema,
});

export const AgentStopRequestMessageSchema = SCPMessageBaseSchema.extend({
  type: z.literal("agent.stop-request"),
  payload: AgentStopRequestPayloadSchema,
});

export type ServiceConnection = {
  serviceId: ServiceId;
  socket: WebSocket;
  connId: string;
  connectedAt: Date;
  metadata?: {
    name?: string;
    version?: string;
    actions?: string[];
  };
};

export type MessageHandler<T = unknown> = (
  serviceId: ServiceId,
  payload: T,
  connection: ServiceConnection,
) => void | Promise<void>;

export type ActionHandler = (
  serviceId: ServiceId,
  action: string,
  params: unknown,
  requestId: string,
  connection: ServiceConnection,
) => Promise<unknown>;

export type SCPServerOptions = {
  logger: ReturnType<typeof createSubsystemLogger>;
  onServiceStarted?: MessageHandler<z.infer<typeof ServiceStartedPayloadSchema>>;
  onServiceStopped?: MessageHandler<z.infer<typeof ServiceStoppedPayloadSchema>>;
  onServiceEvent?: MessageHandler<z.infer<typeof ServiceEventPayloadSchema>>;
  onServiceAction?: ActionHandler;
  onError?: (serviceId: ServiceId, error: Error, connection: ServiceConnection) => void;
  onDisconnect?: (serviceId: ServiceId, connection: ServiceConnection) => void;
};

export type ServiceApiResponse = {
  success: boolean;
  data?: unknown;
  error?: SCPError;
};

export type SCPServer = {
  handleUpgrade: (request: IncomingMessage, socket: WebSocket) => void;
  broadcastToService: (serviceId: ServiceId, message: SCPMessage) => boolean;
  sendActionAndWait: (
    serviceId: ServiceId,
    action: string,
    params: unknown,
    timeoutMs?: number,
  ) => Promise<ServiceApiResponse>;
  getConnectionStats: () => {
    totalConnections: number;
    services: Map<ServiceId, number>;
  };
  close: () => Promise<void>;
};

export function createSCPServer(options: SCPServerOptions): SCPServer {
  const { logger } = options;
  const connections = new Map<ServiceId, ServiceConnection>();
  const pendingRequests = new Map<
    string,
    {
      resolve: (response: ServiceApiResponse) => void;
      timeout: ReturnType<typeof setTimeout>;
    }
  >();
  const log = logger.child("scp");

  function createError(code: number, message: string, details?: Record<string, unknown>): SCPError {
    return { code, message, details };
  }

  function sendError(
    socket: WebSocket,
    serviceId: ServiceId,
    requestId: string,
    error: SCPError,
  ): void {
    if (socket.readyState !== socket.OPEN) {
      return;
    }

    const response = {
      type: "agent.response",
      serviceId,
      requestId,
      timestamp: new Date().toISOString(),
      payload: {
        success: false,
        error,
      },
    };

    try {
      socket.send(JSON.stringify(response));
    } catch (err) {
      log.warn(`Failed to send error response to ${serviceId}: ${String(err)}`);
    }
  }

  function sendSuccess(
    socket: WebSocket,
    serviceId: ServiceId,
    requestId: string,
    data?: unknown,
  ): void {
    if (socket.readyState !== socket.OPEN) {
      return;
    }

    const response = {
      type: "agent.response",
      serviceId,
      requestId,
      timestamp: new Date().toISOString(),
      payload: {
        success: true,
        data,
      },
    };

    try {
      socket.send(JSON.stringify(response));
    } catch (err) {
      log.warn(`Failed to send success response to ${serviceId}: ${String(err)}`);
    }
  }

  function handleMessage(connection: ServiceConnection, data: string): void {
    let parsed: unknown;

    try {
      parsed = JSON.parse(data);
    } catch (err) {
      log.warn(`Invalid JSON from service ${connection.serviceId}: ${String(err)}`);
      sendError(
        connection.socket,
        connection.serviceId,
        "unknown",
        createError(SCPErrorCodes.INVALID_MESSAGE, "Invalid JSON message"),
      );
      return;
    }

    const baseResult = SCPMessageBaseSchema.safeParse(parsed);
    if (!baseResult.success) {
      const errorMessages = baseResult.error.issues
        .map((issue: z.ZodIssue) => issue.message)
        .join(", ");
      log.warn(`Invalid message structure from ${connection.serviceId}: ${errorMessages}`);
      sendError(
        connection.socket,
        connection.serviceId,
        (parsed as { requestId?: string })?.requestId ?? "unknown",
        createError(SCPErrorCodes.MISSING_REQUIRED_FIELD, `Invalid message: ${errorMessages}`),
      );
      return;
    }

    const baseMessage = baseResult.data;

    if (baseMessage.serviceId !== connection.serviceId) {
      log.warn(`Service ID mismatch: ${baseMessage.serviceId} vs ${connection.serviceId}`);
      sendError(
        connection.socket,
        connection.serviceId,
        baseMessage.requestId,
        createError(
          SCPErrorCodes.SERVICE_ID_MISMATCH,
          `Service ID mismatch: expected ${connection.serviceId}`,
        ),
      );
      return;
    }

    switch (baseMessage.type) {
      case "service.started": {
        const result = ServiceStartedMessageSchema.safeParse(parsed);
        if (!result.success) {
          sendError(
            connection.socket,
            connection.serviceId,
            baseMessage.requestId,
            createError(
              SCPErrorCodes.INVALID_FIELD_TYPE,
              `Invalid service.started message: ${result.error.message}`,
            ),
          );
          return;
        }

        connection.metadata = {
          name: result.data.payload.name,
          version: result.data.payload.version,
          actions: result.data.payload.actions,
        };

        log.info(
          `Service started: ${connection.serviceId} (${result.data.payload.name} v${result.data.payload.version})`,
        );

        if (options.onServiceStarted) {
          void Promise.resolve(
            options.onServiceStarted(connection.serviceId, result.data.payload, connection),
          ).catch((err) => log.error(`onServiceStarted handler error: ${String(err)}`));
        }

        sendSuccess(connection.socket, connection.serviceId, baseMessage.requestId, {
          acknowledged: true,
        });
        break;
      }

      case "service.stopped": {
        const result = ServiceStoppedMessageSchema.safeParse(parsed);
        if (!result.success) {
          sendError(
            connection.socket,
            connection.serviceId,
            baseMessage.requestId,
            createError(
              SCPErrorCodes.INVALID_FIELD_TYPE,
              `Invalid service.stopped message: ${result.error.message}`,
            ),
          );
          return;
        }

        log.info(
          `Service stopped: ${connection.serviceId} (reason: ${result.data.payload.reason})`,
        );

        if (options.onServiceStopped) {
          void Promise.resolve(
            options.onServiceStopped(connection.serviceId, result.data.payload, connection),
          ).catch((err) => log.error(`onServiceStopped handler error: ${String(err)}`));
        }

        connection.socket.close(1000, "Service stopped");
        break;
      }

      case "service.event": {
        const result = ServiceEventMessageSchema.safeParse(parsed);
        if (!result.success) {
          sendError(
            connection.socket,
            connection.serviceId,
            baseMessage.requestId,
            createError(
              SCPErrorCodes.INVALID_FIELD_TYPE,
              `Invalid service.event message: ${result.error.message}`,
            ),
          );
          return;
        }

        log.debug(`Service event from ${connection.serviceId}: ${result.data.payload.event}`);

        if (options.onServiceEvent) {
          void Promise.resolve(
            options.onServiceEvent(connection.serviceId, result.data.payload, connection),
          ).catch((err) => log.error(`onServiceEvent handler error: ${String(err)}`));
        }
        break;
      }

      case "service.action": {
        const result = ServiceActionMessageSchema.safeParse(parsed);
        if (!result.success) {
          sendError(
            connection.socket,
            connection.serviceId,
            baseMessage.requestId,
            createError(
              SCPErrorCodes.INVALID_FIELD_TYPE,
              `Invalid service.action message: ${result.error.message}`,
            ),
          );
          return;
        }

        log.debug(`Service action from ${connection.serviceId}: ${result.data.payload.action}`);

        if (!options.onServiceAction) {
          sendError(
            connection.socket,
            connection.serviceId,
            baseMessage.requestId,
            createError(SCPErrorCodes.ACTION_NOT_FOUND, "Action handler not configured"),
          );
          return;
        }

        void (async () => {
          try {
            const actionResult = await options.onServiceAction!(
              connection.serviceId,
              result.data.payload.action,
              result.data.payload.params,
              baseMessage.requestId,
              connection,
            );
            sendSuccess(
              connection.socket,
              connection.serviceId,
              baseMessage.requestId,
              actionResult,
            );
          } catch (err) {
            const errorMessage = err instanceof Error ? err.message : String(err);
            log.error(`Action handler error for ${connection.serviceId}: ${errorMessage}`);
            sendError(
              connection.socket,
              connection.serviceId,
              baseMessage.requestId,
              createError(SCPErrorCodes.ACTION_FAILED, errorMessage),
            );
          }
        })();
        break;
      }

      case "agent.response": {
        const pending = pendingRequests.get(baseMessage.requestId);
        if (pending) {
          clearTimeout(pending.timeout);
          pendingRequests.delete(baseMessage.requestId);

          const parsedMessage = parsed as {
            payload: {
              success: boolean;
              data?: unknown;
              error?: SCPError;
            };
          };

          pending.resolve({
            success: parsedMessage.payload.success,
            data: parsedMessage.payload.data,
            error: parsedMessage.payload.error,
          });
        } else {
          log.warn(`Received agent.response for unknown requestId: ${baseMessage.requestId}`);
        }
        break;
      }

      default:
        log.warn(`Unknown message type from ${connection.serviceId}: ${baseMessage.type}`);
        sendError(
          connection.socket,
          connection.serviceId,
          baseMessage.requestId,
          createError(
            SCPErrorCodes.UNKNOWN_MESSAGE_TYPE,
            `Unknown message type: ${baseMessage.type}`,
          ),
        );
    }
  }

  function handleConnection(
    serviceId: ServiceId,
    socket: WebSocket,
    request: IncomingMessage,
  ): void {
    const connId = randomUUID();
    const connection: ServiceConnection = {
      serviceId,
      socket,
      connId,
      connectedAt: new Date(),
    };

    if (connections.has(serviceId)) {
      log.warn(`Service ${serviceId} already connected, closing existing connection`);
      const existing = connections.get(serviceId)!;
      existing.socket.close(1008, "New connection established");
    }

    connections.set(serviceId, connection);
    log.info(
      `Service connected: ${serviceId} (conn=${connId}, remote=${request.socket.remoteAddress ?? "?"})`,
    );

    socket.on("message", (data: string | Buffer) => {
      const text = typeof data === "string" ? data : data.toString();
      handleMessage(connection, text);
    });

    socket.on("close", (code, reason) => {
      const current = connections.get(serviceId);
      if (current?.connId === connId) {
        connections.delete(serviceId);
        log.info(
          `Service disconnected: ${serviceId} (code=${code}, reason=${reason?.toString() ?? "?"})`,
        );

        if (options.onDisconnect) {
          try {
            options.onDisconnect(serviceId, connection);
          } catch (err) {
            log.error(`onDisconnect handler error: ${String(err)}`);
          }
        }
      }
    });

    socket.on("error", (err) => {
      log.error(`WebSocket error for ${serviceId}: ${String(err)}`);

      if (options.onError) {
        try {
          options.onError(serviceId, err, connection);
        } catch (handlerErr) {
          log.error(`onError handler error: ${String(handlerErr)}`);
        }
      }

      if (socket.readyState === socket.OPEN) {
        socket.close(1011, "Internal error");
      }
    });

    const handshakeTimeout = setTimeout(() => {
      if (!connection.metadata && socket.readyState === socket.OPEN) {
        log.warn(`Handshake timeout for ${serviceId}, closing connection`);
        socket.close(1008, "Handshake timeout - service.started not received");
      }
    }, 30000);

    socket.once("close", () => {
      clearTimeout(handshakeTimeout);
    });
  }

  function extractServiceId(request: IncomingMessage): ServiceId | null {
    const url = request.url;
    if (!url) {
      return null;
    }

    try {
      const searchIndex = url.indexOf("?");
      if (searchIndex === -1) {
        return null;
      }

      const searchParams = new URLSearchParams(url.slice(searchIndex));
      return searchParams.get("serviceId");
    } catch {
      return null;
    }
  }

  return {
    handleUpgrade: (request: IncomingMessage, socket: WebSocket): void => {
      const serviceId = extractServiceId(request);

      if (!serviceId) {
        log.warn(`Connection rejected: missing serviceId parameter`);
        socket.close(1008, "Missing serviceId parameter");
        return;
      }

      const serviceIdPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
      if (!serviceIdPattern.test(serviceId)) {
        log.warn(`Connection rejected: invalid serviceId format: ${serviceId}`);
        socket.close(1008, "Invalid serviceId format");
        return;
      }

      handleConnection(serviceId, socket, request);
    },

    broadcastToService: (serviceId: ServiceId, message: SCPMessage): boolean => {
      const connection = connections.get(serviceId);
      if (!connection) {
        log.warn(`Cannot broadcast to ${serviceId}: not connected`);
        return false;
      }

      if (connection.socket.readyState !== connection.socket.OPEN) {
        log.warn(`Cannot broadcast to ${serviceId}: socket not open`);
        return false;
      }

      try {
        connection.socket.send(JSON.stringify(message));
        return true;
      } catch (err) {
        log.error(`Failed to broadcast to ${serviceId}: ${String(err)}`);
        return false;
      }
    },

    sendActionAndWait: async (
      serviceId: ServiceId,
      action: string,
      params: unknown,
      timeoutMs = 30000,
    ): Promise<ServiceApiResponse> => {
      const connection = connections.get(serviceId);
      if (!connection) {
        return {
          success: false,
          error: createError(
            SCPErrorCodes.SERVICE_NOT_FOUND,
            `Service '${serviceId}' is not connected`,
          ),
        };
      }

      if (connection.socket.readyState !== connection.socket.OPEN) {
        return {
          success: false,
          error: createError(
            SCPErrorCodes.SERVICE_NOT_FOUND,
            `Service '${serviceId}' socket is not open`,
          ),
        };
      }

      const requestId = randomUUID();

      return new Promise((resolve) => {
        const timeout = setTimeout(() => {
          pendingRequests.delete(requestId);
          resolve({
            success: false,
            error: createError(
              SCPErrorCodes.TIMEOUT,
              `Action '${action}' timed out after ${timeoutMs}ms`,
            ),
          });
        }, timeoutMs);

        pendingRequests.set(requestId, { resolve, timeout });

        const message: SCPMessage = {
          type: "service.action",
          serviceId,
          requestId,
          timestamp: new Date().toISOString(),
          payload: { action, params },
        };

        try {
          connection.socket.send(JSON.stringify(message));
        } catch (err) {
          clearTimeout(timeout);
          pendingRequests.delete(requestId);
          resolve({
            success: false,
            error: createError(
              SCPErrorCodes.INTERNAL_ERROR,
              `Failed to send action: ${String(err)}`,
            ),
          });
        }
      });
    },

    getConnectionStats: () => {
      const services = new Map<ServiceId, number>();
      for (const [serviceId] of connections) {
        services.set(serviceId, 1);
      }

      return {
        totalConnections: connections.size,
        services,
      };
    },

    close: async (): Promise<void> => {
      log.info("Closing SCP server and all connections...");

      const closePromises: Promise<void>[] = [];

      for (const [_serviceId, connection] of connections) {
        closePromises.push(
          new Promise<void>((resolve) => {
            const timeout = setTimeout(() => {
              if (connection.socket.readyState !== connection.socket.CLOSED) {
                connection.socket.terminate();
              }
              resolve();
            }, 5000);

            connection.socket.once("close", () => {
              clearTimeout(timeout);
              resolve();
            });

            if (connection.socket.readyState === connection.socket.OPEN) {
              connection.socket.close(1001, "Server shutting down");
            } else {
              resolve();
            }
          }),
        );
      }

      await Promise.all(closePromises);
      connections.clear();
      log.info("SCP server closed");
    },
  };
}

export function createStopRequest(
  serviceId: ServiceId,
  reason: string,
  force?: boolean,
): SCPMessage {
  return {
    type: "agent.stop-request",
    serviceId,
    requestId: randomUUID(),
    timestamp: new Date().toISOString(),
    payload: {
      reason,
      force,
    },
  };
}

export function createSuccessResponse(
  serviceId: ServiceId,
  requestId: string,
  data?: unknown,
): SCPMessage {
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

export function createErrorResponse(
  serviceId: ServiceId,
  requestId: string,
  error: SCPError,
): SCPMessage {
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

export default createSCPServer;
