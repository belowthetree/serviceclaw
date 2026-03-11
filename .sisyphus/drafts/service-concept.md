# Draft: Service 概念设计

## OpenClaw 现有架构理解

### 核心概念

1. **Skills** - 技能（通过 SKILL.md 定义，位于 `skills/` 或 `~/.openclaw/skills/`）
   - 用 Markdown + YAML frontmatter 描述
   - 包含使用说明、触发条件、命令示例
   - 有 gating 机制（requires bins/env/config）
   - 可从 ClawHub 安装
2. **Tools** - 工具（代码实现，供 Agent 调用）
   - 类型化工具定义（TypeBox schemas）
   - 注册到 Tool Registry
   - 被 Agent 通过 function calling 调用
3. **Scripts** - 脚本（执行逻辑）
   - 在 Skills 中内嵌 bash 命令
   - 通过 exec tool 执行

### 当前痛点

- Skills 是独立的，没有组合能力
- 用户需要手动协调多个 skills
- 缺乏"服务"级别的抽象（比如：完整的"天气播报服务" = 天气查询 skill + TTS skill + 定时触发）

## Service 概念初步设想

### 核心价值主张

**"一键部署完整能力"** - 不只是安装一个技能，而是部署一整套解决方案

### 目标用户

- **初级用户**: 不想配置，只想"我要一个能早报天气的助手"
- **中级用户**: 需要组合多个能力，但不想手动协调
- **高级用户**: 想要创建可复用的服务模板

### 概念层级对比

| 层级     | 当前  | 新增                |
| -------- | ----- | ------------------- |
| 原子能力 | Skill | -                   |
| 组合能力 | -     | **Service**         |
| 执行单元 | Tool  | -                   |
| 编排逻辑 | -     | **Script/Workflow** |

### Service 定义（草案）

```yaml
name: morning-briefing-service
description: 每日晨报服务 - 天气 + 日程 + 新闻摘要
version: 1.0.0

dependencies:
  skills:
    - weather
    - calendar
    - news-summary
  tools:
    - tts
    - scheduler

workflow:
  trigger:
    type: cron
    schedule: "0 8 * * *" # 每天早上8点

  steps:
    - name: fetch-weather
      skill: weather
      input:
        location: "{{user.default_location}}"
      output: weather_data

    - name: fetch-calendar
      skill: calendar
      input:
        date: today
      output: events

    - name: generate-briefing
      llm:
        prompt: |
          根据以下信息生成晨报：
          天气：{{steps.fetch-weather.output}}
          日程：{{steps.fetch-calendar.output}}
        output: briefing_text

    - name: deliver
      tool: tts.speak
      input:
        text: "{{steps.generate-briefing.output}}"
        channel: "{{user.preferred_channel}}"
```

## 待讨论问题

1. **Service vs Skill**: Service 是 Skill 的扩展，还是独立的层级？
2. **编排语言**: 用 YAML/JSON 还是嵌入 DSL？
3. **状态管理**: Service 需要持久化状态吗？
4. ** marketplace**: Service 如何分发？ClawHub 支持？
5. **权限模型**: Service 的权限如何管理？
6. **调试体验**: 如何调试一个 Service？

## 竞品调研

- **n8n**: 工作流编排，但偏向自动化而非 AI
- **Zapier**: 类似，但商业化程度高
- **LangChain**: 有 Chain 概念，但偏编程
- **Dify**: 有 Workflow 概念，最接近
- **Coze/扣子**: Bot + 插件 + 工作流

## 下一步

需要与专家（Metis/Oracle）讨论：

1. 架构可行性
2. 与现有系统的兼容性
3. 用户体验设计
