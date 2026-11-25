import { expect, it, vi } from "vitest";
import { DockBar, type DockEntry } from "./DockBar";

const makeEntry = (
  key: string,
  label: string,
  icon: string,
  onSelect = vi.fn(),
): DockEntry => ({ key, label, icon, onSelect });

it("渲染全部入口，每个入口可点击", () => {
  const onSelect = vi.fn();
  const bar = new DockBar(1280, 590, 130, [
    { key: "farm", label: "农场", icon: "A", onSelect },
    { key: "orders", label: "订单", icon: "B", onSelect: vi.fn() },
  ]);
  expect(bar.element.querySelectorAll(".dock-item").length).toBe(2);
  (bar.element.querySelector(".dock-item") as HTMLElement).click();
  expect(onSelect).toHaveBeenCalled();
});

it("setActive 只给对应入口加 data-active", () => {
  const bar = new DockBar(1280, 590, 130, [{ key: "silo", label: "仓库", icon: "A", onSelect: vi.fn() }]);
  bar.setActive("silo");
  expect(bar.element.querySelector(".dock-item")!.getAttribute("data-active")).toBe("true");
});

it("订单角标：0 隐藏，>99 显示 99+", () => {
  const bar = new DockBar(1280, 590, 130, [{ key: "orders", label: "订单", icon: "B", onSelect: vi.fn() }]);
  const badge = () => bar.element.querySelector(".dock-badge") as HTMLElement;
  bar.setOrderBadge(0);
  expect(badge().hidden).toBe(true);
  bar.setOrderBadge(120);
  expect(badge().textContent).toBe("99+");
  expect(badge().hidden).toBe(false);
});

it("入口按旧画布几何排布：宽度 125、高度 74、间隙 7、整体居中", () => {
  const bar = new DockBar(1280, 590, 130, [
    makeEntry("farm", "农场", "A"),
    makeEntry("orders", "订单", "B"),
  ]);
  const items = bar.element.querySelectorAll<HTMLElement>(".dock-item");
  expect(bar.element.style.top).toBe("590px");
  expect(bar.element.style.height).toBe("130px");
  expect(bar.element.style.width).toBe("1280px");
  expect(items[0].style.left).toBe("511.5px");
  expect(items[0].style.top).toBe("30px");
  expect(items[0].style.width).toBe("125px");
  expect(items[0].style.height).toBe("74px");
  expect(items[1].style.left).toBe("643.5px");
});

it("图标与文案写入对应节点，图标仅用 textContent", () => {
  const bar = new DockBar(1280, 590, 130, [makeEntry("farm", "农场", "A")]);
  expect(bar.element.querySelector(".dock-icon")!.textContent).toBe("A");
  expect(bar.element.querySelector(".dock-label")!.textContent).toBe("农场");
  expect(bar.element.querySelector(".dock-icon")!.children.length).toBe(0);
});

it("setActive 切换时清除旧高亮，传 null 清除全部", () => {
  const bar = new DockBar(1280, 590, 130, [
    makeEntry("farm", "农场", "A"),
    makeEntry("orders", "订单", "B"),
  ]);
  const items = bar.element.querySelectorAll<HTMLElement>(".dock-item");

  bar.setActive("farm");
  expect(items[0].getAttribute("data-active")).toBe("true");
  expect(items[1].getAttribute("data-active")).toBeNull();

  bar.setActive("orders");
  expect(items[0].getAttribute("data-active")).toBeNull();
  expect(items[1].getAttribute("data-active")).toBe("true");

  bar.setActive(null);
  expect(items[0].getAttribute("data-active")).toBeNull();
  expect(items[1].getAttribute("data-active")).toBeNull();
});

it("角标数值未变时不重写 textContent（差分）", () => {
  const bar = new DockBar(1280, 590, 130, [makeEntry("orders", "订单", "B")]);
  bar.setOrderBadge(5);
  const badge = bar.element.querySelector(".dock-badge") as HTMLElement;
  expect(badge.textContent).toBe("5");

  let writes = 0;
  const desc = Object.getOwnPropertyDescriptor(Node.prototype, "textContent")!;
  Object.defineProperty(badge, "textContent", {
    configurable: true,
    get: () => desc.get!.call(badge),
    set: (value) => { writes += 1; desc.set!.call(badge, value); },
  });
  bar.setOrderBadge(5);
  expect(writes).toBe(0);
  bar.setOrderBadge(120); // 120 显示 "99+"，文本变化，必须写一次
  expect(writes).toBe(1);
  bar.setOrderBadge(150); // 仍是 "99+"，不得重写
  expect(writes).toBe(1);
});

it("没有订单入口时 setOrderBadge 安全空转", () => {
  const bar = new DockBar(1280, 590, 130, [makeEntry("farm", "农场", "A")]);
  expect(bar.element.querySelector(".dock-badge")).toBeNull();
  expect(() => bar.setOrderBadge(3)).not.toThrow();
});

it("destroy 后元素脱离文档且不再响应点击", () => {
  const onSelect = vi.fn();
  const bar = new DockBar(1280, 590, 130, [makeEntry("farm", "农场", "A", onSelect)]);
  document.body.append(bar.element);
  const item = bar.element.querySelector(".dock-item") as HTMLElement;
  bar.destroy();
  item.click();
  expect(onSelect).not.toHaveBeenCalled();
  expect(bar.element.isConnected).toBe(false);
});
