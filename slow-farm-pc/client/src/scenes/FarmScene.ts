import Phaser from "phaser";
import { reasonText } from "../display/format";
import { buildingIcon } from "../display/icons";
import {
  CONTENT_RIGHT,
  DESIGN_HEIGHT,
  DESIGN_WIDTH,
  STAGE_PADDING,
  stageDpr,
} from "../display/stage";
import { FONT_FAMILY, PALETTE, STAGE_COLOR } from "../display/theme";
import { deliverableOrderCount } from "../display/viewModels";
import type { GameStore } from "../state/store";
import { AchievementsPanel } from "../ui/AchievementsPanel";
import { AnimalPanel } from "../ui/AnimalPanel";
import { FarmPanel } from "../ui/FarmPanel";
import { MachinePanel } from "../ui/MachinePanel";
import { OrdersPanel } from "../ui/OrdersPanel";
import { SeedPanel } from "../ui/SeedPanel";
import { ShopPanel } from "../ui/ShopPanel";
import { SiloPanel } from "../ui/SiloPanel";
import { BarnView } from "./BarnView";
import { DockView, type DockEntry } from "./DockView";
import { PlotView } from "./PlotView";
import { plotCommand } from "./plotCommand";

export interface FarmSceneData {
  store: GameStore;
}

// 舞台 1280×720 的分区：上方 HUD（0–64）与种子条（72–192）是 DOM 叠层，
// 画布内容从种子条下方开始，避免分区标题被盖住。
// 主内容列左右边界与种子条共用 CONTENT_RIGHT，保证 DOM 与画布对齐。
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
const DOCK_TOP = 590;
const DOCK_HEIGHT = 130;

// 鸡/牛优先使用预加载贴图，缺失或加载失败时回退 emoji。
const ANIMAL_TEXTURES = ["chicken", "cow"];

interface PanelHandle {
  open(): void;
  close(): void;
}

// 农场主场景：耕地网格、畜舍与底部入口，动作仍由服务端裁决。
export class FarmScene extends Phaser.Scene {
  private store!: GameStore;
  private views: PlotView[] = [];
  private statusText!: Phaser.GameObjects.Text;
  private toastText!: Phaser.GameObjects.Text;
  private toastTimer?: Phaser.Time.TimerEvent;
  private fieldMeta!: Phaser.GameObjects.Text;
  private barnMeta!: Phaser.GameObjects.Text;
  private barn?: BarnView;
  private dock?: DockView;
  private unsubscribe?: () => void;
  private machinePanel?: MachinePanel;
  private ordersPanel?: OrdersPanel;
  private animalPanel?: AnimalPanel;
  private achievementsPanel?: AchievementsPanel;
  private shopPanel?: ShopPanel;
  private siloPanel?: SiloPanel;
  private seedPanel?: SeedPanel;
  private farmPanel?: FarmPanel;
  private activeDock: string | null = null;
  // 加载失败的动物贴图，创建栏位时回退到 emoji。
  private readonly failedTextures = new Set<string>();
  // 同一页签只在本次页面生命周期内上报一次，避免每次切换都写盘。
  private readonly visitedTabs = new Set<string>();
  // visitTab 请求进行中的页签，避免连点重复上报。
  private readonly visitingTabs = new Set<string>();
  private busy = false;
  private lastLabelUpdate = 0;

  constructor() {
    super("FarmScene");
  }

  init(data: FarmSceneData): void {
    this.store = data.store;
  }

  // 动物贴图随场景预加载；失败时只记录 key，栏位回退到 emoji。
  preload(): void {
    this.load.image("animal-chicken", "/animals/chicken.png");
    this.load.image("animal-cow", "/animals/cow.png");
    this.load.on("loaderror", (file: Phaser.Loader.File) => {
      this.failedTextures.add(file.key);
    });
  }

