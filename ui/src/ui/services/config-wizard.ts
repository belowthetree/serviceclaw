/* eslint-disable @typescript-eslint/no-base-to-string */
/**
 * Service Configuration Wizard
 *
 * Interactive multi-step wizard for configuring OpenClaw services.
 * Renders forms from JSON schema with support for x-openclaw UI hints.
 */

import { css, html, nothing, type TemplateResult } from "lit";
import { LitElement } from "lit";
import { customElement, property, state } from "lit/decorators.js";

// Types matching src/services/schema.ts
type ConfigFieldType = "string" | "number" | "boolean" | "array" | "object" | "secret";

type ConfigFieldExtensions = {
  inputType?:
    | "text"
    | "select"
    | "multiselect"
    | "channel-picker"
    | "skill-picker"
    | "number"
    | "textarea"
    | "toggle";
  validateOn?: "blur" | "change" | "submit";
};

export type ServiceConfigField = {
  type: ConfigFieldType;
  description: string;
  required?: boolean;
  default?: unknown;
  enum?: string[];
  items?: { type?: string; enum?: string[] };
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  "x-openclaw"?: ConfigFieldExtensions;
};

type ServiceManifest = {
  $schema?: string;
  id: string;
  name: string;
  description: string;
  version: string;
  author?: string;
  category?:
    | "productivity"
    | "communication"
    | "monitoring"
    | "automation"
    | "integration"
    | "custom";
  trigger: unknown;
  config: Record<string, ServiceConfigField>;
  requires: unknown;
  capabilities: unknown;
  execution?: unknown;
};

type InputType =
  | "text"
  | "select"
  | "multiselect"
  | "channel-picker"
  | "skill-picker"
  | "number"
  | "textarea"
  | "toggle";

type WizardStep = {
  id: string;
  title: string;
  description: string;
  fields: string[];
};

type WizardState = {
  currentStep: number;
  values: Record<string, unknown>;
  errors: Record<string, string>;
  touched: Set<string>;
};

type ServiceOption = {
  id: string;
  manifest: ServiceManifest;
};

// SVG Icons
const icons = {
  chevronRight: html`
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <polyline points="9 18 15 12 9 6"></polyline>
    </svg>
  `,
  chevronLeft: html`
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <polyline points="15 18 9 12 15 6"></polyline>
    </svg>
  `,
  check: html`
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <polyline points="20 6 9 17 4 12"></polyline>
    </svg>
  `,
  settings: html`
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
      <circle cx="12" cy="12" r="3"></circle>
      <path
        d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"
      ></path>
    </svg>
  `,
  package: html`
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
      <path d="m7.5 4.27 9 5.15"></path>
      <path
        d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"
      ></path>
      <path d="m3.3 7 8.7 5 8.7-5"></path>
      <path d="M12 22V12"></path>
    </svg>
  `,
  info: html`
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
      <circle cx="12" cy="12" r="10"></circle>
      <line x1="12" y1="16" x2="12" y2="12"></line>
      <line x1="12" y1="8" x2="12.01" y2="8"></line>
    </svg>
  `,
  alertCircle: html`
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
      <circle cx="12" cy="12" r="10"></circle>
      <line x1="12" y1="8" x2="12" y2="12"></line>
      <line x1="12" y1="16" x2="12.01" y2="16"></line>
    </svg>
  `,
};

function humanize(key: string): string {
  return key
    .replace(/_/g, " ")
    .replace(/([A-Z])/g, " $1")
    .replace(/\b\w/g, (str) => str.toUpperCase())
    .trim();
}

function getInputType(field: ServiceConfigField): InputType {
  const xOpenClaw = field["x-openclaw"];
  if (xOpenClaw?.inputType) {
    return xOpenClaw.inputType as InputType;
  }

  // Default based on field type
  switch (field.type) {
    case "boolean":
      return "toggle";
    case "number":
      return "number";
    case "array":
      return "multiselect";
    case "string":
      if (field.enum) {
        return "select";
      }
      return "text";
    default:
      return "text";
  }
}

