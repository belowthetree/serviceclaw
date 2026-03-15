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

```typescript
// UI → Service Script (via postMessage)
{
  type: 'create-todo',
  messageId: 'msg-123',
  payload: {
    title: 'Buy groceries',
    priority: 'high'
  }
}

// Service Script → Agent (via SCP)
{
  eventType: 'todo.created',
  todo: { id: '1', title: 'Buy groceries', ... },
  timestamp: '2024-03-13T10:00:00Z',
  agentId: 'todo-service'
}
```

---

## 目录结构规范

标准 Service 目录结构：

```
services/{service-id}/                      # 服务目录
├── manifest.json                           # 服务元数据（必需）
├── README.md                               # 服务文档
├── script/                                 # 服务端脚本
│   ├── entry.ts                            # 服务入口（必需）
│   ├── types.ts                            # 类型定义
│   ├── store.ts                            # 数据存储
│   ├── mock-entry.ts                       # Mock 服务（独立调试用）
│   └── ...                                 # 其他模块
└── ui/                                     # 前端 UI
    ├── index.html                          # UI 入口（必需）
    ├── app.js                              # UI 逻辑
    ├── styles.css                          # 样式
    └── components/                         # UI 组件
```

### 关键文件说明

| 文件              | 必需 | 描述                                  |
| ----------------- | ---- | ------------------------------------- |
| `manifest.json`   | ✅   | 服务元数据配置                        |
| `script/entry.ts` | ✅   | 服务入口，包含 ServiceClient 连接逻辑 |
| `script/types.ts` | ⚪   | TypeScript 类型定义                   |
| `script/store.ts` | ⚪   | 数据持久化逻辑                        |
| `ui/index.html`   | ✅   | UI 入口，被 iframe 加载               |
| `ui/app.js`       | ⚪   | UI 业务逻辑                           |
| `ui/styles.css`   | ⚪   | UI 样式                               |

---

## Manifest 配置

`manifest.json` 定义服务的基本信息和能力：

```json
{
  "id": "my-service", // 唯一标识符（必需）
  "name": "My Service", // 显示名称（必需）
  "description": "服务描述", // 描述
  "version": "1.0.0", // 语义化版本（必需）
  "entry": "script/entry.ts", // 入口文件路径（必需）
  "ui": {
    "entry": "ui/index.html" // UI 入口路径
  },
  "capabilities": ["cron", "filesystem"], // 所需权限
  "category": "productivity" // 分类
}
```

### 字段详解

| 字段           | 类型     | 必需 | 说明                   |
| -------------- | -------- | ---- | ---------------------- |
| `id`           | string   | ✅   | 唯一标识符，kebab-case |
| `name`         | string   | ✅   | 显示名称               |
| `description`  | string   | ⚪   | 服务描述               |
| `version`      | string   | ✅   | 语义化版本             |
| `entry`        | string   | ✅   | 服务端入口文件         |
| `ui.entry`     | string   | ⚪   | UI 入口文件            |
| `capabilities` | string[] | ⚪   | 权限列表               |
| `category`     | string   | ⚪   | 分类标签               |

### 权限列表 (Capabilities)

| 权限           | 说明         |
| -------------- | ------------ |
| `cron`         | 定时任务     |
| `filesystem`   | 文件系统访问 |
| `network`      | 网络访问     |
| `notification` | 发送通知     |
| `clipboard`    | 剪贴板访问   |

---

## Service 脚本开发

### 基础结构

