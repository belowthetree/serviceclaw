/**
 * Lifecycle Sync Service
 *
 * Synchronizes modal state with service lifecycle.
 * Manages bidirectional sync between ServiceModal and ServiceLifecycleManager.
 */

import {
  type ServiceLifecycleManager,
  type LifecycleHooks,
  type ServiceProcessInstance,
  type ServiceProcessState,
  ServiceNotFoundError,
  ServiceLifecycleError,
} from "../../../src/services/lifecycle.js";
import type { ServiceModal } from "../components/service-modal.js";

/**
 * Sync state for tracking the lifecycle-modal synchronization
 */
export interface SyncState {
  serviceId: string;
  isSyncing: boolean;
  pendingOperation: "start" | "stop" | null;
  lastError?: string;
}

/**
 * Options for configuring lifecycle sync behavior
 */
export interface LifecycleSyncOptions {
  /** Close modal automatically when service stops unexpectedly */
  closeOnUnexpectedStop?: boolean;
  /** Show error in modal when service fails */
  showErrorOnFailure?: boolean;
  /** Timeout for service start in milliseconds */
  startTimeout?: number;
  /** Timeout for service stop in milliseconds */
  stopTimeout?: number;
}

/**
 * Error for lifecycle sync operations
 */
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

/**
 * Manager for synchronizing modal state with service lifecycle
 */
