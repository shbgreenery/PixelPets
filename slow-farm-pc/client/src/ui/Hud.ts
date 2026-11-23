import { levelProgress } from "../display/format";
import { hudIcon } from "../display/icons";
import { getStage } from "../display/stage";
import {
  COLORS,
  FONT_FAMILY,
  FONT_SIZE,
  GROOVE,
  SHADOW,
  SURFACE,
} from "../display/theme";
import type { GameStore } from "../state/store";

type HudField = "coins" | "gems" | "hourglass";

// 中部三组资源：图标凹槽 + 数值 + 单位。
const RESOURCES: Array<[HudField, string]> = [
  ["coins", "金币"],
  ["gems", "宝石"],
  ["hourglass", "沙漏"],
];

const ROOT_STYLE = [
  "position: absolute",
  "top: 0",
  "left: 0",
  "right: 0",
  "height: 64px",
  "display: flex",
  "align-items: center",
  "gap: 18px",
  "padding: 0 22px",
  `border-bottom: 1px solid ${COLORS.panelBorder}`,
  `background: ${SURFACE.hud}`,
  "box-shadow: 0 1px 0 rgba(232, 163, 61, 0.07)",
  "z-index: 6",
  "pointer-events: none",
  `font-family: ${FONT_FAMILY.sans}`,
  `color: ${COLORS.text}`,
].join(";");

const HAIRLINE_STYLE = [
  "position: absolute",
  "top: 0",
  "left: 12%",
  "right: 12%",
  "height: 1px",
  "background: linear-gradient(90deg, transparent, rgba(232, 163, 61, 0.45), transparent)",
].join(";");

const LEVEL_STYLE = [
  "width: 42px",
  "height: 42px",
  "border-radius: 50%",
  "display: flex",
  "flex-direction: column",
  "align-items: center",
  "justify-content: center",
  "gap: 1px",
  "background: radial-gradient(circle at 32% 24%, #6a4a26, #2a2015 72%)",
  "border: 1px solid rgba(232, 163, 61, 0.48)",
  "box-shadow: 0 0 0 3px rgba(232, 163, 61, 0.07), inset 0 1px 0 rgba(255, 214, 150, 0.25)",
  "flex: none",
].join(";");

const LEVEL_NUM_STYLE = [
  `font-family: ${FONT_FAMILY.num}`,
  "font-size: 15px",
  "font-weight: 700",
  "line-height: 1",
  `color: ${COLORS.amberSoft}`,
  "font-variant-numeric: tabular-nums",
].join(";");

const LEVEL_TAG_STYLE = [
  "font-size: 8px",
  "letter-spacing: 0.18em",
  "line-height: 1",
  `color: ${COLORS.muted}`,
  "padding-left: 0.18em",
].join(";");

const NAME_STYLE = [
  `font-family: ${FONT_FAMILY.serif}`,
  "font-size: 20px",
  "font-weight: 600",
  "letter-spacing: 0.05em",
  "line-height: 1.2",
  `color: ${COLORS.text}`,
].join(";");

const SUB_STYLE = [
  `font-size: ${FONT_SIZE.xs}px`,
  "line-height: 1.4",
  "letter-spacing: 0.03em",
  `color: ${COLORS.muted}`,
].join(";");

const RES_STYLE = [
  "display: flex",
  "align-items: center",
  "gap: 9px",
  "height: 44px",
  "padding: 0 14px 0 7px",
  "border-radius: 999px",
  `background: ${SURFACE.resource}`,
  `border: 1px solid ${COLORS.panelBorder}`,
  `box-shadow: ${SHADOW.card}`,
].join(";");

const RES_ICON_STYLE = [
  "width: 30px",
  "height: 30px",
  "border-radius: 50%",
  "display: grid",
  "place-items: center",
  "font-size: 15px",
  "line-height: 1",
  "flex: none",
  `background: ${GROOVE.background}`,
  `box-shadow: ${GROOVE.shadow}`,
  `filter: ${GROOVE.filter}`,
].join(";");

const RES_VALUE_STYLE = [
  `font-family: ${FONT_FAMILY.num}`,
  "font-size: 15px",
  "font-weight: 700",
  "line-height: 1.25",
  "letter-spacing: 0.01em",
  `color: ${COLORS.text}`,
  "font-variant-numeric: tabular-nums",
].join(";");

const RES_LABEL_STYLE = [
  `font-size: ${FONT_SIZE.xs}px`,
  "line-height: 1.3",
  "letter-spacing: 0.14em",
  `color: ${COLORS.muted}`,
].join(";");

const XP_STYLE = "width: 136px";
const XP_ROW_STYLE = "display: flex; align-items: baseline; justify-content: space-between; gap: 8px";
const XP_LABEL_STYLE = [
  `font-size: ${FONT_SIZE.xs}px`,
  "letter-spacing: 0.14em",
  `color: ${COLORS.muted}`,
].join(";");
const XP_VALUE_STYLE = [
  `font-family: ${FONT_FAMILY.num}`,
  "font-size: 11px",
  `color: ${COLORS.subtle}`,
  "font-variant-numeric: tabular-nums",
].join(";");
const BAR_STYLE = [
  "position: relative",
  "display: block",
  "height: 4px",
  "border-radius: 999px",
  "background: rgba(0, 0, 0, 0.42)",
  "overflow: hidden",
  "margin-top: 5px",
].join(";");
const BAR_FILL_STYLE = [
  "position: absolute",
  "inset: 0",
  "display: block",
  "border-radius: 999px",
  "transform-origin: left center",
  "transform: scaleX(0)",
  "background: linear-gradient(90deg, #d99a33, #ffc76b)",
  "transition: transform 0.5s linear",
].join(";");

