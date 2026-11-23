# slow-farm-pc 设计文档

日期：2026-11-23
状态：待实现
范围：PixelPets 仓库中的新目录 `slow-farm-pc/`，对应"慢慢农场"的重制版

## 1. 背景与定位

现有的 `slow-farm/` 是纯前端游戏，存档放在浏览器 localStorage。部分浏览器在关闭时清理站点数据，导致存档丢失。这是本次重制的直接原因。

新版 `slow-farm-pc` 是一个**只在本机运行**的网页游戏：

- 浏览器打开 `http://127.0.0.1:<端口>` 游玩
- 有本地 Node 后端，状态由服务端计算并落盘
- 画面用 Phaser 渲染，有场景感与动画，不是现有版本的卡片文字界面
- 玩法与现有版本一致：作物、机器、养殖、订单、升级、成就、沙漏/宝石
- 现有的 GitHub Pages 版本（`slow-farm/index.html`）**冻结不动**，两版互不影响

## 2. 目标、非目标、反目标

### 目标

1. 存档不再依赖浏览器存储，关浏览器、清缓存都不丢档
2. 服务端是状态的唯一权威：所有变更经服务端计算、校验、持久化
3. 完整移植现有玩法，数值与规则保持可对照
4. Phaser 场景化表现：地块、动物、建筑、粒子与反馈动画
5. 单个命令即可启动（开发期 `npm run dev`），不依赖任何外部服务

### 非目标

- 不做账号、登录、多人、排行榜
- 不做云端部署，不做跨设备同步
- 不改动旧版任何文件
- 首版不做移动端适配（PC 优先）
- 首版不打包桌面应用（后续可用 Tauri/Electron 加壳）
- 不做防作弊（单机、自己玩）

### 反目标（即使做得出来也算失败）

- 为了"以后可能多端"提前引入同步协议、事件溯源等复杂机制
- 把所有 UI 都画进 Canvas，导致列表、滚动、输入全部手写
- 两套核心逻辑各自演进，规则悄悄不一致

## 3. 约束

- 核心规则复用现有 `slow-farm/slow-farm-core.js` 与 `slow-farm-rules.js`（纯 JS、无浏览器依赖、有单测）
- 单用户、单写者；可能出现同一浏览器开两个标签页
- 存档体积 4 KB 级（实测：初始 1.5 KB，后期 3.6 KB）
- 服务端只监听 `127.0.0.1`
- 存档写入必须原子，进程中断不能留下半个文件

## 4. 方案选择

| 议题 | 备选 | 选择 | 理由 |
|------|------|------|------|
| 逻辑位置 | 客户端计算 / 服务端权威 | **服务端权威** | 存档与规则同源，避免两端各算一遍；动作天然原子 |
| 存档存储 | JSON 文件 / SQLite | **JSON + 每日快照** | 单文档 4 KB，SQLite 的事务/查询能力用不上；仓储层隔离，未来可换 |
| 渲染 | Canvas 手绘 / Phaser / Three.js | **Phaser 4** | 仓库已有 Phaser 4，场景、补间、粒子、资源加载开箱即用；3D 成本过高 |
| UI 层 | 全 Canvas / 全 HTML / 混合 | **混合** | 场景与角色用 Phaser，订单/商店/成就等密集面板用 HTML 覆盖层 |
| 前端构建 | 无构建 / Vite | **Vite + TypeScript** | 场景与资源组织需要模块化与热更新；类型降低长期维护成本 |
| 后端框架 | node:http / Fastify | **Fastify + TypeScript** | 路由与请求校验清晰，接口会持续增加 |
| 代码组织 | 共享旧 core 文件 / 复制 | **复制到新项目** | 旧版冻结，新版独立演进，避免改一方影响另一方 |

已排除的方案：接口按"增经验 / 增金币"拆分。游戏动作是多效果原子的（收货同时给物品、经验、统计），拆分会导致客户端编排多次请求、失败时半更新；所有变更统一走一个动作接口。

## 5. 架构

```
slow-farm-pc/
├── client/                 # Vite + TS + Phaser
│   ├── src/
│   │   ├── scenes/         # Phaser 场景
│   │   ├── ui/             # HTML 面板（订单、商店、成就、设置）
│   │   ├── api/            # 与服务端通信
│   │   └── state/          # 前端状态容器与订阅
│   └── index.html
├── server/                 # Fastify + TS
│   ├── src/
│   │   ├── routes/         # action / save / meta / static
│   │   ├── core/           # 复制的 slow-farm-core.js、slow-farm-rules.js
│   │   └── store/          # SaveRepository（JSON 实现）
│   └── data/               # 存档、快照、备份（gitignore）
└── package.json            # 根脚本：dev / build / test
```

