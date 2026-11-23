import type { FastifyInstance } from "fastify";
import { isGameState, SAVE_VERSION, type GameEngine } from "../state/engine";

// 引擎尚未 init 时 snapshot 会以此文案抛错；GET /api/save 据此返回 204。
const ENGINE_NOT_READY = "引擎尚未初始化";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function registerSaveRoutes(app: FastifyInstance, engine: GameEngine): void {
  app.get("/api/save", async (request, reply) => {
    await engine.ensureDaily();
    try {
      const { state, rev } = engine.snapshot();
      return reply.code(200).send({ state, rev });
    } catch (error) {
      if (error instanceof Error && error.message === ENGINE_NOT_READY) {
        return reply.code(204).send();
      }
      throw error;
    }
  });

  // 仅用于导入或手工恢复：校验 state 结构与存档版本后交给引擎。
  app.put("/api/save", async (request, reply) => {
    const body = request.body;
    if (!isRecord(body) || typeof body.rev !== "number") {
      return reply.code(400).send({ ok: false, reason: "bad_request" });
    }
    if (body.version !== undefined && body.version !== SAVE_VERSION) {
      return reply.code(400).send({ ok: false, reason: "bad_file" });
    }
    if (!isGameState(body.state)) {
      return reply.code(400).send({ ok: false, reason: "bad_file" });
    }

    const outcome = await engine.importState(body.state, body.rev);
    if (outcome.status === "stale") {
      const { state, rev } = engine.snapshot();
      return reply.code(409).send({ ok: false, reason: "stale_rev", state, rev });
    }
    if (outcome.status !== "ok") {
      return reply.code(400).send({ ok: false, reason: outcome.reason ?? "bad_file" });
    }

    const { state, rev } = engine.snapshot();
    return reply.code(200).send({ ok: true, state, rev });
  });

  app.delete("/api/save", async (request, reply) => {
    const raw = (request.query as Record<string, unknown> | undefined)?.rev;
    const rev = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : Number.NaN;
    if (!Number.isInteger(rev)) {
      return reply.code(400).send({ ok: false, reason: "bad_request" });
    }

    const current = engine.snapshot();
    if (rev !== current.rev) {
      return reply.code(409).send({
        ok: false,
        reason: "stale_rev",
        state: current.state,
        rev: current.rev,
      });
    }

    await engine.reset();
    const { state, rev: nextRev } = engine.snapshot();
    return reply.code(200).send({ ok: true, state, rev: nextRev });
  });
}
