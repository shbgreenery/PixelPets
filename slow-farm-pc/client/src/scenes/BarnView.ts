import type Phaser from "phaser";
import type { GameState, Rules } from "../api/client";
import { stallViews, type StallTone } from "../display/barnView";
import { animalIcon } from "../display/icons";
import { renderScale } from "../display/stage";
import { FONT_FAMILY, PALETTE, STAGE_COLOR } from "../display/theme";

const CARD_RADIUS = 14;
const PEN_SIZE = 53;
const CARD_HEIGHT = 79;
const CARD_GAP = 13;
const TITLE_ROW = 26;

const TONE_STYLE: Record<StallTone, { status: string; bar: number; card: number; border: number }> = {
  ready: { status: PALETTE.amberSoft, bar: STAGE_COLOR.amber, card: STAGE_COLOR.night4, border: 0.45 },
  growing: { status: PALETTE.ink3, bar: STAGE_COLOR.grassSoft, card: STAGE_COLOR.night3, border: 0.1 },
  idle: { status: PALETTE.ink3, bar: STAGE_COLOR.ink3, card: STAGE_COLOR.night3, border: 0.1 },
  locked: { status: PALETTE.ink3, bar: STAGE_COLOR.ink3, card: STAGE_COLOR.night2, border: 0.08 },
};

export interface BarnBounds {
  left: number;
  right: number;
  y: number;
}

interface Stall {
  kind: string;
  left: number;
  width: number;
  tone: StallTone | null;
  card: Phaser.GameObjects.Graphics;
  pen: Phaser.GameObjects.Graphics;
  image?: Phaser.GameObjects.Image;
  emoji?: Phaser.GameObjects.Text;
  name: Phaser.GameObjects.Text;
  product: Phaser.GameObjects.Text;
  status: Phaser.GameObjects.Text;
  barTrack: Phaser.GameObjects.Rectangle;
  barFill: Phaser.GameObjects.Rectangle;
  hit: Phaser.GameObjects.Rectangle;
}

// 畜舍：三个栏位只构建一次，刷新时只改文本、进度与描边。
export class BarnView {
  private readonly scene: Phaser.Scene;
  private readonly bounds: BarnBounds;
  private readonly hasTexture: (kind: string) => boolean;
  private readonly onSelect: () => void;
  private stalls: Stall[] = [];
  private kinds: string[] = [];

  constructor(
    scene: Phaser.Scene,
    bounds: BarnBounds,
    hasTexture: (kind: string) => boolean,
    onSelect: () => void,
  ) {
    this.scene = scene;
    this.bounds = bounds;
    this.hasTexture = hasTexture;
    this.onSelect = onSelect;
  }

  // 规则表晚到时按新的畜舍种类重建；种类不变则完全不重建。
  sync(rules: Rules): void {
    const kinds = Object.keys(rules.ANIMALS ?? {});
    if (kinds.length === this.kinds.length && kinds.every((kind, index) => kind === this.kinds[index])) {
      return;
    }
    this.destroyStalls();
    this.kinds = kinds;
    if (kinds.length === 0) return;

    const width = (this.bounds.right - this.bounds.left - CARD_GAP * (kinds.length - 1)) / kinds.length;
    kinds.forEach((kind, index) => {
      this.stalls.push(this.buildStall(kind, this.bounds.left + index * (width + CARD_GAP), width));
    });
  }

  update(state: GameState, rules: Rules, now: number): void {
    this.sync(rules);

    const views = stallViews(state, rules, now);
    for (const stall of this.stalls) {
      const view = views.find((entry) => entry.kind === stall.kind);
      if (!view) continue;

      const tone = TONE_STYLE[view.tone];
      stall.name.setText(`${view.name}舍`);
      stall.product.setText(view.productName);
      stall.status.setText(view.status).setColor(tone.status);
      stall.barFill.setScale(view.progress, 1);
      stall.barFill.setFillStyle(tone.bar);
      stall.image?.setAlpha(view.unlocked ? 1 : 0.45);
      stall.emoji?.setAlpha(view.unlocked ? 0.95 : 0.45);

      if (stall.tone !== view.tone) {
        stall.tone = view.tone;
        this.paintCard(stall, tone.card, tone.border);
      }
    }
  }

