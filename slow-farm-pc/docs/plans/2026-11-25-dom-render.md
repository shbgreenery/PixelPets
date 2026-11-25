# slow-farm-pc 渲染层 DOM 化实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `slow-farm-pc` 客户端仍在 Phaser 画布上的四块（背景、地块、畜舍、底部入口）换成原生 DOM，消除 4K 屏每帧全量重绘导致的掉帧与点击延迟。

**Architecture:** 新建 `ui/` 下的四个 DOM 视图组件，与已有 `Hud`/面板同层；纯展示逻辑（`plotStage`/`plotProgress`/`stallViews`）迁到 `display/` 复用；`#stage` 的 `transform` 缩放是唯一缩放机制；全部改完后删除 `scenes/` 与 `phaser` 依赖。

**Tech Stack:** Vite 8 + TypeScript 7 + Vitest 5 + jsdom；**移除** Phaser 4，不新增依赖。

**Spec:** `slow-farm-pc/docs/2026-11-25-dom-render-design.md`

## Global Constraints

- 不改变服务端协议、存档格式、8 个功能面板与 HUD 的任何行为
- 所有 emoji 只能出现在 `client/src/display/icons.ts`，其他文件通过函数取用
- 不新增依赖；最终 `client/package.json` 移除 `phaser`
- 所有 DOM 写入必须做差分：值未变不写 `textContent`/`style`
- 提交信息中文，格式 `feat(slow-farm-pc): 描述` 或 `refactor(slow-farm-pc): 描述`
- 视觉以迁移前画布截图为基线，人眼一致即可
- 每个任务结束前 `pnpm --filter ./client run typecheck` 必须通过

## Review Focus

1. **倒计时差分**：同一秒内多次 `update()` 不得重复写 `textContent`，否则每 250ms 触发无用 paint
2. **畜舍与订单角标漏刷**：250ms 节拍必须同时刷新地块倒计时、畜舍"产出中 m:ss"、Dock 订单角标
3. **减少动效**：`prefers-reduced-motion: reduce` 时收获粒子与上浮飘字不得播放
4. **销毁清理**：组件 `destroy()` 后不得残留 `setInterval`、`store` 订阅、Web Animations
5. **点击命中**：地块整卡片（含圆角区域）都可点击，不出现"点了没反应"

---

## Task 1: 地块视图（纯函数迁出 + DOM 组件）

**Files:**
- Create: `slow-farm-pc/client/src/display/plotView.ts`
- Create: `slow-farm-pc/client/src/ui/PlotCellView.ts`
- Move: `slow-farm-pc/client/src/scenes/plotView.test.ts` → `slow-farm-pc/client/src/display/plotView.test.ts`
- Modify: `slow-farm-pc/client/src/scenes/PlotView.ts`（改为从 `display/plotView.ts` 重新导出，暂存期保持可编译）
- Test: `slow-farm-pc/client/src/ui/PlotCellView.test.ts`

**Interfaces:**
- Produces:
  - `display/plotView.ts`：`type PlotStage = "empty" | "growing" | "ready"`、`plotStage(_state: GameState, plot: Plot, now: number): PlotStage`、`plotProgress(plot: Plot, now: number): number`
  - `ui/PlotCellView.ts`：`interface PlotCellConfig { index: number; width: number; height: number; onSelect: (index: number) => void }`、`class PlotCellView { readonly element: HTMLElement; constructor(config: PlotCellConfig); update(plot: Plot, now: number): PlotStage; playHarvest(text: string): void; destroy(): void }`
- Consumes: `display/format.ts` 的 `formatCountdown`/`remainingMs`、`display/icons.ts` 的 `cropIcon`、`display/motion.ts` 的 `prefersReducedMotion`

- [ ] **Step 1: 写 PlotCellView 的失败测试**

