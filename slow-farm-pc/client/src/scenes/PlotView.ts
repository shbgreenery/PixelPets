import type Phaser from "phaser";
import type { GameState, Plot } from "../api/client";
import { formatCountdown, remainingMs } from "../display/format";
import { cropIcon } from "../display/icons";
import { prefersReducedMotion } from "../display/motion";
import { renderScale } from "../display/stage";
import { FONT_FAMILY, PALETTE, STAGE_COLOR } from "../display/theme";

export type PlotStage = "empty" | "growing" | "ready";

// state 目前只用于保持调用签名稳定；生长阶段只看地块自身的时间字段。
export function plotStage(_state: GameState, plot: Plot, now: number): PlotStage {
  if (!plot.cropId) return "empty";
  return now < plot.readyAt ? "growing" : "ready";
}

// 生长进度 0..1：时间跨度无效时按已完成处理，避免除以零。
export function plotProgress(plot: Plot, now: number): number {
  if (!plot.cropId) return 0;
  if (now >= plot.readyAt) return 1;
  const span = plot.readyAt - plot.plantedAt;
  if (span <= 0) return 1;
  return Math.min(1, Math.max(0, (now - plot.plantedAt) / span));
}

// 阶段取色：空地不画进度，生长用草绿，成熟用琥珀。
export function stageBarColor(stage: PlotStage): number | null {
  if (stage === "growing") return STAGE_COLOR.grassSoft;
  if (stage === "ready") return STAGE_COLOR.amber;
  return null;
}

const RADIUS = 14;
const ICON_SIZE = 31;
const LABEL_SIZE = "14px";
const BAR_INSET = 14;
const BADGE_WIDTH = 55;
const BADGE_HEIGHT = 19;

// 地块底：圆角土壤块 + 犁沟纹理 + 内阴影，模拟受光的实体。
function paintCard(
  g: Phaser.GameObjects.Graphics,
  left: number,
  top: number,
  width: number,
  height: number,
  stage: PlotStage,
): void {
  g.clear();

  const fill = stage === "empty"
    ? STAGE_COLOR.soilEmpty
    : stage === "ready"
      ? STAGE_COLOR.soilRipe
      : STAGE_COLOR.soil;
  g.fillStyle(fill, 1);
  g.fillRoundedRect(left, top, width, height, RADIUS);

  // 犁沟：在圆角安全区内画横向浅沟，避免线条越过圆角。
  g.lineStyle(2, STAGE_COLOR.black, stage === "empty" ? 0.2 : 0.16);
  for (let row = top + 8; row < top + height - 6; row += 11) {
    g.lineBetween(left + 14, row, left + width - 14, row);
  }

  // 内阴影与顶部受光边。
  g.lineStyle(2, STAGE_COLOR.black, 0.35);
  g.strokeRoundedRect(left + 1, top + 1, width - 2, height - 2, RADIUS - 1);
  g.lineStyle(1, STAGE_COLOR.white, 0.045);
  g.lineBetween(left + RADIUS, top + 1.5, left + width - RADIUS, top + 1.5);

  g.lineStyle(1, stage === "ready" ? STAGE_COLOR.amber : STAGE_COLOR.line, stage === "ready" ? 0.62 : 0.13);
  g.strokeRoundedRect(left, top, width, height, RADIUS);
}

export interface PlotViewConfig {
  scene: Phaser.Scene;
  index: number;
  x: number;
  y: number;
  width: number;
  height: number;
  onSelect: (index: number) => void;
}

// 单块地的表现：土壤底色、作物图标、倒计时、进度条、可收获角标与光晕。
export class PlotView {
  private readonly scene: Phaser.Scene;
  private readonly width: number;
  private readonly height: number;
  private readonly card: Phaser.GameObjects.Graphics;
  private readonly glow: Phaser.GameObjects.Graphics;
  private readonly hit: Phaser.GameObjects.Rectangle;
  private readonly icon: Phaser.GameObjects.Text;
  private readonly label: Phaser.GameObjects.Text;
  private readonly barTrack: Phaser.GameObjects.Rectangle;
  private readonly barFill: Phaser.GameObjects.Rectangle;
  private readonly badgeBg: Phaser.GameObjects.Graphics;
  private readonly badgeText: Phaser.GameObjects.Text;
  private readyTween?: Phaser.Tweens.Tween;
  private stage: PlotStage = "empty";
  private readonly motion: boolean;
  readonly x: number;
  readonly y: number;

