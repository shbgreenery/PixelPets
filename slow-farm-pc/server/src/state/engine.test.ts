import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import RULES from "../../core/slow-farm-rules.js";
import { JsonSaveRepository, SAVE_FILE } from "../store/saveRepository";
import type { GameState } from "../types";
import { GameEngine } from "./engine";

const DAY_MS = 24 * 60 * 60 * 1000;
const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "slow-farm-engine-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function makeEngine(now: () => number) {
  const dir = await makeTempDir();
  const repo = new JsonSaveRepository(dir, now);
  const engine = new GameEngine(repo, now);
  return { repo, engine };
}

describe("GameEngine", () => {
  it("初始化时无存档则创建初始状态并落盘", async () => {
    const { repo, engine } = await makeEngine(() => new Date(2026, 0, 1, 9, 0, 0).getTime());

    await engine.init();

    const snapshot = engine.snapshot();
    expect(snapshot.rev).toBe(1);
    expect(snapshot.state.coins).toBe(RULES.START.coins);
    expect(snapshot.state.plots).toHaveLength(RULES.PLOTS.initial);

    const file = await repo.load();
    expect(file).not.toBeNull();
    expect(file!.version).toBe(5);
    expect(file!.rev).toBe(1);
    expect(file!.payload).toEqual(snapshot.state);
  });

  it("plant 与 harvest 走 core 并递增 rev", async () => {
    let current = new Date(2026, 0, 1, 9, 0, 0).getTime();
    const { repo, engine } = await makeEngine(() => current);
    await engine.init();

    const plant = await engine.apply("plant", { plot: 0, cropId: "wheat" }, 1);
    expect(plant.status).toBe("ok");

    let snapshot = engine.snapshot();
    expect(snapshot.rev).toBe(2);
    expect(snapshot.state.plots[0]).toMatchObject({ cropId: "wheat" });
    // 种植扣种子费，随后任务链首环（种下第一棵小麦）发放奖励
    expect(snapshot.state.coins).toBe(
      RULES.START.coins - RULES.CROPS.wheat.seedPrice + RULES.TASKS[0].reward,
    );

    current += RULES.CROPS.wheat.growMs + 1;
    // 对外契约用 plot 表示地块下标（设计文档示例）
    const harvest = await engine.apply("harvest", { plot: 0 }, 2);
    expect(harvest.status).toBe("ok");

    snapshot = engine.snapshot();
    expect(snapshot.rev).toBe(3);
    expect(snapshot.state.silo.wheat).toBe(RULES.CROPS.wheat.yield);
    expect(snapshot.state.xp).toBe(1);
    expect((await repo.load())!.rev).toBe(3);
  });

  it("业务失败返回 business 与 core 的 reason", async () => {
    const { repo, engine } = await makeEngine(() => new Date(2026, 0, 1, 9, 0, 0).getTime());
    await engine.init();
    const before = JSON.stringify(engine.snapshot().state);

    const outcome = await engine.apply("harvest", { plot: 0 }, 1);

    expect(outcome).toEqual({ status: "business", reason: "empty_plot" });
    expect(engine.snapshot().rev).toBe(1);
    expect(JSON.stringify(engine.snapshot().state)).toBe(before);
    expect((await repo.load())!.rev).toBe(1);
  });

  it("未知动作返回 unknown，状态不变", async () => {
    const { repo, engine } = await makeEngine(() => new Date(2026, 0, 1, 9, 0, 0).getTime());
    await engine.init();
    const before = JSON.stringify(engine.snapshot().state);

    const outcome = await engine.apply("teleport" as never, {}, 1);

    expect(outcome).toEqual({ status: "unknown" });
    expect(engine.snapshot().rev).toBe(1);
    expect(JSON.stringify(engine.snapshot().state)).toBe(before);
    expect((await repo.load())!.rev).toBe(1);
  });

  it("rev 不匹配返回 stale 且不修改存档", async () => {
    let current = new Date(2026, 0, 1, 9, 0, 0).getTime();
    const { repo, engine } = await makeEngine(() => current);
    await engine.init();
    const before = JSON.stringify(engine.snapshot().state);

    const stale = await engine.apply("plant", { plot: 0, cropId: "wheat" }, 2);
    expect(stale).toEqual({ status: "stale" });
    expect(engine.snapshot().rev).toBe(1);
    expect(JSON.stringify(engine.snapshot().state)).toBe(before);
    expect((await repo.load())!.rev).toBe(1);

    expect((await engine.apply("plant", { plot: 0, cropId: "wheat" }, 1)).status).toBe("ok");
    expect(engine.snapshot().rev).toBe(2);

    const again = await engine.apply("plant", { plot: 1, cropId: "wheat" }, 1);
    expect(again).toEqual({ status: "stale" });
    expect(engine.snapshot().rev).toBe(2);
    expect((await repo.load())!.rev).toBe(2);
  });

  it("跨天后 ensureDaily 生成新订单并递增 rev", async () => {
    let current = new Date(2026, 0, 1, 9, 0, 0).getTime();
    const { repo, engine } = await makeEngine(() => current);
    await engine.init();
    const firstDayOrder = engine.snapshot().state.dailyOrder;

    current += DAY_MS;
    const changed = await engine.ensureDaily();

    expect(changed).toBe(true);
    expect(engine.snapshot().rev).toBe(2);
    expect(engine.snapshot().state.dailyDay).toBe("2026-1-2");
    expect(engine.snapshot().state.dailyOrder).not.toBeNull();
    expect(engine.snapshot().state.dailyOrder).not.toEqual(firstDayOrder);
    expect((await repo.load())!.rev).toBe(2);

    expect(await engine.ensureDaily()).toBe(false);
    expect(engine.snapshot().rev).toBe(2);
  });

  it("启动日志区分从主档、备份与新建恢复", async () => {
    const dir = await makeTempDir();
    const now = () => new Date(2026, 0, 1, 9, 0, 0).getTime();
    const repo = new JsonSaveRepository(dir, now);
    const logs: string[] = [];
    const logger = {
      info: (message: string) => logs.push(message),
      warn: (_message: string) => {},
      error: (_message: string | Error) => {},
    };

    // 首次启动：没有存档，新建初始状态。
    await new GameEngine(repo, now, logger).init();
    expect(logs.some((message) => message.includes("新建"))).toBe(true);

    // 第二次启动：从主档恢复，并在落盘时生成 .bak。
    logs.length = 0;
    await new GameEngine(repo, now, logger).init();
    expect(logs.some((message) => message.includes("从存档恢复"))).toBe(true);

    // 主档损坏后第三次启动：从备份恢复。
    await writeFile(path.join(dir, SAVE_FILE), "{ 坏 JSON", "utf8");
    logs.length = 0;
    await new GameEngine(repo, now, logger).init();
    expect(logs.some((message) => message.includes("备份"))).toBe(true);
  });

  it("动作按 ok/business/stale 各记一行日志，不含完整状态", async () => {
    let current = new Date(2026, 0, 1, 9, 0, 0).getTime();
    const dir = await makeTempDir();
    const repo = new JsonSaveRepository(dir, () => current);
    const lines: string[] = [];
    const logger = {
      info: (message: string) => lines.push(`INFO ${message}`),
      warn: (message: string) => lines.push(`WARN ${message}`),
      error: (_message: string | Error) => {},
    };
    const engine = new GameEngine(repo, () => current, logger);
    await engine.init();
    // 忽略启动期的恢复日志，只看动作日志。
    lines.length = 0;

    await engine.apply("plant", { plot: 0, cropId: "wheat" }, 1);
    await engine.apply("harvest", { plot: 1 }, 2);
    await engine.apply("plant", { plot: 1, cropId: "wheat" }, 1);

    expect(lines).toEqual([
      "INFO action=plant status=ok rev=2 reason=",
      "WARN action=harvest status=business rev=2 reason=empty_plot",
      "WARN action=plant status=stale rev=2 reason=",
    ]);
  });

  it("种玉米到做饲料再养鸡的链路可用", async () => {
    let current = new Date(2026, 0, 1, 9, 0, 0).getTime();
    const { engine } = await makeEngine(() => current);
    await engine.init();
    const rev = () => engine.snapshot().rev;

    // 注入足够等级与金币，跳过前期积累；Lv.4 可建饲料厂、解锁饲料并养鸡。
    const injected = JSON.parse(JSON.stringify(engine.snapshot().state)) as GameState;
    injected.xp = 400;
    injected.coins = 10_000;
    injected.silo = {};
    expect((await engine.importState(injected, rev())).status).toBe("ok");

    expect((await engine.apply("buyMachine", { machineId: "feedMill" }, rev())).status).toBe("ok");
    expect((await engine.apply("unlockRecipe", { recipeId: "feed" }, rev())).status).toBe("ok");

    // 种玉米并收 2 个。
    expect((await engine.apply("plant", { plot: 0, cropId: "corn" }, rev())).status).toBe("ok");
    current += RULES.CROPS.corn.growMs + 1;
    expect((await engine.apply("harvest", { plot: 0 }, rev())).status).toBe("ok");
    expect(engine.snapshot().state.silo.corn).toBe(2);

    // 再种两块小麦收 4 个。
    expect((await engine.apply("plant", { plot: 0, cropId: "wheat" }, rev())).status).toBe("ok");
    expect((await engine.apply("plant", { plot: 1, cropId: "wheat" }, rev())).status).toBe("ok");
    current += RULES.CROPS.wheat.growMs + 1;
    expect((await engine.apply("harvestAll", {}, rev())).status).toBe("ok");
    expect(engine.snapshot().state.silo.wheat).toBeGreaterThanOrEqual(2);

    // 玉米 2 + 小麦 2 做饲料。
    expect((await engine.apply("enqueue", { machineId: "feedMill", recipeId: "feed" }, rev())).status)
      .toBe("ok");
    current += RULES.RECIPES.feed.ms + 1;
    expect((await engine.apply("collectReady", { machineId: "feedMill" }, rev())).status).toBe("ok");
    expect(engine.snapshot().state.silo.feed).toBe(1);

    // 养鸡、喂饲料、收蛋。
    expect((await engine.apply("buyAnimal", { kind: "chicken" }, rev())).status).toBe("ok");
    expect((await engine.apply("feedAnimal", { kind: "chicken", index: 0 }, rev())).status).toBe("ok");
    current += RULES.ANIMALS.chicken.cycleMs + 1;
    expect((await engine.apply("collectAnimal", { kind: "chicken", index: 0 }, rev())).status).toBe("ok");
    expect(engine.snapshot().state.silo.egg).toBe(1);
  });

  it("地块扩建与地块、机器加速通过动作接口生效", async () => {
    const current = new Date(2026, 0, 1, 9, 0, 0).getTime();
    const { engine } = await makeEngine(() => current);
    await engine.init();
    const rev = () => engine.snapshot().rev;

    const injected = JSON.parse(JSON.stringify(engine.snapshot().state)) as GameState;
    injected.xp = 400;
    injected.coins = 10_000;
    injected.hourglasses = 5;
    injected.silo = { wheat: 4 };
    expect((await engine.importState(injected, rev())).status).toBe("ok");

    // 扩建地块：地块数 +1。
    const plotsBefore = engine.snapshot().state.plots.length;
    expect((await engine.apply("buyPlot", {}, rev())).status).toBe("ok");
    expect(engine.snapshot().state.plots.length).toBe(plotsBefore + 1);

    // 沙漏加速地块：立刻成熟并消耗一个沙漏。
    expect((await engine.apply("plant", { plot: 0, cropId: "wheat" }, rev())).status).toBe("ok");
    const plots = engine.snapshot().state.plots as Array<{ readyAt: number }>;
    expect(plots[0].readyAt).toBeGreaterThan(current);
    expect((await engine.apply("useHourglassOnPlots", {}, rev())).status).toBe("ok");
    expect(plots[0].readyAt).toBe(current);
    expect(engine.snapshot().state.hourglasses).toBe(4);

    // 沙漏加速机器：队列中的任务立即完成。
    expect((await engine.apply("unlockRecipe", { recipeId: "flour" }, rev())).status).toBe("ok");
    expect((await engine.apply("enqueue", { machineId: "mill", recipeId: "flour" }, rev())).status)
      .toBe("ok");
    const machine = (engine.snapshot().state.machines as Record<
      string,
      { queue: Array<{ readyAt: number }> }
    >).mill;
    expect(machine.queue[0].readyAt).toBeGreaterThan(current);
    expect(
      (await engine.apply("useHourglass", { target: { kind: "machine", id: "mill" } }, rev())).status,
    ).toBe("ok");
    expect(machine.queue[0].readyAt).toBe(current);
    expect(engine.snapshot().state.hourglasses).toBe(3);
  });

  it("批量机器动作走 core 并递增 rev", async () => {
    const { engine } = await makeEngine(() => new Date(2026, 0, 1, 9, 0, 0).getTime());
    await engine.init();

    const outcome = await engine.apply("collectAllMachines", {}, 1);

    expect(outcome.status).toBe("ok");
    expect(outcome.result).toMatchObject({ collected: 0, skipped: 0 });
    expect(engine.snapshot().rev).toBe(2);
  });
});
