import core from "../../core/slow-farm-core.js";
import RULES from "../../core/slow-farm-rules.js";
import type { Logger } from "../logging";
import { isGameState, SAVE_VERSION, type GameState, type SaveRepository } from "../types";

export { isGameState, SAVE_VERSION };

// 服务端动作白名单：客户端只能通过这些动作修改状态。
export const ACTION_TYPES = [
  "plant",
  "harvest",
  "plantAll",
  "harvestAll",
  "enqueue",
  "collectReady",
  "unlockRecipe",
  "buyQueueSlot",
  "deliverOrder",
  "abandonOrder",
  "buyOrderSlot",
  "buyPlot",
  "buyMachine",
  "buySiloSlot",
  "sellItem",
  "buyAnimal",
  "feedAnimal",
  "collectAnimal",
  "feedAll",
  "collectAll",
  "buyStableSlot",
  "buyHourglass",
  "useHourglass",
  "useHourglassOnPlots",
  "useHourglassOnAnimals",
  "visitTab",
  "buyGems",
  "grantAdGems",
  "grantPaidGems",
  "collectAllMachines",
  "enqueueAll",
  "useHourglassOnMachines",
] as const;

export type ActionType = (typeof ACTION_TYPES)[number];

export interface ApplyOutcome {
  status: "ok" | "business" | "stale" | "unknown";
  result?: unknown;
  reason?: string;
}

type CoreResult = { ok: boolean; reason?: string; [key: string]: unknown };
type ActionHandler = (state: GameState, args: Record<string, unknown>, now: number) => CoreResult;

// 对外契约统一用 `plot` 表示地块下标（与设计文档示例一致），引擎内部映射到 core 的 plotIndex。
// 其余参数名与 core 形参一致：cropId、machineId、recipeId、orderId、kind、index、itemId、quantity、target、tab。
const handlers: Record<ActionType, ActionHandler> = {
  plant: (state, args, now) => core.plant(state, args.plot, args.cropId, now, RULES),
  harvest: (state, args, now) => core.harvest(state, args.plot, now, RULES),
  plantAll: (state, args, now) => core.plantAll(state, args.cropId, now, RULES),
  harvestAll: (state, args, now) => core.harvestAll(state, now, RULES),
  enqueue: (state, args, now) => core.enqueue(state, args.machineId, args.recipeId, now, RULES),
  collectReady: (state, args, now) => core.collectReady(state, args.machineId, now, RULES),
  unlockRecipe: (state, args) => core.unlockRecipe(state, args.recipeId, RULES),
  buyQueueSlot: (state, args) => core.buyQueueSlot(state, args.machineId, RULES),
  deliverOrder: (state, args) => core.deliverOrder(state, args.orderId, RULES, Math.random),
  abandonOrder: (state, args) => core.abandonOrder(state, args.orderId, RULES, Math.random),
  buyOrderSlot: (state) => core.buyOrderSlot(state, RULES, Math.random),
  buyPlot: (state) => core.buyPlot(state, RULES),
  buyMachine: (state, args) => core.buyMachine(state, args.machineId, RULES),
  buySiloSlot: (state) => core.buySiloSlot(state, RULES),
  sellItem: (state, args) => core.sellItem(state, args.itemId, args.quantity, RULES),
  buyAnimal: (state, args) => core.buyAnimal(state, args.kind, RULES),
  feedAnimal: (state, args, now) => core.feedAnimal(state, args.kind, args.index, now, RULES),
  collectAnimal: (state, args, now) => core.collectAnimal(state, args.kind, args.index, now, RULES),
  feedAll: (state, args, now) => core.feedAll(state, args.kind, now, RULES),
  collectAll: (state, args, now) => core.collectAll(state, args.kind, now, RULES),
  buyStableSlot: (state, args) => core.buyStableSlot(state, args.kind, RULES),
  buyHourglass: (state, args) => core.buyHourglass(state, args.quantity, RULES),
  useHourglass: (state, args, now) => core.useHourglass(state, args.target, now, RULES),
  useHourglassOnPlots: (state, _args, now) => core.useHourglassOnPlots(state, now, RULES),
  useHourglassOnAnimals: (state, args, now) => core.useHourglassOnAnimals(state, args.kind, now, RULES),
  collectAllMachines: (state, _args, now) => core.collectAllMachines(state, now, RULES),
  enqueueAll: (state, _args, now) => core.enqueueAll(state, now, RULES),
  useHourglassOnMachines: (state, _args, now) => core.useHourglassOnMachines(state, now, RULES),
  visitTab: (state, args) => ({ ok: true, tasks: core.visitTab(state, args.tab, RULES) }),
  buyGems: (state) => core.grantPaidGems(state, RULES),
  grantAdGems: (state) => core.grantAdGems(state, RULES),
  grantPaidGems: (state) => core.grantPaidGems(state, RULES),
};