请求流：

```
点击地块
  → client: POST /api/action { type: "harvest", args: { plot: 3 }, rev: 12 }
  → server: 读取内存状态 → core.harvest(state, 3, now, rules)
            → 成功则落盘（原子写）→ rev + 1
  → 返回 { ok: true, result, state, rev: 13 }
  → client: 替换本地状态，播放收获动画
```

服务端在内存中持有当前状态，启动时从磁盘加载；每次动作成功后落盘。

## 6. 数据模型与存档

### 游戏状态

直接沿用现有 v5 结构（以 `core.createState()` 为准），顶层字段：

```
coins, gems, xp, plots, silo, siloSlots, machines, unlockedRecipes,
animals, hourglasses, orders, orderSlots, orderSeq, ordersGenerated,
lastSeenAt, dailyDay, dailyOrder, stats, achievements, taskIndex, tabsSeen
```

其中 `machines` 含 mill、bakery、juicer、sugarMill、sauceMill、cannery、feedMill、dairy、loom；`stats` 含 planted、harvested、crafted、animalItems、delivered、earned。

### 存档文件

`server/data/save.json`：

```json
{
  "version": 5,
  "rev": 13,
  "savedAt": "2026-11-23T09:00:00.000Z",
  "payload": { ...游戏状态... }
}
```

- `version`：存档结构版本，与现有 `SAVE_VERSION` 对齐
- `rev`：单调递增的修订号，用于拒绝过期写入（同浏览器两个标签页）
- `savedAt`：最后一次落盘时间

### 写入策略

1. 序列化到 `save.json.tmp`
2. `fsync` 后 `rename` 覆盖 `save.json`（原子替换）
3. 覆盖前把旧文件复制为 `save.json.bak`
4. 每个自然日第一次成功写入前，把当日 0 点后的首份存档复制到 `data/snapshots/YYYY-MM-DD.json`
5. 快照保留最近 7 天，更早的自动删除

### 读取策略

- 启动时读取 `save.json`；损坏或缺失时尝试 `.bak`；再失败则新建初始状态并在日志中提示
- 前端 `GET /api/save` 返回当前状态与 `rev`

## 7. 接口

所有接口只在本机可用，不做鉴权。

### POST /api/action

```json
{ "type": "harvest", "args": { "plot": 3 }, "rev": 12 }
```

- `type`：服务端白名单映射到 core 动作（plant、harvest、plantAll、harvestAll、enqueue、collectReady、unlockRecipe、buyQueueSlot、deliverOrder、abandonOrder、buyOrderSlot、buyPlot、buyMachine、buySiloSlot、sellItem、buyAnimal、feedAnimal、collectAnimal、feedAll、collectAll、buyStableSlot、buyHourglass、useHourglass、useHourglassOnPlots、useHourglassOnAnimals、visitTab、buyGems、grantAdGems、grantPaidGems）
- 服务端使用自身时间 `Date.now()`，不接受客户端时间
- 成功：`200 { ok: true, result, state, rev }`
- 业务失败：`200 { ok: false, reason }`（与 core 的 reason 一致，HTTP 层不把它当错误）
- 参数错误：`400`
- `rev` 不匹配：`409 { ok: false, reason: "stale_rev", state, rev }`，客户端用返回状态刷新
- 未知 type：`400`

### GET /api/save

- `200 { state, rev }`
- `204`：尚无存档（客户端随后调用 `POST /api/action` 初始化，或直接使用服务端已创建的初始状态；实现时二选一并在 README 写明）

### PUT /api/save

仅用于导入或手工恢复：接收 `{ state, rev }`，校验结构与版本后原子写入。游戏正常流程不走此接口。

### DELETE /api/save

清档并重建初始状态。需 `rev` 一致。

### GET /api/meta

返回 `{ rulesVersion, saveVersion, rules, rev, startedAt }`。

- `rules` 是完整规则表，与 `slow-farm-rules.js` 的内容一致（ITEMS/CROPS/MACHINES/RECIPES/QUEUE/LEVELS/PLOTS/SILO/ORDERS/ANIMALS/ACHIEVEMENTS/TASKS/GEMS/SELL_RATIO/START）
- 前端启动时拉取一次并缓存，用于显示名称、价格、解锁等级等静态信息
- 规则只由服务端下发；客户端不放规则副本，避免两处数值漂移

### 每日状态刷新

服务端长期运行，跨天后需要生成新的每日订单。约定：

- 每个请求（包括 `GET /api/save`）进入时先执行一次 `ensureDaily(state, now)`（内部调用 `core.ensureDailyOrder`）
- 若状态发生变化，立即落盘并 `rev + 1`；`GET /api/save` 返回最新 `rev`
- 客户端以最近一次响应的 `rev` 为准，因此每日一次的自增不会引起 409
- 不做午夜定时器，避免多一个调度器

