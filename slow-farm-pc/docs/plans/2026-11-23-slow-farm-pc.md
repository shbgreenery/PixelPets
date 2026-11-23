# slow-farm-pc 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 PixelPets 仓库新增 `slow-farm-pc/`，做一个只在本机运行、服务端权威、Phaser 渲染的"慢慢农场"重制版。

**Architecture:** 前端 Vite + TypeScript + Phaser，后端 Fastify + TypeScript，服务端内存持有游戏状态并通过 JSON 仓储原子落盘；所有状态变更走 `POST /api/action`，规则由 `GET /api/meta` 下发；核心规则与动作复用从 `slow-farm/` 复制过来的 `slow-farm-core.js` 与 `slow-farm-rules.js`。

**Tech Stack:** Node 24、TypeScript（strict）、Fastify、@fastify/static、Vitest、Vite、Phaser 4。

**Spec:** `slow-farm-pc/docs/design.md`

## Global Constraints

- 只监听 `127.0.0.1`，默认端口 `8787`（可用 `PORT` 覆盖）
- 存档版本 `SAVE_VERSION = 5`，状态结构以 `core.createState()` 为准
- 所有时间由服务端 `Date.now()` 生成，不接受客户端时间
- 存档写入必须原子：写 `.tmp` → `fsync` → `rename`
- 旧版 `slow-farm/`、`farm/` 等目录不得修改
- core 复制为 CommonJS 原样文件，不在其中改逻辑；新玩法通过服务端适配层扩展
- 提交信息用中文，格式 `feat(scope): 描述`

## Review Focus

实现时最容易出错、必须有测试钉住的五类情况：

1. **存档损坏或半写**：主文件解析失败时回退 `.bak`，再失败则新建初始状态，进程不能崩
2. **多标签页并发**：过期 `rev` 返回 409 并附最新状态，客户端刷新而不是覆盖
3. **服务端跨天运行**：每日订单必须在新的一天生成，否则任务链卡死
4. **端口被占用或服务端未启动**：前端显示明确错误，不能白屏
5. **规则版本与存档版本不匹配**：`/api/meta` 暴露版本，前端提示而不是静默使用

---

## Task 1: 服务端骨架与核心规则迁入

**Files:**
- Create: `slow-farm-pc/package.json`
- Create: `slow-farm-pc/server/package.json`
- Create: `slow-farm-pc/server/tsconfig.json`
- Create: `slow-farm-pc/server/vitest.config.ts`
- Create: `slow-farm-pc/server/core/slow-farm-core.js`（从 `slow-farm/slow-farm-core.js` 复制）
- Create: `slow-farm-pc/server/core/slow-farm-rules.js`（从 `slow-farm/slow-farm-rules.js` 复制）
- Create: `slow-farm-pc/server/core/tests/`（复制 `slow-farm/slow-farm-core.test.js` 与 `slow-farm/slow-farm-app.test.js` 中只依赖 core 的部分；`slow-farm-store.test.js` 不带）
- Create: `slow-farm-pc/server/scripts/run-core-tests.mjs`
- Create: `slow-farm-pc/.gitignore`

**Interfaces:**
- Consumes: 无
- Produces: `server/core/slow-farm-core.js`（CommonJS，默认导出整个动作集合）、`server/core/slow-farm-rules.js`（导出 `RULES`）；根脚本 `npm run test:core`

- [ ] **Step 1: 建目录与 package.json**

根 `package.json`：

```json
{
  "name": "slow-farm-pc",
  "private": true,
  "scripts": {
    "dev": "npm --prefix server run dev & npm --prefix client run dev",
    "test": "npm run test:core && npm --prefix server test && npm --prefix client test",
    "test:core": "node server/scripts/run-core-tests.mjs"
  }
}
```

`server/package.json`：`type: "commonjs"`，依赖 `fastify`、`@fastify/static`，开发依赖 `typescript`、`vitest`、`tsx`、`@types/node`；脚本 `test: "vitest run"`、`dev: "tsx watch src/index.ts"`。

`server/tsconfig.json`：`strict: true`、`allowJs: true`、`target: ES2022`、`module: commonjs`、`outDir: dist`。

- [ ] **Step 2: 复制 core 与规则**