  private buildStall(kind: string, left: number, width: number): Stall {
    const { y } = this.bounds;
    const resolution = renderScale();
    const card = this.scene.add.graphics();
    const penLeft = left + 14;
    const penTop = y - PEN_SIZE / 2;
    const pen = this.scene.add.graphics();
    pen.fillStyle(STAGE_COLOR.tray, 1);
    pen.fillRoundedRect(penLeft, penTop, PEN_SIZE, PEN_SIZE, 14);
    pen.lineStyle(1, STAGE_COLOR.line, 0.12);
    pen.strokeRoundedRect(penLeft, penTop, PEN_SIZE, PEN_SIZE, 14);
    pen.lineStyle(2, STAGE_COLOR.black, 0.35);
    pen.strokeRoundedRect(penLeft + 1, penTop + 1, PEN_SIZE - 2, PEN_SIZE - 2, 13);

    let image: Phaser.GameObjects.Image | undefined;
    let emoji: Phaser.GameObjects.Text | undefined;
    if (this.hasTexture(kind)) {
      image = this.scene.add
        .image(penLeft + PEN_SIZE / 2, y, `animal-${kind}`)
        .setDisplaySize(36, 36);
    } else {
      emoji = this.scene.add
        .text(penLeft + PEN_SIZE / 2, y, animalIcon(kind), {
          fontFamily: FONT_FAMILY.sans,
          fontSize: "24px",
        })
        .setResolution(resolution)
        .setOrigin(0.5);
    }

    const textLeft = penLeft + PEN_SIZE + 12;
    const textRight = left + width - 14;
    const name = this.scene.add
      .text(textLeft, y - TITLE_ROW, "", {
        fontFamily: FONT_FAMILY.sans,
        fontSize: "16px",
        fontStyle: "bold",
        color: PALETTE.ink,
      })
      .setResolution(resolution)
      .setOrigin(0, 0.5);
    const product = this.scene.add
      .text(textRight, y - TITLE_ROW, "", {
        fontFamily: FONT_FAMILY.num,
        fontSize: "13px",
        color: PALETTE.ink3,
      })
      .setResolution(resolution)
      .setOrigin(1, 0.5);
    const status = this.scene.add
      .text(textLeft, y + 1, "", {
        fontFamily: FONT_FAMILY.sans,
        fontSize: "14px",
        color: PALETTE.ink3,
      })
      .setResolution(resolution)
      .setOrigin(0, 0.5);

    const barWidth = textRight - textLeft;
    const barTrack = this.scene.add
      .rectangle(textLeft, y + 26, barWidth, 5, STAGE_COLOR.black, 0.42)
      .setOrigin(0, 0.5);
    const barFill = this.scene.add
      .rectangle(textLeft, y + 26, barWidth, 5, STAGE_COLOR.grassSoft)
      .setOrigin(0, 0.5)
      .setScale(0, 1);

    const hit = this.scene.add
      .rectangle(left + width / 2, y, width, CARD_HEIGHT, STAGE_COLOR.black, 0)
      .setInteractive({ useHandCursor: true })
      .on("pointerdown", () => this.onSelect());

    const stall: Stall = {
      kind,
      left,
      width,
      tone: null,
      card,
      pen,
      image,
      emoji,
      name,
      product,
      status,
      barTrack,
      barFill,
      hit,
    };
    this.paintCard(stall, STAGE_COLOR.night3, 0.1);
    return stall;
  }

  private paintCard(stall: Stall, fill: number, border: number): void {
    const { y } = this.bounds;
    const top = y - CARD_HEIGHT / 2;
    const g = stall.card;
    g.clear();
    g.fillStyle(fill, 1);
    g.fillRoundedRect(stall.left, top, stall.width, CARD_HEIGHT, CARD_RADIUS);
    g.lineStyle(1, border > 0.2 ? STAGE_COLOR.amber : STAGE_COLOR.line, border);
    g.strokeRoundedRect(stall.left, top, stall.width, CARD_HEIGHT, CARD_RADIUS);
    g.lineStyle(1, STAGE_COLOR.white, 0.04);
    g.lineBetween(stall.left + CARD_RADIUS, top + 1.5, stall.left + stall.width - CARD_RADIUS, top + 1.5);
  }

  private destroyStalls(): void {
    for (const stall of this.stalls) {
      stall.card.destroy();
      stall.pen.destroy();
      stall.image?.destroy();
      stall.emoji?.destroy();
      stall.name.destroy();
      stall.product.destroy();
      stall.status.destroy();
      stall.barTrack.destroy();
      stall.barFill.destroy();
      stall.hit.destroy();
    }
    this.stalls = [];
  }

  destroy(): void {
    this.destroyStalls();
    this.kinds = [];
  }
}
