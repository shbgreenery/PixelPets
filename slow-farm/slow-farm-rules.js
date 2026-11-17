'use strict';

// 慢慢农场的内容数据：物品、作物、机器、配方、等级、地块、仓库、订单、钻石。
// 本文件只有数据，不含逻辑。

const ITEMS = {
  wheat:       { name: '小麦',     sellPrice: 2,   unlockLevel: 1, category: 'crop' },
  corn:        { name: '玉米',     sellPrice: 6,  unlockLevel: 1, category: 'crop' },
  carrot:      { name: '胡萝卜',   sellPrice: 14,  unlockLevel: 2, category: 'crop' },
  soybean:     { name: '大豆',     sellPrice: 22,  unlockLevel: 3, category: 'crop' },
  flour:       { name: '面粉',     sellPrice: 12,  unlockLevel: 1, category: 'product' },
  bread:       { name: '面包',     sellPrice: 45,  unlockLevel: 2, category: 'product' },
  cornBread:   { name: '玉米面包', sellPrice: 90,  unlockLevel: 4, category: 'product' },
  carrotJuice: { name: '胡萝卜汁', sellPrice: 145, unlockLevel: 3, category: 'product' },
  soyMilk:     { name: '豆浆',     sellPrice: 320, unlockLevel: 5, category: 'product' },

  strawberry:  { name: '草莓',   sellPrice: 27,  unlockLevel: 3, category: 'crop' },
  sugarcane:   { name: '甘蔗',   sellPrice: 35,  unlockLevel: 4, category: 'crop' },
  pumpkin:     { name: '南瓜',   sellPrice: 56, unlockLevel: 5, category: 'crop' },
  lavender:    { name: '薰衣草', sellPrice: 80, unlockLevel: 6, category: 'crop' },
  coffeeBean:  { name: '咖啡豆', sellPrice: 120, unlockLevel: 7, category: 'crop' },
  cocoa:       { name: '可可',   sellPrice: 190, unlockLevel: 8, category: 'crop' },

  sugar:       { name: '糖',       sellPrice: 260, unlockLevel: 4, category: 'product' },
  soySauce:    { name: '酱油',     sellPrice: 340, unlockLevel: 6, category: 'product' },
  pumpkinJam:  { name: '南瓜酱',   sellPrice: 490, unlockLevel: 8, category: 'product' },
  vegCan:      { name: '蔬菜罐头', sellPrice: 900, unlockLevel: 8, category: 'product' },
  fruitCan:    { name: '水果罐头', sellPrice: 1020, unlockLevel: 9, category: 'product' },

  feed:        { name: '饲料',   sellPrice: 50,  unlockLevel: 3, category: 'product' },
  egg:         { name: '鸡蛋',   sellPrice: 140, unlockLevel: 4, category: 'product' },
  milk:        { name: '牛奶',   sellPrice: 320, unlockLevel: 6, category: 'product' },
  wool:        { name: '羊毛',   sellPrice: 520, unlockLevel: 7, category: 'product' },

  butter:      { name: '黄油',   sellPrice: 1000,  unlockLevel: 9,  category: 'product' },
  cheese:      { name: '奶酪',   sellPrice: 1480, unlockLevel: 10, category: 'product' },
  yarn:        { name: '毛线',   sellPrice: 1600, unlockLevel: 10, category: 'product' },
};

const CROPS = {
  wheat:   { seedPrice: 1,  growMs: 2 * 60 * 1000,  yield: 2 },
  corn:    { seedPrice: 5,  growMs: 5 * 60 * 1000,  yield: 2 },
  carrot:  { seedPrice: 10, growMs: 10 * 60 * 1000, yield: 2 },
  soybean: { seedPrice: 15, growMs: 20 * 60 * 1000, yield: 2 },
  strawberry:  { seedPrice: 20,  growMs: 30 * 60 * 1000,  yield: 2 },
  sugarcane:   { seedPrice: 25,  growMs: 40 * 60 * 1000,  yield: 2 },
  pumpkin:     { seedPrice: 40,  growMs: 60 * 60 * 1000,  yield: 2 },
  lavender:    { seedPrice: 55,  growMs: 90 * 60 * 1000,  yield: 2 },
  coffeeBean:  { seedPrice: 80,  growMs: 120 * 60 * 1000, yield: 2 },
  cocoa:       { seedPrice: 120, growMs: 180 * 60 * 1000, yield: 2 },
};

const MACHINES = {
  mill:   { name: '磨坊',   buildCost: 0,   unlockLevel: 1 },
  bakery: { name: '面包房', buildCost: 400, unlockLevel: 2 },
  juicer: { name: '榨汁机', buildCost: 900, unlockLevel: 3 },
  sugarMill: { name: '糖厂',   buildCost: 1500, unlockLevel: 4 },
  sauceMill: { name: '酱坊',   buildCost: 2500, unlockLevel: 6 },
  cannery:   { name: '罐头厂', buildCost: 4000, unlockLevel: 8 },
  feedMill:  { name: '饲料厂', buildCost: 600, unlockLevel: 3, noLadder: true },
  dairy:     { name: '乳品厂', buildCost: 5000, unlockLevel: 9 },
  loom:      { name: '纺织坊', buildCost: 6000, unlockLevel: 10 },
};

// 每台机器的生产队列：默认 6 个位置，可以花钱加到 10 个，串行生产。
const QUEUE = { initial: 6, max: 10, prices: [200, 400, 700, 1200] };

