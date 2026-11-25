import type { GameState, Rules } from "../api/client";
import { stallViews, type StallTone } from "../display/barnView";
import { animalIcon } from "../display/icons";
import { FONT_FAMILY, PALETTE } from "../display/theme";

// 几何照旧画布版：卡片半径 14、围栏 53×53、卡片高 79、栏位间隙 13。
const CARD_RADIUS = 14;
const PEN_SIZE = 53;
const CARD_HEIGHT = 79;
const CARD_GAP = 13;
// 栏位标题行相对卡片中心的偏移；状态行中心在中心 +1。
const TITLE_ROW = 26;

// 围栏左右内边距 14，文字从围栏右侧再空 12 开始。
const CARD_PADDING = 14;
const TEXT_LEFT = CARD_PADDING + PEN_SIZE + 12;
const PEN_TOP = (CARD_HEIGHT - PEN_SIZE) / 2;

const STYLE_ID = "sf-barn-styles";
// 四态配色照 TONE_STYLE：ready 琥珀、growing 草绿、idle/locked 灰。
// locked 卡片压暗一档；边框只在 ready 时提高透明度。
const BARN_STYLE = `
.barn-rack {
  position: absolute;
  color: ${PALETTE.ink};
  font-family: ${FONT_FAMILY.sans};
}
.stall {
  position: absolute;
  top: 0;
  box-sizing: border-box;
  height: ${CARD_HEIGHT}px;
  color: ${PALETTE.ink};
  font-family: ${FONT_FAMILY.sans};
  cursor: pointer;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
}
/* 根节点保持矩形：整张卡片都是命中区；半径 14 的外观由 ::before 绘制，
   避免浏览器按圆角裁剪命中区，导致圆角外约 1% 面积点不到（旧画布 hit 是整矩形）。 */
.stall::before {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: ${CARD_RADIUS}px;
  border: 1px solid rgba(122, 102, 72, 0.1);
  background: ${PALETTE.night3};
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
  pointer-events: none;
}
.stall[data-tone="ready"]::before {
  border-color: rgba(232, 163, 61, 0.45);
  background: ${PALETTE.night4};
}
.stall[data-tone="locked"]::before {
  border-color: rgba(122, 102, 72, 0.08);
  background: ${PALETTE.night2};
}
.stall-pen {
  position: absolute;
  left: ${CARD_PADDING}px;
  top: ${PEN_TOP}px;
  box-sizing: border-box;
  width: ${PEN_SIZE}px;
  height: ${PEN_SIZE}px;
  border-radius: ${CARD_RADIUS}px;
  background: #34291c;
  box-shadow: inset 0 0 0 1px rgba(122, 102, 72, 0.12), inset 0 0 0 3px rgba(0, 0, 0, 0.35);
  pointer-events: none;
}
.stall-animal {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  font-family: ${FONT_FAMILY.sans};
  font-size: 24px;
  line-height: 1;
  opacity: 0.95;
  pointer-events: none;
}
img.stall-animal {
  width: 36px;
  height: 36px;
  object-fit: contain;
  opacity: 1;
}
.stall[data-tone="locked"] .stall-animal {
  opacity: 0.45;
}
.stall-name {
  position: absolute;
  left: ${TEXT_LEFT}px;
  top: calc(50% - ${TITLE_ROW}px);
  transform: translateY(-50%);
  font-family: ${FONT_FAMILY.sans};
  font-size: 16px;
  font-weight: 700;
  line-height: 1.2;
  white-space: nowrap;
  color: ${PALETTE.ink};
  pointer-events: none;
}
.stall-product {
  position: absolute;
  right: ${CARD_PADDING}px;
  top: calc(50% - ${TITLE_ROW}px);
  transform: translateY(-50%);
  font-family: ${FONT_FAMILY.num};
  font-size: 13px;
  line-height: 1.2;
  white-space: nowrap;
  color: ${PALETTE.ink3};
  pointer-events: none;
}
.stall-status {
  position: absolute;
  left: ${TEXT_LEFT}px;
  top: calc(50% + 1px);
  transform: translateY(-50%);
  font-family: ${FONT_FAMILY.sans};
  font-size: 14px;
  line-height: 1.2;
  white-space: nowrap;
  color: ${PALETTE.ink3};
  pointer-events: none;
}
.stall[data-tone="ready"] .stall-status {
  color: ${PALETTE.amberSoft};
}
.stall-bar-track {
  position: absolute;
  left: ${TEXT_LEFT}px;
  right: ${CARD_PADDING}px;
  top: calc(50% + 26px);
  transform: translateY(-50%);
  height: 5px;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.42);
  overflow: hidden;
  pointer-events: none;
}
.stall-bar {
  display: block;
  width: 100%;
  height: 100%;
  border-radius: 999px;
  background: ${PALETTE.ink3};
  transform: scaleX(0);
  transform-origin: left center;
  transition: transform 0.25s linear;
}
.stall[data-tone="growing"] .stall-bar {
  background: ${PALETTE.grassSoft};
}
.stall[data-tone="ready"] .stall-bar {
  background: ${PALETTE.amber};
}
`;

function ensureBarnStyle(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = BARN_STYLE;
  document.head.append(style);
}

ensureBarnStyle();

