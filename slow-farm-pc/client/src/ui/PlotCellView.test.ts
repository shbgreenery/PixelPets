import { afterEach, expect, it, vi } from "vitest";
import { PlotCellView } from "./PlotCellView";

afterEach(() => {
  // 断言失败也要清理全局 stub，避免污染后续用例。
  vi.unstubAllGlobals();
});

const makePlot = (over = {}) => ({ id: 1, cropId: null, plantedAt: 0, readyAt: 0, ...over });
const make = () => new PlotCellView({ index: 0, width: 179, height: 110, onSelect: vi.fn() });

it("空地在 element 上标记 data-stage=empty 并显示加号", () => {
  const cell = make();
  expect(cell.update(makePlot(), 1000)).toBe("empty");
  expect(cell.element.dataset.stage).toBe("empty");
  expect(cell.element.querySelector(".plot-icon")!.textContent).toBe("+");
});

it("生长中显示倒计时且阶段为 growing", () => {
  const cell = make();
  const plot = makePlot({ cropId: "wheat", plantedAt: 0, readyAt: 61_000 });
  expect(cell.update(plot, 1000)).toBe("growing");
  expect(cell.element.querySelector(".plot-label")!.textContent).toBe("1:00");
});

it("同一秒内重复 update 不重写 label（差分）", () => {
  const cell = make();
  const plot = makePlot({ cropId: "wheat", plantedAt: 0, readyAt: 61_000 });
  cell.update(plot, 1000);
  const label = cell.element.querySelector(".plot-label")!;
  let writes = 0;
  const desc = Object.getOwnPropertyDescriptor(Node.prototype, "textContent")!;
  Object.defineProperty(label, "textContent", {
    configurable: true,
    get: () => desc.get!.call(label),
    set: (value) => { writes += 1; desc.set!.call(label, value); },
  });
  cell.update(plot, 1249); // 同一显示秒，剩余 59.751s 向上取整仍是 60s
  expect(writes).toBe(0);
  cell.update(plot, 2000); // 跨显示秒，剩余 59.000s 变成 0:59
  expect(writes).toBe(1);
});

it("成熟时 data-stage=ready 且显示可收获", () => {
  const cell = make();
  const plot = makePlot({ cropId: "wheat", plantedAt: 0, readyAt: 1000 });
  expect(cell.update(plot, 1000)).toBe("ready");
  expect(cell.element.dataset.stage).toBe("ready");
  expect(cell.element.querySelector(".plot-label")!.textContent).toBe("可收获");
});

it("点击整个地块触发 onSelect", () => {
  const onSelect = vi.fn();
  const cell = new PlotCellView({ index: 3, width: 179, height: 110, onSelect });
  cell.element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  expect(onSelect).toHaveBeenCalledWith(3);
});

it("减少动效时不播放粒子", () => {
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  const cell = make();
  cell.playHarvest("小麦 +2");
  expect(cell.element.querySelectorAll(".plot-particle").length).toBe(0);
});