复制两个文件到 `server/core/`，内容不改。复制对应测试到 `server/core/tests/`。

- [ ] **Step 3: 写 core 测试运行器**

`server/scripts/run-core-tests.mjs`：遍历 `server/core/tests/*.test.js` 并 `require` 每个文件；任一文件抛错则以非零码退出。现有测试是断言脚本，加载即执行。

- [ ] **Step 4: 运行验证**

Run: `npm run test:core`
Expected: 两个测试文件全部打印通过，退出码 0

- [ ] **Step 5: 提交**

```bash
git add slow-farm-pc
git commit -m "feat(slow-farm-pc): 服务端骨架与核心规则迁入"
```

---

## Task 2: JSON 存档仓储

**Files:**
- Create: `slow-farm-pc/server/src/types.ts`
- Create: `slow-farm-pc/server/src/store/saveRepository.ts`
- Test: `slow-farm-pc/server/src/store/saveRepository.test.ts`

**Interfaces:**
- Consumes: 无
- Produces:
  - `type GameState = { coins: number; gems: number; xp: number; plots: unknown[]; silo: Record<string, number>; siloSlots: number; machines: Record<string, unknown>; unlockedRecipes: string[]; animals: Record<string, unknown>; hourglasses: number; orders: unknown[]; orderSlots: number; orderSeq: number; ordersGenerated: number; lastSeenAt: number; dailyDay: string | null; dailyOrder: unknown; stats: Record<string, number>; achievements: unknown[]; taskIndex: number; tabsSeen: string[] }`
  - `interface SaveFile { version: number; rev: number; savedAt: string; payload: GameState }`
  - `interface SaveRepository { load(): Promise<SaveFile | null>; save(file: SaveFile): Promise<void>; clear(): Promise<void> }`
  - `class JsonSaveRepository implements SaveRepository { constructor(dataDir: string, clock?: () => number) }`
  - 常量 `SAVE_FILE = "save.json"`、`SNAPSHOT_KEEP_DAYS = 7`

- [ ] **Step 1: 写失败的测试**

覆盖五个行为（文件名 `saveRepository.test.ts`，每个用 `mkdtemp` 建临时目录，`afterEach` 清理）：

```ts
it("保存后能原样读回", ...)          // save(file) → load() 深等于 file
it("主文件损坏时回退 .bak", ...)     // 先 save 两次，破坏 save.json 内容，load 返回上一份
it("每次覆盖前保留上一份为 .bak", ...)
it("同一天只生成一份快照，超过 7 天清理", ...)  // 注入 fake clock 到构造函数
it("目录为空时 load 返回 null", ...)
```

构造函数签名：`constructor(dataDir: string, clock: () => number = Date.now)`。

- [ ] **Step 2: 运行测试确认失败**

Run: `npm --prefix server test -- saveRepository`
Expected: 模块不存在或断言失败

- [ ] **Step 3: 实现仓储**

要点：

- `save`：`JSON.stringify(file)` → 写 `save.json.tmp` → `fh.sync()` → `rename`，rename 前若已有 `save.json` 则复制为 `save.json.bak`
- 快照：`clock()` 的本地日期变化后首次写入前，把当前 `save.json` 复制到 `snapshots/YYYY-MM-DD.json`；随后删除日期早于 7 天的快照文件
- `load`：读 `save.json` 并 `JSON.parse`；失败读 `.bak`；再失败返回 `null`
- `clear`：删除 `save.json`、`.bak` 与当日快照之外的快照不动

- [ ] **Step 4: 运行测试确认通过**

Run: `npm --prefix server test -- saveRepository`
Expected: 5 个用例 PASS

- [ ] **Step 5: 提交**

```bash
git add slow-farm-pc/server/src/store
git commit -m "feat(slow-farm-pc): JSON 存档仓储与每日快照"
```

---

## Task 3: 游戏引擎

**Files:**
- Create: `slow-farm-pc/server/src/state/engine.ts`
- Test: `slow-farm-pc/server/src/state/engine.test.ts`

