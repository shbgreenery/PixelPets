import { describe, expect, it } from "vitest";
import type { GameState, Rules } from "../api/client";
import { achievementView, taskView } from "./achievementView";
import { animalView } from "./animalView";

const rules: Rules = {
  CROPS: {},
  ITEMS: {
    egg: { name: "鸡蛋", sellPrice: 140, unlockLevel: 4, category: "product" },
    feed: { name: "饲料", sellPrice: 50, unlockLevel: 3, category: "product" },
  },
  LEVELS: [0, 40, 120, 300],
  ANIMALS: {
    chicken: {
      name: "鸡",
      nameOf: "鸡",
      product: "egg",
      unlockLevel: 4,
      price: 200,
      cycleMs: 20 * 60 * 1000,
      initialSlots: 4,
      maxSlots: 6,
      slotPrices: [400, 800],
    },
  },
  ACHIEVEMENTS: [
    { id: "firstHarvest", name: "第一把麦子", desc: "收获 1 个作物", metric: "harvested", goal: 1, reward: 30 },
    { id: "harvest100", name: "百穗", desc: "累计收获 100 个作物", metric: "harvested", goal: 100, reward: 300 },
    { id: "fullPlots", name: "满园", desc: "开到 12 块地", metric: "plots", goal: 12, reward: 800 },
  ],
  TASKS: [
    {
      id: "seeSilo",
      title: "看看仓库",
      hint: "收成先放进仓库",
      tab: "silo",
      reward: 20,
      check: { metric: "visited:silo", goal: 1 },
    },
    {
      id: "firstAnimal",
      title: "养第一只鸡",
      hint: "鸡舍在养殖页",
      tab: "animals",
      reward: 300,
      check: { metric: "animal:chicken", goal: 1 },
    },
  ],
};

function makeState(overrides: Partial<GameState> = {}): GameState {
  return {
    coins: 0,
    gems: 0,
    xp: 0,
    plots: [],
    silo: {},
    ...overrides,
  };
}

describe("animalView", () => {
  it("动物三态判定与剩余时间", () => {
    const now = 100_000;
    const state = makeState({
      animals: {
        chicken: {
          slots: 4,
          list: [
            { readyAt: 0 },
            { readyAt: now + 30_000 },
            { readyAt: now - 1_000 },
          ],
        },
      },
    });

    const view = animalView(state, "chicken", now);

    expect(view.animals.map((animal) => animal.state)).toEqual(["hungry", "growing", "ready"]);
    expect(view.animals.map((animal) => animal.remaining)).toEqual([0, 30_000, 0]);
    expect(view.animals.map((animal) => animal.index)).toEqual([0, 1, 2]);
  });

  it("全部喂食/收取可用性判断", () => {
    const now = 100_000;
    const hungry = makeState({
      silo: { feed: 1 },
      animals: { chicken: { slots: 4, list: [{ readyAt: 0 }] } },
    });
    expect(animalView(hungry, "chicken", now)).toMatchObject({
      canFeed: true,
      canCollect: false,
      canRush: false,
    });

    // 没有饲料时不能一键喂食。
    const noFeed = makeState({
      silo: {},
      animals: { chicken: { slots: 4, list: [{ readyAt: 0 }] } },
    });
    expect(animalView(noFeed, "chicken", now).canFeed).toBe(false);

    const mixed = makeState({
      silo: { feed: 1 },
      animals: {
        chicken: {
          slots: 4,
          list: [{ readyAt: 0 }, { readyAt: now + 30_000 }, { readyAt: now - 1 }],
        },
      },
    });
    expect(animalView(mixed, "chicken", now)).toMatchObject({
      canFeed: true,
      canCollect: true,
      canRush: true,
    });
  });

  it("未知畜舍返回空列表且所有按钮不可用", () => {
    const view = animalView(makeState(), "unknown", 0);
    expect(view.animals).toEqual([]);
    expect(view.canFeed).toBe(false);
    expect(view.canCollect).toBe(false);
    expect(view.canRush).toBe(false);
  });
});

describe("achievementView", () => {
  it("成就进度不超过目标值", () => {
    const state = makeState({
      plots: Array.from({ length: 20 }, () => ({ id: 0, cropId: null, plantedAt: 0, readyAt: 0 })),
      stats: { harvested: 150 },
      achievements: { firstHarvest: true },
    });

    const views = achievementView(state, rules);

    expect(views.map((view) => view.id)).toEqual(["firstHarvest", "harvest100", "fullPlots"]);
    expect(views[0]).toMatchObject({ progress: 1, goal: 1, done: true, reward: 30 });
    expect(views[1]).toMatchObject({ progress: 100, goal: 100, done: false, reward: 300 });
    expect(views[2]).toMatchObject({ progress: 12, goal: 12, done: false, reward: 800 });
    expect(views[1].title).toBe("百穗");
  });

  it("任务链按 taskIndex 区分已完成、当前与后续", () => {
    const state = makeState({
      stats: { planted: 0 },
      animals: { chicken: { slots: 4, list: [{ readyAt: 0 }] } },
      taskIndex: 1,
      tabsSeen: { silo: true },
    });

    const views = taskView(state, rules);

    expect(views[0]).toMatchObject({ id: "seeSilo", done: true, current: false, progress: 1, goal: 1 });
    // 第二关已经满足条件但服务端还没结算，前端只展示进度，不越权标记完成。
    expect(views[1]).toMatchObject({ id: "firstAnimal", done: false, current: true, progress: 1, goal: 1 });
  });
});