function validateField(field: ServiceConfigField, value: unknown): string | null {
  // Required check
  if (field.required && (value === undefined || value === null || value === "")) {
    return "This field is required";
  }

  // Skip further validation if empty and not required
  if (!field.required && (value === undefined || value === null || value === "")) {
    return null;
  }

  // Type validation
  switch (field.type) {
    case "string":
      if (typeof value !== "string") {
        return "Must be a string";
      }
      if (field.minLength !== undefined && value.length < field.minLength) {
        return `Must be at least ${field.minLength} characters`;
      }
      if (field.maxLength !== undefined && value.length > field.maxLength) {
        return `Must be at most ${field.maxLength} characters`;
      }
      if (field.pattern && !new RegExp(field.pattern).test(value)) {
        return "Invalid format";
      }
      if (field.enum && !field.enum.includes(value)) {
        return `Must be one of: ${field.enum.join(", ")}`;
      }
      break;
    case "number":
      if (typeof value !== "number" || Number.isNaN(value)) {
        return "Must be a number";
      }
      if (field.minimum !== undefined && value < field.minimum) {
        return `Must be at least ${field.minimum}`;
      }
      if (field.maximum !== undefined && value > field.maximum) {
        return `Must be at most ${field.maximum}`;
      }
      break;
    case "boolean":
      if (typeof value !== "boolean") {
        return "Must be a boolean";
      }
      break;
    case "array":
      if (!Array.isArray(value)) {
        return "Must be an array";
      }
      break;
    case "secret":
      if (typeof value !== "string") {
        return "Must be a string";
      }
      break;
  }

  return null;
}

@customElement("service-config-wizard")
export class ServiceConfigWizard extends LitElement {
  @property({ type: Array }) services: ServiceOption[] = [];
  @property({ type: Object }) selectedService: ServiceManifest | null = null;
  @property({ type: Boolean }) loading = false;

  @state() private wizardState: WizardState = {
    currentStep: 0,
    values: {},
    errors: {},
    touched: new Set(),
  };

  @state() private steps: WizardStep[] = [];

