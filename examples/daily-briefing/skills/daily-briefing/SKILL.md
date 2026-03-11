---
name: daily-briefing
description: "Generate and deliver a personalized daily morning briefing with weather, calendar events, news, and tasks. Triggered automatically at 8am daily or on-demand."
metadata:
  {
    "openclaw":
      {
        "emoji": "📰",
        "requires": { "skills": ["weather"], "tools": ["message.send", "web_fetch"] },
      },
  }
---

# Daily Briefing Service

Generate and deliver a comprehensive morning briefing combining weather, calendar events, news, and tasks.

## When Triggered

This service runs automatically at 8:00 AM daily (configurable). It can also be triggered manually.

## Steps to Generate Briefing

### 1. Fetch Weather

Get current weather and today's forecast for the configured location:

```bash
# Use the weather skill to get current conditions
curl -s "wttr.in/{weatherLocation}?format=3"

# Get detailed forecast
curl -s "wttr.in/{weatherLocation}?0"
```

### 2. Fetch Calendar Events

Retrieve today's events from configured calendars:

- Use the `gog` skill if available (Google Calendar)
- Or query local calendar via system commands
- Format: List events with time, title, and location

### 3. Fetch News

Get headlines from configured news sources:

```bash
# Fetch from RSS feeds or news APIs
# Example for Hacker News (tech)
curl -s "https://hnrss.org/frontpage?points=100&count=5"

# Example for general news (use web_fetch tool)
# Fetch from configured newsSources
```

### 4. Fetch Tasks (Optional)

If task sources are configured:

- **Apple Reminders**: Use `apple-reminders` skill
- **Things**: Use `things-mac` skill
- **Todoist**: Query via API

### 5. Generate Summary

Combine all information into a friendly briefing:

**Concise format:**

```
Good morning! 🌅

🌤️ Weather: {weather summary}
📅 Today: {calendar count} events
📰 Top story: {headline}
✅ Tasks: {task count} remaining

Have a great day!
```

**Bullet-points format (default):**

```
📰 Daily Briefing - {date}

🌤️ Weather in {location}:
   • {condition}, {temp}
   • {forecast}

📅 Calendar ({count} events):
   • {time} - {event title}
   • ...

📰 News ({source}):
   • {headline}
   • ...

✅ Tasks ({count}):
   • {task}
   • ...
```

**Detailed format:**

- Full weather report with hourly forecast
- Complete calendar with descriptions
- News summaries with article excerpts
- Full task list with priorities

### 6. Deliver Briefing

Send via configured channel using `message.send`:

```javascript
// Use message.send tool with:
{
  "channel": "{delivery.channel}",
  "target": "{delivery.target}",
  "message": "{generated briefing}"
}
```

## Configuration

The service reads these config values:

| Config Key         | Description      | Example               |
| ------------------ | ---------------- | --------------------- |
| `weatherLocation`  | City for weather | `"San Francisco"`     |
| `newsSources`      | News categories  | `["tech", "science"]` |
| `calendarIds`      | Calendar sources | `["primary", "work"]` |
| `taskSources`      | Task apps        | `["apple-reminders"]` |
| `delivery.channel` | Where to send    | `"slack"`             |
| `delivery.target`  | Channel/DM ID    | `"#general"`          |
| `format`           | Briefing style   | `"bullet-points"`     |

## Example Briefing

```
📰 Daily Briefing - Monday, March 10, 2026

🌤️ Weather in San Francisco:
   • Partly cloudy, 18°C (64°F)
   • Light breeze, 10% chance of rain

📅 Calendar (3 events):
   • 9:00 AM - Team standup
   • 2:00 PM - Product review
   • 4:30 PM - 1:1 with manager

📰 News (Tech):
   • OpenClaw releases new service feature
   • AI assistant space continues to evolve
   • New developer tools announced

✅ Tasks (2 remaining):
   • Review quarterly goals
   • Prepare presentation slides
```

## Error Handling

If a data source fails:

1. Log the error
2. Continue with available data
3. Add note in briefing about missing sections
4. Deliver partial briefing

## Notes

- Keep briefing under 500 words for readability
- Use emojis for visual organization
- Respect user's timezone
- Cache data briefly to avoid duplicate API calls
- Handle gracefully when optional sources unavailable
