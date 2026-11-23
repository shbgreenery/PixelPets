import type { FastifyInstance } from "fastify";
import { ACTION_TYPES, type ActionType, type GameEngine } from "../state/engine";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isActionType(value: string): value is ActionType {
  return (ACTION_TYPES as readonly string[]).includes(value);
}

export function registerActionRoute(app: FastifyInstance, engine: GameEngine): void {
  app.post("/api/action", async (request, reply) => {
    const body = request.body;
    if (
      !isRecord(body)
      || typeof body.type !== "string"
      || !isRecord(body.args)
      || typeof body.rev !== "number"
    ) {
      return reply.code(400).send({ ok: false, reason: "bad_request" });
    }

    if (!isActionType(body.type)) {
      return reply.code(400).send({ ok: false, reason: "unknown_type" });
    }

    const outcome = await engine.apply(body.type, body.args, body.rev);

    if (outcome.status === "stale") {
      const { state, rev } = engine.snapshot();
      return reply.code(409).send({ ok: false, reason: "stale_rev", state, rev });
    }

    if (outcome.status === "unknown") {
      return reply.code(400).send({ ok: false, reason: "unknown_type" });
    }

    if (outcome.status === "business") {
      return reply.code(200).send({ ok: false, reason: outcome.reason ?? "business" });
    }

    const { state, rev } = engine.snapshot();
    return reply.code(200).send({ ok: true, result: outcome.result, state, rev });
  });
}
