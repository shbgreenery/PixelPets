import { describe, expect, it } from "vitest";
import type { GameState, Meta, Rules, SaveSnapshot } from "../api/client";
import { GameStore, type StoreApi } from "../state/store";
import { SiloPanel, totalSellPrice, unitSellPrice } from "./SiloPanel";

const rules: Rules = {
  CROPS: {},
  ITEMS: {
    bread: { name: "面包", sellPrice: 45, unlockLevel: 1, category: "food" },
    wheat: { name: "小麦", sellPrice: 2, unlockLevel: 1, category: "crop" },
    cornBread: { name: "玉米面包", sellPrice: 90, unlockLevel: 1, category: "food" },
    soySauce: { name: "酱油", sellPrice: 340, unlockLevel: 1, category: "food" },
  },
  LEVELS: [0],
  SELL_RATIO: 0.7,
  SILO: { initial: 30, max: 31, prices: [100] },
};

describe("unitSellPrice", () => {
  it("按 SELL_RATIO 换算出售单价，与服务端 sellItem 的取整一致", () => {
    expect(unitSellPrice(rules, "bread")).toBe(31);
    expect(unitSellPrice(rules, "wheat")).toBe(1);
    // 浮点直接乘会得到 62.999…，必须与服务端一样用整数百分比。
    expect(unitSellPrice(rules, "cornBread")).toBe(63);
    expect(unitSellPrice(rules, "soySauce")).toBe(238);
  });

  it("未知物品返回 null", () => {
    expect(unitSellPrice(rules, "unknown")).toBeNull();
  });
});

describe("totalSellPrice", () => {
  it("整批只取整一次，与服务端 sellItem 一致", () => {
    // 单价 2 × 数量 121 × 70% = 169.4，整批 floor 后为 169。
    expect(totalSellPrice(rules, "wheat", 121)).toBe(169);
    // 逐件 floor 会得到 121，整批公式必须得到 169。
    expect(totalSellPrice(rules, "wheat", 121)).not.toBe(unitSellPrice(rules, "wheat")! * 121);
  });

  it("数量为 1 时与 unitSellPrice 相同", () => {
    expect(totalSellPrice(rules, "bread", 1)).toBe(unitSellPrice(rules, "bread"));
  });

  it("未知物品返回 null", () => {
    expect(totalSellPrice(rules, "unknown", 3)).toBeNull();
  });
});

function makeState(): GameState {
  return { coins: 0, gems: 0, xp: 0, plots: [], silo: {} };
}

const meta: Meta = {
  rulesVersion: "test",
  saveVersion: 5,
  rules,
  rev: 1,
  startedAt: "2026-11-23T00:00:00.000Z",
};

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("SiloPanel 访问上报", () => {
  it("首次拿到存档后上报一次 visitTab(silo)，后续渲染不重复", async () => {
    const calls: Array<{ type: string; args: Record<string, unknown> }> = [];
    const state = makeState();
    const api: StoreApi = {
      getMeta: async () => meta,
      getSave: async (): Promise<SaveSnapshot> => ({ state, rev: 1 }),
      postAction: async (type, args) => {
        calls.push({ type, args });
        return { ok: true, result: {}, state, rev: 2 };
      },
    };
    const store = new GameStore(api, rules);
    const panel = new SiloPanel(store);

    await store.load(meta);
    await flush();
    expect(calls).toEqual([{ type: "visitTab", args: { tab: "silo" } }]);

    await store.load(meta);
    await flush();
    expect(calls).toEqual([{ type: "visitTab", args: { tab: "silo" } }]);

    panel.destroy();
  });

  it("上报失败时下次渲染重试，成功后才停止", async () => {
    const state = makeState();
    let visits = 0;
    const api: StoreApi = {
      getMeta: async () => meta,
      getSave: async (): Promise<SaveSnapshot> => ({ state, rev: 1 }),
      postAction: async (_type, _args, rev) => {
        visits += 1;
        if (visits === 1) return { ok: false, reason: "server_unreachable" };
        return { ok: true, result: {}, state, rev: rev + 1 };
      },
    };
    const store = new GameStore(api, rules);
    const panel = new SiloPanel(store);

    await store.load(meta);
    await flush();
    expect(visits).toBe(1);

    await store.load(meta);
    await flush();
    expect(visits).toBe(2);

    await store.load(meta);
    await flush();
    expect(visits).toBe(2);

    panel.destroy();
  });
});

