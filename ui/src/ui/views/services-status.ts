/**
 * Services Status View for Control UI
 *
 * Displays the status of installed services with enable/disable controls.
 */

import { html, nothing, type TemplateResult } from "lit";
import { icons } from "../icons.ts";
import type { ServiceSummary, ServiceState } from "../types.ts";

export type ServicesStatusProps = {
  services: ServiceSummary[];
  loading: boolean;
  error: string | null;
  onEnable: (serviceId: string) => void;
  onDisable: (serviceId: string) => void;
};

// Map service states to CSS chip classes
const stateChipClasses: Record<ServiceState, string> = {
  enabled: "chip-ok",
  disabled: "chip-warn",
  error: "chip-error",
  validation_error: "chip-error",
  install_error: "chip-error",
  pending: "chip-info",
  validating: "chip-info",
  installing: "chip-info",
  installed: "chip-info",
  uninstalling: "chip-info",
};

const stateLabels: Record<ServiceState, string> = {
  enabled: "Enabled",
  disabled: "Disabled",
  error: "Error",
  validation_error: "Validation Error",
  install_error: "Install Error",
  pending: "Pending",
  validating: "Validating",
  installing: "Installing",
  installed: "Installed",
  uninstalling: "Uninstalling",
};

const triggerLabels: Record<string, string> = {
  cron: "Scheduled",
  webhook: "Webhook",
  message: "Message",
  web: "Web Interface",
};

function renderStateBadge(state: ServiceState, serviceId: string): TemplateResult {
  const chipClass = stateChipClasses[state] || "chip-info";
  const label = stateLabels[state] || state;

  return html`
    <span
      class="chip ${chipClass}"
      data-testid="service-status-${serviceId}"
      aria-label="Service state: ${label}"
    >
      ${label}
    </span>
  `;
}

function renderActionButtons(
  service: ServiceSummary,
  onEnable: (id: string) => void,
  onDisable: (id: string) => void,
): TemplateResult {
  const { id, state } = service;

  if (state === "enabled") {
    return html`
      <button
        class="btn btn-secondary"
        data-testid="service-action-${id}"
        aria-label="Disable service ${service.name}"
        @click=${() => onDisable(id)}
      >
        Disable
      </button>
    `;
  }

  if (state === "disabled") {
    return html`
      <button
        class="btn btn-primary"
        data-testid="service-action-${id}"
        aria-label="Enable service ${service.name}"
        @click=${() => onEnable(id)}
      >
        Enable
      </button>
    `;
  }

  // For other states, show no action button (state is transitional or error)
  return html`<span class="action-placeholder" data-testid="service-action-${id}">-</span>`;
}

function renderServiceRow(
  service: ServiceSummary,
  onEnable: (id: string) => void,
  onDisable: (id: string) => void,
): TemplateResult {
  return html`
    <div
      class="service-row"
      data-testid="service-row-${service.id}"
      role="listitem"
    >
      <div class="service-info">
        <div class="service-name">${service.name}</div>
        <div class="service-meta">
          <span class="trigger-type">${triggerLabels[service.triggerType] || service.triggerType}</span>
        </div>
      </div>
      <div class="service-status">
        ${renderStateBadge(service.state, service.id)}
      </div>
      <div class="service-actions">
        ${renderActionButtons(service, onEnable, onDisable)}
      </div>
    </div>
  `;
}

// Main render function
export function renderServicesStatus(props: ServicesStatusProps): TemplateResult {
  const { services, loading, error, onEnable, onDisable } = props;

  return html`
    <div class="services-status-view" role="region" aria-label="Services status">
      <div class="services-status-header">
        <h2 class="services-status-header__title">
          ${icons.settings} Services Status
        </h2>
        <p class="services-status-header__description">
          View and manage your installed automation services. Enable or disable
          services to control their active state.
        </p>
      </div>

      ${
        error
          ? html`
            <div class="services-status-error" role="alert" aria-live="polite">
              <div class="services-status-error__icon">${warningIcon}</div>
              <div class="services-status-error__message">${error}</div>
            </div>
          `
          : nothing
      }

      ${
        loading
          ? html`
              <div class="services-status-loading" role="status" aria-label="Loading services">
                <div class="spinner" aria-hidden="true"></div>
                <span>Loading services...</span>
              </div>
            `
          : nothing
      }

      ${
        !loading && services.length === 0 && !error
          ? html`
            <div class="services-status-empty" role="status">
              <div class="services-status-empty__icon">${icons.info}</div>
              <p class="services-status-empty__message">
                No services installed yet. Install a service to get started.
              </p>
            </div>
          `
          : nothing
      }

      ${
        services.length > 0
          ? html`
            <div
              class="services-list"
              data-testid="service-list"
              role="list"
              aria-label="Installed services"
            >
              <div class="services-list-header" role="row" aria-hidden="true">
                <div class="header-cell header-name">Service</div>
                <div class="header-cell header-status">Status</div>
                <div class="header-cell header-actions">Actions</div>
              </div>
              ${services.map((service) => renderServiceRow(service, onEnable, onDisable))}
            </div>
          `
          : nothing
      }
    </div>
  `;
}

