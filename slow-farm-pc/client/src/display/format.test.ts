import { describe, expect, it } from "vitest";
import {
  formatCountdown,
  formatDuration,
  formatGrowTime,
  levelOf,
  levelProgress,
  reasonText,
  remainingMs,
} from "./format";

// 与服务端 core 相同的一组等级门槛，避免测试依赖服务端文件。
const rules = { LEVELS: [0, 40, 120, 300, 600, 1000, 1600, 2400, 3400, 4800] };

describe("format", () => {
  it("levelOf 按规则表换算等级", () => {
    expect(levelOf(0, rules)).toBe(1);
    expect(levelOf(39, rules)).toBe(1);
    expect(levelOf(40, rules)).toBe(2);
    expect(levelOf(119, rules)).toBe(2);
    expect(levelOf(120, rules)).toBe(3);
    expect(levelOf(4799, rules)).toBe(9);
    expect(levelOf(4800, rules)).toBe(10);
    expect(levelOf(99999, rules)).toBe(10);
  });

  it("formatDuration 输出 分:秒", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(5_000)).toBe("0:05");
    expect(formatDuration(65_000)).toBe("1:05");
    expect(formatDuration(600_000)).toBe("10:00");
    expect(formatDuration(180 * 60 * 1000)).toBe("180:00");
    // 剩余时间为负时按 0 处理，避免出现 "-1:-5"。
    expect(formatDuration(-1_000)).toBe("0:00");
  });

  it("remainingMs 到点后返回 0 而不是负数", () => {
    expect(remainingMs(1_500, 1_000)).toBe(500);
    expect(remainingMs(1_000, 1_000)).toBe(0);
    expect(remainingMs(500, 1_000)).toBe(0);
  });

  it("formatCountdown 向上取整并在超过 1 小时时补小时位", () => {
    expect(formatCountdown(0)).toBe("0:00");
    expect(formatCountdown(1)).toBe("0:01");
    expect(formatCountdown(61_000)).toBe("1:01");
    expect(formatCountdown(3_600_000)).toBe("1:00:00");
    expect(formatCountdown(5_425_000)).toBe("1:30:25");
    expect(formatCountdown(-5_000)).toBe("0:00");
  });

  it("formatGrowTime 按秒 / 分 / 时取整", () => {
    expect(formatGrowTime(2_000)).toBe("2 秒");
    expect(formatGrowTime(120_000)).toBe("2 分");
    expect(formatGrowTime(3_600_000)).toBe("1 时");
    expect(formatGrowTime(5_400_000)).toBe("1 时 30 分");
  });

  it("levelProgress 给出当前等级内的经验比例", () => {
    expect(levelProgress(0, rules)).toEqual({ level: 1, into: 0, span: 40, ratio: 0 });
    expect(levelProgress(20, rules)).toEqual({ level: 1, into: 20, span: 40, ratio: 0.5 });
    // 100 经验在 2 级，区间 40 → 120。
    expect(levelProgress(100, rules)).toEqual({ level: 2, into: 60, span: 80, ratio: 0.75 });
    // 满级后比例固定为 1，交给界面显示"已满级"。
    expect(levelProgress(99_999, rules)).toEqual({ level: 10, into: 0, span: 0, ratio: 1 });
  });

  it("reasonText 把服务端 reason 映射成中文提示", () => {
    expect(reasonText("server_unreachable")).toBe("后端未启动");
    expect(reasonText("stale_rev")).toBe("状态已刷新，请重试");
    expect(reasonText("version_mismatch")).toBe("存档版本不兼容，已进入只读模式");
    expect(reasonText("empty_plot")).toBe("这块地是空的");
    expect(reasonText("not_ready")).toBe("还没成熟");
    expect(reasonText("no_coins")).toBe("金币不够");
    expect(reasonText("no_gems")).toBe("宝石不够");
    expect(reasonText("silo_full")).toBe("仓库已满");
    expect(reasonText("missing_input")).toBe("原料不足");
    // 未知或缺失的 reason 回退到通用文案。
    expect(reasonText("something_new")).toBe("操作失败");
    expect(reasonText(undefined)).toBe("操作失败");
  });
});