function field(styles: string): HTMLDivElement {
  const element = document.createElement("div");
  element.style.cssText = `display: grid; gap: 1px;${styles}`;
  return element;
}

function formatAmount(value: number): string {
  return Math.max(0, Math.floor(value)).toLocaleString("zh-CN");
}

// 顶部 HUD：左侧等级徽章与农场名，中部金币/宝石/沙漏，右侧经验条。
export class Hud {
  private readonly root: HTMLDivElement;
  private readonly levelNum: HTMLSpanElement;
  private readonly farmSub: HTMLParagraphElement;
  private readonly values: Record<HudField, HTMLSpanElement>;
  private readonly xpValue: HTMLSpanElement;
  private readonly xpFill: HTMLElement;
  private readonly unsubscribe: () => void;

  constructor(private readonly store: GameStore) {
    this.root = document.createElement("div");
    this.root.id = "hud";
    this.root.style.cssText = ROOT_STYLE;

    const hairline = document.createElement("div");
    hairline.style.cssText = HAIRLINE_STYLE;

    // 等级徽章 + 农场名。
    const identity = document.createElement("div");
    identity.style.cssText = "display: flex; align-items: center; gap: 12px; flex: none";
    const level = document.createElement("div");
    level.style.cssText = LEVEL_STYLE;
    level.setAttribute("role", "img");
    this.levelNum = document.createElement("span");
    this.levelNum.style.cssText = LEVEL_NUM_STYLE;
    const levelTag = document.createElement("span");
    levelTag.style.cssText = LEVEL_TAG_STYLE;
    levelTag.textContent = "LV";
    level.append(this.levelNum, levelTag);
    const titleBlock = field("");
    const name = document.createElement("h1");
    name.style.cssText = NAME_STYLE;
    name.textContent = "慢慢农场";
    this.farmSub = document.createElement("p");
    this.farmSub.style.cssText = SUB_STYLE;
    this.farmSub.textContent = "夜间农场";
    titleBlock.append(name, this.farmSub);
    identity.append(level, titleBlock);

    // 中部资源。
    const resources = document.createElement("div");
    resources.style.cssText = "display: flex; gap: 10px; margin-inline: auto";
    const values = {} as Record<HudField, HTMLSpanElement>;
    for (const [key, label] of RESOURCES) {
      const pill = document.createElement("div");
      pill.style.cssText = RES_STYLE;
      const icon = document.createElement("span");
      icon.style.cssText = RES_ICON_STYLE;
      icon.setAttribute("aria-hidden", "true");
      icon.textContent = hudIcon(key);
      const body = field("");
      const value = document.createElement("span");
      value.style.cssText = RES_VALUE_STYLE;
      value.textContent = "0";
      const unit = document.createElement("span");
      unit.style.cssText = RES_LABEL_STYLE;
      unit.textContent = label;
      body.append(value, unit);
      pill.append(icon, body);
      resources.append(pill);
      values[key] = value;
    }
    this.values = values;

    // 右侧经验条。
    const xp = document.createElement("div");
    xp.style.cssText = XP_STYLE;
    const xpRow = document.createElement("div");
    xpRow.style.cssText = XP_ROW_STYLE;
    const xpLabel = document.createElement("span");
    xpLabel.style.cssText = XP_LABEL_STYLE;
    xpLabel.textContent = "经验";
    this.xpValue = document.createElement("span");
    this.xpValue.style.cssText = XP_VALUE_STYLE;
    this.xpValue.textContent = "0 / 0";
    xpRow.append(xpLabel, this.xpValue);
    const bar = document.createElement("span");
    bar.style.cssText = BAR_STYLE;
    this.xpFill = document.createElement("i");
    this.xpFill.style.cssText = BAR_FILL_STYLE;
    bar.append(this.xpFill);
    xp.append(xpRow, bar);

    this.root.append(hairline, identity, resources, xp);
    getStage().append(this.root);

    this.unsubscribe = this.store.subscribe(() => this.render());
    this.render();
  }

  private render(): void {
    const state = this.store.state;
    const progress = levelProgress(state?.xp ?? 0, this.store.rules);
    this.levelNum.textContent = String(progress.level);
    this.values.coins.textContent = formatAmount(state?.coins ?? 0);
    this.values.gems.textContent = formatAmount(state?.gems ?? 0);
    this.values.hourglass.textContent = formatAmount(state?.hourglasses ?? 0);
    this.farmSub.textContent = state
      ? `夜间农场 · ${state.plots.length} 块耕地`
      : "夜间农场";

    if (progress.span === 0) {
      this.xpValue.textContent = "已满级";
    } else {
      this.xpValue.textContent = `${progress.into} / ${progress.span}`;
    }
    this.xpFill.style.transform = `scaleX(${progress.ratio.toFixed(3)})`;
  }

  destroy(): void {
    this.unsubscribe();
    this.root.remove();
  }
}
