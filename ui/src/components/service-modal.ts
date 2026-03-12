/**
 * Service Modal Component
 *
 * WebView modal for displaying service UI in an iframe.
 * Handles lifecycle, loading states, error states, and keyboard interactions.
 */

import { css, html, nothing, type TemplateResult } from "lit";
import { LitElement } from "lit";
import { customElement, property, state } from "lit/decorators.js";

export type ModalState = "closed" | "loading" | "loaded" | "error";

export type ServiceModalOpenEvent = CustomEvent<{
  serviceId: string;
  serviceName: string;
}>;

export type ServiceModalCloseEvent = CustomEvent<{
  serviceId: string | null;
}>;

export type ServiceModalErrorEvent = CustomEvent<{
  serviceId: string;
  error: string;
}>;

// SVG Icons
const icons = {
  close: html`
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <line x1="18" y1="6" x2="6" y2="18"></line>
      <line x1="6" y1="6" x2="18" y2="18"></line>
    </svg>
  `,
  loader: html`
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      class="spinner"
    >
      <circle cx="12" cy="12" r="10" stroke-dasharray="60" stroke-dashoffset="20"></circle>
    </svg>
  `,
  error: html`
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <circle cx="12" cy="12" r="10"></circle>
      <line x1="12" y1="8" x2="12" y2="12"></line>
      <line x1="12" y1="16" x2="12.01" y2="16"></line>
    </svg>
  `,
  external: html`
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
      <polyline points="15 3 21 3 21 9"></polyline>
      <line x1="10" y1="14" x2="21" y2="3"></line>
    </svg>
  `,
};

@customElement("service-modal")
export class ServiceModal extends LitElement {
  @property({ type: String }) serviceId: string | null = null;
  @property({ type: String }) serviceName: string = "";
  @property({ type: String }) basePath: string = "/__openclaw__/services";
  @property({ type: Number }) loadingTimeout: number = 30000; // 30 seconds
  @property({ type: Boolean }) closeOnBackdrop: boolean = true;
  @property({ type: Boolean }) closeOnEscape: boolean = true;

  @state() private _state: ModalState = "closed";
  @state() private _errorMessage: string = "";
  @state() private _isAnimating: boolean = false;

  private _loadingTimer: ReturnType<typeof setTimeout> | null = null;
  private _iframeRef: HTMLIFrameElement | null = null;
  private _boundKeyHandler: (e: KeyboardEvent) => void;

