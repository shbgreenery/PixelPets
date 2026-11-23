import { achievementView, taskView } from "../display/achievementView";
import { buildingIcon } from "../display/icons";
import { COLORS } from "../display/theme";
import { getStage } from "../display/stage";
import type { GameStore } from "../state/store";
import {
  HEADER_STYLE,
  makeButton,
  MUTED_STYLE,
  NAME_STYLE,
  OVERLAY_CARD_STYLE,
  OVERLAY_STYLE,
  ROW_STYLE,
  SCROLL_CLASS,
  TITLE_STYLE,
} from "./panelStyles";

const SECTION_TITLE_STYLE = `margin: 12px 0 6px; font-size: 15px; font-weight: 600; color: ${COLORS.amberSoft}`;
const DONE_STYLE = `color: ${COLORS.grass}; font-size: 12px`;
const CURRENT_STYLE = `color: ${COLORS.amberSoft}; font-size: 12px`;

// 成就面板：任务链与成就只读展示，结算由服务端在每次动作后完成。
export class AchievementsPanel {
  private readonly root: HTMLDivElement;
  private readonly list: HTMLDivElement;
  private readonly unsubscribe: () => void;

  constructor(
    private readonly store: GameStore,
    private readonly onClose?: () => void,
  ) {
    this.root = document.createElement("div");
    this.root.id = "achievements-panel";
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
    title.textContent = `${buildingIcon("achievements")} 成就`;
    title.style.cssText = TITLE_STYLE;
    header.append(title, makeButton("关闭", false, () => this.close()));

    this.list = document.createElement("div");
    card.append(header, this.list);
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

    const tasks = taskView(state, rules);
    if (tasks.length > 0) {
      const heading = document.createElement("div");
      heading.style.cssText = SECTION_TITLE_STYLE;
      const current = tasks.find((task) => task.current);
      heading.textContent = current ? `任务链 · 当前：${current.title}` : "任务链 · 已全部完成";
      this.list.append(heading);

      for (const task of tasks) {
        const row = document.createElement("div");
        row.style.cssText = ROW_STYLE;
        const name = document.createElement("span");
        name.style.cssText = NAME_STYLE;
        name.textContent = task.title;
        const status = document.createElement("span");
        if (task.done) {
          status.style.cssText = DONE_STYLE;
          status.textContent = `已完成 · +${task.reward}`;
        } else if (task.current) {
          status.style.cssText = CURRENT_STYLE;
          status.textContent = `${task.progress}/${task.goal} · +${task.reward}`;
        } else {
          status.style.cssText = MUTED_STYLE;
          status.textContent = "未解锁";
        }
        row.append(name, status);
        this.list.append(row);
      }
    }

    const achievements = achievementView(state, rules);
    const done = achievements.filter((achievement) => achievement.done).length;
    const heading = document.createElement("div");
    heading.style.cssText = SECTION_TITLE_STYLE;
    heading.textContent = `成就 ${done} / ${achievements.length}`;
    this.list.append(heading);

    for (const achievement of achievements) {
      const row = document.createElement("div");
      row.style.cssText = ROW_STYLE;
      const name = document.createElement("span");
      name.style.cssText = NAME_STYLE;
      name.textContent = achievement.title;
      const desc = document.createElement("span");
      desc.style.cssText = MUTED_STYLE;
      desc.textContent = achievement.desc;
      const progress = document.createElement("span");
      progress.style.cssText = achievement.done ? DONE_STYLE : MUTED_STYLE;
      progress.textContent = achievement.done
        ? `已达成 · +${achievement.reward}`
        : `${achievement.progress}/${achievement.goal}`;
      row.append(name, desc, progress);
      this.list.append(row);
    }
  }

  destroy(): void {
    this.unsubscribe();
    this.root.remove();
  }
}
