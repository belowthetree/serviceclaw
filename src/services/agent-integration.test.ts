/**
 * Tests for Agent Integration
 */

import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import { describe, expect, it, vi } from "vitest";
import type {
  ServiceActionMessage,
  ServiceEventMessage,
  ServiceStartedMessage,
  ServiceStoppedMessage,
} from "../../packages/service-sdk/src/types.js";
import { createAgentIntegration, type AgentIntegrationOptions } from "./agent-integration.js";
import type { ServiceConnection } from "./scp-server.js";

// Mock the logger
const mockLogger = {
  subsystem: "test",
  isEnabled: vi.fn(() => true),
  trace: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: vi.fn(),
  raw: vi.fn(),
  child: vi.fn(() => mockLogger),
};

// Mock loadConfig
vi.mock("../config/config.js", () => ({
  loadConfig: vi.fn(() => ({
    agent: { model: "test-model" },
    gateway: { port: 18789 },
  })),
}));

// Helper to create mock connection
function createMockConnection(): ServiceConnection {
  return {
    serviceId: "test-service",
    socket: {
      readyState: 1,
      OPEN: 1,
      send: vi.fn(),
      close: vi.fn(),
    } as unknown as ServiceConnection["socket"],
    connId: "test-conn-123",
    connectedAt: new Date(),
  };
}

// Helper to create action message
function createActionMessage(action: string, params: unknown = {}): ServiceActionMessage {
  return {
    type: "service.action",
    serviceId: "test-service",
    requestId: "req-123",
    timestamp: new Date().toISOString(),
    payload: {
      action,
      params,
    },
  };
}

// Helper to create started message
function createStartedMessage(payload: {
  name: string;
  version: string;
  actions?: string[];
  metadata?: Record<string, unknown>;
}): ServiceStartedMessage {
  return {
    type: "service.started",
    serviceId: "test-service",
    requestId: "req-123",
    timestamp: new Date().toISOString(),
    payload,
  };
}

// Helper to create stopped message
function createStoppedMessage(payload: {
  reason: "shutdown" | "error" | "disconnected" | "killed";
  exitCode?: number;
  error?: { code: number; message: string; details?: Record<string, unknown> };
}): ServiceStoppedMessage {
  return {
    type: "service.stopped",
    serviceId: "test-service",
    requestId: "req-123",
    timestamp: new Date().toISOString(),
    payload,
  };
}

// Helper to create event message
function createEventMessage(event: string, data: unknown): ServiceEventMessage {
  return {
    type: "service.event",
    serviceId: "test-service",
    requestId: "req-123",
    timestamp: new Date().toISOString(),
    payload: {
      event,
      data,
    },
  };
}

