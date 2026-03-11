# Service 概念设计文档

## 1. 产品定位

### 核心定义

**Service** 是面向初级用户的"AI 小程序"——将 Skills、脚本、定时任务、Web UI 等能力封装成一个开箱即用的完整解决方案。

### 与现有概念的关系

```
┌─────────────────────────────────────────────────────────────┐
│                      SERVICE 小程序                          │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐            │
│  │   Skills   │  │   Scripts  │  │    Cron    │            │
│  │  (知识层)   │  │  (执行层)   │  │  (定时器)   │            │
│  └────────────┘  └────────────┘  └────────────┘            │
│                                                             │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐            │
│  │   Tools    │  │    Web UI  │  │   Config   │            │
│  │  (工具层)   │  │  (交互层)   │  │  (配置层)   │            │
│  └────────────┘  └────────────┘  └────────────┘            │
└─────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────┐
│                    Agent (智能体)                           │
│              协调所有能力，处理用户输入                        │
└─────────────────────────────────────────────────────────────┘
```

### 关键差异点

| 特性     | Skill             | Service               | Workflow (竞品) |
| -------- | ----------------- | --------------------- | --------------- |
| **粒度** | 单一能力          | 完整解决方案          | 流程定义        |
| **用户** | 所有用户          | 初级用户为主          | 中级用户        |
| **状态** | 无状态            | 可有状态              | 通常无状态      |
| **UI**   | 文本交互          | 可带 Web UI           | 可视化编排      |
| **触发** | 用户触发          | 多种触发器            | 事件触发        |
| **安装** | `clawhub install` | `serviceclaw install` | 平台内配置      |

## 2. 用户价值主张

### 目标用户画像

**小明，28岁，产品经理**

- 想用 AI 自动化一些日常任务
- 不想学编程，也不想研究怎么配置 cron
- 希望"安装就能用"

**痛点场景：**

1. 每天早上想了解天气和日程安排
2. 想自动整理微信群的重要信息
3. 希望定期备份某些数据

**传统方案 vs Service 方案：**

| 步骤 | 传统方案            | Service 方案      |
| ---- | ------------------- | ----------------- |
| 1    | 研究需要哪些 skills | 浏览 Service 市场 |
| 2    | 逐个安装 skills     | 一键安装          |
| 3    | 配置 cron job       | 自动配置          |
| 4    | 写 prompt 整合      | 预配置完成        |
| 5    | 调试测试            | 开箱即用          |
| 6    | 手动维护            | 自动更新          |

## 3. 典型使用场景

### 场景1：每日晨报 (Morning Briefing)

```yaml
service: morning-briefing
name: 每日晨报
description: 每天早上8点自动推送天气、日程、新闻摘要

components:
  skills:
    - weather
    - calendar
    - news-summary

  triggers:
    - type: cron
      schedule: "0 8 * * *"
      timezone: "Asia/Shanghai"

  workflow:
    steps:
      - name: 获取天气
        skill: weather
        params:
          location: "{{config.city}}"

      - name: 获取日程
        skill: calendar
        params:
          date: today

      - name: 生成简报
        llm:
          prompt: |
            生成晨报：
            天气：{{steps.weather.result}}
            日程：{{steps.calendar.events}}

      - name: 推送消息
        tool: message.send
        params:
          to: "{{config.target_channel}}"
          content: "{{steps.generate.result}}"
```

### 场景2：智能客服 (Smart Support)

```yaml
service: smart-support
name: 智能客服助手
description: 自动回复常见问题，复杂问题转人工

components:
  skills:
    - faq-knowledge
    - escalation

  triggers:
    - type: webhook
      path: "/support/incoming"

  web:
    enabled: true
    port: 8080
    pages:
      - dashboard
      - analytics

  workflow:
    on_message:
      - name: 查询知识库
        skill: faq-knowledge
        params:
          query: "{{input.message}}"

      - name: 判断是否需要转人工
        condition: "{{steps.faq.confidence < 0.7}}"

      - name: 自动回复
        if: "{{steps.faq.confidence >= 0.7}}"
        tool: message.reply
        params:
          content: "{{steps.faq.answer}}"

      - name: 转人工
        if: "{{steps.faq.confidence < 0.7}}"
        skill: escalation
        params:
          ticket: "{{input}}"
```

### 场景3：数据看板 (Data Dashboard)

```yaml
service: data-dashboard
name: 业务数据看板
description: 自动抓取数据并生成可视化看板

components:
  skills:
    - database-query
    - chart-generator

  triggers:
    - type: cron
      schedule: "0 */6 * * *" # 每6小时

  web:
    enabled: true
    pages:
      - dashboard:
          widgets:
            - chart: revenue
            - chart: users
            - table: orders

  scripts:
    - name: fetch-data
      file: scripts/fetch.js
      schedule: "0 */6 * * *"

    - name: generate-charts
      file: scripts/charts.py
      depends_on: fetch-data
```

## 4. 核心概念

### Service 定义

