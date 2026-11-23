import type { GameState, Rules } from "../api/client";
import { levelOf } from "./format";

export interface AchievementView {
  id: string;
  title: string;
  desc: string;
  // 展示用进度，封顶到 goal；是否达成只看服务端的 achievements 标记。
  progress: number;
  goal: number;
  done: boolean;
  reward: number;
}

export interface TaskView {
  id: string;
  title: string;
  hint: string;
  reward: number;
  progress: number;
  goal: number;
  // taskIndex 之前的任务已完成，等于 taskIndex 的是当前任务。
  done: boolean;
  current: boolean;
}

function statValue(state: GameState, metric: string): number {
  return state.stats?.[metric] ?? 0;
}

// 与服务端 metricValue 同口径：只读展示，不写入状态。
function achievementMetric(state: GameState, metric: string, rules: Rules): number {
  if (metric === "plots") return state.plots.length;
  if (metric === "machines") {
    return Object.values(state.machines ?? {}).filter((machine) => machine.unlocked).length;
  }
  if (metric === "animalKinds") {
    return Object.values(state.animals ?? {}).filter((group) => group.list.length > 0).length;
  }
  if (metric === "level") return levelOf(state.xp, rules);
  return statValue(state, metric);
}

// 与服务端 taskMetric 同口径。
function taskMetric(state: GameState, metric: string, rules: Rules): number {
  if (metric === "level") return levelOf(state.xp, rules);
  if (metric === "hourglasses") return state.hourglasses ?? 0;
  if (metric.startsWith("visited:")) return state.tabsSeen?.[metric.slice("visited:".length)] ? 1 : 0;
  if (metric.startsWith("recipe:")) return state.unlockedRecipes?.[metric.slice("recipe:".length)] ? 1 : 0;
  if (metric.startsWith("machine:")) {
    return state.machines?.[metric.slice("machine:".length)]?.unlocked ? 1 : 0;
  }
  if (metric.startsWith("animal:")) {
    return state.animals?.[metric.slice("animal:".length)]?.list.length ?? 0;
  }
  return statValue(state, metric);
}

export function achievementView(state: GameState, rules: Rules): AchievementView[] {
  return (rules.ACHIEVEMENTS ?? []).map((def) => ({
    id: def.id,
    title: def.name,
    desc: def.desc,
    progress: Math.min(achievementMetric(state, def.metric, rules), def.goal),
    goal: def.goal,
    done: state.achievements?.[def.id] === true,
    reward: def.reward ?? 0,
  }));
}

export function taskView(state: GameState, rules: Rules): TaskView[] {
  const current = state.taskIndex ?? 0;
  return (rules.TASKS ?? []).map((task, index) => ({
    id: task.id,
    title: task.title,
    hint: task.hint,
    reward: task.reward,
    progress: Math.min(taskMetric(state, task.check.metric, rules), task.check.goal),
    goal: task.check.goal,
    done: index < current,
    current: index === current,
  }));
}