  static styles = css`
    :host {
      display: block;
      font-family: var(--font-family, system-ui, -apple-system, sans-serif);
    }

    * {
      box-sizing: border-box;
    }

    .modal-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.7);
      backdrop-filter: blur(4px);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      z-index: 1000;
      opacity: 0;
      transition: opacity 0.2s ease;
      pointer-events: none;
    }

    .modal-overlay.open {
      opacity: 1;
      pointer-events: auto;
    }

    .modal-container {
      background: var(--surface-primary, #27272a);
      border: 1px solid var(--border-default, #3f3f46);
      border-radius: 12px;
      width: 100%;
      max-width: 900px;
      height: 80vh;
      max-height: 700px;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
      transform: scale(0.95) translateY(10px);
      transition: transform 0.2s ease;
    }

    .modal-overlay.open .modal-container {
      transform: scale(1) translateY(0);
    }

    /* Header */
    .modal-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 16px 20px;
      border-bottom: 1px solid var(--border-default, #3f3f46);
      background: var(--surface-secondary, #18181b);
      flex-shrink: 0;
    }

    .modal-title {
      display: flex;
      align-items: center;
      gap: 12px;
      min-width: 0;
    }

    .modal-title__icon {
      width: 32px;
      height: 32px;
      background: var(--accent-primary-alpha, rgba(16, 185, 129, 0.1));
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--accent-primary, #10b981);
      flex-shrink: 0;
    }

    .modal-title__icon svg {
      width: 18px;
      height: 18px;
    }

    .modal-title__text {
      display: flex;
      flex-direction: column;
      min-width: 0;
    }

    .modal-title__name {
      font-size: 16px;
      font-weight: 600;
      color: var(--text-primary, #e4e4e7);
      margin: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .modal-title__id {
      font-size: 12px;
      color: var(--text-muted, #71717a);
      font-family: monospace;
      margin: 0;
    }

    .modal-actions {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-shrink: 0;
    }

    .btn-icon {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 36px;
      height: 36px;
      padding: 0;
      background: transparent;
      border: 1px solid transparent;
      border-radius: 8px;
      color: var(--text-secondary, #a1a1aa);
      cursor: pointer;
      transition: all 0.2s ease;
    }

    .btn-icon:hover {
      background: var(--bg-hover, #3f3f46);
      color: var(--text-primary, #e4e4e7);
      border-color: var(--border-default, #3f3f46);
    }

    .btn-icon svg {
      width: 18px;
      height: 18px;
    }

    /* Content */
    .modal-content {
      flex: 1;
      position: relative;
      overflow: hidden;
      background: var(--surface-primary, #27272a);
    }

    .modal-iframe {
      width: 100%;
      height: 100%;
      border: none;
      background: transparent;
      opacity: 0;
      transition: opacity 0.3s ease;
    }

    .modal-iframe.loaded {
      opacity: 1;
    }

    /* Loading State */
    .loading-state {
      position: absolute;
      inset: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 16px;
      background: var(--surface-primary, #27272a);
      opacity: 1;
      transition: opacity 0.2s ease;
    }

    .loading-state.hidden {
      opacity: 0;
      pointer-events: none;
    }

    .loading-state__spinner {
      width: 48px;
      height: 48px;
      border: 3px solid var(--border-default, #3f3f46);
      border-top-color: var(--accent-primary, #10b981);
      border-radius: 50%;
      animation: spin 1s linear infinite;
    }

    .loading-state__text {
      font-size: 14px;
      color: var(--text-secondary, #a1a1aa);
      margin: 0;
    }

    @keyframes spin {
      to {
        transform: rotate(360deg);
      }
    }

    /* Error State */
    .error-state {
      position: absolute;
      inset: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 16px;
      padding: 40px;
      text-align: center;
      background: var(--surface-primary, #27272a);
    }

    .error-state__icon {
      width: 64px;
      height: 64px;
      color: var(--accent-error, #ef4444);
    }

    .error-state__icon svg {
      width: 100%;
      height: 100%;
    }

    .error-state__title {
      font-size: 18px;
      font-weight: 600;
      color: var(--text-primary, #e4e4e7);
      margin: 0;
    }

    .error-state__message {
      font-size: 14px;
      color: var(--text-secondary, #a1a1aa);
      margin: 0;
      max-width: 400px;
      line-height: 1.5;
    }

    .error-state__actions {
      display: flex;
      gap: 12px;
      margin-top: 8px;
    }

    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 10px 20px;
      font-size: 14px;
      font-weight: 500;
      border-radius: 8px;
      cursor: pointer;
      transition: all 0.2s ease;
      border: none;
    }

    .btn-primary {
      background: var(--accent-primary, #10b981);
      color: white;
    }

    .btn-primary:hover {
      background: var(--accent-primary-hover, #059669);
    }

    .btn-secondary {
      background: var(--bg-tertiary, #27272a);
      color: var(--text-primary, #e4e4e7);
      border: 1px solid var(--border-default, #3f3f46);
    }

    .btn-secondary:hover {
      background: var(--bg-hover, #3f3f46);
    }

    /* Responsive */
    @media (max-width: 640px) {
      .modal-overlay {
        padding: 0;
      }

      .modal-container {
        max-width: 100%;
        height: 100%;
        max-height: 100%;
        border-radius: 0;
      }

      .modal-title__id {
        display: none;
      }
    }

    /* Reduced Motion */
    @media (prefers-reduced-motion: reduce) {
      .modal-overlay,
      .modal-container,
      .modal-iframe,
      .loading-state {
        transition: none;
      }

      .loading-state__spinner {
        animation: none;
        border: 3px solid var(--accent-primary, #10b981);
      }
    }
  `;

  constructor() {
    super();
    this._boundKeyHandler = this._handleKeyDown.bind(this);
  }

  override connectedCallback(): void {
    super.connectedCallback();
    if (this.closeOnEscape) {
      document.addEventListener("keydown", this._boundKeyHandler);
    }
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this._clearLoadingTimer();
    document.removeEventListener("keydown", this._boundKeyHandler);
  }

  /**
   * Open the modal with a service
   */
  open(serviceId: string, serviceName: string): void {
    if (this._state !== "closed") {
      this.close();
    }

    this.serviceId = serviceId;
    this.serviceName = serviceName;
    this._state = "loading";
    this._errorMessage = "";
    this._isAnimating = true;

    // Start loading timer
    this._clearLoadingTimer();
    this._loadingTimer = setTimeout(() => {
      if (this._state === "loading") {
        this._setError("Service took too long to load. Please try again.");
      }
    }, this.loadingTimeout);

    // Dispatch open event
    this.dispatchEvent(
      new CustomEvent("modal-open", {
        detail: { serviceId, serviceName },
        bubbles: true,
        composed: true,
      }) as ServiceModalOpenEvent,
    );

    // Trigger animation
    requestAnimationFrame(() => {
      this._isAnimating = false;
    });
  }

  /**
   * Close the modal and cleanup
   */
  close(): void {
    if (this._state === "closed") {
      return;
    }

    const previousServiceId = this.serviceId;

    this._clearLoadingTimer();
    this._state = "closed";
    this._errorMessage = "";
    this._isAnimating = true;

    // Clear iframe src to stop any running scripts
    if (this._iframeRef) {
      this._iframeRef.src = "about:blank";
    }

    // Dispatch close event
    this.dispatchEvent(
      new CustomEvent("modal-close", {
        detail: { serviceId: previousServiceId },
        bubbles: true,
        composed: true,
      }) as ServiceModalCloseEvent,
    );

    // Reset after animation
    setTimeout(() => {
      this._isAnimating = false;
      this.serviceId = null;
      this.serviceName = "";
    }, 200);
  }

