'use strict';

// 麦田工坊的内容数据：物品、玩家背包、地图节点与路线、奖励。
// 本文件只有数据，不含逻辑；引擎不认识「麦田」「面粉」这类业务名词。
// 工位版：无限麦田 + 每类最多三槽位，槽位编号对齐；原料送进机器输入口给送达金币。

const BEAT_MS = 1000;
const OFFLINE_CAP_MS = 8 * 60 * 60 * 1000;
const OFFLINE_EFFICIENCY = 0.5;
const OFFLINE_THRESHOLD_MS = 5000;

const ITEMS = {
  wheat: { name: '小麦' },
  flour: { name: '面粉' },
  bread: { name: '面包' },
  fish: { name: '鱼' },
  fishSlice: { name: '鱼片' },
  can: { name: '罐头' },
  beef: { name: '牛肉' },
  patty: { name: '肉饼' },
  burger: { name: '汉堡' },
  coin:  { name: '金币', ledger: true },
};

const PLAYER = {
  levels: [
    { cap: 10, cost: { coin: 0 } },
    { cap: 14, cost: { coin: 180 } },
    { cap: 18, cost: { coin: 400 } },
    { cap: 24, cost: { coin: 800 } },
    { cap: 30, cost: { ad: 'rewarded' } },
  ],
};

// 磨坊：小麦 → 面粉。输入口每送进 1 个小麦给 1 金币。
const MILL_LEVELS = [
  { beats: 2, cost: { coin: 0 },        caps: { in: { wheat: 500 }, out: { flour: 500 } }, consume: { wheat: 1 }, produce: { flour: 1 } },
  { beats: 1, cost: { coin: 120 },      caps: { in: { wheat: 500 }, out: { flour: 500 } }, consume: { wheat: 1 }, produce: { flour: 1 } },
  { beats: 1, cost: { coin: 400 },      caps: { in: { wheat: 500 }, out: { flour: 500 } }, consume: { wheat: 2 }, produce: { flour: 2 } },
  { beats: 1, cost: { ad: 'rewarded' }, caps: { in: { wheat: 500 }, out: { flour: 500 } }, consume: { wheat: 1 }, produce: { flour: 2 } },
  { beats: 1, cost: { ad: 'rewarded' }, caps: { in: { wheat: 500 }, out: { flour: 500 } }, consume: { wheat: 2 }, produce: { flour: 4 } },
];

// 面包机：面粉 → 面包。输入口每送进 1 个面粉给 2 金币。
const BAKER_LEVELS = [
  { beats: 3, cost: { coin: 0 },        caps: { in: { flour: 500 }, out: { bread: 500 } }, consume: { flour: 1 }, produce: { bread: 1 } },
  { beats: 2, cost: { coin: 150 },      caps: { in: { flour: 500 }, out: { bread: 500 } }, consume: { flour: 1 }, produce: { bread: 1 } },
  { beats: 1, cost: { coin: 500 },      caps: { in: { flour: 500 }, out: { bread: 500 } }, consume: { flour: 1 }, produce: { bread: 1 } },
  { beats: 1, cost: { ad: 'rewarded' }, caps: { in: { flour: 500 }, out: { bread: 500 } }, consume: { flour: 2 }, produce: { bread: 2 } },
  { beats: 1, cost: { ad: 'rewarded' }, caps: { in: { flour: 500 }, out: { bread: 500 } }, consume: { flour: 2 }, produce: { bread: 3 } },
];

// 面包售货台：面包 → 金币。送到售货台不给送达金币，按节拍卖出才给。
const COUNTER_LEVELS = [
  { beats: 2, cost: { coin: 0 },        caps: { in: { bread: 500 } }, consume: { bread: 1 }, produce: { coin: 4 } },
  { beats: 1, cost: { coin: 100 },      caps: { in: { bread: 500 } }, consume: { bread: 1 }, produce: { coin: 4 } },
  { beats: 1, cost: { coin: 350 },      caps: { in: { bread: 500 } }, consume: { bread: 1 }, produce: { coin: 5 } },
  { beats: 1, cost: { ad: 'rewarded' }, caps: { in: { bread: 500 } }, consume: { bread: 1 }, produce: { coin: 6 } },
  { beats: 1, cost: { ad: 'rewarded' }, caps: { in: { bread: 500 } }, consume: { bread: 1 }, produce: { coin: 7 } },
];

