import type { FastifyInstance } from "fastify";
import RULES from "../../core/slow-farm-rules.js";
import { SAVE_VERSION, type GameEngine } from "../state/engine";

// 规则表本身没有版本字段，先用固定值标记；规则变更时手动递增。
export const RULES_VERSION = "1";

export function registerMetaRoute(
  app: FastifyInstance,
  engine: GameEngine,
  startedAt: string,
): void {
  app.get("/api/meta", async (_request, reply) => {
    await engine.ensureDaily();
    const { rev } = engine.snapshot();
    return reply.code(200).send({
      rulesVersion: RULES_VERSION,
      saveVersion: SAVE_VERSION,
      rules: RULES,
      rev,
      startedAt,
    });
  });
}
