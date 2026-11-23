import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import * as path from "node:path";

export const LOG_FILE = "server.log";
export const LOG_KEEP_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;
// 行首时间戳：与写入格式一致，用于启动时按天裁剪。
const LINE_TIMESTAMP = /^\[([^\]]+)\]/;

export interface Logger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string | Error): void;
}

function lineTimestamp(line: string): number | null {
  const matched = LINE_TIMESTAMP.exec(line);
  if (!matched) return null;
  const timestamp = Date.parse(matched[1]);
  return Number.isNaN(timestamp) ? null : timestamp;
}

// 一条日志只占一行：换行转义，避免堆栈把后续行变成无时间戳的残留内容。
function toSingleLine(message: string | Error): string {
  return String(message).replace(/\r?\n/g, "\\n");
}

function trimExpired(logPath: string, now: number): void {
  if (!existsSync(logPath)) return;

  const cutoff = now - LOG_KEEP_DAYS * DAY_MS;
  const kept = readFileSync(logPath, "utf8")
    .split(/\r?\n/)
    .filter((line) => line !== "")
    // 无法解析时间的行无法判断年龄，保守保留。
    .filter((line) => {
      const timestamp = lineTimestamp(line);
      return timestamp === null || timestamp >= cutoff;
    });

  writeFileSync(logPath, kept.length > 0 ? `${kept.join("\n")}\n` : "", "utf8");
}

export function createLogger(dataDir: string, clock: () => number = Date.now): Logger {
  const logPath = path.join(dataDir, LOG_FILE);
  mkdirSync(dataDir, { recursive: true });
  trimExpired(logPath, clock());

  const write = (level: "INFO" | "WARN" | "ERROR", message: string | Error): void => {
    const line = `[${new Date(clock()).toISOString()}] ${level} ${toSingleLine(message)}\n`;
    appendFileSync(logPath, line, "utf8");
  };

  return {
    info: (message) => write("INFO", message),
    warn: (message) => write("WARN", message),
    error: (message) => write("ERROR", message),
  };
}