```typescript
// script/entry.ts
import { ServiceClient } from "@openclaw/service-sdk";

const SERVICE_ID = "my-service";
const SERVICE_NAME = "My Service";
const AGENT_URL = "ws://localhost:18789/__openclaw__/scp";

let client: ServiceClient | null = null;

async function initialize(): Promise<void> {
  console.log(`[${SERVICE_ID}] Initializing...`);

  // 创建 ServiceClient
  client = new ServiceClient(SERVICE_ID, {
    name: SERVICE_NAME,
    version: "1.0.0",
    reconnect: {
      enabled: true,
      maxRetries: 5,
    },
  });

  // 设置事件处理器
  setupAgentEventHandlers();
  setupUIMessageHandlers();

  // 连接 Agent
  await client.connect(AGENT_URL);
  console.log(`[${SERVICE_ID}] Connected to Agent`);
}

function setupAgentEventHandlers(): void {
  if (!client) return;

  // 处理停止请求
  client.on("stop-requested", (data) => {
    console.log(`[${SERVICE_ID}] Stop requested`);
    handleShutdown();
  });

  // 处理连接事件
  client.on("connected", () => {
    console.log(`[${SERVICE_ID}] Connected`);
  });

  // 处理错误
  client.on("error", (error) => {
    console.error(`[${SERVICE_ID}] Error:`, error);
  });
}

function setupUIMessageHandlers(): void {
  // 通过 process.on('message') 接收 UI 消息
  process.on("message", async (message) => {
    console.log(`[${SERVICE_ID}] Received message:`, message.type);

    switch (message.type) {
      case "action-name":
        await handleAction(message);
        break;
      default:
        console.warn(`Unknown message type: ${message.type}`);
    }
  });
}

function sendToUI(message: Record<string, unknown>): void {
  if (process.send) {
    process.send(message);
  }
}

async function handleShutdown(): Promise<void> {
  console.log(`[${SERVICE_ID}] Shutting down...`);
  if (client) {
    client.disconnect();
  }
  process.exit(0);
}

// 启动服务
initialize().catch((error) => {
  console.error(`[${SERVICE_ID}] Failed to start:`, error);
  process.exit(1);
});
```

### 数据存储示例

```typescript
// script/store.ts
import { JSONFileSync } from "lowdb/node";
import { LowSync } from "lowdb";

interface Data {
  items: Item[];
}

export class Store {
  private db: LowSync<Data>;

  constructor() {
    const adapter = new JSONFileSync<Data>("data.json");
    this.db = new LowSync(adapter, { items: [] });
    this.db.read();
  }

  async create(item: Omit<Item, "id">): Promise<Item> {
    const newItem = { ...item, id: Date.now().toString() };
    this.db.data.items.push(newItem);
    await this.db.write();
    return newItem;
  }

  async getAll(): Promise<Item[]> {
    return this.db.data.items;
  }

  async update(id: string, data: Partial<Item>): Promise<Item | null> {
    const index = this.db.data.items.findIndex((i) => i.id === id);
    if (index === -1) return null;

    this.db.data.items[index] = { ...this.db.data.items[index], ...data };
    await this.db.write();
    return this.db.data.items[index];
  }

  async delete(id: string): Promise<boolean> {
    const index = this.db.data.items.findIndex((i) => i.id === id);
    if (index === -1) return false;

    this.db.data.items.splice(index, 1);
    await this.db.write();
    return true;
  }
}
```

---

## UI 前端开发

### 基础结构

```html
<!-- ui/index.html -->
<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>My Service</title>
    <link rel="stylesheet" href="styles.css" />
    <!-- 图标库 -->
    <script src="https://unpkg.com/lucide@latest"></script>
  </head>
  <body>
    <div id="app">
      <header>
        <h1>My Service</h1>
      </header>

      <main>
        <div id="loading">加载中...</div>
        <div id="content" class="hidden">
          <!-- 内容区域 -->
        </div>
        <div id="error" class="hidden">
          <!-- 错误提示 -->
        </div>
      </main>
    </div>

    <script src="app.js"></script>
  </body>
</html>
```

### UI 业务逻辑