  static styles = css`
    :host {
      display: block;
      font-family: var(--font-family, system-ui, -apple-system, sans-serif);
      color: var(--text-primary, #e4e4e7);
    }

    .wizard-container {
      max-width: 800px;
      margin: 0 auto;
      padding: 24px;
    }

    /* Progress Indicator */
    .progress-bar {
      display: flex;
      align-items: center;
      margin-bottom: 32px;
      padding: 0 16px;
    }

    .progress-step {
      display: flex;
      flex-direction: column;
      align-items: center;
      flex: 1;
      position: relative;
    }

    .progress-step__indicator {
      width: 36px;
      height: 36px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 14px;
      font-weight: 600;
      background: var(--bg-tertiary, #27272a);
      color: var(--text-muted, #a1a1aa);
      border: 2px solid var(--border-default, #3f3f46);
      transition: all 0.2s ease;
    }

    .progress-step.active .progress-step__indicator {
      background: var(--accent-primary, #10b981);
      color: white;
      border-color: var(--accent-primary, #10b981);
    }

    .progress-step.completed .progress-step__indicator {
      background: var(--accent-success, #22c55e);
      color: white;
      border-color: var(--accent-success, #22c55e);
    }

    .progress-step__label {
      margin-top: 8px;
      font-size: 12px;
      color: var(--text-muted, #a1a1aa);
      text-align: center;
    }

    .progress-step.active .progress-step__label {
      color: var(--text-primary, #e4e4e7);
      font-weight: 500;
    }

    .progress-connector {
      flex: 1;
      height: 2px;
      background: var(--border-default, #3f3f46);
      margin: 0 8px;
      margin-bottom: 24px;
    }

    .progress-connector.completed {
      background: var(--accent-success, #22c55e);
    }

    /* Step Content */
    .step-content {
      background: var(--bg-secondary, #18181b);
      border: 1px solid var(--border-default, #3f3f46);
      border-radius: 12px;
      padding: 32px;
      margin-bottom: 24px;
    }

    .step-header {
      margin-bottom: 24px;
    }

    .step-header__title {
      font-size: 20px;
      font-weight: 600;
      color: var(--text-primary, #e4e4e7);
      margin: 0 0 8px 0;
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .step-header__description {
      font-size: 14px;
      color: var(--text-secondary, #a1a1aa);
      margin: 0;
      line-height: 1.5;
    }

    /* Service Selection Grid */
    .service-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
      gap: 16px;
    }

    .service-card {
      background: var(--bg-tertiary, #27272a);
      border: 2px solid var(--border-default, #3f3f46);
      border-radius: 12px;
      padding: 20px;
      cursor: pointer;
      transition: all 0.2s ease;
    }

    .service-card:hover {
      border-color: var(--accent-primary, #10b981);
      transform: translateY(-2px);
    }

    .service-card.selected {
      border-color: var(--accent-primary, #10b981);
      background: var(--accent-primary-alpha, rgba(16, 185, 129, 0.1));
    }

    .service-card__icon {
      width: 40px;
      height: 40px;
      color: var(--accent-primary, #10b981);
      margin-bottom: 12px;
    }

    .service-card__name {
      font-size: 16px;
      font-weight: 600;
      color: var(--text-primary, #e4e4e7);
      margin: 0 0 4px 0;
    }

    .service-card__description {
      font-size: 13px;
      color: var(--text-secondary, #a1a1aa);
      margin: 0;
      line-height: 1.4;
    }

    /* Form Fields */
    .form-fields {
      display: flex;
      flex-direction: column;
      gap: 20px;
    }

    .field-group {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .field-label {
      font-size: 14px;
      font-weight: 500;
      color: var(--text-primary, #e4e4e7);
      display: flex;
      align-items: center;
      gap: 4px;
    }

    .field-required {
      color: var(--accent-error, #ef4444);
    }

    .field-description {
      font-size: 13px;
      color: var(--text-secondary, #a1a1aa);
      line-height: 1.4;
    }

    .field-input {
      background: var(--bg-tertiary, #27272a);
      border: 1px solid var(--border-default, #3f3f46);
      border-radius: 8px;
      padding: 10px 14px;
      font-size: 14px;
      color: var(--text-primary, #e4e4e7);
      transition: border-color 0.2s ease;
      width: 100%;
      box-sizing: border-box;
    }

    .field-input:focus {
      outline: none;
      border-color: var(--accent-primary, #10b981);
    }

    .field-input.error {
      border-color: var(--accent-error, #ef4444);
    }

    .field-input::placeholder {
      color: var(--text-muted, #71717a);
    }

    select.field-input {
      cursor: pointer;
      appearance: none;
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='%23a1a1aa' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E");
      background-repeat: no-repeat;
      background-position: right 10px center;
      background-size: 16px;
      padding-right: 36px;
    }

    textarea.field-input {
      resize: vertical;
      min-height: 80px;
      font-family: inherit;
    }

    .field-error {
      font-size: 13px;
      color: var(--accent-error, #ef4444);
      display: flex;
      align-items: center;
      gap: 4px;
    }

    /* Toggle Switch */
    .toggle-field {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 16px;
      background: var(--bg-tertiary, #27272a);
      border: 1px solid var(--border-default, #3f3f46);
      border-radius: 8px;
    }

    .toggle-field__content {
      flex: 1;
    }

    .toggle-field__label {
      font-size: 14px;
      font-weight: 500;
      color: var(--text-primary, #e4e4e7);
      margin: 0 0 4px 0;
    }

    .toggle-field__description {
      font-size: 13px;
      color: var(--text-secondary, #a1a1aa);
      margin: 0;
    }

    .toggle-switch {
      position: relative;
      width: 48px;
      height: 26px;
    }

    .toggle-switch input {
      opacity: 0;
      width: 0;
      height: 0;
    }

    .toggle-slider {
      position: absolute;
      cursor: pointer;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background-color: var(--bg-primary, #09090b);
      transition: 0.3s;
      border-radius: 26px;
      border: 1px solid var(--border-default, #3f3f46);
    }

    .toggle-slider:before {
      position: absolute;
      content: "";
      height: 20px;
      width: 20px;
      left: 2px;
      bottom: 2px;
      background-color: var(--text-secondary, #a1a1aa);
      transition: 0.3s;
      border-radius: 50%;
    }

    input:checked + .toggle-slider {
      background-color: var(--accent-primary, #10b981);
      border-color: var(--accent-primary, #10b981);
    }

    input:checked + .toggle-slider:before {
      transform: translateX(22px);
      background-color: white;
    }

    /* Multi-select */
    .multiselect-options {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    .multiselect-option {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      background: var(--bg-tertiary, #27272a);
      border: 1px solid var(--border-default, #3f3f46);
      border-radius: 6px;
      cursor: pointer;
      font-size: 13px;
      color: var(--text-secondary, #a1a1aa);
      transition: all 0.2s ease;
    }

    .multiselect-option:hover {
      border-color: var(--accent-primary, #10b981);
    }

    .multiselect-option.selected {
      background: var(--accent-primary-alpha, rgba(16, 185, 129, 0.2));
      border-color: var(--accent-primary, #10b981);
      color: var(--accent-primary, #10b981);
    }

    .multiselect-option input {
      cursor: pointer;
    }

    /* Summary */
    .summary-section {
      background: var(--bg-tertiary, #27272a);
      border: 1px solid var(--border-default, #3f3f46);
      border-radius: 8px;
      padding: 16px;
      margin-bottom: 16px;
    }

    .summary-section__title {
      font-size: 14px;
      font-weight: 600;
      color: var(--text-primary, #e4e4e7);
      margin: 0 0 12px 0;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .summary-item {
      display: flex;
      justify-content: space-between;
      padding: 8px 0;
      border-bottom: 1px solid var(--border-default, #3f3f46);
    }

    .summary-item:last-child {
      border-bottom: none;
    }

    .summary-item__label {
      font-size: 13px;
      color: var(--text-secondary, #a1a1aa);
    }

    .summary-item__value {
      font-size: 13px;
      color: var(--text-primary, #e4e4e7);
      font-weight: 500;
      max-width: 50%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    /* Actions */
    .wizard-actions {
      display: flex;
      justify-content: space-between;
      gap: 12px;
    }

    .btn {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 12px 24px;
      font-size: 14px;
      font-weight: 500;
      border-radius: 8px;
      cursor: pointer;
      transition: all 0.2s ease;
      border: none;
    }

    .btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .btn-secondary {
      background: var(--bg-tertiary, #27272a);
      color: var(--text-primary, #e4e4e7);
      border: 1px solid var(--border-default, #3f3f46);
    }

    .btn-secondary:hover:not(:disabled) {
      background: var(--bg-hover, #3f3f46);
    }

    .btn-primary {
      background: var(--accent-primary, #10b981);
      color: white;
    }

    .btn-primary:hover:not(:disabled) {
      background: var(--accent-primary-hover, #059669);
    }

    .btn-success {
      background: var(--accent-success, #22c55e);
      color: white;
    }

    .btn-success:hover:not(:disabled) {
      background: var(--accent-success-hover, #16a34a);
    }

    .btn svg {
      width: 18px;
      height: 18px;
    }

    /* Loading State */
    .loading-overlay {
      position: absolute;
      inset: 0;
      background: rgba(0, 0, 0, 0.5);
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 12px;
    }

    .spinner {
      width: 40px;
      height: 40px;
      border: 3px solid var(--border-default, #3f3f46);
      border-top-color: var(--accent-primary, #10b981);
      border-radius: 50%;
      animation: spin 1s linear infinite;
    }

    @keyframes spin {
      to {
        transform: rotate(360deg);
      }
    }

    .step-wrapper {
      position: relative;
    }

    /* Empty State */
    .empty-state {
      text-align: center;
      padding: 48px 24px;
      color: var(--text-secondary, #a1a1aa);
    }

    .empty-state__icon {
      width: 64px;
      height: 64px;
      margin: 0 auto 16px;
      color: var(--text-muted, #71717a);
    }

    .empty-state__title {
      font-size: 18px;
      font-weight: 600;
      color: var(--text-primary, #e4e4e7);
      margin: 0 0 8px 0;
    }

    .empty-state__description {
      font-size: 14px;
      margin: 0;
    }
  `;