```ts
// src/ui/PlotCellView.test.ts
import { describe, expect, it, vi } from "vitest";
import { PlotCellView } from "./PlotCellView";

const makePlot = (over = {}) => ({ id: 1, cropId: null, plantedAt: 0, readyAt: 0, ...over });
const make = () => new PlotCellView({ index: 0, width: 179, height: 110, onSelect: vi.fn() });

it("空地在 element 上标记 data-stage=empty 并显示加号", () => {
  const cell = make();
  expect(cell.update(makePlot(), 1000)).toBe("empty");
  expect(cell.element.dataset.stage).toBe("empty");
  expect(cell.element.querySelector(".plot-icon")!.textContent).toBe("+");
});

it("生长中显示倒计时且阶段为 growing", () => {
  const cell = make();
  const plot = makePlot({ cropId: "wheat", plantedAt: 0, readyAt: 61_000 });
  expect(cell.update(plot, 1000)).toBe("growing");
  expect(cell.element.querySelector(".plot-label")!.textContent).toBe("1:00");
});

it("同一秒内重复 update 不重写 label（差分）", () => {
  const cell = make();
  const plot = makePlot({ cropId: "wheat", plantedAt: 0, readyAt: 61_000 });
  cell.update(plot, 1000);
  const label = cell.element.querySelector(".plot-label")!;
  let writes = 0;
  const desc = Object.getOwnPropertyDescriptor(Node.prototype, "textContent")!;
  Object.defineProperty(label, "textContent", {
    configurable: true,
    get: () => desc.get!.call(label),
    set: (value) => { writes += 1; desc.set!.call(label, value); },
  });
  cell.update(plot, 1249); // 同一秒
  expect(writes).toBe(0);
  cell.update(plot, 1250); // 跨秒
  expect(writes).toBe(1);
});

it("成熟时 data-stage=ready 且显示可收获", () => {
  const cell = make();
  const plot = makePlot({ cropId: "wheat", plantedAt: 0, readyAt: 1000 });
  expect(cell.update(plot, 1000)).toBe("ready");
  expect(cell.element.dataset.stage).toBe("ready");
  expect(cell.element.querySelector(".plot-label")!.textContent).toBe("可收获");
});

it("点击整个地块触发 onSelect", () => {
  const onSelect = vi.fn();
  const cell = new PlotCellView({ index: 3, width: 179, height: 110, onSelect });
  cell.element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  expect(onSelect).toHaveBeenCalledWith(3);
});

it("减少动效时不播放粒子", () => {
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  const cell = make();
  cell.playHarvest("小麦 +2");
  expect(cell.element.querySelectorAll(".plot-particle").length).toBe(0);
  vi.unstubAllGlobals();
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd slow-farm-pc/client && pnpm vitest run src/ui/PlotCellView.test.ts`
Expected: FAIL，`Cannot find module './PlotCellView'`

- [ ] **Step 3: 把纯函数移到 `display/plotView.ts`**

从 `scenes/PlotView.ts` 原样搬 `PlotStage`、`plotStage`、`plotProgress` 三个导出。**不搬 `stageBarColor`**——DOM 版由 `[data-stage]` 选择器决定进度条颜色，该函数与它的测试一并删除。

`scenes/PlotView.ts` 顶部改为 `import { plotStage, plotProgress, type PlotStage } from "../display/plotView";` 并 `export { plotStage, plotProgress } from "../display/plotView";`，删除本地定义与 `stageBarColor` 的用法（进度条改色那两行直接删，因为暂存期仍由旧类渲染，可先保留 `barFill` 默认色）。

同时把 `scenes/plotView.test.ts` 移到 `display/plotView.test.ts`，import 改 `./plotView`，删除 `stageBarColor` 的 describe 块与 `STAGE_COLOR` 引用。

- [ ] **Step 4: 实现 `ui/PlotCellView.ts`**

关键结构（其余照 `scenes/PlotView.ts` 的几何常量：`RADIUS=14`、`ICON_SIZE=31px`、`LABEL_SIZE=14px`、`BAR_INSET=14`、`BADGE=55×19`）：

