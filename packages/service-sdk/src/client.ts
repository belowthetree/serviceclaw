/**
 * ServiceClient - WebSocket client for OpenClaw Service Communication Protocol (SCP)
 */

import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import WebSocket from "ws";
import type {
  ServiceId,
  RequestId,
  EventHandler,
  AgentResponseMessage,
  AgentStopRequestMessage,
  SCPMessage,
  SCPError,
} from "./types.js";

export interface ServiceClientOptions {
  name?: string;
  version?: string;
  reconnect?: {
    enabled?: boolean;
    maxRetries?: number;
    initialDelay?: number;
    maxDelay?: number;
  };
  actionTimeout?: number;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

interface ReconnectConfig {
  enabled: boolean;
  maxRetries: number;
  initialDelay: number;
  maxDelay: number;
}

const DEFAULT_RECONNECT: ReconnectConfig = {
  enabled: true,
  maxRetries: 5,
  initialDelay: 1000,
  maxDelay: 16000,
};

export class ServiceClient extends EventEmitter {
  readonly serviceId: ServiceId;
  private options: {
    name: string;
    version: string;
    actionTimeout: number;
    reconnect: ReconnectConfig;
  };
  private ws: WebSocket | null = null;
  private url: string | null = null;
  private connected = false;
  private reconnectAttempts = 0;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private pendingRequests = new Map<RequestId, PendingRequest>();
  private eventHandlers = new Map<string, Set<EventHandler>>();
  private actionHandlers = new Map<string, (params: unknown) => unknown>();

  constructor(serviceId: ServiceId, options: ServiceClientOptions = {}) {
    super();

    if (!serviceId || typeof serviceId !== "string") {
      throw new Error("Service ID is required and must be a string");
    }

    this.serviceId = serviceId;
    this.options = {
      name: options.name ?? "unknown-service",
      version: options.version ?? "0.0.0",
      actionTimeout: options.actionTimeout ?? 30000,
      reconnect: {
        enabled: options.reconnect?.enabled ?? DEFAULT_RECONNECT.enabled,
        maxRetries: options.reconnect?.maxRetries ?? DEFAULT_RECONNECT.maxRetries,
        initialDelay: options.reconnect?.initialDelay ?? DEFAULT_RECONNECT.initialDelay,
        maxDelay: options.reconnect?.maxDelay ?? DEFAULT_RECONNECT.maxDelay,
      },
    };
  }

  async connect(url: string): Promise<void> {
    if (this.connected && this.ws) {
      console.warn("[ServiceClient] Already connected, disconnecting first");
      this.disconnect();
    }

    this.url = url;
    const wsUrl = this.buildWebSocketUrl(url);

    return new Promise((resolve, reject) => {
      try {
        const ws = new WebSocket(wsUrl);

        const timeout = setTimeout(() => {
          ws.close();
          reject(new Error("Connection timeout"));
        }, 10000);

        ws.on("open", () => {
          clearTimeout(timeout);
          this.ws = ws;
          this.connected = true;
          this.reconnectAttempts = 0;
          this.setupWebSocketHandlers(ws);

          this.sendMessage({
            type: "service.started",
            payload: {
              name: this.options.name,
              version: this.options.version,
            },
          });

          this.emit("connected");
          resolve();
        });

        ws.on("error", (error: Error) => {
          clearTimeout(timeout);
          reject(new Error(`WebSocket error: ${error.message}`));
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  disconnect(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    this.rejectAllPending(new Error("Connection closed"));

    if (this.ws && this.connected) {
      try {
        this.sendMessage({
          type: "service.stopped",
          payload: {
            reason: "shutdown",
          },
        });
      } catch {
        // Ignore errors during disconnect
      }
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.connected = false;
    this.emit("disconnected");
  }

  emitEvent(event: string, payload?: unknown): void {
    this.sendMessage({
      type: "service.event",
      payload: {
        event,
        data: payload,
      },
    });
  }

  callAction(action: string, params?: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.connected || !this.ws) {
        reject(new Error("Not connected to Agent"));
        return;
      }

      const requestId = this.generateRequestId();

      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error(`Action '${action}' timed out after ${this.options.actionTimeout}ms`));
      }, this.options.actionTimeout);

      this.pendingRequests.set(requestId, {
        resolve,
        reject,
        timeout,
      });

      this.sendMessage({
        type: "service.action",
        requestId,
        payload: {
          action,
          params,
        },
      });
    });
  }

  on(event: string, handler: EventHandler): this {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());
    }
    this.eventHandlers.get(event)!.add(handler);
    return super.on(event, handler as (...args: unknown[]) => void);
  }

  off(event: string, handler?: EventHandler): this {
    const handlers = this.eventHandlers.get(event);

    if (handlers) {
      if (handler) {
        handlers.delete(handler);
        super.off(event, handler as (...args: unknown[]) => void);
      } else {
        for (const h of handlers) {
          super.off(event, h as (...args: unknown[]) => void);
        }
        handlers.clear();
        this.eventHandlers.delete(event);
      }
    }

    return this;
  }

  isConnected(): boolean {
    return this.connected;
  }

  getReconnectAttempts(): number {
    return this.reconnectAttempts;
  }

  registerActionHandler(action: string, handler: (params: unknown) => unknown): void {
    this.actionHandlers.set(action, handler);
  }

  unregisterActionHandler(action: string): void {
    this.actionHandlers.delete(action);
  }

  private buildWebSocketUrl(baseUrl: string): string {
    const url = new URL(baseUrl);
    url.searchParams.set("serviceId", this.serviceId);
    return url.toString();
  }

