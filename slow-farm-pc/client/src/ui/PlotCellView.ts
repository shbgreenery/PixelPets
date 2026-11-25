import type { GameState, Plot } from "../api/client";
import { formatCountdown, remainingMs } from "../display/format";
import { cropIcon } from "../display/icons";
import { prefersReducedMotion } from "../display/motion";
import { plotProgress, plotStage, type PlotStage } from "../display/plotView";
import { COLORS, FONT_FAMILY } from "../display/theme";

export interface PlotCellConfig {
  index: number;
  width: number;
  height: number;
  onSelect: (index: number) => void;
}

// 收获反馈与旧版一致：10 颗碎屑 500ms，飘字 900ms；减少动效时只留 700ms 飘字。
const PARTICLE_COUNT = 10;
const PARTICLE_DURATION_MS = 500;
const FLOAT_DURATION_MS = 900;
const FLOAT_LIFETIME_MS = 700;

const STYLE_ID = "sf-plot-styles";
// 几何照旧画布：半径 14、图标 31px、文案 14px、进度条左右内缩 14、角标 55×19。
const PLOT_STYLE = `
.plot {
  position: relative;
  box-sizing: border-box;
  display: block;
  color: ${COLORS.text};
  font-family: ${FONT_FAMILY.sans};
  cursor: pointer;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
}
/* 根节点保持矩形：整块 179×110 都是命中区；半径 14 的外观由 ::before 绘制，
   避免浏览器按圆角裁剪命中区，导致圆角外约 1% 面积点不到（旧画布 hit 是整矩形）。 */
.plot::before {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: 14px;
  border: 1px solid rgba(122, 102, 72, 0.13);
  background-color: #2f2619;
  background-image: repeating-linear-gradient(180deg, transparent 0 9px, rgba(0, 0, 0, 0.16) 9px 11px);
  box-shadow: inset 0 0 0 2px rgba(0, 0, 0, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.045);
  pointer-events: none;
}
.plot[data-stage="empty"]::before {
  background-color: #271f16;
  background-image: repeating-linear-gradient(180deg, transparent 0 9px, rgba(0, 0, 0, 0.2) 9px 11px);
}
.plot[data-stage="ready"]::before {
  background-color: #3b2c1b;
  border-color: rgba(232, 163, 61, 0.62);
}
.plot[data-stage="ready"]::after {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: 14px;
  box-shadow: 0 0 0 2px rgba(232, 163, 61, 0.6), 0 0 0 6px rgba(232, 163, 61, 0.12);
  opacity: 0.7;
  pointer-events: none;
  animation: breathe 1.3s ease-in-out infinite alternate;
}
@keyframes breathe {
  from { opacity: 0.35; }
  to { opacity: 0.95; }
}
.plot-icon {
  position: absolute;
  left: 50%;
  top: 50%;
  margin-top: -16px;
  transform: translate(-50%, -50%);
  font-size: 31px;
  line-height: 1;
  filter: drop-shadow(0 4px 6px rgba(0, 0, 0, 0.8));
  pointer-events: none;
}
.plot[data-stage="empty"] .plot-icon {
  opacity: 0.5;
  color: ${COLORS.muted};
}
.plot[data-stage="growing"] .plot-icon {
  opacity: 0.88;
}
.plot-label {
  position: absolute;
  left: 50%;
  top: 50%;
  margin-top: 18px;
  transform: translate(-50%, -50%);
  font-family: ${FONT_FAMILY.num};
  font-size: 14px;
  line-height: 1.2;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  color: ${COLORS.subtle};
  pointer-events: none;
}
.plot[data-stage="empty"] .plot-label {
  font-family: ${FONT_FAMILY.sans};
  color: ${COLORS.muted};
}
.plot[data-stage="ready"] .plot-label {
  font-family: ${FONT_FAMILY.sans};
  font-weight: 700;
  color: ${COLORS.amberSoft};
}
.plot-bar-track {
  position: absolute;
  left: 14px;
  right: 14px;
  top: 50%;
  margin-top: 36px;
  display: none;
  height: 4px;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.42);
  pointer-events: none;
}
.plot[data-stage="growing"] .plot-bar-track {
  display: block;
}
.plot-bar {
  display: block;
  height: 100%;
  border-radius: 999px;
  transform: scaleX(0);
  transform-origin: left center;
  transition: transform 0.25s linear;
  background: ${COLORS.grass};
}
.plot-badge {
  position: absolute;
  top: 4px;
  right: 8px;
  display: none;
  align-items: center;
  justify-content: center;
  width: 55px;
  height: 19px;
  border-radius: 9px;
  background: ${COLORS.amber};
  color: ${COLORS.amberInk};
  font-family: ${FONT_FAMILY.sans};
  font-size: 12px;
  font-weight: 700;
  line-height: 1;
  pointer-events: none;
}
.plot[data-stage="ready"] .plot-badge {
  display: flex;
}
.plot-particle {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 8px;
  height: 8px;
  margin: -4px 0 0 -4px;
  border-radius: 50%;
  background: ${COLORS.amberSoft};
  pointer-events: none;
}
.plot-float {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%) translateY(-8px);
  font-family: ${FONT_FAMILY.num};
  font-size: 19px;
  font-weight: 700;
  color: ${COLORS.amberSoft};
  white-space: nowrap;
  pointer-events: none;
  text-shadow: 1px 0 0 ${COLORS.amberInk}, -1px 0 0 ${COLORS.amberInk}, 0 1px 0 ${COLORS.amberInk}, 0 -1px 0 ${COLORS.amberInk}, 0 4px 8px rgba(0, 0, 0, 0.85);
}
`;

