import { formatGrowTime, levelOf } from "../display/format";
import { cropIcon } from "../display/icons";
import { defaultCropId, seedOptions } from "../display/seedOptions";
import { CONTENT_RIGHT, getStage, STAGE_PADDING } from "../display/stage";
import {
  COLORS,
  FONT_FAMILY,
  FONT_SIZE,
  GROOVE,
  PALETTE,
  SHADOW,
  SURFACE,
} from "../display/theme";
import type { GameStore } from "../state/store";

// 顶部居中的横向种子条：左侧标题，右侧 5 列种子格，宽度对齐主内容列。
const ROOT_STYLE = [
  "position: absolute",
  "top: 72px",
  `left: ${STAGE_PADDING}px`,
  "display: flex",
  "align-items: center",
  "gap: 12px",
  `width: ${CONTENT_RIGHT - STAGE_PADDING}px`,
  "padding: 10px 12px",
  `border-radius: 14px`,
  `border: 1px solid ${COLORS.panelBorder}`,
  `background: ${SURFACE.card}`,
  `box-shadow: ${SHADOW.card}`,
  "z-index: 5",
  `font-family: ${FONT_FAMILY.sans}`,
  `color: ${COLORS.text}`,
].join(";");

const LABEL_STYLE = "flex: none; width: 74px";

const LABEL_TITLE_STYLE = [
  `font-family: ${FONT_FAMILY.serif}`,
  `font-size: ${FONT_SIZE.lg}px`,
  "font-weight: 600",
  "letter-spacing: 0.08em",
  "line-height: 1.3",
].join(";");

const LABEL_HINT_STYLE = [
  `font-size: ${FONT_SIZE.xs}px`,
  "line-height: 1.4",
  `color: ${COLORS.muted}`,
  "letter-spacing: 0.02em",
].join(";");

const LIST_STYLE = [
  "flex: 1 1 auto",
  "display: grid",
  "grid-template-columns: repeat(5, minmax(0, 1fr))",
  "gap: 6px",
  "min-width: 0",
].join(";");

const SEED_BASE = [
  "position: relative",
  "display: flex",
  "align-items: center",
  "gap: 7px",
  "min-width: 0",
  "height: 46px",
  "padding: 0 8px",
  `border-radius: 10px`,
  "border: 1px solid rgba(226, 193, 141, 0.1)",
  `background: ${SURFACE.seed}`,
  "box-shadow: inset 0 1px 0 rgba(255, 226, 178, 0.045)",
  `color: ${COLORS.text}`,
  "text-align: left",
  "cursor: pointer",
  "font: inherit",
  "transition: transform 0.16s ease, border-color 0.16s ease, background 0.16s ease, box-shadow 0.16s ease",
].join(";");

const ICON_STYLE = [
  "width: 24px",
  "height: 24px",
  "border-radius: 50%",
  "display: grid",
  "place-items: center",
  "font-size: 14px",
  "line-height: 1",
  "flex: none",
  `background: ${GROOVE.background}`,
  `box-shadow: ${GROOVE.shadow}`,
  `filter: ${GROOVE.filter}`,
].join(";");

const BODY_STYLE = "display: grid; gap: 1px; min-width: 0";

const NAME_STYLE = [
  `font-size: 12.5px`,
  "font-weight: 600",
  "letter-spacing: 0.02em",
  "line-height: 1.3",
  "white-space: nowrap",
  "overflow: hidden",
  "text-overflow: ellipsis",
].join(";");

const COST_STYLE = [
  `font-family: ${FONT_FAMILY.num}`,
  `font-size: ${FONT_SIZE.xs}px`,
  "line-height: 1.3",
  `color: ${COLORS.muted}`,
  "font-variant-numeric: tabular-nums",
  "white-space: nowrap",
  "overflow: hidden",
  "text-overflow: ellipsis",
].join(";");

const STYLE_ID = "sf-seed-styles";
const SEED_STYLE = `
.sf-seed[data-selected="true"] {
  transform: translateY(-2px);
  border-color: rgba(232, 163, 61, 0.75);
  background: ${SURFACE.seedSelected};
  box-shadow: 0 0 0 1px rgba(232, 163, 61, 0.22), 0 10px 20px -14px rgba(0, 0, 0, 0.9), inset 0 1px 0 rgba(255, 214, 150, 0.16);
  cursor: default;
}
.sf-seed[data-selected="true"]::after {
  content: "";
  position: absolute;
  left: 10px;
  right: 10px;
  bottom: -1px;
  height: 2px;
  border-radius: 999px;
  background: ${PALETTE.amber};
  box-shadow: 0 0 8px rgba(232, 163, 61, 0.8);
}
.sf-seed-check {
  position: absolute;
  top: 3px;
  right: 4px;
  padding: 0 4px;
  border-radius: 999px;
  background: ${PALETTE.amber};
  color: ${PALETTE.amberInk};
  font-size: 9px;
  font-weight: 700;
  line-height: 14px;
  opacity: 0;
  transition: opacity 0.16s ease;
}
.sf-seed[data-selected="true"] .sf-seed-check { opacity: 1; }
.sf-seed-locked { opacity: 0.45; cursor: not-allowed; }
@media (hover: hover) {
  .sf-seed:not(:disabled):not([data-selected="true"]):hover {
    border-color: rgba(232, 163, 61, 0.4);
  }
}
@media (prefers-reduced-motion: reduce) {
  .sf-seed {
    transition: none;
  }
  .sf-seed[data-selected="true"] {
    transform: none;
  }
}
`;

