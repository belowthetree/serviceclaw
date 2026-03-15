---
title: Service Development Guide
summary: Complete guide for creating and publishing OpenClaw Services
description: Learn how to build declarative automations using OpenClaw's Service system
---

# Service Development Guide

This guide teaches you how to create Services in OpenClaw. Services are declarative automations that let non-technical users set up powerful workflows without writing code.

## What You Will Learn

- How Services work in OpenClaw
- How to write a Service manifest
- How to create the skill that powers your Service
- How to test and debug Services
- How to package and share Services

## Prerequisites

Before you start:

- Install OpenClaw CLI: `npm install -g openclaw`
- Complete the onboarding: `openclaw onboard`
- Understand [Service Architecture](/services/architecture)
- Review [Service API Reference](/services/api)

## Quick Start

Create a Service in 5 minutes:

````bash
# Create a new Service project
mkdir my-service
cd my-service

# Create the manifest
cat > service.json << 'EOF'
{
  "$schema": "https://openclaw.ai/schemas/service-v1.json",
  "id": "hello-world",
  "name": "Hello World Service",
  "description": "A simple greeting service that runs on schedule",
  "version": "1.0.0",
  "category": "automation",
  "trigger": {
    "type": "cron",
    "schedule": "0 9 * * *"
  },
  "config": {
    "name": {
      "type": "string",
      "description": "Who to greet",
      "default": "World",
      "required": true
    }
  },
  "requires": {
    "tools": ["message.send"]
  },
  "capabilities": {
    "privilegedTools": ["message.send"],
    "network": false
  }
}
EOF

# Create the skill
mkdir -p skills/hello-world
cat > skills/hello-world/SKILL.md << 'EOF'
# Hello World Service

Send a personalized greeting message.

## When Triggered

This service sends a greeting every morning at 9 AM.

## Steps

1. Read the configured name from service config
2. Generate a friendly greeting message
3. Send via `message.send` tool:
   ```json
   {
     "channel": "slack",
     "message": "Good morning, {name}! Have a great day!"
   }
````

## Configuration

- `name`: The person to greet (default: "World")
  EOF

# Install the Service

openclaw service install ./service.json

````

## Understanding Services

### What Is a Service?

A Service bundles three things:

1. **Trigger**: When the Service runs (cron schedule, webhook, message, or web UI)
2. **Configuration**: User-customizable parameters via JSON Schema
3. **Skill**: The agent logic that executes when triggered

Services reuse OpenClaw's existing infrastructure. They do not create new runtimes. Instead, they configure:

- Cron jobs via CronService
- Webhook routes via the HTTP registry
- Message subscriptions via channel hooks
- Agent sessions for execution

### The Two Service Types

OpenClaw supports two distinct service types, each suited for different automation patterns:

#### Traditional Service (Long-Running Process)

A Traditional Service is a long-running process that continuously executes in the background. It uses a `manifest.json` file and is ideal for services that need to:

- Monitor systems continuously
- Process streams of data
- Run background workers
- Maintain persistent connections

Traditional Services are installed and started like a daemon:

```bash
openclaw service install ./manifest.json
openclaw service start <service-id>
````

#### Declarative Service (Trigger-Based)

A Declarative Service is event-driven and only executes when triggered. It uses a `service.json` file and is ideal for services that need to:

- Run on a schedule (cron)
- Respond to webhooks
- React to messages
- Provide dashboard functionality

Declarative Services are installed and enabled:

```bash
openclaw service install ./service.json
openclaw service enable <service-id>
```

### Service Type Comparison

| Aspect              | Traditional Service                        | Declarative Service                       |
| ------------------- | ------------------------------------------ | ----------------------------------------- |
| **Manifest file**   | `manifest.json`                            | `service.json`                            |
| **Execution model** | Long-running process                       | Trigger-based (on-demand)                 |
| **Lifecycle**       | Start/stop                                 | Enable/disable                            |
| **Triggers**        | Internal logic                             | Cron, webhook, message, web UI            |
| **Use case**        | Continuous monitoring                      | Scheduled/reactive tasks                  |
| **CLI install**     | `openclaw service install ./manifest.json` | `openclaw service install ./service.json` |
| **CLI control**     | `--start`, `--stop`                        | `--enable`, `--disable`                   |