  private setupWebSocketHandlers(ws: WebSocket): void {
    ws.on("message", (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString()) as SCPMessage;
        this.handleMessage(message);
      } catch (error) {
        this.emit("error", new Error(`Failed to parse message: ${String(error)}`));
      }
    });

    ws.on("close", (code: number, reason: Buffer) => {
      const wasConnected = this.connected;
      this.connected = false;
      this.ws = null;

      this.rejectAllPending(new Error(`Connection closed: ${code} ${reason.toString()}`));

      this.emit("disconnected", { code, reason: reason.toString() });

      if (wasConnected && this.options.reconnect.enabled) {
        this.attemptReconnect();
      }
    });

    ws.on("error", (error: Error) => {
      this.emit("error", error);
    });
  }

  private handleMessage(message: SCPMessage): void {
    // Skip serviceId check if not present (broadcast messages from Agent)
    if (message.serviceId && message.serviceId !== this.serviceId) {
      this.emit(
        "error",
        new Error(`Service ID mismatch: ${message.serviceId} !== ${this.serviceId}`),
      );
      return;
    }

    switch (message.type) {
      case "agent.response":
        this.handleAgentResponse(message);
        break;

      case "agent.stop-request":
        this.handleStopRequest(message);
        break;

      case "service.action": {
        this.handleServiceAction(message);
        break;
      }

      case "service.event": {
        const eventMessage = message as { payload?: { event?: string; data?: unknown } };
        if (eventMessage.payload?.event) {
          this.emit(eventMessage.payload.event, eventMessage.payload.data);
        }
        break;
      }

      default:
        this.emit(message.type, message);
    }
  }

  private handleAgentResponse(message: AgentResponseMessage): void {
    const { requestId, payload } = message;
    const pending = this.pendingRequests.get(requestId);

    if (!pending) {
      this.emit("error", new Error(`Received response for unknown request: ${requestId}`));
      return;
    }

    clearTimeout(pending.timeout);
    this.pendingRequests.delete(requestId);

    if (payload.success) {
      pending.resolve(payload.data);
    } else {
      const error = this.createSCPError(payload.error);
      pending.reject(error);
    }
  }

  private handleStopRequest(message: AgentStopRequestMessage): void {
    this.emit("stop-requested", {
      reason: message.payload.reason,
      force: message.payload.force,
    });
  }

  private handleServiceAction(message: SCPMessage): void {
    const actionMessage = message as {
      requestId: string;
      payload?: { action?: string; params?: unknown };
    };

    const action = actionMessage.payload?.action;
    const params = actionMessage.payload?.params;
    const requestId = actionMessage.requestId;

    if (!action) {
      this.sendActionResponse(requestId, false, undefined, {
        code: 1004,
        message: "Missing action in service.action message",
      });
      return;
    }

    const handler = this.actionHandlers.get(action);
    if (!handler) {
      this.sendActionResponse(requestId, false, undefined, {
        code: 3000,
        message: `No handler registered for action: ${action}`,
      });
      return;
    }

    void (async () => {
      try {
        const result = await Promise.resolve(handler(params));
        this.sendActionResponse(requestId, true, result);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.sendActionResponse(requestId, false, undefined, {
          code: 3001,
          message: errorMessage,
        });
      }
    })();
  }

  private sendActionResponse(
    requestId: string,
    success: boolean,
    data?: unknown,
    error?: SCPError,
  ): void {
    if (!this.ws || !this.connected) {
      return;
    }

    const message: SCPMessage = {
      type: "agent.response",
      serviceId: this.serviceId,
      requestId,
      timestamp: new Date().toISOString(),
      payload: {
        success,
        data,
        error,
      },
    };

    this.ws.send(JSON.stringify(message));
  }

  private sendMessage(
    message: Omit<Partial<SCPMessage>, "serviceId" | "timestamp" | "requestId"> &
      Pick<Partial<SCPMessage>, "requestId">,
  ): void {
    if (!this.ws || !this.connected) {
      throw new Error("Not connected to Agent");
    }

    const fullMessage: SCPMessage = {
      serviceId: this.serviceId,
      timestamp: new Date().toISOString(),
      requestId: message.requestId ?? randomUUID(),
      ...message,
    } as SCPMessage;

    this.ws.send(JSON.stringify(fullMessage));
  }

  private generateRequestId(): RequestId {
    return randomUUID();
  }

  private attemptReconnect(): void {
    const maxRetries = this.options.reconnect.maxRetries;
    const initialDelay = this.options.reconnect.initialDelay;
    const maxDelay = this.options.reconnect.maxDelay;

    if (this.reconnectAttempts >= maxRetries) {
      this.emit("error", new Error(`Max reconnection attempts (${maxRetries}) reached`));
      return;
    }

    this.reconnectAttempts++;

    const delay = Math.min(initialDelay * Math.pow(2, this.reconnectAttempts - 1), maxDelay);

    this.emit("reconnecting", {
      attempt: this.reconnectAttempts,
      maxRetries,
      delay,
    });

    this.reconnectTimeout = setTimeout(() => {
      if (this.url) {
        this.connect(this.url).catch((error) => {
          this.emit("error", new Error(`Reconnection failed: ${error.message}`));
        });
      }
    }, delay);
  }

  private rejectAllPending(error: Error): void {
    for (const [requestId, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(error);
      this.pendingRequests.delete(requestId);
    }
  }

  private createSCPError(scpError?: SCPError): Error {
    if (!scpError) {
      return new Error("Unknown error");
    }

    const error = new Error(scpError.message);
    (error as Error & { code: number; details?: Record<string, unknown> }).code = scpError.code;
    (error as Error & { code: number; details?: Record<string, unknown> }).details =
      scpError.details;
    return error;
  }
}

export default ServiceClient;