**Interfaces:**
- Consumes: `JsonSaveRepository`（Task 2）、`server/core/slow-farm-core.js`、`slow-farm-rules.js`
- Produces:
  - `type ActionType = "plant" | "harvest" | ... | "visitTab" | "grantAdGems" | "grantPaidGems"`（白名单常量 `ACTION_TYPES`）
  - `interface ApplyOutcome { status: "ok" | "business" | "stale" | "unknown"; result?: unknown; reason?: string }`
  - `class GameEngine { constructor(repo: SaveRepository, now?: () => number); init(): Promise<void>; snapshot(): { state: GameState; rev: number }; apply(type: ActionType, args: Record<string, unknown>, rev: number): Promise<ApplyOutcome>; ensureDaily(): Promise<boolean>; importState(state: GameState, rev: number): Promise<ApplyOutcome>; reset(): Promise<void> }`

- [ ] **Step 1: 写失败的测试**

```ts
it("初始化时无存档则创建初始状态并落盘", ...)
it("plant 与 harvest 走 core 并递增 rev", ...)
it("业务失败返回 business 与 core 的 reason", ...)   // 空地块 harvest → empty_plot
it("未知动作返回 unknown，状态不变", ...)
it("rev 不匹配返回 stale 且不修改存档", ...)
it("跨天后 ensureDaily 生成新订单并递增 rev", ...)   // 用可变 clock
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm --prefix server test -- engine`

- [ ] **Step 3: 实现引擎**

要点：

- `init`：`repo.load()`；为空或解析失败则 `core.createState(RULES, Math.random)`，`rev = 1` 并落盘
- `apply`：先 `ensureDaily`；`rev !== this.rev` 返回 `stale`；查 `ACTION_TYPES`；调用对应 core 函数（参数从 `args` 取，`now = this.now()`）；成功后再调用 `core.evaluateAchievements(state, RULES)` 与 `core.evaluateTasks(state, RULES)`（与旧版 `slow-farm-app.js:84-85` 一致），然后 `rev + 1` 并 `repo.save`；业务失败不落盘
- `ensureDaily`：调用 `core.ensureDailyOrder(state, now, RULES)`；若状态变化则落盘并 `rev + 1`
- `importState`：校验 `version` 与结构后替换内存状态、`rev + 1`、落盘；用于 `PUT /api/save`
- `reset`：重建初始状态、`rev = 1`、落盘

- [ ] **Step 4: 运行测试确认通过**

Run: `npm --prefix server test -- engine`
Expected: 6 个用例 PASS

- [ ] **Step 5: 提交**

```bash
git add slow-farm-pc/server/src/state
git commit -m "feat(slow-farm-pc): 服务端游戏引擎"
```

---

## Task 4: HTTP 接口

**Files:**
- Create: `slow-farm-pc/server/src/app.ts`
- Create: `slow-farm-pc/server/src/routes/action.ts`
- Create: `slow-farm-pc/server/src/routes/save.ts`
- Create: `slow-farm-pc/server/src/routes/meta.ts`
- Create: `slow-farm-pc/server/src/index.ts`
- Test: `slow-farm-pc/server/src/app.test.ts`

**Interfaces:**
- Consumes: `GameEngine`（Task 3）
- Produces:
  - `buildApp(engine: GameEngine, opts?: { clientDist?: string }): FastifyInstance`
  - 路由契约：`POST /api/action`、`GET /api/save`、`PUT /api/save`、`DELETE /api/save`、`GET /api/meta`
  - `GET /api/meta` 返回 `{ rulesVersion, saveVersion, rules, rev, startedAt }`

- [ ] **Step 1: 写失败的测试（fastify.inject）**

```ts
it("POST /api/action 成功返回 state 与 rev", ...)
it("未知 type 返回 400", ...)
it("rev 过期返回 409 并携带最新 state", ...)
it("无存档时 GET /api/save 返回 204，之后返回 200", ...)
it("PUT /api/save 导入状态并递增 rev", ...)
it("GET /api/meta 含完整 rules 与 saveVersion=5", ...)
it("DELETE /api/save 重建初始状态", ...)
it("引擎抛错时不泄露堆栈，返回 500 与通用文案", ...)
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm --prefix server test -- app`

- [ ] **Step 3: 实现路由与启动**

