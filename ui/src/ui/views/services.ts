/**
 * Services View for Control UI
 *
 * Displays the service configuration wizard for installing and configuring
 * OpenClaw services declaratively.
 */

import { html, nothing, type TemplateResult } from "lit";
// Type matching src/services/schema.ts
type ServiceManifest = {
  id: string;
  name: string;
  description: string;
  version: string;
  author?: string;
  category?: string;
  trigger: unknown;
  config: Record<
    string,
    {
      type: string;
      description: string;
      required?: boolean;
      default?: unknown;
      enum?: string[];
      items?: { type?: string; enum?: string[] };
      minimum?: number;
      maximum?: number;
      "x-openclaw"?: { inputType?: string; validateOn?: "blur" | "change" | "submit" };
    }
  >;
  requires: unknown;
  capabilities: unknown;
  execution?: unknown;
};
import { icons } from "../icons.ts";

// Example service manifests for demonstration
const EXAMPLE_SERVICES: Array<{ id: string; manifest: ServiceManifest }> = [
  {
    id: "daily-briefing",
    manifest: {
      id: "daily-briefing",
      name: "Daily Briefing",
      description: "Your personalized morning briefing with weather, calendar, news, and tasks",
      version: "1.0.0",
      author: "OpenClaw",
      category: "productivity",
      trigger: {
        type: "cron",
        schedule: "0 8 * * *",
        timezone: "auto",
      },
      config: {
        weatherLocation: {
          type: "string",
          description: "City or location for weather forecast",
          default: "New York",
          required: true,
          "x-openclaw": {
            inputType: "text",
            validateOn: "blur",
          },
        },
        newsSources: {
          type: "array",
          items: { type: "string" },
          description: "News categories or RSS feed URLs to include",
          default: ["tech", "world"],
          required: false,
          "x-openclaw": {
            inputType: "multiselect",
          },
        },
        format: {
          type: "string",
          enum: ["concise", "detailed", "bullet-points"],
          default: "bullet-points",
          description: "Briefing format style",
          "x-openclaw": {
            inputType: "select",
          },
        },
      },
      requires: {
        skills: ["weather"],
        optionalSkills: [],
        tools: ["web_fetch", "message.send"],
        env: [],
        config: [],
      },
      capabilities: {
        privilegedTools: ["message.send"],
        network: true,
        filesystem: false,
        shell: false,
        browser: false,
      },
      execution: {
        agentId: "service:daily-briefing",
        sessionTarget: "isolated",
        timeout: 60000,
      },
    },
  },
  {
    id: "webhook-receiver",
    manifest: {
      id: "webhook-receiver",
      name: "Webhook Receiver",
      description: "Receive and process webhooks from external services",
      version: "1.0.0",
      author: "OpenClaw",
      category: "integration",
      trigger: {
        type: "webhook",
        path: "/webhooks/receiver",
        methods: ["POST"],
      },
      config: {
        hookName: {
          type: "string",
          description: "Name for this webhook endpoint",
          required: true,
          default: "My Webhook",
          "x-openclaw": {
            inputType: "text",
          },
        },
        secret: {
          type: "secret",
          description: "Secret key for HMAC signature validation",
          required: false,
          "x-openclaw": {
            inputType: "text",
          },
        },
        source: {
          type: "string",
          description: "Expected webhook source format",
          enum: ["generic", "github", "slack", "stripe"],
          default: "generic",
          required: true,
          "x-openclaw": {
            inputType: "select",
          },
        },
        notifyOnReceive: {
          type: "boolean",
          description: "Send a notification when webhook is received",
          default: true,
          required: false,
          "x-openclaw": {
            inputType: "toggle",
          },
        },
        rateLimitPerMinute: {
          type: "number",
          description: "Maximum webhook requests per minute",
          default: 60,
          minimum: 0,
          maximum: 1000,
          required: false,
          "x-openclaw": {
            inputType: "number",
          },
        },
      },
      requires: {
        skills: ["webhook-receiver"],
        optionalSkills: [],
        tools: ["message.send"],
        env: [],
        config: ["gateway.webhooks.enabled"],
      },
      capabilities: {
        network: true,
        filesystem: false,
        shell: false,
        browser: false,
        privilegedTools: ["message.send"],
      },
      execution: {
        agentId: "service:webhook-receiver",
        sessionTarget: "isolated",
        timeout: 30000,
      },
    },
  },
  {
    id: "message-processor",
    manifest: {
      id: "message-processor",
      name: "Message Processor",
      description: "Watch channels and automatically process messages and commands",
      version: "1.0.0",
      author: "OpenClaw",
      category: "automation",
      trigger: {
        type: "message",
        channels: ["slack", "discord", "telegram"],
      },
      config: {
        channels: {
          type: "array",
          description: "Channel IDs to monitor for messages",
          required: true,
          items: { type: "string" },
          default: [],
          "x-openclaw": {
            inputType: "channel-picker",
          },
        },
        responseMode: {
          type: "string",
          description: "How to respond to processed messages",
          enum: ["thread", "dm", "channel", "silent"],
          default: "thread",
          required: true,
          "x-openclaw": {
            inputType: "select",
          },
        },
        processAttachments: {
          type: "boolean",
          description: "Whether to process attachments",
          default: false,
          required: false,
          "x-openclaw": {
            inputType: "toggle",
          },
        },
        rateLimitPerMinute: {
          type: "number",
          description: "Maximum requests per user per minute",
          default: 10,
          minimum: 1,
          maximum: 100,
        },
      },
      requires: {
        skills: [],
        optionalSkills: ["summarize"],
        tools: ["message.send"],
        env: [],
        config: [],
      },
      capabilities: {
        privilegedTools: ["message.send"],
        network: true,
        filesystem: true,
        shell: false,
        browser: false,
      },
      execution: {
        sessionTarget: "isolated",
        timeout: 60000,
      },
    },
  },
  {
    id: "data-dashboard",
    manifest: {
      id: "data-dashboard",
      name: "Data Dashboard",
      description: "Real-time web dashboard with configurable widgets",
      version: "1.0.0",
      author: "OpenClaw",
      category: "monitoring",
      trigger: {
        type: "web",
        path: "/dashboard/data",
        auth: "gateway",
      },
      config: {
        title: {
          type: "string",
          description: "Dashboard title displayed in the header",
          default: "My Dashboard",
          required: true,
        },
        refreshInterval: {
          type: "number",
          description: "Auto-refresh interval in seconds",
          default: 60,
          minimum: 10,
          maximum: 3600,
        },
        theme: {
          type: "string",
          enum: ["light", "dark", "auto"],
          default: "auto",
          description: "Dashboard color theme",
        },
        layout: {
          type: "string",
          enum: ["grid", "list"],
          default: "grid",
          description: "Widget layout style",
        },
      },
      requires: {
        skills: [],
        optionalSkills: ["weather", "tasks"],
        tools: ["web_fetch"],
        env: [],
        config: [],
      },
      capabilities: {
        network: true,
        filesystem: false,
        shell: false,
        browser: false,
      },
      execution: {
        sessionTarget: "main",
        timeout: 30000,
      },
    },
  },
];

