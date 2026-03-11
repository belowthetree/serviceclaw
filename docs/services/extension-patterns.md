# OpenClaw Extension/Plugin Patterns

This document analyzes how extensions integrate with OpenClaw and documents patterns for tools, skills, lifecycle hooks, and configuration.

## Overview

OpenClaw uses a plugin-based architecture where extensions can register:

- **Tools** - Agent-callable functions
- **Channels** - Messaging platform integrations
- **Skills** - Documentation and prompt templates
- **Lifecycle Hooks** - Event interception points
- **HTTP Routes** - Webhook endpoints
- **CLI Commands** - Custom slash commands
- **Services** - Background processes

## Extension Structure

### Directory Layout

```
extensions/<name>/
├── package.json           # NPM package manifest with openclaw.extensions entry
├── openclaw.plugin.json   # Plugin manifest (id, configSchema, skills)
├── index.ts              # Main entry point - exports register function
├── src/                  # Source code
│   ├── <feature>-tool.ts # Tool implementations
│   ├── channel.ts        # Channel plugin implementation
│   └── ...
├── skills/               # Optional skill documentation
│   └── <skill>/
│       └── SKILL.md
└── README.md
```

### Package.json Configuration

Extensions declare themselves via the `openclaw.extensions` field:

```json
{
  "name": "@openclaw/lobster",
  "type": "module",
  "openclaw": {
    "extensions": ["./index.ts"]
  }
}
```

For channel extensions, additional metadata is provided:

```json
{
  "openclaw": {
    "extensions": ["./index.ts"],
    "channel": {
      "id": "bluebubbles",
      "label": "BlueBubbles",
      "selectionLabel": "BlueBubbles (macOS app)",
      "docsPath": "/channels/bluebubbles",
      "aliases": ["bb"],
      "preferOver": ["imessage"],
      "order": 75
    }
  }
}
```

### Plugin Manifest (openclaw.plugin.json)

Required for all extensions:

```json
{
  "id": "lobster",
  "name": "Lobster",
  "description": "Typed workflow tool with resumable approvals.",
  "configSchema": {
    "type": "object",
    "additionalProperties": false,
    "properties": {}
  }
}
```

For extensions with skills:

```json
{
  "id": "open-prose",
  "name": "OpenProse",
  "skills": ["./skills"],
  "configSchema": { ... }
}
```

## Pattern 1: Tool-Only Extension

**Example:** `extensions/llm-task/`

Simplest pattern - registers one or more tools with the agent.

### Entry Point (index.ts)

```typescript
import type { AnyAgentTool, OpenClawPluginApi } from "openclaw/plugin-sdk/llm-task";
import { createLlmTaskTool } from "./src/llm-task-tool.js";

export default function register(api: OpenClawPluginApi) {
  api.registerTool(createLlmTaskTool(api) as unknown as AnyAgentTool, { optional: true });
}
```

### Tool Factory Function

```typescript
import { Type } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/llm-task";

export function createLlmTaskTool(api: OpenClawPluginApi) {
  return {
    name: "llm-task",
    label: "LLM Task",
    description: "Run a generic JSON-only LLM task...",
    parameters: Type.Object({
      prompt: Type.String({ description: "Task instruction for the LLM." }),
      input: Type.Optional(Type.Unknown({ description: "Optional input payload." })),
      // ... more parameters
    }),

    async execute(_id: string, params: Record<string, unknown>) {
      // Access plugin config
      const pluginCfg = (api.pluginConfig ?? {}) as PluginCfg;

      // Access global config
      const defaultsModel = api.config?.agents?.defaults?.model;

      // Implementation...

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        details: { json: result, provider, model },
      };
    },
  };
}
```

### Optional Tool Pattern

Tools marked as `optional: true` require explicit allowlisting:

```typescript
export default function register(api: OpenClawPluginApi) {
  api.registerTool(
    ((ctx) => {
      // Conditionally return null to disable tool
      if (ctx.sandboxed) {
        return null;
      }
      return createLobsterTool(api) as AnyAgentTool;
    }) as OpenClawPluginToolFactory,
    { optional: true },
  );
}
```

Enable in agent configuration:

```json
{
  "agents": {
    "list": [
      {
        "id": "main",
        "tools": { "allow": ["lobster"] }
      }
    ]
  }
}
```

## Pattern 2: Channel Extension

**Example:** `extensions/bluebubbles/`

Channel extensions integrate messaging platforms (WhatsApp, Telegram, etc.).

### Entry Point

