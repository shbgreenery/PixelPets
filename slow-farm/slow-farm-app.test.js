'use strict';

const assert = require('assert');
const { createApp, instantAdProvider } = require('./slow-farm-app.js');
const { createStore } = require('./slow-farm-store.js');
const rules = require('./slow-farm-rules.js');

function memoryAdapter() {
  let text = null;
  return {
    read: async () => text,
    write: async (v) => { text = v; },
    remove: async () => { text = null; },
  };
}

(async () => {
  let clock = 0;
  const adapter = memoryAdapter();
  const store = createStore(adapter);
  const app = createApp({
    rules, store,
    now: () => clock,
    rng: () => 0,
    adProvider: instantAdProvider,
  });

  const { state } = await app.start();
  assert.strictEqual(state.coins, 50);

  // 动作成功后立刻写盘
  await app.plant(0, 'wheat');
  const reloaded = await createStore(adapter).load();
  assert.strictEqual(reloaded.plots[0].cropId, 'wheat', '动作后应立即落盘');

  // 时间来自注入的 now
  assert.strictEqual(state.plots[0].readyAt, 2 * 60 * 1000);
  clock = 2 * 60 * 1000;
  const picked = await app.harvest(0);
  assert.strictEqual(picked.ok, true);
  assert.strictEqual(picked.itemId, 'wheat');
  assert.strictEqual(picked.qty, 2);
  assert.ok(Array.isArray(picked.unlocked) && picked.unlocked.some(function (deed) {
    return deed.id === 'firstHarvest';
  }), '首次收获会解锁成就');

  // 广告走适配器，返回钻石
  const ad = await app.watchAd();
  assert.strictEqual(ad.ok, true);
  assert.strictEqual(state.gems, 5 + rules.GEMS.adReward);

  // 广告失败时不发钻石
  const failing = createApp({
    rules, store, now: () => clock, rng: () => 0,
    adProvider: { show: async () => false },
  });
  await failing.start();
  const before = failing.getState().gems;
  const denied = await failing.watchAd();
  assert.strictEqual(denied.ok, false);
  assert.strictEqual(failing.getState().gems, before);

  // 未知动作不抛错，只返回 reason
  const miss = await app.harvest(99);
  assert.strictEqual(miss.ok, false);
  assert.ok(typeof miss.reason === 'string');

  // reason 都有人话
  assert.strictEqual(typeof require('./slow-farm-app.js').reasons.no_coins, 'string');

  // 回归时长：读档时算出离开了多久
  const awayAdapter = memoryAdapter();
  const awayStore = createStore(awayAdapter);
  let awayClock = 1000;
  const awayApp = createApp({ rules, store: awayStore, now: () => awayClock, rng: () => 0 });
  await awayApp.start();
  awayClock = 1000 + 2 * 60 * 60 * 1000;
  const awayApp2 = createApp({ rules, store: awayStore, now: () => awayClock, rng: () => 0 });
  const restarted = await awayApp2.start();
  assert.strictEqual(restarted.awayMs, 2 * 60 * 60 * 1000, '两小时');

  // 特供单交完后，当天重开页面不该再补一张
  const dailyAdapter = memoryAdapter();
  const dailyStore = createStore(dailyAdapter);
  let dailyClock = 1000;
  const dailyApp = createApp({ rules, store: dailyStore, now: () => dailyClock, rng: () => 0 });
  const first = await dailyApp.start();
  const dailyOrder = first.state.dailyOrder;
  assert.ok(dailyOrder, '当天应有一张特供单');
  dailyOrder.lines.forEach(function (line) { first.state.silo[line.itemId] = line.quantity; });
  const delivered = await dailyApp.deliverOrder(dailyOrder.id);
  assert.strictEqual(delivered.ok, true);
  assert.strictEqual(dailyApp.getState().dailyOrder, null);

  dailyClock += 60 * 1000;
  const dailyApp2 = createApp({ rules, store: dailyStore, now: () => dailyClock, rng: () => 0 });
  const reopened = await dailyApp2.start();
  assert.strictEqual(reopened.state.dailyOrder, null, '交完当天重开不再补单');

  console.log('slow-farm-app 通过');
})();