```javascript
// ui/app.js
class MyServiceApp {
  constructor() {
    this.items = [];
    this.isLoading = false;
  }

  init() {
    // 检测独立模式
    this.detectStandaloneMode();

    // 设置事件监听
    this.setupEventListeners();

    // 初始化通信
    if (this.isStandalone) {
      this.setupStandaloneMode();
    } else {
      this.setupServiceCommunication();
    }

    // 加载数据
    this.loadData();
  }

  // 检测是否独立运行
  detectStandaloneMode() {
    const urlParams = new URLSearchParams(window.location.search);
    this.isStandalone = urlParams.has("standalone") || window.location.protocol === "file:";
    this.apiBaseUrl = "http://localhost:9876";
  }

  // 设置独立模式（HTTP API）
  setupStandaloneMode() {
    console.log("[App] Standalone mode");

    // 覆盖发送方法
    this.sendToService = async (message) => {
      try {
        const response = await fetch(`${this.apiBaseUrl}/api/message`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(message),
        });

        const result = await response.json();
        this.handleServiceMessage(result);
      } catch (err) {
        console.error("[Standalone] Failed:", err);
        this.showError("连接失败，请确保服务已启动");
      }
    };

    // 覆盖加载方法
    this.loadData = async () => {
      try {
        this.showLoading();
        const response = await fetch(`${this.apiBaseUrl}/api/items`);
        const data = await response.json();
        this.items = data.data || [];
        this.render();
      } catch (err) {
        this.showError("加载失败");
      }
    };
  }

  // 设置 Service 通信（postMessage）
  setupServiceCommunication() {
    console.log("[App] OpenClaw mode");

    // 监听来自 Service 的消息
    window.addEventListener("message", (event) => {
      if (event.data && event.data.type) {
        this.handleServiceMessage(event.data);
      }
    });

    // 通知 Service 已就绪
    this.sendToService({ type: "ui-ready" });
  }

  // 发送消息到 Service
  sendToService(message) {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage(message, "*");
    }
  }

  // 处理 Service 消息
  handleServiceMessage(message) {
    switch (message.type) {
      case "data-loaded":
        this.items = message.data;
        this.render();
        break;
      case "error":
        this.showError(message.error);
        break;
    }
  }

  // UI 方法
  showLoading() {
    document.getElementById("loading").classList.remove("hidden");
    document.getElementById("content").classList.add("hidden");
  }

  showError(message) {
    document.getElementById("error").textContent = message;
    document.getElementById("error").classList.remove("hidden");
  }

  render() {
    // 渲染逻辑
  }

  setupEventListeners() {
    // DOM 事件监听
  }
}

// 启动应用
document.addEventListener("DOMContentLoaded", () => {
  const app = new MyServiceApp();
  app.init();
});
```

---

## 独立调试方法（重点）

### 为什么需要独立调试？

| 场景         | 说明                         |
| ------------ | ---------------------------- |
| **开发阶段** | 无需启动完整的 OpenClaw 环境 |
| **UI 调试**  | 快速修改和预览界面           |
| **API 测试** | 单独测试后端逻辑             |
| **CI/CD**    | 自动化测试无需完整环境       |

### 方案对比

| 方案                  | 复杂度      | 数据持久化 | 适用场景           |
| --------------------- | ----------- | ---------- | ------------------ |
| **UI Mock 模式**      | ⭐ 最简单   | ❌ 内存    | UI 开发、快速预览  |
| **Mock Service**      | ⭐⭐ 中等   | ✅ SQLite  | 功能测试、API 开发 |
| **Standalone Server** | ⭐⭐⭐ 完整 | ✅ SQLite  | 集成测试、演示     |

---

### 方案 1：UI Mock 模式

**适用场景**：纯前端开发、UI 调试

#### 实现步骤

1. **在 app.js 中添加 Mock 检测**：

```javascript
detectStandaloneMode() {
  const urlParams = new URLSearchParams(window.location.search);
  this.isStandalone = urlParams.has('standalone') ||
                      window.location.protocol === 'file:';

  if (this.isStandalone) {
    console.log('[App] Mock mode');
    this.enableMockMode();
  }
}

enableMockMode() {
  // 模拟数据
  this.items = [
    { id: '1', title: '示例任务 1', completed: false },
    { id: '2', title: '示例任务 2', completed: true }
  ];

  // 覆盖发送方法
  this.sendToService = (msg) => {
    console.log('[Mock] Would send:', msg);
    // 模拟响应
    setTimeout(() => {
      this.handleServiceMessage({
        type: `${msg.type}-response`,
        success: true,
        data: { id: Date.now().toString(), ...msg.payload }
      });
    }, 100);
  };

  // 直接渲染
  this.render();
}
```

