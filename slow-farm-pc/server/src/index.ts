import { existsSync } from "node:fs";
import * as path from "node:path";
import { buildApp } from "./app";
import { createLogger } from "./logging";
import { GameEngine } from "./state/engine";
import { JsonSaveRepository } from "./store/saveRepository";

const DEFAULT_PORT = 8787;
const HOST = "127.0.0.1";
// 允许用环境变量指向临时目录，验证时避免覆盖真实存档。
const dataDirOverride = process.env.SLOW_FARM_DATA_DIR;
const DATA_DIR = dataDirOverride
  ? path.resolve(dataDirOverride)
  : path.resolve(__dirname, "../data");
const CLIENT_DIST = path.resolve(__dirname, "../../client/dist");

function resolvePort(): number {
  const raw = process.env.PORT;
  if (!raw) return DEFAULT_PORT;
  const port = Number(raw);
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : DEFAULT_PORT;
}

async function main(): Promise<void> {
  const port = resolvePort();
  const logger = createLogger(DATA_DIR);
  const engine = new GameEngine(new JsonSaveRepository(DATA_DIR), Date.now, logger);
  await engine.init();

  const app = buildApp(engine, {
    logger,
    ...(existsSync(CLIENT_DIST) ? { clientDist: CLIENT_DIST } : {}),
  });

  try {
    await app.listen({ host: HOST, port });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EADDRINUSE") {
      console.error("端口被占用，请用 PORT 环境变量换一个");
      logger.error(`端口 ${port} 被占用，启动失败`);
      process.exit(1);
    }
    throw error;
  }

  console.log(`服务已启动：http://${HOST}:${port}`);
  logger.info(`服务已启动：http://${HOST}:${port}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
