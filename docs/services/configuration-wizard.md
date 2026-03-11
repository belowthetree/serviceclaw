---
title: Service Configuration Wizard Guide
summary: User guide for configuring Services through the interactive wizard
description: Step-by-step guide for setting up and configuring OpenClaw Services using the interactive wizard
---

# Service Configuration Wizard Guide

This guide helps you configure Services using OpenClaw's interactive configuration wizard.

## Overview

The configuration wizard provides a user-friendly interface for setting up Services. It guides you through:

1. Installing new Services
2. Configuring Service settings
3. Testing Service functionality
4. Managing Service state

## Starting the Wizard

### Basic Usage

```bash
# Configure a specific Service
openclaw service config <service-id> --interactive

# Configure after installation
openclaw service install ./service.json --configure

# Launch general Service management
openclaw service wizard
```

### Wizard Modes

The wizard supports different modes based on your needs:

```bash
# Quick setup (minimal prompts)
openclaw service config my-service --quick

# Full configuration (all options)
openclaw service config my-service --full

# Guided setup for new users
openclaw service config my-service --tutorial
```

## Installation Wizard

### Installing a New Service

When you install a Service, the wizard automatically guides you through configuration:

```bash
$ openclaw service install ./daily-briefing/service.json

✓ Validated service manifest
✓ Checked requirements
✓ Service installed successfully

Configuring Daily Briefing Service
==================================

This service sends a personalized morning briefing with weather,
calendar events, and tasks.

Press Enter to continue or Ctrl+C to skip configuration...
```

### Configuration Steps

The wizard walks through each configuration field:

```
Configuration: Daily Briefing
=============================

1. Weather Location (Required)
   City or location for weather forecast

   Default: New York

   Enter location: San Francisco

   ✓ Valid location

2. Calendar IDs (Optional)
   Calendars to include in briefing

   Default: ["primary"]

   Available calendars:
   [x] primary
   [ ] work
   [ ] personal

   Select calendars (Space to toggle, Enter to confirm):

3. Delivery Channel (Required)
   Where to send the briefing

   [ ] slack
   [x] discord
   [ ] telegram
   [ ] email

   Select channel: discord

4. Delivery Target (Required)
   Channel ID or DM handle

   Example: #general or @username

   Enter target: #daily-briefing

   ✓ Channel verified

Configuration complete!
=======================

Summary:
  Weather Location: San Francisco
  Calendar IDs: primary
  Delivery Channel: discord
  Delivery Target: #daily-briefing

Enable service now? [Y/n]: Y

✓ Service enabled
✓ Next run: Tomorrow at 8:00 AM
```

## Field Types Guide

### Text Input

For string configuration values:

```
API Key (Required)
Your OpenWeather API key

Enter value: ▌

Help: Get your API key from https://openweathermap.org/api
      The key should be 32 characters long.
```

Navigation:

- Type to enter text
- Backspace to delete
- Enter to confirm
- Tab for autocomplete suggestions

### Number Input

For numeric values:

```
Rate Limit (Optional)
Maximum requests per minute

Default: 60
Range: 1-1000

Enter value: 120 ▌

Use ↑/↓ arrows to adjust by 1
Use Page Up/Down to adjust by 10
```

### Toggle

For boolean values:

```
Enable Notifications
Send notifications when events occur

Current: [ON]  OFF

Press Space or Enter to toggle
```

### Select (Single Choice)

For choosing one option:

```
Delivery Channel (Required)
Where to send messages

  [ ] slack
  [x] discord
  [ ] telegram
  [ ] email

Use ↑/↓ to navigate, Enter to select
```

### Multi-Select

For choosing multiple options:

```
News Sources (Optional)
Categories to include in briefing

  [x] tech
  [x] science
  [ ] sports
  [ ] business
  [x] world

Use ↑/↓ to navigate, Space to toggle, Enter to confirm
```

### Channel Picker

For selecting OpenClaw channels:

```
Notification Channel (Required)
Channel for notifications

Available channels:
  [x] slack:general
  [ ] slack:random
  [ ] discord:announcements
  [ ] telegram:my-group

Or enter channel ID manually: _________________

Test connection? [Y/n]: Y
✓ Connection successful
```

### Skill Picker

For selecting available skills:

```
Calendar Skill (Optional)
Skill for calendar integration

Installed skills:
  [x] google-calendar (gog)
  [ ] apple-calendar
  [ ] outlook-calendar
  [ ] Not installed - Install from ClawHub

Learn more: https://clawhub.com/skills/calendar
```

### Secret Input

For sensitive values:

```
Webhook Secret (Required)
Secret for webhook signature validation

Enter value: •••••••••••••••• ▌

The value is hidden for security.
Press Ctrl+R to reveal, Ctrl+H to hide.
```