const RECIPES = {
  flour:       { name: '面粉',     machine: 'mill',   input: { wheat: 2 },           ms: 15 * 60 * 1000,  output: { flour: 1 },       unlockLevel: 1 },
  bread:       { name: '面包',     machine: 'bakery', input: { flour: 1 },           ms: 30 * 60 * 1000,  output: { bread: 1 },       unlockLevel: 2 },
  cornBread:   { name: '玉米面包', machine: 'bakery', input: { flour: 2, corn: 1 },  ms: 45 * 60 * 1000,  output: { cornBread: 1 },   unlockLevel: 4 },
  carrotJuice: { name: '胡萝卜汁', machine: 'juicer', input: { carrot: 2 },          ms: 60 * 60 * 1000,  output: { carrotJuice: 1 }, unlockLevel: 3 },
  soyMilk:     { name: '豆浆',     machine: 'juicer', input: { soybean: 2 },         ms: 120 * 60 * 1000, output: { soyMilk: 1 },     unlockLevel: 5 },
  sugar:       { name: '糖',       machine: 'sugarMill', input: { sugarcane: 2 },          ms: 60 * 60 * 1000,  output: { sugar: 1 },      unlockLevel: 4 },
  soySauce:    { name: '酱油',     machine: 'sauceMill', input: { soybean: 2, wheat: 2 },  ms: 90 * 60 * 1000,  output: { soySauce: 1 },   unlockLevel: 6 },
  pumpkinJam:  { name: '南瓜酱',   machine: 'sauceMill', input: { pumpkin: 1, sugarcane: 1 }, ms: 120 * 60 * 1000, output: { pumpkinJam: 1 }, unlockLevel: 8 },
  vegCan:      { name: '蔬菜罐头', machine: 'cannery',   input: { pumpkin: 2, sugar: 1 },  ms: 150 * 60 * 1000, output: { vegCan: 1 },     unlockLevel: 8 },
  fruitCan:    { name: '水果罐头', machine: 'cannery',   input: { strawberry: 3, sugar: 1 }, ms: 180 * 60 * 1000, output: { fruitCan: 1 }, unlockLevel: 9 },
  feed:        { name: '饲料',     machine: 'feedMill',  input: { corn: 2, wheat: 2 },     ms: 10 * 60 * 1000,  output: { feed: 1 },      unlockLevel: 3 },
  butter:      { name: '黄油',     machine: 'dairy',     input: { milk: 2 },               ms: 90 * 60 * 1000,  output: { butter: 1 },    unlockLevel: 9 },
  cheese:      { name: '奶酪',     machine: 'dairy',     input: { milk: 3 },               ms: 120 * 60 * 1000, output: { cheese: 1 },    unlockLevel: 10 },
  yarn:        { name: '毛线',     machine: 'loom',      input: { wool: 2 },               ms: 120 * 60 * 1000, output: { yarn: 1 },      unlockLevel: 10 },
};

const LEVELS = [0, 40, 120, 300, 600, 1000, 1600, 2400, 3400, 4800];

const PLOTS = {
  initial: 6,
  max: 12,
  prices: [
    { level: 2, cost: 200 },
    { level: 2, cost: 400 },
    { level: 3, cost: 800 },
    { level: 4, cost: 1500 },
    { level: 5, cost: 2500 },
    { level: 6, cost: 4000 },
  ],
};

// 仓库是格子制：每格只放一种物品，一格最多 99 个；超过 99 自动占第二格。
const SILO = {
  perSlot: 99,
  initial: 6,
  max: 18,
  prices: [100, 150, 250, 400, 600, 900, 1300, 1800, 2500, 3200, 4000, 5000],
};

const ORDERS = {
  initialSlots: 3,
  maxSlots: 5,
  slotPrices: [500, 1200],
  newbieCount: 3,
  rewardCoinMul: 1.5,
  rewardXpDivisor: 10,
  tiers: [
    { maxPrice: 5,        min: 10, max: 15 },
    { maxPrice: 20,       min: 6,  max: 10 },
    { maxPrice: 50,       min: 4,  max: 7 },
    { maxPrice: 100,      min: 3,  max: 5 },
    { maxPrice: Infinity, min: 2,  max: 3 },
  ],
};

const GEMS = {
  adReward: 5,
  adWaitMs: 3000,
  buyReward: 100,
  // 沙漏礼包：买的越多单价越便宜
  hourglassPacks: [
    { qty: 1, cost: 5 },
    { qty: 10, cost: 45 },
    { qty: 99, cost: 400 },
  ],
};

// 养殖：畜舍按种类区分，每只动物吃一份饲料产一份产品
const ANIMALS = {
  chicken: {
    name: '鸡', nameOf: '鸡', product: 'egg',
    unlockLevel: 4, price: 200, cycleMs: 20 * 60 * 1000,
    initialSlots: 4, maxSlots: 6, slotPrices: [400, 800],
  },
  cow: {
    name: '牛', nameOf: '牛', product: 'milk',
    unlockLevel: 6, price: 800, cycleMs: 60 * 60 * 1000,
    initialSlots: 4, maxSlots: 6, slotPrices: [1500, 3000],
  },
  sheep: {
    name: '羊', nameOf: '羊', product: 'wool',
    unlockLevel: 7, price: 1500, cycleMs: 45 * 60 * 1000,
    initialSlots: 4, maxSlots: 6, slotPrices: [2000, 4000],
  },
};

const SELL_RATIO = 0.7;

const START = { coins: 50, gems: 5 };

if (typeof module !== 'undefined') {
  module.exports = {
    ITEMS,
    CROPS,
    MACHINES,
    RECIPES,
    QUEUE,
    LEVELS,
    PLOTS,
    SILO,
    ORDERS,
    ANIMALS,
    GEMS,
    SELL_RATIO,
    START,
  };
}
