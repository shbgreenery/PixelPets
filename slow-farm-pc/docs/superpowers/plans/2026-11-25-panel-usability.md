# 机器与养殖面板易用性改造 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把机器与养殖从"一条长列表"改成"左侧状态索引 + 右侧单对象操作台"，让加料、收取、喂食、加速在选中对象后一步完成。

**Architecture:** 服务端按 `plantAll`/`harvestAll` 的既有模式新增三个批量动作，状态改变仍只在服务端；客户端新增纯函数判定机器状态与分组、配方短缺文案、畜舍聚合计数；两个面板重写为相同的左右分栏骨架，选中与折叠状态保存在面板实例上以抵抗 5 秒轮询的全量重渲染。

**Tech Stack:** TypeScript、原生 DOM、Vitest + jsdom（客户端）、Node assert 脚本（core）、Fastify（服务端）

**Spec:** `docs/superpowers/specs/2026-11-25-panel-usability-design.md`

## Global Constraints

- 所有回复、代码注释、提交信息使用中文；代码与日志禁止 emoji。
- 面板尺寸按 1280×720 设计单位书写，颜色只取 `client/src/display/theme.ts` 的 token，不写字面色号。
- 状态只能由服务端改变；客户端一律通过 `store.action(type, args)` 提交。
- 面板在 `store.subscribe` 后会被 5 秒轮询触发的全量重渲染刷新；选中项与折叠状态必须存在实例字段，不能只存在 DOM 上。
- 动作失败统一用 `display/format.ts` 的 `reasonText` 转成中文，不新增文案表。
- 不修改存档结构、`GameStore`、`api/client.ts`、订单/成就/商店/农场/仓库面板。
- core 测试是断言脚本，加载即执行；新增用例放新文件，不修改既有大文件。

## Review Focus

- **仓库已满时一键收取**：应跳过收不下的任务并返回 `skipped`，不能丢物品、不能报错、不能中断后续机器。
- **多配方机器材料只够其中一个**：`enqueueAll` 必须跳过材料不够的配方继续尝试下一个，不能在全表第一个配方失败后就停止整台机器。
- **未解锁配方**：右栏必须显示"需 Lv.N"+ `[解锁]`，不能显示可点的 `[放入]`。
- **轮询后选中项消失**（存档被替换或重置）：回退到 `firstSelectable`，不能白屏或保留一个不存在的详情。
- **沙漏为 0 时加速**：一键与单机按钮都必须禁用，不能发出必然失败的请求。

---

## File Structure

**服务端**

- Modify: `server/core/slow-farm-core.js` — 新增三个批量函数与导出
- Create: `server/core/tests/machine-batch.test.js` — 三个批量函数的断言用例
- Modify: `server/src/state/engine.ts` — 动作白名单与 handler
- Modify: `server/src/state/engine.test.ts` — 批量动作接线用例

**客户端展示层**

- Create: `client/src/display/machineStatus.ts` — 机器状态判定、分组、首次选中
- Create: `client/src/display/machineStatus.test.ts`
- Modify: `client/src/display/viewModels.ts` — 新增 `recipeShortfall`
- Modify: `client/src/display/viewModels.test.ts`
- Modify: `client/src/display/animalView.ts` — 新增 `counts` 与 `herdSummary`
- Modify: `client/src/display/animalView.test.ts`

**客户端面板**

- Modify: `client/src/ui/panelStyles.ts` — 分栏骨架共享样式
- Modify: `client/src/ui/MachinePanel.ts` — 重写
- Create: `client/src/ui/MachinePanel.test.ts`
- Modify: `client/src/ui/AnimalPanel.ts` — 重写
- Create: `client/src/ui/AnimalPanel.test.ts`

---

## Task 1: 服务端 core — 一键收取所有机器

**Files:**
- Modify: `server/core/slow-farm-core.js`（在 `collectReady` 之后新增，并在文件底部 `CORE` 对象中导出）
- Create: `server/core/tests/machine-batch.test.js`

**Interfaces:**
- Consumes: 既有 `collectReady(state, machineId, nowMs, rules)`，返回 `{ ok, items, collected, skipped }` 或 `{ ok:false, reason }`
- Produces: `collectAllMachines(state, nowMs, rules) → { ok: true, items: Record<string, number>, collected: number, skipped: number }`

- [ ] **Step 1: 写失败用例**

创建 `server/core/tests/machine-batch.test.js`：

```js
'use strict';
const assert = require('assert');
const rules = require('../slow-farm-rules.js');
const core = require('../slow-farm-core.js');

function makeState() {
  const state = core.createState(rules, () => 0);
  state.machines = {
    mill: { unlocked: true, queueSize: 2, queue: [{ recipeId: 'flour', startedAt: 0, readyAt: 100 }] },
    bakery: { unlocked: true, queueSize: 2, queue: [{ recipeId: 'bread', startedAt: 0, readyAt: 100 }] },
  };
  state.silo = {};
  state.siloSlots = rules.SILO.initial;
  state.stats = { ...state.stats, crafted: 0 };
  return state;
}

// 两台机器的完成项都会被收进仓库
const s = makeState();
const r = core.collectAllMachines(s, 200, rules);
assert.strictEqual(r.ok, true);
assert.strictEqual(r.collected, 2);
assert.strictEqual(r.skipped, 0);
assert.strictEqual(r.items.flour, 1);
assert.strictEqual(r.items.bread, 1);
assert.strictEqual(s.silo.flour, 1);
assert.strictEqual(s.machines.mill.queue.length, 0);
assert.strictEqual(s.machines.bakery.queue.length, 0);

// 仓库满时跳过收不下的任务，已收的不回滚
const full = makeState();
full.silo = { wheat: 1 };
full.siloSlots = 1;
const r2 = core.collectAllMachines(full, 200, rules);
assert.strictEqual(r2.ok, true);
assert.strictEqual(r2.collected, 0);
assert.strictEqual(r2.skipped, 2);
assert.strictEqual(full.machines.mill.queue.length, 1, '收不下时任务留在队列里');

// 没有完成项时返回 0，不报错
const idle = makeState();
idle.machines.mill.queue = [];
idle.machines.bakery.queue = [];
const r3 = core.collectAllMachines(idle, 200, rules);
assert.deepStrictEqual(r3, { ok: true, items: {}, collected: 0, skipped: 0 });

console.log('machine-batch collectAllMachines 通过');
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node server/scripts/run-core-tests.mjs`
Expected: 失败，`TypeError: core.collectAllMachines is not a function`

- [ ] **Step 3: 实现**

在 `slow-farm-core.js` 的 `collectReady` 之后新增：

```js
// 遍历所有机器收取已完成任务；仓库满的任务留在队列里，计入 skipped。
function collectAllMachines(state, nowMs, rules) {
  const items = {};
  let collected = 0;
  let skipped = 0;
  for (const machineId of Object.keys(state.machines)) {
    const result = collectReady(state, machineId, nowMs, rules);
    if (!result.ok) continue;
    collected += result.collected;
    skipped += result.skipped;
    for (const [itemId, quantity] of Object.entries(result.items)) {
      items[itemId] = (items[itemId] || 0) + quantity;
    }
  }
  return { ok: true, items, collected, skipped };
}
```

并在 `CORE` 导出对象中加入 `collectAllMachines,`。

- [ ] **Step 4: 运行测试确认通过**

Run: `node server/scripts/run-core-tests.mjs`
Expected: 全部通过，输出包含 `machine-batch collectAllMachines 通过`

- [ ] **Step 5: 提交**

