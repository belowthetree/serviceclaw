# Webhook Receiver Skill

This skill enables the agent to receive, validate, and process HTTP webhooks from external services.

## Overview

The Webhook Receiver Service creates HTTP endpoints that external services can POST data to. The agent processes these webhooks by:

1. Validating webhook signatures (HMAC) for authenticity
2. Parsing incoming payload based on source type
3. Applying configured processing rules
4. Storing data or triggering notifications

## Capabilities

- Receive webhooks from GitHub, Slack, Stripe, Zapier, or custom sources
- Validate HMAC signatures to ensure webhook authenticity
- Parse JSON payloads from different sources
- Apply conditional processing rules
- Send notifications to configured channels
- Store payloads for later review

## Usage

When a webhook is received, the agent should:

1. **Parse the request** - Extract headers, body, and metadata
2. **Validate signature** (if configured) - Verify HMAC-SHA256 signature
3. **Process payload** - Parse based on source type (GitHub, Slack, etc.)
4. **Apply rules** - Check conditions and execute matching actions
5. **Send response** - Return HTTP 200 on success, 4xx/5xx on error

## Signature Validation

To validate a webhook signature using HMAC-SHA256:

```typescript
// Pseudo-code for signature validation
function validateSignature(payload: string, signature: string, secret: string): boolean {
  const expected = crypto.createHmac("sha256", secret).update(payload).digest("hex");

  // Support both hex and base64 encodings
  const sig = signature.replace(/^sha256=/, "");
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}
```

Common header names:

- GitHub: `X-Hub-Signature-256`
- Stripe: `Stripe-Signature`
- Slack: `X-Slack-Signature`
- Generic: `X-Webhook-Signature`

## Payload Parsing

### GitHub Webhook Format

```json
{
  "event": "push",
  "repository": {
    "name": "my-repo",
    "full_name": "owner/my-repo",
    "url": "https://github.com/owner/my-repo"
  },
  "pusher": {
    "name": "username",
    "email": "user@example.com"
  },
  "commits": [
    {
      "id": "abc123",
      "message": "Fix bug",
      "author": { "name": "User" }
    }
  ],
  "ref": "refs/heads/main"
}
```

### Slack Webhook Format

```json
{
  "token": "Jhj5dZrVaK7ZwHHjRyZWjbBk",
  "team_id": "T060RNRCH",
  "team_domain": "example",
  "channel_id": "C065W1189",
  "channel_name": "general",
  "user_id": "U065W1188",
  "user_name": "user",
  "command": "/command",
  "text": "help",
  "response_url": "https://hooks.slack.com/commands/T060RNRCH/..."
}
```

### Stripe Webhook Format

```json
{
  "id": "evt_1234567890",
  "object": "event",
  "api_version": "2023-10-16",
  "created": 1700000000,
  "type": "invoice.payment_succeeded",
  "data": {
    "object": {
      "id": "in_1234567890",
      "object": "invoice",
      "amount_due": 1000,
      "currency": "usd",
      "customer": "cus_1234567890"
    }
  }
}
```

### Generic Webhook Format

```json
{
  "event": "custom.event",
  "timestamp": "2024-01-15T10:30:00Z",
  "data": { ... }
}
```

## Processing Rules

Rules are evaluated in order. Each rule has:

- **name**: Human-readable rule name
- **condition**: JSONPath expression to match (empty = always match)
- **action**: What to do when condition matches
  - `notify`: Send notification to target channel
  - `store`: Store payload in database
  - `forward`: Forward to another URL
  - `script`: Execute custom script
- **target**: Destination for the action
- **template**: Message template with `{{variable}}` substitution

### Template Variables

Available variables for templates:

- `{{source}}` - Webhook source (github, slack, etc.)
- `{{timestamp}}` - ISO timestamp of receipt
- `{{hookId}}` - Webhook endpoint ID
- `{{event}}` - Event type from payload
- `{{payload}}` - Full payload (JSON string)

Example templates:

- `"Received {{event}} from {{source}}"`
- `"{{repository.full_name}}: {{commits[0].message}}"`

## Examples

### GitHub Push Notification

```yaml
Rule:
  name: GitHub Push
  condition: $.event == 'push'
  action: notify
  target: slack
  template: "Push to {{repository.full_name}} by {{pusher.name}}: {{commits[0].message}}"
```

### Stripe Payment Success

```yaml
Rule:
  name: Payment Received
  condition: $.type == 'invoice.payment_succeeded'
  action: notify
  target: main
  template: "Payment received: ${{data.object.amount_due}} {{data.object.currency}}"
```

### Store All Webhooks

```yaml
Rule:
  name: Archive
  condition: "" # Always match
  action: store
  target: webhook_logs
```

## Response Format

The service should respond with appropriate HTTP status codes:

- `200 OK` - Webhook processed successfully
- `400 Bad Request` - Invalid payload or missing required fields
- `401 Unauthorized` - Signature validation failed
- `429 Too Many Requests` - Rate limit exceeded
- `500 Internal Server Error` - Processing error

Response body (JSON):

```json
{
  "success": true,
  "message": "Webhook processed",
  "webhookId": "abc123",
  "timestamp": "2024-01-15T10:30:00Z"
}
```

## Security Considerations

1. **Always use HTTPS** for webhook endpoints in production
2. **Validate signatures** when available to prevent spoofing
3. **Rate limit** endpoints to prevent abuse
4. **Validate payload size** - reject oversized payloads
5. **Use secrets** - never commit webhook secrets to version control
6. **Verify IPs** - Some services publish IP ranges for webhooks

## Rate Limiting

Default rate limits:

- 60 requests per minute per endpoint
- 1000 requests per hour per endpoint
- Burst allowance: 10 requests

Rate limit headers:

```
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 59
X-RateLimit-Reset: 1705312800
```

## Error Handling

When processing fails:

1. Log the error with context
2. Return appropriate HTTP status code
3. Do NOT retry (webhook sender handles retries)
4. Store failed payloads for manual review if configured

## Configuration

Example service configuration:

```json
{
  "hookName": "My GitHub Webhook",
  "source": "github",
  "secret": "${env.GITHUB_WEBHOOK_SECRET}",
  "notifyOnReceive": true,
  "notificationChannel": "slack",
  "storePayloads": true,
  "rateLimitPerMinute": 60,
  "processingRules": [
    {
      "name": "Push Events",
      "condition": "$.event == 'push'",
      "action": "notify",
      "target": "slack",
      "template": "Push: {{repository.full_name}} - {{commits[0].message}}"
    }
  ]
}
```

## Testing Webhooks

Test your webhook endpoint:

```bash
# GitHub push event simulation
curl -X POST http://localhost:18789/webhooks/receiver/my-hook \
  -H "Content-Type: application/json" \
  -H "X-Hub-Signature-256: sha256=<signature>" \
  -d '{
    "event": "push",
    "repository": {"full_name": "test/repo"},
    "pusher": {"name": "testuser"},
    "commits": [{"message": "Test commit"}]
  }'
```

## Troubleshooting

**Webhook not received:**

- Check endpoint URL is correct
- Verify service is enabled
- Check firewall/network settings
- Review gateway logs

**Signature validation fails:**

- Verify secret is correct
- Check signature header name
- Ensure payload is not modified before validation
- Compare signature algorithms (hex vs base64)

**Payload not parsed correctly:**

- Verify source type matches actual payload
- Check Content-Type header
- Validate JSON format
- Review parsing errors in logs

## See Also

- Service manifest: `examples/webhook-receiver/service.json`
- OpenClaw Services: `docs/services/examples.md`
- Gateway webhooks: `docs/automation/webhook.md`
