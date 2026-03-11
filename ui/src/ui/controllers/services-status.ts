import type { GatewayBrowserClient } from "../gateway.ts";
import type { ServiceWithStats } from "../types.ts";

export type ServicesStatusState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  servicesLoading: boolean;
  services: ServiceWithStats[];
  servicesError: string | null;
  servicesBusyId: string | null;
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

export async function enableService(state: ServicesStatusState, serviceId: string) {
  if (!state.client || !state.connected) {
    return;
  }
  state.servicesBusyId = serviceId;
  state.servicesError = null;
  try {
    await state.client.request<{ ok: boolean }>("services.enable", { serviceId });
    await loadServices(state);
  } catch (err) {
    state.servicesError = getErrorMessage(err);
  } finally {
    state.servicesBusyId = null;
  }
}

export async function disableService(state: ServicesStatusState, serviceId: string) {
  if (!state.client || !state.connected) {
    return;
  }
  state.servicesBusyId = serviceId;
  state.servicesError = null;
  try {
    await state.client.request<{ ok: boolean }>("services.disable", { serviceId });
    await loadServices(state);
  } catch (err) {
    state.servicesError = getErrorMessage(err);
  } finally {
    state.servicesBusyId = null;
  }
}