```typescript
interface Service {
  // 元数据
  metadata: {
    id: string; // 唯一标识
    name: string; // 显示名称
    version: string; // 语义化版本
    description: string; // 描述
    author: string; // 作者
    icon?: string; // 图标
    tags: string[]; // 标签
  };

  // 依赖声明
  dependencies: {
    skills: string[]; // 依赖的 skills
    tools: string[]; // 依赖的 tools
    services: string[]; // 依赖的其他 services
    bins: string[]; // 需要的二进制
  };

  // 配置定义
  config: {
    schema: TypeBoxSchema; // 配置项的 JSON Schema
    defaults: object; // 默认值
    ui?: ConfigUI; // 配置界面定义
  };

  // 组件定义
  components: {
    skills?: SkillRef[]; // 引用的 skills
    scripts?: ScriptRef[]; // 执行的脚本
    triggers?: Trigger[]; // 触发器
    web?: WebConfig; // Web UI 配置
    workflow?: Workflow; // 工作流定义
  };

  // 生命周期
  lifecycle: {
    install?: string; // 安装时执行
    uninstall?: string; // 卸载时执行
    start?: string; // 启动时执行
    stop?: string; // 停止时执行
    health?: string; // 健康检查
  };
}
```

### 触发器 (Trigger)

```typescript
type Trigger = CronTrigger | WebhookTrigger | MessageTrigger | EventTrigger | ManualTrigger;

interface CronTrigger {
  type: "cron";
  schedule: string; // cron 表达式
  timezone: string; // 时区
  enabled: boolean;
}

interface WebhookTrigger {
  type: "webhook";
  path: string; // URL 路径
  method: "GET" | "POST";
  auth?: AuthConfig; // 认证配置
}

interface MessageTrigger {
  type: "message";
  channels: string[]; // 监听的频道
  patterns: string[]; // 匹配的消息模式
}

interface EventTrigger {
  type: "event";
  source: string; // 事件源
  event: string; // 事件类型
}

interface ManualTrigger {
  type: "manual";
  command: string; // 触发的命令，如 /morning-briefing
}
```

### 工作流 (Workflow)

```typescript
interface Workflow {
  // 变量定义
  variables?: Record<string, VariableDef>;

  // 步骤定义
  steps: Step[];

  // 错误处理
  on_error?: ErrorHandler;
}

interface Step {
  id: string;
  name: string;

  // 执行类型
  action:
    | { type: "skill"; skill: string; params: object }
    | { type: "tool"; tool: string; params: object }
    | { type: "script"; script: string; params: object }
    | { type: "llm"; prompt: string; model?: string }
    | { type: "condition"; if: string; then: Step[]; else?: Step[] }
    | { type: "parallel"; steps: Step[] }
    | { type: "delay"; duration: string }
    | { type: "wait_for"; event: string; timeout?: string };

  // 条件执行
  condition?: string; // 条件表达式

  // 重试配置
  retry?: {
    max: number;
    delay: string;
    on_error?: string;
  };

  // 输出
  output?: string; // 将结果存入变量
}
```

## 5. 用户体验设计

### 安装流程 (极简)

```bash
# 1. 浏览服务市场
serviceclaw list

# 2. 查看详情
serviceclaw info morning-briefing

# 3. 一键安装
serviceclaw install morning-briefing

# 4. 交互式配置
? 选择城市: Beijing
? 推送渠道: WhatsApp
? 推送时间: 08:00
✅ 服务已配置完成！

# 5. 管理服务
serviceclaw status morning-briefing
serviceclaw start morning-briefing
serviceclaw logs morning-briefing
```

### 配置界面 (Web UI)

每个 Service 可以自带配置界面：

```typescript
interface ConfigUI {
  // 配置页面布局
  layout: {
    sections: Section[];
  };

  // 字段定义
  fields: Record<string, FieldDef>;
}

// 示例：天气服务配置界面
const configUI: ConfigUI = {
  layout: {
    sections: [
      {
        title: "基本信息",
        fields: ["city", "unit"],
      },
      {
        title: "推送设置",
        fields: ["channel", "time", "days"],
      },
    ],
  },
  fields: {
    city: {
      type: "select",
      label: "城市",
      options: ["Beijing", "Shanghai", "Guangzhou"],
      required: true,
    },
    unit: {
      type: "radio",
      label: "温度单位",
      options: [
        { value: "C", label: "摄氏度" },
        { value: "F", label: "华氏度" },
      ],
      default: "C",
    },
    channel: {
      type: "channel-select",
      label: "推送渠道",
      multi: true,
    },
    time: {
      type: "time",
      label: "推送时间",
      default: "08:00",
    },
  },
};
```

### 运行时界面

```
┌────────────────────────────────────────────────────────┐
│  Morning Briefing  |  每日晨报                          │
├────────────────────────────────────────────────────────┤
│  Status: 🟢 Running  |  Last run: 2 hours ago          │
├────────────────────────────────────────────────────────┤
│  今日运行记录                                          │
│  ├── 08:00 自动触发 ✓                                  │
│  │   ├── 获取天气 ✓                                    │
│  │   ├── 获取日程 ✓                                    │
│  │   └── 推送消息 ✓                                    │
│  └── 12:00 手动触发 ✓                                  │
│      └── 查询天气 ✓                                    │
├────────────────────────────────────────────────────────┤
│  [手动触发]  [查看配置]  [查看日志]  [停用]             │
└────────────────────────────────────────────────────────┘
```