  /**
   * Check if modal is currently open
   */
  isOpen(): boolean {
    return this._state !== "closed";
  }

  /**
   * Get current modal state
   */
  getState(): ModalState {
    return this._state;
  }

  /**
   * Reload the current service
   */
  reload(): void {
    if (!this.serviceId || !this._iframeRef) {
      return;
    }

    this._state = "loading";
    this._errorMessage = "";

    // Reset loading timer
    this._clearLoadingTimer();
    this._loadingTimer = setTimeout(() => {
      if (this._state === "loading") {
        this._setError("Service took too long to load. Please try again.");
      }
    }, this.loadingTimeout);

    // Reload iframe
    this._iframeRef.src = this._buildIframeSrc();
  }

  private _buildIframeSrc(): string {
    if (!this.serviceId) {
      return "about:blank";
    }
    return `${this.basePath}/${this.serviceId}/index.html`;
  }

  private _clearLoadingTimer(): void {
    if (this._loadingTimer) {
      clearTimeout(this._loadingTimer);
      this._loadingTimer = null;
    }
  }

  private _setError(message: string): void {
    this._errorMessage = message;
    this._state = "error";
    this._clearLoadingTimer();

    if (this.serviceId) {
      this.dispatchEvent(
        new CustomEvent("modal-error", {
          detail: { serviceId: this.serviceId, error: message },
          bubbles: true,
          composed: true,
        }) as ServiceModalErrorEvent,
      );
    }
  }

  private _handleKeyDown(e: KeyboardEvent): void {
    if (e.key === "Escape" && this.isOpen() && !this._isAnimating) {
      e.preventDefault();
      this.close();
    }
  }

  private _handleBackdropClick(e: MouseEvent): void {
    if (!this.closeOnBackdrop) {
      return;
    }

    const target = e.target as HTMLElement;
    if (target.classList.contains("modal-overlay")) {
      this.close();
    }
  }

  private _handleIframeLoad(): void {
    // Only transition to loaded if we're still in loading state
    if (this._state === "loading") {
      this._state = "loaded";
      this._clearLoadingTimer();
    }
  }

  private _handleIframeError(): void {
    this._setError(
      "Failed to load service UI. Please check that the service is properly installed.",
    );
  }

  private _renderHeader(): TemplateResult {
    return html`
      <div class="modal-header">
        <div class="modal-title">
          <div class="modal-title__icon">${icons.external}</div>
          <div class="modal-title__text">
            <h3 class="modal-title__name">${this.serviceName || "Service"}</h3>
            ${this.serviceId ? html`<span class="modal-title__id">${this.serviceId}</span>` : nothing}
          </div>
        </div>
        <div class="modal-actions">
          <button
            class="btn-icon"
            @click=${this.close.bind(this)}
            title="Close"
            aria-label="Close modal"
          >
            ${icons.close}
          </button>
        </div>
      </div>
    `;
  }

  private _renderLoadingState(): TemplateResult {
    const isHidden = this._state !== "loading";
    return html`
      <div class="loading-state ${isHidden ? "hidden" : ""}">
        <div class="loading-state__spinner"></div>
        <p class="loading-state__text">Loading ${this.serviceName || "service"}...</p>
      </div>
    `;
  }

  private _renderErrorState(): TemplateResult | typeof nothing {
    if (this._state !== "error") {
      return nothing;
    }

    return html`
      <div class="error-state">
        <div class="error-state__icon">${icons.error}</div>
        <h3 class="error-state__title">Failed to Load Service</h3>
        <p class="error-state__message">${this._errorMessage}</p>
        <div class="error-state__actions">
          <button class="btn btn-primary" @click=${this.reload.bind(this)}>Retry</button>
          <button class="btn btn-secondary" @click=${this.close.bind(this)}>Close</button>
        </div>
      </div>
    `;
  }

  private _renderIframe(): TemplateResult {
    const src = this._buildIframeSrc();
    const isLoaded = this._state === "loaded";

    return html`
      <iframe
        class="modal-iframe ${isLoaded ? "loaded" : ""}"
        src=${src}
        title=${this.serviceName || "Service UI"}
        sandbox="allow-scripts allow-same-origin allow-forms"
        allow="fullscreen"
        @load=${this._handleIframeLoad.bind(this)}
        @error=${this._handleIframeError.bind(this)}
        ${(el: HTMLIFrameElement) => {
          this._iframeRef = el;
        }}
      ></iframe>
    `;
  }

  override render(): TemplateResult {
    const isOpen = this._state !== "closed";

    return html`
      <div
        class="modal-overlay ${isOpen ? "open" : ""}"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        @click=${this._handleBackdropClick.bind(this)}
      >
        <div class="modal-container" @click=${(e: Event) => e.stopPropagation()}>
          ${isOpen ? this._renderHeader() : nothing}
          <div class="modal-content">
            ${isOpen ? this._renderIframe() : nothing}
            ${this._renderLoadingState()}
            ${this._renderErrorState()}
          </div>
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "service-modal": ServiceModal;
  }
}

export default ServiceModal;
export { icons };