### Service vs Extension

| Aspect       | Extension               | Service                      |
| ------------ | ----------------------- | ---------------------------- |
| Code         | Contains implementation | References existing tools    |
| Audience     | Developers              | Non-technical users          |
| Distribution | NPM package             | Service manifest + skill     |
| Installation | `npm install`           | `openclaw service install`   |
| Runtime      | May have custom runtime | Uses existing infrastructure |

## Service Project Structure

A complete Service project looks like this:

```
my-service/
├── service.json          # Service manifest (required for Declarative)
├── manifest.json         # Service manifest (required for Traditional)
├── README.md             # Documentation for users
├── CHANGELOG.md          # Version history
└── skills/
    └── my-service/       # Skill directory
        └── SKILL.md      # Agent instructions (required)
```

## Writing the Traditional Service Manifest (manifest.json)

Traditional Services use `manifest.json` to define a long-running process.

### Minimal Example

```json
{
  "$schema": "https://openclaw.ai/schemas/service-manifest-v1.json",
  "id": "log-monitor",
  "name": "Log Monitor",
  "description": "Continuously monitors log files for errors",
  "version": "1.0.0",
  "type": "traditional",
  "entry": {
    "command": "node",
    "args": ["./monitor.js"]
  },
  "config": {
    "logPath": {
      "type": "string",
      "description": "Path to log file to monitor",
      "required": true
    },
    "checkInterval": {
      "type": "number",
      "description": "Check interval in seconds",
      "default": 30
    }
  },
  "requires": {
    "tools": ["message.send"]
  },
  "capabilities": {
    "privilegedTools": ["message.send"],
    "network": false,
    "filesystem": true
  }
}
```

### Key manifest.json Fields

| Field          | Description                                 |
| -------------- | ------------------------------------------- |
| `id`           | Unique identifier (kebab-case)              |
| `type`         | Must be `"traditional"`                     |
| `entry`        | Command and arguments to start the process  |
| `config`       | Configuration schema for user customization |
| `requires`     | Required tools, skills, and environment     |
| `capabilities` | Security declarations                       |

### Entry Configuration

Define how the service process starts:

```json
{
  "entry": {
    "command": "node",
    "args": ["./index.js", "--config", "${configPath}"],
    "env": {
      "NODE_ENV": "production",
      "LOG_LEVEL": "${config.logLevel}"
    },
    "workingDirectory": "${serviceDir}",
    "restartPolicy": {
      "onFailure": true,
      "maxRetries": 5,
      "backoffMs": 5000
    }
  }
}
```

## Comparing manifest.json and service.json

Understanding the differences between these two manifest files helps you choose the right approach:

| Feature              | manifest.json (Traditional)    | service.json (Declarative)             |
| -------------------- | ------------------------------ | -------------------------------------- |
| **Purpose**          | Defines a long-running process | Defines trigger-based execution        |
| **Required field**   | `type: "traditional"`          | `trigger` configuration                |
| **Execution**        | Process stays running          | Executes only when triggered           |
| **Entry point**      | `entry` command required       | No entry command (uses triggers)       |
| **Triggers**         | Not defined (internal logic)   | Required (cron, webhook, message, web) |
| **Lifecycle**        | Start/stop process             | Enable/disable triggers                |
| **Resource use**     | Continuous while running       | Only during execution                  |
| **Restart behavior** | Configured via `restartPolicy` | Not applicable (trigger-driven)        |

### When to Use Each

**Use manifest.json (Traditional) when:**

- You need continuous monitoring or polling
- The service maintains persistent connections
- You are building a background worker or daemon
- The service needs to react to internal events in real-time

**Use service.json (Declarative) when:**

