# Task 3 Evidence: Extension/Plugin Patterns Analysis

## Task Summary

Analyzed OpenClaw's extension/plugin architecture to document patterns for Service implementation.

## Files Analyzed

### Extension Examples

1. **extensions/lobster/** - Complex optional tool extension
   - Entry: `index.ts` - Shows factory pattern with sandbox check
   - Tool: `src/lobster-tool.ts` - Full tool implementation
   - Manifest: `openclaw.plugin.json` - Plugin metadata
   - Skill: `SKILL.md` - Agent guidance documentation

2. **extensions/llm-task/** - Tool-only extension
   - Entry: `index.ts` - Simple tool registration
   - Tool: `src/llm-task-tool.ts` - JSON-only LLM task tool

3. **extensions/bluebubbles/** - Channel extension
   - Entry: `index.ts` - Channel registration
   - Channel: `src/channel.ts` - Full ChannelPlugin implementation
   - Runtime: `src/runtime.ts` - Runtime storage pattern

4. **extensions/open-prose/** - Skill provider
   - Manifest: `openclaw.plugin.json` - Shows `skills` array
   - Skills: `skills/prose/SKILL.md` - Skill documentation

### Core System Files

5. **src/plugins/types.ts** - Plugin API types
   - OpenClawPluginApi interface
   - Hook types and handler maps
   - Tool factory context

6. **src/plugins/registry.ts** - Plugin registration system
   - Tool registration
   - Channel registration
   - Hook registration

7. **src/plugins/tools.ts** - Tool resolution
   - Optional tool filtering
   - Allowlist processing

8. **src/plugins/loader.ts** - Plugin loading
   - Jiti-based loading
   - SDK alias resolution
   - Config validation

9. **src/agents/skills/plugin-skills.ts** - Skill loading
   - resolvePluginSkillDirs()
   - Plugin skill discovery

10. **src/plugin-sdk/core.ts** - SDK exports
    - Type exports
    - Utility functions

## Key Patterns Identified

### 1. Extension Registration Flow

```
package.json (openclaw.extensions)
    ↓
openclaw.plugin.json (manifest)
    ↓
index.ts (register function)
    ↓
api.registerTool() / api.registerChannel() / etc.
```

### 2. Optional Tool Pattern

- Tools marked `optional: true`
- Require explicit allowlist in agent config
- Factory function receives context to conditionally return null

### 3. Channel Extension Pattern

- Complex ChannelPlugin interface
- Capabilities declaration
- Account lifecycle management
- Outbound messaging
- Security/pairing hooks

### 4. Skill Bundle Pattern

- Declare in `openclaw.plugin.json`: `"skills": ["./skills"]`
- SKILL.md files in skills directories
- Auto-discovered by `resolvePluginSkillDirs()`

### 5. Lifecycle Hooks

- Typed hooks via `api.on(hookName, handler)`
- 25+ hook points (before_prompt_build, before_tool_call, etc.)
- Can modify behavior, block actions, inject context

## Recommendations Documented

See `docs/services/extension-patterns.md` for:

- Full pattern documentation with code examples
- Extension structure recommendations
- Tool factory patterns
- Configuration patterns
- SDK API reference

## Verification

- [x] Analyzed 3+ extension examples (lobster, llm-task, bluebubbles)
- [x] Documented tool registration patterns
- [x] Documented skill provision patterns
- [x] Documented lifecycle hooks
- [x] Documented configuration patterns
- [x] Provided code examples for each pattern
- [x] Created recommendations for Service implementation
- [x] Output written to `docs/services/extension-patterns.md`