```bash
git add server/core/slow-farm-core.js server/core/tests/machine-batch.test.js
git commit -m "feat(slow-farm-pc): 新增一键收取所有机器的 core 动作"
```

---

## Task 2: 服务端 core — 一键加料

**Files:**
- Modify: `server/core/slow-farm-core.js`
- Modify: `server/core/tests/machine-batch.test.js`

**Interfaces:**
- Consumes: 既有 `enqueue(state, machineId, recipeId, nowMs, rules)`
- Produces: `enqueueAll(state, nowMs, rules) → { ok: true, queued: number, blocked: string | null }`

- [ ] **Step 1: 追加失败用例**

在 `machine-batch.test.js` 末尾追加：

```js
// 一键加料：每台机器反复放入首个材料足够的已解锁配方，直到队列满或材料耗尽
const e = makeState();
e.machines = {
  mill: { unlocked: true, queueSize: 2, queue: [] },
  bakery: { unlocked: true, queueSize: 2, queue: [] },
};
e.silo = { wheat: 4, flour: 1 };
e.unlockedRecipes = { flour: true, bread: true };
const q = core.enqueueAll(e, 0, rules);
assert.strictEqual(q.ok, true);
assert.strictEqual(q.queued, 3, '磨坊放 2 份面粉，面包房放 1 份面包后缺面粉');
assert.strictEqual(e.machines.mill.queue.length, 2);
assert.strictEqual(e.machines.bakery.queue.length, 1);
assert.strictEqual(q.blocked, 'missing_input');

// 多配方机器：第一个配方材料不够时继续尝试下一个。
// 真实规则里 bakery 的两个配方都需要 flour，构造不出"前者不够、后者够"，因此用精简规则表。
const multiRules = {
  ...rules,
  RECIPES: {
    bread: { name: '面包', machine: 'bakery', input: { flour: 5 }, ms: 1000, output: { bread: 1 }, unlockLevel: 1 },
    cornBread: { name: '玉米面包', machine: 'bakery', input: { corn: 1 }, ms: 1000, output: { cornBread: 1 }, unlockLevel: 1 },
  },
};
const multi = makeState();
multi.machines = { bakery: { unlocked: true, queueSize: 2, queue: [] } };
multi.silo = { corn: 1 };
multi.unlockedRecipes = { bread: true, cornBread: true };
const q2 = core.enqueueAll(multi, 0, multiRules);
assert.strictEqual(q2.queued, 1, '应跳过缺面包原料的面包，放入玉米面包');
assert.strictEqual(multi.machines.bakery.queue[0].recipeId, 'cornBread');

// 队列已满时不放入，blocked 为 null
const full = makeState();
full.machines = { mill: { unlocked: true, queueSize: 1, queue: [{ recipeId: 'flour', startedAt: 0, readyAt: 1 }] } };
full.silo = { wheat: 10 };
full.unlockedRecipes = { flour: true };
const q3 = core.enqueueAll(full, 0, rules);
assert.strictEqual(q3.queued, 0);
assert.strictEqual(q3.blocked, null);

// 未建造的机器不参与
const locked = makeState();
locked.machines = { mill: { unlocked: false, queueSize: 2, queue: [] } };
locked.silo = { wheat: 10 };
locked.unlockedRecipes = { flour: true };
assert.strictEqual(core.enqueueAll(locked, 0, rules).queued, 0);

console.log('machine-batch enqueueAll 通过');
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node server/scripts/run-core-tests.mjs`
Expected: 失败，`TypeError: core.enqueueAll is not a function`

- [ ] **Step 3: 实现**

在 `collectAllMachines` 之后新增：

```js
// 按配方定义顺序找该机器第一个已解锁且材料足够的配方；没有则返回 null。
function autoRecipe(state, machineId, rules) {
  for (const [recipeId, recipe] of Object.entries(rules.RECIPES)) {
    if (recipe.machine !== machineId) continue;
    if (!state.unlockedRecipes[recipeId]) continue;
    const enough = Object.entries(recipe.input)
      .every(function (entry) { return (state.silo[entry[0]] || 0) >= entry[1]; });
    if (enough) return recipeId;
  }
  return null;
}

// 每台已建机器反复放入自动配方，直到队列满或材料耗尽；材料不足的机器跳过继续下一台。
function enqueueAll(state, nowMs, rules) {
  let queued = 0;
  let blocked = null;
  for (const machineId of Object.keys(state.machines)) {
    const machine = state.machines[machineId];
    if (!machine.unlocked) continue;
    while (machine.queue.length < machine.queueSize) {
      const recipeId = autoRecipe(state, machineId, rules);
      if (recipeId === null) {
        if (blocked === null) blocked = 'missing_input';
        break;
      }
      const result = enqueue(state, machineId, recipeId, nowMs, rules);
      if (!result.ok) {
        if (blocked === null) blocked = result.reason;
        break;
      }
      queued += 1;
    }
  }
  return { ok: true, queued, blocked };
}
```

并在 `CORE` 导出对象中加入 `enqueueAll,`。

- [ ] **Step 4: 运行测试确认通过**

Run: `node server/scripts/run-core-tests.mjs`
Expected: 输出包含 `machine-batch enqueueAll 通过`

- [ ] **Step 5: 提交**

```bash
git add server/core/slow-farm-core.js server/core/tests/machine-batch.test.js
git commit -m "feat(slow-farm-pc): 新增一键加料的 core 动作"
```

---

## Task 3: 服务端 core — 一键加速机器

**Files:**
- Modify: `server/core/slow-farm-core.js`
- Modify: `server/core/tests/machine-batch.test.js`

**Interfaces:**
- Consumes: 既有 `useHourglass(state, { kind: 'machine', id }, nowMs, rules)`
- Produces: `useHourglassOnMachines(state, nowMs, rules) → { ok: true, used: number, stopped: string | null }`

- [ ] **Step 1: 追加失败用例**

在 `machine-batch.test.js` 末尾追加：

```js
// 一键加速：只有沙漏时才能加速生产中的机器，用完即停
const h = makeState();
h.machines = {
  mill: { unlocked: true, queueSize: 2, queue: [{ recipeId: 'flour', startedAt: 0, readyAt: 1000 }] },
  bakery: { unlocked: true, queueSize: 2, queue: [{ recipeId: 'bread', startedAt: 0, readyAt: 2000 }] },
};
h.hourglasses = 1;
const u = core.useHourglassOnMachines(h, 0, rules);
assert.strictEqual(u.ok, true);
assert.strictEqual(u.used, 1);
assert.strictEqual(u.stopped, 'no_hourglass');
assert.strictEqual(h.hourglasses, 0);

// 没有生产中的机器时不用沙漏
const calm = makeState();
calm.machines = { mill: { unlocked: true, queueSize: 2, queue: [] } };
calm.hourglasses = 3;
const u2 = core.useHourglassOnMachines(calm, 0, rules);
assert.strictEqual(u2.used, 0);
assert.strictEqual(u2.stopped, null);
assert.strictEqual(calm.hourglasses, 3);

console.log('machine-batch useHourglassOnMachines 通过');
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node server/scripts/run-core-tests.mjs`
Expected: 失败，`TypeError: core.useHourglassOnMachines is not a function`

- [ ] **Step 3: 实现**

在 `enqueueAll` 之后新增：

```js
// 依次加速生产中的机器；沙漏用完时停止并把原因带回。
function useHourglassOnMachines(state, nowMs, rules) {
  let used = 0;
  let stopped = null;
  for (const machineId of Object.keys(state.machines)) {
    const machine = state.machines[machineId];
    if (!machine.unlocked) continue;
    if (!machine.queue.some(function (job) { return job.readyAt > nowMs; })) continue;
    if (!(state.hourglasses > 0)) {
      stopped = 'no_hourglass';
      break;
    }
    const result = useHourglass(state, { kind: 'machine', id: machineId }, nowMs, rules);
    if (result.ok) used += 1;
  }
  return { ok: true, used, stopped };
}
```

