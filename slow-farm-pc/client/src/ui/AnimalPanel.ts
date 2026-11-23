import { animalView } from "../display/animalView";
import { formatDuration, levelOf, reasonText } from "../display/format";
import { animalIcon, buildingIcon, itemIcon } from "../display/icons";
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
} from "./panelStyles";

const READY_STYLE = `color: ${COLORS.grass}; font-size: 12px`;

// 一键动作在服务端中途停下时通过 result.stopped 返回原因。
function stoppedReason(raw: unknown): string | null {
  if (typeof raw !== "object" || raw === null) return null;
  const stopped = (raw as { stopped?: unknown }).stopped;
  return typeof stopped === "string" ? stopped : null;
}

// 养殖面板：三种畜舍的买入、喂食、收取、加速与扩建。
export class AnimalPanel {
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
    this.root.id = "animal-panel";
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
    title.textContent = `${buildingIcon("animals")} 养殖`;
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

    const level = levelOf(state.xp, rules);
    for (const [kind, def] of Object.entries(rules.ANIMALS ?? {})) {
      const group = state.animals?.[kind];
      if (!group) continue;

      const view = animalView(state, kind, Date.now());
      const section = document.createElement("div");
      section.style.cssText = SECTION_STYLE;
      this.list.append(section);

      const heading = document.createElement("div");
      heading.style.cssText = ROW_STYLE;
      const name = document.createElement("span");
      name.style.cssText = NAME_STYLE;
      name.textContent = `${animalIcon(kind)} ${def.name}舍  ${group.list.length}/${group.slots} 只`;
      heading.append(
        name,
        makeButton("喂食全部", this.busy || !view.canFeed, () => void this.run("feedAll", { kind })),
        makeButton("收取全部", this.busy || !view.canCollect, () => void this.run("collectAll", { kind })),
        makeButton("全部加速", this.busy || !view.canRush, () =>
          void this.run("useHourglassOnAnimals", { kind }),
        ),
      );
      section.append(heading);

      if (view.animals.length === 0) {
        const empty = document.createElement("div");
        empty.style.cssText = MUTED_STYLE;
        empty.textContent = "畜舍还是空的";
        section.append(empty);
      }

      for (const animal of view.animals) {
        const row = document.createElement("div");
        row.style.cssText = ROW_STYLE;
        const block = document.createElement("span");
        block.style.cssText = "font-size: 18px; line-height: 1; flex: none";
        block.textContent = animalIcon(kind);
        const animalName = document.createElement("span");
        animalName.style.cssText = NAME_STYLE;
        animalName.textContent = `${def.name} ${animal.index + 1}`;
        const status = document.createElement("span");
        status.style.cssText = animal.state === "ready" ? READY_STYLE : MUTED_STYLE;
        if (animal.state === "hungry") status.textContent = "饿着";
        else if (animal.state === "ready") status.textContent = "可收取";
        else status.textContent = `产出中 ${formatDuration(animal.remaining)}`;
        row.append(block, animalName, status);

        if (animal.state === "hungry") {
          row.append(
            makeButton("喂食", this.busy, () =>
              void this.run("feedAnimal", { kind, index: animal.index }),
            ),
          );
        } else if (animal.state === "growing") {
          row.append(
            makeButton("加速", this.busy, () =>
              void this.run("useHourglass", {
                target: { kind: "animal", kindId: kind, index: animal.index },
              }),
            ),
          );
        } else {
          row.append(
            makeButton("收取", this.busy, () =>
              void this.run("collectAnimal", { kind, index: animal.index }),
            ),
          );
        }
        section.append(row);
      }

      const productName = rules.ITEMS[def.product]?.name ?? def.product;
      const productLabel = `${itemIcon(def.product)}${productName}`;
      const canBuy = level >= def.unlockLevel
        && group.list.length < group.slots
        && state.coins >= def.price;
      const buyRow = document.createElement("div");
      buyRow.style.cssText = ROW_STYLE;
      const buyInfo = document.createElement("span");
      buyInfo.style.cssText = MUTED_STYLE;
      buyInfo.textContent = level < def.unlockLevel
        ? `买${def.name}（需 Lv.${def.unlockLevel}）`
        : `买${def.name}（${def.price} 金币，每只产 ${productLabel}）`;
      buyRow.append(
        buyInfo,
        makeButton("买入", this.busy || !canBuy, () => void this.run("buyAnimal", { kind })),
      );
      section.append(buyRow);

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
          makeButton(`扩建畜舍（${cost} 金币）`, this.busy || state.coins < cost, () =>
            void this.run("buyStableSlot", { kind }),
          ),
        );
        section.append(slotRow);
      }
    }
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
      // 一键加速在沙漏用完时仍然 ok，用 stopped 提示原因。
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