export class LifecycleSyncManager {
  private readonly syncStates = new Map<string, SyncState>();
  private readonly modalRegistry = new Map<string, ServiceModal>();
  private readonly hooksRegistry = new Map<string, () => void>();
  private readonly pendingTimeouts = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly lifecycleManager: ServiceLifecycleManager,
    private readonly options: LifecycleSyncOptions = {},
  ) {
    this.options = {
      closeOnUnexpectedStop: false,
      showErrorOnFailure: true,
      startTimeout: 30000,
      stopTimeout: 10000,
      ...options,
    };
  }

  /**
   * Set up bidirectional sync between a modal and a service
   *
   * @param modal - The ServiceModal instance to sync
   * @param serviceId - The service identifier
   * @returns Unregister function to clean up sync
   */
  syncModalWithService(modal: ServiceModal, serviceId: string): () => void {
    // Register modal for this service
    this.modalRegistry.set(serviceId, modal);

    // Initialize sync state
    const syncState: SyncState = {
      serviceId,
      isSyncing: true,
      pendingOperation: null,
    };
    this.syncStates.set(serviceId, syncState);

    // Register lifecycle hooks
    const unregisterHooks = this.registerLifecycleHooks(serviceId, modal);
    this.hooksRegistry.set(serviceId, unregisterHooks);

    // Return cleanup function
    return () => {
      this.cleanupSync(serviceId);
    };
  }

  /**
   * Open modal and start the associated service
   *
   * @param serviceId - The service identifier
   * @param serviceName - The display name for the service
   * @returns Promise that resolves when service starts
   * @throws LifecycleSyncError if service fails to start
   */
  async openServiceModal(serviceId: string, serviceName: string): Promise<void> {
    const modal = this.modalRegistry.get(serviceId);
    if (!modal) {
      throw new LifecycleSyncError(
        `No modal registered for service ${serviceId}. Call syncModalWithService first.`,
        serviceId,
      );
    }

    const syncState = this.syncStates.get(serviceId);
    if (!syncState) {
      throw new LifecycleSyncError(`No sync state found for service ${serviceId}`, serviceId);
    }

    // Prevent multiple simultaneous operations
    if (syncState.pendingOperation) {
      throw new LifecycleSyncError(
        `Operation already in progress for service ${serviceId}: ${syncState.pendingOperation}`,
        serviceId,
      );
    }

    // Open the modal first (shows loading state)
    modal.open(serviceId, serviceName);
    syncState.pendingOperation = "start";

    // Set up timeout for service start
    const timeoutId = setTimeout(() => {
      this.handleStartTimeout(serviceId, modal);
    }, this.options.startTimeout);
    this.pendingTimeouts.set(serviceId, timeoutId);

    try {
      // Start the service
      await this.lifecycleManager.startService(serviceId);

      // Clear timeout on success
      this.clearTimeout(serviceId);
      syncState.pendingOperation = null;

      // Modal will transition from loading when service outputs content
      // or remains in loading until iframe loads
    } catch (error) {
      // Clear timeout on failure
      this.clearTimeout(serviceId);
      syncState.pendingOperation = null;

      // Show error and close modal
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (this.options.showErrorOnFailure) {
        this.showErrorInModal(modal, `Failed to start service: ${errorMessage}`);
      }

      // Close modal after showing error briefly
      setTimeout(() => {
        modal.close();
      }, 3000);

      throw new LifecycleSyncError(
        `Failed to start service ${serviceId}: ${errorMessage}`,
        serviceId,
        error instanceof Error ? error : undefined,
      );
    }
  }

  /**
   * Close modal and stop the associated service
   *
   * @param serviceId - The service identifier
   * @returns Promise that resolves when service stops
   */
  async closeServiceModal(serviceId: string): Promise<void> {
    const modal = this.modalRegistry.get(serviceId);
    const syncState = this.syncStates.get(serviceId);

    if (!modal || !syncState) {
      throw new LifecycleSyncError(`No sync setup found for service ${serviceId}`, serviceId);
    }

    // Handle case where modal is already closed
    if (!modal.isOpen()) {
      // Still try to stop the service if it's running
      try {
        await this.stopServiceIfRunning(serviceId);
      } catch (error) {
        // Service might not be running, that's okay
      }
      return;
    }

    // Prevent multiple simultaneous operations
    if (syncState.pendingOperation === "stop") {
      return; // Already stopping
    }

    // Cancel any pending start operation
    if (syncState.pendingOperation === "start") {
      this.clearTimeout(serviceId);
      syncState.pendingOperation = null;
    }

    syncState.pendingOperation = "stop";

    // Set up timeout for service stop
    const timeoutId = setTimeout(() => {
      this.handleStopTimeout(serviceId);
    }, this.options.stopTimeout);
    this.pendingTimeouts.set(`${serviceId}-stop`, timeoutId);

    try {
      // Close modal first for immediate UI feedback
      modal.close();

      // Then stop the service
      await this.stopServiceIfRunning(serviceId);

      // Clear timeout on success
      this.clearTimeout(`${serviceId}-stop`);
      syncState.pendingOperation = null;
    } catch (error) {
      // Clear timeout on failure
      this.clearTimeout(`${serviceId}-stop`);
      syncState.pendingOperation = null;

      // Log error but don't throw - modal is already closed
      console.error(`Error stopping service ${serviceId}:`, error);
    }
  }

  /**
   * Get current sync state for a service
   */
  getSyncState(serviceId: string): SyncState | undefined {
    return this.syncStates.get(serviceId);
  }

  /**
   * Check if a service is currently being synced
   */
  isSyncing(serviceId: string): boolean {
    return this.syncStates.get(serviceId)?.isSyncing ?? false;
  }

  /**
   * Check if there's a pending operation for a service
   */
  hasPendingOperation(serviceId: string): boolean {
    return this.syncStates.get(serviceId)?.pendingOperation !== null;
  }

  /**
   * Dispose all syncs and cleanup
   */
  dispose(): void {
    // Clear all timeouts
    for (const [key, timeout] of this.pendingTimeouts) {
      clearTimeout(timeout);
    }
    this.pendingTimeouts.clear();

    // Unregister all hooks
    for (const [serviceId, unregister] of this.hooksRegistry) {
      unregister();
    }
    this.hooksRegistry.clear();

    // Clear registries
    this.modalRegistry.clear();
    this.syncStates.clear();
  }

  /**
   * Register lifecycle hooks for a service
   */
  private registerLifecycleHooks(serviceId: string, modal: ServiceModal): () => void {
    const hooks: LifecycleHooks = {
      onStateChange: (id: string, oldState: ServiceProcessState, newState: ServiceProcessState) => {
        if (id !== serviceId) {return;}
        this.handleServiceStateChange(serviceId, modal, oldState, newState);
      },
      onUnexpectedExit: (id: string, instance: ServiceProcessInstance, exitCode: number | null) => {
        if (id !== serviceId) {return;}
        this.handleUnexpectedExit(serviceId, modal, instance, exitCode);
      },
    };

    return this.lifecycleManager.registerLifecycleHooks(hooks);
  }

  /**
   * Handle service state changes
   */
  private handleServiceStateChange(
    serviceId: string,
    modal: ServiceModal,
    oldState: ServiceProcessState,
    newState: ServiceProcessState,
  ): void {
    const syncState = this.syncStates.get(serviceId);
    if (!syncState) {return;}

    switch (newState) {
      case "error":
        // Service crashed or failed to start
        const instance = this.lifecycleManager.getServiceState(serviceId);
        if (instance?.error && modal.isOpen()) {
          this.showErrorInModal(modal, `Service error: ${instance.error}`);

          if (this.options.closeOnUnexpectedStop) {
            setTimeout(() => modal.close(), 3000);
          }
        }
        syncState.lastError = instance?.error;
        break;

      case "stopped":
        // Service stopped normally
        if (modal.isOpen() && this.options.closeOnUnexpectedStop) {
          modal.close();
        }
        break;
    }
  }

  /**
   * Handle unexpected service exit
   */
  private handleUnexpectedExit(
    serviceId: string,
    modal: ServiceModal,
    instance: ServiceProcessInstance,
    exitCode: number | null,
  ): void {
    const syncState = this.syncStates.get(serviceId);
    if (!syncState) {return;}

    if (modal.isOpen()) {
      const errorMessage = `Service stopped unexpectedly${exitCode !== null ? ` (exit code: ${exitCode})` : ""}`;
      this.showErrorInModal(modal, errorMessage);
      syncState.lastError = errorMessage;

      if (this.options.closeOnUnexpectedStop) {
        setTimeout(() => modal.close(), 3000);
      }
    }
  }

  /**
   * Show error in modal
   */
  private showErrorInModal(modal: ServiceModal, message: string): void {
    // Dispatch a custom error event that the modal can handle
    // Since we can't modify the modal directly, we dispatch an event
    modal.dispatchEvent(
      new CustomEvent("service-error", {
        detail: { serviceId: modal.serviceId, error: message },
        bubbles: true,
        composed: true,
      }),
    );
  }

  /**
   * Handle service start timeout
   */
  private handleStartTimeout(serviceId: string, modal: ServiceModal): void {
    const syncState = this.syncStates.get(serviceId);
    if (!syncState) {return;}

    syncState.pendingOperation = null;

    if (modal.isOpen()) {
      this.showErrorInModal(modal, "Service took too long to start");
      setTimeout(() => modal.close(), 3000);
    }
  }

  /**
   * Handle service stop timeout
   */
  private handleStopTimeout(serviceId: string): void {
    const syncState = this.syncStates.get(serviceId);
    if (syncState) {
      syncState.pendingOperation = null;
    }
    console.warn(`Service ${serviceId} stop timed out`);
  }

  /**
   * Stop service if it's running
   */
  private async stopServiceIfRunning(serviceId: string): Promise<void> {
    const instance = this.lifecycleManager.getServiceState(serviceId);
    if (instance && (instance.state === "started" || instance.state === "starting")) {
      await this.lifecycleManager.stopService(serviceId);
    }
  }

  /**
   * Clear a pending timeout
   */
  private clearTimeout(key: string): void {
    const timeout = this.pendingTimeouts.get(key);
    if (timeout) {
      clearTimeout(timeout);
      this.pendingTimeouts.delete(key);
    }
  }

  /**
   * Clean up sync for a service
   */
  private cleanupSync(serviceId: string): void {
    // Unregister hooks
    const unregister = this.hooksRegistry.get(serviceId);
    if (unregister) {
      unregister();
      this.hooksRegistry.delete(serviceId);
    }

    // Clear timeouts
    this.clearTimeout(serviceId);
    this.clearTimeout(`${serviceId}-stop`);

    // Remove from registries
    this.modalRegistry.delete(serviceId);
    this.syncStates.delete(serviceId);
  }
}