  override updated(changedProperties: Map<string, unknown>) {
    if (changedProperties.has("selectedService") && this.selectedService) {
      this.generateSteps();
      this.initializeValues();
    }
  }

  private generateSteps() {
    if (!this.selectedService) {
      this.steps = [];
      return;
    }

    const configEntries = Object.entries(this.selectedService.config);

    // Group fields into logical steps
    const requiredFields = configEntries.filter(([, field]) => field.required);
    const optionalFields = configEntries.filter(([, field]) => !field.required);

    this.steps = [
      {
        id: "select",
        title: "Select Service",
        description: "Choose a service to configure",
        fields: [],
      },
    ];

    if (requiredFields.length > 0) {
      this.steps.push({
        id: "required",
        title: "Required Settings",
        description: "Configure the required settings for this service",
        fields: requiredFields.map(([key]) => key),
      });
    }

    if (optionalFields.length > 0) {
      // Group optional fields into batches of 4 for better UX
      const batchSize = 4;
      for (let i = 0; i < optionalFields.length; i += batchSize) {
        const batch = optionalFields.slice(i, i + batchSize);
        this.steps.push({
          id: `optional-${Math.floor(i / batchSize)}`,
          title: i === 0 ? "Optional Settings" : "Additional Options",
          description: "Customize additional settings (optional)",
          fields: batch.map(([key]) => key),
        });
      }
    }

    this.steps.push({
      id: "summary",
      title: "Review & Install",
      description: "Review your configuration before installing",
      fields: [],
    });
  }

