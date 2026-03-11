import { afterEach, describe, expect, it, vi } from "vitest";
import type { ServiceWithStats } from "../types.ts";
import {
  loadServices,
  enableService,
  disableService,
  type ServicesStatusState,
} from "./services-status.ts";

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
    servicesBusyId: null,
    ...overrides,
  };
}

function createMockService(
  id: string,
  name: string,
  state: ServiceWithStats["state"],
): ServiceWithStats {
  return {
    id,
    name,
    state,
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
      createMockService("service-1", "Test Service 1", "enabled"),
      createMockService("service-2", "Test Service 2", "disabled"),
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
    const mockServices: ServiceWithStats[] = [
      createMockService("service-1", "Test Service", "enabled"),
    ];

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

describe("enableService", () => {
  it("enables service successfully and reloads services", async () => {
    const mockServices: ServiceWithStats[] = [
      createMockService("service-1", "Test Service", "enabled"),
    ];

    const request = vi.fn(async (method: string) => {
      if (method === "services.enable") {
        return { ok: true };
      }
      if (method === "services.status") {
        return { services: mockServices };
      }
      throw new Error(`unexpected method: ${method}`);
    });

    const state = createState(request);

    await enableService(state, "service-1");

    expect(request).toHaveBeenCalledWith("services.enable", { serviceId: "service-1" });
    expect(request).toHaveBeenCalledWith("services.status", {});
    expect(state.servicesBusyId).toBeNull();
    expect(state.servicesError).toBeNull();
    expect(state.services).toEqual(mockServices);
  });

  it("returns early when client is null", async () => {
    const request = vi.fn(async () => ({}));
    const state = createState(request, { client: null });

    await enableService(state, "service-1");

    expect(request).not.toHaveBeenCalled();
    expect(state.servicesBusyId).toBeNull();
  });

  it("returns early when not connected", async () => {
    const request = vi.fn(async () => ({}));
    const state = createState(request, { connected: false });

    await enableService(state, "service-1");

    expect(request).not.toHaveBeenCalled();
    expect(state.servicesBusyId).toBeNull();
  });

  it("sets busy state during enable operation", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "services.enable") {
        expect(state.servicesBusyId).toBe("service-1");
        return { ok: true };
      }
      if (method === "services.status") {
        return { services: [] };
      }
      throw new Error(`unexpected method: ${method}`);
    });

    const state = createState(request);

    await enableService(state, "service-1");

    expect(state.servicesBusyId).toBeNull();
  });

  it("clears previous error before enabling", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "services.enable") {
        return { ok: true };
      }
      if (method === "services.status") {
        return { services: [] };
      }
      throw new Error(`unexpected method: ${method}`);
    });

    const state = createState(request, { servicesError: "Previous error" });

    await enableService(state, "service-1");

    expect(state.servicesError).toBeNull();
  });

  it("sets error state on enable failure and clears busy state", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "services.enable") {
        throw new Error("Service not found");
      }
      throw new Error(`unexpected method: ${method}`);
    });

    const state = createState(request);

    await enableService(state, "non-existent-service");

    expect(state.servicesError).toBe("Service not found");
    expect(state.servicesBusyId).toBeNull();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("handles non-Error exceptions during enable", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "services.enable") {
        throw { message: "Object error" };
      }
      throw new Error(`unexpected method: ${method}`);
    });

    const state = createState(request);

    await enableService(state, "service-1");

    expect(state.servicesError).toContain("Object");
    expect(state.servicesBusyId).toBeNull();
  });
});

