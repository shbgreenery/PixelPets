import type { ActionResponse, GameState, Meta, Rules, SaveSnapshot } from "../api/client";

// 客户端期望的存档结构版本；与服务端 SAVE_VERSION 保持一致。
export const EXPECTED_SAVE_VERSION = 5;

export interface StoreApi {
  getMeta(): Promise<Meta>;
  getSave(): Promise<SaveSnapshot | null>;
  postAction(type: string, args: Record<string, unknown>, rev: number): Promise<ActionResponse>;
}

export interface ActionResult {
  ok: boolean;
  reason?: string;
  // 服务端动作的原始返回，供场景播放收获等反馈。
  result?: unknown;
}

function isUnreachable(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const record = error as { reason?: unknown; message?: unknown };
  return record.reason === "server_unreachable" || record.message === "server_unreachable";
}

// 前端状态的唯一持有者：state/rev 只在服务端响应后替换，场景与面板订阅变化。
export class GameStore {
  private currentState: GameState | null = null;
  private currentRules: Rules;
  private revision = 0;
  private errorReason: string | null = null;
  private unreachable = false;
  private lastMeta: Meta | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly api: StoreApi,
    rules: Rules,
  ) {
    this.currentRules = rules;
  }

  get rules(): Rules {
    return this.currentRules;
  }

  // 首次 meta 拉取失败后，轮询重试成功时更新规则表。
  applyRules(rules: Rules): void {
    if (this.currentRules === rules) return;
    this.currentRules = rules;
    this.notify();
  }

  get state(): GameState | null {
    return this.currentState;
  }

  get rev(): number {
    return this.revision;
  }

  // 存档版本不兼容时进入只读错误态，所有动作都被拒绝。
  get readonly(): boolean {
    return this.errorReason !== null;
  }

  get error(): string | null {
    return this.errorReason;
  }

  get offline(): boolean {
    return this.unreachable;
  }

  // meta 已由启动流程拉取时可直接传入，避免重复请求。
  async load(meta?: Meta): Promise<void> {
    let current = meta ?? this.lastMeta;
    // rules 为空说明首次 meta 没拿到；轮询时重试拉取并在成功后更新规则表。
    const missingRules = Object.keys(this.currentRules.CROPS ?? {}).length === 0;
    if (!current || missingRules) {
      try {
        current = await this.api.getMeta();
      } catch (error) {
        this.markOffline(error);
        return;
      }
      this.applyRules(current.rules);
    }
    this.lastMeta = current;

    if (current.saveVersion !== EXPECTED_SAVE_VERSION) {
      this.errorReason = "version_mismatch";
      this.notify();
      return;
    }

    try {
      const snapshot = await this.api.getSave();
      // 轮询的慢响应可能带回旧 rev，丢弃以免本地状态回退。
      if (snapshot && snapshot.rev >= this.revision) {
        this.currentState = snapshot.state;
        this.revision = snapshot.rev;
        this.unreachable = false;
        this.notify();
      }
    } catch (error) {
      this.markOffline(error);
    }
  }

  async action(type: string, args: Record<string, unknown> = {}): Promise<ActionResult> {
    if (this.errorReason !== null) {
      return { ok: false, reason: this.errorReason };
    }

    let response: ActionResponse;
    try {
      response = await this.api.postAction(type, args, this.revision);
    } catch (error) {
      if (isUnreachable(error)) {
        this.unreachable = true;
        this.notify();
        return { ok: false, reason: "server_unreachable" };
      }
      return { ok: false, reason: error instanceof Error ? error.message : "unknown_error" };
    }

    if (response.ok) {
      this.currentState = response.state;
      this.revision = response.rev;
      this.unreachable = false;
      this.notify();
      return { ok: true, result: response.result };
    }

    // 409: 服务端带回最新状态，替换本地后让用户重试。
    if (response.reason === "stale_rev" && response.state && typeof response.rev === "number") {
      this.currentState = response.state;
      this.revision = response.rev;
      this.notify();
    }

    return { ok: false, reason: response.reason };
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }

  private markOffline(error: unknown): void {
    if (!isUnreachable(error)) return;
    this.unreachable = true;
    this.notify();
  }
}
