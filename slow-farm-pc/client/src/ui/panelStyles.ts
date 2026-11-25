import {
  COLORS,
  DISABLED,
  FONT,
  FONT_FAMILY,
  FONT_SIZE,
  RADIUS,
  SHADOW,
  SPACING,
  SURFACE,
} from "../display/theme";

// 面板共享样式：8 个面板统一卡片外观、标题、行与按钮，避免各自重复定义。
// 覆盖层落在 1280×720 固定舞台内，用 absolute 而不是固定到视口。
export const OVERLAY_STYLE = [
  "position: absolute",
  "inset: 0",
  "display: none",
  "align-items: center",
  "justify-content: center",
  `background: ${SURFACE.overlay}`,
  "z-index: 20",
  `font: ${FONT}`,
].join(";");

// 卡片视觉：不含宽度与定位，常驻面板与弹层各自追加布局。
export const CARD_STYLE = [
  `padding: ${SPACING.lg}px`,
  `border: 1px solid ${COLORS.panelBorderStrong}`,
  `border-radius: ${RADIUS.lg}`,
  `background: ${SURFACE.card}`,
  `color: ${COLORS.text}`,
  `font: ${FONT}`,
  `box-shadow: ${SHADOW.card}, ${SHADOW.panel}`,
].join(";");

// 弹层卡片：统一宽度与滚动区域（相对 1280×720 舞台，不再跟随视口）。
export const OVERLAY_CARD_STYLE = [
  CARD_STYLE,
  "width: min(680px, 92%)",
  "max-height: calc(100% - 96px)",
  "overflow-y: auto",
].join(";");

// 滚动容器共享类名：所有带滚动的面板都加上，统一深色细滚动条。
export const SCROLL_CLASS = "sf-scroll";

const STYLE_ID = "sf-panel-styles";
const SHARED_STYLE = `
.${SCROLL_CLASS} {
  scrollbar-width: thin;
  scrollbar-color: rgba(226, 193, 141, 0.16) transparent;
}
.${SCROLL_CLASS}::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}
.${SCROLL_CLASS}::-webkit-scrollbar-track {
  background: transparent;
}
.${SCROLL_CLASS}::-webkit-scrollbar-thumb {
  background: rgba(226, 193, 141, 0.16);
  border-radius: 999px;
}
.sf-btn {
  transition: background 0.16s ease, border-color 0.16s ease, color 0.16s ease;
}
@media (hover: hover) {
  .sf-btn.sf-ghost:not(:disabled):hover {
    background: rgba(255, 226, 178, 0.09);
    border-color: ${COLORS.panelBorderStrong};
    color: ${COLORS.text};
  }
  .sf-btn.sf-primary:not(:disabled):hover {
    background: linear-gradient(180deg, #ffc164, #e39f38);
  }
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.001ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.001ms !important;
  }
  .sf-seed[data-selected="true"] {
    transform: none !important;
  }
}
`;

// 只注入一次；非浏览器环境（如构建期或纯逻辑测试）直接跳过。
function ensureSharedStyle(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = SHARED_STYLE;
  document.head.append(style);
}

ensureSharedStyle();

// 面板操作提示：贴在滚动容器底部，长面板滚动时仍保持在可视区内。
export const NOTE_STYLE = [
  "position: sticky",
  "bottom: 0",
  `margin-top: ${SPACING.sm}px`,
  `padding: 7px 10px`,
  `border: 1px dashed rgba(232, 163, 61, 0.3)`,
  `border-radius: ${RADIUS.sm}`,
  "background: rgba(232, 163, 61, 0.055)",
  `color: ${COLORS.clay}`,
  `font-size: ${FONT_SIZE.sm}px`,
  "line-height: 1.5",
  "min-height: 16px",
].join(";");

export const HEADER_STYLE = [
  "display: flex",
  "align-items: center",
  "justify-content: space-between",
  `gap: ${SPACING.md}px`,
  "margin-bottom: 12px",
  `padding-bottom: 10px`,
  `border-bottom: 1px solid ${COLORS.panelBorder}`,
].join(";");

export const TITLE_STYLE = [
  `font-family: ${FONT_FAMILY.serif}`,
  `font-size: ${FONT_SIZE.xl}px`,
  "font-weight: 600",
  "letter-spacing: 0.06em",
  `color: ${COLORS.text}`,
].join(";");

export const SECTION_STYLE = [
  `margin-top: ${SPACING.md}px`,
  `padding: ${SPACING.md}px`,
  `border: 1px solid rgba(226, 193, 141, 0.11)`,
  `border-radius: ${RADIUS.md}`,
  `background: ${SURFACE.section}`,
].join(";");

export const ROW_STYLE = [
  "display: flex",
  "flex-wrap: wrap",
  "align-items: center",
  "justify-content: space-between",
  `gap: ${SPACING.sm}px`,
  `padding: ${SPACING.xs}px 0`,
].join(";");

export const NAME_STYLE = "flex: 1 1 auto; min-width: 0";

export const MUTED_STYLE = `color: ${COLORS.muted}; font-size: ${FONT_SIZE.sm}px`;