- You want scheduled execution (cron)
- You need webhook endpoints
- The service reacts to channel messages
- You prefer event-driven architecture

## Writing the Declarative Service Manifest (service.json)

The `service.json` file defines everything about your Service.

### Minimal Example

```json
{
  "$schema": "https://openclaw.ai/schemas/service-v1.json",
  "id": "my-service",
  "name": "My Service",
  "description": "What this service does",
  "version": "1.0.0",
  "trigger": {
    "type": "cron",
    "schedule": "0 9 * * *"
  },
  "config": {},
  "requires": {
    "tools": ["message.send"]
  },
  "capabilities": {
    "network": false
  }
}
```

### Identity Fields

```json
{
  "id": "daily-briefing", // Unique ID (kebab-case)
  "name": "Daily Briefing", // Display name
  "description": "Your personalized...", // What it does
  "version": "1.0.0", // Semver version
  "author": "Your Name", // Creator
  "category": "productivity" // For grouping
}
```

ID requirements:

- Use lowercase letters, numbers, and hyphens
- Must start with a letter
- Must be unique across all installed Services

Valid: `daily-briefing`, `webhook-receiver-v2`, `myapp-alerts`
Invalid: `DailyBriefing`, `my_service`, `123-service`

### Trigger Configuration

Services support four trigger types:

#### 1. Cron Trigger (Scheduled)

```json
{
  "trigger": {
    "type": "cron",
    "schedule": "0 8 * * *", // 8 AM daily
    "timezone": "auto" // Or "America/New_York"
  }
}
```

Common cron patterns:

| Pattern        | Description             |
| -------------- | ----------------------- |
| `0 8 * * *`    | Every day at 8 AM       |
| `*/15 * * * *` | Every 15 minutes        |
| `0 9 * * 1`    | Every Monday at 9 AM    |
| `0 0 1 * *`    | First day of each month |

#### 2. Webhook Trigger (HTTP Endpoint)

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

Auth types:

- `none`: No authentication
- `token`: Simple token in header
- `hmac`: HMAC signature validation
- `signature`: Generic signature validation

#### 3. Message Trigger (Channel Events)

```json
{
  "trigger": {
    "type": "message",
    "channels": ["slack", "discord"],
    "filters": {
      "keywords": ["!help", "!status"],
      "patterns": ["^!\\w+"],
      "fromUsers": ["U123456"],
      "hasAttachments": false
    }
  }
}
```

#### 4. Web UI Trigger (Dashboard)

```json
{
  "trigger": {
    "type": "web",
    "path": "/dashboards/my-dashboard",
    "auth": "gateway"
  }
}
```

### Configuration Schema

The `config` field defines user-customizable parameters using JSON Schema:

```json
{
  "config": {
    "city": {
      "type": "string",
      "description": "City for weather",
      "default": "New York",
      "required": true,
      "x-openclaw": {
        "inputType": "text"
      }
    },
    "channels": {
      "type": "array",
      "items": { "type": "string" },
      "description": "Channels to monitor",
      "default": ["general"],
      "x-openclaw": {
        "inputType": "multiselect"
      }
    },
    "delivery": {
      "type": "object",
      "description": "Delivery settings",
      "required": true,
      "properties": {
        "method": {
          "type": "string",
          "enum": ["slack", "email"],
          "x-openclaw": { "inputType": "select" }
        }
      }
    }
  }
}
```

Input types for `x-openclaw.inputType`:

- `text`: Single line text input
- `textarea`: Multi-line text
- `number`: Numeric input
- `select`: Dropdown selection
- `multiselect`: Multiple selection
- `toggle`: On/off switch
- `channel-picker`: Channel selection UI
- `skill-picker`: Skill selection UI

### Requirements Block

Declare what your Service needs:

