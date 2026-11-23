import type { GameState, Rules } from "../api/client";
import { formatCountdown, levelOf } from "./format";

// 畜舍展示状态：未解锁、可收取（琥珀）、产出中（草绿）、空闲/待喂食。
export type StallTone = "ready" | "growing" | "idle" | "locked";

export interface StallView {
  kind: string;
  name: string;
  productName: string;
  unlocked: boolean;
  count: number;
  readyCount: number;
  status: string;
  tone: StallTone;
  progress: number;
}

// 单只动物的产出进度 0..1：未开始为 0，已到点为 1，其余按周期换算。
export function animalProgress(cycleMs: number, readyAt: number, now: number): number {
  if (readyAt <= 0) return 0;
  if (readyAt <= now) return 1;
  if (cycleMs <= 0) return 0;
  return Math.min(1, Math.max(0, 1 - (readyAt - now) / cycleMs));
}

// 三个畜舍的展示数据；进度条取最接近产出的那只动物。
export function stallViews(state: GameState, rules: Rules, now: number): StallView[] {
  const level = levelOf(state.xp, rules);

  return Object.entries(rules.ANIMALS ?? {}).map(([kind, def]) => {
    const list = state.animals?.[kind]?.list ?? [];
    const unlocked = level >= def.unlockLevel;
    const readyCount = list.filter((animal) => animal.readyAt > 0 && animal.readyAt <= now).length;
    const growing = list.filter((animal) => animal.readyAt > now);
    const progress = list.reduce(
      (max, animal) => Math.max(max, animalProgress(def.cycleMs, animal.readyAt, now)),
      0,
    );

    let tone: StallTone = "idle";
    if (!unlocked) tone = "locked";
    else if (readyCount > 0) tone = "ready";
    else if (growing.length > 0) tone = "growing";

    let status: string;
    if (!unlocked) status = `需 Lv.${def.unlockLevel}`;
    else if (list.length === 0) status = `还没有${def.name}`;
    else if (readyCount > 0) status = `${readyCount} 只可收取`;
    else if (growing.length > 0) {
      const nextReady = Math.min(...growing.map((animal) => animal.readyAt));
      status = `产出中 ${formatCountdown(nextReady - now)}`;
    } else {
      status = "待喂食";
    }

    return {
      kind,
      name: def.name,
      productName: rules.ITEMS[def.product]?.name ?? def.product,
      unlocked,
      count: list.length,
      readyCount,
      status,
      tone,
      progress,
    };
  });
}