### 静态资源

`GET /*` 由 Fastify 的静态插件托管 `client/dist`（生产）或代理 Vite 开发服务器（开发期由 Vite 直接提供页面，接口走代理）。

### 不做的事

- 不提供"增经验 / 增金币"独立接口
- 不暴露 core 的直接执行接口
- 不做鉴权、不做远程访问

## 8. 前端结构

### 分层

- **场景层（Phaser）**：农场主场景，负责地块、动物、建筑、粒子、金币飘字
- **面板层（HTML）**：订单、商店、成就、任务、设置；覆盖在 Canvas 之上，用原生 DOM 或轻量框架
- **状态层**：单一 store 持有服务端返回的 `state` 与 `rev`；场景与面板订阅变化
- **规则来源**：启动时从 `GET /api/meta` 拉取规则表并缓存，客户端不保留规则副本
- **显示辅助函数**：`levelOf`、`remainingMs`、`formatDuration`、`siloSlotsUsed` 这类纯展示用的换算允许在客户端实现一份（它们只把状态翻译成界面，不改变状态）；任何会改变状态的逻辑都只在服务端
- **网络层**：`api/` 封装 action 调用、错误处理、409 刷新

### 交互约定

- 首版采用"等待服务端确认后再播动画"：点击 → 请求 → 成功后播放反馈。本机往返在毫秒级，不需要乐观更新
- 失败时用 toast 显示 `reason` 对应的中文文案（复用旧版 reasons 表）
- 定时刷新：每 5 秒 `GET /api/save` 拉取状态，让作物成熟、机器产出、动物产出现在画面上；页面重新可见时立即拉一次
  - 备选：WebSocket 推送，首版不做

### 表现清单（随里程碑推进）

- 种植：地块翻土、种子落下
- 生长：按阶段替换 sprite，成熟时轻微呼吸动画
- 收获：粒子 + 金币飘字
- 机器：运转帧动画，产出时冒泡
- 动物：待机、进食、产出动画
- 订单完成：印章动画 + 音效

## 9. 里程碑

| 阶段 | 内容 | 产出 |
|------|------|------|
| M0 链路 | 服务端骨架、存档仓储、动作路由、一个地块渲染 | 能种能收，刷新不丢 |
| M1 种植循环 | 全部地块、作物、仓库、卖货、等级 | 完整种植闭环 |
| M2 机器与订单 | 机器队列、配方解锁、订单板 | 核心经营循环 |
| M3 养殖与外围 | 动物、成就、任务、宝石/沙漏 | 功能对齐旧版 |
| M4 表现打磨 | 动画、音效、美术统一、面板体验 | 可称为"炫酷版" |
| M5 可选 | 桌面打包、移动端、启动脚本 | 待定 |

每个阶段结束时旧版已有的对应功能必须可玩，且核心单测保持通过。

## 10. 测试

- **core**：复制时连同单测一起迁入并保持通过；新规则改动必须补测试
- **server**：动作路由（成功/业务失败/未知类型/rev 冲突）、存档原子写、.bak 生成、快照按日轮转与 7 天清理（临时目录）
- **client**：状态同步（action 返回后替换、409 刷新）、reason 文案映射
- **端到端**：可选的 Playwright 冒烟（启动 → 种植 → 收获 → 刷新后仍在）

## 11. 风险与开放问题

1. **美术方向未定**：像素、扁平、等距三选一，M4 前必须确定；它影响 sprite 规格与场景布局，但不阻塞 M0-M3 的程序化占位美术
2. **core 复制后的演进**：旧版冻结，新版修复不回灌；若旧版出现严重 bug，需手工两边修
3. **同一浏览器多标签页**：首版用 `rev` 拒绝过期写入，并在 409 时刷新状态；不保证两人同时操作的合并
4. **启动方式**：开发期一个命令起前后端；生产期需要一个启动脚本（含端口占用检测），首版可先不做
5. **存档迁移**：旧版 localStorage 存档是否导入新版？首版不做；如需，作为一个独立小功能（导出/导入 JSON）

## 12. 留给实现者的决定

- 前端面板是否引入轻量框架（Vue/React）还是原生 DOM：按面板复杂度决定，推荐先原生 DOM
- 仓库内使用 npm workspaces 还是两个独立 package：推荐两个独立 package，根脚本串联
- 端口默认 8787，可通过环境变量覆盖
- TypeScript 严格模式；core 复制的 JS 文件保持原样，用 `allowJs` 引入
- 日志：服务端写 `server/data/server.log`，滚动保留 7 天
