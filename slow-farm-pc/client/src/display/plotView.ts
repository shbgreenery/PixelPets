import type { GameState, Plot } from "../api/client";

export type PlotStage = "empty" | "growing" | "ready";

// state 目前只用于保持调用签名稳定；生长阶段只看地块自身的时间字段。
export function plotStage(_state: GameState, plot: Plot, now: number): PlotStage {
  if (!plot.cropId) return "empty";
  return now < plot.readyAt ? "growing" : "ready";
}

// 生长进度 0..1：时间跨度无效时按已完成处理，避免除以零。
export function plotProgress(plot: Plot, now: number): number {
  if (!plot.cropId) return 0;
  if (now >= plot.readyAt) return 1;
  const span = plot.readyAt - plot.plantedAt;
  if (span <= 0) return 1;
  return Math.min(1, Math.max(0, (now - plot.plantedAt) / span));
}