// 面粉售货机：面粉 → 金币。是磨坊成品的第二条出路。
const FLOUR_SHOP_LEVELS = [
  { beats: 2, cost: { coin: 0 },        caps: { in: { flour: 500 } }, consume: { flour: 1 }, produce: { coin: 2 } },
  { beats: 1, cost: { coin: 100 },      caps: { in: { flour: 500 } }, consume: { flour: 1 }, produce: { coin: 2 } },
  { beats: 1, cost: { coin: 300 },      caps: { in: { flour: 500 } }, consume: { flour: 1 }, produce: { coin: 3 } },
  { beats: 1, cost: { ad: 'rewarded' }, caps: { in: { flour: 500 } }, consume: { flour: 1 }, produce: { coin: 3 } },
  { beats: 1, cost: { ad: 'rewarded' }, caps: { in: { flour: 500 } }, consume: { flour: 1 }, produce: { coin: 4 } },
];

// 鱼线：鱼塘无限产鱼；杀鱼机产鱼片；罐头机产罐头；鱼片与罐头各有售货台。
const FISH_KILLER_LEVELS = [
  { beats: 3, cost: { coin: 0 },        caps: { in: { fish: 500 }, out: { fishSlice: 500 } }, consume: { fish: 1 }, produce: { fishSlice: 1 } },
  { beats: 2, cost: { coin: 150 },      caps: { in: { fish: 500 }, out: { fishSlice: 500 } }, consume: { fish: 1 }, produce: { fishSlice: 1 } },
  { beats: 1, cost: { coin: 500 },      caps: { in: { fish: 500 }, out: { fishSlice: 500 } }, consume: { fish: 1 }, produce: { fishSlice: 1 } },
  { beats: 1, cost: { ad: 'rewarded' }, caps: { in: { fish: 500 }, out: { fishSlice: 500 } }, consume: { fish: 1 }, produce: { fishSlice: 2 } },
  { beats: 1, cost: { ad: 'rewarded' }, caps: { in: { fish: 500 }, out: { fishSlice: 500 } }, consume: { fish: 1 }, produce: { fishSlice: 3 } },
];

const CANNER_LEVELS = [
  { beats: 3, cost: { coin: 0 },        caps: { in: { fishSlice: 500 }, out: { can: 500 } }, consume: { fishSlice: 1 }, produce: { can: 1 } },
  { beats: 2, cost: { coin: 180 },      caps: { in: { fishSlice: 500 }, out: { can: 500 } }, consume: { fishSlice: 1 }, produce: { can: 1 } },
  { beats: 2, cost: { coin: 550 },      caps: { in: { fishSlice: 500 }, out: { can: 500 } }, consume: { fishSlice: 2 }, produce: { can: 2 } },
  { beats: 1, cost: { ad: 'rewarded' }, caps: { in: { fishSlice: 500 }, out: { can: 500 } }, consume: { fishSlice: 1 }, produce: { can: 2 } },
  { beats: 1, cost: { ad: 'rewarded' }, caps: { in: { fishSlice: 500 }, out: { can: 500 } }, consume: { fishSlice: 2 }, produce: { can: 3 } },
];

const CAN_SHOP_LEVELS = [
  { beats: 2, cost: { coin: 0 },        caps: { in: { can: 500 } }, consume: { can: 1 }, produce: { coin: 6 } },
  { beats: 1, cost: { coin: 120 },      caps: { in: { can: 500 } }, consume: { can: 1 }, produce: { coin: 6 } },
  { beats: 1, cost: { coin: 400 },      caps: { in: { can: 500 } }, consume: { can: 1 }, produce: { coin: 7 } },
  { beats: 1, cost: { ad: 'rewarded' }, caps: { in: { can: 500 } }, consume: { can: 1 }, produce: { coin: 8 } },
  { beats: 1, cost: { ad: 'rewarded' }, caps: { in: { can: 500 } }, consume: { can: 1 }, produce: { coin: 9 } },
];

