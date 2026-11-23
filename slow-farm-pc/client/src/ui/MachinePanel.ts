import type { Rules } from "../api/client";
import { formatDuration, levelOf, reasonText } from "../display/format";
import { buildingIcon, itemIcon, machineIcon } from "../display/icons";
import { COLORS } from "../display/theme";
import { getStage } from "../display/stage";
import { machineView } from "../display/viewModels";
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

const DONE_STYLE = `color: ${COLORS.grass}; font-size: 12px`;

function inputText(rules: Rules, input: Record<string, number>): string {
  return Object.entries(input)
    .map(([itemId, quantity]) => `${itemIcon(itemId)}${rules.ITEMS[itemId]?.name ?? itemId}×${quantity}`)
    .join(" + ");
}

// 队列只记录配方，展示时取该配方的首个产出图标。
function recipeOutputIcon(rules: Rules, recipeId: string): string {
  const output = rules.RECIPES?.[recipeId]?.output;
  const itemId = output ? Object.keys(output)[0] : undefined;
  return itemId ? itemIcon(itemId) : "";
}

// 机器面板：九个机器的建造、队列、配方与收取入口。
export class MachinePanel {
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
    this.root.id = "machine-panel";
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
    title.textContent = `${buildingIcon("machines")} 机器`;
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

    const machines = rules.MACHINES ?? {};
    for (const [id, def] of Object.entries(machines)) {
      const section = document.createElement("div");
      section.style.cssText = SECTION_STYLE;
      this.list.append(section);

      const machine = state.machines?.[id];
      const built = machine?.unlocked === true;
      const heading = document.createElement("div");
      heading.style.cssText = ROW_STYLE;
      const name = document.createElement("span");
      name.style.cssText = NAME_STYLE;
      name.textContent = `${machineIcon(id)} ${built
        ? `${def.name} 队列 ${machine.queue.length}/${machine.queueSize}`
        : def.name}`;
      heading.append(name);

      if (!built) {
        const locked = levelOf(state.xp, rules) < def.unlockLevel;
        const build = makeButton(
          `建造（${def.buildCost} 金币）`,
          this.busy || locked,
          () => void this.run("buyMachine", { machineId: id }),
        );
        heading.append(build);
        section.append(heading);
        if (locked) {
          const hint = document.createElement("div");
          hint.style.cssText = MUTED_STYLE;
          hint.textContent = `需要等级 ${def.unlockLevel}`;
          section.append(hint);
        }
        continue;
      }

      const view = machineView(state, id, Date.now(), rules);
      const anyDone = view.queue.some((job) => job.done);
      const running = view.queue.some((job) => !job.done);
      const hourglasses = state.hourglasses ?? 0;
      heading.append(
        makeButton("加速", this.busy || !running || hourglasses < 1, () =>
          void this.run("useHourglass", { target: { kind: "machine", id } }),
        ),
        makeButton("收取", this.busy || !anyDone, () => void this.run("collectReady", { machineId: id })),
      );
      section.append(heading);

      if (view.queue.length === 0) {
        const empty = document.createElement("div");
        empty.style.cssText = MUTED_STYLE;
        empty.textContent = "队列是空的";
        section.append(empty);
      }

      for (const job of view.queue) {
        const row = document.createElement("div");
        row.style.cssText = ROW_STYLE;
        const jobName = document.createElement("span");
        jobName.style.cssText = NAME_STYLE;
        const outputIcon = recipeOutputIcon(rules, job.recipeId);
        jobName.textContent = outputIcon ? `${outputIcon} ${job.name}` : job.name;
        const status = document.createElement("span");
        status.style.cssText = job.done ? DONE_STYLE : MUTED_STYLE;
        status.textContent = job.done ? "可收取" : formatDuration(job.remaining);
        row.append(jobName, status);
        section.append(row);
      }

      for (const [recipeId, recipe] of Object.entries(rules.RECIPES ?? {})) {
        if (recipe.machine !== id) continue;
        const unlocked = state.unlockedRecipes?.[recipeId] === true;
        const row = document.createElement("div");
        row.style.cssText = ROW_STYLE;
        const info = document.createElement("span");
        info.style.cssText = NAME_STYLE;
        info.textContent = unlocked
          ? `${recipe.name}（${inputText(rules, recipe.input)}）`
          : `${recipe.name}（需 Lv.${recipe.unlockLevel}）`;
        const action = unlocked
          ? makeButton("放入", this.busy || !view.canAdd, () =>
              void this.run("enqueue", { machineId: id, recipeId }),
            )
          : makeButton("解锁", this.busy || levelOf(state.xp, rules) < recipe.unlockLevel, () =>
              void this.run("unlockRecipe", { recipeId }),
            );
        row.append(info, action);
        section.append(row);
      }

      const queueRules = rules.QUEUE;
      if (queueRules && machine.queueSize < queueRules.max) {
        const cost = queueRules.prices[machine.queueSize - queueRules.initial];
        const row = document.createElement("div");
        row.style.cssText = ROW_STYLE;
        const info = document.createElement("span");
        info.style.cssText = MUTED_STYLE;
        info.textContent = `队列容量 ${machine.queueSize}/${queueRules.max}`;
        row.append(
          info,
          makeButton(`扩建队列（${cost} 金币）`, this.busy, () =>
            void this.run("buyQueueSlot", { machineId: id }),
          ),
        );
        section.append(row);
      }
    }
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
