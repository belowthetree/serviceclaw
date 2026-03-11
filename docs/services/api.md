---
title: Service Manifest API Reference
summary: Complete API reference for Service manifest schema and types
description: Detailed documentation of all Service manifest fields, types, and validation rules
---

# Service Manifest API Reference

This document provides complete API reference for OpenClaw Service manifests. Use this when writing `service.json` files.

## Schema Overview

```json
{
  "$schema": "https://openclaw.ai/schemas/service-v1.json",
  "id": "my-service",
  "name": "My Service",
  "description": "Description of what this service does",
  "version": "1.0.0",
  "author": "Author Name",
  "category": "productivity",
  "trigger": { ... },
  "config": { ... },
  "requires": { ... },
  "capabilities": { ... },
  "execution": { ... }
}
```

## Top-Level Fields

### $schema

The schema URL for validation.

| Property     | Value                                           |
| ------------ | ----------------------------------------------- |
| **Type**     | `string`                                        |
| **Required** | No                                              |
| **Default**  | None                                            |
| **Example**  | `"https://openclaw.ai/schemas/service-v1.json"` |

### id

Unique identifier for the Service. Must be unique across all installed Services.

| Property     | Value                                                         |
| ------------ | ------------------------------------------------------------- |
| **Type**     | `string`                                                      |
| **Required** | Yes                                                           |
| **Pattern**  | `^[a-z0-9]+(?:-[a-z0-9]+)*$`                                  |
| **Examples** | `"daily-briefing"`, `"webhook-receiver"`, `"github-notifier"` |

Constraints:

- Must be lowercase
- Can contain letters, numbers, and hyphens
- Must start with a letter or number
- No consecutive hyphens

Valid: `my-service`, `service-v2`, `github-webhook`
Invalid: `MyService`, `my_service`, `-service`, `service--v2`

### name

Human-readable display name for the Service.

| Property       | Value                                   |
| -------------- | --------------------------------------- |
| **Type**       | `string`                                |
| **Required**   | Yes                                     |
| **Min Length** | 1                                       |
| **Max Length** | 100                                     |
| **Examples**   | `"Daily Briefing"`, `"GitHub Notifier"` |

### description

Description of what the Service does and when to use it.

| Property       | Value                                                                          |
| -------------- | ------------------------------------------------------------------------------ |
| **Type**       | `string`                                                                       |
| **Required**   | Yes                                                                            |
| **Min Length** | 10                                                                             |
| **Max Length** | 500                                                                            |
| **Example**    | `"Your personalized morning briefing with weather, calendar, news, and tasks"` |

### version

Semantic version of the Service.

| Property     | Value                                  |
| ------------ | -------------------------------------- |
| **Type**     | `string`                               |
| **Required** | Yes                                    |
| **Pattern**  | `^\d+\.\d+\.\d+(?:-[\w.]+)?$`          |
| **Examples** | `"1.0.0"`, `"2.1.3"`, `"1.0.0-beta.1"` |

