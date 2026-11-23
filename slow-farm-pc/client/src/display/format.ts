import type { Rules } from "../api/client";

// 服务端 reason 的统一中文文案；与旧版 slow-farm 的 reasons 表保持可对照。
export const REASON_TEXT: Record<string, string> = {
  server_unreachable: "后端未启动",
  stale_rev: "状态已刷新，请重试",
  version_mismatch: "存档版本不兼容，已进入只读模式",
  no_state: "还没读档",
  bad_plot: "地块编号无效",
  plot_occupied: "这块地已经种了",
  unknown_crop: "没有这种作物",
  locked: "等级不够",
  empty_plot: "这块地是空的",
  not_ready: "还没成熟",
  silo_full: "仓库已满",
  unknown_machine: "没有这台机器",
  machine_locked: "机器还没建",
  queue_full: "队列已满",
  unknown_recipe: "没有这个配方",
  wrong_machine: "这个配方不属于这台机器",
  missing_input: "原料不足",
  recipe_locked: "配方还没解锁",
  max_queue: "队列位置已满",
  max_order_slots: "订单位已满",
  unknown_animal: "没有这种动物",
  stable_full: "畜舍满了",
  animal_busy: "这只动物还在产",
  unknown_order: "订单不存在",
  missing_items: "库存不足",
  bad_quantity: "数量不正确",
  no_coins: "金币不够",
  no_gems: "宝石不够",
  max_plots: "地块已满",
  already: "已经拥有",
  max_slots: "仓库格已满",
  unknown_item: "没有这种物品",
  not_enough: "库存不足",
  bad_target: "目标无效",
  no_hourglass: "没有沙漏",
  nothing_running: "没有正在进行的计时",
  ad_failed: "广告加载失败",
  file_empty: "文件是空的",
  bad_file: "这个文件不是有效的存档",
  file_version: "存档版本不兼容",
};

export function reasonText(reason: string | null | undefined): string {
  if (!reason) return "操作失败";
  return REASON_TEXT[reason] ?? "操作失败";
}

// 与服务端 core.levelOf 相同的换算：等级门槛由规则表下发。
export function levelOf(xp: number, rules: Pick<Rules, "LEVELS">): number {
  let level = 1;
  for (let i = 0; i < rules.LEVELS.length; i += 1) {
    if (xp >= rules.LEVELS[i]) level = i + 1;
  }
  return level;
}

// 当前等级内的经验进度：满级时比例固定为 1。
export interface LevelProgress {
  level: number;
  into: number;
  span: number;
  ratio: number;
}

export function levelProgress(xp: number, rules: Pick<Rules, "LEVELS">): LevelProgress {
  const level = levelOf(xp, rules);
  const base = rules.LEVELS[level - 1] ?? 0;
  const next = rules.LEVELS[level];
  if (next === undefined) return { level, into: 0, span: 0, ratio: 1 };
  const span = next - base;
  const into = Math.max(0, xp - base);
  return { level, into, span, ratio: span > 0 ? Math.min(1, into / span) : 1 };
}

export function remainingMs(readyAt: number, now: number): number {
  return Math.max(0, readyAt - now);
}

export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

// 地块倒计时向上取整，避免最后一秒显示 0:00；超过 1 小时补上小时位。
export function formatCountdown(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const secondsPart = String(seconds).padStart(2, "0");
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${secondsPart}`;
  return `${minutes}:${secondsPart}`;
}

// 种子条上的成熟时长：秒 / 分 / 时，不显示小数点。
export function formatGrowTime(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds} 秒`;
  if (totalSeconds < 3600) return `${Math.round(totalSeconds / 60)} 分`;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.round((totalSeconds % 3600) / 60);
  return minutes > 0 ? `${hours} 时 ${minutes} 分` : `${hours} 时`;
}
