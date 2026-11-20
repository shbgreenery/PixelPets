'use strict';

const assert = require('assert');
const rules = require('./slow-farm-rules.js');
const core = require('./slow-farm-core.js');

assert.strictEqual(core.validateContent(rules), true, '真实内容应通过校验');

// 配方产出引用了不存在的物品
const badOutput = JSON.parse(JSON.stringify(rules));
delete badOutput.ITEMS.bread;
assert.throws(() => core.validateContent(badOutput), /bread/, '产出物品未知应被拦截');

// 机器利润未随解锁等级递增：把面粉调到 1 分钟，它的每小时利润会超过面包房
const badProfit = JSON.parse(JSON.stringify(rules));
badProfit.RECIPES.flour.ms = 60 * 1000;
assert.throws(() => core.validateContent(badProfit), /利润/, '机器利润率必须随解锁等级递增');

// 订单分档必须覆盖到无限大
const badTier = JSON.parse(JSON.stringify(rules));
badTier.ORDERS.tiers = badTier.ORDERS.tiers.slice(0, -1);
assert.throws(() => core.validateContent(badTier), /分档/, '最高档必须覆盖 Infinity');

console.log('slow-farm-rules 通过');

// 新档：初始资源、6 块地、只有磨坊已建
const s = core.createState(rules, () => 0);
assert.strictEqual(s.coins, 50);
assert.strictEqual(s.gems, 5);
assert.strictEqual(s.xp, 0);
assert.strictEqual(s.plots.length, 6);
assert.strictEqual(s.plots[0].cropId, null);
assert.strictEqual(s.machines.mill.unlocked, true);
assert.strictEqual(s.machines.bakery.unlocked, false);
assert.strictEqual(s.machines.juicer.unlocked, false);
assert.strictEqual(s.siloSlots, rules.SILO.initial);

// 等级
assert.strictEqual(core.levelOf(0, rules), 1);
assert.strictEqual(core.levelOf(39, rules), 1);
assert.strictEqual(core.levelOf(40, rules), 2);
assert.strictEqual(core.levelOf(1000, rules), 6);
assert.strictEqual(core.levelOf(999999, rules), rules.LEVELS.length, '超过封顶取最高级');

// 仓库：格子制，一格一种物品、数量不设上限，默认 30 格
assert.strictEqual(rules.SILO.initial, 30, '默认仓库 30 格');
assert.strictEqual(core.siloCap(s), rules.SILO.initial);
assert.strictEqual(core.siloSlotsUsed(s), 0);
assert.strictEqual(core.siloSlotsFree(s), rules.SILO.initial);
s.silo = { wheat: 4, bread: 2 };
assert.strictEqual(core.siloSlotsUsed(s), 2, '两种物品占两格');
s.silo = { wheat: 179 };
assert.strictEqual(core.siloSlotsUsed(s), 1, '同一种物品数量再多也只占一格');

// 时间工具：时钟回拨时剩余时间钳到 0
assert.strictEqual(core.remainingMs(5000, 1000), 4000);
assert.strictEqual(core.remainingMs(1000, 5000), 0, '已过期应为 0 不是负数');
assert.strictEqual(core.formatDuration(0), '0:00');
assert.strictEqual(core.formatDuration(65000), '1:05');
assert.strictEqual(core.formatDuration(3723000), '1:02:03');

// hydrate：旧档缺字段要补齐，未知物品要丢弃
const broken = { coins: 7 };
core.hydrate(broken, rules);
assert.strictEqual(broken.coins, 7);
assert.strictEqual(broken.plots.length, 6);
assert.strictEqual(broken.machines.mill.unlocked, true);
assert.deepStrictEqual(broken.silo, {});

// hydrate：地块里残留已删除的作物 id，要重置为空地
const stale = core.createState(rules, () => 0);
stale.plots[0] = { id: 1, cropId: 'ghostCrop', plantedAt: 0, readyAt: 1 };
stale.silo = { wheat: 3, phantom: 9 };
core.hydrate(stale, rules);
assert.strictEqual(stale.plots[0].cropId, null);
assert.strictEqual(stale.silo.wheat, 3);
assert.strictEqual(stale.silo.phantom, undefined, '未知物品应被丢弃');

console.log('slow-farm-state 通过');

const farm = core.createState(rules, () => 0);
farm.coins = 100;

// 播种：现种现买，扣种子钱，写入绝对时间戳
let r = core.plant(farm, 0, 'wheat', 1000, rules);
assert.deepStrictEqual(r, { ok: true });
assert.strictEqual(farm.plots[0].cropId, 'wheat');
assert.strictEqual(farm.plots[0].plantedAt, 1000);
assert.strictEqual(farm.plots[0].readyAt, 1000 + 2 * 60 * 1000);
assert.strictEqual(farm.coins, 99, '小麦种子 1 金币');

// 已经种了不能再种
r = core.plant(farm, 0, 'wheat', 1000, rules);
assert.strictEqual(r.reason, 'plot_occupied');
assert.strictEqual(farm.coins, 99, '失败不应扣钱');

