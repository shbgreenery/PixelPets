import type { AnimalRule, GameState, Rules } from "../api/client";
import { animalView, herdSummary } from "../display/animalView";
import { formatDuration, levelOf, reasonText } from "../display/format";
import { animalIcon, buildingIcon } from "../display/icons";
import { getStage } from "../display/stage";
import { COLORS } from "../display/theme";
import type { GameStore } from "../state/store";
import {
  DETAIL_SCROLL_STYLE,
  DETAIL_STYLE,
  HEADER_STYLE,
  makeButton,
  MUTED_STYLE,
  NAME_STYLE,
  NOTE_STYLE,
  OVERLAY_STYLE,
  QUICK_BAR_STYLE,
  ROW_STYLE,
  SCROLL_CLASS,
  SIDE_ITEM_ACTIVE,
  SIDE_ITEM_STYLE,
  SIDE_LIST_STYLE,
  SPLIT_BODY_STYLE,
  SPLIT_CARD_STYLE,
  TITLE_STYLE,
} from "./panelStyles";

const SIDE_META_STYLE = `font-size: 10.5px; color: ${COLORS.muted}; flex: none`;
const READY_STYLE = `color: ${COLORS.grass}; font-size: 12px`;

type AnimalKindEntry = [string, AnimalRule];

// 一键动作在服务端中途停下时通过 result.stopped 返回原因。
function stoppedReason(raw: unknown): string | null {
  if (typeof raw !== "object" || raw === null) return null;
  const stopped = (raw as { stopped?: unknown }).stopped;
  return typeof stopped === "string" ? stopped : null;
}

// 养殖面板：左侧畜舍索引 + 右侧单舍操作台。
// 选中畜舍存在实例上，抵抗每 5 秒轮询触发的全量重渲染。
export class AnimalPanel {
  private readonly root: HTMLDivElement;
  private readonly sideList: HTMLDivElement;
  private readonly detail: HTMLDivElement;
  private readonly quickBar: HTMLDivElement;
  private readonly note: HTMLDivElement;
  private readonly unsubscribe: () => void;
  private selectedKind: string | null = null;
  private busy = false;

