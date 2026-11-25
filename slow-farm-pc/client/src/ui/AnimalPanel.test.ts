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
  // 上一个用例断言失败时可能来不及 destroy，先清掉残留面板。
  document.getElementById("animal-panel")?.remove();
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

  it("未解锁畜舍不显示买入与扩建", async () => {
    const { store, panel } = setup();
    await store.load(meta);
    panel.open();

    document.querySelector<HTMLElement>('[data-animal-kind="cow"]')!.click();

    const text = document.querySelector("#animal-panel")!.textContent ?? "";
    expect(text).toContain("需要等级 6");
    expect(text).not.toContain("买入");
    expect(text).not.toContain("扩建畜舍");

    panel.destroy();
  });

  it("轮询重建后保持右栏滚动位置", async () => {
    const { store, panel } = setup();
    await store.load(meta);
    panel.open();

    const scroll = document.querySelector<HTMLElement>("#animal-panel .sf-detail-scroll")!;
    scroll.scrollTop = 120;
    await store.load(meta);

    expect(document.querySelector<HTMLElement>("#animal-panel .sf-detail-scroll")!.scrollTop).toBe(120);

    panel.destroy();
  });
});
