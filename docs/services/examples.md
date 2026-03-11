---
summary: "4 Example Service definitions for the Service Concept MVP - design reference for architecture decisions"
read_when:
  - Designing Service architecture
  - Planning Service UI/UX
  - Implementing Service runtime
title: "Service Examples"
---

# Service Examples (MVP Design)

This document defines 4 concrete Service use cases that will guide the Service Concept MVP architecture. These examples represent common automation patterns that non-technical users want.

**Design Principles:**

- Services bundle existing skills/tools - they don't create new capabilities
- Configuration must be simple and declarative
- Security boundaries (capability requirements) must be explicit
- Services should feel like "set and forget" automation

---

## 1. Daily Briefing Service

**Purpose:** Automatically generates and delivers a daily summary of weather, news, calendar events, and tasks every morning.

### Trigger Type

**Cron-based** - Runs at a configurable time (default: 8:00 AM local time)

### What It Does

1. Fetches current weather for configured location(s)
2. Retrieves today's calendar events from configured calendar(s)
3. Fetches top headlines from configured news sources
4. Summarizes all information into a brief, readable format
5. Delivers the briefing via the user's preferred channel (Discord, Slack, Telegram, etc.)

### Skills/Tools Used

| Skill/Tool                           | Purpose                  | Required? |
| ------------------------------------ | ------------------------ | --------- |
| `weather`                            | Fetch weather data       | Yes       |
| `web_fetch` or `summarize`           | Fetch and summarize news | Yes       |
| `gog` (Google Workspace)             | Fetch calendar events    | Optional  |
| `apple-reminders` or `things-mac`    | Fetch tasks/todos        | Optional  |
| `slack` / `discord` / `message.send` | Deliver the briefing     | Yes       |

### Configuration Schema (service.json)

```json
{
  "$schema": "https://openclaw.ai/schemas/service-v1.json",
  "id": "daily-briefing",
  "name": "Daily Briefing",
  "description": "Your personalized morning briefing with weather, calendar, news, and tasks",
  "version": "1.0.0",

  "trigger": {
    "type": "cron",
    "schedule": "0 8 * * *",
    "timezone": "auto"
  },

  "config": {
    "weatherLocation": {
      "type": "string",
      "description": "City or location for weather",
      "default": "New York",
      "required": true
    },
    "newsSources": {
      "type": "array",
      "items": { "type": "string" },
      "description": "News RSS feeds or keywords",
      "default": ["tech", "world"],
      "required": false
    },
    "calendarIds": {
      "type": "array",
      "items": { "type": "string" },
      "description": "Calendar identifiers to include",
      "default": ["primary"],
      "required": false
    },
    "taskSources": {
      "type": "array",
      "items": { "type": "string", "enum": ["apple-reminders", "things", "todoist"] },
      "default": [],
      "required": false
    },
    "delivery": {
      "type": "object",
      "required": true,
      "properties": {
        "channel": {
          "type": "string",
          "enum": ["slack", "discord", "telegram", "whatsapp", "email"],
          "description": "Where to send the briefing"
        },
        "target": {
          "type": "string",
          "description": "Channel ID, DM, or email address"
        }
      }
    },
    "format": {
      "type": "string",
      "enum": ["concise", "detailed", "bullet-points"],
      "default": "bullet-points"
    }
  },

  "requires": {
    "skills": ["weather"],
    "optionalSkills": ["gog", "apple-reminders", "things-mac"],
    "tools": ["web_fetch", "message.send"],
    "env": [],
    "config": []
  }
}
```

### UI Mockup Description

**Setup Wizard Flow:**

1. **Welcome Screen:** "Get your personalized morning briefing"
2. **Location Step:** Text input with autocomplete for city name
3. **Content Selection Step:**
   - Checkbox: Weather (default: on)
   - Checkbox: Calendar (shows available calendars from `gog` skill)
   - Checkbox: Tasks (shows available task sources)
   - Checkbox: News (with category tags: Tech, World, Business, etc.)
4. **Delivery Step:**
   - Dropdown: Where to send (Slack DM, Discord channel, Telegram, etc.)
   - Auto-populates available channels from OpenClaw config
5. **Schedule Step:**
   - Time picker (default: 8:00 AM)
   - Timezone selector (default: auto-detect)
6. **Preview Step:** Shows example briefing with sample data

