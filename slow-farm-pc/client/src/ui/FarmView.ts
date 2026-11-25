import { reasonText } from "../display/format";
import { buildingIcon } from "../display/icons";
import { plotCommand } from "../display/plotCommand";
import { CONTENT_RIGHT, DESIGN_WIDTH, STAGE_PADDING, getStage } from "../display/stage";
import { FONT_FAMILY, PALETTE } from "../display/theme";
import { deliverableOrderCount } from "../display/viewModels";
import type { GameStore } from "../state/store";
import { AchievementsPanel } from "./AchievementsPanel";
import { AnimalPanel } from "./AnimalPanel";
import { BarnRackView } from "./BarnRackView";
import { DockBar } from "./DockBar";
import { FarmPanel } from "./FarmPanel";
import { MachinePanel } from "./MachinePanel";
import { OrdersPanel } from "./OrdersPanel";
import { PlotCellView } from "./PlotCellView";
import { SeedPanel } from "./SeedPanel";
import { ShopPanel } from "./ShopPanel";
import { SiloPanel } from "./SiloPanel";
import { DOCK_TOP } from "./farmStyles";

// 舞台 1280×720 的分区：上方 HUD（0–64）与种子条（72–192）是 DOM 叠层，
// 农场内容从种子条下方开始，避免分区标题被盖住。
const FIELD_LEFT = STAGE_PADDING;
const FIELD_RIGHT = CONTENT_RIGHT;
const FIELD_TOP = 222;
const FIELD_BOTTOM = 454;
const FIELD_HEIGHT = FIELD_BOTTOM - FIELD_TOP;
const FIELD_HEAD_Y = 206;
const CELL_COLUMNS = 6;
const CELL_HEIGHT = 110;
const CELL_GAP = 12;
const BARN = { left: STAGE_PADDING, right: CONTENT_RIGHT, y: 532 };
const BARN_HEAD_Y = 474;
const DOCK_HEIGHT = 130;

// 畜舍优先使用预加载贴图；本任务只按种类声明可用性，404 回退在浏览器验收时确认。
const ANIMAL_TEXTURES = ["chicken", "cow"];

const LABEL_INTERVAL_MS = 250;
const TOAST_DURATION_MS = 1800;

const ROOT_STYLE = "position: absolute; inset: 0; z-index: 0;";

interface PanelHandle {
  open(): void;
  close(): void;
  destroy(): void;
}

// 农场 DOM 版本：背景、分区标题、耕地网格、畜舍与底部入口的编排。
// 动作仍由服务端裁决；状态变化只做差分写入，倒计时由 250ms 定时器驱动。
export class FarmView {
  readonly element: HTMLDivElement;
  private readonly cells: PlotCellView[] = [];
  private readonly barn: BarnRackView;
  private readonly dock: DockBar;
  private readonly status: HTMLDivElement;
  private readonly fieldMeta: HTMLDivElement;
  private readonly barnMeta: HTMLDivElement;
  private readonly toast: HTMLDivElement;
  private readonly unsubscribe: () => void;
  private readonly timer: number;
  private machinePanel?: MachinePanel;
  private ordersPanel?: OrdersPanel;
  private animalPanel?: AnimalPanel;
  private achievementsPanel?: AchievementsPanel;
  private shopPanel?: ShopPanel;
  private siloPanel?: SiloPanel;
  private seedPanel?: SeedPanel;
  private farmPanel?: FarmPanel;
  private activeDock: string | null = null;
  // 同一页签只在本次页面生命周期内上报一次，避免每次切换都写盘。
  private readonly visitedTabs = new Set<string>();
  // visitTab 请求进行中的页签，避免连点重复上报。
  private readonly visitingTabs = new Set<string>();
  private busy = false;
  private lastStatus = "";
  private lastFieldMeta = "";
  private lastBarnMeta = "";
  private lastToast = "";
  private toastTimer = 0;

