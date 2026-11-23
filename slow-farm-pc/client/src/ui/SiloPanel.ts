import type { GameState, Rules } from "../api/client";
import { reasonText } from "../display/format";
import { buildingIcon, itemIcon } from "../display/icons";
import { getStage, SIDE_RAIL_MARGIN, SIDE_RAIL_WIDTH } from "../display/stage";
import type { GameStore } from "../state/store";
import {
  CARD_STYLE,
  makeButton,
  MUTED_STYLE,
  NOTE_STYLE,
  ROW_STYLE,
  SCROLL_CLASS,
  TITLE_STYLE,
  VALUE_STYLE,
} from "./panelStyles";

// 与服务端 core.sellItem 一致：先把比例换算成整数百分比。
function sellPercent(rules: Rules): number {
  const ratio = typeof rules.SELL_RATIO === "number" ? rules.SELL_RATIO : 1;
  return Math.round(ratio * 100);
}

// 整批出售的到手金币：floor(单价 × 数量 × 百分比 / 100)，整批只取整一次。
export function totalSellPrice(rules: Rules, itemId: string, quantity: number): number | null {
  const item = rules.ITEMS[itemId];
  if (!item) return null;
  return Math.floor((item.sellPrice * quantity * sellPercent(rules)) / 100);
}

// 单个出售即整批数量为 1。
export function unitSellPrice(rules: Rules, itemId: string): number | null {
  return totalSellPrice(rules, itemId, 1);
}

const ROOT_STYLE = [
  CARD_STYLE,
  "position: absolute",
  "top: 72px",
  `right: ${SIDE_RAIL_MARGIN}px`,
  "display: flex",
  "flex-direction: column",
  "gap: 8px",
  "box-sizing: border-box",
  `width: ${SIDE_RAIL_WIDTH}px`,
  "max-height: calc(100% - 88px)",
  "overflow-y: auto",
  "padding: 12px",
  "z-index: 5",
].join(";");

const ITEM_STYLE = [
  "display: grid",
  "gap: 5px",
  "padding: 8px 0",
  "border-bottom: 1px solid rgba(226, 193, 141, 0.08)",
].join(";");

const HEAD_STYLE = [
  "display: grid",
  "grid-template-columns: 18px minmax(0, 1fr) auto",
  "align-items: center",
  "gap: 8px",
].join(";");

const FOOT_STYLE = [
  "display: flex",
  "flex-wrap: nowrap",
  "align-items: center",
  "justify-content: space-between",
  "gap: 4px",
  "padding-left: 18px",
  "min-width: 0",
].join(";");

// 侧卡里按钮压小一档，保证两种出售按钮能并排。
function compact(button: HTMLButtonElement): HTMLButtonElement {
  button.style.height = "26px";
  button.style.padding = "0 7px";
  button.style.fontSize = "10.5px";
  return button;
}

// 右侧仓库面板：列出有库存的物品，可出售 1 个或整批出售。
export class SiloPanel {
  private readonly root: HTMLDivElement;
  private readonly list: HTMLDivElement;
  private readonly note: HTMLDivElement;
  private readonly unsubscribe: () => void;
  private busy = false;
  // 仓库面板常驻显示，首次渲染到存档后上报一次 visitTab("silo")。
  private visited = false;
  private visiting = false;

  constructor(
    private readonly store: GameStore,
    private readonly onClose?: () => void,
  ) {
    this.root = document.createElement("div");
    this.root.id = "silo-panel";
    this.root.style.cssText = ROOT_STYLE;
    this.root.classList.add(SCROLL_CLASS);

    const title = document.createElement("div");
    title.textContent = `${buildingIcon("silo")} 仓库`;
    title.style.cssText = TITLE_STYLE;

    this.list = document.createElement("div");
    this.list.style.cssText = "display: flex; flex-direction: column";

    this.note = document.createElement("div");
    this.note.style.cssText = NOTE_STYLE;

    this.root.append(title, this.list, this.note);
    getStage().append(this.root);

    this.unsubscribe = this.store.subscribe(() => this.render());
    this.render();
  }

  open(): void {
    this.root.style.display = "flex";
    this.render();
  }