**Configuration Panel:**

- Simple card-based layout
- Each section (Weather, Calendar, Tasks, News) has an on/off toggle
- Expandable sections show detailed options when enabled
- "Test Now" button sends a test briefing immediately
- Last run timestamp and success/failure indicator

---

## 2. Webhook Receiver Service

**Purpose:** Creates HTTP endpoints that receive webhooks from external services (GitHub, Stripe, Zapier, etc.) and processes them through OpenClaw skills.

### Trigger Type

**Webhook-based** - HTTP POST requests to a generated endpoint URL

### What It Does

1. Exposes a unique URL endpoint: `https://gateway.openclaw.ai/webhooks/{service-id}/{hook-id}`
2. Validates incoming webhook signatures (if configured)
3. Parses JSON payload from external service
4. Routes data through configured skills/tools
5. Can store data, send notifications, or trigger other actions

### Skills/Tools Used

| Skill/Tool           | Purpose                       | Required? |
| -------------------- | ----------------------------- | --------- |
| `webhook` (built-in) | Receive and validate webhooks | Yes       |
| `github`             | Process GitHub events         | Optional  |
| `notion`             | Store data in Notion DB       | Optional  |
| `slack` / `discord`  | Send notifications            | Optional  |
| `db` (built-in)      | Store event data locally      | Optional  |

### Configuration Schema (service.json)

```json
{
  "$schema": "https://openclaw.ai/schemas/service-v1.json",
  "id": "webhook-receiver",
  "name": "Webhook Receiver",
  "description": "Receive and process webhooks from external services",
  "version": "1.0.0",

  "trigger": {
    "type": "webhook",
    "path": "/webhooks/custom/{hookId}",
    "methods": ["POST"],
    "auth": {
      "type": "signature",
      "header": "X-Webhook-Signature",
      "algorithm": "hmac-sha256"
    }
  },

  "config": {
    "hookName": {
      "type": "string",
      "description": "Name for this webhook endpoint",
      "required": true
    },
    "secret": {
      "type": "secret",
      "description": "Secret for signature validation",
      "required": false
    },
    "source": {
      "type": "string",
      "enum": ["generic", "github", "stripe", "zapier", "custom"],
      "default": "generic",
      "description": "Expected webhook format"
    },
    "actions": {
      "type": "array",
      "description": "Actions to take when webhook is received",
      "items": {
        "type": "object",
        "properties": {
          "condition": {
            "type": "string",
            "description": "JSONPath condition (e.g., $.event == 'push')"
          },
          "action": {
            "type": "string",
            "enum": ["notify", "store", "forward", "script"]
          },
          "target": {
            "type": "string",
            "description": "Target for action (channel, DB, URL)"
          },
          "template": {
            "type": "string",
            "description": "Message template with {{variable}} substitution"
          }
        }
      },
      "default": [
        {
          "action": "notify",
          "target": "default",
          "template": "Webhook received from {{source}}"
        }
      ]
    },
    "rateLimit": {
      "type": "object",
      "properties": {
        "requestsPerMinute": { "type": "number", "default": 60 },
        "burst": { "type": "number", "default": 10 }
      }
    }
  },

  "requires": {
    "skills": [],
    "tools": ["webhook"],
    "env": [],
    "config": ["gateway.webhooks.enabled"]
  }
}
```

### UI Mockup Description

**Setup Wizard Flow:**

1. **Welcome Screen:** "Create a webhook endpoint for external services"
2. **Name & Source Step:**
   - Text input: Webhook name
   - Dropdown: Source service (GitHub, Stripe, Zapier, Custom)
   - Shows source-specific help text
3. **Security Step:**
   - Toggle: Enable signature verification
   - Secret input (auto-generates if empty)
   - Copy button for secret
4. **Actions Step:**
   - Visual workflow builder (simple linear chain)
   - "When webhook received" → "If condition" → "Then action"
   - Conditions: JSONPath expressions with test data
   - Actions: Notify (Slack/Discord), Store (Notion/DB), Forward (HTTP)
5. **Testing Step:**
   - Shows generated webhook URL
   - "Copy URL" button
   - "Send Test" button to simulate webhook
   - Shows recent webhook deliveries with payloads

**Dashboard View:**

- List of webhook endpoints with status indicators
- Each endpoint shows: Name, URL (truncated), Requests (24h), Success rate
- Click to expand: Recent deliveries, response logs, replay button
- "View Payload" modal for debugging