```typescript
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/bluebubbles";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk/bluebubbles";
import { bluebubblesPlugin } from "./src/channel.js";
import { setBlueBubblesRuntime } from "./src/runtime.js";

const plugin = {
  id: "bluebubbles",
  name: "BlueBubbles",
  description: "BlueBubbles channel plugin (macOS app)",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    setBlueBubblesRuntime(api.runtime);
    api.registerChannel({ plugin: bluebubblesPlugin });
  },
};

export default plugin;
```

### Channel Plugin Structure

```typescript
export const bluebubblesPlugin: ChannelPlugin<ResolvedBlueBubblesAccount> = {
  id: "bluebubbles",
  meta: {
    id: "bluebubbles",
    label: "BlueBubbles",
    selectionLabel: "BlueBubbles (macOS app)",
    docsPath: "/channels/bluebubbles",
    aliases: ["bb"],
    order: 75,
    preferOver: ["imessage"],
  },

  capabilities: {
    chatTypes: ["direct", "group"],
    media: true,
    reactions: true,
    edit: true,
    unsend: true,
    reply: true,
    effects: true,
    groupManagement: true,
  },

  // Config management
  configSchema: buildChannelConfigSchema(BlueBubblesConfigSchema),
  reload: { configPrefixes: ["channels.bluebubbles"] },

  // Account lifecycle
  config: {
    listAccountIds: (cfg) => listBlueBubblesAccountIds(cfg),
    resolveAccount: (cfg, accountId) => resolveBlueBubblesAccount({ cfg, accountId }),
    defaultAccountId: (cfg) => resolveDefaultBlueBubblesAccountId(cfg),
    setAccountEnabled: ({ cfg, accountId, enabled }) => {
      /* ... */
    },
    deleteAccount: ({ cfg, accountId }) => {
      /* ... */
    },
    isConfigured: (account) => account.configured,
    describeAccount: (account): ChannelAccountSnapshot => ({
      /* ... */
    }),
    resolveAllowFrom: ({ cfg, accountId }) => {
      /* ... */
    },
    formatAllowFrom: ({ allowFrom }) => {
      /* ... */
    },
  },

  // Outbound messaging
  outbound: {
    deliveryMode: "direct",
    textChunkLimit: 4000,
    resolveTarget: ({ to }) => {
      /* ... */
    },
    sendText: async ({ cfg, to, text, accountId, replyToId }) => {
      /* ... */
    },
    sendMedia: async (ctx) => {
      /* ... */
    },
  },

  // Gateway lifecycle
  gateway: {
    startAccount: async (ctx) => {
      return monitorBlueBubblesProvider({
        account,
        config: ctx.cfg,
        runtime: ctx.runtime,
        abortSignal: ctx.abortSignal,
        statusSink,
        webhookPath,
      });
    },
  },

  // Security/pairing
  security: {
    resolveDmPolicy: ({ cfg, accountId, account }) => {
      /* ... */
    },
    collectWarnings: ({ account }) => {
      /* ... */
    },
  },

  pairing: {
    idLabel: "bluebubblesSenderId",
    normalizeAllowEntry: (entry) => {
      /* ... */
    },
    notifyApproval: async ({ cfg, id }) => {
      /* ... */
    },
  },

  // Onboarding/setup
  setup: {
    resolveAccountId: ({ accountId }) => normalizeAccountId(accountId),
    applyAccountName: ({ cfg, accountId, name }) => {
      /* ... */
    },
    validateInput: ({ input }) => {
      /* ... */
    },
    applyAccountConfig: ({ cfg, accountId, input }) => {
      /* ... */
    },
  },

  // Status/health checks
  status: {
    defaultRuntime: {
      /* ... */
    },
    collectStatusIssues: collectBlueBubblesStatusIssues,
    buildChannelSummary: ({ snapshot }) => {
      /* ... */
    },
    probeAccount: async ({ account, timeoutMs }) => {
      /* ... */
    },
    buildAccountSnapshot: ({ account, runtime, probe }) => {
      /* ... */
    },
  },
};
```

### Runtime Storage Pattern

Extensions can use a runtime store for cross-module state:

```typescript
import { createPluginRuntimeStore } from "openclaw/plugin-sdk/compat";

const runtimeStore = createPluginRuntimeStore<PluginRuntime>("BlueBubbles runtime not initialized");

export const setBlueBubblesRuntime = runtimeStore.setRuntime;
export const getBlueBubblesRuntime = runtimeStore.getRuntime;
export const tryGetBlueBubblesRuntime = runtimeStore.tryGetRuntime;
```

## Pattern 3: Complex Optional Extension

**Example:** `extensions/lobster/`

Combines optional tool registration with conditional logic and sandbox awareness.

