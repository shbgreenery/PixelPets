import { describe, expect, it, vi } from "vitest";
import type { ActionResponse, GameState, Meta, Rules, SaveSnapshot } from "../api/client";
import { EXPECTED_SAVE_VERSION, GameStore, type StoreApi } from "./store";

const rules: Rules = {
  CROPS: { wheat: { seedPrice: 1, growMs: 60_000, yield: 2 } },
  ITEMS: { wheat: { name: "小麦", sellPrice: 2, unlockLevel: 1, category: "crop" } },
  LEVELS: [0, 40, 120],
};

function makeState(coins: number): GameState {
  return { coins, gems: 0, xp: 0, plots: [], silo: {} };
}

function makeMeta(saveVersion = EXPECTED_SAVE_VERSION): Meta {
  return { rulesVersion: "1", saveVersion, rules, rev: 1, startedAt: "2026-11-23T00:00:00.000Z" };
}

interface StubOptions {
  meta?: Meta;
  save?: SaveSnapshot | null;
  action?: ActionResponse | (() => Promise<ActionResponse>);
}

// 用 stub api 隔离网络，只验证 store 的状态机。
function stubApi(options: StubOptions = {}) {
  const actionValue = options.action ?? { ok: false as const, reason: "unknown" };
  const getMeta = vi.fn(async (): Promise<Meta> => options.meta ?? makeMeta());
  const getSave = vi.fn(async (): Promise<SaveSnapshot | null> => options.save ?? null);
  const postAction = vi.fn(
    async (_type: string, _args: Record<string, unknown>, _rev: number): Promise<ActionResponse> =>
      typeof actionValue === "function" ? actionValue() : actionValue,
  );
  const api: StoreApi = { getMeta, getSave, postAction };
  return { api, getMeta, getSave, postAction };
}

describe("GameStore", () => {
  it("action 成功后替换 state 与 rev 并通知订阅者", async () => {
    const initial = makeState(10);
    const updated = makeState(9);
    const { api, postAction } = stubApi({
      save: { state: initial, rev: 3 },
      action: { ok: true, result: { planted: true }, state: updated, rev: 4 },
    });
    const store = new GameStore(api, rules);
    await store.load();
    const notified = vi.fn();
    store.subscribe(notified);

    const result = await store.action("plant", { plot: 0, cropId: "wheat" });

    expect(result).toEqual({ ok: true, result: { planted: true } });
    expect(postAction).toHaveBeenCalledWith("plant", { plot: 0, cropId: "wheat" }, 3);
    expect(store.state).toBe(updated);
    expect(store.rev).toBe(4);
    expect(notified).toHaveBeenCalledTimes(1);
  });

  it("409 时用返回状态刷新且不抛错", async () => {
    const initial = makeState(10);
    const refreshed = makeState(8);
    const { api } = stubApi({
      save: { state: initial, rev: 3 },
      action: { ok: false, reason: "stale_rev", state: refreshed, rev: 9 },
    });
    const store = new GameStore(api, rules);
    await store.load();
    const notified = vi.fn();
    store.subscribe(notified);

    const result = await store.action("plant", { plot: 1 });

    expect(result).toEqual({ ok: false, reason: "stale_rev" });
    expect(store.state).toBe(refreshed);
    expect(store.rev).toBe(9);
    expect(notified).toHaveBeenCalledTimes(1);
  });

  it("业务失败返回 reason 且状态不变", async () => {
    const initial = makeState(0);
    const { api } = stubApi({
      save: { state: initial, rev: 3 },
      action: { ok: false, reason: "no_coins" },
    });
    const store = new GameStore(api, rules);
    await store.load();
    const notified = vi.fn();
    store.subscribe(notified);

    const result = await store.action("plant", { plot: 0, cropId: "wheat" });

    expect(result).toEqual({ ok: false, reason: "no_coins" });
    expect(store.state).toBe(initial);
    expect(store.rev).toBe(3);
    expect(notified).not.toHaveBeenCalled();
  });

  it("服务端不可达时 action 返回 server_unreachable", async () => {
    const initial = makeState(10);
    const unreachable = Object.assign(new Error("server_unreachable"), {
      reason: "server_unreachable",
    });
    const { api } = stubApi({
      save: { state: initial, rev: 3 },
      action: () => Promise.reject(unreachable),
    });
    const store = new GameStore(api, rules);
    await store.load();

    const result = await store.action("harvest", { plot: 0 });

    expect(result).toEqual({ ok: false, reason: "server_unreachable" });
    expect(store.state).toBe(initial);
    expect(store.rev).toBe(3);
    expect(store.offline).toBe(true);
  });

  it("meta.saveVersion 与客户端期望版本不一致时 store 进入只读错误态", async () => {
    const { api, getSave, postAction } = stubApi({ meta: makeMeta(4) });
    const store = new GameStore(api, rules);

    await store.load();

    expect(store.readonly).toBe(true);
    expect(store.error).toBe("version_mismatch");
    expect(getSave).not.toHaveBeenCalled();

    const result = await store.action("plant", { plot: 0, cropId: "wheat" });

    expect(result).toEqual({ ok: false, reason: "version_mismatch" });
    expect(postAction).not.toHaveBeenCalled();
  });

  it("轮询带来的旧 rev 快照会被丢弃", async () => {
    const newer = makeState(9);
    const stale = makeState(11);
    const getSave = vi
      .fn()
      .mockResolvedValueOnce({ state: newer, rev: 5 })
      .mockResolvedValueOnce({ state: stale, rev: 3 });
    const api: StoreApi = {
      getMeta: vi.fn(async () => makeMeta()),
      getSave,
      postAction: vi.fn(async () => ({ ok: false as const, reason: "unused" })),
    };
    const store = new GameStore(api, rules);

    await store.load(makeMeta());
    expect(store.state).toBe(newer);
    expect(store.rev).toBe(5);

    await store.load(makeMeta());

    expect(store.state).toBe(newer);
    expect(store.rev).toBe(5);
  });

  it("rules 为空时 load 重新拉取 meta 并更新规则表", async () => {
    const emptyRules: Rules = { CROPS: {}, ITEMS: {}, LEVELS: [] };
    const getMeta = vi.fn(async () => makeMeta());
    const getSave = vi.fn(async () => ({ state: makeState(1), rev: 1 }));
    const api: StoreApi = {
      getMeta,
      getSave,
      postAction: vi.fn(async () => ({ ok: false as const, reason: "unused" })),
    };
    const store = new GameStore(api, emptyRules);

    await store.load();

    expect(getMeta).toHaveBeenCalledTimes(1);
    expect(store.rules.CROPS.wheat).toBeDefined();
    expect(store.state).not.toBeNull();

    // meta 已缓存，后续轮询不再重复拉取。
    await store.load();
    expect(getMeta).toHaveBeenCalledTimes(1);
  });
});