## 6. 技术架构

### 系统架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                        User Interface                           │
│  CLI (serviceclaw)  |  Web Dashboard  |  Chat Commands         │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Service Manager                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐ │
│  │   Registry  │  │  Lifecycle  │  │      Scheduler          │ │
│  │  (服务注册)  │  │  (生命周期)  │  │     (调度执行)          │ │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Service Runtime                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐ │
│  │   Workflow  │  │    Web      │  │      State              │ │
│  │   Engine    │  │   Server    │  │    Manager              │ │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                   OpenClaw Platform                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐ │
│  │   Skills    │  │    Tools    │  │      Agent              │ │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

### 核心模块

1. **Service Registry**
   - 服务发现与元数据管理
   - 版本控制
   - 依赖解析

2. **Lifecycle Manager**
   - 安装/卸载
   - 启动/停止
   - 健康检查

3. **Scheduler**
   - Cron 任务调度
   - 事件监听
   - 触发器管理

4. **Workflow Engine**
   - 步骤执行
   - 状态管理
   - 错误处理

5. **Web Runtime**
   - 嵌入式 HTTP 服务器
   - 动态路由
   - UI 渲染

6. **State Manager**
   - 持久化存储
   - 状态同步
   - 配置管理

## 7. 与其他竞品的对比

| 特性          | Serviceclaw Service | Dify App | Coze Bot | n8n Workflow |
| ------------- | ------------------- | -------- | -------- | ------------ |
| **目标用户**  | 初级用户            | 中级用户 | 初级用户 | 高级用户     |
| **学习曲线**  | 极低                | 中等     | 低       | 较高         |
| **安装方式**  | 一键安装            | 配置部署 | 一键创建 | 自建/托管    |
| **本地优先**  | ✅ 是               | ⚠️ 可选  | ❌ 否    | ✅ 是        |
| **带 Web UI** | ✅ 可选             | ✅ 是    | ✅ 是    | ✅ 是        |
| **状态管理**  | ✅ 有               | ⚠️ 有限  | ⚠️ 有限  | ⚠️ 有限      |
| **离线运行**  | ✅ 支持             | ⚠️ 有限  | ❌ 否    | ✅ 支持      |
| **隐私控制**  | ✅ 完全本地         | ⚠️ 混合  | ❌ 云端  | ✅ 本地      |

**核心差异化：**

1. **本地优先** - 数据不出设备，隐私保护
2. **开箱即用** - 预配置完整方案，不是空白画布
3. **状态持久** - Service 可以有长期状态
4. **深度集成** - 与 OpenClaw 生态无缝集成

## 8. 市场可行性分析

### 目标市场

**TAM (Total Addressable Market)**

- 全球个人 AI 助手市场：预计 2025 年 $8B

**SAM (Serviceable Available Market)**

- 技术爱好者 + 效率工具用户：~50M 用户

**SOM (Serviceable Obtainable Market)**

- OpenClaw 现有用户 + 类似产品用户：~1M

### 竞争优势

1. **时机优势**
   - AI 应用爆发期
   - 用户对"傻瓜式"AI 需求强烈
   - 市场上缺乏本地优先方案

2. **技术优势**
   - 基于成熟的 OpenClaw 平台
   - 多通道集成（25+ 聊天渠道）
   - 本地 Gateway 架构

3. **生态优势**
   - 已有 Skills 生态可复用
   - 社区驱动发展
   - 开源可扩展

### 风险与挑战

1. **技术风险**
   - 状态管理复杂性
   - 多 Service 资源竞争
   - 升级兼容性

2. **市场风险**
   - 竞品快速跟进
   - 用户教育成本高
   - 商业模式不明确

3. **缓解措施**
   - MVP 快速验证
   - 社区共建生态
   - 聚焦差异化功能

## 9. 实施路线图

### Phase 1: MVP (2-3个月)

- Service 定义规范
- 基础生命周期管理
- 3个示例 Service
- CLI 工具

### Phase 2: Beta (2-3个月)

- Web UI 配置界面
- Workflow 引擎
- Service 市场
- 状态持久化

### Phase 3: GA (3-6个月)

- 性能优化
- 安全加固
- 开发者文档
- 社区运营

## 10. 下一步行动

### 立即行动

1. ✅ 完成设计文档（本文件）
2. 🔄 创建详细技术规范
3. ⏳ 实现 Service 核心框架
4. ⏳ 开发示例 Service

### 需要决策

1. Service 定义格式 (YAML vs JSON vs 其他)
2. 状态存储方案 (SQLite vs 文件 vs 其他)
3. Web UI 技术栈 (React vs Vue vs 原生)
4. 与 OpenClaw 的集成方式
