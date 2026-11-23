import { levelOf, reasonText } from "../display/format";
import { buildingIcon, cropIcon } from "../display/icons";
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

// 农场面板：地块扩建与整块农场的批量操作入口。
export class FarmPanel {
  private readonly root: HTMLDivElement;
  private readonly list: HTMLDivElement;
  private readonly note: HTMLDivElement;
  private readonly unsubscribe: () => void;
  private busy = false;

  constructor(
    private readonly store: GameStore,
    private readonly getCropId: () => string | null,
    private readonly onClose?: () => void,
  ) {
    this.root = document.createElement("div");
    this.root.id = "farm-panel";
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
    title.textContent = `${buildingIcon("farm")} 农场`;
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
    this.list.replaceChildren();
    const state = this.store.state;
    const rules = this.store.rules;
    if (!state) {
      const empty = document.createElement("div");
      empty.textContent = "加载中…";
      empty.style.cssText = MUTED_STYLE;
      this.list.append(empty);
      return;
    }

    const now = Date.now();

    // 地块扩建：显示下一块地价格，买后地块数增加。
    const plots = rules.PLOTS;
    const plotSection = document.createElement("div");
    plotSection.style.cssText = SECTION_STYLE;
    const plotRow = document.createElement("div");
    plotRow.style.cssText = ROW_STYLE;
    const plotInfo = document.createElement("span");
    plotInfo.style.cssText = NAME_STYLE;
    if (plots) {
      const next = plots.prices[state.plots.length - plots.initial];
      const full = state.plots.length >= plots.max || !next;
      const level = levelOf(state.xp, rules);
      const locked = !full && level < next.level;
      plotInfo.textContent = full
        ? `地块 ${state.plots.length}/${plots.max}（已满）`
        : `地块 ${state.plots.length}/${plots.max} · 下一块 ${next.cost} 金币（需 Lv.${next.level}）`;
      plotRow.append(
        plotInfo,
        makeButton(
          full ? "地块已满" : `扩建地块（${next.cost} 金币）`,
          this.busy || full || locked || state.coins < next.cost,
          () => void this.run("buyPlot", {}),
        ),
      );
    } else {
      plotInfo.textContent = `地块 ${state.plots.length}`;
      plotRow.append(plotInfo);
    }
    plotSection.append(plotRow);
    this.list.append(plotSection);

    // 批量操作：没有可操作地块时禁用。
    const hasEmpty = state.plots.some((plot) => !plot.cropId);
    const hasReady = state.plots.some((plot) => plot.cropId !== null && plot.readyAt <= now);
    const hasGrowing = state.plots.some((plot) => plot.cropId !== null && plot.readyAt > now);
    const hourglasses = state.hourglasses ?? 0;

    const bulkSection = document.createElement("div");
    bulkSection.style.cssText = SECTION_STYLE;
    const bulkTitle = document.createElement("div");
    bulkTitle.style.cssText = `font-weight: 600; color: ${COLORS.amberSoft}; margin-bottom: 4px`;
    bulkTitle.textContent = "批量操作";
    bulkSection.append(bulkTitle);

    const sowRow = document.createElement("div");
    sowRow.style.cssText = ROW_STYLE;
    const sowInfo = document.createElement("span");
    sowInfo.style.cssText = MUTED_STYLE;
    const selectedCropId = this.getCropId();
    sowInfo.textContent = `${selectedCropId ? cropIcon(selectedCropId) : ""} 一键播种（${this.cropName()}）`;
    sowRow.append(
      sowInfo,
      makeButton("一键播种", this.busy || !hasEmpty || this.getCropId() === null, () => {
        const cropId = this.getCropId();
        if (cropId) void this.run("plantAll", { cropId });
      }),
    );
    bulkSection.append(sowRow);

    const harvestRow = document.createElement("div");
    harvestRow.style.cssText = ROW_STYLE;
    const harvestInfo = document.createElement("span");
    harvestInfo.style.cssText = MUTED_STYLE;
    harvestInfo.textContent = "一键收获所有成熟作物";
    harvestRow.append(
      harvestInfo,
      makeButton("一键收获", this.busy || !hasReady, () => void this.run("harvestAll", {})),
    );
    bulkSection.append(harvestRow);

    const rushRow = document.createElement("div");
    rushRow.style.cssText = ROW_STYLE;
    const rushInfo = document.createElement("span");
    rushInfo.style.cssText = MUTED_STYLE;
    rushInfo.textContent = `地块加速（沙漏 ${hourglasses}）`;
    rushRow.append(
      rushInfo,
      makeButton(
        "全部加速",
        this.busy || hourglasses < 1 || !hasGrowing,
        () => void this.run("useHourglassOnPlots", {}),
      ),
    );
    bulkSection.append(rushRow);

    this.list.append(bulkSection);
  }

  private cropName(): string {
    const cropId = this.getCropId();
    if (!cropId) return "无可用作物";
    return this.store.rules.ITEMS[cropId]?.name ?? cropId;
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