  constructor(private readonly store: GameStore) {
    this.element = document.createElement("div");
    this.element.id = "farm";
    this.element.style.cssText = ROOT_STYLE;

    const background = document.createElement("div");
    background.className = "farm-bg";
    this.element.append(background);

    this.element.append(this.buildSectionTitle(FIELD_LEFT, FIELD_HEAD_Y, "耕地"));
    this.fieldMeta = this.buildMeta(FIELD_RIGHT, FIELD_HEAD_Y, 14);
    this.element.append(this.fieldMeta);

    this.element.append(this.buildSectionTitle(FIELD_LEFT, BARN_HEAD_Y, "畜舍"));
    this.barnMeta = this.buildMeta(BARN.right, BARN_HEAD_Y, 13);
    this.element.append(this.barnMeta);

    this.barn = new BarnRackView({
      left: BARN.left,
      right: BARN.right,
      y: BARN.y,
      hasTexture: (kind) => ANIMAL_TEXTURES.includes(kind),
      onSelect: () => this.togglePanel("animals", this.animalPanel, "animals"),
    });
    this.element.append(this.barn.element);

    this.dock = new DockBar(DESIGN_WIDTH, DOCK_TOP, DOCK_HEIGHT, [
      { key: "farm", label: "农场", icon: buildingIcon("farm"), onSelect: () => this.togglePanel("farm", this.farmPanel, "farm") },
      { key: "silo", label: "仓库", icon: buildingIcon("silo"), onSelect: () => this.togglePanel("silo", this.siloPanel) },
      { key: "machines", label: "机器", icon: buildingIcon("machines"), onSelect: () => this.togglePanel("machines", this.machinePanel, "machines") },
      { key: "orders", label: "订单", icon: buildingIcon("orders"), onSelect: () => this.togglePanel("orders", this.ordersPanel, "orders") },
      { key: "animals", label: "养殖", icon: buildingIcon("animals"), onSelect: () => this.togglePanel("animals", this.animalPanel, "animals") },
      { key: "shop", label: "商店", icon: buildingIcon("shop"), onSelect: () => this.togglePanel("shop", this.shopPanel, "shop") },
      { key: "achievements", label: "成就", icon: buildingIcon("achievements"), onSelect: () => this.togglePanel("achievements", this.achievementsPanel, "deeds") },
    ]);
    this.element.append(this.dock.element);

    this.status = document.createElement("div");
    this.status.className = "farm-status";
    this.status.dataset.visible = "false";
    this.toast = document.createElement("div");
    this.toast.className = "farm-toast";
    this.toast.dataset.visible = "false";
    this.element.append(this.status, this.toast);

    getStage().append(this.element);

    this.machinePanel = new MachinePanel(store, () => this.onPanelClosed("machines"));
    this.ordersPanel = new OrdersPanel(store, () => this.onPanelClosed("orders"));
    this.animalPanel = new AnimalPanel(store, () => this.onPanelClosed("animals"));
    this.achievementsPanel = new AchievementsPanel(store, () => this.onPanelClosed("achievements"));
    this.shopPanel = new ShopPanel(store, () => this.onPanelClosed("shop"));
    this.siloPanel = new SiloPanel(store, () => this.onPanelClosed("silo"));
    this.seedPanel = new SeedPanel(store);
    this.farmPanel = new FarmPanel(
      store,
      () => this.seedPanel?.selectedCropId ?? null,
      () => this.onPanelClosed("farm"),
    );

    // 仓库是常驻侧卡，启动时即高亮对应入口。
    this.activeDock = "silo";
    this.dock.setActive("silo");

    this.unsubscribe = store.subscribe(() => this.refresh());
    this.timer = window.setInterval(() => this.refreshLabels(), LABEL_INTERVAL_MS);
    this.refresh();
  }

  destroy(): void {
    window.clearInterval(this.timer);
    this.unsubscribe();
    if (this.toastTimer !== 0) {
      window.clearTimeout(this.toastTimer);
      this.toastTimer = 0;
    }
    this.destroyPanels();
    this.clearViews();
    this.barn.destroy();
    this.dock.destroy();
    this.element.remove();
  }

  private buildSectionTitle(x: number, y: number, text: string): HTMLDivElement {
    const title = document.createElement("div");
    title.className = "farm-section-title";
    title.textContent = text;
    title.style.left = `${x}px`;
    title.style.top = `${y}px`;
    return title;
  }

