import { describe, expect, it } from "vitest";
import type { GameState, Meta, Plot, Rules, SaveSnapshot } from "../api/client";
import type { StoreApi } from "../state/store";
import { GameStore } from "../state/store";
import { plotCommand } from "../display/plotCommand";
import { SeedPanel } from "./SeedPanel";

const rules: Rules = {
  CROPS: {
    wheat: { seedPrice: 1, growMs: 60_000, yield: 2 },
    corn: { seedPrice: 5, growMs: 120_000, yield: 2 },
    carrot: { seedPrice: 10, growMs: 180_000, yield: 2 },
  },
  ITEMS: {
    wheat: { name: "小麦", sellPrice: 2, unlockLevel: 1, category: "crop" },
    corn: { name: "玉米", sellPrice: 6, unlockLevel: 1, category: "crop" },
    carrot: { name: "胡萝卜", sellPrice: 14, unlockLevel: 2, category: "crop" },
  },
  LEVELS: [0, 40],
};

const meta: Meta = {
  rulesVersion: "test",
  saveVersion: 5,
  rules,
  rev: 1,
  startedAt: "2026-11-23T00:00:00.000Z",
};

function makePlot(): Plot {
  return { id: 1, cropId: null, plantedAt: 0, readyAt: 0 };
}

function makeState(): GameState {
  return { coins: 100, gems: 0, xp: 0, plots: [makePlot()], silo: {} };
}

function makeApi(state: GameState): StoreApi {
  return {
    getMeta: async () => meta,
    getSave: async (): Promise<SaveSnapshot> => ({ state, rev: 1 }),
    postAction: async () => ({ ok: false, reason: "unused" }),
  };
}

function button(cropId: string): HTMLButtonElement {
  const found = document.querySelector<HTMLButtonElement>(`#seed-panel button[data-crop-id="${cropId}"]`);
  if (!found) throw new Error(`未找到作物按钮 ${cropId}`);
  return found;
}

describe("SeedPanel", () => {
  it("默认选中第一个已解锁作物，点击其他作物后发送对应 cropId", async () => {
    const state = makeState();
    const store = new GameStore(makeApi(state), rules);
    const panel = new SeedPanel(store);

    // 加载前按等级 1 渲染，小麦是第一个已解锁作物。
    expect(panel.selectedCropId).toBe("wheat");

    await store.load(meta);
    expect(panel.selectedCropId).toBe("wheat");

    // 玉米已解锁，胡萝卜需要 2 级而当前 1 级。
    expect(button("carrot").disabled).toBe(true);

    button("corn").click();
    expect(panel.selectedCropId).toBe("corn");

    // 点击空地应按选中的玉米发送 plant。
    const command = plotCommand(state, 0, panel.selectedCropId, 1_000);
    expect(command).toEqual({ type: "plant", args: { plot: 0, cropId: "corn" } });

    panel.destroy();
  });

  it("选中项带 data-selected 与已选文案，锁定项与未选项不带", async () => {
    const store = new GameStore(makeApi(makeState()), rules);
    const panel = new SeedPanel(store);
    await store.load(meta);

    // 选中项：标记 data-selected、显示「已选」，且保持不可重复点击。
    const wheat = button("wheat");
    expect(wheat.dataset.selected).toBe("true");
    expect(wheat.textContent).toContain("已选");
    expect(wheat.disabled).toBe(true);

    // 未选中的已解锁项与锁定项都不应标记为选中。
    expect(button("corn").dataset.selected).toBeUndefined();
    expect(button("carrot").dataset.selected).toBeUndefined();
    expect(button("carrot").disabled).toBe(true);

    // 切换到玉米后，选中标记随之转移。
    button("corn").click();
    expect(button("corn").dataset.selected).toBe("true");
    expect(button("wheat").dataset.selected).toBeUndefined();

    panel.destroy();
  });

  it("第一个作物未解锁时默认选中下一个已解锁作物", () => {
    const lockedFirst: Rules = {
      CROPS: {
        pumpkin: { seedPrice: 40, growMs: 60_000, yield: 2 },
        wheat: { seedPrice: 1, growMs: 60_000, yield: 2 },
      },
      ITEMS: {
        pumpkin: { name: "南瓜", sellPrice: 56, unlockLevel: 5, category: "crop" },
        wheat: { name: "小麦", sellPrice: 2, unlockLevel: 1, category: "crop" },
      },
      LEVELS: [0, 40],
    };
    const store = new GameStore(makeApi(makeState()), lockedFirst);
    const panel = new SeedPanel(store);

    expect(panel.selectedCropId).toBe("wheat");

    panel.destroy();
  });
});
