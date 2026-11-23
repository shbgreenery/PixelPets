import { describe, expect, it } from "vitest";
import { animalIcon, cropIcon, hudIcon, itemIcon } from "./icons";

describe("icons", () => {
  it("已知作物返回对应 emoji", () => {
    expect(cropIcon("wheat")).toBe("🌾");
    expect(cropIcon("corn")).toBe("🌽");
  });
  it("未知 id 返回兜底图标而不是抛错", () => {
    expect(cropIcon("unknown")).toBe("❔");
    expect(itemIcon("unknown")).toBe("❔");
  });
  it("原型链上的键名不会命中图标表", () => {
    expect(cropIcon("constructor")).toBe("❔");
    expect(itemIcon("toString")).toBe("❔");
  });
  it("动物映射含鸡/牛/羊", () => {
    expect(animalIcon("chicken")).toBe("🐔");
    expect(animalIcon("sheep")).toBe("🐑");
  });
  it("HUD 映射含金币/宝石/沙漏", () => {
    expect(hudIcon("coins")).toBe("🪙");
    expect(hudIcon("gems")).toBe("💎");
    expect(hudIcon("hourglass")).toBe("⏳");
  });
});
