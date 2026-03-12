import type { IncomingMessage } from "node:http";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { WebSocket } from "ws";
import type { createSubsystemLogger } from "../logging/subsystem.js";
import {
  createSCPServer,
  createStopRequest,
  createSuccessResponse,
  createErrorResponse,
} from "./scp-server.js";
import { SCPErrorCodes } from "./scp-server.js";

const createMockLogger = () => {
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
  } as unknown as ReturnType<typeof createSubsystemLogger>;
  return logger;
};

const createMockWebSocket = () => {
  const socket = {
    readyState: 1,
    OPEN: 1,
    CLOSED: 3,
    send: vi.fn(),
    close: vi.fn(),
    terminate: vi.fn(),
    on: vi.fn(),
    once: vi.fn(),
  } as unknown as WebSocket;
  return socket;
};

const createMockRequest = (url: string, remoteAddress = "127.0.0.1") => {
  return {
    url,
    socket: { remoteAddress },
  } as unknown as IncomingMessage;
};

describe("SCP Server", () => {
  let logger: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    logger = createMockLogger();
    vi.clearAllMocks();
  });

  describe("createSCPServer", () => {
    it("should create an SCP server instance", () => {
      const server = createSCPServer({ logger });
      expect(server).toBeDefined();
      expect(typeof server.handleUpgrade).toBe("function");
      expect(typeof server.broadcastToService).toBe("function");
      expect(typeof server.getConnectionStats).toBe("function");
      expect(typeof server.close).toBe("function");
    });
  });

  describe("handleUpgrade", () => {
    it("should reject connection without serviceId", () => {
      const server = createSCPServer({ logger });
      const socket = createMockWebSocket();
      const request = createMockRequest("/__openclaw__/scp");

      server.handleUpgrade(request, socket);

      expect(socket.close).toHaveBeenCalledWith(1008, "Missing serviceId parameter");
    });

    it("should reject connection with invalid serviceId format", () => {
      const server = createSCPServer({ logger });
      const socket = createMockWebSocket();
      const request = createMockRequest("/__openclaw__/scp?serviceId=InvalidServiceID");

      server.handleUpgrade(request, socket);

      expect(socket.close).toHaveBeenCalledWith(1008, "Invalid serviceId format");
    });

    it("should accept connection with valid kebab-case serviceId", () => {
      const server = createSCPServer({ logger });
      const socket = createMockWebSocket();
      const request = createMockRequest("/__openclaw__/scp?serviceId=test-service");

      server.handleUpgrade(request, socket);

      expect(socket.close).not.toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("test-service"));
    });

    it("should close existing connection when same service reconnects", () => {
      const server = createSCPServer({ logger });
      const socket1 = createMockWebSocket();
      const socket2 = createMockWebSocket();
      const request = createMockRequest("/__openclaw__/scp?serviceId=test-service");

      server.handleUpgrade(request, socket1);
      expect(socket1.close).not.toHaveBeenCalled();

      server.handleUpgrade(request, socket2);
      expect(socket1.close).toHaveBeenCalledWith(1008, "New connection established");
    });
  });

  describe("message handling", () => {
    it("should handle invalid JSON", () => {
      const server = createSCPServer({ logger });
      const socket = createMockWebSocket();
      const request = createMockRequest("/__openclaw__/scp?serviceId=test-service");

      server.handleUpgrade(request, socket);

      const messageHandler = (socket.on as ReturnType<typeof vi.fn>).mock.calls.find(
        (call) => call[0] === "message",
      )?.[1];

      expect(messageHandler).toBeDefined();
      messageHandler(Buffer.from("invalid json"));

      expect(socket.send).toHaveBeenCalledWith(expect.stringContaining("Invalid JSON message"));
    });

    it("should handle service.started message", () => {
      const onServiceStarted = vi.fn();
      const server = createSCPServer({ logger, onServiceStarted });
      const socket = createMockWebSocket();
      const request = createMockRequest("/__openclaw__/scp?serviceId=test-service");

      server.handleUpgrade(request, socket);

      const messageHandler = (socket.on as ReturnType<typeof vi.fn>).mock.calls.find(
        (call) => call[0] === "message",
      )?.[1];

      const message = {
        type: "service.started",
        serviceId: "test-service",
        requestId: "req-1",
        timestamp: new Date().toISOString(),
        payload: {
          name: "Test Service",
          version: "1.0.0",
          actions: ["test.action"],
        },
      };

      messageHandler(Buffer.from(JSON.stringify(message)));

      expect(onServiceStarted).toHaveBeenCalledWith(
        "test-service",
        expect.objectContaining({ name: "Test Service", version: "1.0.0" }),
        expect.any(Object),
      );
      expect(socket.send).toHaveBeenCalledWith(expect.stringContaining('"success":true'));
    });

    it("should handle service.stopped message", () => {
      const onServiceStopped = vi.fn();
      const server = createSCPServer({ logger, onServiceStopped });
      const socket = createMockWebSocket();
      const request = createMockRequest("/__openclaw__/scp?serviceId=test-service");

      server.handleUpgrade(request, socket);

      const messageHandler = (socket.on as ReturnType<typeof vi.fn>).mock.calls.find(
        (call) => call[0] === "message",
      )?.[1];

      const message = {
        type: "service.stopped",
        serviceId: "test-service",
        requestId: "req-2",
        timestamp: new Date().toISOString(),
        payload: {
          reason: "shutdown",
        },
      };

      messageHandler(Buffer.from(JSON.stringify(message)));

      expect(onServiceStopped).toHaveBeenCalledWith(
        "test-service",
        expect.objectContaining({ reason: "shutdown" }),
        expect.any(Object),
      );
      expect(socket.close).toHaveBeenCalledWith(1000, "Service stopped");
    });

    it("should handle service.event message", () => {
      const onServiceEvent = vi.fn();
      const server = createSCPServer({ logger, onServiceEvent });
      const socket = createMockWebSocket();
      const request = createMockRequest("/__openclaw__/scp?serviceId=test-service");

      server.handleUpgrade(request, socket);

      const messageHandler = (socket.on as ReturnType<typeof vi.fn>).mock.calls.find(
        (call) => call[0] === "message",
      )?.[1];

      const message = {
        type: "service.event",
        serviceId: "test-service",
        requestId: "req-3",
        timestamp: new Date().toISOString(),
        payload: {
          event: "user.interaction",
          data: { action: "click" },
        },
      };

      messageHandler(Buffer.from(JSON.stringify(message)));

      expect(onServiceEvent).toHaveBeenCalledWith(
        "test-service",
        expect.objectContaining({ event: "user.interaction" }),
        expect.any(Object),
      );
    });

    it("should handle service.action message", async () => {
      const onServiceAction = vi.fn().mockResolvedValue({ result: "success" });
      const server = createSCPServer({ logger, onServiceAction });
      const socket = createMockWebSocket();
      const request = createMockRequest("/__openclaw__/scp?serviceId=test-service");

      server.handleUpgrade(request, socket);

      const messageHandler = (socket.on as ReturnType<typeof vi.fn>).mock.calls.find(
        (call) => call[0] === "message",
      )?.[1];

      const message = {
        type: "service.action",
        serviceId: "test-service",
        requestId: "req-4",
        timestamp: new Date().toISOString(),
        payload: {
          action: "create-task",
          params: { title: "Test Task" },
        },
      };

      messageHandler(Buffer.from(JSON.stringify(message)));

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(onServiceAction).toHaveBeenCalledWith(
        "test-service",
        "create-task",
        { title: "Test Task" },
        "req-4",
        expect.any(Object),
      );
      expect(socket.send).toHaveBeenCalledWith(expect.stringContaining('"success":true'));
    });

    it("should return error when action handler throws", async () => {
      const onServiceAction = vi.fn().mockRejectedValue(new Error("Action failed"));
      const server = createSCPServer({ logger, onServiceAction });
      const socket = createMockWebSocket();
      const request = createMockRequest("/__openclaw__/scp?serviceId=test-service");

      server.handleUpgrade(request, socket);

      const messageHandler = (socket.on as ReturnType<typeof vi.fn>).mock.calls.find(
        (call) => call[0] === "message",
      )?.[1];

      const message = {
        type: "service.action",
        serviceId: "test-service",
        requestId: "req-5",
        timestamp: new Date().toISOString(),
        payload: {
          action: "failing-action",
          params: {},
        },
      };

      messageHandler(Buffer.from(JSON.stringify(message)));

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(socket.send).toHaveBeenCalledWith(expect.stringContaining('"success":false'));
      expect(socket.send).toHaveBeenCalledWith(expect.stringContaining("Action failed"));
    });

    it("should reject message with mismatched serviceId", () => {
      const server = createSCPServer({ logger });
      const socket = createMockWebSocket();
      const request = createMockRequest("/__openclaw__/scp?serviceId=test-service");

      server.handleUpgrade(request, socket);

      const messageHandler = (socket.on as ReturnType<typeof vi.fn>).mock.calls.find(
        (call) => call[0] === "message",
      )?.[1];

      const message = {
        type: "service.started",
        serviceId: "different-service",
        requestId: "req-6",
        timestamp: new Date().toISOString(),
        payload: {
          name: "Different Service",
          version: "1.0.0",
        },
      };

      messageHandler(Buffer.from(JSON.stringify(message)));

      expect(socket.send).toHaveBeenCalledWith(expect.stringContaining("Service ID mismatch"));
    });

    it("should handle unknown message type", () => {
      const server = createSCPServer({ logger });
      const socket = createMockWebSocket();
      const request = createMockRequest("/__openclaw__/scp?serviceId=test-service");

      server.handleUpgrade(request, socket);

      const messageHandler = (socket.on as ReturnType<typeof vi.fn>).mock.calls.find(
        (call) => call[0] === "message",
      )?.[1];

      const message = {
        type: "unknown.type",
        serviceId: "test-service",
        requestId: "req-7",
        timestamp: new Date().toISOString(),
        payload: {},
      };

      messageHandler(Buffer.from(JSON.stringify(message)));

      expect(socket.send).toHaveBeenCalledWith(expect.stringContaining("Unknown message type"));
    });

    it("should handle missing action handler", async () => {
      const server = createSCPServer({ logger });
      const socket = createMockWebSocket();
      const request = createMockRequest("/__openclaw__/scp?serviceId=test-service");

      server.handleUpgrade(request, socket);

      const messageHandler = (socket.on as ReturnType<typeof vi.fn>).mock.calls.find(
        (call) => call[0] === "message",
      )?.[1];

      const message = {
        type: "service.action",
        serviceId: "test-service",
        requestId: "req-8",
        timestamp: new Date().toISOString(),
        payload: {
          action: "some-action",
          params: {},
        },
      };

      messageHandler(Buffer.from(JSON.stringify(message)));

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(socket.send).toHaveBeenCalledWith(
        expect.stringContaining("Action handler not configured"),
      );
    });
  });

  describe("broadcastToService", () => {
    it("should broadcast message to connected service", () => {
      const server = createSCPServer({ logger });
      const socket = createMockWebSocket();
      const request = createMockRequest("/__openclaw__/scp?serviceId=test-service");

      server.handleUpgrade(request, socket);

      const message = {
        type: "agent.stop-request" as const,
        serviceId: "test-service",
        requestId: "req-9",
        timestamp: new Date().toISOString(),
        payload: {
          reason: "test",
        },
      };

      const result = server.broadcastToService("test-service", message);

      expect(result).toBe(true);
      expect(socket.send).toHaveBeenCalledWith(JSON.stringify(message));
    });

    it("should return false when service is not connected", () => {
      const server = createSCPServer({ logger });

      const message = {
        type: "agent.stop-request" as const,
        serviceId: "unknown-service",
        requestId: "req-10",
        timestamp: new Date().toISOString(),
        payload: {
          reason: "test",
        },
      };

      const result = server.broadcastToService("unknown-service", message);

      expect(result).toBe(false);
    });
  });

  describe("getConnectionStats", () => {
    it("should return connection statistics", () => {
      const server = createSCPServer({ logger });
      const socket1 = createMockWebSocket();
      const socket2 = createMockWebSocket();

      server.handleUpgrade(createMockRequest("/__openclaw__/scp?serviceId=service-1"), socket1);
      server.handleUpgrade(createMockRequest("/__openclaw__/scp?serviceId=service-2"), socket2);

      const stats = server.getConnectionStats();

      expect(stats.totalConnections).toBe(2);
      expect(stats.services.size).toBe(2);
      expect(stats.services.has("service-1")).toBe(true);
      expect(stats.services.has("service-2")).toBe(true);
    });

    it("should return empty stats when no connections", () => {
      const server = createSCPServer({ logger });

      const stats = server.getConnectionStats();

      expect(stats.totalConnections).toBe(0);
      expect(stats.services.size).toBe(0);
    });
  });

  describe("close", () => {
    it("should close all connections gracefully", async () => {
      const server = createSCPServer({ logger });
      const socket = createMockWebSocket();

      server.handleUpgrade(createMockRequest("/__openclaw__/scp?serviceId=test-service"), socket);

      const closePromise = server.close();

      const closeHandler = (socket.once as ReturnType<typeof vi.fn>).mock.calls.find(
        (call) => call[0] === "close",
      )?.[1];

      closeHandler();

      await closePromise;

      expect(socket.close).toHaveBeenCalledWith(1001, "Server shutting down");
    });
  });

  describe("disconnect handling", () => {
    it("should call onDisconnect handler", () => {
      const onDisconnect = vi.fn();
      const server = createSCPServer({ logger, onDisconnect });
      const socket = createMockWebSocket();

      server.handleUpgrade(createMockRequest("/__openclaw__/scp?serviceId=test-service"), socket);

      const closeHandler = (socket.on as ReturnType<typeof vi.fn>).mock.calls.find(
        (call) => call[0] === "close",
      )?.[1];

      closeHandler(1000, Buffer.from("Normal closure"));

      expect(onDisconnect).toHaveBeenCalledWith("test-service", expect.any(Object));
    });
  });

  describe("error handling", () => {
    it("should call onError handler", () => {
      const onError = vi.fn();
      const server = createSCPServer({ logger, onError });
      const socket = createMockWebSocket();

      server.handleUpgrade(createMockRequest("/__openclaw__/scp?serviceId=test-service"), socket);

      const errorHandler = (socket.on as ReturnType<typeof vi.fn>).mock.calls.find(
        (call) => call[0] === "error",
      )?.[1];

      const testError = new Error("Test error");
      errorHandler(testError);

      expect(onError).toHaveBeenCalledWith("test-service", testError, expect.any(Object));
    });
  });
});

