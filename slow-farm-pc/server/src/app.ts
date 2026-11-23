import Fastify = require("fastify");
import fastifyStatic = require("@fastify/static");
import type { FastifyInstance } from "fastify";
import type { GameEngine } from "./state/engine";
import type { Logger } from "./logging";
import { registerActionRoute } from "./routes/action";
import { registerSaveRoutes } from "./routes/save";
import { registerMetaRoute } from "./routes/meta";

export interface BuildAppOptions {
  clientDist?: string;
  logger?: Logger;
}

export function buildApp(engine: GameEngine, opts: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify();
  const startedAt = new Date().toISOString();

  // 记录原始错误，对外只给通用文案，不泄露堆栈。
  app.setErrorHandler((error, request, reply) => {
    request.log.error(error);
    const message = error instanceof Error ? error.message : String(error);
    opts.logger?.error(`${request.method} ${request.url} ${message}`);
    const code = (error as { code?: string } | null)?.code;
    // 请求体解析失败属于客户端错误，不应落到 500。
    if (code === "FST_ERR_CTP_INVALID_JSON_BODY" || code === "FST_ERR_CTP_EMPTY_JSON_BODY") {
      return reply.code(400).send({ ok: false, reason: "bad_request" });
    }
    return reply.code(500).send({ ok: false, reason: "internal" });
  });

  registerActionRoute(app, engine);
  registerSaveRoutes(app, engine);
  registerMetaRoute(app, engine, startedAt);

  // 开发期由 Vite 托管页面，只有显式传入 clientDist 才做静态资源托管。
  if (opts.clientDist) {
    app.register(fastifyStatic, { root: opts.clientDist });
  }

  return app;
}