  // 分区统计：右对齐到主内容列，绝对定位到标题同一中线。
  private buildMeta(right: number, y: number, fontSize: number): HTMLDivElement {
    const meta = document.createElement("div");
    meta.style.cssText = [
      "position: absolute",
      `right: ${DESIGN_WIDTH - right}px`,
      `top: ${y}px`,
      "transform: translateY(-50%)",
      `font-family: ${FONT_FAMILY.sans}`,
      `font-size: ${fontSize}px`,
      "line-height: 1.2",
      "white-space: nowrap",
      `color: ${PALETTE.ink3}`,
      "pointer-events: none",
    ].join(";");
    return meta;
  }

  // 同一入口再次点击即关闭；换入口时只保留一个面板。
  private togglePanel(key: string, panel: PanelHandle | undefined, tab?: string): void {
    if (!panel) return;
    if (this.activeDock === key) {
      panel.close();
      return;
    }
    this.closePanels();
    panel.open();
    this.activeDock = key;
    this.dock.setActive(key);
    if (tab) void this.visitTabOnce(tab);
  }

  private onPanelClosed(key: string): void {
    if (this.activeDock !== key) return;
    this.activeDock = null;
    this.dock.setActive(null);
  }

  private closePanels(): void {
    for (const panel of [
      this.machinePanel,
      this.ordersPanel,
      this.animalPanel,
      this.achievementsPanel,
      this.shopPanel,
      this.siloPanel,
      this.farmPanel,
    ]) {
      panel?.close();
    }
  }

  private destroyPanels(): void {
    for (const panel of [
      this.machinePanel,
      this.ordersPanel,
      this.animalPanel,
      this.achievementsPanel,
      this.shopPanel,
      this.siloPanel,
      this.seedPanel,
      this.farmPanel,
    ]) {
      panel?.destroy();
    }
    this.machinePanel = undefined;
    this.ordersPanel = undefined;
    this.animalPanel = undefined;
    this.achievementsPanel = undefined;
    this.shopPanel = undefined;
    this.siloPanel = undefined;
    this.seedPanel = undefined;
    this.farmPanel = undefined;
  }

  // 服务端确认后再记录已访问，失败时下次打开重试。
  private async visitTabOnce(tab: string): Promise<void> {
    if (this.visitedTabs.has(tab) || this.visitingTabs.has(tab)) return;
    this.visitingTabs.add(tab);
    try {
      const result = await this.store.action("visitTab", { tab });
      if (result.ok) this.visitedTabs.add(tab);
    } finally {
      this.visitingTabs.delete(tab);
    }
  }

  private refresh(): void {
    // 存档版本不兼容时整页只读，只显示提示，不渲染可点击地块。
    if (this.store.readonly) {
      this.clearViews();
      this.setStatus(reasonText(this.store.error), true);
      return;
    }

    const state = this.store.state;
    if (!state) {
      this.clearViews();
      this.setStatus(this.store.offline ? "后端未启动" : "加载中…", true);
      return;
    }

    this.setStatus("后端未启动", this.store.offline);
    this.syncViews(state.plots.length);
    this.refreshLabels();
  }

  private syncViews(count: number): void {
    if (count === this.cells.length) return;
    this.clearViews();
    if (count === 0) return;

    const columns = Math.min(CELL_COLUMNS, count);
    const rows = Math.ceil(count / columns);
    const cellWidth = (FIELD_RIGHT - FIELD_LEFT - (columns - 1) * CELL_GAP) / columns;
    const startX = FIELD_LEFT + cellWidth / 2;
    const blockHeight = rows * CELL_HEIGHT + (rows - 1) * CELL_GAP;
    const startY = FIELD_TOP + (FIELD_HEIGHT - blockHeight) / 2 + CELL_HEIGHT / 2;

    for (let index = 0; index < count; index += 1) {
      const x = startX + (index % columns) * (cellWidth + CELL_GAP);
      const y = startY + Math.floor(index / columns) * (CELL_HEIGHT + CELL_GAP);
      const cell = new PlotCellView({
        index,
        width: cellWidth,
        height: CELL_HEIGHT,
        onSelect: (plotIndex) => {
          void this.handlePlot(plotIndex);
        },
      });
      // 设计单位绝对定位：PlotCellView 内部按卡片中心排几何，这里换算成左上角。
      cell.element.style.position = "absolute";
      cell.element.style.left = `${x - cellWidth / 2}px`;
      cell.element.style.top = `${y - CELL_HEIGHT / 2}px`;
      this.cells.push(cell);
      this.element.append(cell.element);
    }
  }

