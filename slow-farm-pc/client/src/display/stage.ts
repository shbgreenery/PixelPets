// 固定舞台：DOM 覆盖层与 Phaser 世界坐标共用同一套 1280×720 设计单位。
// 布局常量永远按设计单位书写；真实屏幕尺寸由 fitScaleFor/renderScaleFor 换算，
// 因此耕地列数、侧栏宽度、面板位置不随分辨率变化。
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

// 显示系数（CSS transform scale）的上下限：
// 上限防止在超大屏上把画面放大到失真；下限保证窗口极小时仍留一条可操作的画面，
// 宁可变小也不裁切——被裁掉的 HUD 是无法操作的。
export const MIN_FIT_SCALE = 0.25;
export const MAX_FIT_SCALE = 4;

// 渲染系数（后备像素 / 相机 zoom）的上限：4K 屏 fit=3、dpr=1 时画布正好
// 3840×2160，已逐像素对齐，再高只增加显存与填充率开销而没有可见收益。
export const MAX_RENDER_SCALE = 3;
// 设备像素比上限 2：3x 屏也只按 2 倍后备分辨率渲染，控制显存与填充率。
const DPR_LIMIT = 2;

// 等比铺满窗口的显示系数：取宽、高两个方向中较小的比例，保证舞台完整可见。
export function fitScaleFor(viewportWidth: number, viewportHeight: number): number {
  if (!(viewportWidth > 0) || !(viewportHeight > 0)) return 1;
  const raw = Math.min(viewportWidth / DESIGN_WIDTH, viewportHeight / DESIGN_HEIGHT);
  return Math.min(MAX_FIT_SCALE, Math.max(MIN_FIT_SCALE, raw));
}

export function clampDpr(value: number): number {
  return value && value > 0 ? Math.min(value, DPR_LIMIT) : 1;
}

// 后备分辨率倍数：画布尺寸、相机缩放、文本分辨率都用它，
// 三者必须同源，否则文本会糊或指针会偏。
export function renderScaleFor(dpr: number, fit: number): number {
  const raw = clampDpr(dpr) * fit;
  return Math.min(MAX_RENDER_SCALE, Math.max(MIN_FIT_SCALE, raw));
}

function viewportWidth(): number {
  if (typeof window === "undefined") return DESIGN_WIDTH;
  return window.innerWidth;
}

function viewportHeight(): number {
  if (typeof window === "undefined") return DESIGN_HEIGHT;
  return window.innerHeight;
}

function deviceDpr(): number {
  if (typeof window === "undefined") return 1;
  return clampDpr(window.devicePixelRatio);
}

// 当前窗口下的显示系数。
export function fitScale(): number {
  return fitScaleFor(viewportWidth(), viewportHeight());
}

// 当前窗口下的渲染系数。
export function renderScale(): number {
  return renderScaleFor(deviceDpr(), fitScale());
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

// 把 #stage 等比缩放到窗口并居中，返回本次生效的两个系数。
// transform 不改变布局盒（仍是 1280×720），所以 DOM 覆盖层与画布一起缩放、坐标保持一致。
export function applyStageFit(): { fit: number; render: number } {
  const fit = fitScale();
  const stage = getStage();
  stage.style.width = `${DESIGN_WIDTH}px`;
  stage.style.height = `${DESIGN_HEIGHT}px`;
  stage.style.transform = `translate(-50%, -50%) scale(${fit})`;
  return { fit, render: renderScaleFor(deviceDpr(), fit) };
}
