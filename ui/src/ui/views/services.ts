/**
 * Services View for Control UI
 *
 * Displays installed services from ~/.openclaw/services/ with their
 * configuration state and allows viewing/editing service configs.
 */

import { html, nothing, type TemplateResult } from "lit";
import { icons } from "../icons.ts";
import type { ServiceWithStats, ServiceState } from "../types.ts";

function getStateInfo(state: ServiceState): { label: string; color: string; bgColor: string } {
  switch (state) {
    case "enabled":
      return {
        label: "Enabled",
        color: "var(--accent-success, #22c55e)",
        bgColor: "rgba(34, 197, 94, 0.1)",
      };
    case "disabled":
      return {
        label: "Disabled",
        color: "var(--text-muted, #71717a)",
        bgColor: "rgba(113, 113, 122, 0.1)",
      };
    case "error":
    case "validation_error":
    case "install_error":
      return {
        label: "Error",
        color: "var(--accent-error, #ef4444)",
        bgColor: "rgba(239, 68, 68, 0.1)",
      };
    case "installing":
      return {
        label: "Installing...",
        color: "var(--accent-primary, #10b981)",
        bgColor: "rgba(16, 185, 129, 0.1)",
      };
    case "uninstalling":
      return {
        label: "Uninstalling...",
        color: "var(--accent-primary, #10b981)",
        bgColor: "rgba(16, 185, 129, 0.1)",
      };
    case "pending":
      return {
        label: "Pending",
        color: "var(--text-muted, #71717a)",
        bgColor: "rgba(113, 113, 122, 0.1)",
      };
    case "validating":
      return {
        label: "Validating...",
        color: "var(--accent-primary, #10b981)",
        bgColor: "rgba(16, 185, 129, 0.1)",
      };
    case "installed":
    default:
      return {
        label: "Installed",
        color: "var(--accent-primary, #10b981)",
        bgColor: "rgba(16, 185, 129, 0.1)",
      };
  }
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export type ServicesViewProps = {
  services: ServiceWithStats[];
  loading?: boolean;
  error?: string | null;
  onServiceEnable?: (serviceId: string) => void;
  onServiceDisable?: (serviceId: string) => void;
  onServiceConfigure?: (serviceId: string) => void;
  onServiceSubmit?: (detail: { serviceId: string; config: Record<string, unknown> }) => void;
  onServiceCancel?: () => void;
};

// Trigger type labels for the service list
const triggerLabels: Record<string, string> = {
  cron: "Scheduled",
  webhook: "Webhook",
  message: "Message",
  web: "Web Interface",
};

export function renderServicesView(props: ServicesViewProps): TemplateResult {
  const handleWizardSubmit = (e: Event) => {
    const detail = (e as CustomEvent).detail;
    props.onServiceSubmit?.(detail);
  };

  const handleWizardCancel = () => {
    props.onServiceCancel?.();
  };

  // Render action buttons for service list
  const renderListActionButtons = (service: ServiceWithStats): TemplateResult => {
    const { id, state } = service;

    if (state === "enabled") {
      return html`
        <button
          class="btn btn-sm btn-secondary"
          data-testid="service-action-${id}"
          @click=${() => props.onServiceDisable?.(id)}
          ?disabled=${props.loading}
        >
          Disable
        </button>
      `;
    }

    if (state === "disabled") {
      return html`
        <button
          class="btn btn-sm btn-primary"
          data-testid="service-action-${id}"
          @click=${() => props.onServiceEnable?.(id)}
          ?disabled=${props.loading}
        >
          Enable
        </button>
      `;
    }

    return html`<span class="action-placeholder" data-testid="service-action-${id}">-</span>`;
  };

  // Render service row for the list view
  const renderServiceRow = (service: ServiceWithStats): TemplateResult => {
    const stateInfo = getStateInfo(service.state);

    return html`
      <div
        class="service-row"
        data-testid="service-row-${service.id}"
        role="listitem"
      >
        <div class="service-row__info">
          <div class="service-row__name">${service.name}</div>
          <div class="service-row__meta">
            <span class="service-row__trigger">${triggerLabels[service.triggerType] || service.triggerType}</span>
          </div>
        </div>
        <div class="service-row__status">
          <span
            class="service-row__state-badge"
            style="color: ${stateInfo.color}; background: ${stateInfo.bgColor};"
          >
            ${stateInfo.label}
          </span>
        </div>
        <div class="service-row__actions">
          ${renderListActionButtons(service)}
          <button
            class="btn btn-sm btn-secondary"
            @click=${() => props.onServiceConfigure?.(service.id)}
            ?disabled=${props.loading}
          >
            Configure
          </button>
        </div>
      </div>
    `;
  };

  // Render service list section
  const renderServiceList = (): TemplateResult | typeof nothing => {
    if (props.services.length === 0) {
      return nothing;
    }

    return html`
      <div class="services-list-section">
        <div class="services-list" data-testid="service-list" role="list" aria-label="Installed services">
          <div class="services-list__header" role="row" aria-hidden="true">
            <div class="services-list__header-cell services-list__header-name">Service</div>
            <div class="services-list__header-cell services-list__header-status">Status</div>
            <div class="services-list__header-cell services-list__header-actions">Actions</div>
          </div>
          ${props.services.map((service) => renderServiceRow(service))}
        </div>
      </div>
    `;
  };

  const renderServiceCard = (service: ServiceWithStats): TemplateResult => {
    const stateInfo = getStateInfo(service.state);
    const hasStats = service.stats && service.stats.totalRuns > 0;

    return html`
      <div class="service-card">
        <div class="service-card__header">
          <div class="service-card__info">
            <h3 class="service-card__name">${service.name}</h3>
            <span class="service-card__id">${service.id}</span>
          </div>
          <span
            class="service-card__state"
            style="color: ${stateInfo.color}; background: ${stateInfo.bgColor}; border-color: ${stateInfo.color}"
          >
            ${stateInfo.label}
          </span>
        </div>
        
        <div class="service-card__meta">
          <span class="service-card__category">${service.category || "custom"}</span>
          <span class="service-card__separator">•</span>
          <span class="service-card__trigger">${service.triggerType}</span>
          <span class="service-card__separator">•</span>
          <span class="service-card__updated">Updated ${formatDate(service.updatedAt)}</span>
        </div>

        ${
          hasStats
            ? html`
            <div class="service-card__stats">
              <div class="service-card__stat">
                <span class="service-card__stat-value">${service.stats!.totalRuns}</span>
                <span class="service-card__stat-label">runs</span>
              </div>
              <div class="service-card__stat">
                <span class="service-card__stat-value" style="color: var(--accent-success, #22c55e)">
                  ${service.stats!.successfulRuns}
                </span>
                <span class="service-card__stat-label">success</span>
              </div>
              ${
                service.stats!.failedRuns > 0
                  ? html`
                  <div class="service-card__stat">
                    <span class="service-card__stat-value" style="color: var(--accent-error, #ef4444)">
                      ${service.stats!.failedRuns}
                    </span>
                    <span class="service-card__stat-label">failed</span>
                  </div>
                `
                  : nothing
              }
            </div>
          `
            : html`
                <div class="service-card__stats service-card__stats--empty">
                  <span class="service-card__no-stats">No runs yet</span>
                </div>
              `
        }

        <div class="service-card__actions">
          ${
            service.state === "disabled"
              ? html`
              <button
                class="btn btn-primary"
                @click=${() => props.onServiceEnable?.(service.id)}
                ?disabled=${props.loading}
              >
                Enable
              </button>
            `
              : service.state === "enabled"
                ? html`
                <button
                  class="btn btn-secondary"
                  @click=${() => props.onServiceDisable?.(service.id)}
                  ?disabled=${props.loading}
                >
                  Disable
                </button>
              `
                : nothing
          }
          <button
            class="btn btn-secondary"
            @click=${() => props.onServiceConfigure?.(service.id)}
            ?disabled=${props.loading}
          >
            Configure
          </button>
        </div>
      </div>
    `;
  };

  const renderEmptyState = (): TemplateResult => {
    return html`
      <div class="services-empty">
        <div class="services-empty__icon">${icons.package}</div>
        <h3 class="services-empty__title">No Services Installed</h3>
        <p class="services-empty__description">
          Install services from ~/.openclaw/services/ or use the CLI to add new services.
        </p>
      </div>
    `;
  };

  return html`
    <div class="services-view">
      <div class="services-header">
        <h2 class="services-header__title">${icons.settings} Services</h2>
        <p class="services-header__description">
          Manage your installed services from ~/.openclaw/services/. Services bundle skills,
          tools, and triggers to provide "set and forget" automation.
        </p>
      </div>

      ${
        props.error
          ? html`
          <div class="services-error">
            <div class="services-error__message">${props.error}</div>
          </div>
        `
          : nothing
      }

      ${renderServiceList()}

      ${
        props.services.length === 0 && !props.loading
          ? renderEmptyState()
          : html`
          <div class="services-section-title">Service Details</div>
          <div class="services-grid">
            ${props.services.map((service) => renderServiceCard(service))}
          </div>
        `
      }

      ${
        props.loading
          ? html`
              <div class="services-loading">
                <div class="services-loading__spinner"></div>
                <span class="services-loading__text">Loading services...</span>
              </div>
            `
          : nothing
      }

      <service-config-wizard
        .services=${[]}
        .loading=${props.loading ?? false}
        @wizard-submit=${handleWizardSubmit}
        @wizard-cancel=${handleWizardCancel}
      ></service-config-wizard>
    </div>
  `;
}

export const servicesViewStyles = `
  .services-view {
    padding: 24px;
    max-width: 1200px;
    margin: 0 auto;
  }

  .services-header {
    margin-bottom: 24px;
    padding-bottom: 16px;
    border-bottom: 1px solid var(--border-default, #3f3f46);
  }

  .services-header__title {
    display: flex;
    align-items: center;
    gap: 12px;
    font-size: 24px;
    font-weight: 600;
    color: var(--text-primary, #e4e4e7);
    margin: 0 0 8px 0;
  }

  .services-header__title svg {
    width: 28px;
    height: 28px;
    color: var(--accent-primary, #10b981);
  }

  .services-header__description {
    font-size: 14px;
    color: var(--text-secondary, #a1a1aa);
    margin: 0;
    line-height: 1.5;
  }

  .services-error {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 16px;
    background: var(--accent-error-bg, rgba(239, 68, 68, 0.1));
    border: 1px solid var(--accent-error, #ef4444);
    border-radius: 8px;
    margin-bottom: 24px;
  }

  .services-error__message {
    font-size: 14px;
    color: var(--accent-error, #ef4444);
  }

  .services-section-title {
    font-size: 14px;
    font-weight: 600;
    color: var(--text-secondary, #a1a1aa);
    margin: 24px 0 12px 0;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .services-list-section {
    margin-bottom: 16px;
  }

  .services-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .services-list__header {
    display: grid;
    grid-template-columns: 1fr 120px 180px;
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

  .services-list__header-cell {
    display: flex;
    align-items: center;
  }

  .services-list__header-name {
    flex: 1;
  }

  .services-list__header-status {
    width: 120px;
    justify-content: center;
  }

  .services-list__header-actions {
    width: 180px;
    justify-content: flex-end;
  }

  .service-row {
    display: grid;
    grid-template-columns: 1fr 120px 180px;
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

  .service-row__info {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }

  .service-row__name {
    font-size: 14px;
    font-weight: 500;
    color: var(--text-primary, #e4e4e7);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .service-row__meta {
    display: flex;
    gap: 8px;
  }

  .service-row__trigger {
    font-size: 12px;
    color: var(--text-tertiary, #71717a);
  }

  .service-row__status {
    display: flex;
    justify-content: center;
  }

  .service-row__state-badge {
    font-size: 11px;
    font-weight: 500;
    padding: 4px 10px;
    border-radius: 20px;
    border: 1px solid;
    white-space: nowrap;
  }

  .service-row__actions {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
  }

  .btn-sm {
    padding: 6px 12px;
    font-size: 12px;
  }

  .action-placeholder {
    font-size: 13px;
    color: var(--text-tertiary, #71717a);
    padding: 6px 12px;
  }

  .services-empty {
    text-align: center;
    padding: 64px 24px;
    color: var(--text-secondary, #a1a1aa);
  }

  .services-empty__icon {
    width: 64px;
    height: 64px;
    margin: 0 auto 16px;
    color: var(--text-muted, #71717a);
  }

  .services-empty__icon svg {
    width: 100%;
    height: 100%;
  }

  .services-empty__title {
    font-size: 20px;
    font-weight: 600;
    color: var(--text-primary, #e4e4e7);
    margin: 0 0 8px 0;
  }

  .services-empty__description {
    font-size: 14px;
    margin: 0;
    max-width: 400px;
    margin-left: auto;
    margin-right: auto;
  }

  .services-loading {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 48px;
  }

  .services-loading__spinner {
    width: 24px;
    height: 24px;
    border: 2px solid var(--border-default, #3f3f46);
    border-top-color: var(--accent-primary, #10b981);
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .services-loading__text {
    font-size: 14px;
    color: var(--text-secondary, #a1a1aa);
  }

  .services-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
    gap: 16px;
  }

  .service-card {
    background: var(--bg-secondary, #18181b);
    border: 1px solid var(--border-default, #3f3f46);
    border-radius: 12px;
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .service-card__header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 12px;
  }

  .service-card__info {
    flex: 1;
    min-width: 0;
  }

  .service-card__name {
    font-size: 16px;
    font-weight: 600;
    color: var(--text-primary, #e4e4e7);
    margin: 0 0 4px 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .service-card__id {
    font-size: 12px;
    color: var(--text-muted, #71717a);
    font-family: monospace;
  }

  .service-card__state {
    font-size: 11px;
    font-weight: 500;
    padding: 4px 10px;
    border-radius: 20px;
    border: 1px solid;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .service-card__meta {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    color: var(--text-secondary, #a1a1aa);
  }

  .service-card__separator {
    color: var(--text-muted, #71717a);
  }

  .service-card__category {
    text-transform: capitalize;
  }

  .service-card__trigger {
    text-transform: capitalize;
  }

  .service-card__stats {
    display: flex;
    gap: 16px;
    padding: 12px 0;
    border-top: 1px solid var(--border-default, #3f3f46);
    border-bottom: 1px solid var(--border-default, #3f3f46);
  }

  .service-card__stats--empty {
    justify-content: center;
  }

  .service-card__stat {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
  }

  .service-card__stat-value {
    font-size: 18px;
    font-weight: 600;
    color: var(--text-primary, #e4e4e7);
  }

  .service-card__stat-label {
    font-size: 11px;
    color: var(--text-muted, #71717a);
    text-transform: uppercase;
  }

  .service-card__no-stats {
    font-size: 12px;
    color: var(--text-muted, #71717a);
    font-style: italic;
  }

  .service-card__actions {
    display: flex;
    gap: 8px;
    margin-top: auto;
  }

  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 8px 16px;
    font-size: 13px;
    font-weight: 500;
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.2s ease;
    border: none;
    flex: 1;
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-primary {
    background: var(--accent-primary, #10b981);
    color: white;
  }

  .btn-primary:hover:not(:disabled) {
    background: var(--accent-primary-hover, #059669);
  }

  .btn-secondary {
    background: var(--bg-tertiary, #27272a);
    color: var(--text-primary, #e4e4e7);
    border: 1px solid var(--border-default, #3f3f46);
  }

  .btn-secondary:hover:not(:disabled) {
    background: var(--bg-hover, #3f3f46);
  }
`;
