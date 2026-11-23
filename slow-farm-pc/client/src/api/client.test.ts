import { afterEach, describe, expect, it, vi } from "vitest";
import { getMeta, postAction } from "./client";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("api client", () => {
  it("网络请求失败时抛出 server_unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );

    await expect(getMeta()).rejects.toMatchObject({ reason: "server_unreachable" });
  });

  it("Vite 代理的 502 也视为服务端不可达", async () => {
    // 后端未启动时，Vite 代理返回 502 而不是让 fetch 直接失败。
    const gatewayError = { ok: false, status: 502, json: async () => ({}) } as Response;
    vi.stubGlobal("fetch", vi.fn(async () => gatewayError));

    await expect(postAction("plant", { plot: 0 }, 1)).rejects.toMatchObject({
      reason: "server_unreachable",
    });
  });
});
