'use strict';

// 工位版领域层测试：无限麦田、共享工段工人、轮转送货、送达金币、三台机器。
const assert = require('assert');
const rules = require('./farm-rules.js');
const core = require('./farm-core.js');

assert.strictEqual(core.validateContent(rules), true, '真实内容应通过校验');

// 初始：只有无限麦田，机器锁定，三个工段路线可用，背包 10
const s = core.createState(rules, 0);
assert.strictEqual(s.maps.farm.nodes.field.source, true);
assert.strictEqual(s.maps.farm.nodes.mill1.unlocked, false);
assert.strictEqual(s.maps.farm.routes.farmers.unlocked, true);
assert.strictEqual(s.maps.farm.routes.porters.unlocked, true);
assert.strictEqual(s.maps.farm.routes.breadWorkers.unlocked, true);
assert.strictEqual(rules.PLAYER.levels[0].cap, 10);

// 无限麦田取货：装满，再取提示背包满
let r = core.take(s, 'farm', 'field', 'wheat', rules);
assert.deepStrictEqual(r, { ok: true, qty: 10, item: 'wheat' });
r = core.take(s, 'farm', 'field', 'wheat', rules);
assert.strictEqual(r.reason, 'backpack_full');
core.discard(s);

// 0 元建第一台磨坊；手动送达 +10
r = core.unlockNode(s, 'farm', 'mill1', rules);
assert.strictEqual(r.ok, true);
core.take(s, 'farm', 'field', 'wheat', rules);
r = core.deposit(s, 'farm', 'mill1', 'wheat', rules);
assert.strictEqual(r.reward, 10);
assert.strictEqual(s.coins, 10);
assert.strictEqual(s.maps.farm.nodes.mill1.in.wheat, 10);

// 磨坊每 2 拍消耗 1 小麦产 1 面粉
core.advance(s, 2, rules);
assert.strictEqual(s.maps.farm.nodes.mill1.out.flour, 1);
assert.strictEqual(s.maps.farm.nodes.mill1.in.wheat, 9);

// 农民是共享工段：所有小麦送进同一类磨坊的来料池，按轮转分配
const clone = JSON.parse(JSON.stringify(rules));
clone.MAPS.farm.nodes.mill1.levels[0].beats = 99;
clone.MAPS.farm.nodes.mill2.levels[0].beats = 99;
const a = core.createState(clone, 0);
a.coins = 1000;
core.unlockNode(a, 'farm', 'mill1', clone);
core.unlockNode(a, 'farm', 'mill2', clone);
r = core.hireWorker(a, 'farm', 'farmers', clone);
assert.strictEqual(r.ok, true);
const coins0 = a.coins;
const earned = core.advance(a, 6, clone);
assert.strictEqual(a.maps.farm.nodes.mill1.in.wheat, 1, '第 1 趟送磨坊 1');
assert.strictEqual(a.maps.farm.nodes.mill2.in.wheat, 1, '第 2 趟送磨坊 2');
assert.strictEqual(a.coins - coins0, 2, '两次送达各 +1');
assert.strictEqual(earned.coinsEarned, 2);

// 搬运工在磨坊成品池与面包机来料池之间轮转，送达 +2
const porterRules = JSON.parse(JSON.stringify(rules));
porterRules.MAPS.farm.nodes.baker1.levels[0].beats = 99;
porterRules.MAPS.farm.nodes.baker2.levels[0].beats = 99;
const b = core.createState(porterRules, 0);
b.coins = 1000;
core.unlockNode(b, 'farm', 'mill1', porterRules);
core.unlockNode(b, 'farm', 'baker1', porterRules);
core.unlockNode(b, 'farm', 'baker2', porterRules);
b.maps.farm.nodes.mill1.out.flour = 5;
r = core.hireWorker(b, 'farm', 'porters', porterRules);
assert.strictEqual(r.ok, true);
core.advance(b, 3, porterRules);
assert.strictEqual(b.maps.farm.nodes.baker1.in.flour, 1, '第 1 趟送面包机 1');
assert.strictEqual(b.maps.farm.nodes.mill1.out.flour, 4);
core.advance(b, 3, porterRules);
assert.strictEqual(b.maps.farm.nodes.baker2.in.flour, 1, '第 2 趟轮转到面包机 2');