function ensurePlotStyle(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = PLOT_STYLE;
  document.head.append(style);
}

ensurePlotStyle();

// 单块地的 DOM 版本：土壤底、作物图标、倒计时、进度条与可收获角标。
// 阶段只改 data-stage，由 CSS 选择器驱动配色与显隐；文本与进度做差分，值未变不写 DOM。
export class PlotCellView {
  readonly element: HTMLDivElement;
  private readonly icon: HTMLSpanElement;
  private readonly label: HTMLSpanElement;
  private readonly barFill: HTMLSpanElement;
  private readonly badge: HTMLSpanElement;
  private readonly index: number;
  private readonly onSelect: (index: number) => void;
  private stage: PlotStage = "empty";
  private lastIcon = "";
  private lastLabel = "";
  private lastProgress = -1;
  private readonly animations = new Set<Animation>();
  private readonly timers = new Set<number>();

  constructor(config: PlotCellConfig) {
    this.index = config.index;
    this.onSelect = config.onSelect;

    this.element = document.createElement("div");
    this.element.className = "plot";
    this.element.dataset.index = String(config.index);
    this.element.dataset.stage = "empty";
    this.element.style.width = `${config.width}px`;
    this.element.style.height = `${config.height}px`;
    this.element.addEventListener("click", this.handleClick);

    this.icon = document.createElement("span");
    this.icon.className = "plot-icon";
    this.icon.setAttribute("aria-hidden", "true");

    this.label = document.createElement("span");
    this.label.className = "plot-label";

    const barTrack = document.createElement("span");
    barTrack.className = "plot-bar-track";
    this.barFill = document.createElement("span");
    this.barFill.className = "plot-bar";
    barTrack.append(this.barFill);

    this.badge = document.createElement("span");
    this.badge.className = "plot-badge";
    this.badge.textContent = "可收获";

    this.element.append(this.icon, this.label, barTrack, this.badge);
  }

  private readonly handleClick = (): void => {
    this.onSelect(this.index);
  };

  update(plot: Plot, now: number): PlotStage {
    const stage = plotStage({} as GameState, plot, now);
    if (stage !== this.stage) {
      this.stage = stage;
      this.element.dataset.stage = stage;
    }

    const label = stage === "empty"
      ? "点击播种"
      : stage === "growing"
        ? formatCountdown(remainingMs(plot.readyAt, now))
        : "可收获";
    if (label !== this.lastLabel) {
      this.lastLabel = label;
      this.label.textContent = label;
    }

    const icon = stage === "empty" ? "+" : plot.cropId ? cropIcon(plot.cropId) : "";
    if (icon !== this.lastIcon) {
      this.lastIcon = icon;
      this.icon.textContent = icon;
    }

    const progress = stage === "growing" ? plotProgress(plot, now) : 0;
    if (Math.abs(progress - this.lastProgress) > 0.001) {
      this.lastProgress = progress;
      this.barFill.style.transform = `scaleX(${progress.toFixed(3)})`;
    }

    return stage;
  }

  // 收获反馈：琥珀碎屑 + 上浮结果；减少动效时只保留结果文字。
  playHarvest(text: string): void {
    const reduced = prefersReducedMotion();
    if (!reduced) this.spawnParticles();

    const floating = document.createElement("span");
    floating.className = "plot-float";
    floating.textContent = text;
    this.element.append(floating);

    if (reduced) {
      this.schedule(() => floating.remove(), FLOAT_LIFETIME_MS);
      return;
    }

    this.track(
      floating.animate(
        [
          { transform: "translate(-50%, -50%) translateY(-8px)", opacity: 1 },
          { transform: "translate(-50%, -50%) translateY(-77px)", opacity: 0 },
        ],
        { duration: FLOAT_DURATION_MS, easing: "cubic-bezier(0.215, 0.61, 0.355, 1)", fill: "forwards" },
      ),
      floating,
    );
  }

  destroy(): void {
    this.element.removeEventListener("click", this.handleClick);
    for (const animation of this.animations) animation.cancel();
    this.animations.clear();
    for (const id of this.timers) window.clearTimeout(id);
    this.timers.clear();
    this.element.remove();
  }

  private spawnParticles(): void {
    for (let index = 0; index < PARTICLE_COUNT; index += 1) {
      const angle = (Math.PI * 2 * index) / PARTICLE_COUNT;
      const distance = 28 + Math.random() * 22;
      const particle = document.createElement("span");
      particle.className = "plot-particle";
      this.element.append(particle);
      this.track(
        particle.animate(
          [
            { transform: "translate(0, 0)", opacity: 1 },
            {
              transform: `translate(${(Math.cos(angle) * distance).toFixed(1)}px, ${(Math.sin(angle) * distance).toFixed(1)}px)`,
              opacity: 0,
            },
          ],
          { duration: PARTICLE_DURATION_MS, easing: "cubic-bezier(0.215, 0.61, 0.355, 1)" },
        ),
        particle,
      );
    }
  }

  private track(animation: Animation, element: HTMLElement): void {
    this.animations.add(animation);
    animation.onfinish = () => {
      this.animations.delete(animation);
      element.remove();
    };
  }

  private schedule(callback: () => void, delay: number): void {
    const id = window.setTimeout(() => {
      this.timers.delete(id);
      callback();
    }, delay);
    this.timers.add(id);
  }
}
