import type { Rules } from "../api/client";

// 种子选择项：名称、解锁等级、种子价与成熟时长都来自服务端下发的规则表。
export interface SeedOption {
  cropId: string;
  name: string;
  unlockLevel: number;
  seedPrice: number;
  // 成熟时长，种子条上直接展示。
  growMs: number;
  // 当前等级尚未解锁。
  locked: boolean;
}

// 按规则表的作物顺序生成种子列表，只做展示换算，不修改状态。
export function seedOptions(rules: Rules, level: number): SeedOption[] {
  return Object.entries(rules.CROPS).map(([cropId, crop]) => {
    const item = rules.ITEMS[cropId];
    const unlockLevel = item?.unlockLevel ?? 1;
    return {
      cropId,
      name: item?.name ?? cropId,
      unlockLevel,
      seedPrice: crop.seedPrice,
      growMs: crop.growMs,
      locked: level < unlockLevel,
    };
  });
}

// 默认选中第一个已解锁作物；全部锁定时返回 null。
export function defaultCropId(options: SeedOption[]): string | null {
  return options.find((option) => !option.locked)?.cropId ?? null;
}