## Advanced Configuration

### Nested Objects

Configure nested settings:

```
Delivery Settings
=================

1. Method
   [x] slack
   [ ] discord
   [ ] email

2. Target
   #general

3. Format
   [ ] Plain text
   [x] Formatted
   [ ] Markdown

← Back  Next →  Done ✓
```

### Arrays with Dynamic Items

Add multiple items:

```
Webhook Rules
=============

Rule 1:
  Name: GitHub PR
  Condition: $.event == "pull_request"
  Action: notify
  Target: #github

Rule 2:
  Name: <not set>

  [Add Rule]  [Edit]  [Delete]  [Done]
```

### Validation Feedback

Real-time validation:

```
Server URL (Required)
URL for webhook endpoint

Enter URL: http://example.com/webhook
                              ✗ Invalid URL
                              Must start with https://

Enter URL: https://example.com/webhook
                              ✓ Valid URL
                              ✓ Connection test passed
```

## Contextual Help

### Field Help

Press `?` or `F1` for help:

```
Timezone Configuration
======================

Current: America/New_York

The timezone determines when scheduled Services run.
Use "auto" to detect from system settings.

Common timezones:
  • America/New_York - Eastern Time
  • America/Chicago - Central Time
  • America/Denver - Mountain Time
  • America/Los_Angeles - Pacific Time
  • Europe/London - GMT/BST
  • Europe/Paris - Central European Time
  • Asia/Tokyo - Japan Standard Time
  • UTC - Coordinated Universal Time

Press any key to continue...
```

### Examples

See example values:

```
Cron Schedule (Required)
When to run this Service

Enter expression: 0 8 * * *

Examples:
  0 8 * * *       Every day at 8:00 AM
  */15 * * * *    Every 15 minutes
  0 9 * * 1       Every Monday at 9:00 AM
  0 0 1 * *       First of every month
  0 9-17 * * 1-5  Every hour during business hours

Test: Runs daily at 8:00 AM
Next runs:
  • Tomorrow at 8:00 AM
  • Day after at 8:00 AM
```

## Progress Saving

### Auto-Save

Configuration is automatically saved as you progress:

```
Configuration saved (auto)
==========================

Your progress has been saved.
You can resume later by running:
  openclaw service config my-service --resume

Continue? [Y/n]: Y
```

### Resume Configuration

Return to incomplete configuration:

```bash
# Resume from where you left off
openclaw service config my-service --resume

# Or see all incomplete configurations
openclaw service list --incomplete
```

## Testing Configuration

### Live Preview

Test settings before saving:

```
Configuration Preview
=====================

  Weather Location: San Francisco
  Delivery Channel: slack
  Delivery Target: #weather-alerts

[Test Settings]  [Edit]  [Save]

Testing delivery...
✓ Connected to Slack
✓ Channel #weather-alerts exists
✓ Test message sent
✓ Configuration valid

Save and enable? [Y/n]: Y
```

### Dry Run

Simulate execution without side effects:

```
Dry Run Test
============

Simulating service execution...

✓ Trigger: Cron at 8:00 AM
✓ Config loaded
✓ Weather skill available
✓ Message.send tool available
✓ Would fetch weather for San Francisco
✓ Would send message to #weather-alerts

Estimated execution time: 2.5 seconds
No errors detected

[Run Live Test]  [Modify Config]  [Save]
```

## Post-Configuration

### Enable Service

After configuration:

```
Configuration Complete!
=======================

Service: Daily Briefing
Status: Configured, ready to enable

Next steps:
  1. Enable the service to start automation
  2. Test manually to verify functionality
  3. Check logs for execution details

Enable service now? [Y/n]: Y

✓ Service enabled
✓ Cron job registered
✓ Next run: Tomorrow at 8:00 AM

View status: openclaw service status daily-briefing
View logs:   openclaw service logs daily-briefing --follow
```

### View Summary

See all configured Services:

```bash
$ openclaw service list --configured

Configured Services
===================

Name              Status    Trigger         Next Run
────────────────────────────────────────────────────
Daily Briefing    Enabled   Cron (8:00 AM)  Tomorrow
GitHub Notifier   Enabled   Webhook         On demand
Message Handler   Disabled  Message         —

Run 'openclaw service config <name>' to modify
```

## Reconfiguration

### Edit Existing Configuration

```bash
# Launch wizard for existing Service
openclaw service config my-service --interactive
```

```
Current Configuration: Daily Briefing
=====================================

1. Weather Location: San Francisco [Edit]
2. Calendar IDs: primary, work [Edit]
3. Delivery Channel: slack [Edit]
4. Delivery Target: #general [Edit]

[Edit All]  [Reset to Defaults]  [Done]
```

### Partial Reconfiguration

