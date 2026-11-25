import type { GameState, Rules } from "../api/client";

// 机器状态：可收取 > 可加料 > 生产中 > 空闲；未建造单独一类。
export type MachineStatus = "collectable" | "addable" | "running" | "idle" | "unbuilt";

export type MachineGroupKey = "collectable" | "addable" | "running" | "unbuilt";

export interface MachineEntry {
  id: string;
  name: string;
  status: MachineStatus;
  built: boolean;
  queueLength: number;
  queueSize: number;
  readyCount: number;
  unlockLevel: number;
}

export interface MachineGroup {
  key: MachineGroupKey;
  title: string;
  entries: MachineEntry[];
}

// 左栏固定分组顺序与标题；idle 归入生产中，避免多出一个大部分时间都为空的组。
const GROUP_DEFS: ReadonlyArray<{ key: MachineGroupKey; title: string }> = [
  { key: "collectable", title: "可收取" },
  { key: "addable", title: "可加料" },
  { key: "running", title: "生产中" },
  { key: "unbuilt", title: "未建造" },
];

// 已解锁且材料足够的配方存在时，这台机器才能被一键加料或算作"可加料"。
function hasAffordableRecipe(state: GameState, machineId: string, rules: Rules): boolean {
  for (const [recipeId, recipe] of Object.entries(rules.RECIPES ?? {})) {
    if (recipe.machine !== machineId) continue;
    if (state.unlockedRecipes?.[recipeId] !== true) continue;
    const enough = Object.entries(recipe.input)
      .every(([itemId, quantity]) => (state.silo[itemId] ?? 0) >= quantity);
    if (enough) return true;
  }
  return false;
}

export function machineEntries(state: GameState, now: number, rules: Rules): MachineEntry[] {
  const entries: MachineEntry[] = [];
  for (const [id, def] of Object.entries(rules.MACHINES ?? {})) {
    const machine = state.machines?.[id];
    const built = machine?.unlocked === true;
    const queue = machine?.queue ?? [];
    const queueSize = machine?.queueSize ?? 0;
    const readyCount = queue.filter((job) => job.readyAt <= now).length;

    let status: MachineStatus;
    if (!built) status = "unbuilt";
    else if (readyCount > 0) status = "collectable";
    else if (queue.length < queueSize && hasAffordableRecipe(state, id, rules)) status = "addable";
    else if (queue.length > 0) status = "running";
    else status = "idle";

    entries.push({
      id,
      name: def.name,
      status,
      built,
      queueLength: queue.length,
      queueSize,
      readyCount,
      unlockLevel: def.unlockLevel,
    });
  }
  return entries;
}

export function groupMachines(entries: MachineEntry[]): MachineGroup[] {
  return GROUP_DEFS.map((def) => {
    const filtered = entries.filter((entry) => (
      def.key === "running"
        ? entry.status === "running" || entry.status === "idle"
        : entry.status === def.key
    ));
    // 未建造组按解锁等级升序：新玩家一眼看到下一台能建的机器，而不是规则表原始顺序。
    const sorted = def.key === "unbuilt"
      ? [...filtered].sort((left, right) => left.unlockLevel - right.unlockLevel)
      : filtered;
    return { key: def.key, title: def.title, entries: sorted };
  });
}

export function firstSelectable(groups: MachineGroup[]): string | null {
  for (const group of groups) {
    if (group.entries.length > 0) return group.entries[0].id;
  }
  return null;
}