// 等级不足
r = core.plant(farm, 1, 'carrot', 1000, rules);
assert.strictEqual(r.reason, 'locked');

// 钱不够
const broke = core.createState(rules, () => 0);
broke.coins = 0;
r = core.plant(broke, 0, 'wheat', 1000, rules);
assert.strictEqual(r.reason, 'no_coins');
assert.strictEqual(broke.plots[0].cropId, null, '买不起不能种下');

// 未成熟不能收
r = core.harvest(farm, 0, 1000 + 2 * 60 * 1000 - 1, rules);
assert.strictEqual(r.reason, 'not_ready');
assert.strictEqual(farm.plots[0].cropId, 'wheat', '失败不应清空地块');

// 到点能收，进仓库并加经验
r = core.harvest(farm, 0, 1000 + 2 * 60 * 1000, rules);
assert.deepStrictEqual(r, { ok: true, itemId: 'wheat', qty: 2 }, '一棵收两个');
assert.strictEqual(farm.silo.wheat, 2);
assert.strictEqual(farm.xp, 1);
assert.strictEqual(farm.plots[0].cropId, null);

// 仓库格满的边界：一格已被玉米占住，再收小麦是另一种物品，需要新格
const tight = core.createState(rules, () => 0);
tight.siloSlots = 1;
tight.coins = 100;
tight.silo = { corn: 99 };
core.plant(tight, 0, 'wheat', 0, rules);
core.plant(tight, 1, 'wheat', 0, rules);
r = core.harvest(tight, 0, 2 * 60 * 1000, rules);
assert.strictEqual(r.reason, 'silo_full', '没有空格不能放新物品');
assert.strictEqual(tight.plots[0].cropId, 'wheat', '被拒时作物留在地里');

// 同一种物品一直叠在原来的格子里，数量不受上限
tight.silo = { wheat: 96 };
r = core.harvest(tight, 0, 2 * 60 * 1000, rules);
assert.strictEqual(r.ok, true, '同种物品仍占一格');
assert.strictEqual(tight.silo.wheat, 98);
r = core.harvest(tight, 1, 2 * 60 * 1000, rules);
assert.strictEqual(r.ok, true, '再收一份也不占新格');
assert.strictEqual(tight.silo.wheat, 100);

console.log('slow-farm-plant 通过');

const shop = core.createState(rules, () => 0);
shop.coins = 500;
shop.silo = { wheat: 4 };

// 未建机器
let j = core.enqueue(shop, 'bakery', 'bread', 0, rules);
assert.strictEqual(j.reason, 'machine_locked');

// 配方不属于这台机器
j = core.enqueue(shop, 'mill', 'bread', 0, rules);
assert.strictEqual(j.reason, 'wrong_machine');

// 没解锁的配方不能生产
j = core.enqueue(shop, 'mill', 'flour', 1000, rules);
assert.strictEqual(j.reason, 'recipe_locked');

// 解锁后入队：扣原料，写时间戳
core.unlockRecipe(shop, 'flour', rules);
j = core.enqueue(shop, 'mill', 'flour', 1000, rules);
assert.strictEqual(j.ok, true);
assert.strictEqual(shop.silo.wheat, 2);
assert.strictEqual(shop.machines.mill.queue.length, 1);
assert.strictEqual(shop.machines.mill.queue[0].readyAt, 1000 + 15 * 60 * 1000);

// 第二个自动排在第一个后面，串行
j = core.enqueue(shop, 'mill', 'flour', 1000, rules);
assert.strictEqual(j.ok, true);
assert.strictEqual(shop.machines.mill.queue[1].startedAt, 1000 + 15 * 60 * 1000);

// 未到点不能收
let c = core.collectReady(shop, 'mill', 1000 + 15 * 60 * 1000 - 1, rules);
assert.strictEqual(c.reason, 'not_ready');

// 到点收成品
c = core.collectReady(shop, 'mill', 1000 + 15 * 60 * 1000, rules);
assert.deepStrictEqual(c.items, { flour: 1 });
assert.strictEqual(c.collected, 1);
assert.strictEqual(shop.silo.flour, 1);
assert.strictEqual(shop.machines.mill.queue.length, 1, '第二个还在队列里');

// 队列满了不能再加
const full = core.createState(rules, () => 0);
full.coins = 5000;
full.silo = { wheat: 999 };
core.unlockRecipe(full, 'flour', rules);
for (let i = 0; i < rules.QUEUE.initial; i += 1) {
  assert.strictEqual(core.enqueue(full, 'mill', 'flour', 0, rules).ok, true);
}
assert.strictEqual(core.enqueue(full, 'mill', 'flour', 0, rules).reason, 'queue_full');

// 加位后能多排
full.coins = 5000;
assert.strictEqual(core.buyQueueSlot(full, 'mill', rules).ok, true);
assert.strictEqual(full.machines.mill.queueSize, rules.QUEUE.initial + 1);
assert.strictEqual(core.enqueue(full, 'mill', 'flour', 0, rules).ok, true);