describe("SiloPanel 扩建", () => {
  it("点击扩建仓库发送 buySiloSlot", async () => {
    const state: GameState = { coins: 500, gems: 0, xp: 0, plots: [], silo: {}, siloSlots: 30 };
    const calls: string[] = [];
    const api: StoreApi = {
      getMeta: async () => meta,
      getSave: async (): Promise<SaveSnapshot> => ({ state, rev: 1 }),
      postAction: async (type) => {
        calls.push(type);
        return { ok: false, reason: "unused" };
      },
    };
    const store = new GameStore(api, rules);
    const panel = new SiloPanel(store);

    await store.load(meta);
    const expand = Array.from(document.querySelectorAll<HTMLButtonElement>("#silo-panel button"))
      .find((candidate) => candidate.textContent?.includes("扩建仓库"));
    expect(expand).toBeDefined();
    expand!.click();
    await flush();

    expect(calls).toContain("buySiloSlot");

    panel.destroy();
  });
});

describe("SiloPanel 出售", () => {
  function makeSellApi(state: GameState) {
    const calls: Array<{ type: string; args: Record<string, unknown> }> = [];
    const api: StoreApi = {
      getMeta: async () => meta,
      getSave: async (): Promise<SaveSnapshot> => ({ state, rev: 1 }),
      postAction: async (type, args) => {
        calls.push({ type, args });
        return { ok: true, result: {}, state, rev: 1 };
      },
    };
    return { api, calls };
  }

  function findButton(label: string): HTMLButtonElement | undefined {
    return Array.from(document.querySelectorAll<HTMLButtonElement>("#silo-panel button"))
      .find((button) => button.textContent === label);
  }

  it("点击「全部出售」发送当前库存数量", async () => {
    const state: GameState = { coins: 0, gems: 0, xp: 0, plots: [], silo: { wheat: 5 } };
    const { api, calls } = makeSellApi(state);
    const store = new GameStore(api, rules);
    const panel = new SiloPanel(store);

    await store.load(meta);
    await flush();

    // 行内总价按整批公式展示：floor(2 × 5 × 70 / 100) = 7。
    expect(document.querySelector("#silo-panel")!.textContent).toContain("总价 7");

    const sellAll = findButton("全部出售");
    expect(sellAll).toBeDefined();
    sellAll!.click();
    await flush();

    expect(calls).toContainEqual({ type: "sellItem", args: { itemId: "wheat", quantity: 5 } });

    panel.destroy();
  });

  it("「出售 ×1」只发送数量 1", async () => {
    const state: GameState = { coins: 0, gems: 0, xp: 0, plots: [], silo: { wheat: 5 } };
    const { api, calls } = makeSellApi(state);
    const store = new GameStore(api, rules);
    const panel = new SiloPanel(store);

    await store.load(meta);
    await flush();

    findButton("出售 ×1")!.click();
    await flush();

    expect(calls).toContainEqual({ type: "sellItem", args: { itemId: "wheat", quantity: 1 } });

    panel.destroy();
  });

  it("库存为 1 时不显示「全部出售」", async () => {
    const state: GameState = { coins: 0, gems: 0, xp: 0, plots: [], silo: { wheat: 1 } };
    const { api } = makeSellApi(state);
    const store = new GameStore(api, rules);
    const panel = new SiloPanel(store);

    await store.load(meta);
    await flush();

    expect(findButton("全部出售")).toBeUndefined();
    expect(findButton("出售 ×1")).toBeDefined();

    panel.destroy();
  });
});