- `action`：body 校验 `type: string`、`args: object`、`rev: number`；映射 `ApplyOutcome.status`：`ok|business` → 200，`stale` → 409，`unknown` → 400
- `save`：GET 返回引擎快照；没有存档时 204；PUT 调用 `engine.importState`
- `meta`：启动时记录一次 `startedAt`；`rules` 直接返回 `RULES`
- `index.ts`：读 `PORT`（默认 8787），`listen({ host: "127.0.0.1", port })`，启动时 `engine.init()`；监听失败且 `code === "EADDRINUSE"` 时打印"端口被占用，请用 PORT 环境变量换一个"，以非零码退出
- `buildApp` 收到 `clientDist` 时注册 `@fastify/static` 托管该目录，未提供时不注册（开发期由 Vite 托管）
- 全局错误处理器：日志记录原始错误，响应 `{ ok: false, reason: "internal" }`

- [ ] **Step 4: 运行测试确认通过**

Run: `npm --prefix server test -- app`
Expected: 7 个用例 PASS

- [ ] **Step 5: 提交**

```bash
git add slow-farm-pc/server/src
git commit -m "feat(slow-farm-pc): HTTP 动作与存档接口"
```

---

## Task 5: 前端骨架与"种/收"链路（M0）

**Files:**
- Create: `slow-farm-pc/client/package.json`
- Create: `slow-farm-pc/client/vite.config.ts`
- Create: `slow-farm-pc/client/tsconfig.json`
- Create: `slow-farm-pc/client/index.html`
- Create: `slow-farm-pc/client/src/main.ts`
- Create: `slow-farm-pc/client/src/api/client.ts`
- Create: `slow-farm-pc/client/src/state/store.ts`
- Create: `slow-farm-pc/client/src/display/format.ts`
- Create: `slow-farm-pc/client/src/scenes/FarmScene.ts`
- Test: `slow-farm-pc/client/src/state/store.test.ts`
- Test: `slow-farm-pc/client/src/display/format.test.ts`

**Interfaces:**
- Consumes: 服务端接口（Task 4）
- Produces:
  - `api.getMeta(): Promise<Meta>`、`api.getSave(): Promise<{state,rev} | null>`、`api.postAction(type, args, rev): Promise<ActionResponse>`
  - `class GameStore { constructor(api, rules); async load(): Promise<void>; get state(); get rev(); async action(type, args): Promise<{ ok: boolean; reason?: string }>; subscribe(fn): () => void }`
  - `levelOf(xp, rules): number`、`remainingMs(readyAt, now): number`、`formatDuration(ms): string`
  - 常量 `EXPECTED_SAVE_VERSION = 5`
  - `FarmScene`：渲染地块网格，点击空地 `plant`、成熟地块 `harvest`

- [ ] **Step 1: 写失败的测试**

```ts
// format.test.ts
it("levelOf 按规则表换算等级", ...)
it("formatDuration 输出 分:秒", ...)
// store.test.ts（用 stub api）
it("action 成功后替换 state 与 rev 并通知订阅者", ...)
it("409 时用返回状态刷新且不抛错", ...)
it("业务失败返回 reason 且状态不变", ...)
it("服务端不可达时 action 返回 server_unreachable", ...)
it("meta.saveVersion 与客户端期望版本不一致时 store 进入只读错误态", ...)
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm --prefix client test`
Expected: 模块不存在

- [ ] **Step 3: 实现骨架**

- `vite.config.ts`：`server.proxy['/api'] = 'http://127.0.0.1:8787'`
- `api/client.ts`：`fetch` 封装；网络失败时抛出带 `reason: "server_unreachable"` 的错误
- `store.ts`：持有 `state/rev/rules`；`action` 调 `postAction`，`ok` 或 409 时替换状态并通知；启动时校验 `meta.saveVersion === EXPECTED_SAVE_VERSION`（常量 5），不一致则进入只读错误态
- `FarmScene`：8x6 占位方块；`pointerdown` 判断地块状态并调用 store；服务端不可达时在画面中央显示"后端未启动"提示
- 统一 `reason` → 中文文案映射表（含 `server_unreachable`、`stale_rev`、`version_mismatch` 与 core 的业务 reason）
- `main.ts`：`getMeta` → `getSave`（204 则等第一次动作）→ 启动 Phaser