  private initializeValues() {
    if (!this.selectedService) {
      return;
    }

    const values: Record<string, unknown> = {};
    for (const [key, field] of Object.entries(this.selectedService.config)) {
      values[key] = field.default;
    }

    this.wizardState = {
      currentStep: 0,
      values,
      errors: {},
      touched: new Set(),
    };
  }

  private selectService(service: ServiceOption) {
    this.selectedService = service.manifest;
    this.dispatchEvent(new CustomEvent("service-selected", { detail: service }));
    this.nextStep();
  }

  private updateValue(fieldKey: string, value: unknown) {
    const field = this.selectedService?.config[fieldKey];
    if (!field) {
      return;
    }

    const error = validateField(field, value);

    this.wizardState = {
      ...this.wizardState,
      values: { ...this.wizardState.values, [fieldKey]: value },
      errors: { ...this.wizardState.errors, [fieldKey]: error || "" },
      touched: new Set([...this.wizardState.touched, fieldKey]),
    };
  }

  private validateCurrentStep(): boolean {
    const step = this.steps[this.wizardState.currentStep];
    if (!step || step.id === "select" || step.id === "summary") {
      return true;
    }

    const errors: Record<string, string> = {};
    let hasErrors = false;

    for (const fieldKey of step.fields) {
      const field = this.selectedService?.config[fieldKey];
      if (!field) {
        continue;
      }

      const error = validateField(field, this.wizardState.values[fieldKey]);
      if (error) {
        errors[fieldKey] = error;
        hasErrors = true;
      }
    }

    this.wizardState = {
      ...this.wizardState,
      errors: { ...this.wizardState.errors, ...errors },
      touched: new Set([...this.wizardState.touched, ...step.fields]),
    };

    return !hasErrors;
  }

  private nextStep() {
    if (!this.validateCurrentStep()) {
      return;
    }

    if (this.wizardState.currentStep < this.steps.length - 1) {
      this.wizardState = {
        ...this.wizardState,
        currentStep: this.wizardState.currentStep + 1,
      };
    }
  }

  private prevStep() {
    if (this.wizardState.currentStep > 0) {
      this.wizardState = {
        ...this.wizardState,
        currentStep: this.wizardState.currentStep - 1,
      };
    }
  }