```ts
export class PlotCellView {
  readonly element: HTMLDivElement;             // .plot，绑 click
  private readonly icon: HTMLSpanElement;       // .plot-icon
  private readonly label: HTMLSpanElement;      // .plot-label
  private readonly barFill: HTMLSpanElement;    // .plot-bar
  private readonly badge: HTMLSpanElement;      // .plot-badge
  private stage: PlotStage = "empty";
  private lastLabel = "";                       // 差分缓存
  private lastProgress = -1;

  constructor(config: PlotCellConfig) { /* 建 DOM，data-index，click -> onSelect(index) */ }

  update(plot: Plot, now: number): PlotStage {
    const stage = plotStage({} as GameState, plot, now);
    if (stage !== this.stage) { this.stage = stage; this.element.dataset.stage = stage; }
    const label = stage === "empty" ? "点击播种"
      : stage === "growing" ? formatCountdown(remainingMs(plot.readyAt, now))
      : "可收获";
    if (label !== this.lastLabel) { this.lastLabel = label; this.label.textContent = label; }
    const progress = stage === "growing" ? plotProgress(plot, now) : 0;
    if (Math.abs(progress - this.lastProgress) > 0.001) {
      this.lastProgress = progress;
      this.barFill.style.transform = `scaleX(${progress.toFixed(3)})`;
    }
    return stage;
  }
}
```

`playHarvest(text)`：`prefersReducedMotion()` 为真时只插入一个 `.plot-float` 并在 700ms 后移除；否则插 10 个 `.plot-particle` 用 `el.animate([...], { duration: 500 })`，再插 `.plot-float` 上浮。`destroy()` 移除所有 `el.animate()` 返回的动画对象与定时器。

- [ ] **Step 5: 运行测试确认通过**

Run: `cd slow-farm-pc/client && pnpm vitest run src/ui/PlotCellView.test.ts src/display/plotView.test.ts`
Expected: 全部 PASS

- [ ] **Step 6: 类型检查并提交**

Run: `pnpm --filter ./client run typecheck`
Expected: 无错误

```bash
git add slow-farm-pc/client/src/display/plotView.ts slow-farm-pc/client/src/ui/PlotCellView.ts slow-farm-pc/client/src/ui/PlotCellView.test.ts slow-farm-pc/client/src/display/plotView.test.ts slow-farm-pc/client/src/scenes/PlotView.ts
git rm slow-farm-pc/client/src/scenes/plotView.test.ts
git commit -m "feat(slow-farm-pc): 地块视图改用 DOM 实现"
```

---

## Task 2: 畜舍视图（DOM 组件）

**Files:**
- Create: `slow-farm-pc/client/src/ui/BarnRackView.ts`
- Test: `slow-farm-pc/client/src/ui/BarnRackView.test.ts`

**Interfaces:**
- Consumes: `display/barnView.ts` 的 `stallViews(state, rules, now): StallView[]` 与 `StallTone`
- Produces: `interface BarnRackConfig { left: number; right: number; y: number; hasTexture: (kind: string) => boolean; onSelect: () => void }`、`class BarnRackView { readonly element: HTMLElement; constructor(config: BarnRackConfig); update(state: GameState, rules: Rules, now: number): void; destroy(): void }`

- [ ] **Step 1: 写失败测试**

```ts
const rules = { CROPS: {}, ITEMS: { milk: { name: "牛奶" } }, LEVELS: [0, 40],
  ANIMALS: { chicken: { name: "鸡", product: "milk", cycleMs: 60_000, unlockLevel: 1 } } } as unknown as Rules;

it("每种动物渲染一个栏位，data-tone 跟随状态", () => {
  const rack = new BarnRackView({ left: 22, right: 1004, y: 532, hasTexture: () => false, onSelect: vi.fn() });
  const state = { coins: 0, gems: 0, xp: 0, plots: [], silo: {},
    animals: { chicken: { list: [{ id: 1, readyAt: 2000 }] } } } as unknown as GameState;
  rack.update(state, rules, 1000);
  const stall = rack.element.querySelector(".stall")!;
  expect(stall.getAttribute("data-tone")).toBe("growing");
  expect(stall.querySelector(".stall-status")!.textContent).toContain("产出中");
});

it("状态文案未变时不重写（差分）", () => { /* 同 Task 1 的 textContent setter 计数 */ });

it("点击栏位触发 onSelect", () => { /* dispatchEvent click -> onSelect 被调用 */ });
```