const FISH_SLICE_SHOP_LEVELS = [
  { beats: 2, cost: { coin: 0 },        caps: { in: { fishSlice: 500 } }, consume: { fishSlice: 1 }, produce: { coin: 2 } },
  { beats: 1, cost: { coin: 100 },      caps: { in: { fishSlice: 500 } }, consume: { fishSlice: 1 }, produce: { coin: 2 } },
  { beats: 1, cost: { coin: 300 },      caps: { in: { fishSlice: 500 } }, consume: { fishSlice: 1 }, produce: { coin: 3 } },
  { beats: 1, cost: { ad: 'rewarded' }, caps: { in: { fishSlice: 500 } }, consume: { fishSlice: 1 }, produce: { coin: 3 } },
  { beats: 1, cost: { ad: 'rewarded' }, caps: { in: { fishSlice: 500 } }, consume: { fishSlice: 1 }, produce: { coin: 4 } },
];

// 汉堡线：牧场无限产牛肉；绞肉机产肉饼；汉堡机煎汉堡；汉堡售货台卖出。
const GRINDER_LEVELS = [
  { beats: 3, cost: { coin: 0 },        caps: { in: { beef: 500 }, out: { patty: 500 } }, consume: { beef: 1 }, produce: { patty: 1 } },
  { beats: 2, cost: { coin: 150 },      caps: { in: { beef: 500 }, out: { patty: 500 } }, consume: { beef: 1 }, produce: { patty: 1 } },
  { beats: 1, cost: { coin: 500 },      caps: { in: { beef: 500 }, out: { patty: 500 } }, consume: { beef: 1 }, produce: { patty: 1 } },
  { beats: 1, cost: { ad: 'rewarded' }, caps: { in: { beef: 500 }, out: { patty: 500 } }, consume: { beef: 1 }, produce: { patty: 2 } },
  { beats: 1, cost: { ad: 'rewarded' }, caps: { in: { beef: 500 }, out: { patty: 500 } }, consume: { beef: 1 }, produce: { patty: 3 } },
];

const BURGER_LEVELS = [
  { beats: 3, cost: { coin: 0 },        caps: { in: { patty: 500 }, out: { burger: 500 } }, consume: { patty: 1 }, produce: { burger: 1 } },
  { beats: 2, cost: { coin: 180 },      caps: { in: { patty: 500 }, out: { burger: 500 } }, consume: { patty: 1 }, produce: { burger: 1 } },
  { beats: 2, cost: { coin: 550 },      caps: { in: { patty: 500 }, out: { burger: 500 } }, consume: { patty: 2 }, produce: { burger: 2 } },
  { beats: 1, cost: { ad: 'rewarded' }, caps: { in: { patty: 500 }, out: { burger: 500 } }, consume: { patty: 1 }, produce: { burger: 2 } },
  { beats: 1, cost: { ad: 'rewarded' }, caps: { in: { patty: 500 }, out: { burger: 500 } }, consume: { patty: 2 }, produce: { burger: 3 } },
];

const BURGER_SHOP_LEVELS = [
  { beats: 2, cost: { coin: 0 },        caps: { in: { burger: 500 } }, consume: { burger: 1 }, produce: { coin: 8 } },
  { beats: 1, cost: { coin: 120 },      caps: { in: { burger: 500 } }, consume: { burger: 1 }, produce: { coin: 8 } },
  { beats: 1, cost: { coin: 400 },      caps: { in: { burger: 500 } }, consume: { burger: 1 }, produce: { coin: 9 } },
  { beats: 1, cost: { ad: 'rewarded' }, caps: { in: { burger: 500 } }, consume: { burger: 1 }, produce: { coin: 10 } },
  { beats: 1, cost: { ad: 'rewarded' }, caps: { in: { burger: 500 } }, consume: { burger: 1 }, produce: { coin: 12 } },
];

// 每个工人独立升级速度与背包；基础值从这里起步。中后期档位用广告。
const WORKER = {
  speed: 3,
  backpack: 1,
  speedLevels: [
    { beats: 2, cost: { coin: 100 } },
    { beats: 1, cost: { ad: 'rewarded' } },
  ],
  backpackLevels: [
    { backpack: 2, cost: { coin: 120 } },
    { backpack: 3, cost: { coin: 400 } },
    { backpack: 4, cost: { ad: 'rewarded' } },
    { backpack: 5, cost: { ad: 'rewarded' } },
  ],
};