---

## 3. Message Processor Service

**Purpose:** Watches specific messaging channels (Slack, Discord, Telegram) for messages matching patterns, then processes attachments or commands automatically.

### Trigger Type

**Message-based** - Listens to configured channels for message events

### What It Does

1. Connects to configured channel(s) via OpenClaw's channel integrations
2. Listens for messages matching specific patterns (regex, keywords, commands)
3. Processes attachments (images, PDFs, documents) through skills
4. Can respond in-thread or via DM
5. Supports command-style interactions (`!summarize`, `!archive`, etc.)

### Skills/Tools Used

| Skill/Tool            | Purpose                   | Required? |
| --------------------- | ------------------------- | --------- |
| `slack` / `discord`   | Channel access            | Yes       |
| `summarize`           | Summarize linked content  | Optional  |
| `nano-pdf`            | Extract PDF text          | Optional  |
| `openai-whisper`      | Transcribe voice messages | Optional  |
| `notion` / `obsidian` | Archive content           | Optional  |
| `canvas`              | Render rich responses     | Optional  |

### Configuration Schema (service.json)

```json
{
  "$schema": "https://openclaw.ai/schemas/service-v1.json",
  "id": "message-processor",
  "name": "Message Processor",
  "description": "Watch channels and automatically process messages, attachments, and commands",
  "version": "1.0.0",

  "trigger": {
    "type": "message",
    "channels": ["slack", "discord", "telegram"],
    "filters": {
      "channels": ["string"],
      "patterns": ["regex"],
      "fromUsers": ["string"],
      "hasAttachments": "boolean"
    }
  },

  "config": {
    "watches": {
      "type": "array",
      "description": "Channels/DMs to monitor",
      "items": {
        "type": "object",
        "properties": {
          "channelId": { "type": "string" },
          "channelType": { "type": "string", "enum": ["channel", "dm", "thread"] }
        }
      },
      "required": true
    },
    "rules": {
      "type": "array",
      "description": "Processing rules",
      "items": {
        "type": "object",
        "properties": {
          "name": { "type": "string" },
          "enabled": { "type": "boolean", "default": true },
          "match": {
            "type": "object",
            "properties": {
              "type": { "type": "string", "enum": ["keyword", "regex", "command", "attachment"] },
              "pattern": { "type": "string" },
              "caseSensitive": { "type": "boolean", "default": false }
            }
          },
          "process": {
            "type": "object",
            "properties": {
              "action": {
                "type": "string",
                "enum": ["summarize", "transcribe", "extract", "archive", "reply"]
              },
              "skill": { "type": "string" },
              "prompt": { "type": "string" }
            }
          },
          "respond": {
            "type": "object",
            "properties": {
              "mode": { "type": "string", "enum": ["thread", "dm", "channel", "silent"] },
              "template": { "type": "string" },
              "reaction": { "type": "string" }
            }
          }
        }
      }
    },
    "commands": {
      "type": "object",
      "description": "Command prefix settings",
      "properties": {
        "prefix": { "type": "string", "default": "!" },
        "requireMention": { "type": "boolean", "default": false }
      }
    },
    "rateLimit": {
      "type": "object",
      "properties": {
        "perUserPerMinute": { "type": "number", "default": 10 },
        "maxAttachmentSize": { "type": "string", "default": "25MB" }
      }
    }
  },

  "requires": {
    "skills": [],
    "optionalSkills": ["summarize", "nano-pdf", "openai-whisper", "notion"],
    "tools": ["slack", "discord"],
    "config": ["channels.slack"]
  }
}
```

### UI Mockup Description

**Setup Wizard Flow:**

1. **Welcome Screen:** "Create an automated message processor for your channels"
2. **Channel Selection Step:**
   - Multi-select dropdown showing available Slack/Discord channels
   - Toggle: Include DMs
   - Shows channel avatars/names from OpenClaw config
3. **Rule Builder Step:**
   - Visual rule cards (add/remove)
   - Each rule has:
     - Name input
     - Match type: Keyword, Regex, Command, Has Attachment
     - Pattern input with live validation
     - Action selector with icons: Summarize, Transcribe, Archive, Reply
   - Simple AND/OR logic between rules