// 仓库满时拒绝收取，成品留在队列里
const packed = core.createState(rules, () => 0);
packed.siloSlots = 2;
packed.silo = { flour: 1 };
packed.xp = 40;
packed.machines.bakery.unlocked = true;
core.unlockRecipe(packed, 'bread', rules);
assert.strictEqual(core.enqueue(packed, 'bakery', 'bread', 0, rules).ok, true);
packed.silo = { corn: 99, wheat: 99 };
c = core.collectReady(packed, 'bakery', 30 * 60 * 1000, rules);
assert.strictEqual(c.skipped, 1);
assert.strictEqual(packed.machines.bakery.queue.length, 1, '收不下就留在队列里');

// 缺原料
const poor = core.createState(rules, () => 0);
poor.silo = { wheat: 1 };
core.unlockRecipe(poor, 'flour', rules);
j = core.enqueue(poor, 'mill', 'flour', 0, rules);
assert.strictEqual(j.reason, 'missing_input');
assert.strictEqual(poor.silo.wheat, 1, '失败不应扣原料');

console.log('slow-farm-machine 通过');

// 新档带满 3 张订单，且前 3 张只出作物
const board = core.createState(rules, () => 0);
assert.strictEqual(board.orders.length, rules.ORDERS.initialSlots);
for (const order of board.orders) {
  assert.ok(order.lines.length >= 1 && order.lines.length <= 2);
  for (const line of order.lines) {
    assert.strictEqual(rules.ITEMS[line.itemId].category, 'crop',
      '新手前三单不应出现成品');
  }
}

// 奖励公式：金币 = floor(货值 * 1.5)，经验 = ceil(货值 / 10)
// 小麦单价 3，要 10 个 -> 货值 30 -> 金币 45，经验 3
const board2 = core.createState(rules, () => 0);
board2.orders = [{ id: 'o1', lines: [{ itemId: 'wheat', quantity: 10 }], coins: 45, xp: 3 }];
board2.ordersGenerated = 10;
board2.silo = { wheat: 9 };
let d = core.deliverOrder(board2, 'o1', rules, () => 0);
assert.strictEqual(d.reason, 'missing_items');
assert.strictEqual(board2.coins, 50, '缺货不应扣款');
assert.strictEqual(board2.silo.wheat, 9, '缺货不应扣货');

board2.silo.wheat = 10;
d = core.deliverOrder(board2, 'o1', rules, () => 0);
assert.deepStrictEqual(d, { ok: true, coins: 45, xp: 3 });
assert.strictEqual(board2.coins, 95);
assert.strictEqual(board2.xp, 3);
assert.strictEqual(board2.silo.wheat, 0);
assert.strictEqual(board2.orders.length, 1, '旧单移除后应补一张新单');

// 订单位：默认 3 个，可买到 5 个，买完立刻多一张单
const board3 = core.createState(rules, () => 0);
board3.coins = 1000;
assert.strictEqual(board3.orders.length, rules.ORDERS.initialSlots);
assert.deepStrictEqual(core.buyOrderSlot(board3, rules, () => 0), { ok: true });
assert.strictEqual(board3.orderSlots, rules.ORDERS.initialSlots + 1);
assert.strictEqual(board3.orders.length, rules.ORDERS.initialSlots + 1, '新位立即来一张单');
assert.strictEqual(board3.coins, 500);
board3.coins = 2000;
core.buyOrderSlot(board3, rules, () => 0);
assert.strictEqual(board3.orderSlots, rules.ORDERS.maxSlots);
assert.strictEqual(core.buyOrderSlot(board3, rules, () => 0).reason, 'max_order_slots');

// 放弃订单：立刻换一张，总数不变
const drop = core.createState(rules, () => 0);
const droppedId = drop.orders[0].id;
const boardSize = drop.orders.length;
assert.strictEqual(core.abandonOrder(drop, droppedId, rules, () => 0).ok, true);
assert.strictEqual(drop.orders.length, boardSize);
assert.ok(!drop.orders.some(function (order) { return order.id === droppedId; }), '被放弃的单要消失');
assert.strictEqual(core.abandonOrder(drop, 'nope', rules, () => 0).reason, 'unknown_order');

// 多物品订单：差一件都不能交，且不能扣掉已够的那一项
const multi = core.createState(rules, () => 0);
multi.orders = [{ id: 'o2', lines: [
  { itemId: 'wheat', quantity: 2 },
  { itemId: 'corn', quantity: 3 },
], coins: 60, xp: 5 }];
multi.ordersGenerated = 10;
multi.silo = { wheat: 5, corn: 2 };
d = core.deliverOrder(multi, 'o2', rules, () => 0);
assert.strictEqual(d.reason, 'missing_items');
assert.strictEqual(multi.silo.wheat, 5, '校验失败时一件都不能扣');

// 生成订单只会出现已解锁物品
const lowLevel = core.createState(rules, () => 0);
lowLevel.orders = [];
lowLevel.ordersGenerated = 10;
for (let i = 0; i < 20; i += 1) {
  const order = core.generateOrder(lowLevel, rules, Math.random);
  assert.strictEqual(core.levelOf(lowLevel.xp, rules), 1);
  for (const line of order.lines) {
    assert.ok(rules.ITEMS[line.itemId].unlockLevel <= 1, 'Lv1 不应出现高级物品');
  }
  for (const line of order.lines) {
    assert.ok(Number.isInteger(line.quantity) && line.quantity > 0);
  }
}