// 激励广告配置：本地用 mock 播放，未来替换成微信激励视频。
const AD = {
  coins: 100,
  placement: 'rewarded',
  mockSeconds: 3,
};

function millSlot(n, unlock) {
  return {
    name: '磨坊 ' + n,
    kind: 'mill',
    in: [{ key: 'wheat', item: 'wheat', coin: 1 }],
    out: [{ key: 'flour', item: 'flour' }],
    levels: MILL_LEVELS,
    unlock: { coin: unlock },
  };
}

function bakerSlot(n, unlock) {
  return {
    name: '面包机 ' + n,
    kind: 'baker',
    in: [{ key: 'flour', item: 'flour', coin: 2 }],
    out: [{ key: 'bread', item: 'bread' }],
    levels: BAKER_LEVELS,
    unlock: { coin: unlock },
  };
}

function counterSlot(n, unlock) {
  return {
    name: '面包售货台 ' + n,
    kind: 'counter',
    in: [{ key: 'bread', item: 'bread' }],
    out: [],
    levels: COUNTER_LEVELS,
    unlock: { coin: unlock },
  };
}

function flourShopSlot(n, unlock) {
  return {
    name: '面粉售货机 ' + n,
    kind: 'flourShop',
    in: [{ key: 'flour', item: 'flour' }],
    out: [],
    levels: FLOUR_SHOP_LEVELS,
    unlock: { coin: unlock },
  };
}

function sourceNode(name, kind, item) {
  return { name: name, kind: kind, source: true, in: [], out: [{ key: item, item: item }] };
}

function machineSlot(n, kind, name, inItem, outItem, levels, unlock, coin) {
  return {
    name: name + ' ' + n,
    kind: kind,
    in: [{ key: inItem, item: inItem, coin: coin }],
    out: [{ key: outItem, item: outItem }],
    levels: levels,
    unlock: { coin: unlock },
  };
}

function shopSlot(n, kind, name, item, levels, unlock) {
  return {
    name: name + ' ' + n,
    kind: kind,
    in: [{ key: item, item: item }],
    out: [],
    levels: levels,
    unlock: { coin: unlock },
  };
}