  private submit() {
    if (!this.selectedService) {
      return;
    }

    this.dispatchEvent(
      new CustomEvent("wizard-submit", {
        detail: {
          serviceId: this.selectedService.id,
          config: this.wizardState.values,
        },
      }),
    );
  }

  private cancel() {
    this.dispatchEvent(new CustomEvent("wizard-cancel"));
  }

  private renderProgress(): TemplateResult {
    const currentStep = this.wizardState.currentStep;

    return html`
      <div class="progress-bar">
        ${this.steps.map((step, index) => {
          const isActive = index === currentStep;
          const isCompleted = index < currentStep;

          return html`
            ${
              index > 0
                ? html`
              <div class="progress-connector ${isCompleted ? "completed" : ""}"></div>
            `
                : nothing
            }
            <div class="progress-step ${isActive ? "active" : ""} ${isCompleted ? "completed" : ""}">
              <div class="progress-step__indicator">
                ${isCompleted ? icons.check : index + 1}
              </div>
              <span class="progress-step__label">${step.title}</span>
            </div>
          `;
        })}
      </div>
    `;
  }

  private renderServiceSelection(): TemplateResult {
    if (this.services.length === 0) {
      return html`
        <div class="empty-state">
          <div class="empty-state__icon">${icons.package}</div>
          <h3 class="empty-state__title">No Services Available</h3>
          <p class="empty-state__description">Install services to get started with configuration.</p>
        </div>
      `;
    }

    return html`
      <div class="service-grid">
        ${this.services.map(
          (service) => html`
          <div 
            class="service-card ${this.selectedService?.id === service.id ? "selected" : ""}"
            @click=${() => this.selectService(service)}
          >
            <div class="service-card__icon">${icons.settings}</div>
            <h4 class="service-card__name">${service.manifest.name}</h4>
            <p class="service-card__description">${service.manifest.description}</p>
          </div>
        `,
        )}
      </div>
    `;
  }