console.log('slow-farm-order 通过');

// 开地：等级不够时报 locked，等级够了才能花钱开
const wallet = core.createState(rules, () => 0);
wallet.coins = 1000;
assert.strictEqual(core.buyPlot(wallet, rules).reason, 'locked', 'Lv1 不能开地');
wallet.xp = 40;
assert.deepStrictEqual(core.buyPlot(wallet, rules), { ok: true });
assert.strictEqual(wallet.plots.length, 7);
assert.strictEqual(wallet.coins, 800);
wallet.plots = new Array(12).fill(0).map((_, i) => ({ id: i + 1, cropId: null, plantedAt: 0, readyAt: 0 }));
assert.strictEqual(core.buyPlot(wallet, rules).reason, 'max_plots');

// 买机器
const builds = core.createState(rules, () => 0);
builds.coins = 500;
assert.strictEqual(core.buyMachine(builds, 'bakery', rules).reason, 'locked');
builds.xp = 40;
assert.deepStrictEqual(core.buyMachine(builds, 'bakery', rules), { ok: true });
assert.strictEqual(builds.machines.bakery.unlocked, true);
assert.strictEqual(builds.coins, 100);
assert.strictEqual(core.buyMachine(builds, 'bakery', rules).reason, 'already');

// 开仓库格
const storeHouse = core.createState(rules, () => 0);
storeHouse.coins = 300;
assert.deepStrictEqual(core.buySiloSlot(storeHouse, rules), { ok: true });
assert.strictEqual(storeHouse.siloSlots, rules.SILO.initial + 1);
assert.strictEqual(core.siloCap(storeHouse), rules.SILO.initial + 1);
assert.strictEqual(storeHouse.coins, 200);

// 零卖：售价 70%，向下取整
const vendor = core.createState(rules, () => 0);
vendor.silo = { bread: 3 };
assert.deepStrictEqual(core.sellItem(vendor, 'bread', 2, rules), { ok: true, coins: 63 });
assert.strictEqual(vendor.silo.bread, 1);
assert.strictEqual(core.sellItem(vendor, 'bread', 5, rules).reason, 'not_enough');

console.log('slow-farm-shop 通过');

// 买沙漏：5 钻一个
const rush = core.createState(rules, () => 0);
assert.deepStrictEqual(core.buyHourglass(rush, 1, rules), { ok: true });
assert.strictEqual(rush.hourglasses, 1);
assert.strictEqual(rush.gems, 0);
assert.strictEqual(core.buyHourglass(rush, 1, rules).reason, 'no_gems');

// 沙漏礼包：买得越多单价越便宜，只有配置里有的数量才能买
const packs = core.createState(rules, () => 0);
packs.gems = 100;
assert.deepStrictEqual(core.buyHourglass(packs, 10, rules), { ok: true });
assert.strictEqual(packs.hourglasses, 10);
assert.strictEqual(packs.gems, 55, '10 个 45 钻');
assert.strictEqual(core.buyHourglass(packs, 20, rules).reason, 'bad_quantity', '没有这个礼包');
packs.gems = 400;
assert.strictEqual(core.buyHourglass(packs, 99, rules).ok, true);
assert.strictEqual(packs.hourglasses, 109);
assert.strictEqual(packs.gems, 0);

// 用在作物上：立刻成熟
rush.coins = 10;
core.plant(rush, 0, 'wheat', 0, rules);
assert.deepStrictEqual(core.useHourglass(rush, { kind: 'plot', index: 0 }, 60000, rules), { ok: true });
assert.strictEqual(rush.plots[0].readyAt, 60000, '沙漏把 readyAt 拉到当前时刻');
assert.strictEqual(rush.hourglasses, 0);

// 用在机器上：立刻可收
rush.silo = { wheat: 2 };
core.unlockRecipe(rush, 'flour', rules);
core.enqueue(rush, 'mill', 'flour', 60000, rules);
assert.strictEqual(core.useHourglass(rush, { kind: 'machine', id: 'mill' }, 60000, rules).reason, 'no_hourglass');

// 空地上用沙漏
assert.strictEqual(core.useHourglass(rush, { kind: 'plot', index: 5 }, 60000, rules).reason, 'nothing_running');

// 动物：产出中用沙漏立刻可收
const rushYard = core.createState(rules, () => 0);
rushYard.xp = 500;
rushYard.coins = 1000;
rushYard.silo = { feed: 2 };
core.buyAnimal(rushYard, 'chicken', rules);
core.feedAnimal(rushYard, 'chicken', 0, 1000, rules);
rushYard.hourglasses = 1;
assert.deepStrictEqual(
  core.useHourglass(rushYard, { kind: 'animal', kindId: 'chicken', index: 0 }, 60000, rules),
  { ok: true }
);
assert.strictEqual(rushYard.animals.chicken.list[0].readyAt, 60000, '沙漏把动物的 readyAt 拉到当前时刻');
assert.strictEqual(rushYard.hourglasses, 0);

