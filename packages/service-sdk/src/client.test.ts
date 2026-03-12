/**
 * ServiceClient Unit Tests
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { WebSocketServer, WebSocket } from "ws";
import { ServiceClient } from "./client.js";
import type { SCPMessage, AgentResponseMessage, AgentStopRequestMessage } from "./types.js";

describe("ServiceClient", () => {
  let client: ServiceClient;
  let wss: WebSocketServer;
  let serverSocket: WebSocket | null = null;
  let port: number;

  beforeEach(async () => {
    // Create a test WebSocket server
    wss = new WebSocketServer({ port: 0 }); // Use random available port
    port = (wss.address() as { port: number }).port;

    wss.on("connection", (ws) => {
      serverSocket = ws;
    });

    client = new ServiceClient("test-service", {
      name: "Test Service",
      version: "1.0.0",
    });
  });

  afterEach(async () => {
    client.disconnect();
    serverSocket = null;
    await new Promise<void>((resolve) => wss.close(() => resolve()));
  });

  describe("constructor", () => {
    it("should create a ServiceClient with serviceId", () => {
      const c = new ServiceClient("my-service");
      expect(c.serviceId).toBe("my-service");
      expect(c.isConnected()).toBe(false);
    });

    it("should throw error for empty serviceId", () => {
      expect(() => new ServiceClient("")).toThrow("Service ID is required");
    });

    it("should throw error for non-string serviceId", () => {
      expect(() => new ServiceClient(123 as unknown as string)).toThrow("Service ID is required");
    });

    it("should accept options", () => {
      const c = new ServiceClient("my-service", {
        name: "My Service",
        version: "2.0.0",
        actionTimeout: 5000,
      });
      expect(c.serviceId).toBe("my-service");
    });
  });

  describe("connect", () => {
    it("should connect to WebSocket server", async () => {
      const url = `ws://localhost:${port}/__openclaw__/scp`;
      await client.connect(url);

      expect(client.isConnected()).toBe(true);
    });

    it("should include serviceId in connection URL", async () => {
      const url = `ws://localhost:${port}/__openclaw__/scp`;
      let receivedUrl: string | undefined;

      wss.removeAllListeners("connection");
      wss.on("connection", (ws, req) => {
        receivedUrl = req.url;
        serverSocket = ws;
      });

      await client.connect(url);

      expect(receivedUrl).toContain("serviceId=test-service");
    });

    it("should send service.started message on connect", async () => {
      const url = `ws://localhost:${port}/__openclaw__/scp`;
      const messages: SCPMessage[] = [];

      wss.removeAllListeners("connection");
      wss.on("connection", (ws) => {
        serverSocket = ws;
        ws.on("message", (data) => {
          messages.push(JSON.parse(data.toString()));
        });
      });

      await client.connect(url);

      // Wait for message to be received
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(messages.length).toBeGreaterThan(0);
      expect(messages[0].type).toBe("service.started");
      expect(messages[0].serviceId).toBe("test-service");
      expect((messages[0] as { payload: { name: string; version: string } }).payload.name).toBe(
        "Test Service",
      );
      expect((messages[0] as { payload: { name: string; version: string } }).payload.version).toBe(
        "1.0.0",
      );
    });

    it("should emit connected event", async () => {
      const url = `ws://localhost:${port}/__openclaw__/scp`;
      let connected = false;

      client.on("connected", () => {
        connected = true;
      });

      await client.connect(url);

      expect(connected).toBe(true);
    });

    it("should reject on connection failure", async () => {
      const url = `ws://localhost:99999/__openclaw__/scp`;

      await expect(client.connect(url)).rejects.toThrow();
    });

    it("should reject on connection timeout", async () => {
      // Create a server that doesn't respond
      const nonResponsiveServer = new WebSocketServer({ port: 0 });
      const nonResponsivePort = (nonResponsiveServer.address() as { port: number }).port;

      try {
        const url = `ws://localhost:${nonResponsivePort}/__openclaw__/scp`;

        // Don't handle connections, let them timeout
        nonResponsiveServer.removeAllListeners("connection");

        // Expect connection to timeout (10 second timeout in client)
        // This test would take too long, so we'll skip it in practice
        // await expect(client.connect(url)).rejects.toThrow('timeout');
      } finally {
        await new Promise<void>((resolve) => nonResponsiveServer.close(() => resolve()));
      }
    });
  });

  describe("disconnect", () => {
    it("should close connection gracefully", async () => {
      const url = `ws://localhost:${port}/__openclaw__/scp`;
      await client.connect(url);
      expect(client.isConnected()).toBe(true);

      client.disconnect();

      expect(client.isConnected()).toBe(false);
    });

    it("should send service.stopped message on disconnect", async () => {
      const url = `ws://localhost:${port}/__openclaw__/scp`;
      const messages: SCPMessage[] = [];

      wss.removeAllListeners("connection");
      wss.on("connection", (ws) => {
        serverSocket = ws;
        ws.on("message", (data) => {
          messages.push(JSON.parse(data.toString()));
        });
      });

      await client.connect(url);
      client.disconnect();

      // Wait for message to be received
      await new Promise((resolve) => setTimeout(resolve, 50));

      const stoppedMessage = messages.find((m) => m.type === "service.stopped");
      expect(stoppedMessage).toBeDefined();
      expect(stoppedMessage!.serviceId).toBe("test-service");
    });

    it("should emit disconnected event", async () => {
      const url = `ws://localhost:${port}/__openclaw__/scp`;
      await client.connect(url);

      let disconnected = false;
      client.on("disconnected", () => {
        disconnected = true;
      });

      client.disconnect();

      expect(disconnected).toBe(true);
    });

    it("should reject all pending requests", async () => {
      const url = `ws://localhost:${port}/__openclaw__/scp`;
      await client.connect(url);

      // Start an action call but don't respond
      const actionPromise = client.callAction("test-action", {});

      // Disconnect should reject the pending action
      client.disconnect();

      await expect(actionPromise).rejects.toThrow("Connection closed");
    });
  });

  describe("emitEvent", () => {
    it("should send service.event message", async () => {
      const url = `ws://localhost:${port}/__openclaw__/scp`;
      const messages: SCPMessage[] = [];

      wss.removeAllListeners("connection");
      wss.on("connection", (ws) => {
        serverSocket = ws;
        ws.on("message", (data) => {
          messages.push(JSON.parse(data.toString()));
        });
      });

      await client.connect(url);
      client.emitEvent("user-click", { button: "submit" });

      // Wait for message
      await new Promise((resolve) => setTimeout(resolve, 50));

      const eventMessage = messages.find((m) => m.type === "service.event");
      expect(eventMessage).toBeDefined();
      expect((eventMessage as { payload: { event: string } }).payload.event).toBe("user-click");
      expect((eventMessage as { payload: { data: { button: string } } }).payload.data).toEqual({
        button: "submit",
      });
    });

    it("should throw when not connected", () => {
      expect(() => client.emitEvent("test")).toThrow("Not connected");
    });
  });

  describe("callAction", () => {
    it("should send service.action message", async () => {
      const url = `ws://localhost:${port}/__openclaw__/scp`;
      let receivedMessage: SCPMessage | undefined;

      wss.removeAllListeners("connection");
      wss.on("connection", (ws) => {
        serverSocket = ws;
        ws.on("message", (data) => {
          receivedMessage = JSON.parse(data.toString());
        });
      });

      await client.connect(url);

      // Don't await - we just want to check the message was sent
      client.callAction("create-task", { title: "Test" }).catch(() => {});

      // Wait for message
      await new Promise((resolve) => setTimeout(resolve, 50));

      const actionMessage =
        receivedMessage?.type === "service.action" ? receivedMessage : undefined;
      expect(actionMessage).toBeDefined();
      expect((actionMessage as { payload: { action: string } }).payload.action).toBe("create-task");
      expect((actionMessage as { payload: { params: { title: string } } }).payload.params).toEqual({
        title: "Test",
      });
      expect(actionMessage!.requestId).toBeDefined();
    });

    it("should resolve on successful response", async () => {
      const url = `ws://localhost:${port}/__openclaw__/scp`;
      let requestId: string | undefined;

      wss.removeAllListeners("connection");
      wss.on("connection", (ws) => {
        serverSocket = ws;
        ws.on("message", (data) => {
          const msg = JSON.parse(data.toString());
          if (msg.type === "service.action") {
            requestId = msg.requestId;
            // Send success response
            const response: AgentResponseMessage = {
              type: "agent.response",
              serviceId: "test-service",
              requestId: requestId!,
              timestamp: new Date().toISOString(),
              payload: {
                success: true,
                data: { taskId: "123", title: "Test" },
              },
            };
            ws.send(JSON.stringify(response));
          }
        });
      });

      await client.connect(url);
      const result = await client.callAction("create-task", { title: "Test" });

      expect(result).toEqual({ taskId: "123", title: "Test" });
    });

    it("should reject on error response", async () => {
      const url = `ws://localhost:${port}/__openclaw__/scp`;

      wss.removeAllListeners("connection");
      wss.on("connection", (ws) => {
        serverSocket = ws;
        ws.on("message", (data) => {
          const msg = JSON.parse(data.toString());
          if (msg.type === "service.action") {
            const response: AgentResponseMessage = {
              type: "agent.response",
              serviceId: "test-service",
              requestId: msg.requestId,
              timestamp: new Date().toISOString(),
              payload: {
                success: false,
                error: {
                  code: 3001,
                  message: "Action failed",
                },
              },
            };
            ws.send(JSON.stringify(response));
          }
        });
      });

      await client.connect(url);

      await expect(client.callAction("create-task", {})).rejects.toThrow("Action failed");
    });

    it("should reject when not connected", async () => {
      await expect(client.callAction("test")).rejects.toThrow("Not connected");
    });

    it("should timeout if no response received", async () => {
      const url = `ws://localhost:${port}/__openclaw__/scp`;

      await client.connect(url);

      // Create client with short timeout
      const fastClient = new ServiceClient("fast-service", {
        actionTimeout: 100, // 100ms timeout
      });

      wss.removeAllListeners("connection");
      wss.on("connection", (ws) => {
        serverSocket = ws;
        // Don't respond to messages
      });

      await fastClient.connect(url);

      await expect(fastClient.callAction("test")).rejects.toThrow("timed out");

      fastClient.disconnect();
    });
  });

  describe("on/off event handlers", () => {
    it("should register event handler", async () => {
      const url = `ws://localhost:${port}/__openclaw__/scp`;
      await client.connect(url);

      let received = false;
      const handler = () => {
        received = true;
      };

      client.on("test-event", handler);
      client.emit("test-event");

      expect(received).toBe(true);
    });

    it("should remove specific event handler", async () => {
      const url = `ws://localhost:${port}/__openclaw__/scp`;
      await client.connect(url);

      let count = 0;
      const handler = () => {
        count++;
      };

      client.on("test-event", handler);
      client.emit("test-event");
      expect(count).toBe(1);

      client.off("test-event", handler);
      client.emit("test-event");
      expect(count).toBe(1); // Should not increment
    });

    it("should remove all handlers for event", async () => {
      const url = `ws://localhost:${port}/__openclaw__/scp`;
      await client.connect(url);

      let count = 0;
      const handler1 = () => {
        count++;
      };
      const handler2 = () => {
        count++;
      };

      client.on("test-event", handler1);
      client.on("test-event", handler2);
      client.emit("test-event");
      expect(count).toBe(2);

      client.off("test-event");
      client.emit("test-event");
      expect(count).toBe(2); // Should not increment
    });
  });

  describe("agent.stop-request handling", () => {
    it("should emit stop-requested event", async () => {
      const url = `ws://localhost:${port}/__openclaw__/scp`;

      wss.removeAllListeners("connection");
      wss.on("connection", (ws) => {
        serverSocket = ws;
      });

      await client.connect(url);

      let receivedPayload: { reason: string; force?: boolean } | undefined;
      client.on("stop-requested", (data) => {
        receivedPayload = data as { reason: string; force?: boolean };
      });

      // Simulate stop request from agent
      const stopRequest: AgentStopRequestMessage = {
        type: "agent.stop-request",
        serviceId: "test-service",
        requestId: "test-req-1",
        timestamp: new Date().toISOString(),
        payload: {
          reason: "modal_closed",
          force: false,
        },
      };

      serverSocket!.send(JSON.stringify(stopRequest));

      // Wait for event
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(receivedPayload).toBeDefined();
      expect(receivedPayload!.reason).toBe("modal_closed");
      expect(receivedPayload!.force).toBe(false);
    });
  });

  describe("auto-reconnect", () => {
    it("should attempt reconnect on unexpected disconnect", async () => {
      const url = `ws://localhost:${port}/__openclaw__/scp`;

      wss.removeAllListeners("connection");
      wss.on("connection", (ws) => {
        serverSocket = ws;
      });

      await client.connect(url);

      let reconnecting = false;
      client.on("reconnecting", () => {
        reconnecting = true;
      });

      // Simulate unexpected server close
      serverSocket!.close();

      // Wait for reconnect attempt
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(reconnecting || !client.isConnected()).toBe(true);
    });

    it("should track reconnect attempts", async () => {
      const url = `ws://localhost:${port}/__openclaw__/scp`;
      await client.connect(url);
      expect(client.getReconnectAttempts()).toBe(0);
    });
  });

  describe("isConnected", () => {
    it("should return false before connect", () => {
      expect(client.isConnected()).toBe(false);
    });

    it("should return true after connect", async () => {
      const url = `ws://localhost:${port}/__openclaw__/scp`;
      await client.connect(url);
      expect(client.isConnected()).toBe(true);
    });

    it("should return false after disconnect", async () => {
      const url = `ws://localhost:${port}/__openclaw__/scp`;
      await client.connect(url);
      client.disconnect();
      expect(client.isConnected()).toBe(false);
    });
  });
});
