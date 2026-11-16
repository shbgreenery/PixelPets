'use strict';

// 存档层单测：读写往返、版本迁移、坏档容错、旧档缺内容补齐、源节点保持无限。
const assert = require('assert');
const { createStore, migrate } = require('./farm-store.js');
const { createState, hydrate } = require('./farm-core.js');
const rules = require('./farm-rules.js');

function memoryAdapter() {
  let text = null;
  return {
    read: async () => text,
    write: async (v) => { text = v; },
    remove: async () => { text = null; },
  };
}

(async () => {
  const adapter = memoryAdapter();
  const store = createStore(adapter);
  const state = createState(rules, 123);
  await store.save(state);
  assert.deepStrictEqual(await store.load(), state);

  await store.clear();
  assert.strictEqual(await store.load(), null);

  assert.throws(() => migrate({ version: 99, payload: {} }), /版本/);

  const bad = memoryAdapter();
  await bad.write('{bad');
  assert.strictEqual(await createStore(bad).load(), null, '坏档读成 null');

  const stale = createState(rules, 0);
  delete stale.maps.farm.nodes.mill1;
  stale.maps.farm.routes.farmers.workers = [
    { id: 'farmers-1', speed: 2, backpack: 1, speedUpgrades: 1, backpackUpgrades: 0, counter: 0 },
  ];
  hydrate(stale, rules);
  assert.strictEqual(stale.maps.farm.nodes.mill1.level, 1);
  assert.strictEqual(stale.maps.farm.nodes.field.source, true);
  assert.strictEqual(stale.maps.farm.routes.farmers.workers.length, 1, '工人数组保留');
  assert.strictEqual(stale.maps.farm.routes.farmers.workers[0].speed, 2);

  console.log('farm-store tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
