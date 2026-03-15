import type { GatewayBrowserClient } from "../gateway.ts";
import type { ServiceWithStats } from "../types.ts";

export type ServicesStatusState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  servicesLoading: boolean;
  services: ServiceWithStats[];
  servicesError: string | null;
};

function getErrorMessage(err: unknown) {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

export async function loadServices(state: ServicesStatusState) {
  if (!state.client || !state.connected) {
    return;
  }
  if (state.servicesLoading) {
    return;
  }

  state.servicesLoading = true;
  state.servicesError = null;
  try {
    const res = await state.client.request<{ services: ServiceWithStats[] }>("services.status", {});
    if (res) {
      state.services = res.services;
    }
  } catch (err) {
    state.servicesError = getErrorMessage(err);
  } finally {
    state.servicesLoading = false;
  }
}
