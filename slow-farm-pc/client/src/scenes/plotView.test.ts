import { describe, expect, it } from "vitest";
import type { GameState, Plot } from "../api/client";
import { STAGE_COLOR } from "../display/theme";
import { plotProgress, plotStage, stageBarColor } from "./PlotView";

function makeState(plots: Plot[] = []): GameState {
  return { coins: 0, gems: 0, xp: 0, plots, silo: {} };
}

function makePlot(overrides: Partial<Plot> = {}): Plot {
  return { id: 1, cropId: null, plantedAt: 0, readyAt: 0, ...overrides };
}

describe("plotStage", () => {
  it("空地返回 empty", () => {
    const plot = makePlot();
    expect(plotStage(makeState([plot]), plot, 1_000)).toBe("empty");
  });

  it("未成熟返回 growing", () => {
    const plot = makePlot({ cropId: "wheat", plantedAt: 1_000, readyAt: 61_000 });
    expect(plotStage(makeState([plot]), plot, 30_000)).toBe("growing");
    // 到点前一毫秒仍是 growing。
    expect(plotStage(makeState([plot]), plot, 60_999)).toBe("growing");
  });

  it("到点返回 ready", () => {
    const plot = makePlot({ cropId: "wheat", plantedAt: 1_000, readyAt: 61_000 });
    expect(plotStage(makeState([plot]), plot, 61_000)).toBe("ready");
  });

  it("成熟后过很久仍是 ready", () => {
    const plot = makePlot({ cropId: "wheat", plantedAt: 1_000, readyAt: 61_000 });
    expect(plotStage(makeState([plot]), plot, 61_000 + 86_400_000)).toBe("ready");
  });
});

describe("plotProgress", () => {
  it("空地不显示进度", () => {
    expect(plotProgress(makePlot(), 30_000)).toBe(0);
  });

  it("按播种时间到成熟时间线性换算并夹在 0..1", () => {
    const plot = makePlot({ cropId: "wheat", plantedAt: 10_000, readyAt: 70_000 });
    expect(plotProgress(plot, 0)).toBe(0);
    expect(plotProgress(plot, 10_000)).toBe(0);
    expect(plotProgress(plot, 40_000)).toBe(0.5);
    expect(plotProgress(plot, 70_000)).toBe(1);
    expect(plotProgress(plot, 999_000)).toBe(1);
  });

  it("时间跨度异常时不产生 NaN", () => {
    const plot = makePlot({ cropId: "wheat", plantedAt: 50_000, readyAt: 50_000 });
    expect(plotProgress(plot, 0)).toBe(1);
  });
});

describe("stageBarColor", () => {
  it("按阶段取语义色", () => {
    expect(stageBarColor("empty")).toBeNull();
    expect(stageBarColor("growing")).toBe(STAGE_COLOR.grassSoft);
    expect(stageBarColor("ready")).toBe(STAGE_COLOR.amber);
  });
});
