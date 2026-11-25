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
  // 上一个用例断言失败时可能来不及 destroy，先清掉残留面板，避免查找到旧 DOM。
  document.getElementById("machine-panel")?.remove();
  const state = makeState();
  const calls: Array<{ type: string; args: Record<string, unknown> }> = [];
  let nextResponse: ActionResponse | null = null;
  const api: StoreApi = {
    getMeta: async () => meta,
    getSave: async (): Promise<SaveSnapshot> => ({ state, rev: 1 }),
    postAction: async (type, args): Promise<ActionResponse> => {
      calls.push({ type, args });
      return nextResponse ?? { ok: false, reason: "unused" };
    },
  };
  const store = new GameStore(api, rules);
  const panel = new MachinePanel(store);
  const respond = (response: ActionResponse): void => {
    nextResponse = response;
  };
  return { store, panel, calls, respond };
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
    buttonMatching(/^建造/).click();
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
    expect(document.querySelector("#machine-panel")!.textContent).toContain("还差 小麦 ×2");

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

  it("轮询重建后保持右栏滚动位置", async () => {
    const { store, panel } = setup();
    await store.load(meta);
    panel.open();

    const scroll = document.querySelector<HTMLElement>("#machine-panel .sf-detail-scroll")!;
    scroll.scrollTop = 120;
    await store.load(meta);

    expect(document.querySelector<HTMLElement>("#machine-panel .sf-detail-scroll")!.scrollTop).toBe(120);

    panel.destroy();
  });

  it("加速后选中项仍停留在原机器", async () => {
    const { store, panel, respond } = setup();
    await store.load(meta);

    // 清空仓库让磨坊无法加料（否则它会被归入「可加料」），此时磨坊生产中、面包房空闲。
    // 加速磨坊后它变为可收取，选中不应跳到空闲的面包房。
    const before = store.state!;
    before.silo = {};
    before.hourglasses = 1;
    before.machines!.mill.queue = [{ recipeId: "flour", startedAt: 0, readyAt: Date.now() + 60_000 }];
    before.machines!.bakery.unlocked = true;
    await store.load(meta);
    panel.open();
    select("mill").click();

    const after = JSON.parse(JSON.stringify(before)) as GameState;
    after.hourglasses = 0;
    after.machines!.mill.queue = [{ recipeId: "flour", startedAt: 0, readyAt: Date.now() - 1 }];
    respond({ ok: true, result: {}, state: after, rev: 2 });

    button("加速").click();
    await flush();

    expect(select("mill").dataset.selected).toBe("true");
    expect(document.querySelector("#machine-panel .sf-detail")!.getAttribute("data-detail-id")).toBe("mill");

    panel.destroy();
  });

  it("等级不足的未建造机器标为锁定", async () => {
    const { store, panel } = setup();
    await store.load(meta);
    store.state!.xp = 0;
    await store.load(meta);
    panel.open();

    expect(select("bakery").dataset.locked).toBe("true");

    panel.destroy();
  });
});