  close(): void {
    this.root.style.display = "none";
    this.onClose?.();
  }

  get visible(): boolean {
    return this.root.style.display !== "none";
  }

  private render(): void {
    const state = this.store.state;
    this.list.replaceChildren();

    if (!state) return;
    void this.reportVisit();

    const entries = Object.entries(state.silo).filter(([, quantity]) => quantity > 0);
    if (entries.length === 0) {
      const empty = document.createElement("div");
      empty.textContent = "仓库是空的";
      empty.style.cssText = MUTED_STYLE;
      this.list.append(empty);
    } else {
      for (const [itemId, quantity] of entries) {
        const item = document.createElement("div");
        item.style.cssText = ITEM_STYLE;

        const head = document.createElement("div");
        head.style.cssText = HEAD_STYLE;

        const icon = document.createElement("span");
        icon.textContent = itemIcon(itemId);
        icon.style.cssText = "font-size: 13px; line-height: 1; text-align: center";

        const name = document.createElement("span");
        name.style.cssText = "font-size: 12.5px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap";
        name.textContent = this.store.rules.ITEMS[itemId]?.name ?? itemId;

        const count = document.createElement("span");
        count.style.cssText = VALUE_STYLE;
        count.textContent = `×${quantity}`;

        head.append(icon, name, count);

        const foot = document.createElement("div");
        foot.style.cssText = FOOT_STYLE;

        const price = document.createElement("span");
        const total = totalSellPrice(this.store.rules, itemId, quantity);
        price.style.cssText = `${MUTED_STYLE}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap`;
        price.textContent = total === null ? "总价 -" : `总价 ${total}`;

        const actions = document.createElement("span");
        actions.style.cssText = "display: flex; gap: 4px; flex: none";

        actions.append(
          compact(makeButton("出售 ×1", this.busy, () => {
            void this.sell(itemId, 1);
          })),
        );

        // 库存大于 1 才提供整批出售，数量即当前库存。
        if (quantity > 1) {
          actions.append(
            compact(makeButton("全部出售", this.busy, () => {
              void this.sell(itemId, quantity);
            })),
          );
        }

        foot.append(price, actions);
        item.append(head, foot);
        this.list.append(item);
      }
    }

    this.renderExpansion(state);
  }

  // 仓库扩建：显示下一格价格，买后仓库格数增加。
  private renderExpansion(state: GameState): void {
    const silo = this.store.rules.SILO;
    if (!silo) return;

    const slots = state.siloSlots ?? silo.initial;
    const row = document.createElement("div");
    row.style.cssText = ROW_STYLE;

    const info = document.createElement("span");
    info.style.cssText = MUTED_STYLE;

    if (slots >= silo.max) {
      info.textContent = `仓库格 ${slots}/${silo.max}（已满）`;
      row.append(info);
    } else {
      const cost = silo.prices[slots - silo.initial];
      info.textContent = `仓库格 ${slots}/${silo.max} · 下一格 ${cost} 金币`;
      const expand = makeButton(`扩建仓库（${cost} 金币）`, this.busy || state.coins < cost, () => {
        void this.buySlot();
      });
      row.append(info, expand);
    }

    this.list.append(row);
  }

  private async sell(itemId: string, quantity: number): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.note.textContent = "";
    try {
      const result = await this.store.action("sellItem", { itemId, quantity });
      if (!result.ok) this.note.textContent = reasonText(result.reason);
    } finally {
      this.busy = false;
      this.render();
    }
  }

  private async buySlot(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.note.textContent = "";
    try {
      const result = await this.store.action("buySiloSlot", {});
      if (!result.ok) this.note.textContent = reasonText(result.reason);
    } finally {
      this.busy = false;
      this.render();
    }
  }

  // 服务端确认成功才算已访问；失败时下次渲染（轮询）重试。
  private async reportVisit(): Promise<void> {
    if (this.visited || this.visiting) return;
    this.visiting = true;
    try {
      const result = await this.store.action("visitTab", { tab: "silo" });
      if (result.ok) this.visited = true;
    } finally {
      this.visiting = false;
    }
  }

  destroy(): void {
    this.unsubscribe();
    this.root.remove();
  }
}
