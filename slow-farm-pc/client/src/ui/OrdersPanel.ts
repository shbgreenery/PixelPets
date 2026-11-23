import { reasonText } from "../display/format";
import { buildingIcon, itemIcon } from "../display/icons";
import { COLORS, FONT_FAMILY, RADIUS, SURFACE } from "../display/theme";
import { getStage } from "../display/stage";
import { orderShortfall, orderView } from "../display/viewModels";
import type { GameStore } from "../state/store";
import {
  HEADER_STYLE,
  makeButton,
  MUTED_STYLE,
  NOTE_STYLE,
  OVERLAY_CARD_STYLE,
  OVERLAY_STYLE,
  ROW_STYLE,
  SCROLL_CLASS,
  TITLE_STYLE,
  VALUE_STYLE,
} from "./panelStyles";

const ORDER_STYLE = [
  "display: grid",
  "gap: 9px",
  "padding: 11px 12px 10px",
  `border-radius: ${RADIUS.md}`,
  "border: 1px solid rgba(226, 193, 141, 0.11)",
  `background: ${SURFACE.section}`,
].join(";");

// 每日特供：琥珀描边 + 略亮的暖底，保持"当前可做"的语义。
const DAILY_STYLE = [
  ORDER_STYLE,
  "border-color: rgba(232, 163, 61, 0.42)",
  `background: ${SURFACE.daily}`,
  "box-shadow: inset 0 1px 0 rgba(255, 214, 150, 0.1)",
].join(";");

const BADGE_STYLE = [
  "flex: none",
  "padding: 1px 7px",
  "border-radius: 999px",
  "background: rgba(232, 163, 61, 0.16)",
  "border: 1px solid rgba(232, 163, 61, 0.36)",
  `color: ${COLORS.amberSoft}`,
  "font-size: 10px",
  "letter-spacing: 0.04em",
  "white-space: nowrap",
].join(";");

const LINE_STYLE = [
  "display: grid",
  "grid-template-columns: 18px minmax(0, 1fr) auto",
  "align-items: center",
  "gap: 8px",
  "font-size: 12px",
].join(";");

const LINE_NAME_STYLE = [
  `color: ${COLORS.subtle}`,
  "letter-spacing: 0.02em",
  "overflow: hidden",
  "text-overflow: ellipsis",
  "white-space: nowrap",
].join(";");

const SHORT_STYLE = `color: ${COLORS.clay}; font-size: 11.5px; line-height: 1.5`;

// 订单面板：普通订单与每日特供，交付、放弃与扩建订单栏。
export class OrdersPanel {
  private readonly root: HTMLDivElement;
  private readonly list: HTMLDivElement;
  private readonly note: HTMLDivElement;
  private readonly unsubscribe: () => void;
  private busy = false;

  constructor(
    private readonly store: GameStore,
    private readonly onClose?: () => void,
  ) {
    this.root = document.createElement("div");
    this.root.id = "orders-panel";
    this.root.style.cssText = OVERLAY_STYLE;
    this.root.addEventListener("click", (event) => {
      if (event.target === this.root) this.close();
    });

    const card = document.createElement("div");
    card.style.cssText = OVERLAY_CARD_STYLE;
    card.classList.add(SCROLL_CLASS);

    const header = document.createElement("div");
    header.style.cssText = HEADER_STYLE;
    const title = document.createElement("div");
    title.textContent = `${buildingIcon("orders")} 订单`;
    title.style.cssText = TITLE_STYLE;
    header.append(title, makeButton("关闭", false, () => this.close()));

    this.list = document.createElement("div");
    this.note = document.createElement("div");
    this.note.style.cssText = NOTE_STYLE;

    card.append(header, this.list, this.note);
    this.root.append(card);
    getStage().append(this.root);

    this.unsubscribe = this.store.subscribe(() => this.render());
  }

  open(): void {
    this.root.style.display = "flex";
    this.render();
  }

  close(): void {
    this.root.style.display = "none";
    this.onClose?.();
  }