// 动物饿着或位置不存在时不给沙漏
const idleYard = core.createState(rules, () => 0);
idleYard.xp = 500;
idleYard.coins = 1000;
core.buyAnimal(idleYard, 'chicken', rules);
idleYard.hourglasses = 1;
assert.strictEqual(
  core.useHourglass(idleYard, { kind: 'animal', kindId: 'chicken', index: 0 }, 60000, rules).reason,
  'nothing_running'
);
assert.strictEqual(
  core.useHourglass(idleYard, { kind: 'animal', kindId: 'chicken', index: 9 }, 60000, rules).reason,
  'nothing_running'
);
assert.strictEqual(idleYard.hourglasses, 1, '失败不消耗沙漏');

// 没有沙漏时动物加速返回 no_hourglass
const dryYard = core.createState(rules, () => 0);
dryYard.xp = 500;
dryYard.coins = 1000;
dryYard.silo = { feed: 1 };
core.buyAnimal(dryYard, 'chicken', rules);
core.feedAnimal(dryYard, 'chicken', 0, 1000, rules);
assert.strictEqual(
  core.useHourglass(dryYard, { kind: 'animal', kindId: 'chicken', index: 0 }, 60000, rules).reason,
  'no_hourglass'
);

// 广告与购买：只发钻石，不做支付
const gemmy = core.createState(rules, () => 0);
assert.deepStrictEqual(core.grantAdGems(gemmy, rules), { ok: true, gems: 5 + rules.GEMS.adReward });
assert.strictEqual(gemmy.gems, 10);
assert.deepStrictEqual(core.grantPaidGems(gemmy, rules), { ok: true, gems: 110 });
assert.strictEqual(gemmy.gems, 110);

console.log('slow-farm-rush 通过');

// 一键种植：按金币上限，把所有空地种上同一种作物
const bulk = core.createState(rules, () => 0);
bulk.coins = 3;
let b = core.plantAll(bulk, 'wheat', 0, rules);
assert.deepStrictEqual(b, { ok: true, planted: 3, blocked: 'no_coins' });
assert.strictEqual(bulk.plots.filter(p => p.cropId === 'wheat').length, 3);
assert.strictEqual(bulk.coins, 0, '每块地 1 金币');
b = core.plantAll(bulk, 'wheat', 0, rules);
assert.strictEqual(b.planted, 0);
assert.strictEqual(b.blocked, 'no_coins', '钱不够时应说明原因');
assert.strictEqual(core.plantAll(bulk, 'carrot', 0, rules).reason, 'locked');

// 已经有作物的地块不动
const half = core.createState(rules, () => 0);
half.coins = 100;
core.plant(half, 0, 'wheat', 0, rules);
b = core.plantAll(half, 'wheat', 0, rules);
assert.strictEqual(b.planted, 5, '只种剩下 5 块空地');
assert.strictEqual(half.plots[0].cropId, 'wheat');

// 一键收获：只收成熟的
const bulkHarvest = core.createState(rules, () => 0);
bulkHarvest.coins = 100;
core.plantAll(bulkHarvest, 'wheat', 0, rules);
bulkHarvest.plots[0].readyAt = 100;
bulkHarvest.plots[1].readyAt = 100;
let h = core.harvestAll(bulkHarvest, 100, rules);
assert.deepStrictEqual(h.items, { wheat: 4 }, '两块地各收两个');
assert.strictEqual(h.skipped, 0);
assert.strictEqual(bulkHarvest.plots[0].cropId, null);
assert.strictEqual(bulkHarvest.plots[2].cropId, 'wheat', '没成熟的留着');

// 仓库格满时，新种类的物品收不进去
const packed2 = core.createState(rules, () => 0);
packed2.siloSlots = 2;
packed2.coins = 4;
core.plantAll(packed2, 'wheat', 0, rules);
packed2.plots.forEach(p => { p.readyAt = 100; });
packed2.silo = { corn: 99, flour: 99 };
h = core.harvestAll(packed2, 100, rules);
assert.deepStrictEqual(h.items, {}, '小麦是新种类，没有空格');
assert.strictEqual(h.skipped, 4, '四块都要开新格，但没有');
assert.strictEqual(core.siloSlotsUsed(packed2), 2);

// 一键加速：每块进行中的地消耗一个沙漏，机器不受影响
const rushAll = core.createState(rules, () => 0);
rushAll.coins = 3;
core.plantAll(rushAll, 'wheat', 0, rules);
rushAll.silo = { wheat: 2 };
core.unlockRecipe(rushAll, 'flour', rules);
core.enqueue(rushAll, 'mill', 'flour', 0, rules);
rushAll.hourglasses = 4;
let r3 = core.useHourglassOnPlots(rushAll, 60000, rules);
assert.deepStrictEqual(r3, { ok: true, used: 3, stopped: null });
assert.strictEqual(rushAll.hourglasses, 1, '机器不消耗沙漏');
assert.strictEqual(rushAll.plots[0].readyAt, 60000);
assert.notStrictEqual(rushAll.machines.mill.queue[0].readyAt, 60000, '机器不应被加速');

