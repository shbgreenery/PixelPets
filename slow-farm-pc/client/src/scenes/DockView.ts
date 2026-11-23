import type Phaser from "phaser";
import { stageDpr } from "../display/stage";
import { FONT_FAMILY, PALETTE, STAGE_COLOR } from "../display/theme";

const ITEM_WIDTH = 125;
const ITEM_HEIGHT = 74;
const ITEM_GAP = 7;
const ITEM_RADIUS = 14;

export interface DockEntry {
  key: string;
  label: string;
  icon: string;
  onSelect: () => void;
}

interface DockItem {
  entry: DockEntry;
  x: number;
  y: number;
  bg: Phaser.GameObjects.Graphics;
  icon: Phaser.GameObjects.Text;
  label: Phaser.GameObjects.Text;
  badgeBg?: Phaser.GameObjects.Graphics;
  badgeText?: Phaser.GameObjects.Text;
  badgeCount: number;
}

// 底部建筑入口：7 个入口，当前面板用琥珀底 + 顶部指示条高亮，订单入口带可交付角标。
export class DockView {
  private readonly items: DockItem[] = [];
  private active: string | null = null;

  constructor(scene: Phaser.Scene, width: number, top: number, height: number, entries: DockEntry[]) {
    scene.add
      .rectangle(width / 2, top + height / 2, width, height, STAGE_COLOR.night1, 0.97)
      .setDepth(1);
    scene.add.rectangle(width / 2, top, width, 1, STAGE_COLOR.amber, 0.16).setDepth(2);
    scene.add.rectangle(width / 2, top + 3, width, 6, STAGE_COLOR.black, 0.12).setDepth(2);

    const total = entries.length * ITEM_WIDTH + (entries.length - 1) * ITEM_GAP;
    const startX = width / 2 - total / 2 + ITEM_WIDTH / 2;
    const y = top + height / 2 + 2;

    entries.forEach((entry, index) => {
      const x = startX + index * (ITEM_WIDTH + ITEM_GAP);
      const resolution = stageDpr();
      const bg = scene.add.graphics().setDepth(2);
      const icon = scene.add
        .text(x, y - 12, entry.icon, {
          fontFamily: FONT_FAMILY.sans,
          fontSize: "23px",
        })
        .setResolution(resolution)
        .setOrigin(0.5)
        .setDepth(3);
      const label = scene.add
        .text(x, y + 20, entry.label, {
          fontFamily: FONT_FAMILY.sans,
          fontSize: "14px",
          color: PALETTE.ink2,
        })
        .setResolution(resolution)
        .setOrigin(0.5)
        .setDepth(3);

      scene.add
        .rectangle(x, y, ITEM_WIDTH, ITEM_HEIGHT, STAGE_COLOR.black, 0)
        .setInteractive({ useHandCursor: true })
        .setDepth(4)
        .on("pointerdown", () => entry.onSelect());

      const item: DockItem = { entry, x, y, bg, icon, label, badgeCount: 0 };
      if (entry.key === "orders") {
        const badgeBg = scene.add.graphics().setDepth(4).setVisible(false);
        const badgeText = scene.add
          .text(x + 41, y - 25, "", {
            fontFamily: FONT_FAMILY.num,
            fontSize: "12px",
            fontStyle: "bold",
            color: PALETTE.clayInk,
          })
          .setResolution(resolution)
          .setOrigin(0.5)
          .setDepth(5)
          .setVisible(false);
        item.badgeBg = badgeBg;
        item.badgeText = badgeText;
      }
      this.items.push(item);
      this.paint(item);
    });
  }

  setActive(key: string | null): void {
    if (this.active === key) return;
    this.active = key;
    for (const item of this.items) this.paint(item);
  }

  setOrderBadge(count: number): void {
    const item = this.items.find((entry) => entry.entry.key === "orders");
    if (!item?.badgeBg || !item.badgeText) return;
    if (item.badgeCount === count) return;
    item.badgeCount = count;

    const visible = count > 0;
    item.badgeBg.setVisible(visible);
    item.badgeText.setVisible(visible);
    if (!visible) return;

    item.badgeText.setText(count > 99 ? "99+" : String(count));
    item.badgeBg.clear();
    item.badgeBg.fillStyle(STAGE_COLOR.claySoft, 1);
    item.badgeBg.fillRoundedRect(item.x + 29, item.y - 35, 24, 19, 9);
  }

  private paint(item: DockItem): void {
    const active = this.active === item.entry.key;
    const left = item.x - ITEM_WIDTH / 2;
    const top = item.y - ITEM_HEIGHT / 2;
    const g = item.bg;
    g.clear();
    if (active) {
      g.fillStyle(STAGE_COLOR.amber, 0.1);
      g.fillRoundedRect(left, top, ITEM_WIDTH, ITEM_HEIGHT, ITEM_RADIUS);
      g.lineStyle(1, STAGE_COLOR.amber, 0.32);
      g.strokeRoundedRect(left, top, ITEM_WIDTH, ITEM_HEIGHT, ITEM_RADIUS);
      g.fillStyle(STAGE_COLOR.amber, 1);
      g.fillRoundedRect(item.x - 16, top - 1, 32, 3, 1);
    }
    item.icon.setAlpha(active ? 1 : 0.82);
    item.label.setColor(active ? PALETTE.amberSoft : PALETTE.ink2);
  }
}