Follows [Semantic Versioning](https://semver.org/):

- MAJOR: Incompatible changes
- MINOR: New features, backward compatible
- PATCH: Bug fixes, backward compatible

### author

Creator or organization that developed the Service.

| Property     | Value                       |
| ------------ | --------------------------- |
| **Type**     | `string`                    |
| **Required** | No                          |
| **Example**  | `"OpenClaw"`, `"Your Name"` |

### category

Category for grouping Services in the UI.

| Property     | Value                                                                                            |
| ------------ | ------------------------------------------------------------------------------------------------ |
| **Type**     | `string`                                                                                         |
| **Required** | No                                                                                               |
| **Default**  | `"custom"`                                                                                       |
| **Enum**     | `"productivity"`, `"communication"`, `"monitoring"`, `"automation"`, `"integration"`, `"custom"` |

Categories:

- **productivity**: Task management, scheduling, reminders
- **communication**: Messaging, notifications, alerts
- **monitoring**: System monitoring, health checks, logging
- **automation**: Workflow automation, processing
- **integration**: Third-party service integrations
- **custom**: Miscellaneous Services

## Trigger Configuration

The `trigger` field defines when the Service runs. Four types are supported.

### Cron Trigger

Runs on a schedule using cron expressions.

```json
{
  "trigger": {
    "type": "cron",
    "schedule": "0 8 * * *",
    "timezone": "auto"
  }
}
```

#### Fields

| Field      | Type     | Required | Description                  |
| ---------- | -------- | -------- | ---------------------------- |
| `type`     | `"cron"` | Yes      | Trigger type                 |
| `schedule` | `string` | Yes      | Cron expression              |
| `timezone` | `string` | No       | Timezone (default: `"auto"`) |

#### schedule

Standard cron expression with 5 fields: `minute hour day month weekday`

| Field   | Range | Description              |
| ------- | ----- | ------------------------ |
| minute  | 0-59  | Minute of the hour       |
| hour    | 0-23  | Hour of the day          |
| day     | 1-31  | Day of the month         |
| month   | 1-12  | Month of the year        |
| weekday | 0-6   | Day of week (0 = Sunday) |

Special characters:

| Character | Meaning        | Example                           |
| --------- | -------------- | --------------------------------- |
| `*`       | Any value      | `* * * * *` = every minute        |
| `,`       | List separator | `0,30 * * * *` = :00 and :30      |
| `-`       | Range          | `9-17 * * * 1-5` = business hours |
| `/`       | Step           | `*/15 * * * *` = every 15 minutes |

Common patterns:

| Pattern          | Description                      |
| ---------------- | -------------------------------- |
| `0 8 * * *`      | Daily at 8:00 AM                 |
| `0 9 * * 1`      | Every Monday at 9:00 AM          |
| `*/30 * * * *`   | Every 30 minutes                 |
| `0 0 1 * *`      | First of every month at midnight |
| `0 9-17 * * 1-5` | Every hour during business hours |

#### timezone

IANA timezone identifier or `"auto"`.

| Value                | Description                   |
| -------------------- | ----------------------------- |
| `"auto"`             | Use system timezone (default) |
| `"America/New_York"` | Eastern Time                  |
| `"Europe/London"`    | GMT/BST                       |
| `"Asia/Tokyo"`       | Japan Standard Time           |
| `"UTC"`              | Coordinated Universal Time    |

### Webhook Trigger

Creates an HTTP endpoint that triggers the Service.

```json
{
  "trigger": {
    "type": "webhook",
    "path": "/webhooks/github",
    "methods": ["POST"],
    "auth": {
      "type": "signature",
      "header": "X-Webhook-Signature",
      "secret": "${config.secret}"
    }
  }
}
```

#### Fields

| Field     | Type        | Required | Description                       |
| --------- | ----------- | -------- | --------------------------------- |
| `type`    | `"webhook"` | Yes      | Trigger type                      |
| `path`    | `string`    | Yes      | URL path for the endpoint         |
| `methods` | `string[]`  | No       | HTTP methods (default: `["POST"]` |
| `auth`    | `object`    | No       | Authentication configuration      |

#### path

URL path for the webhook endpoint. Must start with `/`.

- Static: `/webhooks/github`
- Dynamic: `/webhooks/{hookId}` (uses config value)

#### methods

Array of HTTP methods to accept.

Valid values: `"GET"`, `"POST"`, `"PUT"`, `"PATCH"`, `"DELETE"`

Default: `["POST"]`

#### auth

Authentication configuration for webhook requests.

```json
{
  "type": "signature",
  "header": "X-Webhook-Signature",
  "secret": "${config.secret}"
}
```

| Field    | Type     | Required | Description                                             |
| -------- | -------- | -------- | ------------------------------------------------------- |
| `type`   | `string` | Yes      | Auth type: `"none"`, `"token"`, `"hmac"`, `"signature"` |
| `header` | `string` | No       | Header name for auth token                              |
| `secret` | `string` | No       | Secret reference (use `${config.key}`)                  |

Auth types:

| Type          | Description                      |
| ------------- | -------------------------------- |
| `"none"`      | No authentication                |
| `"token"`     | Simple bearer token in header    |
| `"hmac"`      | HMAC-SHA256 signature validation |
| `"signature"` | Generic signature validation     |

### Message Trigger

Triggers when messages match criteria in configured channels.

```json
{
  "trigger": {
    "type": "message",
    "channels": ["slack", "discord", "telegram"],
    "filters": {
      "patterns": ["^!\\w+"],
      "keywords": ["!help", "!status"],
      "fromUsers": ["U123456"],
      "hasAttachments": false
    }
  }
}
```

#### Fields

| Field      | Type        | Required | Description                |
| ---------- | ----------- | -------- | -------------------------- |
| `type`     | `"message"` | Yes      | Trigger type               |
| `channels` | `string[]`  | Yes      | Channel types to monitor   |
| `filters`  | `object`    | No       | Message filtering criteria |

#### channels

Array of channel types to monitor.

Valid values: `"slack"`, `"discord"`, `"telegram"`, `"whatsapp"`, `"signal"`, `"imessage"`, `"bluebubbles"`, `"googlechat"`, `"msteams"`, `"matrix"`, `"webchat"`

#### filters

Criteria for matching messages.

```json
{
  "patterns": ["^!\\w+"],
  "keywords": ["!help", "!status"],
  "fromUsers": ["U123456"],
  "hasAttachments": false
}
```

| Field            | Type       | Description                               |
| ---------------- | ---------- | ----------------------------------------- |
| `patterns`       | `string[]` | Regex patterns to match message content   |
| `keywords`       | `string[]` | Keywords to watch for                     |
| `fromUsers`      | `string[]` | Specific user IDs to monitor              |
| `hasAttachments` | `boolean`  | Only trigger on messages with attachments |

All filters are combined with AND logic. Within arrays, values use OR logic.

Example:

```json
{
  "keywords": ["!help", "!status"], // Matches "!help" OR "!status"
  "fromUsers": ["U123"] // AND from user U123
}
```

### Web UI Trigger

Creates a dashboard or web page for the Service.

```json
{
  "trigger": {
    "type": "web",
    "path": "/dashboards/status",
    "auth": "gateway"
  }
}
```

#### Fields

| Field  | Type     | Required | Description                                |
| ------ | -------- | -------- | ------------------------------------------ |
| `type` | `"web"`  | Yes      | Trigger type                               |
| `path` | `string` | Yes      | URL path for the dashboard                 |
| `auth` | `string` | No       | Authentication mode (default: `"gateway"`) |

#### auth

| Value        | Description                    |
| ------------ | ------------------------------ |
| `"gateway"`  | Require gateway authentication |
| `"public"`   | No authentication required     |
| `"password"` | Password protection            |

## Configuration Schema

The `config` field defines user-customizable parameters using JSON Schema with OpenClaw extensions.

```json
{
  "config": {
    "fieldName": {
      "type": "string",
      "description": "Human-readable description",
      "required": true,
      "default": "default value",
      "x-openclaw": {
        "inputType": "text"
      }
    }
  }
}
```

### Base Field Properties

All config fields support these properties:

| Property      | Type      | Required | Description                                  |
| ------------- | --------- | -------- | -------------------------------------------- |
| `type`        | `string`  | Yes      | Data type                                    |
| `description` | `string`  | Yes      | Human-readable description                   |
| `required`    | `boolean` | No       | Whether field is required (default: `false`) |
| `default`     | `any`     | No       | Default value                                |

### Field Types

#### string

Text input.

```json
{
  "type": "string",
  "description": "City name",
  "minLength": 1,
  "maxLength": 100,
  "pattern": "^[A-Za-z\\s]+$",
  "enum": ["New York", "London", "Tokyo"]
}
```

| Property    | Type       | Description                  |
| ----------- | ---------- | ---------------------------- |
| `minLength` | `number`   | Minimum character length     |
| `maxLength` | `number`   | Maximum character length     |
| `pattern`   | `string`   | Regex pattern for validation |
| `enum`      | `string[]` | Allowed values               |

#### number

Numeric input.

```json
{
  "type": "number",
  "description": "Refresh interval in minutes",
  "minimum": 1,
  "maximum": 1440,
  "default": 60
}
```

| Property  | Type     | Description   |
| --------- | -------- | ------------- |
| `minimum` | `number` | Minimum value |
| `maximum` | `number` | Maximum value |

#### boolean

True/false toggle.

```json
{
  "type": "boolean",
  "description": "Enable notifications",
  "default": true
}
```

#### array

List of values.

```json
{
  "type": "array",
  "description": "Channels to monitor",
  "items": {
    "type": "string",
    "enum": ["slack", "discord", "telegram"]
  },
  "minItems": 1,
  "maxItems": 10
}
```

| Property   | Type     | Description             |
| ---------- | -------- | ----------------------- |
| `items`    | `object` | Schema for array items  |
| `minItems` | `number` | Minimum number of items |
| `maxItems` | `number` | Maximum number of items |

#### object

Nested configuration.

```json
{
  "type": "object",
  "description": "Delivery settings",
  "required": true,
  "properties": {
    "channel": {
      "type": "string",
      "enum": ["slack", "email"]
    },
    "target": {
      "type": "string"
    }
  }
}
```

| Property     | Type     | Description              |
| ------------ | -------- | ------------------------ |
| `properties` | `object` | Nested field definitions |

#### secret

Sensitive value (encrypted storage).

```json
{
  "type": "secret",
  "description": "API key",
  "required": true
}
```

Secrets are:

- Encrypted at rest
- Masked in logs and UI
- Never exposed in API responses

### OpenClaw Extensions (x-openclaw)

UI hints and dynamic behavior.

```json
{
  "x-openclaw": {
    "inputType": "select",
    "dataSource": {
      "skill": "calendar",
      "tool": "list"
    },
    "validateOn": "blur"
  }
}
```

#### inputType

UI component to use for this field.

| Value              | Description                 |
| ------------------ | --------------------------- |
| `"text"`           | Single line text input      |
| `"textarea"`       | Multi-line text area        |
| `"number"`         | Numeric input with spinner  |
| `"select"`         | Dropdown selection          |
| `"multiselect"`    | Multiple selection checkbox |
| `"toggle"`         | On/off switch               |
| `"channel-picker"` | Channel selection UI        |
| `"skill-picker"`   | Skill selection UI          |

#### dataSource

Dynamic options from skills or tools.

```json
{
  "dataSource": {
    "skill": "calendar",
    "tool": "listCalendars",
    "config": "channels.slack"
  }
}
```

| Property | Description            |
| -------- | ---------------------- |
| `skill`  | Skill ID to query      |
| `tool`   | Tool name to invoke    |
| `config` | Config path for values |

#### validateOn

When to run validation.

| Value      | Description                  |
| ---------- | ---------------------------- |
| `"blur"`   | When field loses focus       |
| `"change"` | When value changes (default) |
| `"submit"` | When form is submitted       |

## Requirements Block

Declare what your Service needs to function.

```json
{
  "requires": {
    "skills": ["weather"],
    "optionalSkills": ["calendar"],
    "tools": ["message.send"],
    "optionalTools": ["email.send"],
    "env": ["OPENWEATHER_API_KEY"],
    "config": ["channels.slack"]
  }
}
```

### Fields

| Field            | Type       | Description                                                 |
| ---------------- | ---------- | ----------------------------------------------------------- |
| `skills`         | `string[]` | Required skill IDs (installation fails if unavailable)      |
| `optionalSkills` | `string[]` | Optional skills (service works with degraded functionality) |
| `tools`          | `string[]` | Required tool names                                         |
| `optionalTools`  | `string[]` | Optional tool names                                         |
| `env`            | `string[]` | Required environment variables                              |
| `config`         | `string[]` | Required OpenClaw config paths                              |

### Skills

Skill IDs that must be available. Installation fails if not found.

```json
{
  "skills": ["weather", "calendar"]
}
```

### Optional Skills

Skills that enhance functionality but are not required.

```json
{
  "optionalSkills": ["tasks", "reminders"]
}
```

Your skill should check availability:

```markdown
## Steps

1. Fetch weather (required skill)
2. If calendar skill is available:
   - Fetch calendar events
3. Otherwise:
   - Skip calendar section
```

### Tools

Tool names that must be registered.

```json
{
  "tools": ["message.send", "web_fetch"]
}
```

Common tools:

| Tool               | Description               |
| ------------------ | ------------------------- |
| `message.send`     | Send messages to channels |
| `web_fetch`        | HTTP requests             |
| `email.send`       | Send emails               |
| `browser.navigate` | Browser automation        |
| `system.run`       | Execute shell commands    |

### Optional Tools

Tools that are used if available.

```json
{
  "optionalTools": ["email.send"]
}
```

### Environment Variables

Environment variables that must be set.

```json
{
  "env": ["OPENWEATHER_API_KEY", "SLACK_BOT_TOKEN"]
}
```

### Config Paths

OpenClaw configuration paths that must exist.

```json
{
  "config": ["channels.slack", "gateway.webhooks.enabled"]
}
```

## Capabilities Block

Security declarations and permission requirements.

```json
{
  "capabilities": {
    "privilegedTools": ["message.send"],
    "requiresConfirmation": ["email.send"],
    "network": true,
    "filesystem": false,
    "shell": false,
    "browser": false
  }
}
```

### Fields

| Field                  | Type       | Default | Description                       |
| ---------------------- | ---------- | ------- | --------------------------------- |
| `privilegedTools`      | `string[]` | `[]`    | Tools requiring user confirmation |
| `requiresConfirmation` | `string[]` | `[]`    | Tools that always prompt          |
| `network`              | `boolean`  | `false` | Internet access required          |
| `filesystem`           | `boolean`  | `false` | File system access required       |
| `shell`                | `boolean`  | `false` | Shell command execution           |
| `browser`              | `boolean`  | `false` | Browser automation                |

### privilegedTools

Tools that require explicit user confirmation before execution.

```json
{
  "privilegedTools": ["message.send", "email.send", "system.run"]
}
```

Users can pre-approve these for a Service after first confirmation.

### requiresConfirmation

Tools that always prompt for confirmation, even if pre-approved elsewhere.

```json
{
  "requiresConfirmation": ["system.run", "browser.navigate"]
}
```

### network

Whether the Service needs internet access.

```json
{
  "network": true
}
```

Services with `network: true` can:

- Make HTTP requests
- Call external APIs
- Fetch web content

### filesystem

Whether the Service needs file system access.

```json
{
  "filesystem": true
}
```

Services with `filesystem: true` can:

- Read files
- Write files
- Create directories

### shell

Whether the Service can execute shell commands.

```json
{
  "shell": false
}
```

Setting `shell: true` requires careful review. Prefer using specific tools over shell access.

### browser

Whether the Service needs browser automation.

```json
{
  "browser": false
}
```

Services with `browser: true` can:

- Navigate web pages
- Interact with elements
- Take screenshots

## Execution Configuration

Control runtime behavior.

```json
{
  "execution": {
    "agentId": "service:my-service",
    "sessionTarget": "isolated",
    "timeout": 30000,
    "retryPolicy": {
      "maxRetries": 3,
      "backoff": "exponential",
      "initialDelayMs": 1000
    }
  }
}
```

### Fields

| Field           | Type     | Required | Default        | Description             |
| --------------- | -------- | -------- | -------------- | ----------------------- |
| `agentId`       | `string` | No       | Auto-generated | Agent identifier        |
| `sessionTarget` | `string` | No       | `"isolated"`   | Session isolation level |
| `timeout`       | `number` | No       | `30000`        | Execution timeout (ms)  |
| `retryPolicy`   | `object` | No       | See below      | Retry configuration     |

### agentId

Identifier for the Service's agent session.

- Auto-generated as `service:{id}` if not specified
- Used for session isolation and logging
- Must be unique across the system

### sessionTarget

Session isolation level.

| Value        | Description                        |
| ------------ | ---------------------------------- |
| `"main"`     | Use main session                   |
| `"isolated"` | Create dedicated session (default) |

Isolated sessions provide:

- Separate conversation history
- Isolated tool state
- Better error containment

### timeout

Maximum execution time in milliseconds.

| Value   | Description          |
| ------- | -------------------- |
| Minimum | `1000` (1 second)    |
| Maximum | `300000` (5 minutes) |
| Default | `30000` (30 seconds) |

### retryPolicy

Configuration for retrying failed executions.

```json
{
  "retryPolicy": {
    "maxRetries": 3,
    "backoff": "exponential",
    "initialDelayMs": 1000
  }
}
```

| Field            | Type     | Required | Default         | Description                |
| ---------------- | -------- | -------- | --------------- | -------------------------- |
| `maxRetries`     | `number` | No       | `3`             | Maximum retry attempts     |
| `backoff`        | `string` | No       | `"exponential"` | Backoff strategy           |
| `initialDelayMs` | `number` | No       | `1000`          | Initial delay before retry |

#### maxRetries

Number of retry attempts after initial failure.

| Value  | Description              |
| ------ | ------------------------ |
| `0`    | No retries               |
| `1-10` | Number of retry attempts |

#### backoff

Delay strategy between retries.

| Strategy        | Description              |
| --------------- | ------------------------ |
| `"fixed"`       | Constant delay           |
| `"linear"`      | Delay increases linearly |
| `"exponential"` | Delay doubles each time  |

Example delays with `initialDelayMs: 1000`:

| Retry | Fixed  | Linear | Exponential |
| ----- | ------ | ------ | ----------- |
| 1     | 1000ms | 1000ms | 1000ms      |
| 2     | 1000ms | 2000ms | 2000ms      |
| 3     | 1000ms | 3000ms | 4000ms      |

#### initialDelayMs

Time to wait before first retry.

Default: `1000` (1 second)

## TypeScript Types

For TypeScript development, these types are available from `openclaw/services/schema`:

```typescript
import {
  ServiceManifest,
  CronTrigger,
  WebhookTrigger,
  MessageTrigger,
  WebUITrigger,
  ServiceConfigField,
  ServiceRequirements,
  ServiceCapabilities,
  ServiceExecutionConfig,
} from "openclaw/services/schema";

// Validate a manifest
import { isServiceManifest } from "openclaw/services/schema";

const valid = isServiceManifest(manifestObject);
```

## Complete Example

```json
{
  "$schema": "https://openclaw.ai/schemas/service-v1.json",
  "id": "github-pr-notifier",
  "name": "GitHub PR Notifier",
  "description": "Get notified when pull requests are opened, updated, or merged in your repositories",
  "version": "2.1.0",
  "author": "OpenClaw",
  "category": "integration",

  "trigger": {
    "type": "webhook",
    "path": "/webhooks/github-pr",
    "methods": ["POST"],
    "auth": {
      "type": "signature",
      "header": "X-Hub-Signature-256",
      "secret": "${config.webhookSecret}"
    }
  },

  "config": {
    "repositories": {
      "type": "array",
      "description": "Repositories to monitor (format: owner/repo)",
      "items": {
        "type": "string",
        "pattern": "^[\\w-]+/[\\w-]+$"
      },
      "required": true,
      "minItems": 1,
      "x-openclaw": {
        "inputType": "multiselect"
      }
    },
    "events": {
      "type": "array",
      "description": "PR events to notify about",
      "items": {
        "type": "string",
        "enum": ["opened", "closed", "reopened", "synchronize", "review_requested"]
      },
      "default": ["opened", "closed"],
      "required": true,
      "x-openclaw": {
        "inputType": "multiselect"
      }
    },
    "deliveryChannel": {
      "type": "string",
      "enum": ["slack", "discord"],
      "description": "Where to send notifications",
      "required": true,
      "x-openclaw": {
        "inputType": "channel-picker"
      }
    },
    "webhookSecret": {
      "type": "secret",
      "description": "GitHub webhook secret for signature validation",
      "required": true
    }
  },

  "requires": {
    "skills": [],
    "tools": ["message.send"],
    "env": [],
    "config": []
  },

  "capabilities": {
    "privilegedTools": ["message.send"],
    "network": true,
    "filesystem": false,
    "shell": false,
    "browser": false
  },

  "execution": {
    "agentId": "service:github-pr-notifier",
    "sessionTarget": "isolated",
    "timeout": 15000,
    "retryPolicy": {
      "maxRetries": 3,
      "backoff": "exponential",
      "initialDelayMs": 500
    }
  }
}
```

## Validation

Use the CLI to validate manifests:

```bash
# Validate schema
openclaw service validate ./service.json

# Check requirements
openclaw service check ./service.json

# Dry run installation
openclaw service install ./service.json --dry-run
```

Common validation errors:

| Error                     | Cause                                | Fix                     |
| ------------------------- | ------------------------------------ | ----------------------- |
| `Invalid id format`       | ID contains uppercase or underscores | Use kebab-case          |
| `Missing required field`  | Required field omitted               | Add the field           |
| `Invalid cron expression` | Cron syntax error                    | Check expression format |
| `Unknown trigger type`    | Invalid type value                   | Use valid type          |
| `Invalid version format`  | Not semver                           | Use X.Y.Z format        |

## Schema Version

This documentation covers Service Manifest Schema v1.0.

Schema URL: `https://openclaw.ai/schemas/service-v1.json`

Future versions will use different schema URLs for backward compatibility.