并在 `CORE` 导出对象中加入 `useHourglassOnMachines,`。

- [ ] **Step 4: 运行测试确认通过**

Run: `node server/scripts/run-core-tests.mjs`
Expected: 输出包含 `machine-batch useHourglassOnMachines 通过`

- [ ] **Step 5: 提交**

```bash
git add server/core/slow-farm-core.js server/core/tests/machine-batch.test.js
git commit -m "feat(slow-farm-pc): 新增一键加速机器的 core 动作"
```

---

## Task 4: 服务端 — 注册三个批量动作

**Files:**
- Modify: `server/src/state/engine.ts`
- Modify: `server/src/state/engine.test.ts`

**Interfaces:**
- Consumes: Task 1–3 的 `core.collectAllMachines` / `core.enqueueAll` / `core.useHourglassOnMachines`
- Produces: 客户端可提交的动作字符串 `"collectAllMachines"` / `"enqueueAll"` / `"useHourglassOnMachines"`，均无参数

- [ ] **Step 1: 写失败用例**

在 `engine.test.ts` 的 `describe("GameEngine")` 中追加：

```ts
it("批量机器动作走 core 并递增 rev", async () => {
  const { engine } = await makeEngine(() => new Date(2026, 0, 1, 9, 0, 0).getTime());
  await engine.init();

  const outcome = await engine.apply("collectAllMachines", {}, 1);

  expect(outcome.status).toBe("ok");
  expect(outcome.result).toMatchObject({ collected: 0, skipped: 0 });
  expect(engine.snapshot().rev).toBe(2);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter ./server test -- engine.test.ts`
Expected: FAIL，`outcome.status` 为 `"unknown"`（动作不在白名单）

- [ ] **Step 3: 实现**

在 `ACTION_TYPES` 数组末尾追加：

```ts
  "collectAllMachines",
  "enqueueAll",
  "useHourglassOnMachines",
```

在 `handlers` 对象中追加（放在 `useHourglassOnAnimals` 之后）：

```ts
  collectAllMachines: (state, _args, now) => core.collectAllMachines(state, now, RULES),
  enqueueAll: (state, _args, now) => core.enqueueAll(state, now, RULES),
  useHourglassOnMachines: (state, _args, now) => core.useHourglassOnMachines(state, now, RULES),
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter ./server test`
Expected: 全部通过

- [ ] **Step 5: 提交**

```bash
git add server/src/state/engine.ts server/src/state/engine.test.ts
git commit -m "feat(slow-farm-pc): 注册机器批量动作到动作白名单"
```

---

## Task 5: 客户端 — 机器状态判定与分组

**Files:**
- Create: `client/src/display/machineStatus.ts`
- Create: `client/src/display/machineStatus.test.ts`

**Interfaces:**
- Produces：

```ts
export type MachineStatus = "collectable" | "addable" | "running" | "idle" | "unbuilt";

export interface MachineEntry {
  id: string;
  name: string;
  status: MachineStatus;
  built: boolean;
  queueLength: number;
  queueSize: number;
  readyCount: number;
  unlockLevel: number;
}

export type MachineGroupKey = "collectable" | "addable" | "running" | "unbuilt";

export interface MachineGroup {
  key: MachineGroupKey;
  title: string;
  entries: MachineEntry[];
}

export function machineEntries(state: GameState, now: number, rules: Rules): MachineEntry[];
export function groupMachines(entries: MachineEntry[]): MachineGroup[];
export function firstSelectable(groups: MachineGroup[]): string | null;
```

- 分组固定顺序与标题：`collectable/可收取`、`addable/可加料`、`running/生产中`、`unbuilt/未建造`。
- 状态优先级：`collectable`（有 `readyAt <= now` 的任务）> `addable`（队列未满且存在已解锁、材料足够的配方）> `running`（有未完成任务）> `idle`。
- `groupMachines` 总是返回 4 个组（可能为空数组）；`idle` 归入 `running` 组。
- `firstSelectable` 按组顺序返回第一个非空组的首条 `id`，全空返回 `null`。

- [ ] **Step 1: 写失败用例**

创建 `client/src/display/machineStatus.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import type { GameState, Rules } from "../api/client";
import { firstSelectable, groupMachines, machineEntries } from "./machineStatus";

const rules: Rules = {
  CROPS: {},
  ITEMS: {
    wheat: { name: "小麦", sellPrice: 2, unlockLevel: 1, category: "crop" },
    flour: { name: "面粉", sellPrice: 10, unlockLevel: 1, category: "product" },
    bread: { name: "面包", sellPrice: 30, unlockLevel: 1, category: "product" },
  },
  LEVELS: [0, 40, 120],
  MACHINES: {
    mill: { name: "磨坊", buildCost: 100, unlockLevel: 1 },
    bakery: { name: "面包房", buildCost: 200, unlockLevel: 2 },
  },
  RECIPES: {
    flour: { name: "面粉", machine: "mill", input: { wheat: 2 }, ms: 1000, output: { flour: 1 }, unlockLevel: 1 },
    bread: { name: "面包", machine: "bakery", input: { flour: 1 }, ms: 2000, output: { bread: 1 }, unlockLevel: 2 },
  },
};

function makeState(overrides: Partial<GameState> = {}): GameState {
  return {
    coins: 0,
    gems: 0,
    xp: 0,
    plots: [],
    silo: {},
    machines: {
      mill: { unlocked: true, queueSize: 2, queue: [] },
      bakery: { unlocked: false, queueSize: 2, queue: [] },
    },
    unlockedRecipes: { flour: true },
    ...overrides,
  };
}

describe("machineEntries", () => {
  it("按优先级判定单台机器状态", () => {
    const now = 10_000;

    const collectable = makeState({
      machines: { mill: { unlocked: true, queueSize: 2, queue: [{ recipeId: "flour", startedAt: 0, readyAt: now }] } },
      silo: { wheat: 4 },
    });
    expect(machineEntries(collectable, now, rules)[0]).toMatchObject({
      id: "mill",
      status: "collectable",
      readyCount: 1,
    });

    const addable = makeState({ silo: { wheat: 4 } });
    expect(machineEntries(addable, now, rules)[0].status).toBe("addable");

    const running = makeState({
      machines: { mill: { unlocked: true, queueSize: 2, queue: [{ recipeId: "flour", startedAt: 0, readyAt: now + 5000 }] } },
    });
    expect(machineEntries(running, now, rules)[0].status).toBe("running");

    const idle = makeState({ silo: {} });
    expect(machineEntries(idle, now, rules)[0].status).toBe("idle");

    expect(machineEntries(idle, now, rules)[1].status).toBe("unbuilt");
  });

  it("队列已满的机器不算可加料", () => {
    const state = makeState({
      machines: { mill: { unlocked: true, queueSize: 1, queue: [{ recipeId: "flour", startedAt: 0, readyAt: 5000 }] } },
      silo: { wheat: 8 },
    });
    expect(machineEntries(state, 10_000, rules)[0].status).toBe("running");
  });
});

describe("groupMachines 与 firstSelectable", () => {
  it("按固定顺序分组，idle 归入生产中", () => {
    const state = makeState({ silo: { wheat: 4 } });
    const groups = groupMachines(machineEntries(state, 0, rules));
    expect(groups.map((group) => group.key)).toEqual(["collectable", "addable", "running", "unbuilt"]);
    expect(groups[1].entries.map((entry) => entry.id)).toEqual(["mill"]);
    expect(groups[3].entries.map((entry) => entry.id)).toEqual(["bakery"]);
    expect(firstSelectable(groups)).toBe("mill");
  });

  it("全部为空时返回 null", () => {
    const groups = groupMachines([]);
    expect(groups).toHaveLength(4);
    expect(firstSelectable(groups)).toBeNull();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter ./client exec vitest run src/display/machineStatus.test.ts`
