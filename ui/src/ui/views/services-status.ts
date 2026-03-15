/**
 * Services Status View for Control UI
 *
 * Displays the installed services with run controls.
 */

import { html, nothing, type TemplateResult } from "lit";
import { icons } from "../icons.ts";
import type { ServiceSummary } from "../types.ts";

const warningIcon = html`
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path
      d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"
    />
    <line x1="12" y1="9" x2="12" y2="13" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
`;

const infoIcon = html`
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="12" r="10" />
    <line x1="12" y1="16" x2="12" y2="12" />
    <line x1="12" y1="8" x2="12.01" y2="8" />
  </svg>
`;

export type ServicesStatusProps = {
  services: ServiceSummary[];
  loading: boolean;
  error: string | null;
  onRun?: (serviceId: string) => void;
};

const triggerLabels: Record<string, string> = {
  cron: "Scheduled",
  webhook: "Webhook",
  message: "Message",
  web: "Web Interface",
};

function renderActionButtons(
  service: ServiceSummary,
  onRun: ((id: string) => void) | undefined,
): TemplateResult {
  const { id, name } = service;

  if (onRun) {
    return html`
      <button
        class="btn btn-primary"
        data-testid="service-action-${id}"
        aria-label="Run service ${name}"
        @click=${() => onRun(id)}
      >
        Run
      </button>
    `;
  }

  return html`<span class="action-placeholder" data-testid="service-action-${id}">-</span>`;
}

function renderServiceRow(
  service: ServiceSummary,
  onRun: ((id: string) => void) | undefined,
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
      <div class="service-actions">
        ${renderActionButtons(service, onRun)}
      </div>
    </div>
  `;
}

export function renderServicesStatus(props: ServicesStatusProps): TemplateResult {
  const { services, loading, error, onRun } = props;

  return html`
    <div class="services-status-view" role="region" aria-label="Services status">
      <div class="services-status-header">
        <h2 class="services-status-header__title">
          ${icons.settings} Services Status
        </h2>
        <p class="services-status-header__description">
          View and run your installed automation services.
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
              <div class="services-status-empty__icon">${infoIcon}</div>
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
                <div class="header-cell header-actions">Actions</div>
              </div>
              ${services.map((service) => renderServiceRow(service, onRun))}
            </div>
          `
          : nothing
      }
    </div>
  `;
}

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

  .services-status-error__icon svg {
    width: 100%;
    height: 100%;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
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

  .services-status-empty__icon svg {
    width: 100%;
    height: 100%;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
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
    grid-template-columns: 1fr 100px;
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
    grid-template-columns: 1fr 100px;
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
