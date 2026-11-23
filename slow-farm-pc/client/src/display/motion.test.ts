import { describe, expect, it } from "vitest";
import { motionAllowed } from "./motion";

describe("motionAllowed", () => {
  it("系统开启减少动效时返回 false", () => {
    expect(motionAllowed({ matches: true })).toBe(false);
  });

  it("系统未开启或拿不到设置时保持动效", () => {
    expect(motionAllowed({ matches: false })).toBe(true);
    expect(motionAllowed(null)).toBe(true);
    expect(motionAllowed(undefined)).toBe(true);
  });
});
