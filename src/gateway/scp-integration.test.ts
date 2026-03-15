import { describe, it, expect, beforeAll, afterAll } from "vitest";
import WebSocket from "ws";
import { SCP_WS_PATH } from "./server-constants.js";
import { createGatewaySuiteHarness } from "./test-helpers.server.js";

describe("Gateway SCP Integration", () => {
  let harness: Awaited<ReturnType<typeof createGatewaySuiteHarness>>;
  let gatewayPort: number;

  beforeAll(async () => {
    harness = await createGatewaySuiteHarness({
      serverOptions: {
        allowCanvasHostInTests: true,
      },
    });
    gatewayPort = harness.port;
  });

  afterAll(async () => {
    await harness.close();
  });

  describe("SCP Endpoint", () => {
    it("should accept WebSocket connection to /__openclaw__/scp", async () => {
      const ws = new WebSocket(
        `ws://localhost:${gatewayPort}${SCP_WS_PATH}?serviceId=test-service`,
      );

      await new Promise<void>((resolve, reject) => {
        ws.on("open", () => {
          resolve();
        });
        ws.on("error", reject);
        setTimeout(() => reject(new Error("Connection timeout")), 5000);
      });

      expect(ws.readyState).toBe(WebSocket.OPEN);
      ws.close();
    });

    it("should handle service.started notification", async () => {
      const ws = new WebSocket(
        `ws://localhost:${gatewayPort}${SCP_WS_PATH}?serviceId=test-service`,
      );

      await new Promise<void>((resolve, reject) => {
        ws.on("open", resolve);
        ws.on("error", reject);
        setTimeout(() => reject(new Error("Connection timeout")), 5000);
      });

      // Send service.started message (notification - no response expected)
      const message = {
        type: "service.started",
        serviceId: "test-service",
        requestId: "req-1",
        timestamp: new Date().toISOString(),
        payload: {
          name: "Test Service",
          version: "1.0.0",
        },
      };

      ws.send(JSON.stringify(message));

      // Wait a bit to ensure message is processed without error
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Connection should still be open (no error response)
      expect(ws.readyState).toBe(WebSocket.OPEN);

      ws.close();
    });

    it("should reject connection without serviceId", async () => {
      const ws = new WebSocket(`ws://localhost:${gatewayPort}${SCP_WS_PATH}`);

      const closeEvent = await new Promise<{ code: number; reason: string }>((resolve) => {
        ws.on("close", (code, reason) => {
          resolve({ code, reason: reason.toString() });
        });
        setTimeout(() => resolve({ code: -1, reason: "timeout" }), 5000);
      });

      expect(closeEvent.code).toBe(1008);
      expect(closeEvent.reason).toContain("serviceId");
    });

    it("should reject connection with invalid serviceId format", async () => {
      const ws = new WebSocket(
        `ws://localhost:${gatewayPort}${SCP_WS_PATH}?serviceId=InvalidServiceID`,
      );

      const closeEvent = await new Promise<{ code: number; reason: string }>((resolve) => {
        ws.on("close", (code, reason) => {
          resolve({ code, reason: reason.toString() });
        });
        setTimeout(() => resolve({ code: -1, reason: "timeout" }), 5000);
      });

      expect(closeEvent.code).toBe(1008);
      expect(closeEvent.reason).toContain("Invalid");
    });
  });
});
