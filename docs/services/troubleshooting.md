---
title: Service Troubleshooting Guide
summary: Common issues and solutions for OpenClaw Services
description: Diagnose and fix problems with Service installation, configuration, and execution
---

# Service Troubleshooting Guide

This guide helps you diagnose and fix common problems with OpenClaw Services.

## Quick Diagnostics

Start with these commands to understand the problem:

```bash
# Check Service status
openclaw service status <service-id>

# View recent logs
openclaw service logs <service-id> --lines 50

# Validate the manifest
openclaw service validate ./service.json

# Check requirements
openclaw service check <service-id>
```

## Installation Issues

### "Service already exists"

**Error:**

```
Error: Service 'my-service' already exists
```

**Causes:**

1. Service is already installed
2. Previous installation was partially removed
3. ID collision with another Service

**Solutions:**

```bash
# Check if Service exists
openclaw service list

# If exists but broken, uninstall and reinstall
openclaw service uninstall my-service
openclaw service install ./service.json

# Force uninstall if stuck
openclaw service uninstall my-service --force
```

### "Invalid manifest schema"

**Error:**

```
ValidationError: Invalid manifest schema
  - id: must match pattern "^[a-z0-9]+(?:-[a-z0-9]+)*$"
  - config.weatherLocation: missing required property "description"
```

**Causes:**

1. Invalid field values
2. Missing required fields
3. Type mismatches

**Solutions:**

1. Check the ID format:

```json
// Invalid
"id": "MyService"     // Contains uppercase
"id": "my_service"    // Contains underscore

// Valid
"id": "my-service"    // Kebab-case
```

2. Add missing descriptions:

```json
{
  "config": {
    "city": {
      "type": "string",
      "description": "City name for weather" // Required!
    }
  }
}
```

3. Validate JSON syntax:

```bash
# Check for syntax errors
cat service.json | python3 -m json.tool

# Or use jq
jq . service.json
```

### "Missing required skill: weather"

**Error:**

```
ValidationError: Required skill 'weather' is not available
```

**Causes:**

1. Skill not installed
2. Skill ID typo
3. Skill not enabled

**Solutions:**

```bash
# List available skills
openclaw skills list

# Install missing skill
openclaw skills install weather

# Check if skill is enabled
openclaw skills status weather

# Enable if needed
openclaw skills enable weather
```

If the skill is optional, update your manifest:

```json
{
  "requires": {
    "skills": [], // Remove from required
    "optionalSkills": ["weather"] // Add as optional
  }
}
```

### "Missing required tool: message.send"

**Error:**

```
ValidationError: Required tool 'message.send' is not registered
```

**Causes:**

1. Required extension not installed
2. Extension not loaded
3. Tool name typo

**Solutions:**

```bash
# List registered tools
openclaw tools list

# Check which extension provides the tool
openclaw tools info message.send

# Install missing extension
openclaw extensions install @openclaw/core-tools

# Reload extensions
openclaw extensions reload
```

### "Missing environment variable: API_KEY"

**Error:**

```
ValidationError: Required environment variable 'API_KEY' is not set
```

**Solutions:**

```bash
# Set the environment variable
export API_KEY="your-api-key-here"

# Add to ~/.openclaw/.env for persistence
echo "API_KEY=your-api-key-here" >> ~/.openclaw/.env

# Or make it optional in manifest
{
  "requires": {
    "env": []  // Remove from required
  }
}
```

### "Installation timeout"

**Error:**

```
Error: Installation timed out after 60000ms
```

**Causes:**

1. Slow network during skill download
2. Complex resource creation
3. Deadlock during setup

**Solutions:**

```bash
# Retry installation
openclaw service install ./service.json

# Check network connectivity
openclaw doctor --network

# Install with increased timeout
openclaw service install ./service.json --timeout 120000

# If stuck in "installing" state, force uninstall
openclaw service uninstall my-service --force
```

## Configuration Issues

### "Invalid configuration value"

**Error:**

