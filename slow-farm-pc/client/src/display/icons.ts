// emoji 图标表：全局仅此文件出现 emoji，其他模块通过下面函数取用。
const UNKNOWN_ICON = "❔";

const CROP_ICONS: Record<string, string> = {
  wheat: "🌾",
  corn: "🌽",
  carrot: "🥕",
  soybean: "🌱",
  strawberry: "🍓",
  sugarcane: "🎍",
  pumpkin: "🎃",
  lavender: "🌸",
  coffeeBean: "☕",
  cocoa: "🍫",
};

const ITEM_ICONS: Record<string, string> = {
  egg: "🥚",
  milk: "🥛",
  wool: "🧶",
  flour: "🥣",
  bread: "🍞",
  cornBread: "🌽",
  carrotJuice: "🥤",
  soyMilk: "🥛",
  sugar: "🍬",
  soySauce: "🍶",
  pumpkinJam: "🍯",
  vegCan: "🥫",
  fruitCan: "🥫",
  feed: "🌿",
  butter: "🧈",
  cheese: "🧀",
  yarn: "🧵",
  // 作物本身也是可交易的产出，沿用作物图标。
  ...CROP_ICONS,
};

const MACHINE_ICONS: Record<string, string> = {
  mill: "🌀",
  bakery: "🍞",
  juicer: "🧃",
  sugarMill: "🏭",
  sauceMill: "🍯",
  cannery: "🥫",
  feedMill: "🌿",
  dairy: "🥛",
  loom: "🧵",
};

const BUILDING_ICONS: Record<string, string> = {
  farm: "🌱",
  silo: "📦",
  machines: "🏭",
  orders: "📋",
  animals: "🐄",
  shop: "🛒",
  achievements: "🏆",
  seed: "🌰",
};

const ANIMAL_ICONS: Record<string, string> = {
  chicken: "🐔",
  cow: "🐄",
  sheep: "🐑",
};

// HUD 固定指标图标：金币、宝石、沙漏；等级用文字 Lv. 表示。
const HUD_ICONS: Record<string, string> = {
  coins: "🪙",
  gems: "💎",
  hourglass: "⏳",
};

function lookup(table: Record<string, string>, id: string): string {
  // 用 hasOwn 只认表内自有键，避免 "constructor"、"toString" 等原型链键命中。
  return Object.hasOwn(table, id) ? table[id] : UNKNOWN_ICON;
}

export function cropIcon(cropId: string): string {
  return lookup(CROP_ICONS, cropId);
}

export function itemIcon(itemId: string): string {
  return lookup(ITEM_ICONS, itemId);
}

export function machineIcon(machineId: string): string {
  return lookup(MACHINE_ICONS, machineId);
}

export function buildingIcon(key: string): string {
  return lookup(BUILDING_ICONS, key);
}

export function animalIcon(kind: string): string {
  return lookup(ANIMAL_ICONS, kind);
}

export function hudIcon(field: "coins" | "gems" | "hourglass"): string {
  return lookup(HUD_ICONS, field);
}
