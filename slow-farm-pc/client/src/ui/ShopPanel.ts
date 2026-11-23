import { reasonText } from "../display/format";
import { buildingIcon, hudIcon } from "../display/icons";
import { COLORS } from "../display/theme";
import { getStage } from "../display/stage";
import type { GameStore } from "../state/store";
import {
  HEADER_STYLE,
  makeButton,
  MUTED_STYLE,
  NAME_STYLE,
  NOTE_STYLE,
  OVERLAY_CARD_STYLE,
  OVERLAY_STYLE,
  ROW_STYLE,
  SCROLL_CLASS,
  SECTION_STYLE,
  TITLE_STYLE,
  VALUE_STYLE,
} from "./panelStyles";

// 商店面板：宝石购买、沙漏礼包与广告奖励（没有真实广告 SDK，直接调服务端发奖）。
export class ShopPanel {
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
    this.root.id = "shop-panel";
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
    title.textContent = `${buildingIcon("shop")} 商店`;
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
    const gems = this.store.rules.GEMS;
    this.list.replaceChildren();

    if (!state) {
      const empty = document.createElement("div");
      empty.textContent = "加载中…";
      empty.style.cssText = MUTED_STYLE;
      this.list.append(empty);
      return;
    }
    if (!gems) return;

    const packs = document.createElement("div");
    packs.style.cssText = SECTION_STYLE;
    const packsTitle = document.createElement("div");
    packsTitle.style.cssText = `font-weight: 600; color: ${COLORS.amberSoft}; margin-bottom: 4px`;
    packsTitle.textContent = "沙漏";
    packs.append(packsTitle);

    for (const pack of gems.hourglassPacks) {
      const row = document.createElement("div");
      row.style.cssText = ROW_STYLE;
      const name = document.createElement("span");
      name.style.cssText = NAME_STYLE;
      name.textContent = `${hudIcon("hourglass")} 沙漏 ×${pack.qty}`;
      const price = document.createElement("span");
      price.style.cssText = VALUE_STYLE;
      const unit = Math.round((pack.cost / pack.qty) * 10) / 10;
      price.textContent = `${pack.cost} 宝石（单价 ${unit}）`;
      row.append(
        name,
        price,
        makeButton("购买", this.busy || state.gems < pack.cost, () =>
          void this.run("buyHourglass", { quantity: pack.qty }),
        ),
      );
      packs.append(row);
    }
    this.list.append(packs);

    const ads = document.createElement("div");
    ads.style.cssText = SECTION_STYLE;
    const adRow = document.createElement("div");
    adRow.style.cssText = ROW_STYLE;
    const adName = document.createElement("span");
    adName.style.cssText = NAME_STYLE;
    adName.textContent = `${hudIcon("gems")} 宝石 +${gems.adReward}`;
    const adHint = document.createElement("span");
    adHint.style.cssText = MUTED_STYLE;
    adHint.textContent = "模拟观看广告";
    adRow.append(
      adName,
      adHint,
      makeButton("观看广告", this.busy, () => void this.run("grantAdGems", {})),
    );
    ads.append(adRow);

    const buyRow = document.createElement("div");
    buyRow.style.cssText = ROW_STYLE;
    const buyName = document.createElement("span");
    buyName.style.cssText = NAME_STYLE;
    buyName.textContent = `${hudIcon("gems")} 宝石 +${gems.buyReward}`;
    const buyHint = document.createElement("span");
    buyHint.style.cssText = MUTED_STYLE;
    buyHint.textContent = "模拟领取，不涉及真实支付";
    buyRow.append(
      buyName,
      buyHint,
      makeButton("领取", this.busy, () => void this.run("buyGems", {})),
    );
    ads.append(buyRow);
    this.list.append(ads);
  }

  private async run(type: string, args: Record<string, unknown>): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.note.textContent = "";
    try {
      const result = await this.store.action(type, args);
      if (!result.ok) this.note.textContent = reasonText(result.reason);
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
