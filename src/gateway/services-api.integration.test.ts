/**
 * Integration tests for Gateway Service API Proxy
 *
 * Tests the full request flow: HTTP request -> Gateway -> SCP -> Service
 */

import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, it, expect, vi } from "vitest";
import type { ServiceLifecycleManager } from "../services/lifecycle.js";
import type { SCPServer, ServiceApiResponse } from "../services/scp-server.js";
import { SCPErrorCodes } from "../services/scp-server.js";
import { handleServicesApiRequest, type ServicesApiDeps } from "./services-api.js";

function createMockRequest(url: string, method: string = "POST", body?: unknown): IncomingMessage {
  const req = new EventEmitter() as IncomingMessage;
  req.url = url;
  req.method = method;
  req.headers = { "content-type": "application/json" };

  setTimeout(() => {
    if (body) {
      req.emit("data", Buffer.from(JSON.stringify(body)));
    }
    req.emit("end");
  }, 0);

  return req;
}

interface MockResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string | null;
  setHeader: (name: string, value: string) => void;
  end: (body: string) => void;
}

function createMockResponse(): MockResponse {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name: string, value: string) {
      this.headers[name] = value;
    },
    end(body: string) {
      this.body = body;
    },
  };
}

describe("Service API Proxy Integration", () => {
  describe("Full request flow", () => {
    it("should handle complete request-response cycle", async () => {
      const mockSendActionAndWait = vi.fn<() => Promise<ServiceApiResponse>>().mockResolvedValue({
        success: true,
        data: { path: "/data/saved.txt", content: "test content" },
      });

      const mockScpServer = {
        sendActionAndWait: mockSendActionAndWait,
        handleUpgrade: vi.fn(),
        broadcastToService: vi.fn(),
        getConnectionStats: vi.fn(),
        close: vi.fn(),
      } as unknown as SCPServer;

      const mockLifecycleManager = {
        getServiceState: vi.fn().mockReturnValue({
          serviceId: "test-service",
          state: "started",
        }),
      } as unknown as ServiceLifecycleManager;

      const deps: ServicesApiDeps = {
        scpServer: mockScpServer,
        lifecycleManager: mockLifecycleManager,
      };

      const mockRes = createMockResponse();
      const req = createMockRequest("/__openclaw__/services/test-service/api/save", "POST", {
        params: { content: "test content" },
      });

      const handled = await handleServicesApiRequest(
        req,
        mockRes as unknown as ServerResponse,
        deps,
      );

      expect(handled).toBe(true);
      expect(mockRes.statusCode).toBe(200);
      expect(mockSendActionAndWait).toHaveBeenCalledWith(
        "test-service",
        "save",
        { content: "test content" },
        30000,
      );

      const body = JSON.parse(mockRes.body as string);
      expect(body.success).toBe(true);
      expect(body.data.path).toBe("/data/saved.txt");
    });

    it("should handle concurrent requests to different services", async () => {
      const mockSendActionAndWait = vi
        .fn<
          (
            serviceId: string,
            action: string,
            params: unknown,
            timeout: number,
          ) => Promise<ServiceApiResponse>
        >()
        .mockImplementation(async (serviceId: string, action: string) => {
          await new Promise((r) => setTimeout(r, 10));
          return {
            success: true,
            data: { serviceId, action, processed: true },
          };
        });

      const mockScpServer = {
        sendActionAndWait: mockSendActionAndWait,
        handleUpgrade: vi.fn(),
        broadcastToService: vi.fn(),
        getConnectionStats: vi.fn(),
        close: vi.fn(),
      } as unknown as SCPServer;

      const mockLifecycleManager = {
        getServiceState: vi.fn().mockImplementation((serviceId: string) => ({
          serviceId,
          state: "started",
        })),
      } as unknown as ServiceLifecycleManager;

      const deps: ServicesApiDeps = {
        scpServer: mockScpServer,
        lifecycleManager: mockLifecycleManager,
      };

      const requests = [
        { serviceId: "service-a", action: "action1", params: { data: "a" } },
        { serviceId: "service-b", action: "action2", params: { data: "b" } },
        { serviceId: "service-c", action: "action3", params: { data: "c" } },
      ];

      const results = await Promise.all(
        requests.map(async (req) => {
          const mockRes = createMockResponse();
          const httpRequest = createMockRequest(
            `/__openclaw__/services/${req.serviceId}/api/${req.action}`,
            "POST",
            { params: req.params },
          );

          await handleServicesApiRequest(httpRequest, mockRes as unknown as ServerResponse, deps);

          return {
            serviceId: req.serviceId,
            statusCode: mockRes.statusCode,
            body: JSON.parse(mockRes.body as string),
          };
        }),
      );

      expect(results).toHaveLength(3);
      results.forEach((r) => {
        expect(r.statusCode).toBe(200);
        expect(r.body.success).toBe(true);
      });

      expect(mockSendActionAndWait).toHaveBeenCalledTimes(3);
    });

    it("should handle service offline scenario", async () => {
      const mockScpServer = {
        sendActionAndWait: vi.fn(),
        handleUpgrade: vi.fn(),
        broadcastToService: vi.fn(),
        getConnectionStats: vi.fn(),
        close: vi.fn(),
      } as unknown as SCPServer;

      const mockLifecycleManager = {
        getServiceState: vi.fn().mockReturnValue(undefined),
      } as unknown as ServiceLifecycleManager;

      const deps: ServicesApiDeps = {
        scpServer: mockScpServer,
        lifecycleManager: mockLifecycleManager,
      };

      const mockRes = createMockResponse();
      const req = createMockRequest("/__openclaw__/services/offline-service/api/test", "POST", {
        params: {},
      });

      const handled = await handleServicesApiRequest(
        req,
        mockRes as unknown as ServerResponse,
        deps,
      );

      expect(handled).toBe(true);
      expect(mockRes.statusCode).toBe(503);
      expect(mockScpServer.sendActionAndWait).not.toHaveBeenCalled();

      const body = JSON.parse(mockRes.body as string);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe(SCPErrorCodes.SERVICE_NOT_FOUND);
    });

    it("should handle timeout scenario", async () => {
      const mockSendActionAndWait = vi.fn<() => Promise<ServiceApiResponse>>().mockResolvedValue({
        success: false,
        error: { code: SCPErrorCodes.TIMEOUT, message: "Request timed out" },
      });

      const mockScpServer = {
        sendActionAndWait: mockSendActionAndWait,
        handleUpgrade: vi.fn(),
        broadcastToService: vi.fn(),
        getConnectionStats: vi.fn(),
        close: vi.fn(),
      } as unknown as SCPServer;

      const mockLifecycleManager = {
        getServiceState: vi.fn().mockReturnValue({
          serviceId: "slow-service",
          state: "started",
        }),
      } as unknown as ServiceLifecycleManager;

      const deps: ServicesApiDeps = {
        scpServer: mockScpServer,
        lifecycleManager: mockLifecycleManager,
      };

      const mockRes = createMockResponse();
      const req = createMockRequest("/__openclaw__/services/slow-service/api/slow-action", "POST", {
        params: {},
      });

      const handled = await handleServicesApiRequest(
        req,
        mockRes as unknown as ServerResponse,
        deps,
      );

      expect(handled).toBe(true);
      expect(mockRes.statusCode).toBe(504);

      const body = JSON.parse(mockRes.body as string);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe(SCPErrorCodes.TIMEOUT);
    });

    it("should handle action failure scenario", async () => {
      const mockSendActionAndWait = vi.fn<() => Promise<ServiceApiResponse>>().mockResolvedValue({
        success: false,
        error: { code: SCPErrorCodes.ACTION_FAILED, message: "Failed to process action" },
      });

      const mockScpServer = {
        sendActionAndWait: mockSendActionAndWait,
        handleUpgrade: vi.fn(),
        broadcastToService: vi.fn(),
        getConnectionStats: vi.fn(),
        close: vi.fn(),
      } as unknown as SCPServer;

      const mockLifecycleManager = {
        getServiceState: vi.fn().mockReturnValue({
          serviceId: "test-service",
          state: "started",
        }),
      } as unknown as ServiceLifecycleManager;

      const deps: ServicesApiDeps = {
        scpServer: mockScpServer,
        lifecycleManager: mockLifecycleManager,
      };

      const mockRes = createMockResponse();
      const req = createMockRequest(
        "/__openclaw__/services/test-service/api/failing-action",
        "POST",
        { params: {} },
      );

      const handled = await handleServicesApiRequest(
        req,
        mockRes as unknown as ServerResponse,
        deps,
      );

      expect(handled).toBe(true);
      expect(mockRes.statusCode).toBe(500);

      const body = JSON.parse(mockRes.body as string);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe(SCPErrorCodes.ACTION_FAILED);
    });
  });

  describe("Error response format", () => {
    it("should return consistent error format for all error types", async () => {
      const errorScenarios = [
        {
          statusCode: 503,
          mockState: undefined,
          mockResponse: undefined,
          expectedCode: SCPErrorCodes.SERVICE_NOT_FOUND,
        },
        {
          statusCode: 504,
          mockState: { serviceId: "test", state: "started" },
          mockResponse: {
            success: false,
            error: { code: SCPErrorCodes.TIMEOUT, message: "Timeout" },
          },
          expectedCode: SCPErrorCodes.TIMEOUT,
        },
        {
          statusCode: 500,
          mockState: { serviceId: "test", state: "started" },
          mockResponse: {
            success: false,
            error: { code: SCPErrorCodes.ACTION_FAILED, message: "Failed" },
          },
          expectedCode: SCPErrorCodes.ACTION_FAILED,
        },
      ];

      for (const scenario of errorScenarios) {
        const mockScpServer = {
          sendActionAndWait: vi
            .fn<() => Promise<ServiceApiResponse>>()
            .mockResolvedValue(scenario.mockResponse as ServiceApiResponse),
          handleUpgrade: vi.fn(),
          broadcastToService: vi.fn(),
          getConnectionStats: vi.fn(),
          close: vi.fn(),
        } as unknown as SCPServer;

        const mockLifecycleManager = {
          getServiceState: vi.fn().mockReturnValue(scenario.mockState),
        } as unknown as ServiceLifecycleManager;

        const deps: ServicesApiDeps = {
          scpServer: mockScpServer,
          lifecycleManager: mockLifecycleManager,
        };

        const mockRes = createMockResponse();
        const req = createMockRequest("/__openclaw__/services/test/api/action", "POST", {
          params: {},
        });

        await handleServicesApiRequest(req, mockRes as unknown as ServerResponse, deps);

        expect(mockRes.statusCode).toBe(scenario.statusCode);

        const body = JSON.parse(mockRes.body as string);
        expect(body).toHaveProperty("success", false);
        expect(body).toHaveProperty("error");
        expect(body.error).toHaveProperty("code", scenario.expectedCode);
        expect(body.error).toHaveProperty("message");
        expect(typeof body.error.message).toBe("string");
      }
    });
  });
});
