import { describe, expect, it } from "vitest";
import {
  DESIGN_HEIGHT,
  DESIGN_WIDTH,
  MAX_FIT_SCALE,
  MAX_RENDER_SCALE,
  MIN_FIT_SCALE,
  fitScaleFor,
  renderScaleFor,
} from "./stage";

describe("fitScaleFor", () => {
  it("整屏正好等于设计尺寸时按 1 倍显示", () => {
    expect(fitScaleFor(DESIGN_WIDTH, DESIGN_HEIGHT)).toBe(1);
  });

  it("取宽高比中较小的一个，保证整块舞台完整可见", () => {
    // 1366×768 笔记本：高度是瓶颈。
    expect(fitScaleFor(1366, 768)).toBeCloseTo(768 / 720, 6);
    // 超宽屏：宽度不是瓶颈，高度是。
    expect(fitScaleFor(3440, 1440)).toBe(2);
  });

  it("窗口比设计尺寸小时缩小而不裁切", () => {
    expect(fitScaleFor(960, 540)).toBe(0.75);
  });

  it("极小窗口被钳制在下限，避免缩到无法点击", () => {
    expect(fitScaleFor(200, 120)).toBe(MIN_FIT_SCALE);
  });

  it("超大屏幕被钳制在上限，防止画面被放大到失真", () => {
    expect(fitScaleFor(7680, 4320)).toBe(MAX_FIT_SCALE);
  });

  it("尺寸非法时退回 1 倍", () => {
    expect(fitScaleFor(0, 720)).toBe(1);
    expect(fitScaleFor(Number.NaN, 720)).toBe(1);
  });
});

describe("renderScaleFor", () => {
  it("等于 dpr × 显示系数", () => {
    expect(renderScaleFor(1, 1.5)).toBeCloseTo(1.5, 6);
    expect(renderScaleFor(2, 1)).toBe(2);
  });

  it("dpr 上限为 2：3x 屏不按 3 倍渲染", () => {
    expect(renderScaleFor(3, 1)).toBe(2);
  });

  it("总倍数被 MAX_RENDER_SCALE 封顶，4K 屏不无谓放大后备分辨率", () => {
    expect(renderScaleFor(2, 3)).toBe(MAX_RENDER_SCALE);
  });

  it("dpr 非法时按 1 处理", () => {
    expect(renderScaleFor(0, 1)).toBe(1);
  });
});