4. **Response Step:**
   - For each rule: Response mode (Thread reply, DM, Channel, Silent)
   - Message template builder with variable picker
   - Quick reaction emoji picker (adds ✅ when processed)
5. **Permissions Step:**
   - Rate limits per user
   - Attachment size limits
   - User allowlist/blocklist

**Management Dashboard:**

- Card per message processor showing:
  - Monitored channels (with icons)
  - Active rules count
  - Messages processed (24h)
  - Toggle to enable/disable
- Expand shows rule list with recent matches
- Activity log: Message preview → Action taken → Result

---

## 4. Data Dashboard Service

**Purpose:** Serves a web-based dashboard showing real-time data from various sources (weather, tasks, calendar, custom data) with auto-refresh and configurable widgets.

### Trigger Type

**Web UI** - HTTP endpoint serving a dashboard page

### What It Does

1. Exposes a dashboard at `https://gateway.openclaw.ai/dashboards/{service-id}`
2. Fetches data from configured sources on page load and at intervals
3. Renders widgets in a grid layout
4. Supports real-time updates via WebSocket or polling
5. Allows user interaction (refresh, configure, export)

### Skills/Tools Used

| Skill/Tool                       | Purpose                | Required? |
| -------------------------------- | ---------------------- | --------- |
| `weather`                        | Weather widget         | Optional  |
| `gog`                            | Calendar widget        | Optional  |
| `apple-reminders` / `things-mac` | Task list widget       | Optional  |
| `github`                         | PR/issue count widget  | Optional  |
| `canvas`                         | Render visual widgets  | Yes       |
| `db` (built-in)                  | Store dashboard config | Yes       |

### Configuration Schema (service.json)

```json
{
  "$schema": "https://openclaw.ai/schemas/service-v1.json",
  "id": "data-dashboard",
  "name": "Data Dashboard",
  "description": "Personal dashboard with widgets for weather, tasks, calendar, and custom data",
  "version": "1.0.0",

  "trigger": {
    "type": "web",
    "path": "/dashboards/{dashboardId}",
    "auth": "gateway"
  },

  "config": {
    "title": {
      "type": "string",
      "default": "My Dashboard",
      "required": true
    },
    "layout": {
      "type": "string",
      "enum": ["grid", "list", "compact"],
      "default": "grid"
    },
    "theme": {
      "type": "string",
      "enum": ["auto", "light", "dark"],
      "default": "auto"
    },
    "refreshInterval": {
      "type": "number",
      "description": "Auto-refresh interval in seconds",
      "default": 300,
      "minimum": 30,
      "maximum": 3600
    },
    "widgets": {
      "type": "array",
      "description": "Dashboard widgets",
      "items": {
        "type": "object",
        "properties": {
          "id": { "type": "string" },
          "type": {
            "type": "string",
            "enum": ["weather", "tasks", "calendar", "clock", "text", "chart", "list"]
          },
          "title": { "type": "string" },
          "position": {
            "type": "object",
            "properties": {
              "x": { "type": "number" },
              "y": { "type": "number" },
              "w": { "type": "number", "default": 1 },
              "h": { "type": "number", "default": 1 }
            }
          },
          "config": {
            "type": "object",
            "description": "Widget-specific configuration"
          }
        }
      },
      "default": [
        {
          "id": "clock-1",
          "type": "clock",
          "title": "Time",
          "position": { "x": 0, "y": 0, "w": 1, "h": 1 }
        },
        {
          "id": "weather-1",
          "type": "weather",
          "title": "Weather",
          "position": { "x": 1, "y": 0, "w": 2, "h": 2 },
          "config": { "location": "auto" }
        }
      ]
    },
    "access": {
      "type": "object",
      "properties": {
        "public": { "type": "boolean", "default": false },
        "password": { "type": "string" },
        "allowedUsers": { "type": "array", "items": { "type": "string" } }
      }
    }
  },

  "requires": {
    "skills": ["canvas"],
    "optionalSkills": ["weather", "apple-reminders", "things-mac", "gog", "github"],
    "tools": ["web"],
    "config": ["gateway.web.enabled"]
  }
}
```

### UI Mockup Description

**Setup Wizard Flow:**

1. **Welcome Screen:** "Create a personal dashboard"
2. **Basics Step:**
   - Text input: Dashboard name
   - Theme toggle: Light / Dark / Auto
   - Layout selector: Grid (icon), List (icon), Compact (icon)
