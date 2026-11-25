import { expect, it, vi } from "vitest";
import type { GameState, Rules } from "../api/client";
import { animalIcon } from "../display/icons";
import { BarnRackView, type BarnRackConfig } from "./BarnRackView";

const rules = {
  CROPS: {},
  ITEMS: { milk: { name: "牛奶" }, egg: { name: "鸡蛋" } },
  LEVELS: [0, 40],
  ANIMALS: { chicken: { name: "鸡", product: "milk", cycleMs: 60_000, unlockLevel: 1 } },
} as unknown as Rules;

const makeState = (
  list: Array<{ id: number; readyAt: number }> = [{ id: 1, readyAt: 2000 }],
  xp = 0,
): GameState => ({
  coins: 0,
  gems: 0,
  xp,
  plots: [],
  silo: {},
  animals: { chicken: { list } },
}) as unknown as GameState;

const makeRack = (over: Partial<BarnRackConfig> = {}) => new BarnRackView({
  left: 22,
  right: 1004,
  y: 532,
  hasTexture: () => false,
  onSelect: vi.fn(),
  ...over,
});

it("每种动物渲染一个栏位，data-tone 跟随状态", () => {
  const rack = makeRack();
  rack.update(makeState(), rules, 1000);
  const stall = rack.element.querySelector(".stall")!;
  expect(stall.getAttribute("data-tone")).toBe("growing");
  expect(stall.querySelector(".stall-status")!.textContent).toContain("产出中");
  expect(stall.querySelector(".stall-name")!.textContent).toBe("鸡舍");
  expect(stall.querySelector(".stall-product")!.textContent).toBe("牛奶");
});

it("状态文案未变时不重写（差分）", () => {
  const rack = makeRack();
  const state = makeState();
  rack.update(state, rules, 1000);
  const status = rack.element.querySelector(".stall-status")!;
  let writes = 0;
  const desc = Object.getOwnPropertyDescriptor(Node.prototype, "textContent")!;
  Object.defineProperty(status, "textContent", {
    configurable: true,
    get: () => desc.get!.call(status),
    set: (value) => { writes += 1; desc.set!.call(status, value); },
  });
  rack.update(state, rules, 1100); // 同一显示秒，剩余 0.9s 向上取整仍是 0:01
  expect(writes).toBe(0);
  rack.update(state, rules, 2000); // 到点，文案变为可收取
  expect(writes).toBe(1);
  expect(status.textContent).toBe("1 只可收取");
});

it("点击栏位触发 onSelect", () => {
  const onSelect = vi.fn();
  const rack = makeRack({ onSelect });
  rack.update(makeState(), rules, 1000);
  const stall = rack.element.querySelector(".stall") as HTMLElement;
  stall.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  expect(onSelect).toHaveBeenCalledTimes(1);
});

it("有贴图时渲染 img，缺少贴图时回退 emoji", () => {
  const withTexture = makeRack({ hasTexture: () => true });
  withTexture.update(makeState(), rules, 1000);
  const image = withTexture.element.querySelector("img.stall-animal") as HTMLImageElement;
  expect(image.getAttribute("src")).toBe("/animals/chicken.png");

  const withoutTexture = makeRack();
  withoutTexture.update(makeState(), rules, 1000);
  const icon = withoutTexture.element.querySelector(".stall-animal") as HTMLElement;
  expect(icon.textContent).toBe(animalIcon("chicken"));
});

it("贴图加载失败时把 img 替换为 emoji", () => {
  const rack = makeRack({ hasTexture: () => true });
  rack.update(makeState(), rules, 1000);
  const image = rack.element.querySelector("img.stall-animal") as HTMLImageElement;
  image.dispatchEvent(new Event("error"));

  const icon = rack.element.querySelector(".stall-animal") as HTMLElement;
  expect(icon.tagName).toBe("SPAN");
  expect(icon.textContent).toBe(animalIcon("chicken"));
  expect(rack.element.querySelector("img.stall-animal")).toBeNull();
});

it("动物种类不变时复用栏位，种类变化时重建", () => {
  const rack = makeRack();
  rack.update(makeState(), rules, 1000);
  const first = rack.element.querySelector(".stall");
  rack.update(makeState(), rules, 1100);
  expect(rack.element.querySelector(".stall")).toBe(first);

  const moreRules = {
    ...rules,
    ANIMALS: {
      ...rules.ANIMALS,
      cow: { name: "牛", product: "milk", cycleMs: 60_000, unlockLevel: 1 },
    },
  } as unknown as Rules;
  rack.update(makeState(), moreRules, 1200);
  expect(rack.element.querySelectorAll(".stall").length).toBe(2);
});

it("未解锁的畜舍标记为 locked", () => {
  const lockedRules = {
    ...rules,
    ANIMALS: { chicken: { name: "鸡", product: "milk", cycleMs: 60_000, unlockLevel: 2 } },
  } as unknown as Rules;
  const rack = makeRack();
  rack.update(makeState(), lockedRules, 1000);
  expect(rack.element.querySelector(".stall")!.getAttribute("data-tone")).toBe("locked");
});

it("栏位宽度按左右边界与间隙均分", () => {
  const twoRules = {
    ...rules,
    ANIMALS: {
      chicken: { name: "鸡", product: "milk", cycleMs: 60_000, unlockLevel: 1 },
      cow: { name: "牛", product: "egg", cycleMs: 60_000, unlockLevel: 1 },
    },
  } as unknown as Rules;
  const rack = makeRack();
  rack.update(makeState(), twoRules, 1000);
  const stalls = rack.element.querySelectorAll(".stall") as NodeListOf<HTMLElement>;
  expect(rack.element.style.left).toBe("22px");
  expect(rack.element.style.top).toBe("492.5px");
  expect(stalls[0].style.width).toBe("484.5px");
  expect(stalls[1].style.left).toBe("497.5px");
});

it("进度条按 stallViews 的进度设置 scaleX", () => {
  const rack = makeRack();
  rack.update(makeState([{ id: 1, readyAt: 40_000 }]), rules, 1000);
  const bar = rack.element.querySelector(".stall-bar") as HTMLElement;
  expect(bar.style.transform).toBe("scaleX(0.35)");
});

it("destroy 后移除元素且不再响应点击", () => {
  const onSelect = vi.fn();
  const rack = makeRack({ onSelect });
  document.body.append(rack.element);
  rack.update(makeState(), rules, 1000);
  const stall = rack.element.querySelector(".stall") as HTMLElement;
  rack.destroy();
  stall.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  expect(onSelect).not.toHaveBeenCalled();
  expect(rack.element.isConnected).toBe(false);
});