  private renderField(fieldKey: string): TemplateResult | typeof nothing {
    const field = this.selectedService?.config[fieldKey];
    if (!field) {
      return nothing;
    }

    const inputType = getInputType(field);
    const value = this.wizardState.values[fieldKey];
    const error = this.wizardState.errors[fieldKey];
    const isTouched = this.wizardState.touched.has(fieldKey);
    const showError = isTouched && error;

    const label = html`
      <label class="field-label">
        ${humanize(fieldKey)}
        ${
          field.required
            ? html`
                <span class="field-required">*</span>
              `
            : nothing
        }
      </label>
    `;

    const description = field.description
      ? html`<p class="field-description">${field.description}</p>`
      : nothing;

    const errorMsg = showError
      ? html`<div class="field-error">${icons.alertCircle} ${error}</div>`
      : nothing;

    switch (inputType) {
      case "toggle":
        return html`
          <div class="toggle-field">
            <div class="toggle-field__content">
              <div class="toggle-field__label">${humanize(fieldKey)}</div>
              ${field.description ? html`<div class="toggle-field__description">${field.description}</div>` : nothing}
            </div>
            <label class="toggle-switch">
              <input 
                type="checkbox" 
                .checked=${!!value}
                @change=${(e: Event) => this.updateValue(fieldKey, (e.target as HTMLInputElement).checked)}
              />
              <span class="toggle-slider"></span>
            </label>
          </div>
        `;

      case "select":
        const options = field.enum || [];
        return html`
          <div class="field-group">
            ${label}
            ${description}
            <select
              class="field-input ${showError ? "error" : ""}"
              .value=${typeof value === "string" ? value : String(value ?? "")}
              @change=${(e: Event) => this.updateValue(fieldKey, (e.target as HTMLSelectElement).value)}
            >
              ${
                !field.required
                  ? html`
                      <option value="">Select...</option>
                    `
                  : nothing
              }
              ${options.map((opt) => html`<option value=${opt}>${humanize(opt)}</option>`)}
            </select>
            ${errorMsg}
          </div>
        `;

      case "multiselect":
        const multiOptions = field.enum || field.items?.enum || [];
        const selectedValues = Array.isArray(value) ? value : [];
        return html`
          <div class="field-group">
            ${label}
            ${description}
            <div class="multiselect-options">
              ${multiOptions.map(
                (opt) => html`
                <label class="multiselect-option ${selectedValues.includes(opt) ? "selected" : ""}">
                  <input 
                    type="checkbox"
                    .checked=${selectedValues.includes(opt)}
                    @change=${(e: Event) => {
                      const checked = (e.target as HTMLInputElement).checked;
                      const newValues = checked
                        ? [...selectedValues, opt]
                        : selectedValues.filter((v) => v !== opt);
                      this.updateValue(fieldKey, newValues);
                    }}
                  />
                  ${humanize(opt)}
                </label>
              `,
              )}
            </div>
            ${errorMsg}
          </div>
        `;

      case "number":
        return html`
          <div class="field-group">
            ${label}
            ${description}
            <input 
              type="number"
              class="field-input ${showError ? "error" : ""}"
              .value=${value ?? ""}
              min=${field.minimum ?? nothing}
              max=${field.maximum ?? nothing}
              placeholder=${field.default !== undefined ? (typeof field.default === "string" ? field.default : String(field.default)) : nothing}
              @change=${(e: Event) => {
                const val = (e.target as HTMLInputElement).value;
                this.updateValue(fieldKey, val === "" ? undefined : Number(val));
              }}
            />
            ${errorMsg}
          </div>
        `;

      case "textarea":
        return html`
          <div class="field-group">
            ${label}
            ${description}
            <textarea
              class="field-input ${showError ? "error" : ""}"
              .value=${typeof value === "string" ? value : String(value ?? "")}
              placeholder=${field.default !== undefined ? (typeof field.default === "string" ? field.default : String(field.default)) : nothing}
              @change=${(e: Event) => this.updateValue(fieldKey, (e.target as HTMLTextAreaElement).value)}
            ></textarea>
            ${errorMsg}
          </div>
        `;

      case "channel-picker":
      case "skill-picker":
        // For now, render as text input with note
        return html`
          <div class="field-group">
            ${label}
            ${description}
            <input
              type="text"
              class="field-input ${showError ? "error" : ""}"
              .value=${typeof value === "string" ? value : String(value ?? "")}
              placeholder=${field.default !== undefined ? (typeof field.default === "string" ? field.default : String(field.default)) : nothing}
              @change=${(e: Event) => this.updateValue(fieldKey, (e.target as HTMLInputElement).value)}
            />
            <p class="field-description">${inputType === "channel-picker" ? "Channel picker integration coming soon" : "Skill picker integration coming soon"}</p>
            ${errorMsg}
          </div>
        `;

      case "text":
      default:
        const isSecret = field.type === "secret";
        return html`
          <div class="field-group">
            ${label}
            ${description}
            <input
              type=${isSecret ? "password" : "text"}
              class="field-input ${showError ? "error" : ""}"
              .value=${typeof value === "string" ? value : String(value ?? "")}
              placeholder=${field.default !== undefined ? (typeof field.default === "string" ? field.default : String(field.default)) : nothing}
              @change=${(e: Event) => this.updateValue(fieldKey, (e.target as HTMLInputElement).value)}
            />
            ${errorMsg}
          </div>
        `;
    }
  }

  private renderConfigStep(step: WizardStep): TemplateResult {
    return html`
      <div class="form-fields">
        ${step.fields.map((fieldKey) => this.renderField(fieldKey))}
      </div>
    `;
  }

