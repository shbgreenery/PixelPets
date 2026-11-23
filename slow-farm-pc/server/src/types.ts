export interface OrderLine {
  itemId: string;
  quantity: number;
}

export interface DailyOrder {
  id: string;
  lines: OrderLine[];
  coins: number;
  xp: number;
}

export type GameState = {
  coins: number;
  gems: number;
  xp: number;
  plots: unknown[];
  silo: Record<string, number>;
  siloSlots: number;
  machines: Record<string, unknown>;
  unlockedRecipes: Record<string, boolean>;
  animals: Record<string, unknown>;
  hourglasses: number;
  orders: unknown[];
  orderSlots: number;
  orderSeq: number;
  ordersGenerated: number;
  lastSeenAt: number;
  dailyDay: string;
  dailyOrder: DailyOrder | null;
  stats: Record<string, number>;
  achievements: Record<string, boolean>;
  taskIndex: number;
  tabsSeen: Record<string, boolean>;
};

export interface SaveFile {
  version: number;
  rev: number;
  savedAt: string;
  payload: GameState;
}

// 存档结构版本，与旧版 slow-farm-store.js 的 SAVE_VERSION 对齐。
export const SAVE_VERSION = 5;

export type SaveSource = "save" | "bak";

export interface LoadResult {
  file: SaveFile | null;
  source: SaveSource | null;
}

export interface SaveRepository {
  load(): Promise<SaveFile | null>;
  // 同时返回来源（主档 / 备份），供启动日志区分恢复路径。
  loadWithSource(): Promise<LoadResult>;
  save(file: SaveFile): Promise<void>;
  clear(): Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// 只校验结构而不是版本号：GameState 本身不带 version，版本由 SaveFile 承载。
export function isGameState(value: unknown): value is GameState {
  if (!isRecord(value)) return false;
  return (
    Number.isFinite(value.coins)
    && Number.isFinite(value.gems)
    && Number.isFinite(value.xp)
    && Array.isArray(value.plots)
    && isRecord(value.silo)
    && Number.isInteger(value.siloSlots)
    && isRecord(value.machines)
    && isRecord(value.animals)
    && Array.isArray(value.orders)
    && Number.isInteger(value.orderSlots)
    && Number.isInteger(value.orderSeq)
    && Number.isInteger(value.ordersGenerated)
    && Number.isInteger(value.lastSeenAt)
    && (typeof value.dailyDay === "string")
    && (value.dailyOrder === null || isRecord(value.dailyOrder))
    && isRecord(value.stats)
    && Number.isInteger(value.taskIndex)
    && isRecord(value.unlockedRecipes)
    && isRecord(value.achievements)
    && isRecord(value.tabsSeen)
  );
}