3. **Widget Gallery Step:**
   - Grid of available widgets with previews:
     - Clock (shows current time preview)
     - Weather (shows sample weather card)
     - Tasks (shows sample task list)
     - Calendar (shows sample agenda)
     - Text Note (simple markdown)
     - Custom Chart (for advanced users)
   - Click to add, shows checkmark when selected
4. **Widget Configuration Step:**
   - Each selected widget gets a config panel
   - Weather: Location picker
   - Tasks: Source selector (Apple Reminders, Things, etc.)
   - Calendar: Calendar picker
   - Drag to reorder
5. **Sharing & Access Step:**
   - Toggle: Make public (with warning)
   - Password protection option
   - Copy link button

**Dashboard View (Runtime):**

- Responsive grid layout (1-4 columns based on screen size)
- Each widget is a card with:
  - Title bar (draggable for reordering)
  - Content area
  - Last updated timestamp
  - Manual refresh button (rotating icon)
- Global controls:
  - Auto-refresh toggle
  - Edit layout button (enables drag/drop)
  - Fullscreen button
  - Settings gear
- Widget types:
  - **Weather:** Large icon, temp, forecast mini-chart
  - **Tasks:** Scrollable list with checkboxes, "Add task" quick input
  - **Calendar:** Agenda view for today/next 3 days
  - **Clock:** Digital + analog display
  - **Text:** Markdown notes with edit-in-place

---

## Cross-Cutting Concerns

### Security Considerations

All Services must respect OpenClaw's security model:

1. **Capability Gating**: Services declare required skills/tools in `requires` block. Service won't start if requirements aren't met.
2. **Sandboxing**: Service actions should respect agent sandbox settings
3. **Secrets**: API keys, passwords use `type: "secret"` in config schema - stored in OpenClaw's secret store
4. **Rate Limiting**: All Services should have configurable rate limits to prevent abuse
5. **Audit Logging**: Service actions logged to session logs for review

### Configuration Validation

Service configs should be validated against JSON Schema:

- Required fields present
- Types correct
- References valid (channel IDs, skill names)
- No circular dependencies in chained Services

### Error Handling

Each Service needs consistent error behavior:

- **Retry policy**: For transient failures (API rate limits, network)
- **Dead letter queue**: Failed actions logged for manual review
- **User notification**: Critical errors sent via preferred channel
- **Graceful degradation**: Service continues if optional skills unavailable

### Shared Components

These will be needed across all Services:

1. **Service Runner**: Executes Service logic with proper context
2. **Config Store**: Persists Service configuration
3. **Scheduler**: Manages cron triggers
4. **Webhook Router**: Routes HTTP requests to correct Service
5. **Message Router**: Routes channel messages to subscribed Services
6. **Dashboard Renderer**: Serves and renders dashboard UI

---

## Appendix: Service Manifest Format

All Services use a common manifest format (`service.json`):

```json
{
  "$schema": "https://openclaw.ai/schemas/service-v1.json",
  "id": "unique-service-id",
  "name": "Human-readable name",
  "description": "What this service does",
  "version": "1.0.0",
  "author": "OpenClaw or plugin author",

  "trigger": {
    "type": "cron|webhook|message|web|manual",
    "...": "trigger-specific config"
  },

  "config": {
    "fieldName": {
      "type": "string|number|boolean|array|object|secret",
      "description": "Human-readable description",
      "default": "optional default value",
      "required": true|false
    }
  },

  "requires": {
    "skills": ["required-skill-ids"],
    "optionalSkills": ["optional-skill-ids"],
    "tools": ["required-tools"],
    "env": ["REQUIRED_ENV_VARS"],
    "config": ["required.openclaw.config.paths"]
  }
}
```

### Service Storage Location

Services are stored in:

- `~/.openclaw/services/` - User-created Services
- `<workspace>/services/` - Per-agent Services (if multi-agent)
- Bundled with plugins via `openclaw.plugin.json` `services` field

### Service Lifecycle

1. **Created**: User creates via CLI or UI → stored in `~/.openclaw/services/`
2. **Validated**: Config checked against schema, requirements verified
3. **Enabled**: Service starts listening for triggers
4. **Running**: Service processes events/actions
5. **Paused**: Service stops processing but keeps config
6. **Deleted**: Service removed, cleanup performed