// =============================================================================
// Convenience Functions
// =============================================================================

let defaultManager: LifecycleSyncManager | null = null;

/**
 * Create a new LifecycleSyncManager
 *
 * @param lifecycleManager - The ServiceLifecycleManager instance
 * @param options - Sync options
 * @returns New LifecycleSyncManager
 */
export function createLifecycleSyncManager(
  lifecycleManager: ServiceLifecycleManager,
  options?: LifecycleSyncOptions,
): LifecycleSyncManager {
  return new LifecycleSyncManager(lifecycleManager, options);
}

/**
 * Get or create the default LifecycleSyncManager singleton
 *
 * @param lifecycleManager - The ServiceLifecycleManager instance
 * @returns LifecycleSyncManager singleton
 */
export function getLifecycleSyncManager(
  lifecycleManager: ServiceLifecycleManager,
): LifecycleSyncManager {
  if (!defaultManager) {
    defaultManager = new LifecycleSyncManager(lifecycleManager);
  }
  return defaultManager;
}

/**
 * Reset the default lifecycle sync manager (mainly for testing)
 */
export function resetLifecycleSyncManager(): void {
  defaultManager?.dispose();
  defaultManager = null;
}

/**
 * Set up bidirectional sync between a modal and a service (convenience function)
 *
 * @param modal - The ServiceModal instance
 * @param serviceId - The service identifier
 * @param lifecycleManager - The ServiceLifecycleManager instance
 * @returns Unregister function to clean up sync
 */
export function syncModalWithService(
  modal: ServiceModal,
  serviceId: string,
  lifecycleManager: ServiceLifecycleManager,
): () => void {
  const manager = getLifecycleSyncManager(lifecycleManager);
  return manager.syncModalWithService(modal, serviceId);
}

/**
 * Open modal and start service (convenience function)
 *
 * @param serviceId - The service identifier
 * @param serviceName - The display name for the service
 * @param lifecycleManager - The ServiceLifecycleManager instance
 * @returns Promise that resolves when service starts
 */
export async function openServiceModal(
  serviceId: string,
  serviceName: string,
  lifecycleManager: ServiceLifecycleManager,
): Promise<void> {
  const manager = getLifecycleSyncManager(lifecycleManager);
  return manager.openServiceModal(serviceId, serviceName);
}

/**
 * Close modal and stop service (convenience function)
 *
 * @param serviceId - The service identifier
 * @param lifecycleManager - The ServiceLifecycleManager instance
 * @returns Promise that resolves when service stops
 */
export async function closeServiceModal(
  serviceId: string,
  lifecycleManager: ServiceLifecycleManager,
): Promise<void> {
  const manager = getLifecycleSyncManager(lifecycleManager);
  return manager.closeServiceModal(serviceId);
}

// Export types
export type { ServiceModal, ServiceProcessInstance, ServiceProcessState };
