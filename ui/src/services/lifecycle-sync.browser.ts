import type { ServiceModal } from "../components/service-modal.js";
import "../components/service-modal.js";
import type { GatewayBrowserClient } from "../ui/gateway.js";

export class LifecycleSyncError extends Error {
  constructor(
    message: string,
    public readonly serviceId: string,
    public readonly cause?: Error,
  ) {
    super(message);
    this.name = "LifecycleSyncError";
  }
}

export interface SyncState {
  serviceId: string;
  isSyncing: boolean;
  pendingOperation: "start" | "stop" | null;
  lastError?: string;
}

export interface LifecycleSyncOptions {
  closeOnUnexpectedStop?: boolean;
  showErrorOnFailure?: boolean;
  startTimeout?: number;
  stopTimeout?: number;
}

const syncStates = new Map<string, SyncState>();
const modalRegistry = new Map<string, ServiceModal>();
const defaultOptions: Required<LifecycleSyncOptions> = {
  closeOnUnexpectedStop: false,
  showErrorOnFailure: true,
  startTimeout: 30000,
  stopTimeout: 10000,
};

function getOrCreateModal(serviceId: string): ServiceModal {
  console.log("[lifecycle-sync] Getting or creating modal for service:", serviceId);

  const isRegistered = !!customElements.get("service-modal");
  console.log("[lifecycle-sync] Custom element registered:", isRegistered);

  let modal = modalRegistry.get(serviceId);
  if (modal) {
    console.log("[lifecycle-sync] Found existing modal in registry");
    return modal;
  }

  const existingElement = document.querySelector(`service-modal[data-service-id="${serviceId}"]`);
  if (existingElement) {
    console.log("[lifecycle-sync] Found existing modal in DOM");
    modalRegistry.set(serviceId, existingElement);
    return existingElement;
  }

  console.log("[lifecycle-sync] Creating new modal element");
  modal = document.createElement("service-modal");
  modal.setAttribute("data-service-id", serviceId);
  document.body.appendChild(modal);
  console.log("[lifecycle-sync] Modal appended to body, constructor:", modal.constructor.name);
  modalRegistry.set(serviceId, modal);

  return modal;
}

export function syncModalWithService(
  modal: ServiceModal,
  serviceId: string,
  _gatewayClient?: GatewayBrowserClient,
): () => void {
  modalRegistry.set(serviceId, modal);
  syncStates.set(serviceId, {
    serviceId,
    isSyncing: true,
    pendingOperation: null,
  });

  return () => {
    modalRegistry.delete(serviceId);
    syncStates.delete(serviceId);
  };
}

async function waitForModalReady(modal: ServiceModal): Promise<void> {
  console.log("[lifecycle-sync] Checking if modal is ready...");
  if ((modal as unknown as { open?: unknown }).open) {
    console.log("[lifecycle-sync] Modal already ready");
    return;
  }
  console.log("[lifecycle-sync] Waiting for modal to be ready...");
  return new Promise((resolve) => {
    const check = () => {
      if ((modal as unknown as { open?: unknown }).open) {
        console.log("[lifecycle-sync] Modal is now ready");
        resolve();
      } else {
        console.log("[lifecycle-sync] Modal not ready yet, waiting...");
        setTimeout(check, 10);
      }
    };
    check();
  });
}

export async function openServiceModal(
  serviceId: string,
  serviceName: string,
  gatewayClient?: GatewayBrowserClient,
): Promise<void> {
  console.log("[lifecycle-sync] openServiceModal called:", serviceId, serviceName);
  const modal = getOrCreateModal(serviceId);
  const syncState = syncStates.get(serviceId) || {
    serviceId,
    isSyncing: true,
    pendingOperation: null,
  };

  if (syncState.pendingOperation) {
    console.log("[lifecycle-sync] Operation already in progress:", syncState.pendingOperation);
    throw new LifecycleSyncError(
      `Operation already in progress for service ${serviceId}: ${syncState.pendingOperation}`,
      serviceId,
    );
  }

  syncState.pendingOperation = "start";
  syncStates.set(serviceId, syncState);

  try {
    if (gatewayClient) {
      console.log("[lifecycle-sync] Starting service via Gateway API...");
      await gatewayClient.startService(serviceId);
      console.log("[lifecycle-sync] Service started successfully");
    }

    console.log("[lifecycle-sync] Waiting for modal to be ready...");
    await waitForModalReady(modal);
    console.log("[lifecycle-sync] Modal ready, calling open()...");
    modal.open(serviceId, serviceName);
    console.log("[lifecycle-sync] open() called successfully");

    setTimeout(() => {
      if ((modal as unknown as { _state?: string })._state === "loading") {
        (modal as unknown as { setError?: (msg: string) => void }).setError?.(
          "Service failed to start within timeout period",
        );
      }
    }, defaultOptions.startTimeout);

    await new Promise<void>((resolve) => {
      const checkState = () => {
        const state = (modal as unknown as { _state?: string })._state;
        if (state === "loaded" || state === "error" || state === "closed") {
          resolve();
        } else {
          setTimeout(checkState, 100);
        }
      };
      checkState();
    });

    syncState.pendingOperation = null;
    syncStates.set(serviceId, syncState);
  } catch (error) {
    console.error("[lifecycle-sync] Failed to start service:", error);
    syncState.pendingOperation = null;
    syncStates.set(serviceId, syncState);
    throw error;
  }
}

export async function closeServiceModal(
  serviceId: string,
  _gatewayClient?: GatewayBrowserClient,
): Promise<void> {
  const modal = modalRegistry.get(serviceId);
  if (modal) {
    modal.close();
  }
  syncStates.delete(serviceId);
  modalRegistry.delete(serviceId);
}

export type { ServiceModal };
export type ServiceProcessInstance = unknown;
export type ServiceProcessState = unknown;