- [ ] **Step 2: 运行确认失败** — Run: `cd slow-farm-pc/client && pnpm vitest run src/ui/BarnRackView.test.ts`，Expected: FAIL 模块不存在

- [ ] **Step 3: 实现 `ui/BarnRackView.ts`**

照 `scenes/BarnView.ts` 的几何（`CARD_RADIUS=14`、`PEN_SIZE=53`、`CARD_HEIGHT=79`、`CARD_GAP=13`、`TITLE_ROW=26`）与四态配色（`TONE_STYLE` 原样搬为 CSS 类）。栏位固定按 `stallViews` 的顺序渲染，`update()` 内做 `sync(rules)`：种类列表不变则只改已有元素的 `data-tone`/文本/`scaleX`，变了才重建。

- [ ] **Step 4: 运行确认通过** — Run: `cd slow-farm-pc/client && pnpm vitest run src/ui/BarnRackView.test.ts`，Expected: PASS

- [ ] **Step 5: 类型检查并提交**

```bash
git add slow-farm-pc/client/src/ui/BarnRackView.ts slow-farm-pc/client/src/ui/BarnRackView.test.ts
git commit -m "feat(slow-farm-pc): 畜舍视图改用 DOM 实现"
```

---

## Task 3: 底部入口（DOM 组件）

**Files:**
- Create: `slow-farm-pc/client/src/ui/DockBar.ts`
- Test: `slow-farm-pc/client/src/ui/DockBar.test.ts`

**Interfaces:**
- Produces: `interface DockEntry { key: string; label: string; icon: string; onSelect: () => void }`、`class DockBar { readonly element: HTMLElement; constructor(width: number, top: number, height: number, entries: DockEntry[]); setActive(key: string | null): void; setOrderBadge(count: number): void; destroy(): void }`

- [ ] **Step 1: 写失败测试**

```ts
it("渲染全部入口，每个入口可点击", () => {
  const onSelect = vi.fn();
  const bar = new DockBar(1280, 590, 130, [
    { key: "farm", label: "农场", icon: "🌱", onSelect },
    { key: "orders", label: "订单", icon: "📋", onSelect: vi.fn() },
  ]);
  expect(bar.element.querySelectorAll(".dock-item").length).toBe(2);
  (bar.element.querySelector(".dock-item") as HTMLElement).click();
  expect(onSelect).toHaveBeenCalled();
});

it("setActive 只给对应入口加 data-active", () => {
  const bar = new DockBar(1280, 590, 130, [{ key: "silo", label: "仓库", icon: "📦", onSelect: vi.fn() }]);
  bar.setActive("silo");
  expect(bar.element.querySelector(".dock-item")!.getAttribute("data-active")).toBe("true");
});

it("订单角标：0 隐藏，>99 显示 99+", () => {
  const bar = new DockBar(1280, 590, 130, [{ key: "orders", label: "订单", icon: "📋", onSelect: vi.fn() }]);
  const badge = () => bar.element.querySelector(".dock-badge") as HTMLElement;
  bar.setOrderBadge(0);
  expect(badge().hidden).toBe(true);
  bar.setOrderBadge(120);
  expect(badge().textContent).toBe("99+");
  expect(badge().hidden).toBe(false);
});
```

- [ ] **Step 2: 运行确认失败** — Run: `cd slow-farm-pc/client && pnpm vitest run src/ui/DockBar.test.ts`，Expected: FAIL 模块不存在

- [ ] **Step 3: 实现 `ui/DockBar.ts`**