describe("disableService", () => {
  it("disables service successfully and reloads services", async () => {
    const mockServices: ServiceWithStats[] = [
      createMockService("service-1", "Test Service", "disabled"),
    ];

    const request = vi.fn(async (method: string) => {
      if (method === "services.disable") {
        return { ok: true };
      }
      if (method === "services.status") {
        return { services: mockServices };
      }
      throw new Error(`unexpected method: ${method}`);
    });

    const state = createState(request);

    await disableService(state, "service-1");

    expect(request).toHaveBeenCalledWith("services.disable", { serviceId: "service-1" });
    expect(request).toHaveBeenCalledWith("services.status", {});
    expect(state.servicesBusyId).toBeNull();
    expect(state.servicesError).toBeNull();
    expect(state.services).toEqual(mockServices);
  });

  it("returns early when client is null", async () => {
    const request = vi.fn(async () => ({}));
    const state = createState(request, { client: null });

    await disableService(state, "service-1");

    expect(request).not.toHaveBeenCalled();
    expect(state.servicesBusyId).toBeNull();
  });

  it("returns early when not connected", async () => {
    const request = vi.fn(async () => ({}));
    const state = createState(request, { connected: false });

    await disableService(state, "service-1");

    expect(request).not.toHaveBeenCalled();
    expect(state.servicesBusyId).toBeNull();
  });

  it("sets busy state during disable operation", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "services.disable") {
        expect(state.servicesBusyId).toBe("service-1");
        return { ok: true };
      }
      if (method === "services.status") {
        return { services: [] };
      }
      throw new Error(`unexpected method: ${method}`);
    });

    const state = createState(request);

    await disableService(state, "service-1");

    expect(state.servicesBusyId).toBeNull();
  });

  it("clears previous error before disabling", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "services.disable") {
        return { ok: true };
      }
      if (method === "services.status") {
        return { services: [] };
      }
      throw new Error(`unexpected method: ${method}`);
    });

    const state = createState(request, { servicesError: "Previous error" });

    await disableService(state, "service-1");

    expect(state.servicesError).toBeNull();
  });

  it("sets error state on disable failure and clears busy state", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "services.disable") {
        throw new Error("Invalid state transition");
      }
      throw new Error(`unexpected method: ${method}`);
    });

    const state = createState(request);

    await disableService(state, "service-1");

    expect(state.servicesError).toBe("Invalid state transition");
    expect(state.servicesBusyId).toBeNull();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("handles non-Error exceptions during disable", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "services.disable") {
        throw "String error";
      }
      throw new Error(`unexpected method: ${method}`);
    });

    const state = createState(request);

    await disableService(state, "service-1");

    expect(state.servicesError).toBe("String error");
    expect(state.servicesBusyId).toBeNull();
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

  it("enableService sets busyId at start and clears at end on success", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "services.enable") {
        return { ok: true };
      }
      if (method === "services.status") {
        return { services: [] };
      }
      throw new Error(`unexpected method: ${method}`);
    });

    const state = createState(request);

    const enablePromise = enableService(state, "service-1");
    expect(state.servicesBusyId).toBe("service-1");

    await enablePromise;
    expect(state.servicesBusyId).toBeNull();
  });

  it("enableService sets busyId at start and clears at end on error", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "services.enable") {
        throw new Error("Error");
      }
      throw new Error(`unexpected method: ${method}`);
    });

    const state = createState(request);

    const enablePromise = enableService(state, "service-1");
    expect(state.servicesBusyId).toBe("service-1");

    await enablePromise;
    expect(state.servicesBusyId).toBeNull();
  });

  it("disableService sets busyId at start and clears at end on success", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "services.disable") {
        return { ok: true };
      }
      if (method === "services.status") {
        return { services: [] };
      }
      throw new Error(`unexpected method: ${method}`);
    });

    const state = createState(request);

    const disablePromise = disableService(state, "service-1");
    expect(state.servicesBusyId).toBe("service-1");

    await disablePromise;
    expect(state.servicesBusyId).toBeNull();
  });

  it("disableService sets busyId at start and clears at end on error", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "services.disable") {
        throw new Error("Error");
      }
      throw new Error(`unexpected method: ${method}`);
    });

    const state = createState(request);

    const disablePromise = disableService(state, "service-1");
    expect(state.servicesBusyId).toBe("service-1");

    await disablePromise;
    expect(state.servicesBusyId).toBeNull();
  });
});

describe("service operations guard conditions", () => {
  it("enableService does not reload services if enable fails", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "services.enable") {
        throw new Error("Enable failed");
      }
      throw new Error(`unexpected method: ${method}`);
    });

    const state = createState(request);

    await enableService(state, "service-1");

    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith("services.enable", { serviceId: "service-1" });
    expect(state.servicesError).toBe("Enable failed");
  });

  it("disableService does not reload services if disable fails", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "services.disable") {
        throw new Error("Disable failed");
      }
      throw new Error(`unexpected method: ${method}`);
    });

    const state = createState(request);

    await disableService(state, "service-1");

    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith("services.disable", { serviceId: "service-1" });
    expect(state.servicesError).toBe("Disable failed");
  });

  it("enableService reloads services with correct params on success", async () => {
    const mockServices: ServiceWithStats[] = [createMockService("service-1", "Test", "enabled")];

    const request = vi.fn(async (method: string) => {
      if (method === "services.enable") {
        return { ok: true };
      }
      if (method === "services.status") {
        return { services: mockServices };
      }
      throw new Error(`unexpected method: ${method}`);
    });

    const state = createState(request);

    await enableService(state, "my-service-id");

    expect(request).toHaveBeenNthCalledWith(1, "services.enable", { serviceId: "my-service-id" });
    expect(request).toHaveBeenNthCalledWith(2, "services.status", {});
    expect(state.services).toEqual(mockServices);
  });

  it("disableService reloads services with correct params on success", async () => {
    const mockServices: ServiceWithStats[] = [createMockService("service-1", "Test", "disabled")];

    const request = vi.fn(async (method: string) => {
      if (method === "services.disable") {
        return { ok: true };
      }
      if (method === "services.status") {
        return { services: mockServices };
      }
      throw new Error(`unexpected method: ${method}`);
    });

    const state = createState(request);

    await disableService(state, "my-service-id");

    expect(request).toHaveBeenNthCalledWith(1, "services.disable", { serviceId: "my-service-id" });
    expect(request).toHaveBeenNthCalledWith(2, "services.status", {});
    expect(state.services).toEqual(mockServices);
  });
});