```typescript
export default function register(api: OpenClawPluginApi) {
  api.registerTool(
    ((ctx) => {
      // Don't register in sandboxed environments
      if (ctx.sandboxed) {
        return null;
      }
      return createLobsterTool(api) as AnyAgentTool;
    }) as OpenClawPluginToolFactory,
    { optional: true }, // Requires explicit allowlisting
  );
}
```

### Tool Factory with Context

The factory receives context about the execution environment:

```typescript
export type OpenClawPluginToolContext = {
  config?: OpenClawConfig;
  workspaceDir?: string;
  agentDir?: string;
  agentId?: string;
  sessionKey?: string;
  sessionId?: string;
  messageChannel?: string;
  agentAccountId?: string;
  requesterSenderId?: string;
  senderIsOwner?: boolean;
  sandboxed?: boolean;
};
```

## Pattern 4: Skill Provider Extension

**Example:** `extensions/open-prose/`, `extensions/lobster/`

Extensions can bundle skills (documentation/templates) for agents.

### Plugin Manifest with Skills

```json
{
  "id": "open-prose",
  "name": "OpenProse",
  "skills": ["./skills"],
  "configSchema": { ... }
}
```

### SKILL.md Format

````markdown
# Skill Name

Description of when to use this skill.

## When to use

| User intent | Use this?          |
| ----------- | ------------------ |
| "Do X"      | Yes - reason       |
| "Do Y"      | No - use Z instead |

## Usage

### Example

```json
{
  "action": "run",
  "pipeline": "..."
}
```
````

## Key behaviors

- Bullet points about behavior

````

Skills are automatically discovered and loaded by the plugin system via `resolvePluginSkillDirs()` in `src/agents/skills/plugin-skills.ts`.

## Lifecycle Hooks

Extensions can register hooks for various lifecycle events:

```typescript
api.on("before_prompt_build", (event, ctx) => {
  return {
    prependContext: "Additional context...",
  };
});

api.on("before_tool_call", (event, ctx) => {
  if (shouldBlock(event.toolName)) {
    return { block: true, blockReason: "..." };
  }
  return { params: modifiedParams };
});
````

### Available Hooks

| Hook                   | Event                      | Context         |
| ---------------------- | -------------------------- | --------------- |
| `before_model_resolve` | Before model selection     | Agent context   |
| `before_prompt_build`  | Before prompt construction | Agent context   |
| `before_agent_start`   | Before agent execution     | Agent context   |
| `llm_input`            | LLM input prepared         | Agent context   |
| `llm_output`           | LLM output received        | Agent context   |
| `agent_end`            | Agent execution complete   | Agent context   |
| `before_tool_call`     | Before tool execution      | Tool context    |
| `after_tool_call`      | After tool execution       | Tool context    |
| `message_received`     | Inbound message received   | Message context |
| `message_sending`      | Outbound message sending   | Message context |
| `session_start`        | Session started            | Session context |
| `session_end`          | Session ended              | Session context |
| `gateway_start`        | Gateway started            | Gateway context |
| `gateway_stop`         | Gateway stopping           | Gateway context |

## Configuration Patterns

### Extension Config via `openclaw.plugin.json`

```json
{
  "id": "my-extension",
  "configSchema": {
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "apiKey": { "type": "string" },
      "timeoutMs": { "type": "number", "default": 30000 }
    }
  }
}
```

### User Configuration

```json
{
  "plugins": {
    "entries": {
      "my-extension": {
        "enabled": true,
        "config": {
          "apiKey": "secret",
          "timeoutMs": 60000
        }
      }
    }
  }
}
```

### Accessing Config in Extension

```typescript
export function createMyTool(api: OpenClawPluginApi) {
  const pluginConfig = (api.pluginConfig ?? {}) as MyConfig;
  const globalConfig = api.config;

  return {
    name: "my-tool",
    async execute(_id: string, params: Record<string, unknown>) {
      const timeout = pluginConfig.timeoutMs ?? 30000;
      // ...
    },
  };
}
```

## Registration API Reference

The `OpenClawPluginApi` interface provides these registration methods:

```typescript
type OpenClawPluginApi = {
  // Identity
  id: string;
  name: string;
  version?: string;
  source: string;

  // Configuration
  config: OpenClawConfig;
  pluginConfig?: Record<string, unknown>;

  // Runtime
  runtime: PluginRuntime;
  logger: PluginLogger;

  // Registration methods
  registerTool: (
    tool: AnyAgentTool | OpenClawPluginToolFactory,
    opts?: OpenClawPluginToolOptions,
  ) => void;
  registerChannel: (registration: OpenClawPluginChannelRegistration | ChannelPlugin) => void;
  registerProvider: (provider: ProviderPlugin) => void;
  registerGatewayMethod: (method: string, handler: GatewayRequestHandler) => void;
  registerHttpRoute: (params: OpenClawPluginHttpRouteParams) => void;
  registerCli: (registrar: OpenClawPluginCliRegistrar, opts?: { commands?: string[] }) => void;
  registerService: (service: OpenClawPluginService) => void;
  registerCommand: (command: OpenClawPluginCommandDefinition) => void;
  registerHook: (
    events: string | string[],
    handler: InternalHookHandler,
    opts?: OpenClawPluginHookOptions,
  ) => void;
  registerContextEngine: (id: string, factory: ContextEngineFactory) => void;

  // Lifecycle hooks (typed)
  on: <K extends PluginHookName>(
    hookName: K,
    handler: PluginHookHandlerMap[K],
    opts?: { priority?: number },
  ) => void;

  // Utilities
  resolvePath: (input: string) => string;
};
```

## Recommendations for Service Implementation

Based on the analyzed patterns, Services should follow these conventions:

### 1. Extension Structure

```
extensions/<service-name>/
├── package.json
├── openclaw.plugin.json      # Define id, configSchema, optional: skills
├── index.ts                  # Export register function
├── src/
│   ├── service.ts            # Main service implementation
│   ├── <service>-tool.ts     # Optional tool(s)
│   └── runtime.ts            # Optional runtime store
└── skills/
    └── <service>/
        └── SKILL.md          # Optional skill documentation