  constructor(
    private readonly store: GameStore,
    private readonly onClose?: () => void,
  ) {
    this.root = document.createElement("div");
    this.root.id = "animal-panel";
    this.root.style.cssText = OVERLAY_STYLE;
    this.root.addEventListener("click", (event) => {
      if (event.target === this.root) this.close();
    });

    const card = document.createElement("div");
    card.style.cssText = SPLIT_CARD_STYLE;

    const header = document.createElement("div");
    header.style.cssText = HEADER_STYLE;
    const title = document.createElement("div");
    title.textContent = `${buildingIcon("animals")} 养殖`;
    title.style.cssText = TITLE_STYLE;
    header.append(title, makeButton("关闭", false, () => this.close()));

    this.quickBar = document.createElement("div");
    this.quickBar.style.cssText = QUICK_BAR_STYLE;

    const body = document.createElement("div");
    body.style.cssText = SPLIT_BODY_STYLE;

    this.sideList = document.createElement("div");
    this.sideList.style.cssText = SIDE_LIST_STYLE;
    this.sideList.classList.add(SCROLL_CLASS);

    this.detail = document.createElement("div");
    this.detail.className = "sf-detail";
    this.detail.style.cssText = DETAIL_STYLE;

    body.append(this.sideList, this.detail);
    this.note = document.createElement("div");
    this.note.style.cssText = NOTE_STYLE;

    card.append(header, this.quickBar, body, this.note);
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

  private kinds(state: GameState, rules: Rules): AnimalKindEntry[] {
    return Object.entries(rules.ANIMALS ?? {})
      .filter(([kind]) => state.animals?.[kind] !== undefined);
  }

  private render(): void {
    // 轮询会全量重建，滚动位置必须手动保存与恢复，否则长列表每 5 秒跳回顶部。
    const sideScroll = this.sideList.scrollTop;
    const detailScroll = this.detailScrollTop();

    const state = this.store.state;
    const rules = this.store.rules;
    this.sideList.replaceChildren();
    this.detail.replaceChildren();

    if (!state) {
      const empty = document.createElement("div");
      empty.textContent = "加载中…";
      empty.style.cssText = MUTED_STYLE;
      this.detail.append(empty);
      return;
    }

    const now = Date.now();
    const level = levelOf(state.xp, rules);
    const kinds = this.kinds(state, rules);

    if (!this.selectedKind || !kinds.some(([kind]) => kind === this.selectedKind)) {
      const firstUnlocked = kinds.find(([, def]) => level >= def.unlockLevel);
      this.selectedKind = firstUnlocked?.[0] ?? kinds[0]?.[0] ?? null;
    }

    this.renderQuickBar(kinds, state, now);
    this.renderSide(kinds, state, level, now);
    this.renderDetail(kinds, state, level, now);

    this.sideList.scrollTop = sideScroll;
    this.restoreDetailScroll(detailScroll);
  }

  private detailScrollTop(): number {
    return this.detail.querySelector<HTMLElement>(".sf-detail-scroll")?.scrollTop ?? 0;
  }

  private restoreDetailScroll(top: number): void {
    const scroll = this.detail.querySelector<HTMLElement>(".sf-detail-scroll");
    if (scroll) scroll.scrollTop = top;
  }

  private renderQuickBar(kinds: AnimalKindEntry[], state: GameState, now: number): void {
    this.quickBar.replaceChildren();
    const entry = kinds.find(([kind]) => kind === this.selectedKind);
    if (!entry) return;

    const [kind] = entry;
    const view = animalView(state, kind, now);
    const hourglasses = state.hourglasses ?? 0;

    const spacer = document.createElement("span");
    spacer.style.cssText = "flex: 1 1 auto";
    const hourglass = document.createElement("span");
    hourglass.style.cssText = MUTED_STYLE;
    hourglass.textContent = `沙漏 ${hourglasses}`;

    this.quickBar.append(
      makeButton("喂养全部", this.busy || !view.canFeed, () => {
        void this.run("feedAll", { kind });
      }),
      makeButton("收取全部", this.busy || !view.canCollect, () => {
        void this.run("collectAll", { kind });
      }),
      makeButton("加速全部", this.busy || !view.canRush || hourglasses < 1, () => {
        void this.run("useHourglassOnAnimals", { kind });
      }),
      spacer,
      hourglass,
    );
  }

  private renderSide(kinds: AnimalKindEntry[], state: GameState, level: number, now: number): void {
    this.sideList.replaceChildren();
    for (const [kind, def] of kinds) {
      const active = kind === this.selectedKind;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "sf-side-item";
      button.dataset.animalKind = kind;
      button.dataset.selected = active ? "true" : "false";
      button.style.cssText = active ? `${SIDE_ITEM_STYLE};${SIDE_ITEM_ACTIVE}` : SIDE_ITEM_STYLE;

      const icon = document.createElement("span");
      icon.style.cssText = "flex: none; font-size: 14px; line-height: 1";
      icon.setAttribute("aria-hidden", "true");
      icon.textContent = animalIcon(kind);

      const name = document.createElement("span");
      name.style.cssText = "flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap";
      name.textContent = `${def.name}舍`;

      const meta = document.createElement("span");
      meta.style.cssText = SIDE_META_STYLE;
      meta.textContent = level < def.unlockLevel
        ? `Lv.${def.unlockLevel}`
        : herdSummary(animalView(state, kind, now).counts);

      button.append(icon, name, meta);
      button.addEventListener("click", () => {
        this.selectedKind = kind;
        this.render();
      });
      this.sideList.append(button);
    }
  }

  private renderDetail(kinds: AnimalKindEntry[], state: GameState, level: number, now: number): void {
    this.detail.replaceChildren();
    const entry = kinds.find(([kind]) => kind === this.selectedKind);
    this.detail.dataset.detailId = entry?.[0] ?? "";

    if (!entry) {
      const empty = document.createElement("div");
      empty.textContent = "没有可用的畜舍";
      empty.style.cssText = MUTED_STYLE;
      this.detail.append(empty);
      return;
    }

    const [kind, def] = entry;
    const group = state.animals![kind];
    const view = animalView(state, kind, now);
    const hourglasses = state.hourglasses ?? 0;

    const header = document.createElement("div");
    header.style.cssText = `${ROW_STYLE}; flex: none`;
    const name = document.createElement("span");
    name.style.cssText = NAME_STYLE;
    name.textContent = `${animalIcon(kind)} ${def.name}舍`;
    const meta = document.createElement("span");
    meta.style.cssText = MUTED_STYLE;
    meta.textContent = level < def.unlockLevel
      ? `需要等级 ${def.unlockLevel}`
      : `${group.list.length}/${group.slots} 只`;
    header.append(name, meta);

    const scroll = document.createElement("div");
    scroll.className = "sf-detail-scroll";
    scroll.style.cssText = DETAIL_SCROLL_STYLE;
    scroll.classList.add(SCROLL_CLASS);

    if (view.animals.length === 0) {
      const empty = document.createElement("div");
      empty.style.cssText = MUTED_STYLE;
      empty.textContent = "畜舍还是空的";
      scroll.append(empty);
    }

    if (level >= def.unlockLevel) {
      for (const animal of view.animals) {
        scroll.append(this.buildAnimalRow(kind, def, animal, hourglasses));
      }
    }

    // 未解锁畜舍只展示解锁条件，买入与扩建都还不该出现。
    if (level < def.unlockLevel) {
      this.detail.append(header, scroll);
      return;
    }

    const footer = document.createElement("div");
    footer.style.cssText = `${DETAIL_STYLE}; flex: none; gap: 4px`;

    const canBuy = group.list.length < group.slots && state.coins >= def.price;
    const buyRow = document.createElement("div");
    buyRow.style.cssText = ROW_STYLE;
    const productName = this.store.rules.ITEMS[def.product]?.name ?? def.product;
    const buyInfo = document.createElement("span");
    buyInfo.style.cssText = MUTED_STYLE;
    buyInfo.textContent = `买${def.name}（${def.price} 金币，每只产 ${productName}）`;
    buyRow.append(
      buyInfo,
      makeButton("买入", this.busy || !canBuy, () => {
        void this.run("buyAnimal", { kind });
      }),
    );
    footer.append(buyRow);

    const slotIndex = group.slots - def.initialSlots;
    if (slotIndex >= 0 && slotIndex < def.slotPrices.length) {
      const cost = def.slotPrices[slotIndex];
      const slotRow = document.createElement("div");
      slotRow.style.cssText = ROW_STYLE;
      const slotInfo = document.createElement("span");
      slotInfo.style.cssText = MUTED_STYLE;
      slotInfo.textContent = `畜舍位置 ${group.slots}/${def.maxSlots}`;
      slotRow.append(
        slotInfo,
        makeButton(`扩建畜舍（${cost} 金币）`, this.busy || state.coins < cost, () => {
          void this.run("buyStableSlot", { kind });
        }),
      );
      footer.append(slotRow);
    }

    this.detail.append(header, scroll, footer);
  }

  private buildAnimalRow(
    kind: string,
    def: AnimalRule,
    animal: { index: number; state: "hungry" | "growing" | "ready"; remaining: number },
    hourglasses: number,
  ): HTMLDivElement {
    const row = document.createElement("div");
    row.style.cssText = ROW_STYLE;

    const icon = document.createElement("span");
    icon.style.cssText = "font-size: 18px; line-height: 1; flex: none";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = animalIcon(kind);

    const name = document.createElement("span");
    name.style.cssText = NAME_STYLE;
    name.textContent = `${def.name} ${animal.index + 1}`;

    const status = document.createElement("span");
    if (animal.state === "hungry") {
      status.style.cssText = MUTED_STYLE;
      status.textContent = "饿着";
    } else if (animal.state === "ready") {
      status.style.cssText = READY_STYLE;
      status.textContent = "可收取";
    } else {
      status.style.cssText = MUTED_STYLE;
      status.textContent = `产出中 ${formatDuration(animal.remaining)}`;
    }
    row.append(icon, name, status);

    if (animal.state === "hungry") {
      row.append(makeButton("喂食", this.busy, () => {
        void this.run("feedAnimal", { kind, index: animal.index });
      }));
    } else if (animal.state === "growing") {
      row.append(makeButton("加速", this.busy || hourglasses < 1, () => {
        void this.run("useHourglass", {
          target: { kind: "animal", kindId: kind, index: animal.index },
        });
      }));
    } else {
      row.append(makeButton("收取", this.busy, () => {
        void this.run("collectAnimal", { kind, index: animal.index });
      }));
    }
    return row;
  }

  private async run(type: string, args: Record<string, unknown>): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.note.textContent = "";
    try {
      const result = await this.store.action(type, args);
      if (!result.ok) {
        // core 对仓库与畜舍格满都返回 max_slots，畜舍这里用专用文案。
        this.note.textContent = type === "buyStableSlot" && result.reason === "max_slots"
          ? "畜舍位置已满"
          : reasonText(result.reason);
        return;
      }
      this.note.textContent = stoppedReason(result.result) === "no_hourglass"
        ? reasonText("no_hourglass")
        : "";
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