```
ConfigError: Invalid value for 'city': must be at least 2 characters
```

**Causes:**

1. Value does not match schema constraints
2. Wrong type (string vs number)
3. Value outside allowed range

**Solutions:**

```bash
# Edit configuration interactively
openclaw service config my-service --interactive

# Set specific value
openclaw service config my-service --set city="New York"

# Reset to defaults
openclaw service config my-service --reset

# Validate configuration
openclaw service config my-service --validate
```

Check your schema constraints:

```json
{
  "config": {
    "city": {
      "type": "string",
      "minLength": 2, // Value must be at least 2 chars
      "maxLength": 100 // And at most 100 chars
    }
  }
}
```

### "Required field missing"

**Error:**

```
ConfigError: Missing required field: delivery.channel
```

**Solutions:**

```bash
# Set the missing value
openclaw service config my-service --set delivery.channel=slack

# Or use interactive mode
openclaw service config my-service --interactive
```

### "Secret not found"

**Error:**

```
ConfigError: Secret 'apiKey' not found in credential store
```

**Solutions:**

```bash
# Set the secret
openclaw service config my-service --set apiKey="secret-value" --secret

# Or set via environment
export MYSERVICE_APIKEY="secret-value"
```

## Trigger Issues

### "Cron trigger not firing"

**Symptom:** Service is enabled but does not run on schedule.

**Diagnosis:**

```bash
# Check Service state
openclaw service status my-service

# Check cron jobs
openclaw cron list

# Look for trigger errors
openclaw service logs my-service --since 24h | grep -i trigger
```

**Causes and Solutions:**

1. **Service is disabled:**

```bash
openclaw service enable my-service
```

2. **Invalid cron expression:**

```json
// Invalid - missing field
"schedule": "0 8 * *"       // Missing weekday

// Valid
"schedule": "0 8 * * *"     // All 5 fields
```

3. **Timezone issues:**

```json
// Use explicit timezone instead of auto
{
  "trigger": {
    "type": "cron",
    "schedule": "0 8 * * *",
    "timezone": "America/New_York"
  }
}
```

4. **Cron service not running:**

```bash
# Check if CronService is enabled
openclaw services list

# Enable if needed
openclaw services enable CronService
```

### "Webhook not receiving requests"

**Symptom:** External service sends webhooks but Service does not trigger.

**Diagnosis:**

```bash
# Check webhook registration
openclaw webhooks list

# View recent webhook attempts
openclaw webhooks logs --path /webhooks/my-service

# Check Service logs
openclaw service logs my-service --follow
```

**Causes and Solutions:**

1. **Wrong webhook path:**

Verify the configured path matches what external service uses:

```json
{
  "trigger": {
    "type": "webhook",
    "path": "/webhooks/github" // Must match exactly
  }
}
```

2. **Authentication failure:**

```bash
# Check webhook logs for 401 errors
openclaw webhooks logs --status 401

# Verify secret configuration
openclaw service config my-service --get webhookSecret
```

3. **Service not enabled:**

```bash
openclaw service enable my-service
```

4. **Firewall blocking:**

```bash
# Check if port is accessible
curl -X POST http://your-gateway:18789/webhooks/my-service

# Check gateway bind address
openclaw config get gateway.bind
```

### "Message trigger not responding"

**Symptom:** Service does not trigger on channel messages.

**Diagnosis:**

```bash
# Check message subscriptions
openclaw service status my-service --verbose

# Test message delivery
openclaw message send --channel slack --message "!test"

# Check channel configuration
openclaw config get channels.slack
```

**Causes and Solutions:**

1. **Filter too restrictive:**

```json
// Too specific - may never match
{
  "filters": {
    "keywords": ["!very-specific-command"],
    "fromUsers": ["U123456"]
  }
}

// More flexible
{
  "filters": {
    "patterns": ["^!\\w+"]  // Matches !command
  }
}
```

2. **Channel not configured:**

```bash
# Verify channel is set up
openclaw channels status slack

# Login if needed
openclaw channels login slack
```