```

### 2. Entry Point Pattern

```typescript
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/<service>";
import { createServiceRuntime } from "./src/runtime.js";
import { createServiceTool } from "./src/service-tool.js";

export default function register(api: OpenClawPluginApi) {
  // Initialize runtime for cross-module access
  createServiceRuntime(api.runtime);

  // Register optional tool(s)
  api.registerTool(
    (ctx) => {
      // Skip in sandboxed contexts if needed
      if (ctx.sandboxed) return null;
      return createServiceTool(api);
    },
    { optional: true },
  );

  // Register lifecycle hooks if needed
  api.on("gateway_start", async (event, ctx) => {
    // Initialize service on gateway start
  });

  api.on("gateway_stop", async (event, ctx) => {
    // Cleanup on gateway stop
  });
}
```

### 3. Tool Factory Pattern

```typescript
import { Type } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/<service>";

export function createServiceTool(api: OpenClawPluginApi) {
  const config = (api.pluginConfig ?? {}) as ServiceConfig;

  return {
    name: "<service>",
    label: "Service Label",
    description: "What this tool does...",

    parameters: Type.Object({
      action: Type.String({ enum: ["action1", "action2"] }),
      // ... more params
    }),

    async execute(_id: string, params: Record<string, unknown>) {
      // Validate params
      const action = params.action as string;

      // Access config
      const timeout = config.timeoutMs ?? 30000;

      // Execute
      const result = await doSomething(params);

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        details: result,
      };
    },
  };
}
```

### 4. Plugin Manifest

```json
{
  "id": "<service>",
  "name": "Service Name",
  "description": "Brief description of the service.",
  "configSchema": {
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "endpoint": {
        "type": "string",
        "description": "Service endpoint URL"
      },
      "timeoutMs": {
        "type": "number",
        "default": 30000
      }
    }
  }
}
```

### 5. Enable Configuration

Users enable the service in their OpenClaw config:

```json
{
  "plugins": {
    "entries": {
      "<service>": {
        "enabled": true,
        "config": {
          "endpoint": "https://api.example.com",
          "timeoutMs": 60000
        }
      }
    }
  },
  "agents": {
    "list": [
      {
        "id": "main",
        "tools": { "allow": ["<service>"] }
      }
    ]
  }
}
```

## Key Takeaways

1. **Optional Tools**: Use `optional: true` for tools that require explicit opt-in via agent allowlists
2. **Context Awareness**: Tool factories receive context (sandboxed, session, config) to make registration decisions
3. **Type Safety**: Use `@sinclair/typebox` for parameter schemas
4. **Config Access**: Use `api.pluginConfig` for extension-specific config, `api.config` for global config
5. **Runtime Storage**: Use `createPluginRuntimeStore()` for cross-module state in channel extensions
6. **Skills**: Bundle SKILL.md files for agent guidance on when/how to use the extension
7. **Lifecycle**: Use `api.on()` for typed hooks or `api.registerHook()` for legacy event hooks
8. **SDK Imports**: Import from `openclaw/plugin-sdk/<name>` - the build system handles resolution