```json
{
  "requires": {
    "skills": ["weather", "calendar"], // Required skills
    "optionalSkills": ["tasks"], // Nice to have
    "tools": ["message.send", "web_fetch"], // Required tools
    "optionalTools": ["email.send"], // Optional tools
    "env": ["OPENWEATHER_API_KEY"], // Environment variables
    "config": ["channels.slack"] // Config paths
  }
}
```

### Capabilities Block (Security)

Declare security requirements:

```json
{
  "capabilities": {
    "privilegedTools": ["message.send"], // Require user confirmation
    "requiresConfirmation": ["email.send"],
    "network": true, // Needs internet
    "filesystem": false, // No file access
    "shell": false, // No shell commands
    "browser": false // No browser automation
  }
}
```

### Execution Configuration

Control how the Service runs:

```json
{
  "execution": {
    "agentId": "service:my-service", // Auto-generated if omitted
    "sessionTarget": "isolated", // "main" or "isolated"
    "timeout": 30000, // Milliseconds
    "retryPolicy": {
      "maxRetries": 3,
      "backoff": "exponential",
      "initialDelayMs": 1000
    }
  }
}
```

## Writing the Skill

The skill provides agent instructions for what to do when the Service triggers.

### SKILL.md Structure

````markdown
---
name: my-service
description: "What this service does"
metadata: { "openclaw": { "emoji": "🚀" } }
---

# My Service

Brief description of what this service accomplishes.

## When Triggered

Explain when and how the service runs.

## Steps

### 1. First Step

Describe the first action:

```bash
# Example command
echo "Doing something"
```
````

### 2. Second Step

Describe the next action using tools:

```javascript
// Use message.send tool
{
  "channel": "slack",
  "message": "Hello!"
}
```

## Configuration

Document the config values:

| Config Key | Description  | Example           |
| ---------- | ------------ | ----------------- |
| `city`     | City name    | `"San Francisco"` |
| `format`   | Output style | `"detailed"`      |

## Error Handling

Explain how to handle failures gracefully.

## Example Output

Show an example of what the service produces.

````

### Accessing Config Values

The agent can access config values using template syntax:

```markdown
The configured city is: {city}
The delivery method is: {delivery.method}
````

Or in code blocks:

```javascript
{
  "location": "{city}",
  "format": "{format}"
}
```

### Best Practices for Skills

1. **Be specific**: Give clear, step-by-step instructions
2. **Handle errors**: Explain what to do if something fails
3. **Show examples**: Include example outputs
4. **Document config**: List all configuration options
5. **Use tools**: Reference available tools by name

## Step-by-Step Tutorial: Daily Briefing Service

Let's build a complete Service that sends a daily briefing.

### Step 1: Create Project Structure

```bash
mkdir daily-briefing-service
cd daily-briefing-service
mkdir -p skills/daily-briefing
```

### Step 2: Write the Manifest

Create `service.json`:

```json
{
  "$schema": "https://openclaw.ai/schemas/service-v1.json",
  "id": "daily-briefing",
  "name": "Daily Briefing",
  "description": "Your personalized morning briefing with weather, calendar, and tasks",
  "version": "1.0.0",
  "author": "Your Name",
  "category": "productivity",

  "trigger": {
    "type": "cron",
    "schedule": "0 8 * * *",
    "timezone": "auto"
  },

  "config": {
    "weatherLocation": {
      "type": "string",
      "description": "City for weather forecast",
      "default": "New York",
      "required": true,
      "x-openclaw": {
        "inputType": "text"
      }
    },
    "calendarIds": {
      "type": "array",
      "items": { "type": "string" },
      "description": "Calendars to check",
      "default": ["primary"],
      "required": false
    },
    "deliveryChannel": {
      "type": "string",
      "enum": ["slack", "discord", "telegram"],
      "description": "Where to send the briefing",
      "required": true,
      "x-openclaw": {
        "inputType": "select"
      }
    },
    "deliveryTarget": {
      "type": "string",
      "description": "Channel ID or DM handle",
      "required": true
    }
  },

  "requires": {
    "skills": ["weather"],
    "optionalSkills": ["gog"],
    "tools": ["message.send", "web_fetch"]
  },

  "capabilities": {
    "privilegedTools": ["message.send"],
    "network": true,
    "filesystem": false
  },

  "execution": {
    "timeout": 60000,
    "retryPolicy": {
      "maxRetries": 3,
      "backoff": "exponential"
    }
  }
}
```

### Step 3: Write the Skill

Create `skills/daily-briefing/SKILL.md`:

```markdown
---
name: daily-briefing
description: "Generate and deliver a personalized daily morning briefing"
metadata: { "openclaw": { "emoji": "📰" } }
---