// 沙漏不够时加速到用尽为止
const few = core.createState(rules, () => 0);
few.coins = 3;
core.plantAll(few, 'wheat', 0, rules);
few.hourglasses = 1;
r3 = core.useHourglassOnPlots(few, 60000, rules);
assert.strictEqual(r3.used, 1);
assert.strictEqual(r3.stopped, 'no_hourglass');

console.log('slow-farm-bulk 通过');

// hydrate：存档缺 orders 时要补满，否则订单板永久空白、订单收入断掉
const noOrders = { coins: 100 };
core.hydrate(noOrders, rules, () => 0);
assert.strictEqual(noOrders.orders.length, rules.ORDERS.initialSlots, '缺订单时应补满');

// hydrate：坏单要丢弃并补回，不能带进渲染与交单
const badOrders = core.createState(rules, () => 0);
badOrders.orders[0] = { id: 'oX', lines: [{ itemId: 'ghost', quantity: 3 }], coins: 10, xp: 1 };
badOrders.orders[1] = { id: 'oY', coins: 10, xp: 1 };
assert.throws(() => badOrders.orders[1].lines.map(x => x), TypeError);
core.hydrate(badOrders, rules, () => 0);
assert.strictEqual(badOrders.orders.length, rules.ORDERS.initialSlots);
assert.ok(badOrders.orders.every(function (order) {
  return Array.isArray(order.lines)
    && order.lines.length > 0
    && order.lines.every(function (line) { return Boolean(rules.ITEMS[line.itemId]); });
}), '残留未知物品的订单行不应留下');

// hydrate：orderSeq 不能小于已有订单号，否则新单撞号
const seqState = core.createState(rules, () => 0);
seqState.orders[0].id = 'o9';
seqState.orderSeq = 0;
core.hydrate(seqState, rules, () => 0);
const maxId = Math.max.apply(null, seqState.orders.map(function (order) {
  return Number(String(order.id).slice(1)) || 0;
}));
assert.ok(maxId >= 9, '已有订单号 o9 不应被丢掉');
const fresh = core.generateOrder(seqState, rules, () => 0);
assert.ok(Number(fresh.id.slice(1)) > maxId, '新单编号必须大于已有最大号');

// 订单位少于订单数时，多出来的单要被裁掉
const overflow = core.createState(rules, () => 0);
overflow.orders.push(core.generateOrder(overflow, rules, () => 0));
assert.strictEqual(overflow.orders.length, rules.ORDERS.initialSlots + 1);
core.hydrate(overflow, rules, () => 0);
assert.strictEqual(overflow.orders.length, rules.ORDERS.initialSlots, '订单数不能超过订单位');


// 养殖：买动物要金币与等级，喂饲料才产出，收完回到饥饿
const farmYard = core.createState(rules, () => 0);
farmYard.xp = 500;
farmYard.coins = 1000;
farmYard.silo = { feed: 2 };

assert.strictEqual(core.buyAnimal(farmYard, 'chicken', rules).ok, true);
assert.strictEqual(farmYard.animals.chicken.list.length, 1);
assert.strictEqual(farmYard.coins, 800, '鸡 200 金币');
assert.strictEqual(farmYard.animals.chicken.list[0].readyAt, 0, '刚买的动物是饿着的');

// 没饲料不能喂
farmYard.silo.feed = 0;
assert.strictEqual(core.feedAnimal(farmYard, 'chicken', 0, 0, rules).reason, 'missing_input');
assert.strictEqual(farmYard.animals.chicken.list[0].readyAt, 0);

// 喂食：扣饲料，写入产出时间
farmYard.silo.feed = 2;
assert.strictEqual(core.feedAnimal(farmYard, 'chicken', 0, 1000, rules).ok, true);
assert.strictEqual(farmYard.silo.feed, 1);
assert.strictEqual(farmYard.animals.chicken.list[0].readyAt, 1000 + rules.ANIMALS.chicken.cycleMs);
assert.strictEqual(core.feedAnimal(farmYard, 'chicken', 0, 1000, rules).reason, 'animal_busy');

// 没到点不能收
assert.strictEqual(core.collectAnimal(farmYard, 'chicken', 0, 2000, rules).reason, 'not_ready');

// 到点收蛋，动物回到饥饿
const readyAt = farmYard.animals.chicken.list[0].readyAt;
assert.deepStrictEqual(core.collectAnimal(farmYard, 'chicken', 0, readyAt, rules), { ok: true, itemId: 'egg' });
assert.strictEqual(farmYard.silo.egg, 1);
assert.strictEqual(farmYard.animals.chicken.list[0].readyAt, 0);
assert.strictEqual(farmYard.xp, 501, '收取动物与收获作物一样给 1 点经验');

// 等级不够养不了牛
assert.strictEqual(core.buyAnimal(farmYard, 'cow', rules).ok, false);