const MAPS = {
  farm: {
    name: '农场',
    unlock: { coin: 0 },
    nodes: {
      field: {
        name: '麦田',
        kind: 'field',
        source: true,
        in: [],
        out: [{ key: 'wheat', item: 'wheat' }],
      },
      mill1: millSlot(1, 0),
      mill2: millSlot(2, 120),
      mill3: millSlot(3, 240),
      baker1: bakerSlot(1, 60),
      baker2: bakerSlot(2, 120),
      baker3: bakerSlot(3, 240),
      counter1: counterSlot(1, 80),
      counter2: counterSlot(2, 160),
      counter3: counterSlot(3, 320),
      flourShop1: flourShopSlot(1, 80),
      flourShop2: flourShopSlot(2, 200),
      flourShop3: flourShopSlot(3, 500),
      fishPond: sourceNode('鱼塘', 'fishPond', 'fish'),
      fishKiller1: machineSlot(1, 'fishKiller', '杀鱼机', 'fish', 'fishSlice', FISH_KILLER_LEVELS, 0, 1),
      fishKiller2: machineSlot(2, 'fishKiller', '杀鱼机', 'fish', 'fishSlice', FISH_KILLER_LEVELS, 150, 1),
      fishKiller3: machineSlot(3, 'fishKiller', '杀鱼机', 'fish', 'fishSlice', FISH_KILLER_LEVELS, 350, 1),
      canner1: machineSlot(1, 'canner', '罐头机', 'fishSlice', 'can', CANNER_LEVELS, 200, 2),
      canner2: machineSlot(2, 'canner', '罐头机', 'fishSlice', 'can', CANNER_LEVELS, 450, 2),
      canner3: machineSlot(3, 'canner', '罐头机', 'fishSlice', 'can', CANNER_LEVELS, 900, 2),
      canShop1: shopSlot(1, 'canShop', '罐头售货台', 'can', CAN_SHOP_LEVELS, 150),
      canShop2: shopSlot(2, 'canShop', '罐头售货台', 'can', CAN_SHOP_LEVELS, 350),
      canShop3: shopSlot(3, 'canShop', '罐头售货台', 'can', CAN_SHOP_LEVELS, 700),
      fishSliceShop1: shopSlot(1, 'fishSliceShop', '鱼片售货机', 'fishSlice', FISH_SLICE_SHOP_LEVELS, 80),
      fishSliceShop2: shopSlot(2, 'fishSliceShop', '鱼片售货机', 'fishSlice', FISH_SLICE_SHOP_LEVELS, 200),
      fishSliceShop3: shopSlot(3, 'fishSliceShop', '鱼片售货机', 'fishSlice', FISH_SLICE_SHOP_LEVELS, 500),
      ranch: sourceNode('牧场', 'ranch', 'beef'),
      grinder1: machineSlot(1, 'grinder', '绞肉机', 'beef', 'patty', GRINDER_LEVELS, 0, 1),
      grinder2: machineSlot(2, 'grinder', '绞肉机', 'beef', 'patty', GRINDER_LEVELS, 150, 1),
      grinder3: machineSlot(3, 'grinder', '绞肉机', 'beef', 'patty', GRINDER_LEVELS, 350, 1),
      burgerMaker1: machineSlot(1, 'burgerMaker', '汉堡机', 'patty', 'burger', BURGER_LEVELS, 250, 2),
      burgerMaker2: machineSlot(2, 'burgerMaker', '汉堡机', 'patty', 'burger', BURGER_LEVELS, 500, 2),
      burgerMaker3: machineSlot(3, 'burgerMaker', '汉堡机', 'patty', 'burger', BURGER_LEVELS, 1000, 2),
      burgerShop1: shopSlot(1, 'burgerShop', '汉堡售货台', 'burger', BURGER_SHOP_LEVELS, 200),
      burgerShop2: shopSlot(2, 'burgerShop', '汉堡售货台', 'burger', BURGER_SHOP_LEVELS, 450),
      burgerShop3: shopSlot(3, 'burgerShop', '汉堡售货台', 'burger', BURGER_SHOP_LEVELS, 900),
    },
    routes: {
      farmers: {
        name: '农民',
        desc: '麦田 → 所有磨坊来料池',
        fromKind: 'field', toKind: 'mill', toSide: 'in', item: 'wheat',
        hire: { base: 15, growth: 1.6 }, worker: WORKER,
      },
      porters: {
        name: '搬运工',
        desc: '磨坊成品 → 所有面包机来料池',
        fromKind: 'mill', fromSide: 'out', toKind: 'baker', toSide: 'in', item: 'flour',
        hire: { base: 18, growth: 1.6 }, worker: WORKER,
      },
      breadWorkers: {
        name: '面包工',
        desc: '面包成品 → 所有售货台来料池',
        fromKind: 'baker', fromSide: 'out', toKind: 'counter', toSide: 'in', item: 'bread',
        hire: { base: 20, growth: 1.6 }, worker: WORKER,
      },
      flourPorters: {
        name: '面粉搬运工',
        desc: '磨坊成品 → 所有面粉售货机',
        fromKind: 'mill', fromSide: 'out', toKind: 'flourShop', toSide: 'in', item: 'flour',
        hire: { base: 15, growth: 1.6 }, worker: WORKER,
      },
      fishermen: {
        name: '渔民',
        desc: '鱼塘 → 所有杀鱼机来料池',
        fromKind: 'fishPond', fromSide: 'out', toKind: 'fishKiller', toSide: 'in', item: 'fish',
        hire: { base: 18, growth: 1.6 }, worker: WORKER,
      },
      fishPorters: {
        name: '鱼片搬运工',
        desc: '杀鱼机成品 → 所有罐头机来料池',
        fromKind: 'fishKiller', fromSide: 'out', toKind: 'canner', toSide: 'in', item: 'fishSlice',
        hire: { base: 20, growth: 1.6 }, worker: WORKER,
      },
      canWorkers: {
        name: '罐头工',
        desc: '罐头成品 → 所有罐头售货台',
        fromKind: 'canner', fromSide: 'out', toKind: 'canShop', toSide: 'in', item: 'can',
        hire: { base: 22, growth: 1.6 }, worker: WORKER,
      },
      sliceVendors: {
        name: '鱼片上架工',
        desc: '杀鱼机成品 → 所有鱼片售货机',
        fromKind: 'fishKiller', fromSide: 'out', toKind: 'fishSliceShop', toSide: 'in', item: 'fishSlice',
        hire: { base: 18, growth: 1.6 }, worker: WORKER,
      },
      ranchers: {
        name: '牧场工',
        desc: '牧场 → 所有绞肉机来料池',
        fromKind: 'ranch', fromSide: 'out', toKind: 'grinder', toSide: 'in', item: 'beef',
        hire: { base: 20, growth: 1.6 }, worker: WORKER,
      },
      pattyPorters: {
        name: '肉饼搬运工',
        desc: '绞肉机成品 → 所有汉堡机来料池',
        fromKind: 'grinder', fromSide: 'out', toKind: 'burgerMaker', toSide: 'in', item: 'patty',
        hire: { base: 22, growth: 1.6 }, worker: WORKER,
      },
      burgerWorkers: {
        name: '汉堡工',
        desc: '汉堡成品 → 所有汉堡售货台',
        fromKind: 'burgerMaker', fromSide: 'out', toKind: 'burgerShop', toSide: 'in', item: 'burger',
        hire: { base: 24, growth: 1.6 }, worker: WORKER,
      },
    },
  },
};