function ensureSeedStyle(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = SEED_STYLE;
  document.head.append(style);
}

ensureSeedStyle();

// 种子面板：列出全部作物，选中后点空地即种下该作物。
export class SeedPanel {
  private readonly root: HTMLDivElement;
  private readonly list: HTMLDivElement;
  private readonly unsubscribe: () => void;
  private currentCropId: string | null = null;

  constructor(private readonly store: GameStore) {
    this.root = document.createElement("div");
    this.root.id = "seed-panel";
    this.root.style.cssText = ROOT_STYLE;

    const label = document.createElement("div");
    label.style.cssText = LABEL_STYLE;
    const title = document.createElement("h2");
    title.style.cssText = LABEL_TITLE_STYLE;
    title.textContent = "种子袋";
    const hint = document.createElement("p");
    hint.style.cssText = LABEL_HINT_STYLE;
    hint.textContent = "点击空地播种";
    label.append(title, hint);

    this.list = document.createElement("div");
    this.list.style.cssText = LIST_STYLE;
    this.list.setAttribute("role", "group");
    this.list.setAttribute("aria-label", "选择要播种的作物");

    this.root.append(label, this.list);
    getStage().append(this.root);

    this.unsubscribe = this.store.subscribe(() => this.render());
    this.render();
  }

  // 当前选中的作物；规则未加载或全部锁定时为 null。
  get selectedCropId(): string | null {
    return this.currentCropId;
  }

  private render(): void {
    this.list.replaceChildren();
    const state = this.store.state;
    const rules = this.store.rules;
    const level = state ? levelOf(state.xp, rules) : 1;
    const options = seedOptions(rules, level);

    if (options.length === 0) {
      const empty = document.createElement("div");
      empty.textContent = "暂无作物";
      empty.style.cssText = `color: ${COLORS.muted}; font-size: ${FONT_SIZE.sm}px`;
      this.list.append(empty);
      return;
    }

    // 选中项失效（被锁定或规则变化）时回到第一个已解锁作物。
    if (!options.some((option) => option.cropId === this.currentCropId && !option.locked)) {
      this.currentCropId = defaultCropId(options);
    }

    for (const option of options) {
      const selected = option.cropId === this.currentCropId;
      const select = document.createElement("button");
      select.type = "button";
      select.dataset.cropId = option.cropId;
      select.style.cssText = SEED_BASE;
      select.classList.add("sf-seed");

      const icon = document.createElement("span");
      icon.style.cssText = ICON_STYLE;
      icon.setAttribute("aria-hidden", "true");
      icon.textContent = cropIcon(option.cropId);

      const body = document.createElement("span");
      body.style.cssText = BODY_STYLE;
      const name = document.createElement("span");
      name.style.cssText = NAME_STYLE;
      name.textContent = option.name;
      const cost = document.createElement("span");
      cost.style.cssText = COST_STYLE;
      cost.textContent = option.locked
        ? `需 Lv.${option.unlockLevel} · ${option.seedPrice} 金`
        : `${option.seedPrice} 金 · ${formatGrowTime(option.growMs)}`;
      body.append(name, cost);

      const check = document.createElement("span");
      check.className = "sf-seed-check";
      check.setAttribute("aria-hidden", "true");
      check.textContent = "✓ 已选";

      select.append(icon, body, check);

      if (option.locked) {
        select.disabled = true;
        select.classList.add("sf-seed-locked");
        select.setAttribute("aria-label", `${option.name}，需等级 ${option.unlockLevel}`);
      } else if (selected) {
        select.dataset.selected = "true";
        select.disabled = true;
        select.setAttribute("aria-pressed", "true");
        select.setAttribute("aria-label", `${option.name}，已选中`);
      } else {
        select.setAttribute("aria-pressed", "false");
        select.addEventListener("click", () => {
          this.currentCropId = option.cropId;
          this.render();
        });
      }
      this.list.append(select);
    }
  }

  destroy(): void {
    this.unsubscribe();
    this.root.remove();
  }
}
