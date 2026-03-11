import { beforeEach, describe, expect, it, vi } from "vitest";
import { ServiceNotFoundError, InvalidStateTransitionError } from "../../services/registry.js";
import { ErrorCodes } from "../protocol/index.js";
import { servicesHandlers } from "./services.js";
import type { GatewayRequestContext } from "./types.js";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  enable: vi.fn(),
  disable: vi.fn(),
}));

vi.mock("../../services/registry.js", () => ({
  getServiceRegistry: () => ({
    list: mocks.list,
    enable: mocks.enable,
    disable: mocks.disable,
  }),
  ServiceNotFoundError: class ServiceNotFoundError extends Error {
    constructor(serviceId: string) {
      super(`Service not found: ${serviceId}`);
      this.name = "ServiceNotFoundError";
    }
  },
  InvalidStateTransitionError: class InvalidStateTransitionError extends Error {
    constructor(from: string, to: string) {
      super(`Invalid state transition from ${from} to ${to}`);
      this.name = "InvalidStateTransitionError";
    }
  },
}));

const makeContext = (): GatewayRequestContext =>
  ({
    dedupe: new Map(),
  }) as unknown as GatewayRequestContext;

async function runServicesStatus() {
  const respond = vi.fn();
  await servicesHandlers["services.status"]({
    params: {},
    respond,
    context: makeContext(),
    req: { type: "req", id: "1", method: "services.status" },
    client: null,
    isWebchatConnect: () => false,
  });
  return { respond };
}

describe("services.status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns list of services on success", async () => {
    const mockServices = [
      {
        id: "service-1",
        name: "Test Service 1",
        state: "enabled" as const,
        triggerType: "cron" as const,
        category: "automation",
        updatedAt: "2025-01-01T00:00:00Z",
      },
      {
        id: "service-2",
        name: "Test Service 2",
        state: "disabled" as const,
        triggerType: "webhook" as const,
        category: "integration",
        updatedAt: "2025-01-02T00:00:00Z",
      },
    ];
    mocks.list.mockResolvedValue(mockServices);

    const { respond } = await runServicesStatus();

    expect(mocks.list).toHaveBeenCalledTimes(1);
    expect(respond).toHaveBeenCalledWith(true, { services: mockServices }, undefined);
  });

  it("returns empty array when no services", async () => {
    mocks.list.mockResolvedValue([]);

    const { respond } = await runServicesStatus();

    expect(mocks.list).toHaveBeenCalledTimes(1);
    expect(respond).toHaveBeenCalledWith(true, { services: [] }, undefined);
  });

  it("handles errors gracefully", async () => {
    mocks.list.mockRejectedValue(new Error("Registry unavailable"));

    const { respond } = await runServicesStatus();

    expect(mocks.list).toHaveBeenCalledTimes(1);
    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({
        code: "UNAVAILABLE",
        message: expect.stringContaining("Registry unavailable"),
      }),
    );
  });
});

describe("services.enable", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function runServicesEnable(params: Record<string, unknown>) {
    const respond = vi.fn();
    await servicesHandlers["services.enable"]({
      params,
      respond,
      context: makeContext(),
      req: { type: "req", id: "1", method: "services.enable" },
      client: null,
      isWebchatConnect: () => false,
    });
    return { respond };
  }

  it("enables a disabled service successfully", async () => {
    mocks.enable.mockResolvedValue(undefined);

    const { respond } = await runServicesEnable({ serviceId: "svc-1" });

    expect(mocks.enable).toHaveBeenCalledWith("svc-1");
    expect(respond).toHaveBeenCalledWith(true, { ok: true }, undefined);
  });

  it("returns NOT_FOUND error for non-existent service", async () => {
    mocks.enable.mockRejectedValue(new ServiceNotFoundError("non-existent"));

    const { respond } = await runServicesEnable({ serviceId: "non-existent" });

    expect(mocks.enable).toHaveBeenCalledWith("non-existent");
    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({
        code: ErrorCodes.NOT_FOUND,
        message: "Service not found",
      }),
    );
  });

  it("returns INVALID_STATE error for invalid state transition", async () => {
    mocks.enable.mockRejectedValue(new InvalidStateTransitionError("enabled", "enabled"));

    const { respond } = await runServicesEnable({ serviceId: "svc-1" });

    expect(mocks.enable).toHaveBeenCalledWith("svc-1");
    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({
        code: ErrorCodes.INVALID_STATE,
        message: expect.stringContaining("Invalid state transition"),
      }),
    );
  });

  it("returns INVALID_REQUEST for missing serviceId", async () => {
    const { respond } = await runServicesEnable({});

    expect(mocks.enable).not.toHaveBeenCalled();
    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({
        code: ErrorCodes.INVALID_REQUEST,
        message: expect.stringContaining("serviceId is required"),
      }),
    );
  });

  it("returns INVALID_REQUEST for non-string serviceId", async () => {
    const { respond } = await runServicesEnable({ serviceId: 123 });

    expect(mocks.enable).not.toHaveBeenCalled();
    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({
        code: ErrorCodes.INVALID_REQUEST,
        message: expect.stringContaining("serviceId is required"),
      }),
    );
  });
});

describe("services.disable", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function runServicesDisable(params: Record<string, unknown>) {
    const respond = vi.fn();
    await servicesHandlers["services.disable"]({
      params,
      respond,
      context: makeContext(),
      req: { type: "req", id: "1", method: "services.disable" },
      client: null,
      isWebchatConnect: () => false,
    });
    return { respond };
  }

  it("disables an enabled service successfully", async () => {
    mocks.disable.mockResolvedValue(undefined);

    const { respond } = await runServicesDisable({ serviceId: "svc-1" });

    expect(mocks.disable).toHaveBeenCalledWith("svc-1");
    expect(respond).toHaveBeenCalledWith(true, { ok: true }, undefined);
  });

  it("returns NOT_FOUND error for non-existent service", async () => {
    mocks.disable.mockRejectedValue(new ServiceNotFoundError("non-existent"));

    const { respond } = await runServicesDisable({ serviceId: "non-existent" });

    expect(mocks.disable).toHaveBeenCalledWith("non-existent");
    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({
        code: ErrorCodes.NOT_FOUND,
        message: "Service not found",
      }),
    );
  });

  it("returns INVALID_STATE error for invalid state transition", async () => {
    mocks.disable.mockRejectedValue(new InvalidStateTransitionError("disabled", "disabled"));

    const { respond } = await runServicesDisable({ serviceId: "svc-1" });

    expect(mocks.disable).toHaveBeenCalledWith("svc-1");
    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({
        code: ErrorCodes.INVALID_STATE,
        message: expect.stringContaining("Invalid state transition"),
      }),
    );
  });

  it("returns INVALID_REQUEST for missing serviceId", async () => {
    const { respond } = await runServicesDisable({});

    expect(mocks.disable).not.toHaveBeenCalled();
    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({
        code: ErrorCodes.INVALID_REQUEST,
        message: expect.stringContaining("serviceId is required"),
      }),
    );
  });

  it("returns INVALID_REQUEST for non-string serviceId", async () => {
    const { respond } = await runServicesDisable({ serviceId: 123 });

    expect(mocks.disable).not.toHaveBeenCalled();
    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({
        code: ErrorCodes.INVALID_REQUEST,
        message: expect.stringContaining("serviceId is required"),
      }),
    );
  });
});