// 数值强调：金币、数量等关键数字统一用柔琥珀色。
export const VALUE_STYLE = [
  `font-family: ${FONT_FAMILY.num}`,
  `font-size: 12.5px`,
  "font-weight: 600",
  `color: ${COLORS.amberSoft}`,
].join(";");

const BUTTON_BASE = [
  "display: inline-flex",
  "align-items: center",
  "justify-content: center",
  "gap: 5px",
  "height: 30px",
  "padding: 0 12px",
  `border-radius: ${RADIUS.sm}`,
  "border: 1px solid transparent",
  `font-size: ${FONT_SIZE.sm}px`,
  "font-weight: 600",
  "letter-spacing: 0.03em",
  "white-space: nowrap",
  "cursor: pointer",
].join(";");

// 次要动作：描边幽灵按钮。
export const BUTTON_STYLE = [
  BUTTON_BASE,
  "background: rgba(255, 226, 178, 0.05)",
  `border-color: ${COLORS.panelBorder}`,
  `color: ${COLORS.subtle}`,
].join(";");

// 主动作：琥珀渐变，只有"现在就能做"时才使用。
export const PRIMARY_BUTTON_STYLE = [
  BUTTON_BASE,
  "background: linear-gradient(180deg, #f0ad48, #d9932f)",
  "border-color: #f3bb63",
  `color: ${COLORS.amberInk}`,
  "box-shadow: inset 0 1px 0 rgba(255, 225, 180, 0.35), 0 6px 14px -8px rgba(232, 163, 61, 0.7)",
].join(";");

const GHOST_DISABLED = [
  "background: rgba(255, 226, 178, 0.02)",
  "border-color: rgba(226, 193, 141, 0.08)",
  `color: ${DISABLED.ghostInk}`,
  "cursor: not-allowed",
].join(";");

const PRIMARY_DISABLED = [
  `background: ${DISABLED.fill}`,
  `border-color: ${DISABLED.line}`,
  `color: ${DISABLED.ink}`,
  "box-shadow: none",
  "cursor: not-allowed",
].join(";");

export type ButtonTone = "ghost" | "primary";

// 统一按钮构造：禁用态用实色压暗，点击行为由调用方提供。
export function makeButton(
  label: string,
  disabled: boolean,
  onClick: () => void,
  tone: ButtonTone = "ghost",
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.className = `sf-btn sf-${tone}`;
  button.style.cssText = tone === "primary" ? PRIMARY_BUTTON_STYLE : BUTTON_STYLE;
  button.disabled = disabled;
  if (disabled) {
    button.style.cssText += `;${tone === "primary" ? PRIMARY_DISABLED : GHOST_DISABLED}`;
  }
  button.addEventListener("click", onClick);
  return button;
}

// 左右分栏卡片：固定高度、内部各自滚动，避免整卡滚动导致左栏索引滚出视野。
export const SPLIT_CARD_STYLE = [
  CARD_STYLE,
  "width: min(680px, 92%)",
  "height: calc(100% - 96px)",
  "display: flex",
  "flex-direction: column",
  "overflow: hidden",
  "box-sizing: border-box",
].join(";");

export const QUICK_BAR_STYLE = [
  "display: flex",
  "align-items: center",
  "gap: 8px",
  "padding: 0 0 10px",
  `border-bottom: 1px solid ${COLORS.panelBorder}`,
  "flex: none",
].join(";");

export const SPLIT_BODY_STYLE = [
  "display: grid",
  "grid-template-columns: 160px minmax(0, 1fr)",
  "gap: 12px",
  "flex: 1 1 auto",
  "min-height: 0",
].join(";");

export const SIDE_LIST_STYLE = "overflow-y: auto; min-height: 0; padding-right: 2px";

export const SIDE_GROUP_TITLE_STYLE = [
  "display: flex",
  "align-items: center",
  "justify-content: space-between",
  "padding: 6px 4px 4px",
  `font-size: ${FONT_SIZE.xs}px`,
  `color: ${COLORS.muted}`,
  "letter-spacing: 0.04em",
  "cursor: pointer",
  "user-select: none",
].join(";");

export const SIDE_ITEM_STYLE = [
  "display: flex",
  "align-items: center",
  "gap: 6px",
  "width: 100%",
  "height: 32px",
  "padding: 0 8px",
  "border: 1px solid transparent",
  "border-radius: 8px",
  "background: transparent",
  `color: ${COLORS.subtle}`,
  "font: inherit",
  "text-align: left",
  "cursor: pointer",
].join(";");

export const SIDE_ITEM_ACTIVE = [
  `background: ${SURFACE.activeAmber}`,
  `border-color: ${COLORS.panelBorderStrong}`,
  `color: ${COLORS.text}`,
].join(";");

export const DETAIL_STYLE = [
  "min-height: 0",
  "display: flex",
  "flex-direction: column",
  "gap: 8px",
].join(";");

// 详情区中段：队列与配方在这里滚动，标题行与底部低频区保持固定。
export const DETAIL_SCROLL_STYLE = [
  "overflow-y: auto",
  "min-height: 0",
  "flex: 1 1 auto",
  "display: flex",
  "flex-direction: column",
  "gap: 8px",
  "padding-right: 2px",
].join(";");
