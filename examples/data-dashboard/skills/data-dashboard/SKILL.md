---
name: data-dashboard
description: "Serve a real-time web dashboard with configurable widgets for weather, tasks, calendar events, and system metrics. Accessible via web browser."
metadata:
  openclaw:
    emoji: "📊"
    requires:
      skills: ["weather"]
      tools: ["web_fetch"]
---

# Data Dashboard Service

Serve a beautiful, real-time web dashboard displaying configurable widgets with live data.

## Dashboard URL

Once enabled, access the dashboard at:

```
http://localhost:18789/dashboard/data
```

## Available Widgets

### Clock Widget

- Displays current time and date
- Updates every second
- Configurable timezone

### Weather Widget

- Current weather conditions
- Location-based forecast
- Requires `weatherLocation` config

### Tasks Widget

- Lists pending tasks from integrated sources
- Shows task count and priorities
- Supports Apple Reminders, Things, Todoist

### Calendar Widget

- Today's events from configured calendars
- Shows next 5 upcoming events
- Time until each event

### System Widget

- Gateway status
- CPU/memory usage (if available)
- Connected channels

## Widget Configuration

Each widget can be configured with:

- `title`: Display title
- `refreshInterval`: Update frequency (seconds)
- `config`: Widget-specific settings

## Auto-Refresh

Dashboard automatically refreshes data based on `refreshInterval` setting (default: 60 seconds).

## Mobile Responsive

Dashboard is optimized for both desktop and mobile viewing.

## Data Sources

Widgets fetch data from:

- Weather skill/API
- Task management integrations
- Calendar integrations
- System metrics (if available)

## Actions

When user views dashboard:

1. Load widget configurations
2. Fetch initial data for all widgets
3. Start auto-refresh timer
4. Serve HTML dashboard with live data

## Security

- Dashboard inherits Gateway authentication
- No privileged tools required
- Read-only data display