- [ ] **Step 4: 运行测试与手动验证**

Run: `npm --prefix client test`
Expected: 5 个用例 PASS

Run: `npm run dev`，打开 `http://127.0.0.1:5173`，点击空地应种下小麦；刷新页面后地块仍在（存档来自服务端）

- [ ] **Step 5: 提交**

```bash
git add slow-farm-pc/client
git commit -m "feat(slow-farm-pc): 前端骨架与种植链路"
```

---

## Task 6: M1 种植闭环

**Files:**
- Create: `slow-farm-pc/client/src/scenes/PlotView.ts`
- Create: `slow-farm-pc/client/src/ui/Hud.ts`
- Create: `slow-farm-pc/client/src/ui/SiloPanel.ts`
- Modify: `slow-farm-pc/client/src/scenes/FarmScene.ts`
- Modify: `slow-farm-pc/client/src/main.ts`
- Test: `slow-farm-pc/client/src/scenes/plotView.test.ts`

**Interfaces:**
- Consumes: `GameStore`、`format`（Task 5）
- Produces:
  - `plotStage(state, plot, now): "empty" | "growing" | "ready"`（纯函数）
  - `PlotView`：每块地的 sprite、生长阶段切换、收获粒子
  - `SiloPanel`：库存列表与"出售"按钮，调 `sellItem`

- [ ] **Step 1: 写失败的测试**

```ts
it("空地返回 empty", ...)
it("未成熟返回 growing", ...)
it("到点返回 ready", ...)
it("成熟后过很久仍是 ready", ...)
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm --prefix client test -- plotView`

- [ ] **Step 3: 实现**

- `plotStage`：`cropId` 为空 → `empty`；`now < readyAt` → `growing`；否则 `ready`
- `FarmScene`：按 `plotStage` 切换占位色块与文字；收获时在点击位置播 10 个粒子和"金币 +N"文字，数值取服务端返回的 `result`
- `Hud`：金币、宝石、等级、沙漏，订阅 store
- `SiloPanel`：HTML 覆盖层，列出 `state.silo` 与单价，点击出售
- 轮询：`setInterval` 每 5 秒 `GET /api/save` 替换状态；`visibilitychange` 变为可见时立即拉取一次；页面隐藏时停止轮询

- [ ] **Step 4: 运行测试与手动验证**

Run: `npm --prefix client test`
Expected: 4 个新用例 PASS

Manual: 种满地块 → 成熟 → 收获 → 仓库有货 → 出售金币增加；刷新后状态保持

- [ ] **Step 5: 提交**

```bash
git add slow-farm-pc/client
git commit -m "feat(slow-farm-pc): 种植、仓库与出售闭环"
```

---

## Task 7: M2 机器与订单

**Files:**
- Create: `slow-farm-pc/client/src/ui/MachinePanel.ts`
- Create: `slow-farm-pc/client/src/ui/OrdersPanel.ts`
- Create: `slow-farm-pc/client/src/display/viewModels.ts`
- Modify: `slow-farm-pc/client/src/scenes/FarmScene.ts`（建筑点击区域）
- Test: `slow-farm-pc/client/src/display/viewModels.test.ts`

**Interfaces:**
- Consumes: `GameStore`、`RULES`
- Produces:
  - `machineView(state, id, now): { queue: Array<{ recipeId, name, remaining, done }>; canAdd: boolean }`
  - `orderView(state, now): Array<{ id, lines: Array<{ name, have, need, ok }>; coins; xp; deliverable: boolean }>`

- [ ] **Step 1: 写失败的测试**

```ts
it("机器队列按剩余时间升序并标记完成项", ...)
it("订单行正确计算 have/need", ...)
it("物料齐备时 deliverable 为 true", ...)
it("每日订单在列表中单独标记", ...)
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm --prefix client test -- viewModels`

- [ ] **Step 3: 实现**

- 两个 view model 只做展示换算，不改变状态
- `MachinePanel`：九个机器分组；未建机器显示"建造"；队列支持放入配方、收取
- `OrdersPanel`：订单卡片、交付按钮、每日订单高亮；`abandonOrder` 与 `buyOrderSlot` 入口
- `FarmScene`：建筑 sprite 点击打开对应面板
- 面板切换时调用 `visitTab` 动作（任务链依赖 `tabsSeen`；只在首次打开某页签时调用，避免每次切换都写盘）