  constructor(config: PlotViewConfig) {
    this.scene = config.scene;
    this.x = config.x;
    this.y = config.y;
    this.width = config.width;
    this.height = config.height;
    this.motion = !prefersReducedMotion();

    const left = this.x - this.width / 2;
    const top = this.y - this.height / 2;

    this.card = this.scene.add.graphics();
    paintCard(this.card, left, top, this.width, this.height, "empty");

    this.glow = this.scene.add
      .graphics()
      .setVisible(false)
      .setAlpha(0.6);
    this.glow.lineStyle(2, STAGE_COLOR.amber, 0.6);
    this.glow.strokeRoundedRect(left, top, this.width, this.height, RADIUS);
    this.glow.lineStyle(6, STAGE_COLOR.amber, 0.12);
    this.glow.strokeRoundedRect(left, top, this.width, this.height, RADIUS);

    this.icon = this.scene.add
      .text(this.x, this.y - 16, "", {
        fontFamily: FONT_FAMILY.sans,
        fontSize: `${ICON_SIZE}px`,
        color: PALETTE.ink,
      })
      .setResolution(renderScale())
      .setOrigin(0.5)
      .setShadow(0, 4, "#000000", 6);

    this.label = this.scene.add
      .text(this.x, this.y + 18, "", {
        fontFamily: FONT_FAMILY.num,
        fontSize: LABEL_SIZE,
        color: PALETTE.ink2,
      })
      .setResolution(renderScale())
      .setOrigin(0.5);

    const barWidth = this.width - BAR_INSET * 2;
    this.barTrack = this.scene.add
      .rectangle(this.x, this.y + 38, barWidth, 4, STAGE_COLOR.black, 0.42)
      .setOrigin(0.5)
      .setVisible(false);
    this.barFill = this.scene.add
      .rectangle(this.x - barWidth / 2, this.y + 38, barWidth, 4, STAGE_COLOR.grassSoft)
      .setOrigin(0, 0.5)
      .setVisible(false);

    const badgeLeft = this.x + this.width / 2 - 8 - BADGE_WIDTH;
    const badgeTop = this.y - this.height / 2 + 4;
    this.badgeBg = this.scene.add.graphics().setVisible(false);
    this.badgeBg.fillStyle(STAGE_COLOR.amber, 1);
    this.badgeBg.fillRoundedRect(badgeLeft, badgeTop, BADGE_WIDTH, BADGE_HEIGHT, 9);
    this.badgeText = this.scene.add
      .text(badgeLeft + BADGE_WIDTH / 2, badgeTop + BADGE_HEIGHT / 2, "可收获", {
        fontFamily: FONT_FAMILY.sans,
        fontSize: "12px",
        fontStyle: "bold",
        color: PALETTE.amberInk,
      })
      .setResolution(renderScale())
      .setOrigin(0.5)
      .setVisible(false);

    // 透明命中区覆盖整块地，方便触控与鼠标。
    this.hit = this.scene.add
      .rectangle(this.x, this.y, this.width, this.height, STAGE_COLOR.black, 0)
      .setInteractive({ useHandCursor: true })
      .on("pointerdown", () => config.onSelect(config.index));
  }

