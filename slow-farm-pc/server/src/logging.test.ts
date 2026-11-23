import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createLogger, LOG_FILE } from "./logging";

const DAY_MS = 24 * 60 * 60 * 1000;
const FIXED_NOW = new Date(2026, 10, 23, 12, 0, 0).getTime();
const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "slow-farm-log-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("createLogger", () => {
  it("日志按行追加并保留 7 天", async () => {
    const dir = await makeTempDir();
    const logPath = path.join(dir, LOG_FILE);
    const expired = new Date(FIXED_NOW - 8 * DAY_MS).toISOString();
    const boundary = new Date(FIXED_NOW - 7 * DAY_MS).toISOString();
    const fresh = new Date(FIXED_NOW - 1 * DAY_MS).toISOString();
    await writeFile(
      logPath,
      `[${expired}] INFO 过期行\n[${boundary}] INFO 边界行\n[${fresh}] INFO 新鲜行\n`,
      "utf8",
    );

    const logger = createLogger(dir, () => FIXED_NOW);
    logger.info("启动");
    logger.error(new Error("出错了\n第二行"));

    const lines = (await readFile(logPath, "utf8")).split("\n").filter(Boolean);
    expect(lines.some((line) => line.includes("过期行"))).toBe(false);
    expect(lines.some((line) => line.includes("边界行"))).toBe(true);
    expect(lines.some((line) => line.includes("新鲜行"))).toBe(true);
    expect(lines.some((line) => line.includes(new Date(FIXED_NOW).toISOString()) && line.includes("INFO 启动"))).toBe(true);
    expect(lines.some((line) => line.includes("ERROR Error: 出错了\\n第二行"))).toBe(true);
  });
});