// 面包工送货不给送达金币，只有售货台卖出才给
const c = core.createState(rules, 0);
c.coins = 1000;
core.unlockNode(c, 'farm', 'baker1', rules);
core.unlockNode(c, 'farm', 'counter1', rules);
c.maps.farm.nodes.baker1.out.bread = 2;
r = core.hireWorker(c, 'farm', 'breadWorkers', rules);
assert.strictEqual(r.ok, true);
const beforeBread = c.coins;
core.advance(c, 3, rules);
assert.strictEqual(c.maps.farm.nodes.counter1.in.bread, 1);
assert.strictEqual(c.coins, beforeBread, '送到售货台不给金币');
const beforeSale = c.coins;
core.advance(c, 2, rules);
assert.strictEqual(c.coins - beforeSale, 4, '售货台卖出 +4');

// 第二台磨坊要 120 金币
const m = core.createState(rules, 0);
m.coins = 119;
assert.strictEqual(core.unlockNode(m, 'farm', 'mill2', rules).ok, false);
m.coins = 120;
assert.strictEqual(core.unlockNode(m, 'farm', 'mill2', rules).ok, true);
assert.strictEqual(m.coins, 0);

// 升级：磨坊 1→2 花 80；第 4 级用广告；无限麦田没有升级
const u = core.createState(rules, 0);
u.coins = 1000;
core.unlockNode(u, 'farm', 'mill1', rules);
assert.deepStrictEqual(core.upgradeCost(rules, rules.MAPS.farm.nodes.mill1, 1), { coin: 120 });
assert.deepStrictEqual(core.upgradeCost(rules, rules.MAPS.farm.nodes.mill1, 3), { ad: 'rewarded' });
core.applyNodeUpgrade(u, 'farm', 'mill1', rules);
assert.strictEqual(u.maps.farm.nodes.mill1.level, 2);
assert.deepStrictEqual(core.applyNodeUpgrade(u, 'farm', 'field', rules), { ok: false, reason: 'max' });

// 工人是独立个体：每个工人的速度与背包分开升级
const wu = core.createState(rules, 0);
wu.coins = 1000;
core.unlockNode(wu, 'farm', 'mill1', rules);
const hired = core.hireWorker(wu, 'farm', 'farmers', rules);
assert.strictEqual(hired.ok, true);
const worker = hired.worker;
assert.strictEqual(worker.speed, 3);
assert.strictEqual(worker.backpack, 1);
const farmerDef = rules.MAPS.farm.routes.farmers;
assert.deepStrictEqual(core.workerUpgradeCost(farmerDef, worker, 'speed'), { coin: 100 });
core.applyWorkerUpgrade(wu, 'farm', 'farmers', worker.id, 'speed', rules);
assert.strictEqual(worker.speed, 2);
assert.strictEqual(worker.speedUpgrades, 1);
assert.deepStrictEqual(core.workerUpgradeCost(farmerDef, worker, 'backpack'), { coin: 120 });
core.applyWorkerUpgrade(wu, 'farm', 'farmers', worker.id, 'backpack', rules);
assert.strictEqual(worker.backpack, 2);
assert.strictEqual(worker.backpackUpgrades, 1);
assert.deepStrictEqual(core.workerUpgradeCost(farmerDef, worker, 'speed'), { ad: 'rewarded' });
core.applyWorkerUpgrade(wu, 'farm', 'farmers', worker.id, 'speed', rules);
assert.strictEqual(worker.speed, 1);
assert.strictEqual(core.workerUpgradeCost(farmerDef, worker, 'speed'), null, '速度已满级');

