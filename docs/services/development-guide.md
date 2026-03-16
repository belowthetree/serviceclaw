# OpenClaw Service 开发完整指南

> 从零开始开发 OpenClaw 服务，包含架构设计、开发流程和独立调试方法。

---

## 📑 目录

1. [Service 基础概念](#service-基础概念)
2. [架构与通信模型](#架构与通信模型)
3. [目录结构规范](#目录结构规范)
4. [Manifest 配置](#manifest-配置)
5. [Service 脚本开发](#service-脚本开发)
6. [UI 前端开发](#ui-前端开发)
7. [独立调试方法（重点）](#独立调试方法重点)
8. [部署与发布](#部署与发布)
9. [SCP 协议指南](#scp-协议指南)
10. [最佳实践](#最佳实践)
11. [故障排除](#故障排除)

---

## Service 基础概念

### 什么是 Service？

Service 是 OpenClaw 中的**长期运行组件**，具备以下能力：

| 能力           | 说明                                    |
| -------------- | --------------------------------------- |
| **自定义 UI**  | 通过 WebView 模态框提供交互界面         |
| **双向通信**   | 与 Agent 通过 SCP 协议（WebSocket）通信 |
| **后台任务**   | 执行定时任务（Cron）或持久化操作        |
| **事件监听**   | 监听 webhook 或订阅消息频道             |
| **数据持久化** | 使用本地存储或数据库                    |

### Service vs Skill

| 特性     | Service             | Skill                |
| -------- | ------------------- | -------------------- |
| 运行时长 | 长期运行（进程）    | 短期执行（函数调用） |
| UI       | 有独立模态框        | 无独立 UI            |
| 通信方式 | 双向 WebSocket      | 单向请求-响应        |
| 触发方式 | 用户启动/定时/事件  | 工具调用             |
| 生命周期 | 有状态（启用/禁用） | 无状态               |

### 适用场景

- ✅ **配置向导** - 带表单的多步骤配置界面
- ✅ **监控面板** - 实时数据显示（天气、股票、系统状态）
- ✅ **定时任务** - 定时检查并发送通知
- ✅ **数据管理** - 任务、笔记、书签等持久化数据
- ✅ **Webhook 处理** - 接收外部 HTTP 回调

---

## 架构与通信模型

### 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│                      OpenClaw 架构                          │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────┐     ┌──────────────┐     ┌────────────┐  │
│  │   User UI    │────▶│  OpenClaw    │────▶│   Agent    │  │
│  │  (点击运行)   │     │   Gateway    │     │  (AI 核心)  │  │
│  └──────────────┘     └──────────────┘     └────────────┘  │
│           │                    │                    │      │
│           │                    │                    │      │
│           ▼                    ▼                    ▼      │
│  ┌──────────────────────────────────────────────────────┐ │
│  │                    Service 容器                      │ │
│  │  ┌──────────────────┐    ┌──────────────────────┐   │ │
│  │  │  Service Script  │◄──►│   ServiceClient      │   │ │
│  │  │  (Node.js/Bun)   │    │   (SCP Protocol)     │   │ │
│  │  └──────────────────┘    └──────────────────────┘   │ │
│  │           │                       │                  │ │
│  │           │ postMessage          │ WebSocket        │ │
│  │           ▼                       ▼                  │ │
│  │  ┌──────────────────┐    ┌──────────────────────┐   │ │
│  │  │   Service UI     │    │   SCPServer          │   │ │
│  │  │  (HTML/JS/CSS)   │    │   (ws://localhost)   │   │ │
│  │  └──────────────────┘    └──────────────────────┘   │ │
│  └──────────────────────────────────────────────────────┘ │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 通信协议

**SCP (Service Communication Protocol)** 基于 WebSocket：

```
Service Script ◄──► ServiceClient ◄──WebSocket──► SCPServer ◄──► Agent
       │                                                            │
       │ postMessage                                                │
       ▼                                                            ▼
Service UI                                                    User Interface
```

**消息格式示例**：

````typescript
// UI → Service Script (via postMessage)
{
  type: 'create-todo',
  messageId: 'msg-123',
  payload: {
    title: 'Buy groceries',
    priority: 'high'
  }
}

> ⚠️ **重要提示：响应格式必须遵循 Gateway API 规范**
>
> 当服务处理 `service.action` 请求并返回 `agent.response` 消息时，**必须**使用以下格式：
>
> ```typescript
> // ✅ 正确格式 - 数据包装在 data 字段中
> {
>   type: "agent.response",
>   serviceId: SERVICE_ID,
>   requestId: requestId,
>   timestamp: new Date().toISOString(),
>   payload: {
>     success: true,
>     data: {              // ← 业务数据必须放在 data 字段中
>       todos: [...],
>       todo: { ... }
>     }
>   }
> }
>
> // ❌ 错误格式 - 直接将业务数据放在 payload 中
> {
>   type: "agent.response",
>   payload: {
>     success: true,
>     todos: [...],       // ← 这样会导致 Gateway 无法识别数据
>     todo: { ... }
>   }
> }
> ```
>
> **常见错误：** 服务返回 `{ success: true, todos: [...] }` 而不是 `{ success: true, data: { todos: [...] } }`，导致客户端接收到的响应缺少数据字段。
>
> Gateway 使用 Zod Schema 验证响应格式：
> ```typescript
> const AgentResponsePayloadSchema = z.object({
>   success: z.boolean(),
>   data: z.unknown().optional(),     // ← 业务数据必须在这里
>   error: z.object({ ... }).optional()
> });
> ```

#### 发射事件

```typescript
class ServiceClientWithEvents extends MinimalServiceClient {
  // 发射任务创建事件
  emitTodoCreated(todo: { id: string; title: string }): void {
    this.sendMessage("service.event", {
      event: "todo.created",
      data: {
        id: todo.id,
        title: todo.title,
        createdAt: new Date().toISOString(),
      },
    });
  }

  // 发射任务完成事件
  emitTodoCompleted(todoId: string): void {
    this.sendMessage("service.event", {
      event: "todo.completed",
      data: {
        id: todoId,
        completedAt: new Date().toISOString(),
      },
    });
  }

  // 发射自定义事件
  emitCustomEvent(eventName: string, data: any): void {
    this.sendMessage("service.event", {
      event: eventName,
      data,
    });
  }
}
````

#### 错误处理和重连

```typescript
class ResilientServiceClient extends MinimalServiceClient {
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;

  async connect(): Promise<void> {
    try {
      await super.connect();
      this.reconnectAttempts = 0;
    } catch (error) {
      this.handleConnectionError(error);
    }
  }

  private handleConnectionError(error: any): void {
    console.error("Connection failed:", error);

    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);

      console.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

      setTimeout(() => this.connect(), delay);
    } else {
      console.error("Max reconnection attempts reached");
      process.exit(1);
    }
  }

  protected setupEventHandlers(): void {
    super.setupEventHandlers();

    this.ws?.on("close", (code, reason) => {
      console.log(`Connection closed: ${code} ${reason}`);
      this.connected = false;

      // 非正常关闭时尝试重连
      if (code !== 1000 && code !== 1001) {
        this.handleConnectionError(new Error("Connection closed unexpectedly"));
      }
    });

    this.ws?.on("error", (error) => {
      console.error("WebSocket error:", error);
    });
  }
}
```

#### 完整示例：TODO Service 客户端

```typescript
import { ServiceClient } from "@openclaw/service-sdk";

const client = new ServiceClient("todo-service", {
  name: "TODO Service",
  version: "1.0.0",
  reconnect: {
    enabled: true,
    maxRetries: 5,
    initialDelay: 1000,
    maxDelay: 16000,
  },
});

// 连接事件
client.on("connected", () => {
  console.log("Connected to Gateway");
});

client.on("disconnected", ({ code, reason }) => {
  console.log(`Disconnected: ${code} ${reason}`);
});

client.on("reconnecting", ({ attempt, maxRetries, delay }) => {
  console.log(`Reconnecting... ${attempt}/${maxRetries} in ${delay}ms`);
});

// 处理 Agent 停止请求
client.on("stop-requested", ({ reason, force }) => {
  console.log(`Stop requested: ${reason} (force: ${force})`);
  gracefulShutdown();
});

// 处理错误
client.on("error", (error) => {
  console.error("Client error:", error);
});

// 连接 Gateway
async function start() {
  try {
    await client.connect("ws://localhost:18789/__openclaw__/scp");

    // 发射事件示例
    client.emitEvent("service.ready", { timestamp: Date.now() });

    // 调用 Agent 动作示例
    const result = await client.callAction("agent.notify", {
      title: "Service Started",
      message: "TODO Service is now running",
    });

    console.log("Action result:", result);
  } catch (error) {
    console.error("Failed to start:", error);
    process.exit(1);
  }
}

function gracefulShutdown() {
  console.log("Shutting down...");
  client.disconnect();
  process.exit(0);
}

process.on("SIGINT", gracefulShutdown);
process.on("SIGTERM", gracefulShutdown);

start();
```

---

### 最佳实践

#### Service ID 命名规范

```
✅ 推荐：
- todo-service
- weather-data-provider
- mycompany-calendar-sync

❌ 避免：
- TodoService (使用驼峰)
- my_service (使用下划线)
- 123service (数字开头)
- my--service (连续连字符)
- a (太短，无意义)
```

#### 重连策略

```typescript
const reconnectConfig = {
  enabled: true, // 启用自动重连
  maxRetries: 5, // 最大重试次数
  initialDelay: 1000, // 初始延迟 1 秒
  maxDelay: 16000, // 最大延迟 16 秒（指数退避上限）
};

// 退避间隔：1s, 2s, 4s, 8s, 16s...
```

#### 消息验证

```typescript
import { z } from "zod";

const TodoEventSchema = z.object({
  event: z.literal("todo.created"),
  data: z.object({
    id: z.string().min(1),
    title: z.string().min(1),
    priority: z.enum(["low", "medium", "high", "urgent"]),
    createdAt: z.string().datetime(),
  }),
});

// 验证消息
const result = TodoEventSchema.safeParse(payload);
if (!result.success) {
  console.error("Invalid event format:", result.error);
  return;
}
```

#### 超时处理

```typescript
// 动作调用超时
const ACTION_TIMEOUT = 30000; // 30 秒

async function callActionWithTimeout(action: string, params: any): Promise<any> {
  return Promise.race([
    client.callAction(action, params),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Action timeout")), ACTION_TIMEOUT),
    ),
  ]);
}

// 连接超时
const CONNECT_TIMEOUT = 10000; // 10 秒
```

#### 日志规范

```typescript
// 使用结构化日志
console.log(`[${serviceId}] Connected to Gateway`);
console.log(`[${serviceId}] Event emitted: ${eventName}`, data);
console.error(`[${serviceId}] Action failed: ${action}`, error);

// 避免
console.log("connected"); // 无上下文
console.log(data); // 无说明
```

#### 资源清理

```typescript
async function gracefulShutdown() {
  // 1. 停止接收新请求
  isShuttingDown = true;

  // 2. 完成进行中的操作
  await Promise.all(pendingOperations);

  // 3. 发送停止消息
  client.emitEvent("service.stopping", { reason: "shutdown" });

  // 4. 断开连接
  client.disconnect();

  // 5. 清理资源
  await closeDatabase();
  await stopHttpServer();

  process.exit(0);
}
```

---

## 最佳实践

### 1. 代码组织

```
✅ 推荐：
- 按功能拆分模块（store.ts, api.ts, utils.ts）
- 类型定义放在 types.ts
- UI 组件放在 ui/components/

❌ 避免：
- 单个文件超过 1000 行
- 混合业务逻辑和 UI 渲染
- 重复代码
```

### 2. 错误处理

```typescript
// ✅ 推荐
try {
  const result = await store.create(data);
  sendToUI({ type: "success", data: result });
} catch (error) {
  console.error("Create failed:", error);
  sendToUI({
    type: "error",
    error: error instanceof Error ? error.message : "Unknown error",
  });
}

// ❌ 避免
try {
  const result = await store.create(data);
} catch (e) {
  // 静默失败
}
```

### 3. 数据持久化

```typescript
// ✅ 使用 lowdb（轻量级 JSON 数据库）
import { LowSync } from "lowdb";
import { JSONFileSync } from "lowdb/node";

// ✅ 或者 SQLite（更强大）
import { Database } from "bun:sqlite";

// ❌ 避免纯内存存储（重启丢失）
const data = []; // 不要这样做
```

### 4. 日志规范

```typescript
// ✅ 使用前缀标识服务
console.log(`[${SERVICE_ID}] 信息`);
console.error(`[${SERVICE_ID}] 错误:`, error);

// ✅ 结构化日志
console.log(`[${SERVICE_ID}] Action: ${action}, Data:`, data);

// ❌ 避免无意义的日志
console.log("test"); // 不要这样做
```

### 5. UI/UX 建议

```
✅ 推荐：
- 使用 Lucide 图标库
- 添加加载状态
- 显示空状态提示
- 支持键盘快捷键
- 响应式设计

❌ 避免：
- 过多动画影响性能
- 阻塞 UI 的操作
- 无反馈的交互
```

---

## 故障排除

### 常见问题

#### 1. 服务无法启动

```bash
# 检查日志
openclaw service logs my-service

# 检查语法错误
bun check script/entry.ts
```

#### 2. UI 无法加载

```bash
# 检查 manifest.json 路径配置
# 确认 ui/index.html 存在
ls services/my-service/ui/index.html

# 检查文件权限
chmod +r services/my-service/ui/*
```

#### 3. 通信失败

```javascript
// 检查 ServiceClient 连接
client.on("error", (err) => {
  console.error("Connection error:", err);
});

// 检查消息格式
console.log("Sending:", JSON.stringify(message, null, 2));
```

#### 4. 独立调试模式不工作

```javascript
// 检查检测逻辑
console.log("URL:", window.location.href);
console.log("isStandalone:", this.isStandalone);

// 检查网络请求
fetch("http://localhost:9876/api/todos")
  .then((r) => console.log("API OK"))
  .catch((e) => console.error("API Error:", e));
```

---

## 参考资源

- [OpenClaw Service SDK 文档](https://docs.openclaw.ai/services/sdk)
- [SCP 协议规范](../docs/scp-protocol-v1.md)
- [示例服务：TODO Service](../services/todo-service/)
- [Bun 文档](https://bun.sh/docs)
- [Lucide Icons](https://lucide.dev/)

---

_最后更新：2024-03-13_  
_作者：OpenClaw Agent_
