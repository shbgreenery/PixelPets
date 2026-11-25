import { FONT_FAMILY, PALETTE, SURFACE } from "../display/theme";

// 几何照旧画布版：入口 125×74、间隙 7、圆角 14。
const ITEM_WIDTH = 125;
const ITEM_HEIGHT = 74;
const ITEM_GAP = 7;
const ITEM_RADIUS = 14;
// 入口整体相对栏中线下移 2px，与旧画布一致。
const ITEM_OFFSET_Y = 2;

const STYLE_ID = "sf-dock-styles";
// 入口根节点保持矩形（无圆角），圆角外观与高亮都由伪元素绘制，
// 这样 125×74 整个矩形（含圆角外）都在命中区内。
const DOCK_STYLE = `
.dock-bar {
  position: absolute;
  box-sizing: border-box;
  background: ${SURFACE.dock};
  border-top: 1px solid rgba(232, 163, 61, 0.16);
  box-shadow: inset 0 3px 6px rgba(0, 0, 0, 0.12);
  font-family: ${FONT_FAMILY.sans};
  color: ${PALETTE.ink2};
}
.dock-item {
  position: absolute;
  cursor: pointer;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
}
.dock-item::after {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: ${ITEM_RADIUS}px;
  pointer-events: none;
}
.dock-item[data-active="true"]::after {
  background: rgba(232, 163, 61, 0.1);
  box-shadow: inset 0 0 0 1px rgba(232, 163, 61, 0.32);
}
.dock-item::before {
  content: "";
  position: absolute;
  left: 50%;
  top: -1px;
  display: none;
  width: 32px;
  height: 3px;
  margin-left: -16px;
  border-radius: 1px;
  background: ${PALETTE.amber};
  pointer-events: none;
}
.dock-item[data-active="true"]::before {
  display: block;
}
.dock-icon {
  position: absolute;
  left: 50%;
  top: calc(50% - 12px);
  transform: translate(-50%, -50%);
  font-family: ${FONT_FAMILY.sans};
  font-size: 23px;
  line-height: 1;
  opacity: 0.82;
  pointer-events: none;
}
.dock-item[data-active="true"] .dock-icon {
  opacity: 1;
}
.dock-label {
  position: absolute;
  left: 50%;
  top: calc(50% + 20px);
  transform: translate(-50%, -50%);
  font-family: ${FONT_FAMILY.sans};
  font-size: 14px;
  line-height: 1.2;
  white-space: nowrap;
  color: ${PALETTE.ink2};
  pointer-events: none;
}
.dock-item[data-active="true"] .dock-label {
  color: ${PALETTE.amberSoft};
}
.dock-badge {
  position: absolute;
  left: calc(50% + 29px);
  top: calc(50% - 35px);
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 19px;
  border-radius: 9px;
  background: ${PALETTE.claySoft};
  color: ${PALETTE.clayInk};
  font-family: ${FONT_FAMILY.num};
  font-size: 12px;
  font-weight: 700;
  line-height: 1;
  pointer-events: none;
}
.dock-badge[hidden] {
  display: none;
}
`;

function ensureDockStyle(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = DOCK_STYLE;
  document.head.append(style);
}

ensureDockStyle();

export interface DockEntry {
  key: string;
  label: string;
  icon: string;
  onSelect: () => void;
}

interface DockItem {
  key: string;
  element: HTMLDivElement;
  onSelect: () => void;
}

// 底部建筑入口的 DOM 版本：入口整矩形可点击，高亮由 data-active 驱动 CSS，
// 订单角标记住上次 count，相同则完全跳过写入。
export class DockBar {
  readonly element: HTMLDivElement;
  private readonly items: DockItem[] = [];
  private readonly badge: HTMLSpanElement | null;
  private active: string | null = null;
  private orderCount = 0;
  private badgeText = "";

  constructor(width: number, top: number, height: number, entries: DockEntry[]) {
    this.element = document.createElement("div");
    this.element.className = "dock-bar";
    this.element.style.left = "0px";
    this.element.style.top = `${top}px`;
    this.element.style.width = `${width}px`;
    this.element.style.height = `${height}px`;

    const total = entries.length * ITEM_WIDTH + (entries.length - 1) * ITEM_GAP;
    const startLeft = (width - total) / 2;
    const itemTop = height / 2 - ITEM_HEIGHT / 2 + ITEM_OFFSET_Y;

    let badge: HTMLSpanElement | null = null;
    entries.forEach((entry, index) => {
      const element = document.createElement("div");
      element.className = "dock-item";
      element.dataset.key = entry.key;
      element.style.left = `${startLeft + index * (ITEM_WIDTH + ITEM_GAP)}px`;
      element.style.top = `${itemTop}px`;
      element.style.width = `${ITEM_WIDTH}px`;
      element.style.height = `${ITEM_HEIGHT}px`;
      element.addEventListener("click", this.handleClick);

      const icon = document.createElement("span");
      icon.className = "dock-icon";
      icon.setAttribute("aria-hidden", "true");
      icon.textContent = entry.icon;

      const label = document.createElement("span");
      label.className = "dock-label";
      label.textContent = entry.label;

      element.append(icon, label);

      if (entry.key === "orders") {
        badge = document.createElement("span");
        badge.className = "dock-badge";
        badge.hidden = true;
        element.append(badge);
      }

      this.items.push({ key: entry.key, element, onSelect: entry.onSelect });
      this.element.append(element);
    });

    this.badge = badge;
  }

  setActive(key: string | null): void {
    if (this.active === key) return;
    this.active = key;
    for (const item of this.items) {
      if (item.key === key) {
        item.element.dataset.active = "true";
      } else if (item.element.dataset.active !== undefined) {
        delete item.element.dataset.active;
      }
    }
  }

  setOrderBadge(count: number): void {
    if (!this.badge) return;
    if (this.orderCount === count) return;
    this.orderCount = count;

    const hidden = count <= 0;
    if (this.badge.hidden !== hidden) this.badge.hidden = hidden;
    if (hidden) return;

    const text = count > 99 ? "99+" : String(count);
    if (text !== this.badgeText) {
      this.badgeText = text;
      this.badge.textContent = text;
    }
  }

  destroy(): void {
    for (const item of this.items) {
      item.element.removeEventListener("click", this.handleClick);
      item.element.remove();
    }
    this.items.length = 0;
    this.element.remove();
  }

  private readonly handleClick = (event: Event): void => {
    const key = (event.currentTarget as HTMLElement | null)?.dataset.key;
    const item = this.items.find((entry) => entry.key === key);
    item?.onSelect();
  };
}