2. **使用方法**：

```bash
# 直接打开 HTML 文件
open services/my-service/ui/index.html

# 或者带参数
open services/my-service/ui/index.html?standalone
```

---

### 方案 2：Mock Service（推荐）

**适用场景**：前后端联调、功能测试、API 开发

#### 1. 创建 Mock 服务

创建 `script/mock-entry.ts`：

```typescript
import { TodoStore } from "./todo-store.js";
import type { Todo } from "./types.js";

const SERVICE_ID = "my-service";
const PORT = 9876;

// Mock ServiceClient
class MockServiceClient {
  private eventHandlers: Map<string, Function[]> = new Map();

  on(event: string, handler: Function) {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, []);
    }
    this.eventHandlers.get(event)!.push(handler);
  }

  emitEvent(event: string, data: unknown) {
    const handlers = this.eventHandlers.get(event) || [];
    handlers.forEach((h) => h(data));
  }

  async connect(url: string) {
    console.log(`[${SERVICE_ID}] Connected to ${url}`);
  }

  disconnect() {
    console.log(`[${SERVICE_ID}] Disconnected`);
  }
}

// HTTP API Server
const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;

    // CORS 头
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (req.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // API 路由
    if (path.startsWith("/api/")) {
      // GET /api/todos
      if (path === "/api/todos" && req.method === "GET") {
        const todos = await store.getAll();
        return Response.json({ success: true, data: todos }, { headers: corsHeaders });
      }

      // POST /api/todos
      if (path === "/api/todos" && req.method === "POST") {
        const body = await req.json();
        const todo = await store.create(body);
        return Response.json({ success: true, data: todo }, { headers: corsHeaders });
      }

      // ... 其他路由
    }

    return new Response("Not Found", { status: 404, headers: corsHeaders });
  },
});

console.log(`🚀 Mock service running at http://localhost:${PORT}`);
```

#### 2. 前端适配

在 `app.js` 中添加 HTTP 模式支持：

```javascript
detectStandaloneMode() {
  const urlParams = new URLSearchParams(window.location.search);
  this.isStandalone = urlParams.has('standalone');
  this.apiBaseUrl = 'http://localhost:9876';

  if (this.isStandalone) {
    this.setupStandaloneMode();
  }
}

