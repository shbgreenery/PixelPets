import { FONT_FAMILY, PALETTE } from "../display/theme";

// 农场页面级样式：夜色径向背景、分区标题与短线、状态提示、toast。
// 地块的 .plot-* 与 @keyframes breathe 由 PlotCellView 自带的 #sf-plot-styles 负责，
// 这里不得重复定义；prefers-reduced-motion 兜底由 panelStyles.ts 的全局规则覆盖。
const STYLE_ID = "sf-farm-styles";

// 底部入口栏的顶边（设计单位），与 FarmView 的底部入口共用同一数值来源。
export const DOCK_TOP = 590;
// 操作提示 toast 贴在入口栏上方 29px，避免和底部入口重叠。
const TOAST_TOP = DOCK_TOP - 29;

const FARM_STYLE = `
.farm-bg {
  position: absolute;
  inset: 0;
  background-color: ${PALETTE.night0};
  background-image:
    radial-gradient(circle 800px at 640px -40px, rgba(232, 163, 61, 0.11), rgba(232, 163, 61, 0)),
    radial-gradient(circle 600px at 640px 760px, rgba(120, 84, 44, 0.17), rgba(120, 84, 44, 0));
  pointer-events: none;
}
.farm-section-title {
  position: absolute;
  transform: translateY(-50%);
  font-family: ${FONT_FAMILY.serif};
  font-size: 18px;
  font-weight: 700;
  line-height: 1;
  white-space: nowrap;
  color: ${PALETTE.ink};
  pointer-events: none;
}
.farm-section-title::after {
  content: "";
  display: inline-block;
  width: 22px;
  height: 1px;
  margin-left: 14px;
  vertical-align: middle;
  background: rgba(232, 163, 61, 0.75);
}
.farm-status {
  position: absolute;
  left: 50%;
  top: calc(50% - 29px);
  transform: translate(-50%, -50%);
  z-index: 10;
  display: none;
  padding: 12px 18px;
  background: #120f09ee;
  font-family: ${FONT_FAMILY.sans};
  font-size: 31px;
  line-height: 1.2;
  text-align: center;
  white-space: nowrap;
  color: ${PALETTE.claySoft};
  pointer-events: none;
}
.farm-status[data-visible="true"] {
  display: block;
}
.farm-toast {
  position: absolute;
  left: 50%;
  top: ${TOAST_TOP}px;
  transform: translate(-50%, -50%);
  z-index: 10;
  display: none;
  padding: 7px 14px;
  background: #120f09ee;
  font-family: ${FONT_FAMILY.sans};
  font-size: 17px;
  line-height: 1.2;
  white-space: nowrap;
  color: ${PALETTE.amberSoft};
  pointer-events: none;
}
.farm-toast[data-visible="true"] {
  display: block;
}
`;

// 只注入一次；非浏览器环境（如构建期或纯逻辑测试）直接跳过。
function ensureFarmStyle(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = FARM_STYLE;
  document.head.append(style);
}

ensureFarmStyle();
