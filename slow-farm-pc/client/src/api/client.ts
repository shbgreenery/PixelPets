// 与服务端 /api 通信的薄封装。网络层失败统一抛出 reason=server_unreachable 的错误，
// 业务失败仍按 200/409 的 JSON 原样返回，交由 store 决定如何处理。

export interface CropRule {
  seedPrice: number;
  growMs: number;
  yield: number;
}

export interface ItemRule {
  name: string;
  sellPrice: number;
  unlockLevel: number;
  category: string;
}

export interface MachineRule {
  name: string;
  buildCost: number;
  unlockLevel: number;
  noLadder?: boolean;
}

export interface RecipeRule {
  name: string;
  machine: string;
  input: Record<string, number>;
  ms: number;
  output: Record<string, number>;
  unlockLevel: number;
}

export interface QueueRules {
  initial: number;
  max: number;
  prices: number[];
}

export interface OrderTier {
  maxPrice: number;
  min: number;
  max: number;
}

export interface PlotRules {
  initial: number;
  max: number;
  prices: Array<{ level: number; cost: number }>;
}

export interface SiloRules {
  initial: number;
  max: number;
  prices: number[];
}

export interface OrderRules {
  initialSlots: number;
  maxSlots: number;
  slotPrices: number[];
  newbieCount: number;
  rewardCoinMul: number;
  rewardXpDivisor: number;
  tiers: OrderTier[];
}

export interface AnimalRule {
  name: string;
  nameOf: string;
  product: string;
  unlockLevel: number;
  price: number;
  cycleMs: number;
  initialSlots: number;
  maxSlots: number;
  slotPrices: number[];
}

export interface AchievementRule {
  id: string;
  name: string;
  desc: string;
  metric: string;
  goal: number;
  reward?: number;
}

export interface TaskRule {
  id: string;
  title: string;
  hint: string;
  tab: string;
  reward: number;
  check: { metric: string; goal: number };
}

export interface GemRules {
  adReward: number;
  adWaitMs: number;
  buyReward: number;
  hourglassPacks: Array<{ qty: number; cost: number }>;
}

export interface Rules {
  // 规则表由服务端下发，客户端只做展示换算，不复制数值。
  CROPS: Record<string, CropRule>;
  ITEMS: Record<string, ItemRule>;
  LEVELS: number[];
  // 机器与订单相关规则在服务端必填；测试里可省略，展示层按空表降级。
  MACHINES?: Record<string, MachineRule>;
  RECIPES?: Record<string, RecipeRule>;
  QUEUE?: QueueRules;
  ORDERS?: OrderRules;
  PLOTS?: PlotRules;
  SILO?: SiloRules;
  ANIMALS?: Record<string, AnimalRule>;
  ACHIEVEMENTS?: AchievementRule[];
  TASKS?: TaskRule[];
  GEMS?: GemRules;
  [key: string]: unknown;
}

export interface Plot {
  id: number;
  cropId: string | null;
  plantedAt: number;
  readyAt: number;
}

export interface MachineJob {
  recipeId: string;
  startedAt: number;
  readyAt: number;
}

export interface Machine {
  unlocked: boolean;
  queueSize: number;
  queue: MachineJob[];
}

export interface OrderLine {
  itemId: string;
  quantity: number;
}

export interface Order {
  id: string;
  lines: OrderLine[];
  coins: number;
  xp: number;
}

export interface Animal {
  readyAt: number;
}

export interface AnimalGroup {
  slots: number;
  list: Animal[];
}

export interface GameState {
  coins: number;
  gems: number;
  xp: number;
  plots: Plot[];
  silo: Record<string, number>;
  siloSlots?: number;
  hourglasses?: number;
  machines?: Record<string, Machine>;
  orders?: Order[];
  dailyOrder?: Order | null;
  orderSlots?: number;
  unlockedRecipes?: Record<string, boolean>;
  animals?: Record<string, AnimalGroup>;
  stats?: Record<string, number>;
  achievements?: Record<string, boolean>;
  taskIndex?: number;
  tabsSeen?: Record<string, boolean>;
  [key: string]: unknown;
}

export interface Meta {
  rulesVersion: string;
  saveVersion: number;
  rules: Rules;
  rev: number;
  startedAt: string;
}

export interface SaveSnapshot {
  state: GameState;
  rev: number;
}

// 成功 200、业务失败 200、rev 冲突 409 共用同一形状。
export type ActionResponse =
  | { ok: true; result: unknown; state: GameState; rev: number }
  | { ok: false; reason: string; state?: GameState; rev?: number };

export interface Api {
  getMeta(): Promise<Meta>;
  getSave(): Promise<SaveSnapshot | null>;
  postAction(type: string, args: Record<string, unknown>, rev: number): Promise<ActionResponse>;
}

const SERVER_UNREACHABLE = "server_unreachable";

function unreachableError(): Error & { reason: string } {
  return Object.assign(new Error(SERVER_UNREACHABLE), { reason: SERVER_UNREACHABLE });
}

// 后端未启动时 Vite 代理返回 502/503/504，与 fetch 直接失败一样视为不可达。
function isGatewayError(status: number): boolean {
  return status === 502 || status === 503 || status === 504;
}

async function request(path: string, init?: RequestInit): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch {
    throw unreachableError();
  }
  if (isGatewayError(response.status)) throw unreachableError();
  return response;
}

export async function getMeta(): Promise<Meta> {
  const response = await request("/api/meta");
  if (!response.ok) throw new Error(`meta_http_${response.status}`);
  return (await response.json()) as Meta;
}

export async function getSave(): Promise<SaveSnapshot | null> {
  const response = await request("/api/save");
  if (response.status === 204) return null;
  if (!response.ok) throw new Error(`save_http_${response.status}`);
  return (await response.json()) as SaveSnapshot;
}

export async function postAction(
  type: string,
  args: Record<string, unknown>,
  rev: number,
): Promise<ActionResponse> {
  const response = await request("/api/action", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type, args, rev }),
  });
  return (await response.json()) as ActionResponse;
}

export const api: Api = { getMeta, getSave, postAction };