  private refreshLabels(): void {
    const state = this.store.state;
    if (!state) return;

    const now = Date.now();
    let empty = 0;
    let growing = 0;
    let ready = 0;

    state.plots.forEach((plot, index) => {
      const view = this.cells[index];
      if (!view) return;
      const stage = view.update(plot, now);
      if (stage === "empty") empty += 1;
      else if (stage === "growing") growing += 1;
      else ready += 1;
    });
    this.setFieldMeta(`空地 ${empty} · 生长 ${growing} · 可收 ${ready}`);

    this.barn.update(state, this.store.rules, now);
    const animalKinds = Object.keys(this.store.rules.ANIMALS ?? {}).length;
    const readyAnimals = Object.values(state.animals ?? {}).reduce(
      (sum, group) => sum + group.list.filter((animal) => animal.readyAt > 0 && animal.readyAt <= now).length,
      0,
    );
    this.setBarnMeta(
      readyAnimals > 0 ? `${animalKinds} 个栏位 · ${readyAnimals} 可收取` : `${animalKinds} 个栏位`,
    );

    this.dock.setOrderBadge(deliverableOrderCount(state, this.store.rules, now));
  }

  private setStatus(text: string, visible: boolean): void {
    if (text !== this.lastStatus) {
      this.lastStatus = text;
      this.status.textContent = text;
    }
    const value = visible ? "true" : "false";
    if (this.status.dataset.visible !== value) this.status.dataset.visible = value;
  }

  private setFieldMeta(text: string): void {
    if (text === this.lastFieldMeta) return;
    this.lastFieldMeta = text;
    this.fieldMeta.textContent = text;
  }

  private setBarnMeta(text: string): void {
    if (text === this.lastBarnMeta) return;
    this.lastBarnMeta = text;
    this.barnMeta.textContent = text;
  }

  private setToastVisible(visible: boolean): void {
    const value = visible ? "true" : "false";
    if (this.toast.dataset.visible !== value) this.toast.dataset.visible = value;
  }

  private cropName(cropId: string): string {
    return this.store.rules.ITEMS[cropId]?.name ?? cropId;
  }

  private async handlePlot(index: number): Promise<void> {
    if (this.busy) return;
    const state = this.store.state;
    if (!state) {
      this.showToast("后端未启动");
      return;
    }

    const plot = state.plots[index];
    if (!plot) return;

    // 动作由当前选中的作物与地块阶段决定，不再固定种植第一种作物。
    const command = plotCommand(
      state,
      index,
      this.seedPanel?.selectedCropId ?? null,
      Date.now(),
    );
    if (command.type === "none") {
      this.showToast(reasonText(command.reason));
      return;
    }

    const { type, args } = command;
    this.busy = true;
    try {
      const result = await this.store.action(type, args);
      if (!result.ok) {
        this.showToast(reasonText(result.reason));
        return;
      }
      if (type === "harvest") {
        this.playHarvestFeedback(index, plot.cropId, result.result);
      }
    } finally {
      this.busy = false;
      this.refresh();
    }
  }

  // 收获结果以服务端 result 为准：itemId 与 qty。
  private playHarvestFeedback(index: number, cropId: string | null, raw: unknown): void {
    const view = this.cells[index];
    if (!view) return;

    const recorded = typeof raw === "object" && raw !== null
      ? (raw as { itemId?: unknown; qty?: unknown })
      : {};
    const itemId = typeof recorded.itemId === "string" ? recorded.itemId : cropId;
    const quantity = typeof recorded.qty === "number" ? recorded.qty : 0;
    const name = itemId ? this.cropName(itemId) : "收获";
    view.playHarvest(`${name} +${quantity}`);
  }

  private showToast(message: string): void {
    if (this.toastTimer !== 0) {
      window.clearTimeout(this.toastTimer);
      this.toastTimer = 0;
    }
    if (message !== this.lastToast) {
      this.lastToast = message;
      this.toast.textContent = message;
    }
    this.setToastVisible(true);
    this.toastTimer = window.setTimeout(() => {
      this.toastTimer = 0;
      this.setToastVisible(false);
    }, TOAST_DURATION_MS);
  }

  private clearViews(): void {
    for (const view of this.cells) view.destroy();
    this.cells.length = 0;
  }
}