// 一键喂食与一键收取
const herd = core.createState(rules, () => 0);
herd.xp = 500;
herd.coins = 5000;
herd.silo.feed = 10;
core.buyAnimal(herd, 'chicken', rules);
core.buyAnimal(herd, 'chicken', rules);
core.buyAnimal(herd, 'chicken', rules);
assert.deepStrictEqual(core.feedAll(herd, 'chicken', 0, rules), { ok: true, fed: 3 });
assert.strictEqual(herd.silo.feed, 7);
herd.animals.chicken.list.forEach(function (animal) {
  animal.readyAt = 100;
});
assert.deepStrictEqual(core.collectAll(herd, 'chicken', 100, rules), { ok: true, items: { egg: 3 }, skipped: 0 });
assert.strictEqual(herd.silo.egg, 3);
assert.strictEqual(herd.xp, 503, '一键收取走同一条路径，同样加经验');

// 一键加速动物：每只正在产出的动物消耗一个沙漏，沙漏不够就停
const herdRush = core.createState(rules, () => 0);
herdRush.xp = 500;
herdRush.coins = 5000;
herdRush.silo = { feed: 10 };
core.buyAnimal(herdRush, 'chicken', rules);
core.buyAnimal(herdRush, 'chicken', rules);
core.buyAnimal(herdRush, 'chicken', rules);
core.feedAll(herdRush, 'chicken', 0, rules);
herdRush.hourglasses = 2;
assert.deepStrictEqual(core.useHourglassOnAnimals(herdRush, 'chicken', 60000, rules), {
  ok: true, used: 2, stopped: 'no_hourglass',
});
assert.strictEqual(herdRush.animals.chicken.list[0].readyAt, 60000);
assert.strictEqual(herdRush.animals.chicken.list[1].readyAt, 60000);
assert.strictEqual(
  herdRush.animals.chicken.list[2].readyAt,
  rules.ANIMALS.chicken.cycleMs,
  '沙漏用完，剩下的动物保持原进度'
);
assert.strictEqual(herdRush.hourglasses, 0);

// 没有正在产出的动物：不消耗沙漏
const idleHerd = core.createState(rules, () => 0);
idleHerd.xp = 500;
idleHerd.coins = 5000;
core.buyAnimal(idleHerd, 'chicken', rules);
idleHerd.hourglasses = 1;
assert.deepStrictEqual(core.useHourglassOnAnimals(idleHerd, 'chicken', 60000, rules), {
  ok: true, used: 0, stopped: null,
});
assert.strictEqual(idleHerd.hourglasses, 1);
assert.strictEqual(core.useHourglassOnAnimals(idleHerd, 'ghost', 60000, rules).reason, 'unknown_animal');

// 畜舍位置：满了不能再买
const tiny = core.createState(rules, () => 0);
tiny.xp = 500;
tiny.coins = 99999;
for (let i = 0; i < rules.ANIMALS.chicken.initialSlots; i += 1) {
  core.buyAnimal(tiny, 'chicken', rules);
}
assert.strictEqual(core.buyAnimal(tiny, 'chicken', rules).reason, 'stable_full');
assert.strictEqual(core.buyStableSlot(tiny, 'chicken', rules).ok, true);
assert.strictEqual(core.buyAnimal(tiny, 'chicken', rules).ok, true);

// 羊：Lv.7 才解锁，产出羊毛
const sheepPen = core.createState(rules, () => 0);
sheepPen.coins = 99999;
sheepPen.silo = { feed: 5 };
sheepPen.xp = 2400;
assert.strictEqual(core.buyAnimal(sheepPen, 'sheep', rules).ok, true);
core.feedAnimal(sheepPen, 'sheep', 0, 0, rules);
sheepPen.animals.sheep.list[0].readyAt = 100;
assert.deepStrictEqual(core.collectAnimal(sheepPen, 'sheep', 0, 100, rules), { ok: true, itemId: 'wool' });

// 回归概览：数一数现在有多少东西在等你
const waiting = core.createState(rules, () => 0);
waiting.coins = 100;
waiting.silo = { feed: 5 };
waiting.xp = 500;
core.plantAll(waiting, 'wheat', 0, rules);
waiting.plots[0].readyAt = 0;
waiting.plots[1].readyAt = 0;
waiting.coins = 1000;
assert.strictEqual(core.buyAnimal(waiting, 'chicken', rules).ok, true);
waiting.animals.chicken.list[0].readyAt = 100;
waiting.machines.mill.queue.push({ recipeId: 'flour', startedAt: 0, readyAt: 100 });
let summary = core.waitingSummary(waiting, 1000, rules);
assert.strictEqual(summary.plots, 2, '两块地熟了');
assert.strictEqual(summary.machineItems, 1);
assert.strictEqual(summary.animalItems, 1);

// 可交付的订单也算进去
waiting.silo.wheat = 999;
summary = core.waitingSummary(waiting, 1000, rules);
assert.strictEqual(summary.orders, waiting.orders.length);

// 统计与成就
const deeds = core.createState(rules, () => 0);
assert.strictEqual(deeds.stats.harvested, 0);
assert.deepStrictEqual(core.evaluateAchievements(deeds, rules, 0), [], '一开始什么都没有');

