import { describe, expect, it } from "vitest";
import type { ActionResponse, GameState, Meta, Rules, SaveSnapshot } from "../api/client";
import { GameStore, type StoreApi } from "../state/store";
import { FarmPanel } from "./FarmPanel";

const rules: Rules = {
  CROPS: { wheat: { seedPrice: 1, growMs: 60_000, yield: 2 } },
  ITEMS: { wheat: { name: "小麦", sellPrice: 2, unlockLevel: 1, category: "crop" } },
  LEVELS: [0, 40, 120],
  PLOTS: {
    initial: 6,
    max: 8,
    prices: [
      { level: 2, cost: 200 },
      { level: 2, cost: 400 },
    ],
  },
};

const meta: Meta = {
  rulesVersion: "test",
  saveVersion: 5,
  rules,
  rev: 1,
  startedAt: "2026-11-23T00:00:00.000Z",
};

function makeState(): GameState {
  return {
    coins: 1_000,
    gems: 0,
    xp: 100,
    plots: Array.from({ length: 6 }, (_, index) => ({
      id: index + 1,
      cropId: null,
      plantedAt: 0,
      readyAt: 0,
    })),
    silo: {},
    hourglasses: 0,
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
  const panel = new FarmPanel(store, () => "wheat");
  return { store, panel, calls };
}

function button(label: string): HTMLButtonElement {
  const found = Array.from(document.querySelectorAll<HTMLButtonElement>("#farm-panel button"))
    .find((candidate) => candidate.textContent?.includes(label));
  if (!found) throw new Error(`未找到按钮 ${label}`);
  return found;
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("FarmPanel", () => {
  it("扩建地块发送 buyPlot，一键播种发送选中作物", async () => {
    const { store, panel, calls } = setup();
    await store.load(meta);
    panel.open();

    button("扩建地块").click();
    await flush();
    button("一键播种").click();
    await flush();

    expect(calls).toContainEqual({ type: "buyPlot", args: {} });
    expect(calls).toContainEqual({ type: "plantAll", args: { cropId: "wheat" } });

    panel.destroy();
  });

  it("没有沙漏时全部加速禁用", async () => {
    const { store, panel } = setup();
    await store.load(meta);
    panel.open();

    expect(button("全部加速").disabled).toBe(true);

    panel.destroy();
  });
});
