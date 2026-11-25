import type { GameState, Rules } from "../api/client";
import { formatDuration, levelOf, reasonText } from "../display/format";
import { buildingIcon, itemIcon, machineIcon } from "../display/icons";
import {
  firstSelectable,
  groupMachines,
  machineEntries,
  type MachineEntry,
  type MachineGroup,
  type MachineGroupKey,
} from "../display/machineStatus";
import { getStage } from "../display/stage";
import { COLORS } from "../display/theme";
import { machineView, recipeShortfall } from "../display/viewModels";
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
  SIDE_GROUP_TITLE_STYLE,
  SIDE_ITEM_ACTIVE,
  SIDE_ITEM_STYLE,
  SIDE_LIST_STYLE,
  SPLIT_BODY_STYLE,
  SPLIT_CARD_STYLE,
  TITLE_STYLE,
} from "./panelStyles";

const SIDE_META_STYLE = `font-size: 10.5px; color: ${COLORS.muted}; flex: none`;
const DONE_STYLE = `color: ${COLORS.grass}; font-size: 12px`;
const SHORTFALL_STYLE = `width: 100%; font-size: 11px; color: ${COLORS.clay}`;

function inputText(rules: Rules, input: Record<string, number>): string {
  return Object.entries(input)
    .map(([itemId, quantity]) => `${itemIcon(itemId)}${rules.ITEMS[itemId]?.name ?? itemId}×${quantity}`)
    .join(" + ");
}

// 机器面板：左侧状态分组索引 + 右侧单台机器操作台。
// 选中项与分组折叠状态存在实例上，抵抗每 5 秒轮询触发的全量重渲染。
export class MachinePanel {
  private readonly root: HTMLDivElement;
  private readonly sideList: HTMLDivElement;
  private readonly detail: HTMLDivElement;
  private readonly quickBar: HTMLDivElement;
  private readonly note: HTMLDivElement;
  private readonly unsubscribe: () => void;
  private selectedId: string | null = null;
  private readonly collapsedGroups = new Set<MachineGroupKey>();
  private busy = false;