Change specific values:

```bash
# Update single field
openclaw service config my-service --set weatherLocation="Boston"

# Update multiple fields
openclaw service config my-service \
  --set weatherLocation="Boston" \
  --set deliveryTarget="#boston-team"
```

### Reset to Defaults

Restore original configuration:

```
Reset Configuration?
====================

This will reset all configuration to defaults.
Current settings will be lost.

Reset? [y/N]: y

✓ Configuration reset
✓ Default values loaded

Reconfigure now? [Y/n]: Y
```

## Non-Interactive Mode

### Silent Configuration

Configure without prompts:

```bash
# Provide all values via arguments
openclaw service config my-service \
  --non-interactive \
  --set city="New York" \
  --set channel="slack" \
  --set target="#general"
```

### Configuration File

Load from file:

```bash
# Create config file
cat > my-service-config.json << 'EOF'
{
  "city": "New York",
  "channel": "slack",
  "target": "#general",
  "format": "bullet-points"
}
EOF

# Apply configuration
openclaw service config my-service --file my-service-config.json
```

### Environment Variables

Configure via environment:

```bash
export MYSERVICE_CITY="New York"
export MYSERVICE_CHANNEL="slack"
export MYSERVICE_TARGET="#general"

openclaw service config my-service --from-env
```

## Troubleshooting Wizard Issues

### "Terminal too small"

```
Error: Terminal too small
Current: 60x20
Minimum: 80x24

Please resize your terminal or use:
  openclaw service config my-service --compact
```

**Solution:**

```bash
# Use compact mode for small terminals
openclaw service config my-service --compact

# Or via CLI flags only
openclaw service config my-service --set key=value
```

### "Input not recognized"

```
Invalid input. Valid options:
  • Arrow keys to navigate
  • Space to toggle selection
  • Enter to confirm
  • q to quit
  • ? for help
```

### Wizard Crashes

If the wizard crashes:

```bash
# Check for partial configuration
openclaw service config my-service --resume

# Or use non-interactive mode
openclaw service config my-service \
  --set key1=value1 \
  --set key2=value2

# View incomplete configurations
openclaw service list --incomplete
```

## Best Practices

### For Service Users

1. **Read descriptions**: Each field has helpful context
2. **Use test buttons**: Verify connections before saving
3. **Start with defaults**: Services work without customization
4. **Check examples**: Look at example values for guidance
5. **Save progress**: Configuration auto-saves as you go

### For Service Developers

1. **Write clear descriptions**: Help users understand each field
2. **Set sensible defaults**: Make the Service work out of the box
3. **Provide examples**: Show users what values look like
4. **Add help text**: Explain complex configuration options
5. **Validate early**: Catch errors before saving

## Keyboard Shortcuts

### General Navigation

| Key         | Action                    |
| ----------- | ------------------------- |
| `↑` / `↓`   | Navigate between fields   |
| `Tab`       | Next field / Autocomplete |
| `Shift+Tab` | Previous field            |
| `Enter`     | Confirm / Select          |
| `Space`     | Toggle selection          |
| `Esc`       | Cancel / Go back          |
| `q`         | Quit wizard               |
| `?` or `F1` | Show help                 |

### Text Input

| Key      | Action      |
| -------- | ----------- |
| `Ctrl+A` | Select all  |
| `Ctrl+C` | Copy        |
| `Ctrl+V` | Paste       |
| `Ctrl+K` | Clear field |
| `Ctrl+U` | Undo        |

### Special Modes

| Key      | Action                           |
| -------- | -------------------------------- |
| `Ctrl+R` | Reveal secret (in secret fields) |
| `Ctrl+H` | Hide secret                      |
| `Ctrl+T` | Test current setting             |
| `Ctrl+P` | Preview configuration            |

## Custom Wizards

Service developers can create custom wizard flows:

```markdown
## Configuration Guide

### Step 1: API Setup

You'll need an API key from our service.

1. Visit https://example.com/api
2. Create an API key
3. Enter it below

Field: apiKey
Type: secret
Required: true

### Step 2: Webhook URL

Configure where we send notifications.

Field: webhookUrl
Type: string
Validation: url
Test: ping

### Step 3: Event Types

Choose which events to receive.

Field: events
Type: multiselect
Options: [created, updated, deleted]
```

The wizard reads this guide to customize the flow.

## Next Steps

After configuring a Service:

1. **Enable the Service** to start automation
2. **Test manually** using `openclaw service run`
3. **Monitor logs** with `openclaw service logs --follow`
4. **Check status** with `openclaw service status`

For more information:

- [Service Development Guide](/services/development) - Build Services
- [Service API Reference](/services/api) - Manifest schema
- [Troubleshooting Guide](/services/troubleshooting) - Fix issues