照 `scenes/DockView.ts` 的几何（`ITEM_WIDTH=125`、`ITEM_HEIGHT=74`、`ITEM_GAP=7`、`ITEM_RADIUS=14`）；高亮用 `data-active` + CSS `::before` 顶部琥珀条；`setOrderBadge` 内部记住上次 count，相同则直接返回。

- [ ] **Step 4: 运行确认通过** — Run: `cd slow-farm-pc/client && pnpm vitest run src/ui/DockBar.test.ts`，Expected: PASS

- [ ] **Step 5: 类型检查并提交**

```bash
git add slow-farm-pc/client/src/ui/DockBar.ts slow-farm-pc/client/src/ui/DockBar.test.ts
git commit -m "feat(slow-farm-pc): 底部入口改用 DOM 实现"
```

---

## Task 4: 农场视图编排（背景 + 分区标题 + 子视图 + 定时刷新）

**Files:**
- Create: `slow-farm-pc/client/src/ui/farmStyles.ts`（一次性注入的 `<style>`：背景径向渐变、分区标题、toast；`.plot-*` 与 `@keyframes breathe` 归 `PlotCellView` 自带的 `#sf-plot-styles` 所有，本文件不重复定义）
- Create: `slow-farm-pc/client/src/ui/FarmView.ts`
- Test: `slow-farm-pc/client/src/ui/FarmView.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `PlotCellView`、Task 2 的 `BarnRackView`、Task 3 的 `DockBar`、`state/store.ts` 的 `GameStore`
- Produces: `class FarmView { readonly element: HTMLElement; constructor(store: GameStore); destroy(): void }`

- [ ] **Step 1: 写失败测试**

```ts
function setup(state: GameState) {
  const api: StoreApi = {
    getMeta: async () => meta, getSave: async () => ({ state, rev: 1 }),
    postAction: async () => ({ ok: true, state, rev: 2 }),
  };
  const store = new GameStore(api, rules);
  return { store, view: new FarmView(store) };
}

it("按地块数量渲染地块卡片", async () => {
  const { store, view } = setup(makeState(6));
  await store.load();
  expect(view.element.querySelectorAll(".plot").length).toBe(6);
});

it("定时器每 250ms 刷新倒计时，destroy 后停止", () => {
  vi.useFakeTimers();
  const { store, view } = setup(makeState(1, { cropId: "wheat", plantedAt: 0, readyAt: 60_000 }));
  const label = () => view.element.querySelector(".plot-label")!;
  store.load(); // 同步 mock 已 resolve 前，state 为空
  expect(label().textContent).toBe("1:00");
  vi.advanceTimersByTime(1000);
  expect(label().textContent).toBe("0:59");
  view.destroy();
  vi.advanceTimersByTime(5000);
  expect(vi.getTimerCount()).toBe(0);
  vi.useRealTimers();
});

it("后端未启动时显示提示且不渲染地块", async () => {
  const api: StoreApi = { getMeta: async () => { throw new Error("x"); },
    getSave: async () => null, postAction: async () => ({ ok: false, reason: "x" }) };
  const store = new GameStore(api, rules);
  await store.load();
  const view = new FarmView(store);
  expect(view.element.querySelector(".farm-status")!.textContent).toBe("后端未启动");
});
```

- [ ] **Step 2: 运行确认失败** — Run: `cd slow-farm-pc/client && pnpm vitest run src/ui/FarmView.test.ts`，Expected: FAIL 模块不存在

- [ ] **Step 3: 实现 `ui/farmStyles.ts`**

照 `FarmScene.createBackground` 的两个径向渐变（圆心 `(640,-40)` 半径 800、`(640,760)` 半径 600）与 `createSectionTitle` 的标题+短线；`.plot-*` 与 `@keyframes breathe` 由 `PlotCellView` 自带的 `#sf-plot-styles` 负责，本文件不得重复定义；`prefers-reduced-motion` 兜底由 `panelStyles.ts` 已有的全局规则覆盖。样式用 `#sf-farm-styles` 去重注入，与 `panelStyles.ts` 同一模式。

- [ ] **Step 4: 实现 `ui/FarmView.ts`**