  private render(): void {
    const state = this.store.state;
    const rules = this.store.rules;
    this.list.replaceChildren();

    if (!state) {
      const empty = document.createElement("div");
      empty.textContent = "加载中…";
      empty.style.cssText = MUTED_STYLE;
      this.list.append(empty);
      return;
    }

    for (const order of orderView(state, Date.now(), rules)) {
      const card = document.createElement("div");
      card.style.cssText = order.daily ? DAILY_STYLE : ORDER_STYLE;

      const heading = document.createElement("div");
      heading.style.cssText = "display: flex; align-items: flex-start; justify-content: space-between; gap: 8px";
      const title = document.createElement("span");
      title.style.cssText = "font-size: 13.5px; font-weight: 600; letter-spacing: 0.03em; line-height: 1.35";
      title.textContent = `订单 ${order.id}`;
      heading.append(title);
      if (order.daily) {
        const badge = document.createElement("span");
        badge.style.cssText = BADGE_STYLE;
        badge.textContent = "每日特供";
        heading.append(badge);
      }
      card.append(heading);

      // 每行「持有 / 需要」：满足用草绿，不足用土红。
      for (const line of order.lines) {
        const row = document.createElement("div");
        row.style.cssText = LINE_STYLE;

        const icon = document.createElement("span");
        icon.style.cssText = "font-size: 13px; line-height: 1; text-align: center";
        icon.setAttribute("aria-hidden", "true");
        icon.textContent = itemIcon(line.itemId);

        const name = document.createElement("span");
        name.style.cssText = LINE_NAME_STYLE;
        name.textContent = line.name;

        const qty = document.createElement("span");
        qty.style.cssText = `font-family: ${FONT_FAMILY.num}; font-size: 11.5px; color: ${COLORS.muted}; font-variant-numeric: tabular-nums`;
        const have = document.createElement("b");
        have.style.cssText = `font-weight: 700; color: ${line.ok ? COLORS.grass : COLORS.clay}`;
        have.textContent = String(line.have);
        qty.append(have, document.createTextNode(` / ${line.need}`));

        row.append(icon, name, qty);
        card.append(row);
      }

      // 不满时写明还差什么，按钮禁用不再只说"不能点"。
      const shortfall = orderShortfall(order);
      if (shortfall) {
        const short = document.createElement("div");
        short.style.cssText = SHORT_STYLE;
        short.textContent = shortfall;
        card.append(short);
      }

      const footer = document.createElement("div");
      footer.style.cssText = "display: flex; align-items: center; justify-content: space-between; gap: 8px; padding-top: 2px";
      const reward = document.createElement("span");
      reward.style.cssText = VALUE_STYLE;
      reward.textContent = `金币 ${order.coins} · 经验 ${order.xp}`;
      const actions = document.createElement("span");
      actions.style.cssText = "display: flex; gap: 6px";
      // 每日特供由服务端按天发放，core 不接受放弃，只展示交付。
      if (!order.daily) {
        actions.append(
          makeButton("放弃", this.busy, () =>
            void this.run("abandonOrder", { orderId: order.id }),
          ),
        );
      }
      actions.append(
        makeButton(
          "交付",
          this.busy || !order.deliverable,
          () => void this.run("deliverOrder", { orderId: order.id }),
          "primary",
        ),
      );
      footer.append(reward, actions);
      card.append(footer);
      this.list.append(card);
    }

    const orderRules = rules.ORDERS;
    if (!orderRules) return;

    const slots = state.orderSlots ?? orderRules.initialSlots;
    const row = document.createElement("div");
    row.style.cssText = ROW_STYLE;
    const info = document.createElement("span");
    info.style.cssText = MUTED_STYLE;
    info.textContent = `订单栏 ${slots}/${orderRules.maxSlots}`;
    row.append(info);
    if (slots < orderRules.maxSlots) {
      const cost = orderRules.slotPrices[slots - orderRules.initialSlots];
      row.append(
        makeButton(`扩建订单栏（${cost} 金币）`, this.busy, () =>
          void this.run("buyOrderSlot", {}),
        ),
      );
    }
    this.list.append(row);
  }

  private async run(type: string, args: Record<string, unknown>): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.note.textContent = "";
    try {
      const result = await this.store.action(type, args);
      if (!result.ok) {
        this.note.textContent = reasonText(result.reason);
      } else {
        this.note.textContent = "";
      }
    } finally {
      this.busy = false;
      this.render();
    }
  }

  destroy(): void {
    this.unsubscribe();
    this.root.remove();
  }
}