// 任务：条件满足后领取金币，并解锁下一环
const qs = core.createState(rules, 0);
assert.deepStrictEqual(qs.quests.active, ['q_harvest']);
assert.strictEqual(core.questStatus(qs, rules.QUESTS[0], rules).done, false);
core.take(qs, 'farm', 'field', 'wheat', rules);
assert.strictEqual(core.questStatus(qs, rules.QUESTS[0], rules).done, true);
let claim = core.claimQuest(qs, 'q_harvest', rules);
assert.strictEqual(claim.ok, true);
assert.strictEqual(qs.coins, 20);
assert.deepStrictEqual(qs.quests.active, ['q_build_mill']);
core.unlockNode(qs, 'farm', 'mill1', rules);
assert.strictEqual(core.questStatus(qs, rules.QUESTS[1], rules).done, true);
claim = core.claimQuest(qs, 'q_build_mill', rules);
assert.strictEqual(claim.ok, true);
assert.deepStrictEqual(qs.quests.active, ['q_deliver']);
core.deposit(qs, 'farm', 'mill1', 'wheat', rules);
assert.strictEqual(qs.stats.delivered.wheat, 10);
assert.strictEqual(core.questStatus(qs, rules.QUESTS[2], rules).done, true);

// 任务统计：消耗与卖出由售货台累计
const st = core.createState(rules, 0);
st.coins = 1000;
core.unlockNode(st, 'farm', 'counter1', rules);
st.maps.farm.nodes.counter1.in.bread = 1;
core.advance(st, 2, rules);
assert.strictEqual(st.stats.consumed.bread, 1);
assert.strictEqual(st.stats.sold.bread, 1);

// 任务条件：两个农民都达到 2 级
const hq = core.createState(rules, 0);
hq.coins = 1000;
core.unlockNode(hq, 'farm', 'mill1', rules);
core.hireWorker(hq, 'farm', 'farmers', rules);
core.hireWorker(hq, 'farm', 'farmers', rules);
const two = hq.maps.farm.routes.farmers.workers;
core.applyWorkerUpgrade(hq, 'farm', 'farmers', two[0].id, 'speed', rules);
core.applyWorkerUpgrade(hq, 'farm', 'farmers', two[0].id, 'backpack', rules);
core.applyWorkerUpgrade(hq, 'farm', 'farmers', two[1].id, 'speed', rules);
core.applyWorkerUpgrade(hq, 'farm', 'farmers', two[1].id, 'backpack', rules);
const levelQuest = rules.QUESTS.find((quest) => quest.id === 'q_workers');
assert.strictEqual(core.questStatus(hq, levelQuest, rules).done, true);

// 面粉售货机：磨坊的面粉直接卖；送达不给金币，卖出才给
const fq = core.createState(rules, 0);
fq.coins = 1000;
core.unlockNode(fq, 'farm', 'mill1', rules);
core.unlockNode(fq, 'farm', 'flourShop1', rules);
fq.maps.farm.nodes.mill1.out.flour = 5;
r = core.hireWorker(fq, 'farm', 'flourPorters', rules);
assert.strictEqual(r.ok, true);
const flourCoins0 = fq.coins;
core.advance(fq, 3, rules);
assert.strictEqual(fq.maps.farm.nodes.flourShop1.in.flour, 1, '面粉送到售货机');
assert.strictEqual(fq.coins, flourCoins0, '送到售货机不给金币');
core.advance(fq, 2, rules);
assert.strictEqual(fq.coins - flourCoins0, 2, '面粉售货机卖出 +2');

// 旧档漂移：缺机器时补齐；源节点保持无限；工人数组保留
const h = core.createState(rules, 0);
delete h.maps.farm.nodes.mill1;
h.maps.farm.routes.farmers.workers = [
  { id: 'farmers-1', speed: 3, backpack: 1, speedUpgrades: 0, backpackUpgrades: 0, counter: 0 },
];
core.hydrate(h, rules);
assert.strictEqual(h.maps.farm.nodes.mill1.level, 1);
assert.strictEqual(h.maps.farm.nodes.field.source, true);
assert.strictEqual(h.maps.farm.routes.farmers.workers.length, 1);

