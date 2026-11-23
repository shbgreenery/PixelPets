import { promises as fs } from "node:fs";
import * as path from "node:path";
import {
  isGameState,
  SAVE_VERSION,
  type LoadResult,
  type SaveFile,
  type SaveRepository,
} from "../types";

export const SAVE_FILE = "save.json";
export const SNAPSHOT_KEEP_DAYS = 7;

const SNAPSHOT_DIR = "snapshots";
const DAY_MS = 24 * 60 * 60 * 1000;
const SNAPSHOT_NAME = /^\d{4}-\d{2}-\d{2}\.json$/;

// 按本地时区格式化日期，避免 toISOString 的 UTC 偏移导致跨天判断错误。
function formatLocalDate(ms: number): string {
  const date = new Date(ms);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function snapshotTimestamp(name: string): number {
  const [year, month, day] = name.slice(0, 10).split("-").map(Number);
  return new Date(year, month - 1, day).getTime();
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function removeIfExists(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath);
  } catch {
    // 文件本就不存在，忽略
  }
}

// 解析并校验存档：版本必须匹配，payload 结构必须合法，否则视为不可用。
function parseSaveFile(raw: string): SaveFile | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;

  const record = parsed as Record<string, unknown>;
  if (record.version !== SAVE_VERSION) return null;
  if (!isGameState(record.payload)) return null;
  return parsed as SaveFile;
}

export class JsonSaveRepository implements SaveRepository {
  private readonly savePath: string;
  private readonly tmpPath: string;
  private readonly bakPath: string;
  private readonly snapshotDir: string;

  constructor(
    private readonly dataDir: string,
    private readonly clock: () => number = Date.now,
  ) {
    this.savePath = path.join(dataDir, SAVE_FILE);
    this.tmpPath = path.join(dataDir, `${SAVE_FILE}.tmp`);
    this.bakPath = path.join(dataDir, `${SAVE_FILE}.bak`);
    this.snapshotDir = path.join(dataDir, SNAPSHOT_DIR);
  }

  async load(): Promise<SaveFile | null> {
    return (await this.loadWithSource()).file;
  }

  // 依次尝试主档与备份；两者都不可用（损坏、结构非法或版本不符）时返回 null。
  async loadWithSource(): Promise<LoadResult> {
    const primary = await this.readSaveFile(this.savePath);
    if (primary !== null) {
      return { file: primary, source: "save" };
    }
    const backup = await this.readSaveFile(this.bakPath);
    if (backup !== null) {
      return { file: backup, source: "bak" };
    }
    return { file: null, source: null };
  }

  async save(file: SaveFile): Promise<void> {
    await fs.mkdir(this.dataDir, { recursive: true });
    await this.writeSnapshotIfNeeded();

    const handle = await fs.open(this.tmpPath, "w");
    try {
      await handle.writeFile(JSON.stringify(file), "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }

    // 只有现有主档可解析且结构有效时才覆盖备份，避免把坏档写成 .bak。
    if ((await this.readSaveFile(this.savePath)) !== null) {
      await fs.copyFile(this.savePath, this.bakPath);
    }
    await fs.rename(this.tmpPath, this.savePath);
  }

  async clear(): Promise<void> {
    await Promise.all([
      removeIfExists(this.savePath),
      removeIfExists(this.bakPath),
      removeIfExists(path.join(this.snapshotDir, `${formatLocalDate(this.clock())}.json`)),
    ]);
  }

  private async readSaveFile(filePath: string): Promise<SaveFile | null> {
    try {
      const raw = await fs.readFile(filePath, "utf8");
      return parseSaveFile(raw);
    } catch {
      return null;
    }
  }

  // 新的一天首次写入前，把上一份 save.json 留作当日快照；每日只留一份。
  private async writeSnapshotIfNeeded(): Promise<void> {
    const snapshotPath = path.join(this.snapshotDir, `${formatLocalDate(this.clock())}.json`);
    if (!(await exists(snapshotPath)) && (await exists(this.savePath))) {
      await fs.mkdir(this.snapshotDir, { recursive: true });
      await fs.copyFile(this.savePath, snapshotPath);
    }
    await this.pruneSnapshots();
  }

  private async pruneSnapshots(): Promise<void> {
    let names: string[];
    try {
      names = await fs.readdir(this.snapshotDir);
    } catch {
      return;
    }

    const now = new Date(this.clock());
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

    await Promise.all(
      names
        .filter((name) => SNAPSHOT_NAME.test(name))
        .filter((name) => today - snapshotTimestamp(name) > SNAPSHOT_KEEP_DAYS * DAY_MS)
        .map((name) => removeIfExists(path.join(this.snapshotDir, name))),
    );
  }
}
