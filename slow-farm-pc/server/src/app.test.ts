import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import RULES from "../core/slow-farm-rules.js";
import { buildApp } from "./app";
import { GameEngine } from "./state/engine";
import { JsonSaveRepository } from "./store/saveRepository";
import type { GameState } from "./types";

const FIXED_NOW = new Date(2026, 0, 1, 9, 0, 0).getTime();
const tempDirs: string[] = [];
const apps: FastifyInstance[] = [];

async function makeEngine(): Promise<GameEngine> {
  const dir = await mkdtemp(path.join(tmpdir(), "slow-farm-app-"));
  tempDirs.push(dir);
  const repo = new JsonSaveRepository(dir, () => FIXED_NOW);
  return new GameEngine(repo, () => FIXED_NOW);
}

function makeApp(engine: GameEngine): FastifyInstance {
  const app = buildApp(engine);
  apps.push(app);
  return app;
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("HTTP 接口", () => {
  it("POST /api/action 成功返回 state 与 rev", async () => {
    const engine = await makeEngine();
    await engine.init();
    const app = makeApp(engine);
    const { rev } = engine.snapshot();

    const res = await app.inject({
      method: "POST",
      url: "/api/action",
      payload: { type: "plant", args: { plot: 0, cropId: "wheat" }, rev },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.rev).toBe(rev + 1);
    expect(body.state.plots[0].cropId).toBe("wheat");
  });

  it("未知 type 返回 400", async () => {
    const engine = await makeEngine();
    await engine.init();
    const app = makeApp(engine);
    const { rev } = engine.snapshot();

    const res = await app.inject({
      method: "POST",
      url: "/api/action",
      payload: { type: "notARealAction", args: {}, rev },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().ok).toBe(false);
  });

  it("rev 过期返回 409 并携带最新 state", async () => {
    const engine = await makeEngine();
    await engine.init();
    const app = makeApp(engine);
    const { rev } = engine.snapshot();

    const res = await app.inject({
      method: "POST",
      url: "/api/action",
      payload: { type: "plant", args: { plot: 0, cropId: "wheat" }, rev: rev - 1 },
    });

    expect(res.statusCode).toBe(409);
    const body = res.json();
    expect(body.ok).toBe(false);
    expect(body.reason).toBe("stale_rev");
    expect(body.rev).toBe(rev);
    expect(body.state).toBeDefined();
  });

  it("无存档时 GET /api/save 返回 204，之后返回 200", async () => {
    const engine = await makeEngine();
    const app = makeApp(engine);

    const before = await app.inject({ method: "GET", url: "/api/save" });
    expect(before.statusCode).toBe(204);

    await engine.init();
    const after = await app.inject({ method: "GET", url: "/api/save" });
    expect(after.statusCode).toBe(200);
    expect(after.json().rev).toBe(1);
    expect(after.json().state.coins).toBe(RULES.START.coins);
  });

  it("PUT /api/save 导入状态并递增 rev", async () => {
    const engine = await makeEngine();
    await engine.init();
    const app = makeApp(engine);
    const { state, rev } = engine.snapshot();
    const imported = JSON.parse(JSON.stringify(state)) as GameState;
    imported.coins = 12345;

    const badVersion = await app.inject({
      method: "PUT",
      url: "/api/save",
      payload: { state: imported, rev, version: 4 },
    });
    expect(badVersion.statusCode).toBe(400);

    const badState = await app.inject({
      method: "PUT",
      url: "/api/save",
      payload: { state: { coins: 1 }, rev },
    });
    expect(badState.statusCode).toBe(400);

    const res = await app.inject({
      method: "PUT",
      url: "/api/save",
      payload: { state: imported, rev },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    expect(res.json().rev).toBe(rev + 1);
    expect(engine.snapshot().state.coins).toBe(12345);
  });

  it("GET /api/meta 含完整 rules 与 saveVersion=5", async () => {
    const engine = await makeEngine();
    await engine.init();
    const app = makeApp(engine);

    const res = await app.inject({ method: "GET", url: "/api/meta" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.saveVersion).toBe(5);
    expect(typeof body.rulesVersion).toBe("string");
    expect(typeof body.startedAt).toBe("string");
    expect(body.rev).toBe(1);
    expect(Object.keys(body.rules).sort()).toEqual(
      [
        "ACHIEVEMENTS",
        "ANIMALS",
        "CROPS",
        "GEMS",
        "ITEMS",
        "LEVELS",
        "MACHINES",
        "ORDERS",
        "PLOTS",
        "QUEUE",
        "RECIPES",
        "SELL_RATIO",
        "SILO",
        "START",
        "TASKS",
      ].sort(),
    );
    expect(body.rules.START).toEqual(RULES.START);

    const again = await app.inject({ method: "GET", url: "/api/meta" });
    expect(again.json().startedAt).toBe(body.startedAt);
  });

  it("DELETE /api/save 缺少 rev 返回 400", async () => {
    const engine = await makeEngine();
    await engine.init();
    const app = makeApp(engine);
    const { state, rev } = engine.snapshot();
    const imported = JSON.parse(JSON.stringify(state)) as GameState;
    imported.coins = 999;
    await app.inject({ method: "PUT", url: "/api/save", payload: { state: imported, rev } });
    const before = engine.snapshot();

    const res = await app.inject({ method: "DELETE", url: "/api/save" });

    expect(res.statusCode).toBe(400);
    expect(res.json().ok).toBe(false);
    expect(engine.snapshot().rev).toBe(before.rev);
    expect(engine.snapshot().state.coins).toBe(999);
  });

  it("DELETE /api/save rev 过期返回 409 并携带最新状态", async () => {
    const engine = await makeEngine();
    await engine.init();
    const app = makeApp(engine);
    const { rev } = engine.snapshot();

    const res = await app.inject({ method: "DELETE", url: `/api/save?rev=${rev - 1}` });

    expect(res.statusCode).toBe(409);
    const body = res.json();
    expect(body.ok).toBe(false);
    expect(body.reason).toBe("stale_rev");
    expect(body.rev).toBe(rev);
    expect(body.state).toBeDefined();
    expect(engine.snapshot().rev).toBe(rev);
  });

  it("DELETE /api/save rev 一致时重建初始状态", async () => {
    const engine = await makeEngine();
    await engine.init();
    const app = makeApp(engine);
    const { state, rev } = engine.snapshot();
    const imported = JSON.parse(JSON.stringify(state)) as GameState;
    imported.coins = 999;
    await app.inject({ method: "PUT", url: "/api/save", payload: { state: imported, rev } });
    const current = engine.snapshot().rev;

    const res = await app.inject({ method: "DELETE", url: `/api/save?rev=${current}` });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.rev).toBe(1);
    expect(body.state.coins).toBe(RULES.START.coins);
    expect(body.state.plots).toHaveLength(RULES.PLOTS.initial);

    const saved = await app.inject({ method: "GET", url: "/api/save" });
    expect(saved.json().state.coins).toBe(RULES.START.coins);
  });

  it("非法 JSON 请求体返回 400 而不是 500", async () => {
    const engine = await makeEngine();
    await engine.init();
    const app = makeApp(engine);

    const res = await app.inject({
      method: "POST",
      url: "/api/action",
      headers: { "content-type": "application/json" },
      payload: '{"type":',
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ ok: false, reason: "bad_request" });
  });

  it("全局错误处理器把请求错误写入日志", async () => {
    const engine = await makeEngine();
    await engine.init();
    const lines: string[] = [];
    const app = buildApp(engine, {
      logger: { info: () => {}, warn: () => {}, error: (message) => lines.push(String(message)) },
    });
    apps.push(app);

    const res = await app.inject({
      method: "PUT",
      url: "/api/save",
      headers: { "content-type": "application/json" },
      payload: "{bad",
    });

    expect(res.statusCode).toBe(400);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("PUT /api/save");
  });

  it("引擎抛错时不泄露堆栈，返回 500 与通用文案", async () => {
    const broken = {
      init: async () => {},
      snapshot: () => {
        throw new Error("secret stack boom");
      },
      apply: async () => ({ status: "business" }),
      ensureDaily: async () => false,
      importState: async () => ({ status: "business" }),
      reset: async () => {},
    } as unknown as GameEngine;
    const app = makeApp(broken);

    const res = await app.inject({ method: "GET", url: "/api/save" });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ ok: false, reason: "internal" });
    expect(res.body).not.toContain("secret");
    expect(res.body).not.toContain("stack");
  });
});
