/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { createSubsystemLogger } from "../logging/subsystem.js";
import type { ServiceConnection } from "../services/scp-server.js";
import { createGatewaySCPServer } from "./scp-handlers.js";

const createMockLogger = () => {
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    child: vi.fn().mockReturnThis(),
    subsystem: "test",
    isEnabled: () => true,
  } as unknown as ReturnType<typeof createSubsystemLogger>;
  return logger;
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const createMockConnection = (): ServiceConnection => ({
  serviceId: "test-service",
  socket: {} as any,
  connId: "test-conn-1",
  connectedAt: new Date(),
});

describe("createGatewaySCPServer", () => {
  let logger: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    logger = createMockLogger();
    vi.clearAllMocks();
  });

  it("should create SCPServer with all handlers", () => {
    const server = createGatewaySCPServer({ logger });
    expect(server).toBeDefined();
    expect(typeof server.handleUpgrade).toBe("function");
    expect(typeof server.broadcastToService).toBe("function");
    expect(typeof server.getConnectionStats).toBe("function");
    expect(typeof server.close).toBe("function");
  });

  describe("onServiceStarted", () => {
    it("should log service start with name and version", () => {
      const server = createGatewaySCPServer({ logger });
      const payload = {
        name: "TestService",
        version: "1.0.0",
        actions: ["action1", "action2"],
        metadata: { key: "value" },
      };

      // Trigger service.started by sending a message through the server
      const mockSocket = {
        readyState: 1,
        OPEN: 1,
        send: vi.fn(),
        close: vi.fn(),
        on: vi.fn(),
        once: vi.fn(),
      };

      // Simulate the server receiving a service.started message
      server.handleUpgrade(
        {
          url: "/__openclaw__/scp?serviceId=test-service",
          socket: { remoteAddress: "127.0.0.1" },
        } as any,
        mockSocket as any,
      );

      // Get the message handler
      const messageHandler = mockSocket.on.mock.calls.find(
        (call: any) => call[0] === "message",
      )?.[1];
      expect(messageHandler).toBeDefined();

      // Send service.started message
      messageHandler(
        Buffer.from(
          JSON.stringify({
            type: "service.started",
            serviceId: "test-service",
            requestId: "req-1",
            timestamp: new Date().toISOString(),
            payload,
          }),
        ),
      );

      expect(logger.info).toHaveBeenCalledWith(
        `Service started: test-service (${payload.name} v${payload.version})`,
      );
    });
  });

  describe("onServiceStopped", () => {
    it("should log service stop with reason", () => {
      const server = createGatewaySCPServer({ logger });
      const mockSocket = {
        readyState: 1,
        OPEN: 1,
        CLOSED: 3,
        send: vi.fn(),
        close: vi.fn(),
        on: vi.fn(),
        once: vi.fn(),
      };

      server.handleUpgrade(
        {
          url: "/__openclaw__/scp?serviceId=test-service",
          socket: { remoteAddress: "127.0.0.1" },
        } as any,
        mockSocket as any,
      );

      const messageHandler = mockSocket.on.mock.calls.find(
        (call: any) => call[0] === "message",
      )?.[1];
      expect(messageHandler).toBeDefined();

      // First send service.started
      messageHandler(
        Buffer.from(
          JSON.stringify({
            type: "service.started",
            serviceId: "test-service",
            requestId: "req-1",
            timestamp: new Date().toISOString(),
            payload: { name: "TestService", version: "1.0.0" },
          }),
        ),
      );

      vi.clearAllMocks();

      // Then send service.stopped
      messageHandler(
        Buffer.from(
          JSON.stringify({
            type: "service.stopped",
            serviceId: "test-service",
            requestId: "req-2",
            timestamp: new Date().toISOString(),
            payload: { reason: "shutdown" as const },
          }),
        ),
      );

      expect(logger.info).toHaveBeenCalledWith(`Service stopped: test-service (shutdown)`);
    });
  });

  describe("onServiceEvent", () => {
    it("should log service event with event name", () => {
      const server = createGatewaySCPServer({ logger });
      const mockSocket = {
        readyState: 1,
        OPEN: 1,
        send: vi.fn(),
        close: vi.fn(),
        on: vi.fn(),
        once: vi.fn(),
      };

      server.handleUpgrade(
        {
          url: "/__openclaw__/scp?serviceId=test-service",
          socket: { remoteAddress: "127.0.0.1" },
        } as any,
        mockSocket as any,
      );

      const messageHandler = mockSocket.on.mock.calls.find(
        (call: any) => call[0] === "message",
      )?.[1];
      expect(messageHandler).toBeDefined();

      // First send service.started
      messageHandler(
        Buffer.from(
          JSON.stringify({
            type: "service.started",
            serviceId: "test-service",
            requestId: "req-1",
            timestamp: new Date().toISOString(),
            payload: { name: "TestService", version: "1.0.0" },
          }),
        ),
      );

      vi.clearAllMocks();

      // Send service.event
      messageHandler(
        Buffer.from(
          JSON.stringify({
            type: "service.event",
            serviceId: "test-service",
            requestId: "req-2",
            timestamp: new Date().toISOString(),
            payload: { event: "statusUpdate", data: { status: "ok" } },
          }),
        ),
      );

      expect(logger.debug).toHaveBeenCalledWith(`Service event from test-service: statusUpdate`);
    });
  });

  describe("onServiceAction", () => {
    it("should log service action and return success response", async () => {
      const server = createGatewaySCPServer({ logger });
      const mockSocket = {
        readyState: 1,
        OPEN: 1,
        send: vi.fn(),
        close: vi.fn(),
        on: vi.fn(),
        once: vi.fn(),
      };

      server.handleUpgrade(
        {
          url: "/__openclaw__/scp?serviceId=test-service",
          socket: { remoteAddress: "127.0.0.1" },
        } as any,
        mockSocket as any,
      );

      const messageHandler = mockSocket.on.mock.calls.find(
        (call: any) => call[0] === "message",
      )?.[1];
      expect(messageHandler).toBeDefined();

      // First send service.started
      messageHandler(
        Buffer.from(
          JSON.stringify({
            type: "service.started",
            serviceId: "test-service",
            requestId: "req-1",
            timestamp: new Date().toISOString(),
            payload: { name: "TestService", version: "1.0.0" },
          }),
        ),
      );

      vi.clearAllMocks();

      // Send service.action
      messageHandler(
        Buffer.from(
          JSON.stringify({
            type: "service.action",
            serviceId: "test-service",
            requestId: "req-2",
            timestamp: new Date().toISOString(),
            payload: { action: "doSomething", params: { key: "value" } },
          }),
        ),
      );

      // Wait for async handler
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(logger.info).toHaveBeenCalledWith(`Service action from test-service: doSomething`);

      // Check that success response was sent
      expect(mockSocket.send).toHaveBeenCalled();
      const sentMessage = JSON.parse(mockSocket.send.mock.calls[0][0]);
      expect(sentMessage.type).toBe("agent.response");
      expect(sentMessage.payload.success).toBe(true);
      expect(sentMessage.payload.data).toEqual({ success: true, data: { executed: true } });
    });
  });

  describe("onError", () => {
    it("should log error with message and stack", () => {
      const server = createGatewaySCPServer({ logger });
      const mockSocket = {
        readyState: 1,
        OPEN: 1,
        CLOSED: 3,
        send: vi.fn(),
        close: vi.fn(),
        on: vi.fn(),
        once: vi.fn(),
      };

      server.handleUpgrade(
        {
          url: "/__openclaw__/scp?serviceId=test-service",
          socket: { remoteAddress: "127.0.0.1" },
        } as any,
        mockSocket as any,
      );

      const errorHandler = mockSocket.on.mock.calls.find((call: any) => call[0] === "error")?.[1];
      expect(errorHandler).toBeDefined();

      const testError = new Error("Test error");
      testError.stack = "Error: Test error\n    at test.ts:1:1";

      errorHandler(testError);

      expect(logger.error).toHaveBeenCalledWith(`SCP error for test-service:`, {
        message: "Test error",
        stack: "Error: Test error\n    at test.ts:1:1",
      });
    });
  });

  describe("onDisconnect", () => {
    it("should log service disconnection", () => {
      const server = createGatewaySCPServer({ logger });
      const mockSocket = {
        readyState: 1,
        OPEN: 1,
        CLOSED: 3,
        send: vi.fn(),
        close: vi.fn(),
        on: vi.fn(),
        once: vi.fn(),
      };

      server.handleUpgrade(
        {
          url: "/__openclaw__/scp?serviceId=test-service",
          socket: { remoteAddress: "127.0.0.1" },
        } as any,
        mockSocket as any,
      );

      const closeHandler = mockSocket.on.mock.calls.find((call: any) => call[0] === "close")?.[1];
      expect(closeHandler).toBeDefined();

      // Simulate socket close
      closeHandler(1000, "Normal closure");

      expect(logger.info).toHaveBeenCalledWith(`Service disconnected: test-service`);
    });
  });
});