export interface BarnRackConfig {
  left: number;
  right: number;
  y: number;
  hasTexture: (kind: string) => boolean;
  onSelect: () => void;
}

interface Stall {
  kind: string;
  element: HTMLDivElement;
  name: HTMLDivElement;
  product: HTMLDivElement;
  status: HTMLDivElement;
  barFill: HTMLDivElement;
  tone: StallTone;
  lastName: string;
  lastProduct: string;
  lastStatus: string;
  lastProgress: number;
}

// 畜舍 DOM 版本：每种动物一个栏位，语气与配色只由根节点的 data-tone 驱动。
// update() 先按规则表同步栏位，再逐栏做差分更新；值未变不写 DOM。
export class BarnRackView {
  readonly element: HTMLDivElement;
  private readonly config: BarnRackConfig;
  private stalls: Stall[] = [];
  private kinds: string[] = [];

  constructor(config: BarnRackConfig) {
    this.config = config;

    this.element = document.createElement("div");
    this.element.className = "barn-rack";
    this.element.style.left = `${config.left}px`;
    this.element.style.top = `${config.y - CARD_HEIGHT / 2}px`;
    this.element.style.width = `${config.right - config.left}px`;
    this.element.style.height = `${CARD_HEIGHT}px`;
  }

  update(state: GameState, rules: Rules, now: number): void {
    this.sync(rules);

    const views = stallViews(state, rules, now);
    for (const stall of this.stalls) {
      const view = views.find((entry) => entry.kind === stall.kind);
      if (!view) continue;

      if (view.tone !== stall.tone) {
        stall.tone = view.tone;
        stall.element.dataset.tone = view.tone;
      }

      const name = `${view.name}舍`;
      if (name !== stall.lastName) {
        stall.lastName = name;
        stall.name.textContent = name;
      }

      if (view.productName !== stall.lastProduct) {
        stall.lastProduct = view.productName;
        stall.product.textContent = view.productName;
      }

      if (view.status !== stall.lastStatus) {
        stall.lastStatus = view.status;
        stall.status.textContent = view.status;
      }

      if (Math.abs(view.progress - stall.lastProgress) > 0.001) {
        stall.lastProgress = view.progress;
        stall.barFill.style.transform = `scaleX(${view.progress.toFixed(3)})`;
      }
    }
  }

  destroy(): void {
    this.destroyStalls();
    this.kinds = [];
    this.element.remove();
  }

  // 规则表晚到时按新的畜舍种类重建；种类与顺序不变则完全不重建。
  private sync(rules: Rules): void {
    const kinds = Object.keys(rules.ANIMALS ?? {});
    if (
      kinds.length === this.kinds.length
      && kinds.every((kind, index) => kind === this.kinds[index])
    ) {
      return;
    }

    this.destroyStalls();
    this.kinds = kinds;
    if (kinds.length === 0) return;

    const width = (this.config.right - this.config.left - CARD_GAP * (kinds.length - 1)) / kinds.length;
    kinds.forEach((kind, index) => {
      const stall = this.buildStall(kind, index * (width + CARD_GAP), width);
      this.stalls.push(stall);
      this.element.append(stall.element);
    });
  }

  private buildStall(kind: string, left: number, width: number): Stall {
    const element = document.createElement("div");
    element.className = "stall";
    element.dataset.kind = kind;
    element.dataset.tone = "idle";
    element.style.left = `${left}px`;
    element.style.width = `${width}px`;
    element.addEventListener("click", this.handleClick);

    const pen = document.createElement("div");
    pen.className = "stall-pen";
    if (this.config.hasTexture(kind)) {
      const image = document.createElement("img");
      image.className = "stall-animal";
      image.src = `/animals/${kind}.png`;
      image.alt = "";
      image.draggable = false;
      // 贴图 404 时回退 emoji，与旧画布 preload 失败回退的行为等价。
      image.addEventListener("error", () => {
        const icon = document.createElement("span");
        icon.className = "stall-animal";
        icon.setAttribute("aria-hidden", "true");
        icon.textContent = animalIcon(kind);
        image.replaceWith(icon);
      }, { once: true });
      pen.append(image);
    } else {
      const icon = document.createElement("span");
      icon.className = "stall-animal";
      icon.setAttribute("aria-hidden", "true");
      icon.textContent = animalIcon(kind);
      pen.append(icon);
    }

    const name = document.createElement("div");
    name.className = "stall-name";
    const product = document.createElement("div");
    product.className = "stall-product";
    const status = document.createElement("div");
    status.className = "stall-status";

    const barTrack = document.createElement("div");
    barTrack.className = "stall-bar-track";
    const barFill = document.createElement("div");
    barFill.className = "stall-bar";
    barTrack.append(barFill);

    // 整张卡片可点击：根节点保持矩形，点击直接命中根节点。
    element.append(pen, name, product, status, barTrack);

    return {
      kind,
      element,
      name,
      product,
      status,
      barFill,
      tone: "idle",
      lastName: "",
      lastProduct: "",
      lastStatus: "",
      lastProgress: -1,
    };
  }

  private readonly handleClick = (): void => {
    this.config.onSelect();
  };

  private destroyStalls(): void {
    for (const stall of this.stalls) {
      stall.element.removeEventListener("click", this.handleClick);
      stall.element.remove();
    }
    this.stalls = [];
  }
}