3. **Service disabled:**

```bash
openclaw service enable my-service
```

## Execution Issues

### "Service execution failed"

**Error:**

```
ExecutionError: Service 'my-service' failed: Tool 'message.send' returned error
```

**Diagnosis:**

```bash
# View full error details
openclaw service logs my-service --lines 100

# Run manually to see output
openclaw service run my-service

# Run with verbose output
openclaw service run my-service --verbose
```

**Causes and Solutions:**

1. **Tool not available:**

```bash
# Check if tool is registered
openclaw tools list | grep message.send

# Install required extension
openclaw extensions install @openclaw/core-tools
```

2. **Invalid tool parameters:**

Review your skill's tool usage:

````markdown
## Steps

1. Send message using message.send:
   ```json
   {
     "channel": "slack", // Must be valid channel
     "target": "#general", // Must exist
     "message": "Hello!" // Required field
   }
   ```
````

````

3. **Missing configuration:**

```bash
# Verify config values
openclaw service config my-service --list

# Set missing values
openclaw service config my-service --set delivery.target="#general"
````

### "Service times out"

**Error:**

```
ExecutionError: Service execution timed out after 30000ms
```

**Solutions:**

1. **Increase timeout:**

```json
{
  "execution": {
    "timeout": 60000 // Increase to 60 seconds
  }
}
```

2. **Optimize skill logic:**

```markdown
## Steps

1. Fetch data with timeout awareness
2. Cache results when possible
3. Process in chunks if large
```

3. **Add retry logic:**

```json
{
  "execution": {
    "retryPolicy": {
      "maxRetries": 3,
      "backoff": "exponential"
    }
  }
}
```

### "Service stuck in 'running' state"

**Symptom:** Service shows as running but never completes.

**Solutions:**

```bash
# Check process status
openclaw service status my-service --verbose

# Kill stuck execution
openclaw service kill my-service

# Check for resource leaks
openclaw doctor --services

# Restart the service
openclaw service disable my-service
openclaw service enable my-service
```

## State Issues

### "Service stuck in 'error' state"

**Symptom:** Service shows error state and does not recover.

**Solutions:**

```bash
# View error details
openclaw service status my-service --verbose

# Check logs for root cause
openclaw service logs my-service --since 1h

# Reset state
openclaw service disable my-service
openclaw service enable my-service

# If persistent, reinstall
openclaw service uninstall my-service
openclaw service install ./service.json
```

### "Service state out of sync"

**Symptom:** Service shows as enabled but does not trigger.

**Solutions:**

```bash
# Refresh Service state
openclaw service refresh my-service

# Verify runtime refs
openclaw service status my-service --refs

# Reconcile state
openclaw service reconcile
```

## Performance Issues

### "Service runs slowly"

**Symptoms:**

- Long delay between trigger and execution
- Slow response to webhooks
- Timeout errors

**Diagnosis:**

```bash
# Check execution history
openclaw service logs my-service --since 24h | grep "execution time"

# Monitor resource usage
openclaw doctor --performance

# Check queue depth
openclaw queue status
```

**Solutions:**

1. **Reduce concurrent executions:**

```json
{
  "execution": {
    "sessionTarget": "isolated",
    "timeout": 30000
  }
}
```

2. **Optimize skill:**

- Cache API responses
- Batch operations
- Use async where possible

3. **Scale resources:**

```bash
# Check gateway resources
openclaw doctor --resources

# Increase if needed
openclaw config set gateway.workers=4
```

### "High memory usage"

**Symptom:** Service consumes excessive memory.

**Solutions:**

1. **Limit data retention:**

```markdown
## Steps

1. Fetch data
2. Process immediately
3. Clear variables when done
```

2. **Use streaming for large data:**

```markdown
## Steps

1. Stream large responses
2. Process chunks
3. Avoid loading everything into memory
```

3. **Restart periodically:**

```bash
# Schedule restart via cron
openclaw cron add --name "restart-my-service" \
  --schedule "0 4 * * *" \
  --command "openclaw service restart my-service"