// 任务链：条件全部满足后领取金币，领取后解锁 requires 指向它的后续任务。
const QUESTS = [
  { id: 'q_harvest', title: '收下第一把麦子', desc: '在麦田取麦，装满手边背包。', guide: 'farm', requires: [],
    conditions: [{ type: 'bag', item: 'wheat', count: 10 }], reward: { coins: 20 } },
  { id: 'q_build_mill', title: '建第一台磨坊', desc: '磨坊把小麦磨成面粉。', guide: 'mills', requires: ['q_harvest'],
    conditions: [{ type: 'machineCount', kind: 'mill', count: 1 }], reward: { coins: 30 } },
  { id: 'q_deliver', title: '把麦子送进磨坊', desc: '手动或雇农民，把小麦送进磨坊来料池。', guide: 'mills', requires: ['q_build_mill'],
    conditions: [{ type: 'delivered', item: 'wheat', count: 10 }], reward: { coins: 40 } },
  { id: 'q_hire', title: '雇第一个农民', desc: '去中介处雇一个农民，让麦子自己流起来。', guide: 'agency', requires: ['q_deliver'],
    conditions: [{ type: 'hire', route: 'farmers', count: 1 }], reward: { coins: 60 } },
  { id: 'q_baker', title: '建一台面包机', desc: '面粉送进面包机，烤成面包。', guide: 'bakers', requires: ['q_hire'],
    conditions: [{ type: 'machineCount', kind: 'baker', count: 1 }], reward: { coins: 100 } },
  { id: 'q_sell', title: '卖出第一个面包', desc: '把面包送到面包售货台，按节拍卖出。', guide: 'counters', requires: ['q_baker'],
    conditions: [{ type: 'sell', item: 'bread', count: 1 }], reward: { coins: 120 } },
  { id: 'q_level', title: '把磨坊升到 2 级', desc: '升一级磨坊，让制粉更快。', guide: 'mills', requires: ['q_sell'],
    conditions: [{ type: 'machineLevel', kind: 'mill', level: 2, count: 1 }], reward: { coins: 150 } },
  { id: 'q_workers', title: '两个农民到 2 级', desc: '在中介处分别升级两个农民的速度或背包，达到 2 级。', guide: 'agency', requires: ['q_level'],
    conditions: [{ type: 'hireLevel', route: 'farmers', level: 2, count: 2 }], reward: { coins: 200 } },
  { id: 'q_fish_build', title: '建第一台杀鱼机', desc: '鱼塘的鱼送进杀鱼机，切成鱼片。', guide: 'fishKillers', requires: ['q_workers'],
    conditions: [{ type: 'machineCount', kind: 'fishKiller', count: 1 }], reward: { coins: 250 } },
  { id: 'q_fish_deliver', title: '把鱼送进杀鱼机', desc: '雇渔民或手动搬运，把鱼送进杀鱼机来料池。', guide: 'fishKillers', requires: ['q_fish_build'],
    conditions: [{ type: 'delivered', item: 'fish', count: 10 }], reward: { coins: 300 } },
  { id: 'q_can_build', title: '建一台罐头机', desc: '鱼片送进罐头机，装成罐头。', guide: 'canners', requires: ['q_fish_deliver'],
    conditions: [{ type: 'machineCount', kind: 'canner', count: 1 }], reward: { coins: 350 } },
  { id: 'q_can_sell', title: '卖出第一个罐头', desc: '把罐头送到罐头售货台，按节拍卖出。', guide: 'canShops', requires: ['q_can_build'],
    conditions: [{ type: 'sell', item: 'can', count: 1 }], reward: { coins: 450 } },
  { id: 'q_burger_build', title: '建第一台绞肉机', desc: '牧场的牛肉送进绞肉机，绞成肉饼。', guide: 'grinders', requires: ['q_can_sell'],
    conditions: [{ type: 'machineCount', kind: 'grinder', count: 1 }], reward: { coins: 500 } },
  { id: 'q_burger_deliver', title: '把牛肉送进绞肉机', desc: '雇牧场工或手动搬运，把牛肉送进绞肉机来料池。', guide: 'grinders', requires: ['q_burger_build'],
    conditions: [{ type: 'delivered', item: 'beef', count: 10 }], reward: { coins: 550 } },
  { id: 'q_burger_make', title: '建一台汉堡机', desc: '肉饼送进汉堡机，煎成汉堡。', guide: 'burgerMakers', requires: ['q_burger_deliver'],
    conditions: [{ type: 'machineCount', kind: 'burgerMaker', count: 1 }], reward: { coins: 650 } },
  { id: 'q_burger_sell', title: '卖出第一个汉堡', desc: '把汉堡送到汉堡售货台，按节拍卖出。', guide: 'burgerShops', requires: ['q_burger_make'],
    conditions: [{ type: 'sell', item: 'burger', count: 1 }], reward: { coins: 800 } },
];