describe("createAgentIntegration", () => {
  describe("handleServiceStarted", () => {
    it("should log service startup and return success response", async () => {
      const integration = createAgentIntegration({ logger: mockLogger });
      const connection = createMockConnection();
      const message = createStartedMessage({
        name: "Test Service",
        version: "1.0.0",
        actions: ["action1", "action2"],
      });

      const response = await integration.handleServiceStarted(message, connection);

      expect(response.type).toBe("agent.response");
      expect(response.serviceId).toBe("test-service");
      expect(response.requestId).toBe("req-123");
      expect(response.payload.success).toBe(true);
      expect(response.payload.data).toEqual({
        acknowledged: true,
        agentTime: expect.any(String),
      });

      // Verify connection metadata was updated
      expect(connection.metadata).toEqual({
        name: "Test Service",
        version: "1.0.0",
        actions: ["action1", "action2"],
      });

      // Verify logging
      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining("Test Service v1.0.0"));
    });

    it("should handle service startup without actions", async () => {
      const integration = createAgentIntegration({ logger: mockLogger });
      const connection = createMockConnection();
      const message = createStartedMessage({
        name: "Simple Service",
        version: "0.1.0",
      });

      const response = await integration.handleServiceStarted(message, connection);

      expect(response.payload.success).toBe(true);
      expect(connection.metadata?.actions).toBeUndefined();
    });

    it("should log metadata when provided", async () => {
      const integration = createAgentIntegration({ logger: mockLogger });
      const connection = createMockConnection();
      const metadata = { customField: "value", nested: { key: "value" } };
      const message = createStartedMessage({
        name: "Service With Metadata",
        version: "1.0.0",
        metadata,
      });

      await integration.handleServiceStarted(message, connection);

      expect(mockLogger.debug).toHaveBeenCalledWith(expect.stringContaining("metadata"), metadata);
    });
  });

  describe("handleServiceStopped", () => {
    it("should log normal shutdown and return success response", async () => {
      const integration = createAgentIntegration({ logger: mockLogger });
      const connection = createMockConnection();
      const message = createStoppedMessage({
        reason: "shutdown",
        exitCode: 0,
      });

      const response = await integration.handleServiceStopped(message, connection);

      expect(response.type).toBe("agent.response");
      expect(response.payload.success).toBe(true);
      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining("stopped"));
    });

    it("should log error shutdown with error details", async () => {
      const integration = createAgentIntegration({ logger: mockLogger });
      const connection = createMockConnection();
      const message = createStoppedMessage({
        reason: "error",
        exitCode: 1,
        error: {
          code: 500,
          message: "Service crashed",
          details: { stack: "Error at line 10" },
        },
      });

      const response = await integration.handleServiceStopped(message, connection);

      expect(response.payload.success).toBe(true);
      expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining("stopped with error"), {
        stack: "Error at line 10",
      });
    });
  });

  describe("handleServiceEvent", () => {
    it("should log events without returning response", async () => {
      const integration = createAgentIntegration({ logger: mockLogger });
      const connection = createMockConnection();
      const message = createEventMessage("user.login", { userId: "123" });

      const result = await integration.handleServiceEvent(message, connection);

      expect(result).toBeUndefined();
      expect(mockLogger.debug).toHaveBeenCalledWith("Service test-service event: user.login", {
        userId: "123",
      });
    });

    it("should handle events with complex data", async () => {
      const integration = createAgentIntegration({ logger: mockLogger });
      const connection = createMockConnection();
      const complexData = {
        nested: { array: [1, 2, 3] },
        timestamp: new Date().toISOString(),
      };
      const message = createEventMessage("data.update", complexData);

      await integration.handleServiceEvent(message, connection);

      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining("data.update"),
        complexData,
      );
    });
  });

  describe("handleServiceAction - log", () => {
    it("should handle log action with info level", async () => {
      const integration = createAgentIntegration({ logger: mockLogger });
      const connection = createMockConnection();
      const message = createActionMessage("log", {
        level: "info",
        message: "Test log message",
        meta: { source: "test" },
      });

      const response = await integration.handleServiceAction(message, connection);

      expect(response.payload.success).toBe(true);
      expect(response.payload.data).toEqual({
        logged: true,
        level: "info",
        timestamp: expect.any(String),
      });
      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining("Test log message"), {
        source: "test",
      });
    });

    it("should handle log action with different levels", async () => {
      const levels: Array<"debug" | "info" | "warn" | "error"> = ["debug", "warn", "error"];

      for (const level of levels) {
        const freshMockLogger = {
          subsystem: "test",
          isEnabled: vi.fn(() => true),
          trace: vi.fn(),
          debug: vi.fn(),
          info: vi.fn(),
          warn: vi.fn(),
          error: vi.fn(),
          fatal: vi.fn(),
          raw: vi.fn(),
          child: vi.fn(() => freshMockLogger),
        };
        const integration = createAgentIntegration({ logger: freshMockLogger });
        const connection = createMockConnection();
        const message = createActionMessage("log", {
          level,
          message: `${level} message`,
        });

        const response = await integration.handleServiceAction(message, connection);

        expect(response.payload.success).toBe(true);
        expect(freshMockLogger[level]).toHaveBeenCalledWith(
          expect.stringContaining(`${level} message`),
          {},
        );
      }
    });

    it("should reject log action with empty message", async () => {
      const integration = createAgentIntegration({ logger: mockLogger });
      const connection = createMockConnection();
      const message = createActionMessage("log", {
        level: "info",
        message: "",
      });

      const response = await integration.handleServiceAction(message, connection);

      expect(response.payload.success).toBe(false);
      expect(response.payload.error?.message).toContain("required");
    });

    it("should reject log action with invalid level", async () => {
      const integration = createAgentIntegration({ logger: mockLogger });
      const connection = createMockConnection();
      const message = createActionMessage("log", {
        level: "invalid",
        message: "Test",
      });

      const response = await integration.handleServiceAction(message, connection);

      expect(response.payload.success).toBe(false);
      expect(response.payload.error?.message).toContain("Invalid log level");
    });
  });

  describe("handleServiceAction - get-config", () => {
    it("should read config value by key", async () => {
      const integration = createAgentIntegration({ logger: mockLogger });
      const connection = createMockConnection();
      const message = createActionMessage("get-config", {
        key: "agent.model",
      });

      const response = await integration.handleServiceAction(message, connection);

      expect(response.payload.success).toBe(true);
      expect(response.payload.data).toEqual({
        key: "agent.model",
        value: "test-model",
        exists: true,
      });
    });

    it("should return undefined for non-existent key", async () => {
      const integration = createAgentIntegration({ logger: mockLogger });
      const connection = createMockConnection();
      const message = createActionMessage("get-config", {
        key: "nonexistent.key",
      });

      const response = await integration.handleServiceAction(message, connection);

      expect(response.payload.success).toBe(true);
      expect(response.payload.data).toEqual({
        key: "nonexistent.key",
        value: undefined,
        exists: false,
      });
    });

    it("should reject get-config without key", async () => {
      const integration = createAgentIntegration({ logger: mockLogger });
      const connection = createMockConnection();
      const message = createActionMessage("get-config", {});

      const response = await integration.handleServiceAction(message, connection);

      expect(response.payload.success).toBe(false);
      expect(response.payload.error?.message).toContain("Config key is required");
    });
  });

  describe("handleServiceAction - send-message", () => {
    it("should send message with content", async () => {
      const mockSender = vi.fn().mockResolvedValue(undefined);
      const integration = createAgentIntegration({
        logger: mockLogger,
        messageSender: mockSender,
      });
      const connection = createMockConnection();
      const message = createActionMessage("send-message", {
        content: "Hello World",
      });

      const response = await integration.handleServiceAction(message, connection);

      expect(response.payload.success).toBe(true);
      expect(mockSender).toHaveBeenCalledWith("Hello World", {
        channel: undefined,
        threadId: undefined,
      });
      expect(response.payload.data).toEqual({
        sent: true,
        channel: undefined,
        timestamp: expect.any(String),
      });
    });

    it("should send message with channel and thread", async () => {
      const mockSender = vi.fn().mockResolvedValue(undefined);
      const integration = createAgentIntegration({
        logger: mockLogger,
        messageSender: mockSender,
      });
      const connection = createMockConnection();
      const message = createActionMessage("send-message", {
        content: "Hello Channel",
        channel: "general",
        threadId: "thread-123",
      });

      await integration.handleServiceAction(message, connection);

      expect(mockSender).toHaveBeenCalledWith("Hello Channel", {
        channel: "general",
        threadId: "thread-123",
      });
    });

    it("should reject send-message without content", async () => {
      const integration = createAgentIntegration({
        logger: mockLogger,
        messageSender: vi.fn(),
      });
      const connection = createMockConnection();
      const message = createActionMessage("send-message", {});

      const response = await integration.handleServiceAction(message, connection);

      expect(response.payload.success).toBe(false);
      expect(response.payload.error?.message).toContain("content is required");
    });

    it("should return error when message sender not configured", async () => {
      const integration = createAgentIntegration({ logger: mockLogger });
      const connection = createMockConnection();
      const message = createActionMessage("send-message", {
        content: "Test",
      });

      const response = await integration.handleServiceAction(message, connection);

      expect(response.payload.success).toBe(false);
      expect(response.payload.error?.message).toContain("not configured");
    });
  });

  describe("handleServiceAction - create-task", () => {
    it("should create task with title and description", async () => {
      const mockToolInvoker = vi.fn().mockResolvedValue({
        content: [{ type: "text", text: "Task created" }],
        details: { taskId: "123" },
      } as AgentToolResult<unknown>);

      const integration = createAgentIntegration({
        logger: mockLogger,
        toolInvoker: mockToolInvoker,
      });
      const connection = createMockConnection();
      const message = createActionMessage("create-task", {
        title: "Test Task",
        description: "Test Description",
      });

      const response = await integration.handleServiceAction(message, connection);

      expect(response.payload.success).toBe(true);
      expect(mockToolInvoker).toHaveBeenCalledWith(
        "task_create",
        expect.objectContaining({
          title: "Test Task",
          description: "Test Description",
        }),
      );
      expect(response.payload.data).toEqual({
        taskId: expect.stringContaining("task-"),
        title: "Test Task",
        status: "created",
        result: expect.any(Object),
      });
    });

    it("should create task with default values", async () => {
      const mockToolInvoker = vi.fn().mockResolvedValue({
        content: [{ type: "text", text: "Task created" }],
      } as AgentToolResult<unknown>);

      const integration = createAgentIntegration({
        logger: mockLogger,
        toolInvoker: mockToolInvoker,
      });
      const connection = createMockConnection();
      const message = createActionMessage("create-task", {});

      const response = await integration.handleServiceAction(message, connection);

      expect(response.payload.success).toBe(true);
      expect(mockToolInvoker).toHaveBeenCalledWith(
        "task_create",
        expect.objectContaining({
          title: "Untitled Task",
          description: "",
        }),
      );
    });

    it("should return error when tool invoker not configured", async () => {
      const integration = createAgentIntegration({ logger: mockLogger });
      const connection = createMockConnection();
      const message = createActionMessage("create-task", {
        title: "Test",
      });

      const response = await integration.handleServiceAction(message, connection);

      expect(response.payload.success).toBe(false);
      expect(response.payload.error?.message).toContain("not configured");
    });
  });

  describe("handleServiceAction - unknown action", () => {
    it("should return error for unknown action", async () => {
      const integration = createAgentIntegration({ logger: mockLogger });
      const connection = createMockConnection();
      const message = createActionMessage("unknown-action", { param: "value" });

      const response = await integration.handleServiceAction(message, connection);

      expect(response.payload.success).toBe(false);
      expect(response.payload.error?.code).toBe(3000); // ACTION_NOT_FOUND
      expect(response.payload.error?.message).toContain("Unknown action");
      expect(response.payload.error?.details).toHaveProperty("availableActions");
    });
  });

  describe("custom action handlers", () => {
    it("should register and execute custom handler", async () => {
      const customHandler = vi
        .fn()
        .mockResolvedValue({ custom: "result" }) as () => Promise<unknown>;
      const integration = createAgentIntegration({ logger: mockLogger });

      integration.registerActionHandler("custom-action", customHandler);

      const connection = createMockConnection();
      const message = createActionMessage("custom-action", { foo: "bar" });

      const response = await integration.handleServiceAction(message, connection);

      expect(response.payload.success).toBe(true);
      expect(response.payload.data).toEqual({ custom: "result" });
      expect(customHandler).toHaveBeenCalledWith("test-service", { foo: "bar" }, connection);
    });

    it("should prioritize custom handler over built-in", async () => {
      const customHandler = vi.fn().mockResolvedValue({ overridden: true });
      const freshMockLogger = {
        subsystem: "test",
        isEnabled: vi.fn(() => true),
        trace: vi.fn(),
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        fatal: vi.fn(),
        raw: vi.fn(),
        child: vi.fn(() => freshMockLogger),
      };
      const integration = createAgentIntegration({ logger: freshMockLogger });

      integration.registerActionHandler("log", customHandler);

      const connection = createMockConnection();
      const message = createActionMessage("log", { message: "test" });

      const response = await integration.handleServiceAction(message, connection);

      expect(response.payload.success).toBe(true);
      expect(response.payload.data).toEqual({ overridden: true });
      expect(customHandler).toHaveBeenCalled();
      expect(freshMockLogger.info).not.toHaveBeenCalled();
    });

    it("should unregister custom handler", async () => {
      const customHandler = vi.fn();
      const integration = createAgentIntegration({ logger: mockLogger });

      integration.registerActionHandler("temp-action", customHandler);
      expect(integration.getRegisteredActions()).toContain("temp-action");

      integration.unregisterActionHandler("temp-action");
      expect(integration.getRegisteredActions()).not.toContain("temp-action");

      const connection = createMockConnection();
      const message = createActionMessage("temp-action", {});

      const response = await integration.handleServiceAction(message, connection);

      expect(response.payload.success).toBe(false);
      expect(response.payload.error?.code).toBe(3000); // ACTION_NOT_FOUND
    });

    it("should list all registered custom actions", async () => {
      const integration = createAgentIntegration({ logger: mockLogger });

      integration.registerActionHandler("action1", vi.fn());
      integration.registerActionHandler("action2", vi.fn());
      integration.registerActionHandler("action3", vi.fn());

      const actions = integration.getRegisteredActions();

      expect(actions).toHaveLength(3);
      expect(actions).toContain("action1");
      expect(actions).toContain("action2");
      expect(actions).toContain("action3");
    });

    it("should reject invalid action name", () => {
      const integration = createAgentIntegration({ logger: mockLogger });

      expect(() => integration.registerActionHandler("", vi.fn())).toThrow("non-empty string");
      expect(() => integration.registerActionHandler("  ", vi.fn())).toThrow("non-empty string");
    });

    it("should reject non-function handler", () => {
      const integration = createAgentIntegration({ logger: mockLogger });

      expect(() =>
        integration.registerActionHandler(
          "test",
          "not-a-function" as unknown as () => Promise<unknown>,
        ),
      ).toThrow("function");
    });

    it("should handle custom handler errors", async () => {
      const integration = createAgentIntegration({ logger: mockLogger });

      integration.registerActionHandler("failing-action", async () => {
        throw new Error("Custom handler error");
      });

      const connection = createMockConnection();
      const message = createActionMessage("failing-action", {});

      const response = await integration.handleServiceAction(message, connection);

      expect(response.payload.success).toBe(false);
      expect(response.payload.error?.message).toBe("Custom handler error");
      expect(response.payload.error?.code).toBe(3001); // ACTION_FAILED
    });
  });

  describe("response format", () => {
    it("should include correct message structure for success", async () => {
      const integration = createAgentIntegration({ logger: mockLogger });
      const connection = createMockConnection();
      const message = createActionMessage("log", {
        level: "info",
        message: "Test",
      });

      const response = await integration.handleServiceAction(message, connection);

      expect(response).toHaveProperty("type", "agent.response");
      expect(response).toHaveProperty("serviceId", "test-service");
      expect(response).toHaveProperty("requestId", "req-123");
      expect(response).toHaveProperty("timestamp");
      expect(response).toHaveProperty("payload");
      expect(response.payload).toHaveProperty("success", true);
      expect(response.payload).toHaveProperty("data");
      expect(response.payload).not.toHaveProperty("error");
    });

    it("should include correct message structure for error", async () => {
      const integration = createAgentIntegration({ logger: mockLogger });
      const connection = createMockConnection();
      const message = createActionMessage("unknown-action", {});

      const response = await integration.handleServiceAction(message, connection);

      expect(response).toHaveProperty("type", "agent.response");
      expect(response).toHaveProperty("payload");
      expect(response.payload).toHaveProperty("success", false);
      expect(response.payload).not.toHaveProperty("data");
      expect(response.payload).toHaveProperty("error");
      expect(response.payload.error).toHaveProperty("code");
      expect(response.payload.error).toHaveProperty("message");
    });
  });

  describe("edge cases", () => {
    it("should handle null/undefined params gracefully", async () => {
      const integration = createAgentIntegration({ logger: mockLogger });
      const connection = createMockConnection();

      // Test with null params
      const message1: ServiceActionMessage = {
        type: "service.action",
        serviceId: "test-service",
        requestId: "req-123",
        timestamp: new Date().toISOString(),
        payload: {
          action: "log",
          params: null as unknown as Record<string, unknown>,
        },
      };

      const response1 = await integration.handleServiceAction(message1, connection);
      expect(response1.payload.success).toBe(false);

      // Test with undefined params (using empty object as default)
      const message2 = createActionMessage("log", {});
      message2.payload.params = undefined as unknown as Record<string, unknown>;

      const response2 = await integration.handleServiceAction(message2, connection);
      expect(response2.payload.success).toBe(false);
    });

    it("should handle very long log messages", async () => {
      const integration = createAgentIntegration({ logger: mockLogger });
      const connection = createMockConnection();
      const longMessage = "x".repeat(10000);
      const message = createActionMessage("log", {
        level: "info",
        message: longMessage,
      });

      const response = await integration.handleServiceAction(message, connection);

      expect(response.payload.success).toBe(true);
    });
  });
});