  update(state: GameState, plot: Plot, now: number, _cropName: string): PlotStage {
    const stage = plotStage(state, plot, now);
    if (stage !== this.stage) {
      this.stage = stage;
      this.applyStage(stage);
    }

    if (stage === "empty") {
      this.icon.setText("+").setAlpha(0.5).setColor(PALETTE.ink3);
      this.label
        .setText("点击播种")
        .setColor(PALETTE.ink3)
        .setFontFamily(FONT_FAMILY.sans)
        .setFontStyle("normal");
    } else {
      this.icon
        .setText(plot.cropId ? cropIcon(plot.cropId) : "")
        .setAlpha(stage === "growing" ? 0.88 : 1)
        .setColor(PALETTE.ink);
      if (stage === "growing") {
        this.label
          .setText(formatCountdown(remainingMs(plot.readyAt, now)))
          .setColor(PALETTE.ink2)
          .setFontFamily(FONT_FAMILY.num)
          .setFontStyle("normal");
      } else {
        this.label
          .setText("可收获")
          .setColor(PALETTE.amberSoft)
          .setFontFamily(FONT_FAMILY.sans)
          .setFontStyle("bold");
      }
    }

    const progress = plotProgress(plot, now);
    this.barFill.setScale(progress, 1);

    return stage;
  }

  // 阶段切换才重绘底卡：成熟换成琥珀描边，并开启呼吸光晕。
  private applyStage(stage: PlotStage): void {
    paintCard(
      this.card,
      this.x - this.width / 2,
      this.y - this.height / 2,
      this.width,
      this.height,
      stage,
    );

    const ready = stage === "ready";
    const growing = stage === "growing";
    this.glow.setVisible(ready);
    this.badgeBg.setVisible(ready);
    this.badgeText.setVisible(ready);
    this.barTrack.setVisible(growing);
    this.barFill.setVisible(growing);

    const barColor = stageBarColor(stage);
    if (barColor !== null) this.barFill.setFillStyle(barColor);

    this.readyTween?.remove();
    this.readyTween = undefined;
    this.glow.setAlpha(0.6);

    if (ready && this.motion) {
      this.readyTween = this.scene.tweens.add({
        targets: this.glow,
        alpha: { from: 0.35, to: 0.95 },
        duration: 1300,
        yoyo: true,
        repeat: -1,
        ease: "Sine.easeInOut",
      });
    } else if (ready) {
      this.glow.setAlpha(0.7);
    }
  }

  // 收获反馈：琥珀碎屑与上浮结果；减少动效时只保留结果文字。
  playHarvest(text: string): void {
    if (this.motion) {
      for (let index = 0; index < 10; index += 1) {
        const angle = (Math.PI * 2 * index) / 10;
        const distance = 28 + Math.random() * 22;
        const particle = this.scene.add
          .circle(this.x, this.y, 4, STAGE_COLOR.amberSoft)
          .setDepth(5);
        this.scene.tweens.add({
          targets: particle,
          x: this.x + Math.cos(angle) * distance,
          y: this.y + Math.sin(angle) * distance,
          alpha: 0,
          duration: 500,
          ease: "Cubic.easeOut",
          onComplete: () => particle.destroy(),
        });
      }
    }

    const floating = this.scene.add
      .text(this.x, this.y - 8, text, {
        fontFamily: FONT_FAMILY.num,
        fontSize: "19px",
        fontStyle: "bold",
        color: PALETTE.amberSoft,
        stroke: "#120f09",
        strokeThickness: 4,
      })
      .setResolution(renderScale())
      .setOrigin(0.5)
      .setDepth(6);

    if (!this.motion) {
      this.scene.time.delayedCall(700, () => floating.destroy());
      return;
    }

    this.scene.tweens.add({
      targets: floating,
      y: this.y - 77,
      alpha: 0,
      duration: 900,
      ease: "Cubic.easeOut",
      onComplete: () => floating.destroy(),
    });
  }

  destroy(): void {
    this.readyTween?.remove();
    this.readyTween = undefined;
    this.card.destroy();
    this.glow.destroy();
    this.hit.destroy();
    this.icon.destroy();
    this.label.destroy();
    this.barTrack.destroy();
    this.barFill.destroy();
    this.badgeBg.destroy();
    this.badgeText.destroy();
  }
}