  private renderSummary(): TemplateResult {
    if (!this.selectedService) {
      return html`
        <div>No service selected</div>
      `;
    }

    const configEntries = Object.entries(this.selectedService.config);
    const requiredConfig = configEntries.filter(([, field]) => field.required);
    const optionalConfig = configEntries.filter(([, field]) => !field.required);

    const renderValue = (value: unknown): string => {
      if (value === undefined || value === null) {
        return "Not set";
      }
      if (Array.isArray(value)) {
        return value.length > 0 ? value.join(", ") : "None";
      }
      if (typeof value === "boolean") {
        return value ? "Yes" : "No";
      }
      if (typeof value === "object") {
        return JSON.stringify(value);
      }
      return typeof value === "string" ? value : String(value);
    };

    return html`
      <div class="summary-section">
        <h4 class="summary-section__title">${icons.info} Service</h4>
        <div class="summary-item">
          <span class="summary-item__label">Name</span>
          <span class="summary-item__value">${this.selectedService.name}</span>
        </div>
        <div class="summary-item">
          <span class="summary-item__label">ID</span>
          <span class="summary-item__value">${this.selectedService.id}</span>
        </div>
        <div class="summary-item">
          <span class="summary-item__label">Version</span>
          <span class="summary-item__value">${this.selectedService.version}</span>
        </div>
      </div>

      ${
        requiredConfig.length > 0
          ? html`
        <div class="summary-section">
          <h4 class="summary-section__title">${icons.settings} Required Settings</h4>
          ${requiredConfig.map(
            ([key, _field]) => html`
            <div class="summary-item">
              <span class="summary-item__label">${humanize(key)}</span>
              <span class="summary-item__value">${renderValue(this.wizardState.values[key])}</span>
            </div>
          `,
          )}
        </div>
      `
          : nothing
      }

      ${
        optionalConfig.length > 0
          ? html`
        <div class="summary-section">
          <h4 class="summary-section__title">${icons.settings} Optional Settings</h4>
          ${optionalConfig.map(
            ([key, _field]) => html`
            <div class="summary-item">
              <span class="summary-item__label">${humanize(key)}</span>
              <span class="summary-item__value">${renderValue(this.wizardState.values[key])}</span>
            </div>
          `,
          )}
        </div>
      `
          : nothing
      }
    `;
  }

  private renderStepContent(): TemplateResult {
    const step = this.steps[this.wizardState.currentStep];
    if (!step) {
      return html`
        <div>Invalid step</div>
      `;
    }

    return html`
      <div class="step-wrapper">
        <div class="step-content">
          <div class="step-header">
            <h2 class="step-header__title">${step.title}</h2>
            <p class="step-header__description">${step.description}</p>
          </div>
          
          ${
            step.id === "select"
              ? this.renderServiceSelection()
              : step.id === "summary"
                ? this.renderSummary()
                : this.renderConfigStep(step)
          }
        </div>
        
        ${
          this.loading
            ? html`
                <div class="loading-overlay">
                  <div class="spinner"></div>
                </div>
              `
            : nothing
        }
      </div>
    `;
  }

  private renderActions(): TemplateResult {
    const currentStep = this.wizardState.currentStep;
    const isFirstStep = currentStep === 0;
    const isLastStep = currentStep === this.steps.length - 1;
    const isSelectStep = this.steps[currentStep]?.id === "select";

    return html`
      <div class="wizard-actions">
        <button
          class="btn btn-secondary"
          ?disabled=${isFirstStep}
          @click=${() => this.prevStep()}
        >
          ${icons.chevronLeft} Back
        </button>
        
        ${
          isLastStep
            ? html`
          <button 
            class="btn btn-success"
            ?disabled=${this.loading}
            @click=${() => this.submit()}
          >
            ${icons.check} Install Service
          </button>
        `
            : html`
          <button 
            class="btn btn-primary"
            ?disabled=${isSelectStep && !this.selectedService}
            @click=${() => this.nextStep()}
          >
            Next ${icons.chevronRight}
          </button>
        `
        }
      </div>
    `;
  }

  override render(): TemplateResult {
    return html`
      <style>${ServiceConfigWizard.styles}</style>
      <div class="wizard-container">
        ${this.steps.length > 0 ? this.renderProgress() : nothing}
        ${this.renderStepContent()}
        ${this.steps.length > 0 ? this.renderActions() : nothing}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "service-config-wizard": ServiceConfigWizard;
  }
}

export default ServiceConfigWizard;
export { getInputType, validateField, humanize };
export type { ServiceManifest, ServiceOption, WizardStep, WizardState, InputType };
