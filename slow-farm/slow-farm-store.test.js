'use strict';

const assert = require('assert');
const { createStore, migrate, SAVE_VERSION } = require('./slow-farm-store.js');
const { createState } = require('./slow-farm-core.js');
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
  const adapter = memoryAdapter();
  const store = createStore(adapter);
  const state = createState(rules, () => 0);

  await store.save(state);
  const loaded = await store.load();
  assert.deepStrictEqual(loaded, state, '读写应完全往返');

  await store.clear();
  assert.strictEqual(await store.load(), null);

  assert.strictEqual(SAVE_VERSION, 5);
  assert.throws(() => migrate({ version: 99, payload: {} }), /版本/);
  assert.throws(() => migrate(null), /格式/);

  const bad = memoryAdapter();
  await bad.write('{bad json');
  assert.strictEqual(await createStore(bad).load(), null, '坏档应读成 null');

  const empty = memoryAdapter();
  assert.strictEqual(await createStore(empty).load(), null, '空存档应读成 null');

  console.log('slow-farm-store 通过');
})();
