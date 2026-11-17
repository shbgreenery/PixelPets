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
  assert.deepStrictEqual(picked, { ok: true, itemId: 'wheat', qty: 2 });

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

  console.log('slow-farm-app 通过');
})();
