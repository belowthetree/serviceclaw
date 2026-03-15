/**
 * Unit tests for Gateway Service API Proxy
 */

import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ServiceLifecycleManager } from "../services/lifecycle.js";
import type { SCPServer, ServiceApiResponse } from "../services/scp-server.js";
import { SCPErrorCodes } from "../services/scp-server.js";
import {
  parseServiceApiPath,
  handleServicesApiRequest,
  type ServicesApiDeps,
} from "./services-api.js";

function createMockRequest(url: string, method: string = "POST", body?: unknown): IncomingMessage {
  const req = new EventEmitter() as IncomingMessage;
  req.url = url;
  req.method = method;
  req.headers = {};

  setTimeout(() => {
    if (body) {
      req.emit("data", Buffer.from(JSON.stringify(body)));
      req.emit("end");
    } else {
      req.emit("end");
    }
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

describe("parseServiceApiPath", () => {
  it("should parse valid API path", () => {
    const result = parseServiceApiPath("/__openclaw__/services/helloworld/api/save");
    expect(result).toEqual({ serviceId: "helloworld", action: "save" });
  });

  it("should parse path with nested action", () => {
    const result = parseServiceApiPath("/__openclaw__/services/my-service/api/data/fetch");
    expect(result).toEqual({ serviceId: "my-service", action: "data/fetch" });
  });

  it("should return null for non-API path", () => {
    const result = parseServiceApiPath("/__openclaw__/services/helloworld/index.html");
    expect(result).toBeNull();
  });

  it("should return null for missing serviceId", () => {
    const result = parseServiceApiPath("/__openclaw__/services//api/save");
    expect(result).toBeNull();
  });

  it("should return null for missing action", () => {
    const result = parseServiceApiPath("/__openclaw__/services/helloworld/api/");
    expect(result).toBeNull();
  });

  it("should return null for wrong prefix", () => {
    const result = parseServiceApiPath("/services/helloworld/api/save");
    expect(result).toBeNull();
  });

  it("should return null for path without api segment", () => {
    const result = parseServiceApiPath("/__openclaw__/services/helloworld");
    expect(result).toBeNull();
  });
});

describe("handleServicesApiRequest", () => {
  let mockScpServer: SCPServer;
  let mockLifecycleManager: ServiceLifecycleManager;
  let deps: ServicesApiDeps;

  beforeEach(() => {
    mockScpServer = {
      sendActionAndWait: vi.fn<() => Promise<ServiceApiResponse>>(),
      handleUpgrade: vi.fn(),
      broadcastToService: vi.fn(),
      getConnectionStats: vi.fn(),
      close: vi.fn(),
    } as unknown as SCPServer;

    mockLifecycleManager = {
      getServiceState: vi.fn(),
    } as unknown as ServiceLifecycleManager;

    deps = {
      scpServer: mockScpServer,
      lifecycleManager: mockLifecycleManager,
    };
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it("should return false for non-API path", async () => {
    const mockRes = createMockResponse();
    const req = createMockRequest("/__openclaw__/services/helloworld/index.html");

    const result = await handleServicesApiRequest(req, mockRes as unknown as ServerResponse, deps);
    expect(result).toBe(false);
  });

  it("should return 405 for non-POST methods", async () => {
    const mockRes = createMockResponse();
    const req = createMockRequest("/__openclaw__/services/helloworld/api/save", "GET");

    const result = await handleServicesApiRequest(req, mockRes as unknown as ServerResponse, deps);
    expect(result).toBe(true);
    expect(mockRes.statusCode).toBe(405);
  });

  it("should return 503 when service is not running", async () => {
    vi.mocked(mockLifecycleManager.getServiceState.bind(mockLifecycleManager)).mockReturnValue(
      undefined,
    );

    const mockRes = createMockResponse();
    const req = createMockRequest("/__openclaw__/services/helloworld/api/save", "POST", {
      params: { content: "test" },
    });

    const result = await handleServicesApiRequest(req, mockRes as unknown as ServerResponse, deps);
    expect(result).toBe(true);
    expect(mockRes.statusCode).toBe(503);

    const body = JSON.parse(mockRes.body as string);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe(SCPErrorCodes.SERVICE_NOT_FOUND);
  });

  it("should return 503 when service state is not started", async () => {
    vi.mocked(mockLifecycleManager.getServiceState.bind(mockLifecycleManager)).mockReturnValue({
      serviceId: "helloworld",
      state: "stopped",
    });

    const mockRes = createMockResponse();
    const req = createMockRequest("/__openclaw__/services/helloworld/api/save", "POST", {
      params: { content: "test" },
    });

    const result = await handleServicesApiRequest(req, mockRes as unknown as ServerResponse, deps);
    expect(result).toBe(true);
    expect(mockRes.statusCode).toBe(503);
  });

  it("should return 200 with success response", async () => {
    vi.mocked(mockLifecycleManager.getServiceState.bind(mockLifecycleManager)).mockReturnValue({
      serviceId: "helloworld",
      state: "started",
    });
    vi.mocked(mockScpServer.sendActionAndWait).mockResolvedValue({
      success: true,
      data: { path: "/data/user-input.txt" },
    });

    const mockRes = createMockResponse();
    const req = createMockRequest("/__openclaw__/services/helloworld/api/save", "POST", {
      params: { content: "test" },
    });

    const result = await handleServicesApiRequest(req, mockRes as unknown as ServerResponse, deps);
    expect(result).toBe(true);
    expect(mockRes.statusCode).toBe(200);

    const body = JSON.parse(mockRes.body as string);
    expect(body.success).toBe(true);
    expect(body.data.path).toBe("/data/user-input.txt");
  });

  it("should return 504 on timeout", async () => {
    vi.mocked(mockLifecycleManager.getServiceState.bind(mockLifecycleManager)).mockReturnValue({
      serviceId: "helloworld",
      state: "started",
    });
    vi.mocked(mockScpServer.sendActionAndWait).mockResolvedValue({
      success: false,
      error: { code: SCPErrorCodes.TIMEOUT, message: "Request timed out" },
    });

    const mockRes = createMockResponse();
    const req = createMockRequest("/__openclaw__/services/helloworld/api/save", "POST", {
      params: { content: "test" },
    });

    const result = await handleServicesApiRequest(req, mockRes as unknown as ServerResponse, deps);
    expect(result).toBe(true);
    expect(mockRes.statusCode).toBe(504);
  });

  it("should return 500 on other errors", async () => {
    vi.mocked(mockLifecycleManager.getServiceState.bind(mockLifecycleManager)).mockReturnValue({
      serviceId: "helloworld",
      state: "started",
    });
    vi.mocked(mockScpServer.sendActionAndWait).mockResolvedValue({
      success: false,
      error: { code: SCPErrorCodes.ACTION_FAILED, message: "Action failed" },
    });

    const mockRes = createMockResponse();
    const req = createMockRequest("/__openclaw__/services/helloworld/api/save", "POST", {
      params: { content: "test" },
    });

    const result = await handleServicesApiRequest(req, mockRes as unknown as ServerResponse, deps);
    expect(result).toBe(true);
    expect(mockRes.statusCode).toBe(500);
  });
});