const LINES = {
  bread: {
    name: '面包线',
    stages: [
      { key: 'farm', name: '麦田', nodes: ['field'] },
      { key: 'mills', name: '磨坊', nodes: ['mill1', 'mill2', 'mill3'] },
      { key: 'bakers', name: '面包机', nodes: ['baker1', 'baker2', 'baker3'] },
      { key: 'counters', name: '面包售货台', nodes: ['counter1', 'counter2', 'counter3'] },
      { key: 'flourShops', name: '面粉售货机', nodes: ['flourShop1', 'flourShop2', 'flourShop3'] },
    ],
  },
  fish: {
    name: '鱼线',
    stages: [
      { key: 'fishPond', name: '鱼塘', nodes: ['fishPond'] },
      { key: 'fishKillers', name: '杀鱼机', nodes: ['fishKiller1', 'fishKiller2', 'fishKiller3'] },
      { key: 'canners', name: '罐头机', nodes: ['canner1', 'canner2', 'canner3'] },
      { key: 'canShops', name: '罐头售货台', nodes: ['canShop1', 'canShop2', 'canShop3'] },
      { key: 'fishSliceShops', name: '鱼片售货机', nodes: ['fishSliceShop1', 'fishSliceShop2', 'fishSliceShop3'] },
    ],
  },
  burger: {
    name: '汉堡线',
    stages: [
      { key: 'ranch', name: '牧场', nodes: ['ranch'] },
      { key: 'grinders', name: '绞肉机', nodes: ['grinder1', 'grinder2', 'grinder3'] },
      { key: 'burgerMakers', name: '汉堡机', nodes: ['burgerMaker1', 'burgerMaker2', 'burgerMaker3'] },
      { key: 'burgerShops', name: '汉堡售货台', nodes: ['burgerShop1', 'burgerShop2', 'burgerShop3'] },
    ],
  },
};

const REWARDS = {
  luckyMerchant: { cost: { ad: 'rewarded' }, grant: { coins: 100 } },
};

if (typeof module !== 'undefined') {
  module.exports = {
    BEAT_MS,
    OFFLINE_CAP_MS,
    OFFLINE_EFFICIENCY,
    OFFLINE_THRESHOLD_MS,
    ITEMS,
    PLAYER,
    MAPS,
    LINES,
    REWARDS,
    QUESTS,
    AD,
  };
}