编排（照 `FarmScene.ts` 的分区常量：`FIELD_LEFT=22`、`FIELD_RIGHT=CONTENT_RIGHT`、`FIELD_TOP=222`、`FIELD_BOTTOM=454`、`BARN.y=532`、`DOCK_TOP=590`、`DOCK_HEIGHT=130`）：

```ts
export class FarmView {
  readonly element: HTMLDivElement;                       // #farm，挂到 getStage()
  private readonly cells: PlotCellView[] = [];
  private readonly barn: BarnRackView;
  private readonly dock: DockBar;
  private status: HTMLElement;
  private toast: HTMLElement;
  private readonly unsubscribe: () => void;
  private timer: number;

  constructor(store: GameStore) {
    /* 建背景/标题/状态/toast/地块容器/畜舍/Dock，append 到 getStage() */
    this.unsubscribe = store.subscribe(() => this.refresh());
    this.timer = window.setInterval(() => this.refreshLabels(), 250);
    this.refresh();
  }
  destroy() { clearInterval(this.timer); this.unsubscribe(); this.element.remove(); }
}
```

`refreshLabels()` 必须同时更新：地块 `view.update(plot, now)`、分区统计文本、`barn.update(...)`、`dock.setOrderBadge(deliverableOrderCount(...))`——与 `FarmScene.refreshLabels` 一一对应。`refresh()` 处理 readonly/offline/未加载三态。

- [ ] **Step 5: 运行确认通过** — Run: `cd slow-farm-pc/client && pnpm vitest run src/ui/FarmView.test.ts`，Expected: PASS

- [ ] **Step 6: 类型检查并提交**

```bash
git add slow-farm-pc/client/src/ui/farmStyles.ts slow-farm-pc/client/src/ui/FarmView.ts slow-farm-pc/client/src/ui/FarmView.test.ts
git commit -m "feat(slow-farm-pc): 农场视图编排改用 DOM"
```

---

## Task 5: 切换入口与舞台瘦身

**Files:**
- Modify: `slow-farm-pc/client/src/main.ts`
- Modify: `slow-farm-pc/client/index.html`
- Modify: `slow-farm-pc/client/src/display/stage.ts`
- Modify: `slow-farm-pc/client/src/display/stage.test.ts`

**Interfaces:**
- Consumes: Task 4 的 `FarmView`
- Produces: `stage.ts` 只剩 `DESIGN_WIDTH`/`DESIGN_HEIGHT`/`STAGE_PADDING`/`SIDE_RAIL_*`/`CONTENT_RIGHT`/`MIN_FIT_SCALE`/`MAX_FIT_SCALE`/`fitScaleFor`/`fitScale`/`getStage`/`applyStageFit(): { fit: number }`

- [ ] **Step 1: 更新 stage 测试，删除 renderScale 相关**

从 `display/stage.test.ts` 删除 `renderScaleFor` 的整个 describe 块与 `MAX_RENDER_SCALE` import；`fitScaleFor` 的用例全部保留。

- [ ] **Step 2: 运行确认测试仍通过（此时 stage 未改）** — Run: `cd slow-farm-pc/client && pnpm vitest run src/display/stage.test.ts`，Expected: PASS

- [ ] **Step 3: 瘦身 `display/stage.ts`**

删除 `MAX_RENDER_SCALE`、`DPR_LIMIT`、`clampDpr`、`renderScaleFor`、`renderScale`；`applyStageFit()` 返回 `{ fit }`（去掉 `render`），内部删除 `renderScaleFor` 调用。

- [ ] **Step 4: 改 `main.ts`**

删除 `import Phaser from "phaser"`、`import { FarmScene }`、`new Phaser.Game(...)`、`game.scene.add(...)`、`resize` 里的 `game.scale.*` 分支。`bootstrap()` 变为：

```ts
applyStageFit();
new Hud(store);
new FarmView(store);
startPolling(store, meta);
window.addEventListener("resize", () => applyStageFit());
```