```

## Security Issues

### "Privileged tool confirmation required"

**Error:**

```
SecurityError: Tool 'message.send' requires user confirmation
```

**Solutions:**

1. **Pre-approve the tool:**

```bash
# Approve for this Service
openclaw service approve my-service --tool message.send

# Or approve all privileged tools
openclaw service approve my-service --all
```

2. **Check capabilities declaration:**

```json
{
  "capabilities": {
    "privilegedTools": ["message.send"]
  }
}
```

### "Webhook signature invalid"

**Error:**

```
SecurityError: Webhook signature validation failed
```

**Solutions:**

1. **Verify secret:**

```bash
# Check configured secret
openclaw service config my-service --get webhookSecret

# Update if needed
openclaw service config my-service --set webhookSecret="correct-secret"
```

2. **Check header name:**

```json
{
  "trigger": {
    "type": "webhook",
    "auth": {
      "type": "signature",
      "header": "X-Hub-Signature-256" // Must match sender
    }
  }
}
```

3. **Test with valid signature:**

```bash
# Generate test webhook
curl -X POST \
  -H "X-Hub-Signature-256: sha256=..." \
  -d '{"test": true}' \
  http://gateway/webhooks/my-service
```

## Common Error Messages

### "Service not found"

```
Error: Service 'my-service' not found
```

**Solution:**

```bash
# List installed services
openclaw service list

# Check for typos in ID
# Install if missing
openclaw service install ./service.json
```

### "Circular dependency detected"

```
Error: Circular dependency detected: service-a → service-b → service-a
```

**Solution:** Review Service requirements and remove circular references.

### "Rate limit exceeded"

```
Error: Rate limit exceeded: 100 requests per minute
```

**Solution:**

```bash
# Check current rate limits
openclaw limits status

# Add rate limiting to config
{
  "config": {
    "rateLimitPerMinute": {
      "type": "number",
      "default": 60
    }
  }
}
```

### "Resource conflict"

```
Error: Resource conflict: webhook path '/webhooks/github' already in use
```

**Solution:**

```bash
# Check what Service owns the resource
openclaw webhooks list --path /webhooks/github

# Either change path in manifest or uninstall conflicting Service
```

## Debugging Tips

### Enable Debug Logging

```bash
# Set debug level
export OPENCLAW_LOG_LEVEL=debug

# Or configure in openclaw.json
{
  "logging": {
    "level": "debug",
    "services": true
  }
}
```

### Trace Service Execution

```bash
# Run with full tracing
openclaw service run my-service --trace

# Follow logs in real-time
openclaw service logs my-service --follow
```

### Test in Isolation

```bash
# Create test Service with different ID
cp service.json service-test.json
# Edit ID to "my-service-test"
openclaw service install ./service-test.json
openclaw service run my-service-test
```

### Validate Environment

```bash
# Run full diagnostics
openclaw doctor

# Check specific areas
openclaw doctor --services
openclaw doctor --channels
openclaw doctor --skills
```

## Getting Help

If you cannot resolve the issue:

1. **Collect diagnostic information:**

```bash
# Generate diagnostic report
openclaw doctor --report > diagnostic-report.txt

# Include Service logs
openclaw service logs my-service --since 24h >> diagnostic-report.txt

# Include manifest
cat service.json >> diagnostic-report.txt
```

2. **Check documentation:**

- [Service Development Guide](/services/development)
- [Service API Reference](/services/api)
- [Configuration Wizard](/services/configuration-wizard)

3. **Community support:**

- [Discord](https://discord.gg/clawd)
- [GitHub Issues](https://github.com/openclaw/openclaw/issues)
- [GitHub Discussions](https://github.com/openclaw/openclaw/discussions)

4. **Report bugs:**

Include:

- OpenClaw version: `openclaw --version`
- Service manifest (sanitized)
- Error messages
- Steps to reproduce
- Diagnostic report
