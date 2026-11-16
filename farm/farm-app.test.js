'use strict';

// 用例层单测：读档、离线结算、金币与广告支付、节拍推进。
const assert = require('assert');
const rules = require('./farm-rules.js');
const { createApp, instantAdProvider } = require('./farm-app.js');

function memoryStore() {
  let state = null;
  return {
    load: async () => state,
    save: async (s) => { state = JSON.parse(JSON.stringify(s)); },
    clear: async () => { state = null; },
  };
}

(async () => {
  let clock = 1000000;
  const store = memoryStore();
  const app = createApp({ rules, store, now: () => clock, adProvider: instantAdProvider });

  let res = await app.start();
  assert.strictEqual(res.offline, null);
  assert.strictEqual(app.getState().coins, 0);
  assert.strictEqual(app.getState().maps.farm.nodes.field.source, true);

  // 0 元建磨坊，取麦，送达 +10
  let r = app.unlockNode('farm', 'mill1');
  assert.strictEqual(r.ok, true);
  r = app.take('farm', 'field', 'wheat');
  assert.strictEqual(r.qty, 10);
  const firstQuest = app.claimQuest('q_harvest');
  assert.strictEqual(firstQuest.ok, true);
  assert.strictEqual(app.getState().coins, 20);
  r = app.deposit('farm', 'mill1', 'wheat');
  assert.strictEqual(r.reward, 10);
  assert.strictEqual(app.getState().coins, 30);

  // 雇一个农民
  app.getState().coins = 100;
  r = app.hire('farm', 'farmers');
  assert.strictEqual(r.ok, true);
  const farmer = app.getState().maps.farm.routes.farmers.workers[0];
  assert.ok(farmer);
  assert.strictEqual(farmer.speed, 3);
  assert.strictEqual(farmer.backpack, 1);

  // 这个农民单独升速度：3 拍 -> 2 拍，花 100
  app.getState().coins = 200;
  const speedUp = await app.upgradeWorker('farm', 'farmers', farmer.id, 'speed');
  assert.strictEqual(speedUp.ok, true);
  assert.strictEqual(farmer.speed, 2);
  assert.strictEqual(app.getState().coins, 100);

  // 单独升背包：1 -> 2，花 120
  app.getState().coins = 200;
  const packUp = await app.upgradeWorker('farm', 'farmers', farmer.id, 'backpack');
  assert.strictEqual(packUp.ok, true);
  assert.strictEqual(farmer.backpack, 2);
  assert.strictEqual(app.getState().coins, 80);

  // 广告背包升级：第 4 档用广告
  app.getState().coins = 0;
  farmer.backpackUpgrades = 2;
  const adUp = await app.upgradeWorker('farm', 'farmers', farmer.id, 'backpack');
  assert.strictEqual(adUp.ok, true);
  assert.strictEqual(farmer.backpack, 4);
  assert.strictEqual(app.getState().coins, 0);

  // 金币不足时升级返回 coins，而不是笼统的 payment
  app.getState().coins = 0;
  app.getState().maps.farm.nodes.mill1.level = 1;
  const broke = await app.upgradeNode('farm', 'mill1');
  assert.strictEqual(broke.ok, false);
  assert.strictEqual(broke.reason, 'coins');

  // 看广告得金币
  const coinsBeforeAdCoins = app.getState().coins;
  const adCoins = await app.claimAdCoins();
  assert.strictEqual(adCoins.ok, true);
  assert.strictEqual(adCoins.coins, 100);
  assert.strictEqual(app.getState().coins, coinsBeforeAdCoins + 100);

  // 广告失败不给金币
  const denyApp = createApp({ rules, store: memoryStore(), now: () => clock, adProvider: { show: async () => false } });
  await denyApp.start();
  const denied = await denyApp.claimAdCoins();
  assert.strictEqual(denied.ok, false);
  assert.strictEqual(denied.reason, 'ad_failed');

  // 金币升级：磨坊 1→2 花 120
  app.getState().coins = 200;
  const up = await app.upgradeNode('farm', 'mill1');
  assert.strictEqual(up.ok, true);
  assert.strictEqual(app.getState().maps.farm.nodes.mill1.level, 2);
  assert.strictEqual(app.getState().coins, 80);

  // 广告升级：3→4 不扣金币
  app.getState().maps.farm.nodes.mill1.level = 3;
  const coinsBeforeAd = app.getState().coins;
  const ad = await app.upgradeNode('farm', 'mill1');
  assert.strictEqual(ad.ok, true);
  assert.strictEqual(app.getState().maps.farm.nodes.mill1.level, 4);
  assert.strictEqual(app.getState().coins, coinsBeforeAd);

  // 离线：建售货台，放 10 个面包，8 小时后结算 +40
  const offlineState = app.getState();
  offlineState.coins = 1000;
  offlineState.maps.farm.routes.farmers.workers = [];
  app.unlockNode('farm', 'counter1');
  offlineState.maps.farm.nodes.counter1.in.bread = 10;
  await store.save(offlineState);
  clock += 8 * 3600 * 1000;

  const app2 = createApp({ rules, store, now: () => clock, adProvider: instantAdProvider });
  res = await app2.start();
  assert.strictEqual(res.offline.beats, 14400);
  assert.strictEqual(res.offline.coins, 40, '10 个面包各卖 4 金币');
  assert.strictEqual(app2.getState().lastTickAt, clock);

  // 节拍推进
  clock += 1000;
  app2.tick();
  assert.strictEqual(app2.getState().lastTickAt, clock);

  console.log('farm-app tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