export type ServicesViewProps = {
  loading?: boolean;
  error?: string | null;
  onServiceSubmit?: (detail: { serviceId: string; config: Record<string, unknown> }) => void;
  onServiceCancel?: () => void;
};

export function renderServicesView(props: ServicesViewProps): TemplateResult {
  const handleWizardSubmit = (e: Event) => {
    const detail = (e as CustomEvent).detail;
    props.onServiceSubmit?.(detail);
  };

  const handleWizardCancel = () => {
    props.onServiceCancel?.();
  };

  return html`
    <div class="services-view">
      <div class="services-header">
        <h2 class="services-header__title">${icons.settings} Services</h2>
        <p class="services-header__description">
          Install and configure declarative automation services. Services bundle skills, 
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

      <service-config-wizard
        .services=${EXAMPLE_SERVICES}
        .loading=${props.loading ?? false}
        @wizard-submit=${handleWizardSubmit}
        @wizard-cancel=${handleWizardCancel}
      ></service-config-wizard>
    </div>
  `;
}

// CSS styles for the services view
export const servicesViewStyles = `
  .services-view {
    padding: 24px;
    max-width: 1000px;
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

  .services-error__icon {
    width: 20px;
    height: 20px;
    color: var(--accent-error, #ef4444);
    flex-shrink: 0;
  }

  .services-error__message {
    font-size: 14px;
    color: var(--accent-error, #ef4444);
  }
`;