# Daily Briefing Service

Generate a comprehensive morning briefing with weather, calendar events, and tasks.

## When Triggered

This service runs at 8:00 AM daily. It can also be triggered manually.

## Steps

### 1. Fetch Weather

Get current weather for {weatherLocation} using the weather skill.

### 2. Fetch Calendar Events

If the gog skill is available:

- Query calendars: {calendarIds}
- Get today's events
- Format with time, title, and location

### 3. Generate Briefing

Create a friendly message:
```

📰 Daily Briefing - {date}

🌤️ Weather in {weatherLocation}:
• {weather summary}

📅 Today's Events ({count}):
• {time} - {event}
• ...

Have a great day!

````

### 4. Deliver Briefing

Send via message.send:

```javascript
{
  "channel": "{deliveryChannel}",
  "target": "{deliveryTarget}",
  "message": "{generated briefing}"
}
````

## Error Handling

- If weather fails: Include "Weather unavailable" message
- If calendar fails: Skip calendar section
- Always deliver partial briefing if possible

````

### Step 4: Test the Service

```bash
# Install the Service
openclaw service install ./service.json

# Configure it
openclaw service config daily-briefing --interactive

# Test manually
openclaw service run daily-briefing

# Check status
openclaw service status daily-briefing
````

### Step 5: Package for Distribution

```bash
# Create a distributable package
tar -czf daily-briefing-service-v1.0.0.tar.gz \
  service.json \
  skills/

# Or publish to a GitHub repository
# Users can install with:
# openclaw service install https://github.com/user/repo/service.json
```

## CLI Commands for Service Development

### Install a Service

```bash
# From local file
openclaw service install ./service.json

# From URL
openclaw service install https://example.com/service.json
```

### Configure a Service

```bash
# Interactive configuration
openclaw service config <service-id> --interactive

# Set specific values
openclaw service config <service-id> --set key=value

# Validate config
openclaw service config <service-id> --validate
```

### Test a Service

```bash
# Run manually (does not wait for trigger)
openclaw service run <service-id>

# Dry run (no side effects)
openclaw service run <service-id> --dry-run
```

### Manage Service State

The CLI commands differ based on the service type:

#### Traditional Services (manifest.json)

Use `--start` and `--stop` to control the long-running process:

```bash
# Start the service process
openclaw service start <service-id>

# Stop the service process
openclaw service stop <service-id>

# Restart the service
openclaw service restart <service-id>

# Check if process is running
openclaw service status <service-id>

# View process logs
openclaw service logs <service-id> --follow
```

#### Declarative Services (service.json)

Use `--enable` and `--disable` to control trigger registration:

```bash
# Enable triggers (activate the service)
openclaw service enable <service-id>

# Disable triggers (deactivate the service)
openclaw service disable <service-id>

# Run manually (trigger execution)
openclaw service run <service-id>

# Check trigger status
openclaw service status <service-id>

# View execution logs
openclaw service logs <service-id> --follow
```

#### Common Commands (Both Types)

```bash
# List all installed services
openclaw service list

# Show detailed status
openclaw service status <service-id> --verbose

# Uninstall a service
openclaw service uninstall <service-id>

# Force uninstall (use when normal uninstall fails)
openclaw service uninstall <service-id> --force
```

### Uninstall a Service

```bash
# Remove a Service
openclaw service uninstall <service-id>

