import type { GameState } from "../api/client";
import { plotStage } from "./plotView";

// 点击地块后要发送的服务端动作；none 表示只提示、不发请求。
export type PlotCommand =
  | { type: "plant"; args: { plot: number; cropId: string } }
  | { type: "harvest"; args: { plot: number } }
  | { type: "none"; reason: string };

// 根据地块阶段与当前选中的作物决定动作，只读 state。
export function plotCommand(
  state: GameState,
  index: number,
  cropId: string | null,
  now: number,
): PlotCommand {
  const plot = state.plots[index];
  if (!plot) return { type: "none", reason: "bad_plot" };

  const stage = plotStage(state, plot, now);
  if (stage === "empty") {
    if (!cropId) return { type: "none", reason: "unknown_crop" };
    return { type: "plant", args: { plot: index, cropId } };
  }
  if (stage === "ready") return { type: "harvest", args: { plot: index } };
  return { type: "none", reason: "not_ready" };
}
