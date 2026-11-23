import { describe, expect, it } from "vitest";
import type { GameState, Rules } from "../api/client";
import {
  deliverableOrderCount,
  machineView,
  orderShortfall,
  orderView,
} from "./viewModels";

const rules: Rules = {
  CROPS: {},
  ITEMS: {
    wheat: { name: "小麦", sellPrice: 2, unlockLevel: 1, category: "crop" },
    corn: { name: "玉米", sellPrice: 6, unlockLevel: 1, category: "crop" },
    flour: { name: "面粉", sellPrice: 12, unlockLevel: 1, category: "product" },
  },
  LEVELS: [0, 40, 120],
  MACHINES: {
    mill: { name: "磨坊", buildCost: 0, unlockLevel: 1 },
    bakery: { name: "面包房", buildCost: 400, unlockLevel: 2 },
  },
  RECIPES: {
    flour: {
      name: "面粉",
      machine: "mill",
      input: { wheat: 2 },
      ms: 15 * 60 * 1000,
      output: { flour: 1 },
      unlockLevel: 1,
    },
    bread: {
      name: "面包",
      machine: "bakery",
      input: { flour: 1 },
      ms: 30 * 60 * 1000,
      output: { bread: 1 },
      unlockLevel: 2,
    },
  },
  QUEUE: { initial: 6, max: 10, prices: [200, 400, 700, 1200] },
  ORDERS: {
    initialSlots: 3,
    maxSlots: 5,
    slotPrices: [500, 1200],
    newbieCount: 3,
    rewardCoinMul: 1.5,
    rewardXpDivisor: 10,
    tiers: [],
  },
};

function makeState(overrides: Partial<GameState> = {}): GameState {
  return {
    coins: 0,
    gems: 0,
    xp: 0,
    plots: [],
    silo: {},
    machines: {},
    orders: [],
    dailyOrder: null,
    orderSlots: 3,
    unlockedRecipes: {},
    ...overrides,
  };
}

describe("machineView", () => {
  it("机器队列按剩余时间升序并标记完成项", () => {
    const state = makeState({
      machines: {
        mill: {
          unlocked: true,
          queueSize: 6,
          queue: [
            { recipeId: "flour", startedAt: 10_000, readyAt: 20_000 },
            { recipeId: "flour", startedAt: 0, readyAt: 5_000 },
            { recipeId: "flour", startedAt: 20_000, readyAt: 35_000 },
          ],
        },
      },
    });

    const view = machineView(state, "mill", 7_000, rules);

    expect(view.queue.map((job) => job.remaining)).toEqual([0, 13_000, 28_000]);
    expect(view.queue.map((job) => job.done)).toEqual([true, false, false]);
    expect(view.queue[0].name).toBe("面粉");
    expect(view.queue[0].recipeId).toBe("flour");
    expect(view.canAdd).toBe(true);
  });

  it("队列已满或机器未建时 canAdd 为 false", () => {
    const full = makeState({
      machines: {
        mill: {
          unlocked: true,
          queueSize: 1,
          queue: [{ recipeId: "flour", startedAt: 0, readyAt: 10 }],
        },
      },
    });
    expect(machineView(full, "mill", 0, rules).canAdd).toBe(false);

    const locked = makeState({
      machines: { bakery: { unlocked: false, queueSize: 6, queue: [] } },
    });
    expect(machineView(locked, "bakery", 0, rules).canAdd).toBe(false);
  });
});

describe("orderView", () => {
  it("订单行正确计算 have/need", () => {
    const state = makeState({
      silo: { wheat: 3 },
      orders: [
        {
          id: "o1",
          lines: [
            { itemId: "wheat", quantity: 5 },
            { itemId: "corn", quantity: 2 },
          ],
          coins: 120,
          xp: 6,
        },
      ],
    });

    const [order] = orderView(state, 0, rules);

    expect(order.id).toBe("o1");
    expect(order.coins).toBe(120);
    expect(order.xp).toBe(6);
    expect(order.lines[0]).toMatchObject({ name: "小麦", have: 3, need: 5, ok: false });
    expect(order.lines[1]).toMatchObject({ name: "玉米", have: 0, need: 2, ok: false });
    expect(order.deliverable).toBe(false);
  });

  it("物料齐备时 deliverable 为 true", () => {
    const state = makeState({
      silo: { wheat: 5, corn: 2 },
      orders: [
        {
          id: "o1",
          lines: [
            { itemId: "wheat", quantity: 5 },
            { itemId: "corn", quantity: 2 },
          ],
          coins: 120,
          xp: 6,
        },
      ],
    });

    const [order] = orderView(state, 0, rules);

    expect(order.lines.every((line) => line.ok)).toBe(true);
    expect(order.deliverable).toBe(true);
  });

  it("每日订单在列表中单独标记", () => {
    const state = makeState({
      orders: [{ id: "o2", lines: [{ itemId: "wheat", quantity: 1 }], coins: 10, xp: 1 }],
      dailyOrder: { id: "d4", lines: [{ itemId: "corn", quantity: 3 }], coins: 200, xp: 12 },
    });

    const views = orderView(state, 0, rules);

    expect(views).toHaveLength(2);
    expect(views.find((order) => order.id === "d4")?.daily).toBe(true);
    expect(views.find((order) => order.id === "o2")?.daily).toBe(false);
  });
});

describe("订单角标与缺口文案", () => {
  function twoOrders(): GameState {
    return makeState({
      silo: { wheat: 5 },
      orders: [
        { id: "o1", lines: [{ itemId: "wheat", quantity: 5 }], coins: 10, xp: 1 },
        { id: "o2", lines: [{ itemId: "corn", quantity: 2 }], coins: 10, xp: 1 },
      ],
      dailyOrder: { id: "d4", lines: [{ itemId: "wheat", quantity: 9 }], coins: 20, xp: 2 },
    });
  }

  it("deliverableOrderCount 只数现在就能交付的订单", () => {
    expect(deliverableOrderCount(twoOrders(), rules, 0)).toBe(1);
  });

  it("orderShortfall 列出还差的物品与数量", () => {
    const views = orderView(twoOrders(), 0, rules);
    const [daily, o1, o2] = views;
    expect(orderShortfall(daily)).toBe("还差 小麦 ×4");
    expect(orderShortfall(o1)).toBe("");
    expect(orderShortfall(o2)).toBe("还差 玉米 ×2");
  });
});
