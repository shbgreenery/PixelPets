import { describe, expect, it } from "vitest";
import type { GameState, Rules } from "../api/client";
import { animalProgress, stallViews } from "./barnView";

const rules: Rules = {
  CROPS: {},
  ITEMS: {
    egg: { name: "鸡蛋", sellPrice: 140, unlockLevel: 4, category: "product" },
    wool: { name: "羊毛", sellPrice: 520, unlockLevel: 7, category: "product" },
  },
  LEVELS: [0, 40],
  ANIMALS: {
    chicken: {
      name: "鸡",
      nameOf: "鸡",
      product: "egg",
      unlockLevel: 2,
      price: 200,
      cycleMs: 60_000,
      initialSlots: 4,
      maxSlots: 6,
      slotPrices: [400, 800],
    },
    sheep: {
      name: "羊",
      nameOf: "羊",
      product: "wool",
      unlockLevel: 7,
      price: 1500,
      cycleMs: 45_000,
      initialSlots: 4,
      maxSlots: 6,
      slotPrices: [2000, 4000],
    },
  },
};

function makeState(xp: number, animals: GameState["animals"] = {}): GameState {
  return { coins: 0, gems: 0, xp, plots: [], silo: {}, animals };
}

describe("animalProgress", () => {
  it("未开始为 0，到点为 1，其余按周期换算", () => {
    expect(animalProgress(60_000, 0, 10_000)).toBe(0);
    expect(animalProgress(60_000, 5_000, 10_000)).toBe(1);
    expect(animalProgress(60_000, 40_000, 10_000)).toBe(0.5);
    // 周期异常时不产生 NaN 或负值。
    expect(animalProgress(0, 40_000, 10_000)).toBe(0);
  });
});

describe("stallViews", () => {
  it("未解锁的畜舍显示所需等级", () => {
    const [chicken, sheep] = stallViews(makeState(0), rules, 0);
    expect(chicken).toMatchObject({ unlocked: false, tone: "locked", status: "需 Lv.2", progress: 0 });
    expect(sheep.status).toBe("需 Lv.7");
  });

  it("已解锁但没有动物时提示空栏", () => {
    const [chicken] = stallViews(makeState(40), rules, 0);
    expect(chicken).toMatchObject({ unlocked: true, tone: "idle", status: "还没有鸡", count: 0 });
  });

  it("可收取时用 ready 语义并填满进度", () => {
    const state = makeState(40, {
      chicken: { slots: 4, list: [{ readyAt: 5_000 }, { readyAt: 9_000 }] },
    });
    const [chicken] = stallViews(state, rules, 10_000);
    expect(chicken).toMatchObject({
      unlocked: true,
      tone: "ready",
      readyCount: 2,
      count: 2,
      status: "2 只可收取",
      progress: 1,
      productName: "鸡蛋",
    });
  });

  it("产出中显示剩余时间与最接近完成的进度", () => {
    const state = makeState(40, {
      chicken: { slots: 4, list: [{ readyAt: 40_000 }, { readyAt: 70_000 }] },
    });
    const [chicken] = stallViews(state, rules, 10_000);
    expect(chicken.tone).toBe("growing");
    expect(chicken.status).toBe("产出中 0:30");
    expect(chicken.progress).toBe(0.5);
  });

  it("全部待喂食时为 idle", () => {
    const state = makeState(40, { chicken: { slots: 4, list: [{ readyAt: 0 }] } });
    const [chicken] = stallViews(state, rules, 10_000);
    expect(chicken).toMatchObject({ tone: "idle", status: "待喂食", progress: 0 });
  });
});