describe("Utility Functions", () => {
  describe("createStopRequest", () => {
    it("should create a stop request message", () => {
      const message = createStopRequest("test-service", "modal_closed", true);

      expect(message.type).toBe("agent.stop-request");
      expect(message.serviceId).toBe("test-service");
      const payload = message.payload as { reason: string; force?: boolean };
      expect(payload.reason).toBe("modal_closed");
      expect(payload.force).toBe(true);
      expect(message.requestId).toBeDefined();
      expect(message.timestamp).toBeDefined();
    });
  });

  describe("createSuccessResponse", () => {
    it("should create a success response message", () => {
      const data = { taskId: "task-123" };
      const message = createSuccessResponse("test-service", "req-1", data);

      expect(message.type).toBe("agent.response");
      expect(message.serviceId).toBe("test-service");
      expect(message.requestId).toBe("req-1");
      const payload = message.payload as { success: boolean; data?: unknown };
      expect(payload.success).toBe(true);
      expect(payload.data).toEqual(data);
    });

    it("should create a success response without data", () => {
      const message = createSuccessResponse("test-service", "req-2");

      const payload = message.payload as { success: boolean; data?: unknown };
      expect(payload.success).toBe(true);
      expect(payload.data).toBeUndefined();
    });
  });

  describe("createErrorResponse", () => {
    it("should create an error response message", () => {
      const error = {
        code: SCPErrorCodes.ACTION_FAILED,
        message: "Action failed",
        details: { field: "title" },
      };
      const message = createErrorResponse("test-service", "req-3", error);

      expect(message.type).toBe("agent.response");
      expect(message.serviceId).toBe("test-service");
      expect(message.requestId).toBe("req-3");
      const payload = message.payload as { success: boolean; error?: unknown };
      expect(payload.success).toBe(false);
      expect(payload.error).toEqual(error);
    });
  });
});

describe("SCP Error Codes", () => {
  it("should have correct error code ranges", () => {
    expect(SCPErrorCodes.CONNECTION_FAILED).toBe(1000);
    expect(SCPErrorCodes.SERVICE_NOT_FOUND).toBe(2000);
    expect(SCPErrorCodes.ACTION_NOT_FOUND).toBe(3000);
    expect(SCPErrorCodes.PROCESS_SPAWN_FAILED).toBe(4000);
  });
});