  constructor(
    private readonly store: GameStore,
    private readonly onClose?: () => void,
  ) {
    this.root = document.createElement("div");
    this.root.id = "machine-panel";
    this.root.style.cssText = OVERLAY_STYLE;
    this.root.addEventListener("click", (event) => {
      if (event.target === this.root) this.close();
    });

    const card = document.createElement("div");
    card.style.cssText = SPLIT_CARD_STYLE;

    const header = document.createElement("div");
    header.style.cssText = HEADER_STYLE;
    const title = document.createElement("div");
    title.textContent = `${buildingIcon("machines")} 机器`;
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

  private render(): void {
    // 轮询会全量重建，滚动位置必须手动保存与恢复，否则长列表每 5 秒跳回顶部。
    const sideScroll = this.sideList.scrollTop;
    const detailScroll = this.detailScrollTop();

    const state = this.store.state;
    if (!state) {
      this.sideList.replaceChildren();
      this.detail.replaceChildren();
      const empty = document.createElement("div");
      empty.textContent = "加载中…";
      empty.style.cssText = MUTED_STYLE;
      this.detail.append(empty);
      return;
    }

    const now = Date.now();
    const entries = machineEntries(state, now, this.store.rules);
    const groups = groupMachines(entries);
    if (!this.selectedId || !entries.some((entry) => entry.id === this.selectedId)) {
      this.selectedId = firstSelectable(groups);
    }

    this.renderQuickBar(entries, state);
    this.renderSide(groups, now, levelOf(state.xp, this.store.rules));
    this.renderDetail(entries, now);

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

  private renderQuickBar(entries: MachineEntry[], state: GameState): void {
    this.quickBar.replaceChildren();
    const readyTotal = entries.reduce((sum, entry) => sum + entry.readyCount, 0);
    const addableCount = entries.filter((entry) => entry.status === "addable").length;
    const hourglasses = state.hourglasses ?? 0;
    const hasUnfinished = entries.some((entry) => entry.readyCount < entry.queueLength);

    const spacer = document.createElement("span");
    spacer.style.cssText = "flex: 1 1 auto";
    const hourglass = document.createElement("span");
    hourglass.style.cssText = MUTED_STYLE;
    hourglass.textContent = `沙漏 ${hourglasses}`;

    this.quickBar.append(
      makeButton(`一键收取 ${readyTotal}`, this.busy || readyTotal === 0, () => {
        void this.run("collectAllMachines", {});
      }),
      makeButton(`一键加料 ${addableCount}`, this.busy || addableCount === 0, () => {
        void this.run("enqueueAll", {});
      }),
      makeButton("一键加速", this.busy || hourglasses < 1 || !hasUnfinished, () => {
        void this.run("useHourglassOnMachines", {});
      }),
      spacer,
      hourglass,
    );
  }

  private renderSide(groups: MachineGroup[], now: number, level: number): void {
    this.sideList.replaceChildren();
    for (const group of groups) {
      if (group.entries.length === 0) continue;

      const section = document.createElement("div");
      section.className = "sf-side-group";

      const title = document.createElement("div");
      title.className = "sf-side-group-title";
      title.style.cssText = SIDE_GROUP_TITLE_STYLE;
      title.textContent = `${group.title} ${group.entries.length}`;
      title.addEventListener("click", () => this.toggleGroup(group.key));
      section.append(title);

      if (!this.collapsedGroups.has(group.key)) {
        for (const entry of group.entries) section.append(this.buildSideItem(entry, now, level));
      }
      this.sideList.append(section);
    }
  }

  private buildSideItem(entry: MachineEntry, now: number, level: number): HTMLButtonElement {
    const active = entry.id === this.selectedId;
    const locked = entry.status === "unbuilt" && level < entry.unlockLevel;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "sf-side-item";
    button.dataset.machineId = entry.id;
    button.dataset.selected = active ? "true" : "false";
    button.dataset.locked = locked ? "true" : "false";
    button.style.cssText = [
      SIDE_ITEM_STYLE,
      active ? SIDE_ITEM_ACTIVE : "",
      locked ? `color: ${COLORS.muted}; opacity: 0.72` : "",
    ].filter(Boolean).join(";");

    const icon = document.createElement("span");
    icon.style.cssText = "flex: none; font-size: 14px; line-height: 1";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = machineIcon(entry.id);

    const name = document.createElement("span");
    name.style.cssText = "flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap";
    name.textContent = entry.name;

    const meta = document.createElement("span");
    meta.style.cssText = SIDE_META_STYLE;
    meta.textContent = this.sideMeta(entry, now, level);

    button.append(icon, name, meta);
    button.addEventListener("click", () => {
      this.selectedId = entry.id;
      this.render();
    });
    return button;
  }

  private sideMeta(entry: MachineEntry, now: number, level: number): string {
    if (entry.status === "collectable") return `×${entry.readyCount}`;
    if (entry.status === "addable") return `队列 ${entry.queueLength}/${entry.queueSize}`;
    if (entry.status === "running") {
      const queue = this.store.state?.machines?.[entry.id]?.queue ?? [];
      const upcoming = queue.filter((job) => job.readyAt > now).map((job) => job.readyAt);
      const earliest = upcoming.length > 0 ? Math.min(...upcoming) : 0;
      return earliest > 0 ? formatDuration(earliest - now) : "";
    }
    if (entry.status === "idle") return "空闲";
    if (level < entry.unlockLevel) return `Lv.${entry.unlockLevel}`;
    const cost = this.store.rules.MACHINES?.[entry.id]?.buildCost ?? 0;
    return `建造 ${cost}`;
  }

  private toggleGroup(key: MachineGroupKey): void {
    if (this.collapsedGroups.has(key)) this.collapsedGroups.delete(key);
    else this.collapsedGroups.add(key);
    this.render();
  }

  private renderDetail(entries: MachineEntry[], now: number): void {
    this.detail.replaceChildren();
    const entry = entries.find((candidate) => candidate.id === this.selectedId);
    this.detail.dataset.detailId = entry?.id ?? "";

    if (!entry) {
      const empty = document.createElement("div");
      empty.textContent = "没有可用的机器";
      empty.style.cssText = MUTED_STYLE;
      this.detail.append(empty);
      return;
    }

    const state = this.store.state;
    const rules = this.store.rules;
    if (!state) return;

    const header = document.createElement("div");
    header.style.cssText = `${ROW_STYLE}; flex: none`;
    const name = document.createElement("span");
    name.style.cssText = NAME_STYLE;
    name.textContent = `${machineIcon(entry.id)} ${entry.name}`;
    header.append(name);

    if (!entry.built) {
      this.renderUnbuilt(header, entry, state);
      this.detail.append(header);
      return;
    }

    const view = machineView(state, entry.id, now, rules);
    const hourglasses = state.hourglasses ?? 0;
    const hasRunning = view.queue.some((job) => !job.done);
    const meta = document.createElement("span");
    meta.style.cssText = MUTED_STYLE;
    meta.textContent = `队列 ${entry.queueLength}/${entry.queueSize}`;
    header.append(
      meta,
      makeButton("加速", this.busy || !hasRunning || hourglasses < 1, () => {
        void this.run("useHourglass", { target: { kind: "machine", id: entry.id } });
      }),
      makeButton("收取", this.busy || entry.readyCount === 0, () => {
        void this.run("collectReady", { machineId: entry.id });
      }),
    );

    const scroll = document.createElement("div");
    scroll.className = "sf-detail-scroll";
    scroll.style.cssText = DETAIL_SCROLL_STYLE;
    scroll.classList.add(SCROLL_CLASS);

    if (view.queue.length === 0) {
      const empty = document.createElement("div");
      empty.style.cssText = MUTED_STYLE;
      empty.textContent = "队列是空的";
      scroll.append(empty);
    }

    for (const job of view.queue) {
      const row = document.createElement("div");
      row.style.cssText = ROW_STYLE;
      const jobName = document.createElement("span");
      jobName.style.cssText = NAME_STYLE;
      jobName.textContent = job.name;
      const status = document.createElement("span");
      status.style.cssText = job.done ? DONE_STYLE : MUTED_STYLE;
      status.textContent = job.done ? "可收取" : formatDuration(job.remaining);
      row.append(jobName, status);
      scroll.append(row);
    }

    for (const [recipeId, recipe] of Object.entries(rules.RECIPES ?? {})) {
      if (recipe.machine !== entry.id) continue;
      scroll.append(this.buildRecipeRow(entry, recipeId, state));
    }

    const footer = document.createElement("div");
    footer.style.cssText = `${ROW_STYLE}; flex: none`;
    const queueRules = rules.QUEUE;
    if (queueRules && entry.queueSize < queueRules.max) {
      const cost = queueRules.prices[entry.queueSize - queueRules.initial];
      const info = document.createElement("span");
      info.style.cssText = MUTED_STYLE;
      info.textContent = `队列容量 ${entry.queueSize}/${queueRules.max}`;
      footer.append(
        info,
        makeButton(`扩建队列（${cost} 金币）`, this.busy || state.coins < cost, () => {
          void this.run("buyQueueSlot", { machineId: entry.id });
        }),
      );
    }

    this.detail.append(header, scroll, footer);
  }

  private renderUnbuilt(header: HTMLDivElement, entry: MachineEntry, state: GameState): void {
    const rules = this.store.rules;
    const def = rules.MACHINES?.[entry.id];
    const cost = def?.buildCost ?? 0;
    const level = levelOf(state.xp, rules);
    const locked = level < entry.unlockLevel;

    const info = document.createElement("span");
    info.style.cssText = MUTED_STYLE;
    info.textContent = locked ? `需要等级 ${entry.unlockLevel}` : `建造费用 ${cost} 金币`;
    header.append(
      info,
      makeButton(
        `建造（${cost} 金币）`,
        this.busy || locked || state.coins < cost,
        () => { void this.run("buyMachine", { machineId: entry.id }); },
        "primary",
      ),
    );
  }

  private buildRecipeRow(entry: MachineEntry, recipeId: string, state: GameState): HTMLDivElement {
    const rules = this.store.rules;
    const recipe = rules.RECIPES?.[recipeId];
    const row = document.createElement("div");
    row.style.cssText = ROW_STYLE;

    const info = document.createElement("span");
    info.style.cssText = NAME_STYLE;

    if (!recipe) return row;

    const unlocked = state.unlockedRecipes?.[recipeId] === true;
    if (!unlocked) {
      info.textContent = `${recipe.name}（需 Lv.${recipe.unlockLevel}）`;
      row.append(
        info,
        makeButton("解锁", this.busy || levelOf(state.xp, rules) < recipe.unlockLevel, () => {
          void this.run("unlockRecipe", { recipeId });
        }),
      );
      return row;
    }

    info.textContent = `${recipe.name}（${inputText(rules, recipe.input)}）`;
    const queueFull = entry.queueLength >= entry.queueSize;
    const shortfall = queueFull ? "队列已满" : recipeShortfall(state, recipeId, rules);
    row.append(
      info,
      makeButton("放入", this.busy || shortfall !== "", () => {
        void this.run("enqueue", { machineId: entry.id, recipeId });
      }),
    );
    if (shortfall) {
      const hint = document.createElement("span");
      hint.style.cssText = SHORTFALL_STYLE;
      hint.textContent = shortfall;
      row.append(hint);
    }
    return row;
  }

  private async run(type: string, args: Record<string, unknown>): Promise<void> {
    if (this.busy) return;
    const previousGroup = this.currentGroupKey();
    this.busy = true;
    this.note.textContent = "";
    try {
      const result = await this.store.action(type, args);
      if (!result.ok) {
        this.note.textContent = reasonText(result.reason);
        return;
      }
      this.applyBatchFeedback(type, result.result);
      this.ensureSelectionAfterAction(previousGroup);
    } finally {
      this.busy = false;
      this.render();
    }
  }

  // 动作前选中项所在的分组；动作后用它判断是否需要跳转。
  private currentGroupKey(): MachineGroupKey | null {
    const state = this.store.state;
    if (!state || !this.selectedId) return null;
    const groups = groupMachines(machineEntries(state, Date.now(), this.store.rules));
    return groups.find((group) => group.entries.some((entry) => entry.id === this.selectedId))?.key ?? null;
  }

  // 动作后只要原选中机器还在状态里就保持视角；只有它真的消失（规则表变化）才跳转。
  private ensureSelectionAfterAction(previousGroup: MachineGroupKey | null): void {
    const state = this.store.state;
    if (!state) return;
    const entries = machineEntries(state, Date.now(), this.store.rules);
    if (entries.some((entry) => entry.id === this.selectedId)) return;

    const groups = groupMachines(entries);
    const group = groups.find((candidate) => candidate.key === previousGroup);
    this.selectedId = group?.entries[0]?.id ?? firstSelectable(groups);
  }

  // 批量动作的结果提示；单机动作由右侧详情的具体状态表达，不占用提示条。
  private applyBatchFeedback(type: string, raw: unknown): void {
    if (
      type !== "collectAllMachines"
      && type !== "enqueueAll"
      && type !== "useHourglassOnMachines"
    ) {
      return;
    }
    const result = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;

    if (type === "collectAllMachines") {
      const collected = typeof result.collected === "number" ? result.collected : 0;
      const skipped = typeof result.skipped === "number" ? result.skipped : 0;
      this.note.textContent = skipped > 0
        ? `已收取 ${collected} 份 · ${skipped} 份仓库已满`
        : collected > 0 ? `已收取 ${collected} 份` : "";
      return;
    }
    if (type === "enqueueAll") {
      const queued = typeof result.queued === "number" ? result.queued : 0;
      this.note.textContent = queued > 0 ? `已加料 ${queued} 份` : "";
      return;
    }
    this.note.textContent = result.stopped === "no_hourglass" ? reasonText("no_hourglass") : "";
  }

  destroy(): void {
    this.unsubscribe();
    this.root.remove();
  }
}