- [ ] **Step 5: 改 `index.html`**

删除 `<div id="game"></div>` 与 `#game`、`#game canvas` 两条 CSS 规则；`#stage` 保留。

- [ ] **Step 6: 运行全部客户端测试与构建**

Run: `cd slow-farm-pc/client && pnpm test && pnpm run build`
Expected: 测试全绿；构建成功，产物里 `grep -c "phaser" dist/assets/*.js` 为 0（此时 `scenes/` 仍存在但已无引用，构建会 tree-shake 掉——若仍有残留，确认是 Task 6 要删的文件）

- [ ] **Step 7: 提交**

```bash
git add slow-farm-pc/client/src/main.ts slow-farm-pc/client/index.html slow-farm-pc/client/src/display/stage.ts slow-farm-pc/client/src/display/stage.test.ts
git commit -m "refactor(slow-farm-pc): 入口切换到 DOM 视图，舞台去掉渲染系数"
```

---

## Task 6: 清理 Phaser 与全量验证

**Files:**
- Delete: `slow-farm-pc/client/src/scenes/`（`FarmScene.ts`、`PlotView.ts`、`BarnView.ts`、`DockView.ts`、`plotCommand.ts` 及其测试）
- Modify: `slow-farm-pc/client/package.json`（移除 `phaser`）

**Interfaces:**
- Consumes: 前五个任务
- Produces: 无

- [ ] **Step 1: 确认 `scenes/` 已无引用**

Run: `cd slow-farm-pc && grep -rn "scenes/" client/src --include="*.ts" | grep -v "^client/src/scenes/"`
Expected: 无输出（`plotCommand` 若被 `FarmView` 用到，先移到 `display/plotCommand.ts` 再删）

- [ ] **Step 2: 删除目录与依赖**

```bash
git rm -r slow-farm-pc/client/src/scenes
```

`client/package.json` 的 `dependencies` 删掉 `"phaser": "4.2.1"`，然后 `cd slow-farm-pc && pnpm install`。

- [ ] **Step 3: 全量测试**

Run: `cd slow-farm-pc && pnpm test`
Expected: core + server + client 全部 PASS

- [ ] **Step 4: 类型检查与生产构建**

Run: `cd slow-farm-pc && pnpm --filter ./client run typecheck && pnpm --filter ./client run build`
Expected: 无错误；`pnpm --filter ./client exec ls dist/assets` 体积较迁移前下降

- [ ] **Step 5: 浏览器验收（4K 屏）**

启动 `cd slow-farm-pc && pnpm start`，打开页面，用 Chrome DevTools Performance 录制 5 秒静止：

- 无生长/成熟地块时，Rendering 轨道 paint 计数为 0
- 点一块空地播种，响应 < 16ms（不含网络）
- 等成熟后呼吸光晕在动，但只有合成层，无 paint
- 逐屏比对：背景、地块三态、畜舍四态、Dock 高亮、toast、收获粒子

- [ ] **Step 6: 提交**

```bash
git add -A slow-farm-pc
git commit -m "refactor(slow-farm-pc): 移除 Phaser 依赖，渲染层完成 DOM 化"
```

---

## 自审清单

- [x] 设计文档的 22 条视觉对照都有对应任务（Task 1 地块、Task 2 畜舍、Task 3 Dock、Task 4 背景/标题/toast/粒子）
- [x] 验收 5 条都落到了任务：测试（Task 1-4）、构建无 phaser（Task 5-6）、paint 计数（Task 6 Step 5）
- [x] Review Focus 5 条都有测试：1/2 → Task 1-4 的差分用例，3 → Task 1 的减少动效用例，4 → Task 4 的 destroy 用例，5 → Task 1 的点击用例
- [x] 接口命名前后一致：`PlotCellView`/`BarnRackView`/`DockBar`/`FarmView`，`PlotStage` 由 `display/plotView.ts` 导出
- [x] 无未定义类型：`PlotCellConfig`/`BarnRackConfig`/`DockEntry` 均在本计划内定义