export class GameEngine {
  private state: GameState | null = null;
  private rev = 0;

  constructor(
    private readonly repo: SaveRepository,
    private readonly now: () => number = Date.now,
    private readonly logger?: Logger,
  ) {}

  async init(): Promise<void> {
    const { file, source } = await this.repo.loadWithSource();
    if (file && isGameState(file.payload)) {
      this.state = core.hydrate(file.payload, RULES, Math.random);
      this.rev = Number.isInteger(file.rev) && file.rev > 0 ? file.rev : 1;
      this.logger?.info(
        source === "bak"
          ? `主存档不可用，已从备份 .bak 恢复（rev ${this.rev}）`
          : `已从存档恢复（rev ${this.rev}）`,
      );
    } else {
      this.state = core.createState(RULES, Math.random);
      this.rev = 1;
      this.logger?.info("没有可用存档，已新建初始状态");
    }
    // 启动时补发每日订单：这样首次 apply 的 ensureDaily 不会因为跨天而把 rev 推高。
    core.ensureDailyOrder(this.state, RULES, Math.random, this.now());
    await this.persist();
  }

  snapshot(): { state: GameState; rev: number } {
    if (!this.state) throw new Error("引擎尚未初始化");
    return { state: this.state, rev: this.rev };
  }

  async apply(type: ActionType, args: Record<string, unknown>, rev: number): Promise<ApplyOutcome> {
    await this.ensureDaily();
    const state = this.state;
    if (!state) throw new Error("引擎尚未初始化");
    if (rev !== this.rev) {
      this.logger?.warn(`action=${type} status=stale rev=${this.rev} reason=`);
      return { status: "stale" };
    }
    if (!Object.prototype.hasOwnProperty.call(handlers, type)) return { status: "unknown" };

    const result = handlers[type](state, args, this.now());
    if (!result || result.ok !== true) {
      this.logger?.warn(
        `action=${type} status=business rev=${this.rev} reason=${result?.reason ?? ""}`,
      );
      return { status: "business", reason: result?.reason };
    }

    core.evaluateAchievements(state, RULES);
    core.evaluateTasks(state, RULES);
    this.rev += 1;
    await this.persist();
    this.logger?.info(`action=${type} status=ok rev=${this.rev} reason=`);
    return { status: "ok", result };
  }

  async ensureDaily(): Promise<boolean> {
    const state = this.state;
    if (!state) return false;
    if (!core.ensureDailyOrder(state, RULES, Math.random, this.now())) return false;

    this.rev += 1;
    await this.persist();
    return true;
  }

  async importState(state: GameState, rev: number): Promise<ApplyOutcome> {
    if (!this.state) throw new Error("引擎尚未初始化");
    if (rev !== this.rev) return { status: "stale" };
    if (!isGameState(state)) return { status: "business", reason: "bad_file" };

    this.state = core.hydrate(state, RULES, Math.random);
    core.ensureDailyOrder(this.state, RULES, Math.random, this.now());
    this.rev += 1;
    await this.persist();
    return { status: "ok" };
  }

  async reset(): Promise<void> {
    this.state = core.createState(RULES, Math.random);
    core.ensureDailyOrder(this.state, RULES, Math.random, this.now());
    this.rev = 1;
    await this.persist();
  }

  private async persist(): Promise<void> {
    const state = this.state;
    if (!state) return;

    const now = this.now();
    state.lastSeenAt = now;
    await this.repo.save({
      version: SAVE_VERSION,
      rev: this.rev,
      savedAt: new Date(now).toISOString(),
      payload: state,
    });
  }
}