deeds.coins = 100;
core.plantAll(deeds, 'wheat', 0, rules);
deeds.plots.forEach(p => { p.readyAt = 0; });
core.harvestAll(deeds, 100, rules);
assert.strictEqual(deeds.stats.harvested, 12, '6 块地各收 2 个');
const firstUnlocked = core.evaluateAchievements(deeds, rules, 100);
assert.ok(firstUnlocked.some(a => a.id === 'firstHarvest'), '收获后解锁第一把麦子');
assert.strictEqual(deeds.achievements.firstHarvest, true);
assert.deepStrictEqual(core.evaluateAchievements(deeds, rules, 200), [], '同一个成就不会重复解锁');

// 交付计入统计
const courier = core.createState(rules, () => 0);
courier.orders = [{ id: 'o1', lines: [{ itemId: 'wheat', quantity: 2 }], coins: 10, xp: 1 }];
courier.silo = { wheat: 5 };
core.deliverOrder(courier, 'o1', rules, () => 0);
assert.strictEqual(courier.stats.delivered, 1);
assert.strictEqual(courier.stats.earned, 10);
assert.ok(core.evaluateAchievements(courier, rules, 0).some(a => a.id === 'firstOrder'));

// 满园成就看地块数
const fullYard = core.createState(rules, () => 0);
fullYard.plots = new Array(12).fill(0).map((_, i) => ({ id: i + 1, cropId: null, plantedAt: 0, readyAt: 0 }));
assert.ok(core.evaluateAchievements(fullYard, rules, 0).some(a => a.id === 'fullPlots'));

// 每日特供：一天一张、奖励翻倍、交付后当天不再补
const daily = core.createState(rules, () => 0);
assert.strictEqual(core.ensureDailyOrder(daily, rules, () => 0, 0), true, '第一次会生成');
const theDaily = daily.dailyOrder;
assert.ok(theDaily && theDaily.id.indexOf('d') === 0);
assert.strictEqual(daily.dailyDay, core.dayKey(0));
assert.strictEqual(core.ensureDailyOrder(daily, rules, () => 0, 1000), false, '同一天不重复生成');
assert.strictEqual(daily.dailyOrder, theDaily);

// 第二天换一张
assert.strictEqual(core.ensureDailyOrder(daily, rules, () => 0, 24 * 60 * 60 * 1000), true);
assert.notStrictEqual(daily.dailyOrder, theDaily);

// 交付特供单：奖励翻倍写入金币，然后清空
daily.silo = {};
theDaily.lines.forEach(function (line) { daily.silo[line.itemId] = line.quantity; });
const coinsBefore = daily.coins;
const dailyResult = core.deliverOrder(daily, daily.dailyOrder.id, rules, () => 0);
assert.strictEqual(dailyResult.ok, true);
assert.strictEqual(daily.coins - coinsBefore, dailyResult.coins);
assert.strictEqual(dailyResult.coins % 2, 0, '翻倍后是偶数（基础奖励非零时）');
assert.strictEqual(daily.dailyOrder, null, '交完当天就没有了');

// 交完之后当天再进游戏（重新 start）不该补一张新的
const day2Ms = 24 * 60 * 60 * 1000;
assert.strictEqual(core.ensureDailyOrder(daily, rules, () => 0, day2Ms + 60000), false, '交完当天不再补');
assert.strictEqual(daily.dailyOrder, null, '交完当天保持为空');

// 任务链：完成一条才推进下一条
const quest = core.createState(rules, () => 0);
assert.strictEqual(quest.taskIndex, 0);
assert.deepStrictEqual(core.evaluateTasks(quest, rules), [], '什么都没做时没有可领的任务');
const questCoins = quest.coins;
core.plant(quest, 0, 'wheat', 0, rules);
const questDone = core.evaluateTasks(quest, rules);
assert.strictEqual(questDone.length, 1);
assert.strictEqual(questDone[0].id, 'plant1');
assert.strictEqual(quest.coins - questCoins, questDone[0].reward - rules.CROPS.wheat.seedPrice);
assert.strictEqual(quest.taskIndex, 1, '推进到下一条');

// 切页签能推进对应任务
const sightsee = core.createState(rules, () => 0);
sightsee.taskIndex = 2;
assert.deepStrictEqual(core.visitTab(sightsee, 'silo', rules).map(function (t) { return t.id; }), ['seeSilo']);
assert.strictEqual(sightsee.tabsSeen.silo, true);
assert.deepStrictEqual(core.visitTab(sightsee, 'silo', rules), [], '重复访问不重复推进');

// 成就达成给金币
const rewarded = core.createState(rules, () => 0);
rewarded.xp = 99999;
const rewardCoins = rewarded.coins;
const gainedDeeds = core.evaluateAchievements(rewarded, rules);
assert.ok(gainedDeeds.some(function (d) { return d.id === 'maxLevel'; }));
assert.strictEqual(rewarded.coins - rewardCoins, 5000, '满级成就给 5000');

console.log('slow-farm-animal 通过');
console.log('slow-farm-hydrate-orders 通过');
