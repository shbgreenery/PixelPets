import { describe, expect, it } from "vitest";
import type { GameState, Rules } from "../api/client";
import { firstSelectable, groupMachines, machineEntries, type MachineEntry } from "./machineStatus";

const rules: Rules = {
  CROPS: {},
  ITEMS: {
    wheat: { name: "小麦", sellPrice: 2, unlockLevel: 1, category: "crop" },
    flour: { name: "面粉", sellPrice: 10, unlockLevel: 1, category: "product" },
    bread: { name: "面包", sellPrice: 30, unlockLevel: 1, category: "product" },
  },
  LEVELS: [0, 40, 120],
  MACHINES: {
    mill: { name: "磨坊", buildCost: 100, unlockLevel: 1 },
    bakery: { name: "面包房", buildCost: 200, unlockLevel: 2 },
  },
  RECIPES: {
    flour: { name: "面粉", machine: "mill", input: { wheat: 2 }, ms: 1000, output: { flour: 1 }, unlockLevel: 1 },
    bread: { name: "面包", machine: "bakery", input: { flour: 1 }, ms: 2000, output: { bread: 1 }, unlockLevel: 2 },
  },
};

function makeState(overrides: Partial<GameState> = {}): GameState {
  return {
    coins: 0,
    gems: 0,
    xp: 0,
    plots: [],
    silo: {},
    machines: {
      mill: { unlocked: true, queueSize: 2, queue: [] },
      bakery: { unlocked: false, queueSize: 2, queue: [] },
    },
    unlockedRecipes: { flour: true },
    ...overrides,
  };
}

describe("machineEntries", () => {
  it("按优先级判定单台机器状态", () => {
    const now = 10_000;

    const collectable = makeState({
      machines: { mill: { unlocked: true, queueSize: 2, queue: [{ recipeId: "flour", startedAt: 0, readyAt: now }] } },
      silo: { wheat: 4 },
    });
    expect(machineEntries(collectable, now, rules)[0]).toMatchObject({
      id: "mill",
      status: "collectable",
      readyCount: 1,
    });

    const addable = makeState({ silo: { wheat: 4 } });
    expect(machineEntries(addable, now, rules)[0].status).toBe("addable");

    const running = makeState({
      machines: { mill: { unlocked: true, queueSize: 2, queue: [{ recipeId: "flour", startedAt: 0, readyAt: now + 5000 }] } },
    });
    expect(machineEntries(running, now, rules)[0].status).toBe("running");

    const idle = makeState({ silo: {} });
    expect(machineEntries(idle, now, rules)[0].status).toBe("idle");

    expect(machineEntries(idle, now, rules)[1].status).toBe("unbuilt");
  });

  it("队列已满的机器不算可加料", () => {
    const state = makeState({
      machines: { mill: { unlocked: true, queueSize: 1, queue: [{ recipeId: "flour", startedAt: 0, readyAt: 50_000 }] } },
      silo: { wheat: 8 },
    });
    expect(machineEntries(state, 10_000, rules)[0].status).toBe("running");
  });
});

describe("groupMachines 与 firstSelectable", () => {
  it("按固定顺序分组，idle 归入生产中", () => {
    const state = makeState({ silo: { wheat: 4 } });
    const groups = groupMachines(machineEntries(state, 0, rules));
    expect(groups.map((group) => group.key)).toEqual(["collectable", "addable", "running", "unbuilt"]);
    expect(groups[1].entries.map((entry) => entry.id)).toEqual(["mill"]);
    expect(groups[3].entries.map((entry) => entry.id)).toEqual(["bakery"]);
    expect(firstSelectable(groups)).toBe("mill");
  });

  it("全部为空时返回 null", () => {
    const groups = groupMachines([]);
    expect(groups).toHaveLength(4);
    expect(firstSelectable(groups)).toBeNull();
  });

  it("未建造组按解锁等级升序", () => {
    const entries: MachineEntry[] = [
      { id: "late", name: "晚", status: "unbuilt", built: false, queueLength: 0, queueSize: 0, readyCount: 0, unlockLevel: 8 },
      { id: "early", name: "早", status: "unbuilt", built: false, queueLength: 0, queueSize: 0, readyCount: 0, unlockLevel: 3 },
    ];
    expect(groupMachines(entries)[3].entries.map((entry) => entry.id)).toEqual(["early", "late"]);
  });
});