// 鱼线：鱼塘 → 杀鱼机 → 罐头机 → 罐头售货台，端到端产出金币
assert.ok(rules.LINES.fish, '存在鱼线产线分组');
assert.deepStrictEqual(
  rules.LINES.fish.stages.map((stage) => stage.key),
  ['fishPond', 'fishKillers', 'canners', 'canShops', 'fishSliceShops'],
);
assert.ok(rules.MAPS.farm.routes.fishermen, '存在渔民路线');
assert.ok(rules.MAPS.farm.routes.fishPorters, '存在鱼片搬运工路线');
assert.ok(rules.MAPS.farm.routes.canWorkers, '存在罐头工路线');
assert.ok(rules.MAPS.farm.routes.sliceVendors, '存在鱼片上架工路线');

const fishLine = core.createState(rules, 0);
fishLine.coins = 1000;
core.unlockNode(fishLine, 'farm', 'fishKiller1', rules);
core.unlockNode(fishLine, 'farm', 'canner1', rules);
core.unlockNode(fishLine, 'farm', 'canShop1', rules);
assert.strictEqual(core.hireWorker(fishLine, 'farm', 'fishermen', rules).ok, true);
assert.strictEqual(core.hireWorker(fishLine, 'farm', 'fishPorters', rules).ok, true);
assert.strictEqual(core.hireWorker(fishLine, 'farm', 'canWorkers', rules).ok, true);
const fishCoins0 = fishLine.coins;
core.advance(fishLine, 60, rules);
assert.ok(fishLine.stats.delivered.fish > 0, '鱼被送进杀鱼机');
assert.ok(fishLine.stats.delivered.fishSlice > 0, '鱼片被送进罐头机');
assert.ok(fishLine.stats.sold.can > 0, '罐头被卖出');
assert.ok(fishLine.coins > fishCoins0, '鱼线产生金币');

// 汉堡线：牧场 → 绞肉机 → 汉堡机 → 汉堡售货台
assert.ok(rules.LINES.burger, '存在汉堡线产线分组');
assert.deepStrictEqual(
  rules.LINES.burger.stages.map((stage) => stage.key),
  ['ranch', 'grinders', 'burgerMakers', 'burgerShops'],
);
assert.ok(rules.MAPS.farm.routes.ranchers, '存在牧场工路线');
assert.ok(rules.MAPS.farm.routes.pattyPorters, '存在肉饼搬运工路线');
assert.ok(rules.MAPS.farm.routes.burgerWorkers, '存在汉堡工路线');

const burgerLine = core.createState(rules, 0);
burgerLine.coins = 1000;
core.unlockNode(burgerLine, 'farm', 'grinder1', rules);
core.unlockNode(burgerLine, 'farm', 'burgerMaker1', rules);
core.unlockNode(burgerLine, 'farm', 'burgerShop1', rules);
assert.strictEqual(core.hireWorker(burgerLine, 'farm', 'ranchers', rules).ok, true);
assert.strictEqual(core.hireWorker(burgerLine, 'farm', 'pattyPorters', rules).ok, true);
assert.strictEqual(core.hireWorker(burgerLine, 'farm', 'burgerWorkers', rules).ok, true);
const burgerCoins0 = burgerLine.coins;
core.advance(burgerLine, 60, rules);
assert.ok(burgerLine.stats.delivered.beef > 0, '牛肉被送进绞肉机');
assert.ok(burgerLine.stats.delivered.patty > 0, '肉饼被送进汉堡机');
assert.ok(burgerLine.stats.sold.burger > 0, '汉堡被卖出');
assert.ok(burgerLine.coins > burgerCoins0, '汉堡线产生金币');

// 离线折算
assert.strictEqual(core.beatsForOffline(8 * 3600 * 1000, rules), 14400);
assert.strictEqual(core.beatsForOffline(3000, rules), 1);

console.log('farm-core v2 tests passed');