  create(): void {
    this.configureStage();
    const resolution = stageDpr();

    this.createBackground();
    this.createFieldHead();
    this.barn = new BarnView(
      this,
      BARN,
      (kind) => ANIMAL_TEXTURES.includes(kind) && this.textures.exists(`animal-${kind}`)
        && !this.failedTextures.has(`animal-${kind}`),
      () => this.togglePanel("animals", this.animalPanel, "animals"),
    );
    this.createBarnHead();

    this.statusText = this.add
      .text(DESIGN_WIDTH / 2, DESIGN_HEIGHT / 2 - 29, "", {
        fontFamily: FONT_FAMILY.sans,
        fontSize: "31px",
        color: PALETTE.claySoft,
        backgroundColor: "#120f09ee",
        padding: { x: 18, y: 12 },
        align: "center",
      })
      .setResolution(resolution)
      .setOrigin(0.5)
      .setDepth(10)
      .setVisible(false);

    this.toastText = this.add
      .text(DESIGN_WIDTH / 2, DOCK_TOP - 29, "", {
        fontFamily: FONT_FAMILY.sans,
        fontSize: "17px",
        color: PALETTE.amberSoft,
        backgroundColor: "#120f09ee",
        padding: { x: 14, y: 7 },
      })
      .setResolution(resolution)
      .setOrigin(0.5)
      .setDepth(10)
      .setVisible(false);

    this.unsubscribe = this.store.subscribe(() => this.refresh());
    this.events.once("shutdown", () => {
      this.unsubscribe?.();
      this.unsubscribe = undefined;
      this.destroyPanels();
      this.barn?.destroy();
      this.barn = undefined;
    });

    this.machinePanel = new MachinePanel(this.store, () => this.onPanelClosed("machines"));
    this.ordersPanel = new OrdersPanel(this.store, () => this.onPanelClosed("orders"));
    this.animalPanel = new AnimalPanel(this.store, () => this.onPanelClosed("animals"));
    this.achievementsPanel = new AchievementsPanel(
      this.store,
      () => this.onPanelClosed("achievements"),
    );
    this.shopPanel = new ShopPanel(this.store, () => this.onPanelClosed("shop"));
    this.siloPanel = new SiloPanel(this.store, () => this.onPanelClosed("silo"));
    this.seedPanel = new SeedPanel(this.store);
    this.farmPanel = new FarmPanel(
      this.store,
      () => this.seedPanel?.selectedCropId ?? null,
      () => this.onPanelClosed("farm"),
    );

    this.createDock();
    // 仓库是常驻侧卡，启动时即高亮对应入口。
    this.activeDock = "silo";
    this.dock?.setActive("silo");

    this.refresh();
  }

  // 后备分辨率已是设计尺寸 ×dpr，这里把 CSS 尺寸锁死为设计尺寸，
  // 再用相机放大 dpr 倍，使世界坐标仍按 1280×720 编排并按物理像素成像。
  private configureStage(): void {
    const dpr = stageDpr();
    const canvas = this.game.canvas;
    canvas.style.width = `${DESIGN_WIDTH}px`;
    canvas.style.height = `${DESIGN_HEIGHT}px`;
    // CSS 尺寸改变后重算 displayScale，指针坐标才能映射回后备像素。
    this.scale.refresh();
    this.cameras.main
      .setZoom(dpr)
      .centerOn(DESIGN_WIDTH / 2, DESIGN_HEIGHT / 2);
  }

