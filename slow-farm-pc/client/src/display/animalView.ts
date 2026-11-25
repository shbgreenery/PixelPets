import type { GameState } from "../api/client";

// 动物展示状态：饿着（待喂食）、产出中、可收取。
export type AnimalState = "hungry" | "growing" | "ready";

export interface AnimalViewItem {
  index: number;
  state: AnimalState;
  // 距离产出完成还有多久，饿着与可收取均为 0。
  remaining: number;
}

export interface AnimalCounts {
  hungry: number;
  growing: number;
  ready: number;
}

export interface AnimalView {
  animals: AnimalViewItem[];
  // 仓库有饲料且至少一只饿着。
  canFeed: boolean;
  canCollect: boolean;
  canRush: boolean;
  counts: AnimalCounts;
}

// 只做展示换算，不修改传入的 state。
export function animalView(state: GameState, kind: string, now: number): AnimalView {
  const group = state.animals?.[kind];
  const counts: AnimalCounts = { hungry: 0, growing: 0, ready: 0 };
  const animals = (group?.list ?? []).map((animal, index) => {
    const remaining = Math.max(0, animal.readyAt - now);
    const status: AnimalState = animal.readyAt === 0
      ? "hungry"
      : remaining > 0
        ? "growing"
        : "ready";
    counts[status] += 1;
    return { index, state: status, remaining: status === "growing" ? remaining : 0 };
  });

  return {
    animals,
    canFeed: (state.silo.feed ?? 0) > 0 && animals.some((animal) => animal.state === "hungry"),
    canCollect: animals.some((animal) => animal.state === "ready"),
    canRush: animals.some((animal) => animal.state === "growing"),
    counts,
  };
}

// 畜舍左栏摘要：最多并列两项，混合状态是常态，只显示一项会丢信息。
export function herdSummary(counts: AnimalCounts): string {
  const { hungry, growing, ready } = counts;
  if (ready > 0 && hungry > 0) return `可收取 ${ready} · 待喂食 ${hungry}`;
  if (ready > 0 && growing > 0) return `可收取 ${ready} · 产出中 ${growing}`;
  if (hungry > 0 && growing > 0) return `待喂食 ${hungry} · 产出中 ${growing}`;
  if (ready > 0) return `可收取 ${ready}`;
  if (hungry > 0) return `待喂食 ${hungry}`;
  if (growing > 0) return `产出中 ${growing}`;
  return "空";
}