- [ ] **Step 4: 运行测试与手动验证**

Run: `npm --prefix client test`
Expected: 4 个新用例 PASS

Manual: 种麦 → 磨面粉 → 交订单 → 金币与经验增加；每日订单显示并可再生

- [ ] **Step 5: 提交**

```bash
git add slow-farm-pc/client
git commit -m "feat(slow-farm-pc): 机器队列与订单面板"
```

---

## Task 8: M3 养殖与外围

**Files:**
- Create: `slow-farm-pc/client/src/ui/AnimalPanel.ts`
- Create: `slow-farm-pc/client/src/ui/AchievementsPanel.ts`
- Create: `slow-farm-pc/client/src/ui/ShopPanel.ts`
- Modify: `slow-farm-pc/client/src/scenes/FarmScene.ts`（畜舍与商店入口）
- Test: `slow-farm-pc/client/src/display/animalView.test.ts`

**Interfaces:**
- Consumes: `GameStore`、`RULES`
- Produces:
  - `animalView(state, kind, now): { animals: Array<{ index, state: "hungry"|"growing"|"ready", remaining }>; canFeed: boolean; canCollect: boolean; canRush: boolean }`
  - `achievementView(state, rules): Array<{ id, title, progress, goal, done, reward }>`
  - `ShopPanel`：宝石购买、沙漏购买、广告奖励（调用 `grantAdGems`）

- [ ] **Step 1: 写失败的测试**

```ts
it("动物三态判定与剩余时间", ...)
it("全部喂食/收取可用性判断", ...)
it("成就进度不超过目标值", ...)
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm --prefix client test -- animalView`

- [ ] **Step 3: 实现**

- `AnimalPanel`：三种畜舍，喂食/收取/加速（复用 `useHourglass` 的 animal 目标与 `useHourglassOnAnimals`）
- `AchievementsPanel`：成就与任务链进度展示；结算由服务端在每次动作后自动完成（Task 3），前端只读
- `ShopPanel`：宝石、沙漏、广告奖励
- `FarmScene`：畜舍与商店建筑可点击，动物 sprite 按状态切换

- [ ] **Step 4: 运行测试与手动验证**

Run: `npm --prefix client test`
Expected: 3 个新用例 PASS

Manual: 买鸡 → 喂食 → 等待/加速 → 收蛋；任务链能依次推进

- [ ] **Step 5: 提交**

```bash
git add slow-farm-pc/client
git commit -m "feat(slow-farm-pc): 养殖、成就与商店"
```

---

## Task 9: 启动脚本与文档

**Files:**
- Create: `slow-farm-pc/README.md`
- Create: `slow-farm-pc/server/src/logging.ts`
- Modify: `slow-farm-pc/package.json`（`start` 脚本）

**Interfaces:**
- Consumes: 全部既有模块
- Produces: `npm start`（构建前端并启动服务端）、服务端日志文件

- [ ] **Step 1: 写失败的测试**

```ts
// logging.test.ts
it("日志按行追加并保留 7 天", ...)
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm --prefix server test -- logging`

- [ ] **Step 3: 实现**

- `logging.ts`：写 `data/server.log`，超过 7 天的行在启动时裁剪
- `README.md`：安装、`npm run dev`、`npm start`、端口修改、存档位置与快照恢复方法
- `start` 脚本：`npm --prefix client run build && npm --prefix server run start`；`server/src/index.ts` 在 `start` 模式下传入 `clientDist: ../client/dist`，由 `@fastify/static` 托管

- [ ] **Step 4: 验证**

Run: `npm start`，打开 `http://127.0.0.1:8787/slow-farm`（由 server 静态托管 `client/dist`），确认可玩、日志有写入

- [ ] **Step 5: 提交**

```bash
git add slow-farm-pc
git commit -m "feat(slow-farm-pc): 启动脚本、日志与文档"
```

---

## 后续（不在本计划内）

- M4 表现打磨：等美术方向（像素 / 扁平 / 等距）确定后单独出计划
- M5 可选：桌面打包（Tauri/Electron）、移动端适配、旧档导入