setupStandaloneMode() {
  // 使用 HTTP API 替代 postMessage
  this.sendToService = async (message) => {
    const response = await fetch(`${this.apiBaseUrl}/api/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message)
    });
    return response.json();
  };

  this.loadTodos = async () => {
    const response = await fetch(`${this.apiBaseUrl}/api/todos`);
    const data = await response.json();
    this.handleServiceMessage({
      type: 'todos-loaded',
      todos: data.data
    });
  };
}
```

#### 3. 启动脚本

创建 `start-mock.sh`：

```bash
#!/bin/bash
set -e

# 颜色定义
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${YELLOW}🚀 启动 Mock Service...${NC}"

# 启动 Mock 服务
bun run script/mock-entry.ts &
MOCK_PID=$!
sleep 2

# 启动前端服务器
cd ui
npx http-server -p 8080 --cors &
HTTP_PID=$!
sleep 2

echo -e "${GREEN}✅ 服务已启动!${NC}"
echo ""
echo "📡 API:   http://localhost:9876"
echo "🎨 UI:    http://localhost:8080?standalone"
echo ""
echo "按 Ctrl+C 停止所有服务"

# 一键停止
trap "kill $MOCK_PID $HTTP_PID 2>/dev/null; exit" INT
wait
```

#### 4. 使用方法

```bash
cd services/my-service
./start-mock.sh

# 浏览器自动打开
# http://localhost:8080?standalone
```

---

### 方案 3：Standalone Server

**适用场景**：单进程运行、演示环境

创建一个完全独立的服务器，同时提供 HTTP API 和静态文件：

```typescript
// script/standalone.ts
import { serve } from "bun";
import { join } from "path";

const store = new TodoStore();
const UI_DIR = join(import.meta.dir, "..", "ui");

const server = serve({
  port: 3000,
  async fetch(req) {
    const url = new URL(req.url);

    // API 路由
    if (url.pathname.startsWith("/api/")) {
      // ... 处理 API 请求
    }

    // 静态文件服务
    let filePath = url.pathname === "/" ? "/index.html" : url.pathname;
    const file = Bun.file(join(UI_DIR, filePath));

    if (await file.exists()) {
      return new Response(file);
    }

    return new Response("Not Found", { status: 404 });
  },
});

console.log(`Server running at http://localhost:${server.port}`);
```

---

### 调试工具推荐

| 工具                 | 用途                 | 命令                                   |
| -------------------- | -------------------- | -------------------------------------- |
| **curl**             | 测试 API             | `curl http://localhost:9876/api/todos` |
| **httpie**           | 更友好的 HTTP 客户端 | `http :9876/api/todos`                 |
| **Postman**          | GUI API 测试         | -                                      |
| **Browser DevTools** | 前端调试             | F12                                    |

---

## 部署与发布

### 本地安装

```bash
# 复制服务目录到 OpenClaw 服务目录
cp -r services/my-service ~/.openclaw/services/

# 重启 Gateway
openclaw gateway restart

# 查看服务列表
openclaw service list
```

### 发布到 Clawhub

```bash
# 打包服务
cd services/my-service
tar -czf my-service-v1.0.0.tar.gz .

# 上传到 Clawhub
# 按照 https://clawhub.io 指引操作
```

---

## SCP 协议指南

### SCP 协议概述

**SCP (Service Communication Protocol)** 是 OpenClaw 中用于 Service 与 Gateway 之间通信的 WebSocket 协议。

#### 为什么需要 SCP

| 特性         | 说明                              |
| ------------ | --------------------------------- |
| **双向通信** | Service 和 Agent 可以相互发送消息 |
| **实时性**   | WebSocket 提供低延迟的实时通信    |
| **标准化**   | 统一的消息格式和错误处理机制      |
| **可扩展**   | 支持自定义事件和动作              |

#### SCP 与 Gateway Protocol 的区别

| 特性         | SCP                     | Gateway Protocol        |
| ------------ | ----------------------- | ----------------------- |
| **用途**     | Service 与 Gateway 通信 | Gateway 与客户端通信    |
| **协议**     | WebSocket               | WebSocket               |
| **端点**     | `/__openclaw__/scp`     | `/__openclaw__/gateway` |
| **认证**     | serviceId 参数          | Token 认证              |
| **适用场景** | 开发 Service            | 开发客户端应用          |

#### 何时使用 SCP

- 开发 OpenClaw Service 时
- 需要 Service 与 Agent 双向通信时
- 需要触发 Agent 动作或响应 Agent 请求时

---

### 连接

#### WebSocket URL 格式

```
ws://{gateway-host}:{port}/__openclaw__/scp?serviceId={serviceId}
```

**参数说明：**

| 参数           | 必填 | 说明             | 示例                           |
| -------------- | ---- | ---------------- | ------------------------------ |
| `gateway-host` | 是   | Gateway 主机地址 | `localhost` 或 `192.168.1.100` |
| `port`         | 是   | Gateway 端口     | `18789`                        |
| `serviceId`    | 是   | 服务唯一标识     | `my-todo-service`              |

**完整示例：**

```
ws://localhost:18789/__openclaw__/scp?serviceId=todo-service
```

#### serviceId 命名规范

- 使用 **kebab-case** (短横线连接的小写字母和数字)
- 必须以字母开头
- 只能包含小写字母、数字和连字符
- 长度建议 3-50 个字符

```
✅ 有效: todo-service, my-app-v2, weather-data
❌ 无效: TodoService, my_app, 123service, my--service
```

#### 连接生命周期

```
1. 建立 WebSocket 连接
        ↓
2. 发送 service.started 消息（30秒内必须完成）
        ↓
3. 正常通信（收发消息）
        ↓
4. 发送 service.stopped 消息（可选）
        ↓
5. 关闭连接
```

**重要提示：** 连接建立后必须在 **30 秒** 内发送 `service.started` 消息，否则连接会被服务器关闭。

---

### 消息类型

所有消息都使用 JSON 格式，包含以下公共字段：

```typescript
{
  type: string,       // 消息类型
  serviceId: string,  // 服务ID
  requestId: string,  // 请求唯一标识
  timestamp: string,  // ISO 8601 时间戳
  payload: object     // 消息载荷
}
```

#### service.started - 服务注册

Service 启动后向 Gateway 注册自身信息。

**请求格式：**

```typescript
{
  type: "service.started",
  serviceId: "todo-service",
  requestId: "req-123",
  timestamp: "2024-03-15T10:00:00Z",
  payload: {
    name: "TODO Service",
    version: "1.0.0",
    actions: ["todos.list", "todos.create", "todos.complete"],
    metadata: {
      description: "Task management service",
      author: "OpenClaw"
    }
  }
}
```

**字段说明：**

| 字段       | 类型     | 必填 | 说明           |
| ---------- | -------- | ---- | -------------- |
| `name`     | string   | 是   | 服务显示名称   |
| `version`  | string   | 是   | 语义化版本号   |
| `actions`  | string[] | 否   | 支持的动作列表 |
| `metadata` | object   | 否   | 扩展元数据     |

**响应：** Gateway 返回 `agent.response` 消息表示注册成功或失败。

#### service.stopped - 服务注销

Service 停止时通知 Gateway。

**请求格式：**

```typescript
{
  type: "service.stopped",
  serviceId: "todo-service",
  requestId: "req-456",
  timestamp: "2024-03-15T18:00:00Z",
  payload: {
    reason: "shutdown",  // 或 "error", "disconnected", "killed"
    exitCode: 0,
    error: {
      code: 1000,
      message: "Service shutdown normally"
    }
  }
}
```

**reason 枚举值：**

| 值             | 说明       |
| -------------- | ---------- |
| `shutdown`     | 正常关闭   |
| `error`        | 发生错误   |
| `disconnected` | 连接断开   |
| `killed`       | 被强制终止 |

#### service.event - 事件发射

Service 向 Agent 发送事件通知。

**请求格式：**

```typescript
{
  type: "service.event",
  serviceId: "todo-service",
  requestId: "req-789",
  timestamp: "2024-03-15T10:30:00Z",
  payload: {
    event: "todo.created",
    data: {
      id: "todo-123",
      title: "Buy groceries",
      priority: "high",
      createdAt: "2024-03-15T10:30:00Z"
    }
  }
}
```

**常用事件命名规范：**

```
{resource}.{action}    // 例如: todo.created, user.updated
{resource}.{status}    // 例如: task.completed, job.failed
system.{event}         // 例如: system.ready, system.error
```

#### service.action - 动作调用

Service 请求 Agent 执行某个动作。

**请求格式：**

```typescript
{
  type: "service.action",
  serviceId: "todo-service",
  requestId: "req-abc",
  timestamp: "2024-03-15T10:45:00Z",
  payload: {
    action: "agent.notify",
    params: {
      title: "Task Reminder",
      message: "You have 3 tasks due today"
    },
    timeout: 5000  // 可选，毫秒
  }
}
```

**响应：** Agent 执行完成后返回 `agent.response` 消息。

#### agent.response - 响应消息

Gateway 或 Agent 对 Service 请求的响应。

**成功响应：**

```typescript
{
  type: "agent.response",
  serviceId: "todo-service",
  requestId: "req-abc",  // 对应请求的 requestId
  timestamp: "2024-03-15T10:45:01Z",
  payload: {
    success: true,
    data: {
      notificationId: "notif-123",
      delivered: true
    }
  }
}
```

**错误响应：**

```typescript
{
  type: "agent.response",
  serviceId: "todo-service",
  requestId: "req-abc",
  timestamp: "2024-03-15T10:45:01Z",
  payload: {
    success: false,
    error: {
      code: 3001,
      message: "Action failed: notification service unavailable",
      details: {
        action: "agent.notify",
        retryable: true
      }
    }
  }
}
```

**错误码参考：**

| 错误码 | 名称                   | 说明             |
| ------ | ---------------------- | ---------------- |
| 1002   | INVALID_MESSAGE        | 消息格式无效     |
| 1003   | UNKNOWN_MESSAGE_TYPE   | 未知消息类型     |
| 1004   | MISSING_REQUIRED_FIELD | 缺少必填字段     |
| 1006   | SERVICE_ID_MISMATCH    | serviceId 不匹配 |
| 2000   | SERVICE_NOT_FOUND      | 服务未找到       |
| 3000   | ACTION_NOT_FOUND       | 动作未找到       |
| 3001   | ACTION_FAILED          | 动作执行失败     |
| 3004   | TIMEOUT                | 执行超时         |
| 4004   | INTERNAL_ERROR         | 内部错误         |

#### agent.stop-request - 停止请求

Gateway 请求 Service 停止运行。

**格式：**

```typescript
{
  type: "agent.stop-request",
  serviceId: "todo-service",
  requestId: "req-stop",
  timestamp: "2024-03-15T20:00:00Z",
  payload: {
    reason: "Gateway shutting down",
    force: false  // true 表示强制停止
  }
}
```

---

### 代码示例

#### 最小化 Service 客户端

```typescript
import WebSocket from "ws";
import { randomUUID } from "node:crypto";

const SERVICE_ID = "my-service";
const GATEWAY_URL = "ws://localhost:18789/__openclaw__/scp";

class MinimalServiceClient {
  private ws: WebSocket | null = null;
  private connected = false;

  async connect(): Promise<void> {
    const url = `${GATEWAY_URL}?serviceId=${SERVICE_ID}`;

    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(url);

      const timeout = setTimeout(() => {
        reject(new Error("Connection timeout"));
      }, 10000);

      this.ws.on("open", () => {
        clearTimeout(timeout);
        this.connected = true;

        // 发送启动消息
        this.sendMessage("service.started", {
          name: "My Service",
          version: "1.0.0",
        });

        resolve();
      });

      this.ws.on("message", (data) => {
        const message = JSON.parse(data.toString());
        this.handleMessage(message);
      });

      this.ws.on("error", reject);
    });
  }

  private sendMessage(type: string, payload: object): void {
    if (!this.ws || !this.connected) return;

    this.ws.send(
      JSON.stringify({
        type,
        serviceId: SERVICE_ID,
        requestId: randomUUID(),
        timestamp: new Date().toISOString(),
        payload,
      }),
    );
  }

  private handleMessage(message: any): void {
    console.log("Received:", message.type, message.payload);
  }

  disconnect(): void {
    if (this.ws && this.connected) {
      this.sendMessage("service.stopped", { reason: "shutdown" });
      this.ws.close();
    }
    this.connected = false;
  }
}

// 使用示例
const client = new MinimalServiceClient();
client
  .connect()
  .then(() => {
    console.log("Connected!");
  })
  .catch(console.error);
```

#### 处理 Agent 动作

```typescript
class ServiceClientWithActions extends MinimalServiceClient {
  private actions = new Map<string, Function>();

  constructor() {
    super();
    this.registerAction("echo", (params) => params);
    this.registerAction("getStatus", () => ({ status: "running", uptime: 3600 }));
  }

  registerAction(name: string, handler: Function): void {
    this.actions.set(name, handler);
  }

  private handleMessage(message: any): void {
    if (message.type === "service.action") {
      this.handleAction(message);
    }
  }

  private async handleAction(message: any): Promise<void> {
    const { action, params } = message.payload;
    const handler = this.actions.get(action);

    try {
      const result = handler ? await handler(params) : null;
      this.sendResponse(message.requestId, { success: true, data: result });
    } catch (error) {
      this.sendResponse(message.requestId, {
        success: false,
        error: {
          code: 3001,
          message: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }

  private sendResponse(requestId: string, payload: object): void {
    this.ws?.send(
      JSON.stringify({
        type: "agent.response",
        serviceId: SERVICE_ID,
        requestId,
        timestamp: new Date().toISOString(),
        payload,
      }),
    );
  }
}
```

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
```

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