  // 夜色底 + 顶部琥珀径向光 + 底部土色返光，用画布纹理一次性生成。
  private createBackground(): void {
    const key = "night-farm-bg";
    if (!this.textures.exists(key)) {
      const texture = this.textures.createCanvas(key, DESIGN_WIDTH, DESIGN_HEIGHT);
      if (texture) {
        const ctx = texture.getContext();
        ctx.fillStyle = PALETTE.night0;
        ctx.fillRect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT);

        const top = ctx.createRadialGradient(DESIGN_WIDTH / 2, -40, 0, DESIGN_WIDTH / 2, -40, 800);
        top.addColorStop(0, "rgba(232, 163, 61, 0.11)");
        top.addColorStop(1, "rgba(232, 163, 61, 0)");
        ctx.fillStyle = top;
        ctx.fillRect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT);

        const bottom = ctx.createRadialGradient(DESIGN_WIDTH / 2, DESIGN_HEIGHT + 40, 0, DESIGN_WIDTH / 2, DESIGN_HEIGHT + 40, 600);
        bottom.addColorStop(0, "rgba(120, 84, 44, 0.17)");
        bottom.addColorStop(1, "rgba(120, 84, 44, 0)");
        ctx.fillStyle = bottom;
        ctx.fillRect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT);
        texture.refresh();
      }
    }
    if (this.textures.exists(key)) {
      this.add.image(0, 0, key).setOrigin(0).setDepth(-10);
    }
    this.cameras.main.setBackgroundColor(PALETTE.night0);
  }

  private createSectionTitle(x: number, y: number, text: string): Phaser.GameObjects.Text {
    const title = this.add
      .text(x, y, text, {
        fontFamily: FONT_FAMILY.serif,
        fontSize: "18px",
        fontStyle: "bold",
        color: PALETTE.ink,
      })
      .setResolution(stageDpr())
      .setOrigin(0, 0.5);
    this.add.rectangle(title.x + title.width + 14, y, 22, 1, STAGE_COLOR.amber, 0.75);
    return title;
  }

  private createFieldHead(): void {
    this.createSectionTitle(FIELD_LEFT, FIELD_HEAD_Y, "耕地");
    this.fieldMeta = this.add
      .text(FIELD_RIGHT, FIELD_HEAD_Y, "", {
        fontFamily: FONT_FAMILY.sans,
        fontSize: "14px",
        color: PALETTE.ink3,
      })
      .setResolution(stageDpr())
      .setOrigin(1, 0.5);
  }

  private createBarnHead(): void {
    this.createSectionTitle(FIELD_LEFT, BARN_HEAD_Y, "畜舍");
    this.barnMeta = this.add
      .text(BARN.right, BARN_HEAD_Y, "", {
        fontFamily: FONT_FAMILY.sans,
        fontSize: "13px",
        color: PALETTE.ink3,
      })
      .setResolution(stageDpr())
      .setOrigin(1, 0.5);
  }

  private createDock(): void {
    const entries: DockEntry[] = [
      { key: "farm", label: "农场", icon: buildingIcon("farm"), onSelect: () => this.togglePanel("farm", this.farmPanel, "farm") },
      { key: "silo", label: "仓库", icon: buildingIcon("silo"), onSelect: () => this.togglePanel("silo", this.siloPanel) },
      { key: "machines", label: "机器", icon: buildingIcon("machines"), onSelect: () => this.togglePanel("machines", this.machinePanel, "machines") },
      { key: "orders", label: "订单", icon: buildingIcon("orders"), onSelect: () => this.togglePanel("orders", this.ordersPanel, "orders") },
      { key: "animals", label: "养殖", icon: buildingIcon("animals"), onSelect: () => this.togglePanel("animals", this.animalPanel, "animals") },
      { key: "shop", label: "商店", icon: buildingIcon("shop"), onSelect: () => this.togglePanel("shop", this.shopPanel, "shop") },
      { key: "achievements", label: "成就", icon: buildingIcon("achievements"), onSelect: () => this.togglePanel("achievements", this.achievementsPanel, "deeds") },
    ];
    this.dock = new DockView(this, DESIGN_WIDTH, DOCK_TOP, DOCK_HEIGHT, entries);
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
    this.dock?.setActive(key);
    if (tab) void this.visitTabOnce(tab);
  }

  private onPanelClosed(key: string): void {
    if (this.activeDock !== key) return;
    this.activeDock = null;
    this.dock?.setActive(null);
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

  update(time: number): void {
    // 只刷新倒计时文案，避免每帧重建对象。
    if (time - this.lastLabelUpdate < 250) return;
    this.lastLabelUpdate = time;
    this.refreshLabels();
  }

  private refresh(): void {
    // 存档版本不兼容时整页只读，只显示提示，不渲染可点击地块。
    if (this.store.readonly) {
      this.clearViews();
      this.statusText.setText(reasonText(this.store.error)).setVisible(true);
      return;
    }

    const state = this.store.state;
    if (!state) {
      this.clearViews();
      this.statusText
        .setText(this.store.offline ? "后端未启动" : "加载中…")
        .setVisible(true);
      return;
    }

    this.statusText.setText("后端未启动").setVisible(this.store.offline);
    this.syncViews(state.plots.length);
    this.refreshLabels();
  }

  private syncViews(count: number): void {
    if (count === this.views.length) return;
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
      this.views.push(
        new PlotView({
          scene: this,
          index,
          x,
          y,
          width: cellWidth,
          height: CELL_HEIGHT,
          onSelect: (plotIndex) => {
            void this.handlePlot(plotIndex);
          },
        }),
      );
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
      const view = this.views[index];
      if (!view) return;
      const name = plot.cropId ? this.cropName(plot.cropId) : "";
      const stage = view.update(state, plot, now, name);
      if (stage === "empty") empty += 1;
      else if (stage === "growing") growing += 1;
      else ready += 1;
    });
    this.fieldMeta.setText(`空地 ${empty} · 生长 ${growing} · 可收 ${ready}`);

    this.barn?.update(state, this.store.rules, now);
    const animalKinds = Object.keys(this.store.rules.ANIMALS ?? {}).length;
    const readyAnimals = Object.values(state.animals ?? {}).reduce(
      (sum, group) => sum + group.list.filter((animal) => animal.readyAt > 0 && animal.readyAt <= now).length,
      0,
    );
    this.barnMeta.setText(
      readyAnimals > 0 ? `${animalKinds} 个栏位 · ${readyAnimals} 可收取` : `${animalKinds} 个栏位`,
    );

    this.dock?.setOrderBadge(deliverableOrderCount(state, this.store.rules, now));
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
    const view = this.views[index];
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
    this.toastTimer?.remove();
    this.toastText.setText(message).setVisible(true);
    this.toastTimer = this.time.delayedCall(1800, () => {
      this.toastText.setVisible(false);
    });
  }

  private clearViews(): void {
    for (const view of this.views) view.destroy();
    this.views = [];
  }
}
