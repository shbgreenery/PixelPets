import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { GameState, SaveFile } from "../types";
import { JsonSaveRepository, SAVE_FILE } from "./saveRepository";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "slow-farm-save-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function makeState(rev: number): GameState {
  return {
    coins: rev * 100,
    gems: rev,
    xp: rev * 10,
    plots: [],
    silo: {},
    siloSlots: 10,
    machines: {},
    unlockedRecipes: {},
    animals: {},
    hourglasses: 0,
    orders: [],
    orderSlots: 3,
    orderSeq: rev,
    ordersGenerated: rev,
    lastSeenAt: rev,
    dailyDay: "",
    dailyOrder: null,
    stats: {},
    achievements: {},
    taskIndex: 0,
    tabsSeen: {},
  };
}

function makeFile(rev: number): SaveFile {
  return {
    version: 5,
    rev,
    savedAt: new Date(2026, 0, 1, 12, 0, 0).toISOString(),
    payload: makeState(rev),
  };
}

describe("JsonSaveRepository", () => {
  it("保存后能原样读回", async () => {
    const dir = await makeTempDir();
    const repo = new JsonSaveRepository(dir);
    const file = makeFile(1);

    await repo.save(file);

    expect(await repo.load()).toEqual(file);
  });

  it("主文件损坏时回退 .bak", async () => {
    const dir = await makeTempDir();
    const repo = new JsonSaveRepository(dir);
    await repo.save(makeFile(1));
    await repo.save(makeFile(2));

    await writeFile(path.join(dir, SAVE_FILE), "{ 这不是合法 JSON", "utf8");

    expect(await repo.load()).toEqual(makeFile(1));
  });

  it("主档 JSON 合法但结构非法时回退 .bak", async () => {
    const dir = await makeTempDir();
    const repo = new JsonSaveRepository(dir);
    await repo.save(makeFile(1));
    await repo.save(makeFile(2));

    const brokenStructure = { ...makeFile(9), payload: { coins: 1 } };
    await writeFile(path.join(dir, SAVE_FILE), JSON.stringify(brokenStructure), "utf8");

    expect(await repo.load()).toEqual(makeFile(1));
    expect(await repo.loadWithSource()).toEqual({ file: makeFile(1), source: "bak" });
  });

  it("主档版本不匹配时视为不可用并回退 .bak", async () => {
    const dir = await makeTempDir();
    const repo = new JsonSaveRepository(dir);
    await repo.save(makeFile(1));
    await repo.save(makeFile(2));

    const wrongVersion = { ...makeFile(9), version: 6 };
    await writeFile(path.join(dir, SAVE_FILE), JSON.stringify(wrongVersion), "utf8");

    expect(await repo.load()).toEqual(makeFile(1));
  });

  it("主档版本不匹配且无备份时不加载", async () => {
    const dir = await makeTempDir();
    const repo = new JsonSaveRepository(dir);

    const wrongVersion = { ...makeFile(9), version: 6 };
    await writeFile(path.join(dir, SAVE_FILE), JSON.stringify(wrongVersion), "utf8");

    expect(await repo.load()).toBeNull();
    expect(await repo.loadWithSource()).toEqual({ file: null, source: null });
  });

  it("坏主档不会被写成 .bak", async () => {
    const dir = await makeTempDir();
    const repo = new JsonSaveRepository(dir);
    await repo.save(makeFile(1));
    await repo.save(makeFile(2));

    await writeFile(path.join(dir, SAVE_FILE), "{ 这不是合法 JSON", "utf8");
    await repo.save(makeFile(3));

    const bak = JSON.parse(await readFile(path.join(dir, `${SAVE_FILE}.bak`), "utf8"));
    expect(bak).toEqual(makeFile(1));
  });

  it("每次覆盖前保留上一份为 .bak", async () => {
    const dir = await makeTempDir();
    const repo = new JsonSaveRepository(dir);
    await repo.save(makeFile(1));
    await repo.save(makeFile(2));

    const bak = JSON.parse(await readFile(path.join(dir, `${SAVE_FILE}.bak`), "utf8"));

    expect(bak).toEqual(makeFile(1));
  });

  it("同一天只生成一份快照，超过 7 天清理", async () => {
    const dir = await makeTempDir();
    let now = new Date(2026, 0, 2, 9, 0, 0).getTime();
    const repo = new JsonSaveRepository(dir, () => now);
    const snapshotDir = path.join(dir, "snapshots");

    // 第一天没有旧 save.json，不产生快照
    await repo.save(makeFile(1));
    now = new Date(2026, 0, 2, 18, 0, 0).getTime();
    await repo.save(makeFile(2));

    // 1 月 5 日首次写入前，把 1 月 2 日留下的 save.json 复制为当日快照
    now = new Date(2026, 0, 5, 9, 0, 0).getTime();
    await repo.save(makeFile(3));
    now = new Date(2026, 0, 5, 20, 0, 0).getTime();
    await repo.save(makeFile(4));

    expect(JSON.parse(await readFile(path.join(snapshotDir, "2026-01-05.json"), "utf8"))).toEqual(
      makeFile(2),
    );

    // 1 月 13 日：当日快照记录覆盖前的状态，1 月 5 日快照已超过 7 天被清理
    now = new Date(2026, 0, 13, 9, 0, 0).getTime();
    await repo.save(makeFile(5));

    expect(await readdir(snapshotDir)).toEqual(["2026-01-13.json"]);
    expect(JSON.parse(await readFile(path.join(snapshotDir, "2026-01-13.json"), "utf8"))).toEqual(
      makeFile(4),
    );
  });

  it("目录为空时 load 返回 null", async () => {
    const dir = await makeTempDir();
    const repo = new JsonSaveRepository(dir);

    expect(await repo.load()).toBeNull();
  });
});
