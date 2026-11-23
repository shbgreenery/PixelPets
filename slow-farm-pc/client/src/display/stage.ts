// 固定舞台：DOM 覆盖层与 Phaser 世界坐标共用同一套 1280×720 设计单位。
// 画布按设备像素比渲染后备分辨率，但 CSS 尺寸恒定，不再随窗口拉伸。
export const DESIGN_WIDTH = 1280;
export const DESIGN_HEIGHT = 720;

// 主内容列左右内边距，以及右侧常驻仓库侧卡的占位宽度。
export const STAGE_PADDING = 22;
export const SIDE_RAIL_MARGIN = 16;
export const SIDE_RAIL_WIDTH = 248;
export const SIDE_RAIL_GAP = 12;
// 主内容列右边界：种子条、耕地与畜舍都对齐到这里，给右侧库卡留出空间。
export const CONTENT_RIGHT =
  DESIGN_WIDTH - SIDE_RAIL_MARGIN - SIDE_RAIL_WIDTH - SIDE_RAIL_GAP;

// 设备像素比上限 2：3x 屏也只按 2 倍后备分辨率渲染，控制显存与填充率。
export function stageDpr(): number {
  if (typeof window === "undefined") return 1;
  const value = window.devicePixelRatio;
  return value && value > 0 ? Math.min(value, 2) : 1;
}

// 覆盖层挂载点：index.html 提供 #stage；测试环境缺失时惰性创建。
export function getStage(): HTMLElement {
  const existing = document.getElementById("stage");
  if (existing) return existing;
  const stage = document.createElement("div");
  stage.id = "stage";
  document.body.append(stage);
  return stage;
}