// CSS styles for the services status view
export const servicesStatusStyles = `
  .services-status-view {
    padding: 24px;
    max-width: 1000px;
    margin: 0 auto;
  }

  .services-status-header {
    margin-bottom: 24px;
    padding-bottom: 16px;
    border-bottom: 1px solid var(--border-default, #3f3f46);
  }

  .services-status-header__title {
    display: flex;
    align-items: center;
    gap: 12px;
    font-size: 24px;
    font-weight: 600;
    color: var(--text-primary, #e4e4e7);
    margin: 0 0 8px 0;
  }

  .services-status-header__title svg {
    width: 28px;
    height: 28px;
    color: var(--accent-primary, #10b981);
  }

  .services-status-header__description {
    font-size: 14px;
    color: var(--text-secondary, #a1a1aa);
    margin: 0;
    line-height: 1.5;
  }

  .services-status-error {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 16px;
    background: var(--accent-error-bg, rgba(239, 68, 68, 0.1));
    border: 1px solid var(--accent-error, #ef4444);
    border-radius: 8px;
    margin-bottom: 24px;
  }

  .services-status-error__icon {
    width: 20px;
    height: 20px;
    color: var(--accent-error, #ef4444);
    flex-shrink: 0;
  }

  .services-status-error__message {
    font-size: 14px;
    color: var(--accent-error, #ef4444);
  }

  .services-status-loading {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 48px;
    color: var(--text-secondary, #a1a1aa);
  }

  .spinner {
    width: 24px;
    height: 24px;
    border: 2px solid var(--border-default, #3f3f46);
    border-top-color: var(--accent-primary, #10b981);
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .services-status-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 48px;
    text-align: center;
  }

  .services-status-empty__icon {
    width: 48px;
    height: 48px;
    color: var(--text-secondary, #a1a1aa);
    margin-bottom: 16px;
  }

  .services-status-empty__message {
    font-size: 14px;
    color: var(--text-secondary, #a1a1aa);
    margin: 0;
  }

  .services-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .services-list-header {
    display: grid;
    grid-template-columns: 1fr 120px 100px;
    gap: 16px;
    padding: 12px 16px;
    background: var(--surface-secondary, #27272a);
    border-radius: 8px;
    font-size: 12px;
    font-weight: 600;
    color: var(--text-secondary, #a1a1aa);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .service-row {
    display: grid;
    grid-template-columns: 1fr 120px 100px;
    gap: 16px;
    align-items: center;
    padding: 16px;
    background: var(--surface-primary, #18181b);
    border: 1px solid var(--border-default, #3f3f46);
    border-radius: 8px;
    transition: border-color 0.15s ease;
  }

  .service-row:hover {
    border-color: var(--border-hover, #52525b);
  }

  .service-info {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .service-name {
    font-size: 14px;
    font-weight: 500;
    color: var(--text-primary, #e4e4e7);
  }

  .service-meta {
    display: flex;
    gap: 8px;
  }

  .trigger-type {
    font-size: 12px;
    color: var(--text-tertiary, #71717a);
  }

  .service-status {
    display: flex;
  }

  .chip {
    display: inline-flex;
    align-items: center;
    padding: 4px 10px;
    border-radius: 9999px;
    font-size: 12px;
    font-weight: 500;
    background: var(--surface-secondary, #27272a);
    color: var(--text-secondary, #a1a1aa);
  }

  .chip-ok {
    background: rgba(16, 185, 129, 0.1);
    color: #10b981;
  }

  .chip-warn {
    background: rgba(245, 158, 11, 0.1);
    color: #f59e0b;
  }

  .chip-error {
    background: rgba(239, 68, 68, 0.1);
    color: #ef4444;
  }

  .chip-info {
    background: rgba(59, 130, 246, 0.1);
    color: #3b82f6;
  }

  .service-actions {
    display: flex;
    justify-content: flex-end;
  }

  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 6px 12px;
    border: 1px solid transparent;
    border-radius: 6px;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .btn:hover {
    transform: translateY(-1px);
  }

  .btn:active {
    transform: translateY(0);
  }

  .btn-primary {
    background: var(--accent-primary, #10b981);
    color: white;
    border-color: var(--accent-primary, #10b981);
  }

  .btn-primary:hover {
    background: #059669;
    border-color: #059669;
  }

  .btn-secondary {
    background: transparent;
    color: var(--text-secondary, #a1a1aa);
    border-color: var(--border-default, #3f3f46);
  }

  .btn-secondary:hover {
    background: var(--surface-secondary, #27272a);
    border-color: var(--border-hover, #52525b);
  }

  .action-placeholder {
    font-size: 13px;
    color: var(--text-tertiary, #71717a);
    padding: 6px 12px;
  }
`;
