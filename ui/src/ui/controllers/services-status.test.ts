import { afterEach, describe, expect, it, vi } from "vitest";
import type { ServiceWithStats } from "../types.ts";
import { loadServices, type ServicesStatusState } from "./services-status.ts";

type RequestFn = (method: string, params?: unknown) => Promise<unknown>;

function createState(
  request: RequestFn,
  overrides: Partial<ServicesStatusState> = {},
): ServicesStatusState {
  return {
    client: { request } as unknown as ServicesStatusState["client"],
    connected: true,
    servicesLoading: false,
    services: [],
    servicesError: null,
    ...overrides,
  };
}

function createMockService(id: string, name: string): ServiceWithStats {
  return {
    id,
    name,
    triggerType: "cron",
    category: "productivity",
    updatedAt: new Date().toISOString(),
    stats: {
      totalRuns: 10,
      successfulRuns: 8,
      failedRuns: 2,
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("loadServices", () => {
  it("loads services successfully", async () => {
    const mockServices: ServiceWithStats[] = [
      createMockService("service-1", "Test Service 1"),
      createMockService("service-2", "Test Service 2"),
    ];

    const request = vi.fn(async (method: string) => {
      if (method === "services.status") {
        return { services: mockServices };
      }
      throw new Error(`unexpected method: ${method}`);
    });

    const state = createState(request);

    await loadServices(state);

    expect(state.services).toEqual(mockServices);
    expect(state.servicesError).toBeNull();
    expect(state.servicesLoading).toBe(false);
    expect(request).toHaveBeenCalledWith("services.status", {});
  });

  it("returns early when client is null", async () => {
    const request = vi.fn(async () => ({}));
    const state = createState(request, { client: null });

    await loadServices(state);

    expect(request).not.toHaveBeenCalled();
    expect(state.servicesLoading).toBe(false);
  });

  it("returns early when not connected", async () => {
    const request = vi.fn(async () => ({}));
    const state = createState(request, { connected: false });

    await loadServices(state);

    expect(request).not.toHaveBeenCalled();
    expect(state.servicesLoading).toBe(false);
  });

  it("returns early when already loading", async () => {
    const request = vi.fn(async () => ({}));
    const state = createState(request, { servicesLoading: true });

    await loadServices(state);

    expect(request).not.toHaveBeenCalled();
    expect(state.servicesLoading).toBe(true);
  });

  it("sets error state on load failure", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "services.status") {
        throw new Error("Network error");
      }
      throw new Error(`unexpected method: ${method}`);
    });

    const state = createState(request);

    await loadServices(state);

    expect(state.services).toEqual([]);
    expect(state.servicesError).toBe("Network error");
    expect(state.servicesLoading).toBe(false);
  });

  it("clears previous error before loading", async () => {
    const mockServices: ServiceWithStats[] = [createMockService("service-1", "Test Service")];

    const request = vi.fn(async (method: string) => {
      if (method === "services.status") {
        return { services: mockServices };
      }
      throw new Error(`unexpected method: ${method}`);
    });

    const state = createState(request, { servicesError: "Previous error" });

    await loadServices(state);

    expect(state.servicesError).toBeNull();
    expect(state.services).toEqual(mockServices);
  });

  it("handles empty services response", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "services.status") {
        return { services: [] };
      }
      throw new Error(`unexpected method: ${method}`);
    });

    const state = createState(request);

    await loadServices(state);

    expect(state.services).toEqual([]);
    expect(state.servicesError).toBeNull();
    expect(state.servicesLoading).toBe(false);
  });

  it("handles null response", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "services.status") {
        return null;
      }
      throw new Error(`unexpected method: ${method}`);
    });

    const state = createState(request);

    await loadServices(state);

    expect(state.services).toEqual([]);
    expect(state.servicesError).toBeNull();
    expect(state.servicesLoading).toBe(false);
  });

  it("handles non-Error exceptions", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "services.status") {
        throw "String error";
      }
      throw new Error(`unexpected method: ${method}`);
    });

    const state = createState(request);

    await loadServices(state);

    expect(state.servicesError).toBe("String error");
    expect(state.servicesLoading).toBe(false);
  });
});

describe("loading state management", () => {
  it("loadServices sets loading true at start and false at end on success", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "services.status") {
        return { services: [] };
      }
      throw new Error(`unexpected method: ${method}`);
    });

    const state = createState(request);

    const loadPromise = loadServices(state);
    expect(state.servicesLoading).toBe(true);

    await loadPromise;
    expect(state.servicesLoading).toBe(false);
  });

  it("loadServices sets loading true at start and false at end on error", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "services.status") {
        throw new Error("Error");
      }
      throw new Error(`unexpected method: ${method}`);
    });

    const state = createState(request);

    const loadPromise = loadServices(state);
    expect(state.servicesLoading).toBe(true);

    await loadPromise;
    expect(state.servicesLoading).toBe(false);
  });
});