Expected: FAIL，模块不存在

- [ ] **Step 3: 实现 `client/src/display/machineStatus.ts`**

实现要点：

- `machineEntries` 遍历 `Object.entries(rules.MACHINES ?? {})`，保持规则表顺序。
- 机器状态取 `state.machines?.[id]`；`built = machine?.unlocked === true`。
- `readyCount` 与队列长度从 `machine.queue` 计算；`queueSize` 取 `machine.queueSize`，未建时取规则里的占位值 `0`。
- `addable` 判定复用本文件私有函数 `hasAffordableRecipe(state, id, rules)`：遍历 `rules.RECIPES`，匹配 `machine`、`state.unlockedRecipes?.[recipeId] === true`、且 `recipe.input` 每项 `(state.silo[itemId] ?? 0) >= quantity`。
- `groupMachines` 用固定 key 顺序建 4 个组，`running` 组同时接收 `running` 与 `idle`。
- `firstSelectable` 遍历组，返回第一个非空组的首条 id。

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter ./client exec vitest run src/display/machineStatus.test.ts`
Expected: 全部通过

- [ ] **Step 5: 提交**

```bash
git add client/src/display/machineStatus.ts client/src/display/machineStatus.test.ts
git commit -m "feat(slow-farm-pc): 新增机器状态分组纯函数"
```

---

## Task 6: 客户端 — 配方短缺文案

**Files:**
- Modify: `client/src/display/viewModels.ts`
- Modify: `client/src/display/viewModels.test.ts`

**Interfaces:**
- Produces: `recipeShortfall(state: GameState, recipeId: string, rules: Rules): string`

返回示例：`"还差 小麦×2、玉米×1"`；材料齐全或配方未知时返回 `""`。物品名取 `rules.ITEMS[itemId]?.name ?? itemId`，缺失数量 = `quantity - (state.silo[itemId] ?? 0)`。

- [ ] **Step 1: 写失败用例**

在 `viewModels.test.ts` 顶部 import 补上 `recipeShortfall`，然后追加：

```ts
describe("recipeShortfall", () => {
  const rules: Rules = {
    CROPS: {},
    ITEMS: {
      wheat: { name: "小麦", sellPrice: 2, unlockLevel: 1, category: "crop" },
      corn: { name: "玉米", sellPrice: 3, unlockLevel: 1, category: "crop" },
      flour: { name: "面粉", sellPrice: 10, unlockLevel: 1, category: "product" },
    },
    LEVELS: [0],
    RECIPES: {
      bread: { name: "面包", machine: "bakery", input: { flour: 2, corn: 1 }, ms: 1000, output: {}, unlockLevel: 1 },
    },
  };

  it("列出缺少的物品与数量", () => {
    const state = { coins: 0, gems: 0, xp: 0, plots: [], silo: { flour: 1 } } as GameState;
    expect(recipeShortfall(state, "bread", rules)).toBe("还差 面粉×1、玉米×1");
  });

  it("材料齐全或配方未知时为空串", () => {
    const state = { coins: 0, gems: 0, xp: 0, plots: [], silo: { flour: 2, corn: 1 } } as GameState;
    expect(recipeShortfall(state, "bread", rules)).toBe("");
    expect(recipeShortfall(state, "missing", rules)).toBe("");
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter ./client exec vitest run src/display/viewModels.test.ts`
Expected: FAIL，`recipeShortfall` 未导出

- [ ] **Step 3: 实现**

在 `viewModels.ts` 末尾新增 `recipeShortfall`，并在文件顶部确认已导入 `GameState`、`Rules`（现有文件已导入）。

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter ./client exec vitest run src/display/viewModels.test.ts`
Expected: 全部通过

- [ ] **Step 5: 提交**

```bash
git add client/src/display/viewModels.ts client/src/display/viewModels.test.ts
git commit -m "feat(slow-farm-pc): 新增配方材料短缺文案"
```

---

## Task 7: 客户端 — 畜舍聚合计数

**Files:**
- Modify: `client/src/display/animalView.ts`
- Modify: `client/src/display/animalView.test.ts`

**Interfaces:**
- `AnimalView` 增加 `counts: { hungry: number; growing: number; ready: number }`
- Produces: `herdSummary(counts: { hungry: number; growing: number; ready: number }): string`

摘要规则（按顺序取第一个命中的分支，最多显示两项）：

1. `ready > 0 && hungry > 0` → `可收取 N · 待喂食 M`
2. `ready > 0 && growing > 0` → `可收取 N · 产出中 M`
3. `hungry > 0 && growing > 0` → `待喂食 N · 产出中 M`
4. `ready > 0` → `可收取 N`
5. `hungry > 0` → `待喂食 N`
6. `growing > 0` → `产出中 N`
7. 否则 `"空"`

- [ ] **Step 1: 写失败用例**

在 `animalView.test.ts` 的 `describe("animalView")` 内追加：

```ts
it("畜舍聚合计数与摘要", () => {
  const now = 100_000;
  const state = makeState({
    silo: { feed: 1 },
    animals: {
      chicken: {
        slots: 4,
        list: [{ readyAt: 0 }, { readyAt: now + 30_000 }, { readyAt: now - 1_000 }],
      },
    },
  });

  const view = animalView(state, "chicken", now);
  expect(view.counts).toEqual({ hungry: 1, growing: 1, ready: 1 });
  expect(herdSummary(view.counts)).toBe("可收取 1 · 待喂食 1");
  expect(herdSummary({ hungry: 1, growing: 1, ready: 0 })).toBe("待喂食 1 · 产出中 1");
  expect(herdSummary({ hungry: 0, growing: 3, ready: 0 })).toBe("产出中 3");
  expect(herdSummary({ hungry: 0, growing: 0, ready: 0 })).toBe("空");
});
```

顶部 import 补 `herdSummary`。

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter ./client exec vitest run src/display/animalView.test.ts`
Expected: FAIL，`counts` 为 `undefined` 或 `herdSummary` 未导出

- [ ] **Step 3: 实现**

在 `animalView.ts` 中：

- 新增 `AnimalCounts` 接口与 `AnimalView.counts` 字段。
- `animalView` 遍历 animals 时统计三种状态计数。
- 新增 `herdSummary(counts: AnimalCounts): string`，按上述顺序返回文案。

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter ./client exec vitest run src/display/animalView.test.ts`
Expected: 全部通过

- [ ] **Step 5: 提交**

```bash
git add client/src/display/animalView.ts client/src/display/animalView.test.ts
git commit -m "feat(slow-farm-pc): 养殖视图新增畜舍聚合计数"
```

---

## Task 8: 机器面板 — 分栏骨架与左栏分组

**Files:**
- Modify: `client/src/ui/panelStyles.ts`（新增共享布局常量）
- Modify: `client/src/ui/MachinePanel.ts`（重写结构与左栏）
- Create: `client/src/ui/MachinePanel.test.ts`

**Interfaces:**
- Consumes: Task 5 的 `machineEntries` / `groupMachines` / `firstSelectable` 与 `MachineGroup`、`MachineEntry` 类型
- Produces: 左栏条目 DOM 约定，供后续任务与测试使用
  - 每个条目：`<button class="sf-side-item" data-machine-id="<id>" data-selected="true|false">`
  - 每个分组：`<div class="sf-side-group"><div class="sf-side-group-title">可收取 2</div>...</div>`
  - 详情区根：`<div class="sf-detail" data-detail-id="<id>">`；未选中时 `data-detail-id=""`
- Produces: 实例字段 `selectedId: string | null` 与 `collapsedGroups: Set<MachineGroupKey>`

- [ ] **Step 1: 写失败用例**

创建 `client/src/ui/MachinePanel.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import type { ActionResponse, GameState, Meta, Rules, SaveSnapshot } from "../api/client";
import { GameStore, type StoreApi } from "../state/store";
import { MachinePanel } from "./MachinePanel";

const rules: Rules = {
  CROPS: {},
  ITEMS: {
    wheat: { name: "小麦", sellPrice: 2, unlockLevel: 1, category: "crop" },
    flour: { name: "面粉", sellPrice: 10, unlockLevel: 1, category: "product" },
  },
  LEVELS: [0, 40],
  MACHINES: {
    mill: { name: "磨坊", buildCost: 100, unlockLevel: 1 },
    bakery: { name: "面包房", buildCost: 200, unlockLevel: 2 },
  },
  RECIPES: {
    flour: { name: "面粉", machine: "mill", input: { wheat: 2 }, ms: 60_000, output: { flour: 1 }, unlockLevel: 1 },
    bread: { name: "面包", machine: "bakery", input: { flour: 1 }, ms: 60_000, output: { bread: 1 }, unlockLevel: 2 },
  },
};

const meta: Meta = {
  rulesVersion: "test",
  saveVersion: 5,
  rules,
  rev: 1,
  startedAt: "2026-11-25T00:00:00.000Z",
};

function makeState(): GameState {
  return {
    coins: 1_000,
    gems: 0,
    // 100 点经验对应等级 2（LEVELS 为 [0, 40]），面包房的建造按钮才可用。
    xp: 100,
    plots: [],
    silo: { wheat: 4 },
    machines: {
      mill: { unlocked: true, queueSize: 2, queue: [] },
      bakery: { unlocked: false, queueSize: 2, queue: [] },
    },
    unlockedRecipes: { flour: true },
  };
}

function setup() {
  const state = makeState();
  const calls: Array<{ type: string; args: Record<string, unknown> }> = [];
  const api: StoreApi = {
    getMeta: async () => meta,
    getSave: async (): Promise<SaveSnapshot> => ({ state, rev: 1 }),
    postAction: async (type, args): Promise<ActionResponse> => {
      calls.push({ type, args });
      return { ok: false, reason: "unused" };
    },
  };
  const store = new GameStore(api, rules);
  const panel = new MachinePanel(store);
  return { store, panel, calls };
}

function select(id: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(`#machine-panel [data-machine-id="${id}"]`);
  if (!found) throw new Error(`未找到机器 ${id}`);
  return found;
}

describe("MachinePanel 左栏", () => {
  it("按状态分组渲染，默认选中可加料的机器", async () => {
    const { store, panel } = setup();
    await store.load(meta);
    panel.open();

    expect(document.querySelector("#machine-panel")!.textContent).toContain("可加料 1");
    expect(document.querySelector("#machine-panel")!.textContent).toContain("未建造 1");
    expect(select("mill").dataset.selected).toBe("true");
    expect(document.querySelector("#machine-panel .sf-detail")!.getAttribute("data-detail-id")).toBe("mill");

    panel.destroy();
  });

  it("点击左栏切换详情", async () => {
    const { store, panel } = setup();
    await store.load(meta);
    panel.open();

    select("bakery").click();

    expect(select("bakery").dataset.selected).toBe("true");
    expect(select("mill").dataset.selected).toBe("false");
    expect(document.querySelector("#machine-panel .sf-detail")!.getAttribute("data-detail-id")).toBe("bakery");

    panel.destroy();
  });

  it("点击分组标题折叠该组条目", async () => {
    const { store, panel } = setup();
    await store.load(meta);
    panel.open();

    const title = Array.from(document.querySelectorAll<HTMLElement>("#machine-panel .sf-side-group-title"))
      .find((element) => element.textContent?.includes("未建造"));
    if (!title) throw new Error("未找到未建造分组");
    title.click();

    expect(document.querySelector('#machine-panel [data-machine-id="bakery"]')).toBeNull();

    title.click();
    expect(document.querySelector('#machine-panel [data-machine-id="bakery"]')).not.toBeNull();

    panel.destroy();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter ./client exec vitest run src/ui/MachinePanel.test.ts`
Expected: FAIL，找不到 `.sf-side-item` 或 `data-detail-id`

- [ ] **Step 3: 实现**

**先**在 `panelStyles.ts` 新增并导出：

```ts
// 左右分栏卡片：固定高度、内部各自滚动，避免整卡滚动导致左栏索引滚出视野。
export const SPLIT_CARD_STYLE = [
  CARD_STYLE,
  "width: min(680px, 92%)",
  "height: calc(100% - 96px)",
  "display: flex",
  "flex-direction: column",
  "overflow: hidden",
  "box-sizing: border-box",
].join(";");

export const QUICK_BAR_STYLE = [
  "display: flex",
  "align-items: center",
  "gap: 8px",
  "padding: 0 0 10px",
  `border-bottom: 1px solid ${COLORS.panelBorder}`,
  "flex: none",
].join(";");

export const SPLIT_BODY_STYLE = [
  "display: grid",
  "grid-template-columns: 160px minmax(0, 1fr)",
  "gap: 12px",
  "flex: 1 1 auto",
  "min-height: 0",
].join(";");

export const SIDE_LIST_STYLE = "overflow-y: auto; min-height: 0; padding-right: 2px";

export const SIDE_GROUP_TITLE_STYLE = [
  "display: flex",
  "align-items: center",
  "justify-content: space-between",
  "padding: 6px 4px 4px",
  `font-size: ${FONT_SIZE.xs}px`,
  `color: ${COLORS.muted}`,
  "letter-spacing: 0.04em",
  "cursor: pointer",
  "user-select: none",
].join(";");

export const SIDE_ITEM_STYLE = [
  "display: flex",
  "align-items: center",
  "gap: 6px",
  "width: 100%",
  "height: 32px",
  "padding: 0 8px",
  "border: 1px solid transparent",
  "border-radius: 8px",
  "background: transparent",
  `color: ${COLORS.subtle}`,
  "font: inherit",
  "text-align: left",
  "cursor: pointer",
].join(";");

export const SIDE_ITEM_ACTIVE = [
  `background: ${SURFACE.activeAmber}`,
  `border-color: ${COLORS.panelBorderStrong}`,
  `color: ${COLORS.text}`,
].join(";");

export const DETAIL_STYLE = [
  "min-height: 0",
  "display: flex",
  "flex-direction: column",
  "gap: 8px",
].join(";");

// 详情区中段：队列与配方在这里滚动，标题行与底部低频区保持固定。
export const DETAIL_SCROLL_STYLE = [
  "overflow-y: auto",
  "min-height: 0",
  "flex: 1 1 auto",
  "display: flex",
  "flex-direction: column",
  "gap: 8px",
  "padding-right: 2px",
].join(";");
```

**再**重写 `MachinePanel`：

- `root` 仍用 `OVERLAY_STYLE`，`card` 改用 `SPLIT_CARD_STYLE`。
- 结构：header → quickBar（本任务先渲染三个占位按钮，Task 10 接线）→ splitBody（sideList + detail）→ note。
- `sideList` 与 `detailScroll` 都加 `SCROLL_CLASS`，各自滚动；`card` 不再加滚动类。
- 详情区三段式：标题行（固定）→ `detailScroll`（队列与配方，可滚动）→ 底部低频区（固定），避免扩建入口被队列挤走。
- `collapsedGroups: Set<MachineGroupKey>` 初始为空，即所有分组默认展开（初始存档只有磨坊已建，折叠未建造会让新玩家看不到建造入口）。
- `render()`：计算 entries/groups；若 `selectedId` 不在 entries 中，用 `firstSelectable` 兜底；渲染左栏分组与条目；渲染详情（本任务只渲染标题与"队列 x/y"，Task 9 补队列/配方/动作）。
- 左栏分组标题：`${title} ${entries.length}`；点击切换 `collapsedGroups`。
- 条目：图标用 `machineIcon(id)`，名称、摘要按状态：
  - `collectable` → `×${readyCount}`
  - `addable` → `队列 ${queueLength}/${queueSize}`
  - `running` → 剩余时间（取最早未完成 `formatDuration`）
  - `idle` → `空闲`
  - `unbuilt` → `Lv.${unlockLevel}`
- 条目选中时把 `SIDE_ITEM_ACTIVE` 追加到内联样式。
- 右栏在没有选中项（`firstSelectable` 返回 null）时显示"没有可用的机器"，不渲染空的详情骨架。

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter ./client exec vitest run src/ui/MachinePanel.test.ts`
Expected: 全部通过

- [ ] **Step 5: 提交**

```bash
git add client/src/ui/panelStyles.ts client/src/ui/MachinePanel.ts client/src/ui/MachinePanel.test.ts
git commit -m "feat(slow-farm-pc): 机器面板改为左右分栏并加状态分组左栏"
```

---

## Task 9: 机器面板 — 右栏详情与单机动作

**Files:**
- Modify: `client/src/ui/MachinePanel.ts`
- Modify: `client/src/ui/MachinePanel.test.ts`

**Interfaces:**
- Consumes: Task 6 的 `recipeShortfall`；既有 `machineView(state, id, now, rules)`
- Produces: 右栏按钮语义
  - `[加速]` → `useHourglass`，参数 `{ target: { kind: "machine", id } }`；`disabled = busy || 无未完成任务 || hourglasses < 1`
  - `[收取]` → `collectReady`，参数 `{ machineId: id }`；`disabled = busy || readyCount === 0`
  - `[放入]` → `enqueue`，参数 `{ machineId: id, recipeId }`；`disabled = busy || 队列已满 || recipeShortfall !== ""`
  - `[解锁]` → `unlockRecipe`，参数 `{ recipeId }`；`disabled = busy || levelOf(xp, rules) < recipe.unlockLevel`
  - `[建造]` → `buyMachine`，参数 `{ machineId: id }`；`disabled = busy || 等级不足 || coins < buildCost`

- [ ] **Step 1: 写失败用例**

在 `MachinePanel.test.ts` 追加：

```ts
// 精确匹配，避免 "加速" 命中顶栏的 "一键加速"、"收取" 命中 "一键收取"。
function button(label: string): HTMLButtonElement {
  const found = Array.from(document.querySelectorAll<HTMLButtonElement>("#machine-panel button"))
    .find((candidate) => candidate.textContent?.trim() === label);
  if (!found) throw new Error(`未找到按钮 ${label}`);
  return found;
}

// 顶栏按钮带数量，用正则前缀匹配。
function buttonMatching(pattern: RegExp): HTMLButtonElement {
  const found = Array.from(document.querySelectorAll<HTMLButtonElement>("#machine-panel button"))
    .find((candidate) => pattern.test(candidate.textContent?.trim() ?? ""));
  if (!found) throw new Error(`未找到匹配 ${pattern} 的按钮`);
  return found;
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("MachinePanel 右栏动作", () => {
  it("放入、收取、加速、建造各自提交正确参数", async () => {
    const { store, panel, calls } = setup();
    await store.load(meta);
    panel.open();

    button("放入").click();
    await flush();
    expect(calls).toContainEqual({
      type: "enqueue",
      args: { machineId: "mill", recipeId: "flour" },
    });

    select("bakery").click();
    button("建造").click();
    await flush();
    expect(calls).toContainEqual({ type: "buyMachine", args: { machineId: "bakery" } });

    panel.destroy();
  });

  it("队列满时放入禁用并显示队列已满", async () => {
    const { store, panel } = setup();
    await store.load(meta);
    const state = store.state!;
    state.machines!.mill.queue = [
      { recipeId: "flour", startedAt: 0, readyAt: Date.now() + 60_000 },
      { recipeId: "flour", startedAt: 0, readyAt: Date.now() + 120_000 },
    ];
    await store.load(meta);
    panel.open();

    expect(button("放入").disabled).toBe(true);
    expect(document.querySelector("#machine-panel")!.textContent).toContain("队列已满");

    panel.destroy();
  });

  it("材料不足时放入禁用并写明短缺", async () => {
    const { store, panel } = setup();
    await store.load(meta);
    store.state!.silo = {};
    await store.load(meta);
    panel.open();

    expect(button("放入").disabled).toBe(true);
    expect(document.querySelector("#machine-panel")!.textContent).toContain("还差 小麦×2");

    panel.destroy();
  });

  it("未解锁配方只显示解锁按钮并提交 unlockRecipe", async () => {
    const { store, panel, calls } = setup();
    await store.load(meta);
    store.state!.machines!.bakery.unlocked = true;
    await store.load(meta);
    panel.open();
    select("bakery").click();

    expect(document.querySelector("#machine-panel")!.textContent).not.toContain("放入");
    button("解锁").click();
    await flush();
    expect(calls).toContainEqual({ type: "unlockRecipe", args: { recipeId: "bread" } });

    panel.destroy();
  });

  it("沙漏为 0 时加速禁用", async () => {
    const { store, panel } = setup();
    await store.load(meta);
    const state = store.state!;
    state.machines!.mill.queue = [{ recipeId: "flour", startedAt: 0, readyAt: Date.now() + 60_000 }];
    await store.load(meta);
    panel.open();

    expect(button("加速").disabled).toBe(true);

    panel.destroy();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter ./client exec vitest run src/ui/MachinePanel.test.ts`
Expected: FAIL，找不到"放入"或参数不符

- [ ] **Step 3: 实现右栏**

在 `MachinePanel.render()` 中补详情区：

- 未建造：显示 `需要等级 N`（等级不足时）与 `[建造（cost 金币）]`。
- 已建造（标题行与底部低频区固定，队列与配方放进 `detailScroll` 滚动）：
  - 标题行：`machineIcon(id) 名称`，右侧 `队列 x/y`、`[加速]`、`[收取]`。
  - 队列：`machineView` 的每一项一行，只读状态（`可收取` 草绿 / `formatDuration(remaining)` 等宽）。
  - 配方：过滤 `recipe.machine === id`；已解锁显示 `名称（输入文案）` + `[放入]`，未解锁显示 `名称（需 Lv.N）` + `[解锁]`；`[放入]` 禁用时把 `recipeShortfall` 或"队列已满"显示在同一行。
  - 底部：`队列容量 x/y` + `[扩建队列（cost 金币）]`，`disabled = busy || 已达上限 || coins < cost`。
- 新增私有 `run(type, args)`：与现有面板一致，`busy` 防重入，失败写 `note`，`finally` 重置并 `render()`。

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter ./client exec vitest run src/ui/MachinePanel.test.ts`
Expected: 全部通过

- [ ] **Step 5: 提交**

```bash
git add client/src/ui/MachinePanel.ts client/src/ui/MachinePanel.test.ts
git commit -m "feat(slow-farm-pc): 机器面板右栏接入单机加料收取建造"
```

---

## Task 10: 机器面板 — 顶栏一键与选中保持

**Files:**
- Modify: `client/src/ui/MachinePanel.ts`
- Modify: `client/src/ui/MachinePanel.test.ts`

**Interfaces:**
- Consumes: Task 1–4 的 `collectAllMachines` / `enqueueAll` / `useHourglassOnMachines` 动作
- Produces: 顶栏按钮
  - `一键收取 N`：N = 所有 `readyCount` 之和；`disabled = busy || N === 0`；发送 `collectAllMachines`
  - `一键加料 N`：N = `addable` 机器数；`disabled = busy || N === 0`；发送 `enqueueAll`
  - `一键加速`：`disabled = busy || hourglasses < 1 || 没有未完成任务`
- 选中保持规则：`selectedId` 在实例上；每轮 `render()` 若它已不在 `entries` 中则回退 `firstSelectable(groups)`；动作后若原选中机器已不属于原分组，自动选中原分组首条，原分组为空则全局首条。

- [ ] **Step 1: 写失败用例**

在 `MachinePanel.test.ts` 追加：

```ts
describe("MachinePanel 顶栏与选中保持", () => {
  it("一键收取与一键加料提交批量动作", async () => {
    const { store, panel, calls } = setup();
    await store.load(meta);

    // 构造一台可收取（磨坊）与一台可加料（面包房），两个一键按钮才都可点。
    const state = store.state!;
    state.machines!.mill.queue = [{ recipeId: "flour", startedAt: 0, readyAt: Date.now() - 1 }];
    state.machines!.bakery.unlocked = true;
    state.silo = { wheat: 4, flour: 2 };
    state.unlockedRecipes = { flour: true, bread: true };
    await store.load(meta);
    panel.open();

    buttonMatching(/^一键收取/).click();
    await flush();
    buttonMatching(/^一键加料/).click();
    await flush();

    expect(calls).toContainEqual({ type: "collectAllMachines", args: {} });
    expect(calls).toContainEqual({ type: "enqueueAll", args: {} });

    panel.destroy();
  });

  it("store 刷新后保持选中，选中项消失时回退首条", async () => {
    const { store, panel } = setup();
    await store.load(meta);
    panel.open();

    select("bakery").click();
    await store.load(meta);
    expect(select("bakery").dataset.selected).toBe("true");

    // 规则表更新后面包房不再存在，选中应回退到首条。
    store.applyRules({ ...rules, MACHINES: { mill: rules.MACHINES!.mill } });
    expect(select("mill").dataset.selected).toBe("true");

    panel.destroy();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter ./client exec vitest run src/ui/MachinePanel.test.ts`
Expected: FAIL，一键按钮未接线或选中被重置

- [ ] **Step 3: 实现**

- 顶栏三个按钮按上述禁用条件与动作接线；沙漏数量显示在顶栏右侧。
- `run()` 成功后记录动作前的分组 key，在 `finally` 前调用 `ensureSelectionAfterAction(previousGroupKey)`。
- `ensureSelectionAfterAction`：重算 entries/groups；若 `selectedId` 仍在原分组则保持；否则取原分组首条；原分组为空取 `firstSelectable(groups)`。
- 批量动作的结果提示：`collectAllMachines` 显示 `已收取 ${collected} 份`（`skipped > 0` 时追加 ` · ${skipped} 份仓库已满`）；`enqueueAll` 显示 `已加料 ${queued} 份`；`useHourglassOnMachines` 在 `stopped === "no_hourglass"` 时显示 `沙漏用完`。

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter ./client exec vitest run src/ui/MachinePanel.test.ts`
Expected: 全部通过

- [ ] **Step 5: 提交**

```bash
git add client/src/ui/MachinePanel.ts client/src/ui/MachinePanel.test.ts
git commit -m "feat(slow-farm-pc): 机器面板接入一键动作并保持选中"
```

---

## Task 11: 养殖面板 — 分栏骨架与左栏

**Files:**
- Modify: `client/src/ui/AnimalPanel.ts`
- Create: `client/src/ui/AnimalPanel.test.ts`

**Interfaces:**
- Consumes: Task 7 的 `animalView(...).counts` 与 `herdSummary`
- Produces: 左栏条目 DOM 约定
  - `<button class="sf-side-item" data-animal-kind="chicken" data-selected="true|false">`
  - 详情根：`<div class="sf-detail" data-detail-id="<kind>">`
- 左栏只有三种畜舍，不分组；摘要按 `herdSummary(counts)`；未解锁显示 `Lv.${unlockLevel}`。
- 首次选中：第一个已解锁畜舍；全部未解锁时选第一个。

- [ ] **Step 1: 写失败用例**

创建 `client/src/ui/AnimalPanel.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import type { ActionResponse, GameState, Meta, Rules, SaveSnapshot } from "../api/client";
import { GameStore, type StoreApi } from "../state/store";
import { AnimalPanel } from "./AnimalPanel";

const rules: Rules = {
  CROPS: {},
  ITEMS: {
    egg: { name: "鸡蛋", sellPrice: 20, unlockLevel: 1, category: "product" },
    feed: { name: "饲料", sellPrice: 5, unlockLevel: 1, category: "product" },
  },
  LEVELS: [0, 40, 120],
  ANIMALS: {
    chicken: {
      name: "鸡", nameOf: "鸡", product: "egg", unlockLevel: 1, price: 200,
      cycleMs: 60_000, initialSlots: 4, maxSlots: 6, slotPrices: [400, 800],
    },
    cow: {
      name: "牛", nameOf: "牛", product: "egg", unlockLevel: 6, price: 800,
      cycleMs: 60_000, initialSlots: 4, maxSlots: 6, slotPrices: [1500, 3000],
    },
  },
};

const meta: Meta = {
  rulesVersion: "test",
  saveVersion: 5,
  rules,
  rev: 1,
  startedAt: "2026-11-25T00:00:00.000Z",
};

function makeState(): GameState {
  const now = Date.now();
  return {
    coins: 1_000,
    gems: 0,
    xp: 0,
    plots: [],
    silo: { feed: 2 },
    animals: {
      chicken: { slots: 4, list: [{ readyAt: 0 }, { readyAt: now + 30_000 }] },
      cow: { slots: 4, list: [] },
    },
  };
}

function setup() {
  const state = makeState();
  const calls: Array<{ type: string; args: Record<string, unknown> }> = [];
  const api: StoreApi = {
    getMeta: async () => meta,
    getSave: async (): Promise<SaveSnapshot> => ({ state, rev: 1 }),
    postAction: async (type, args): Promise<ActionResponse> => {
      calls.push({ type, args });
      return { ok: false, reason: "unused" };
    },
  };
  const store = new GameStore(api, rules);
  const panel = new AnimalPanel(store);
  return { store, panel, calls };
}

describe("AnimalPanel 左栏", () => {
  it("按畜舍渲染摘要并默认选中第一个已解锁畜舍", async () => {
    const { store, panel } = setup();
    await store.load(meta);
    panel.open();

    const text = document.querySelector("#animal-panel")!.textContent ?? "";
    expect(text).toContain("待喂食 1");
    expect(text).toContain("产出中 1");
    expect(document.querySelector('[data-animal-kind="chicken"]')!.getAttribute("data-selected")).toBe("true");
    expect(document.querySelector("#animal-panel .sf-detail")!.getAttribute("data-detail-id")).toBe("chicken");

    panel.destroy();
  });

  it("点击左栏切换畜舍", async () => {
    const { store, panel } = setup();
    await store.load(meta);
    panel.open();

    document.querySelector<HTMLElement>('[data-animal-kind="cow"]')!.click();

    expect(document.querySelector("#animal-panel .sf-detail")!.getAttribute("data-detail-id")).toBe("cow");
    panel.destroy();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter ./client exec vitest run src/ui/AnimalPanel.test.ts`
Expected: FAIL，找不到 `data-animal-kind`

- [ ] **Step 3: 实现**

- `AnimalPanel` 复用 Task 8 的 `SPLIT_CARD_STYLE` / `SPLIT_BODY_STYLE` / `SIDE_LIST_STYLE` / `SIDE_ITEM_STYLE` / `SIDE_ITEM_ACTIVE` / `DETAIL_STYLE`。
- 结构：header → quickBar（本任务占位）→ splitBody（左栏畜舍 + 右栏详情占位）→ note。
- `selectedKind: string | null` 存在实例上；`render()` 时若失效则选第一个已解锁畜舍。
- 左栏条目：`animalIcon(kind) + 名称`，右侧摘要 `herdSummary(view.counts)`；未解锁显示 `Lv.${def.unlockLevel}`，仍可选中，右栏展示解锁条件。
- 右栏本任务只渲染标题 `名称舍 x/y 只`，动物行留到 Task 12。

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter ./client exec vitest run src/ui/AnimalPanel.test.ts`
Expected: 全部通过

- [ ] **Step 5: 提交**

```bash
git add client/src/ui/AnimalPanel.ts client/src/ui/AnimalPanel.test.ts
git commit -m "feat(slow-farm-pc): 养殖面板改为左右分栏并加畜舍摘要左栏"
```

---

## Task 12: 养殖面板 — 右栏动物行与批量动作

**Files:**
- Modify: `client/src/ui/AnimalPanel.ts`
- Modify: `client/src/ui/AnimalPanel.test.ts`

**Interfaces:**
- Produces: 右栏与顶栏动作
  - 动物行主操作：`[喂食]` → `feedAnimal { kind, index }`；`[加速]` → `useHourglass { target: { kind: "animal", kindId, index } }`；`[收取]` → `collectAnimal { kind, index }`
  - 顶部：`喂养全部` → `feedAll { kind }`、`收取全部` → `collectAll { kind }`、`加速全部` → `useHourglassOnAnimals { kind }`
  - 底部：`[买入]` → `buyAnimal { kind }`；`[扩建畜舍]` → `buyStableSlot { kind }`
  - 以上 `kind` 均为当前选中的畜舍

- [ ] **Step 1: 写失败用例**

在 `AnimalPanel.test.ts` 追加：

```ts
// 精确匹配，避免 "加速" 命中 "加速全部"、"收取" 命中 "收取全部"。
function button(label: string): HTMLButtonElement {
  const found = Array.from(document.querySelectorAll<HTMLButtonElement>("#animal-panel button"))
    .find((candidate) => candidate.textContent?.trim() === label);
  if (!found) throw new Error(`未找到按钮 ${label}`);
  return found;
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("AnimalPanel 右栏与批量动作", () => {
  it("单只喂食、批量喂养与买入提交正确参数", async () => {
    const { store, panel, calls } = setup();
    await store.load(meta);
    panel.open();

    button("喂食").click();
    await flush();
    expect(calls).toContainEqual({ type: "feedAnimal", args: { kind: "chicken", index: 0 } });

    button("喂养全部").click();
    await flush();
    expect(calls).toContainEqual({ type: "feedAll", args: { kind: "chicken" } });

    button("买入").click();
    await flush();
    expect(calls).toContainEqual({ type: "buyAnimal", args: { kind: "chicken" } });

    panel.destroy();
  });

  it("没有沙漏时单只与全部加速都禁用", async () => {
    const { store, panel } = setup();
    await store.load(meta);
    panel.open();

    expect(button("加速").disabled).toBe(true);
    expect(button("加速全部").disabled).toBe(true);

    panel.destroy();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter ./client exec vitest run src/ui/AnimalPanel.test.ts`
Expected: FAIL，找不到对应按钮

- [ ] **Step 3: 实现**

- 右栏动物行：状态文案与现有实现一致（`饿着` / `产出中 mm:ss` / `可收取`），右侧按状态给一个主操作。
- 顶栏：`喂养全部`（`!canFeed` 禁用）、`收取全部`（`!canCollect` 禁用）、`加速全部`（`!canRush || hourglasses < 1` 禁用）。
- 底部低频区：买入与扩建，保留现有条件（等级、槽位、金币）。
- `run()` 与机器面板一致：`busy` 防重入、失败写 note、成功处理 `stopped === "no_hourglass"`。

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter ./client exec vitest run src/ui/AnimalPanel.test.ts`
Expected: 全部通过

- [ ] **Step 5: 提交**

```bash
git add client/src/ui/AnimalPanel.ts client/src/ui/AnimalPanel.test.ts
git commit -m "feat(slow-farm-pc): 养殖面板右栏接入单只与批量操作"
```

---

## Task 13: 全量验证与手动验收

**Files:**
- 无新增；修正因面板结构变化而失败的既有测试

- [ ] **Step 1: 运行全部自动化测试**

Run: `pnpm test`
Expected: core、server、client 全部通过

- [ ] **Step 2: 类型检查与构建**

Run: `pnpm --filter ./client run build`
Expected: `tsc --noEmit` 与 vite build 均通过

- [ ] **Step 3: 浏览器手动验收**

用一份后期存档（9 台机器、3 种畜舍）逐项确认：

1. 打开机器面板，左栏 9 台机器一屏可见，无需滚动；
2. 选中磨坊，右栏配方行一次点击完成加料；
3. `一键收取` 收到的份数与提示一致；
4. 仓库塞满后 `一键收取` 提示"N 份仓库已满"，队列中未收的任务仍在；
5. 等待 5 秒轮询，选中机器与分组折叠状态不丢；
6. 养殖面板：左栏摘要与右栏动物状态一致，单只喂食/收取各一次点击完成；
7. 沙漏为 0 时两处加速按钮均禁用。

- [ ] **Step 4: 提交收尾**

```bash
git add client server docs
git commit -m "test(slow-farm-pc): 面板分栏改造后的回归收尾"
```

---

## Self-Review

- **Spec coverage**：左栏状态分组（Task 5、8）、右栏单机操作台（Task 9）、顶栏兜底批量（Task 10）、养殖同骨架（Task 11、12）、三个服务端批量动作（Task 1–4）、配方短缺文案（Task 6）、畜舍聚合摘要（Task 7）、轮询选中保持（Task 10）、全量验证（Task 13）。
- **Step scan**：每个实现步骤给出了签名、文件位置与判定规则；未给出可直接复制的完整面板实现体，保留实现者空间。
- **Type consistency**：`MachineGroupKey` / `MachineEntry` / `MachineGroup` 在 Task 5 定义，Task 8 消费；`recipeShortfall` 在 Task 6 定义，Task 9 消费；`AnimalCounts` / `herdSummary` 在 Task 7 定义，Task 11 消费。
- **Review Focus**：仓库满跳过（Task 1 用例）、多配方材料不足继续尝试（Task 2 用例）、未解锁配方显示解锁（Task 9 用例）、轮询选中消失回退（Task 10 用例）、沙漏为 0 禁用（Task 9、12 用例）。
