import type { GameState, Order, Rules } from "../api/client";

// 展示层 view model：只做换算，不修改传入的 state。

export interface MachineJobView {
  recipeId: string;
  name: string;
  remaining: number;
  done: boolean;
}

export interface MachineView {
  // 按剩余时间升序，完成项（remaining 为 0）排在最前。
  queue: MachineJobView[];
  // 机器已建且队列还有空位。
  canAdd: boolean;
}

export interface OrderLineView {
  itemId: string;
  name: string;
  have: number;
  need: number;
  ok: boolean;
}

export interface OrderView {
  id: string;
  lines: OrderLineView[];
  coins: number;
  xp: number;
  // 所有行都满足才允许交付。
  deliverable: boolean;
  // 每日特供订单单独标记，供面板高亮。
  daily: boolean;
}

export function machineView(state: GameState, id: string, now: number, rules: Rules): MachineView {
  const machine = state.machines?.[id];
  if (!machine) return { queue: [], canAdd: false };

  const queue = [...machine.queue]
    .sort((left, right) => left.readyAt - right.readyAt)
    .map((job) => {
      const remaining = Math.max(0, job.readyAt - now);
      return {
        recipeId: job.recipeId,
        name: rules.RECIPES?.[job.recipeId]?.name ?? job.recipeId,
        remaining,
        done: remaining === 0,
      };
    });

  return {
    queue,
    canAdd: machine.unlocked && machine.queue.length < machine.queueSize,
  };
}

function toOrderView(order: Order, state: GameState, rules: Rules, daily: boolean): OrderView {
  const lines = order.lines.map((line) => {
    const have = state.silo[line.itemId] ?? 0;
    return {
      itemId: line.itemId,
      name: rules.ITEMS[line.itemId]?.name ?? line.itemId,
      have,
      need: line.quantity,
      ok: have >= line.quantity,
    };
  });

  return {
    id: order.id,
    lines,
    coins: order.coins,
    xp: order.xp,
    deliverable: lines.length > 0 && lines.every((line) => line.ok),
    daily,
  };
}

// 每日特供排在最前，其余保持服务端顺序。
export function orderView(state: GameState, _now: number, rules: Rules): OrderView[] {
  const views: OrderView[] = [];
  if (state.dailyOrder) views.push(toOrderView(state.dailyOrder, state, rules, true));
  for (const order of state.orders ?? []) views.push(toOrderView(order, state, rules, false));
  return views;
}

// 订单入口角标：只数"现在就能交付"的订单，与琥珀=当前可做一致。
export function deliverableOrderCount(state: GameState, rules: Rules, now = Date.now()): number {
  return orderView(state, now, rules).filter((order) => order.deliverable).length;
}

// 交付按钮禁用时写明原因：还差哪些物品、各差多少。
export function orderShortfall(order: OrderView): string {
  const missing = order.lines
    .filter((line) => !line.ok)
    .map((line) => `${line.name} ×${line.need - line.have}`);
  return missing.length === 0 ? "" : `还差 ${missing.join("、")}`;
}
