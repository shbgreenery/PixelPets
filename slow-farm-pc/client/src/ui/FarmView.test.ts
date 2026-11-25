import { afterEach, expect, it, vi } from "vitest";
import type { GameState, Meta, Plot, Rules } from "../api/client";
import { GameStore, type StoreApi } from "../state/store";
import { FarmView } from "./FarmView";

const rules = {
  CROPS: { wheat: { seedPrice: 1, growMs: 60_000, yield: 2 } },
  ITEMS: { wheat: { name: "小麦", sellPrice: 1, unlockLevel: 1, category: "crop" } },
  LEVELS: [0],
  ANIMALS: {},
} as unknown as Rules;

const meta = {
  rulesVersion: "1",
  saveVersion: 5,
  rules,
  rev: 1,
  startedAt: "",
} as Meta;

const makeState = (count: number, over: Partial<Plot> = {}): GameState => ({
  coins: 0,
  gems: 0,
  xp: 0,
  plots: Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    cropId: null,
    plantedAt: 0,
    readyAt: 0,
    ...over,
  })),
  silo: {},
  animals: {},
}) as unknown as GameState;

const views: FarmView[] = [];

function track(view: FarmView): FarmView {
  views.push(view);
  return view;
}

interface PostedAction {
  type: string;
  args: Record<string, unknown>;
}

// playHarvest 正常分支走 Web Animations API，jsdom 未实现，用例里替换为无副作用的桩。
function stubAnimate(): void {
  Object.defineProperty(Element.prototype, "animate", {
    configurable: true,
    writable: true,
    value: vi.fn(() => ({ cancel: vi.fn() })),
  });
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function setup(state: GameState, result: unknown = null) {
  const calls: PostedAction[] = [];
  const api: StoreApi = {
    getMeta: async () => meta,
    getSave: async () => ({ state, rev: 1 }),
    postAction: async (type, args) => {
      calls.push({ type, args });
      return { ok: true, result, state, rev: 2 };
    },
  };
  const store = new GameStore(api, rules);
  return { store, calls, view: track(new FarmView(store)) };
}

afterEach(() => {
  for (const view of views.splice(0)) view.destroy();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(Element.prototype as unknown as Record<string, unknown>, "animate");
});

it("按地块数量渲染地块卡片", async () => {
  const { store, view } = setup(makeState(6));
  await store.load();
  expect(view.element.querySelectorAll(".plot").length).toBe(6);
});

it("定时器每 250ms 刷新倒计时，destroy 后停止", async () => {
  const api: StoreApi = {
    getMeta: async () => meta,
    getSave: async () => ({
      state: makeState(1, { cropId: "wheat", plantedAt: 0, readyAt: 60_000 }),
      rev: 1,
    }),
    postAction: async () => ({ ok: true, result: null, state: makeState(1), rev: 2 }),
  };
  const store = new GameStore(api, rules);
  // Ruling 3：先等存档就位，再开假定时器，避免微任务与假定时器竞态。
  await store.load();
  vi.useFakeTimers();
  vi.setSystemTime(0);

  const view = track(new FarmView(store));
  const label = () => view.element.querySelector(".plot-label")!;
  expect(label().textContent).toBe("1:00");
  vi.advanceTimersByTime(1000);
  expect(label().textContent).toBe("0:59");

  view.destroy();
  vi.advanceTimersByTime(5000);
  expect(vi.getTimerCount()).toBe(0);
  vi.useRealTimers();
});

it("后端未启动时显示提示且不渲染地块", async () => {
  const api: StoreApi = {
    getMeta: async () => {
      throw new Error("server_unreachable");
    },
    getSave: async () => null,
    postAction: async () => ({ ok: false, reason: "server_unreachable" }),
  };
  const store = new GameStore(api, rules);
  await store.load();
  const view = track(new FarmView(store));
  expect(view.element.querySelector(".farm-status")!.textContent).toBe("后端未启动");
  expect(view.element.querySelectorAll(".plot").length).toBe(0);
});

it("点击空地时按已选作物发送 plant 动作", async () => {
  const { store, view, calls } = setup(makeState(1));
  await store.load();

  (view.element.querySelector(".plot") as HTMLElement).click();
  await flush();

  expect(calls).toContainEqual({ type: "plant", args: { plot: 0, cropId: "wheat" } });
});

it("点击成熟地块发送 harvest 动作并播放收获飘字", async () => {
  stubAnimate();
  const { store, view, calls } = setup(
    makeState(1, { cropId: "wheat", plantedAt: 0, readyAt: 0 }),
    { itemId: "wheat", qty: 2 },
  );
  await store.load();

  (view.element.querySelector(".plot") as HTMLElement).click();
  await flush();

  expect(calls).toContainEqual({ type: "harvest", args: { plot: 0 } });
  expect(view.element.querySelector(".plot-float")?.textContent).toBe("小麦 +2");
});

it("点击底部农场入口打开面板并高亮，再次点击关闭", async () => {
  const { store, view } = setup(makeState(1));
  await store.load();

  const panel = document.querySelector("#farm-panel") as HTMLElement;
  const entry = view.element.querySelector('.dock-item[data-key="farm"]') as HTMLElement;
  expect(panel.style.display).toBe("none");

  entry.click();
  await flush();
  expect(panel.style.display).toBe("flex");
  expect(entry.dataset.active).toBe("true");

  entry.click();
  await flush();
  expect(panel.style.display).toBe("none");
  expect(entry.dataset.active).toBeUndefined();
});

it("打开带页签的入口只上报一次 visitTab", async () => {
  const { store, view, calls } = setup(makeState(1));
  await store.load();

  const entry = view.element.querySelector('.dock-item[data-key="farm"]') as HTMLElement;
  // 仓库常驻面板也会上报 visitTab("silo")，这里只关心农场入口。
  const farmVisits = () =>
    calls.filter((call) => call.type === "visitTab" && call.args.tab === "farm");

  entry.click();
  await flush();
  expect(farmVisits()).toEqual([{ type: "visitTab", args: { tab: "farm" } }]);

  entry.click(); // 关闭
  await flush();
  entry.click(); // 再次打开，不应重复上报
  await flush();
  expect(farmVisits()).toHaveLength(1);
});