# Force remove (even if in error state)
openclaw service uninstall <service-id> --force
```

## Debugging Services

### Check Service Status

```bash
openclaw service status <service-id> --verbose
```

Output shows:

- Current state (enabled, disabled, error)
- Last run time and result
- Configuration validity
- Trigger status
- Runtime references

### View Service Logs

```bash
# Recent logs
openclaw service logs <service-id>

# Follow logs
openclaw service logs <service-id> --follow

# Filter by time
openclaw service logs <service-id> --since 1h
```

### Validate Manifest

```bash
# Check service.json syntax
openclaw service validate ./service.json

# Check against schema
openclaw service validate ./service.json --schema
```

### Debug Installation

If installation fails:

```bash
# Check requirements
openclaw service check <service-id>

# This verifies:
# - Required skills are available
# - Required tools are registered
# - Environment variables are set
# - Config paths exist
```

## Advanced Topics

### Dynamic Configuration

Use data sources to populate select options:

```json
{
  "config": {
    "calendar": {
      "type": "string",
      "description": "Which calendar to use",
      "x-openclaw": {
        "inputType": "select",
        "dataSource": {
          "skill": "gog",
          "tool": "calendar.list"
        }
      }
    }
  }
}
```

### Conditional Requirements

Services can work with optional capabilities:

```json
{
  "requires": {
    "skills": ["weather"],
    "optionalSkills": ["calendar", "tasks"]
  }
}
```

In your skill:

```markdown
## Steps

1. Fetch weather (required)
2. If calendar skill available:
   - Fetch calendar events
3. If tasks skill available:
   - Fetch tasks
4. Generate briefing with available data
```

### Handling Secrets

Use the `secret` type for sensitive config:

```json
{
  "config": {
    "apiKey": {
      "type": "secret",
      "description": "API key for external service",
      "required": true
    }
  }
}
```

Secrets are:

- Encrypted at rest
- Masked in logs
- Not shown in UI

### Webhook Security

Always validate webhook signatures:

```json
{
  "trigger": {
    "type": "webhook",
    "auth": {
      "type": "hmac",
      "header": "X-Signature",
      "secret": "${config.webhookSecret}"
    }
  }
}
```

## Best Practices

### Manifest Design

1. **Use descriptive IDs**: `github-pr-notifier` not `service1`
2. **Write clear descriptions**: Explain what it does and why
3. **Set sensible defaults**: Make it work out of the box
4. **Mark required fields**: Don't make everything required
5. **Use appropriate input types**: Pickers for channels, toggles for booleans

### Skill Design

1. **Be resilient**: Handle missing optional data gracefully
2. **Log actions**: Include timestamps and context
3. **Respect limits**: Don't spam channels
4. **Format nicely**: Use emojis and structure
5. **Handle errors**: Fail gracefully with informative messages

### Security

1. **Declare capabilities**: Be honest about what you need
2. **Use privilegedTools**: Mark sensitive operations
3. **Validate webhooks**: Always check signatures
4. **Protect secrets**: Use secret type for keys
5. **Rate limit**: Prevent abuse

### Testing

1. **Test manually**: Use `openclaw service run`
2. **Test triggers**: Verify cron, webhook, message triggers
3. **Test errors**: Make sure failures are handled
4. **Test config changes**: Ensure updates work correctly

## Example Services

Study these examples:

- [Daily Briefing](https://github.com/openclaw/openclaw/tree/main/examples/daily-briefing): Cron-based scheduled service
- [Webhook Receiver](https://github.com/openclaw/openclaw/tree/main/examples/webhook-receiver): HTTP endpoint service
- [Message Processor](https://github.com/openclaw/openclaw/tree/main/examples/message-processor): Channel message handler

## Next Steps

- Read the [API Reference](/services/api) for complete schema documentation
- Learn about [Troubleshooting](/services/troubleshooting) common issues
- Use the [Configuration Wizard](/services/configuration-wizard) guide for UI development
- Join the [Discord community](https://discord.gg/clawd) for help
