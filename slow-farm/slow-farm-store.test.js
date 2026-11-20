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

  // 写盘失败要能被上层看见
  const failing = memoryAdapter();
  failing.write = async () => false;
  assert.strictEqual(await createStore(failing).save(state), false, '写失败应返回 false');
  assert.strictEqual(await createStore(memoryAdapter()).save(state), true, '写成功应返回 true');

  // 读档要能区分「没有档」和「档坏了」
  assert.deepStrictEqual(await createStore(memoryAdapter()).loadDetailed(), { state: null, problem: 'empty' });
  await createStore(adapter).save(state);
  const goodDetail = await createStore(adapter).loadDetailed();
  assert.strictEqual(goodDetail.problem, null, '好档没有 problem');
  assert.strictEqual(goodDetail.state.xp, state.xp);

  // 坏档先备份原文，再交给上层开新档
  const corrupt = memoryAdapter();
  await corrupt.write('{bad json');
  let corruptBackup = null;
  corrupt.backup = async (text) => { corruptBackup = text; };
  const corruptStore = createStore(corrupt);
  assert.deepStrictEqual(await corruptStore.loadDetailed(), { state: null, problem: 'parse' });
  assert.strictEqual(corruptBackup, '{bad json', '坏档原文要备份下来');
  assert.strictEqual(await corruptStore.load(), null);

  // 版本不符同样先备份
  const future = memoryAdapter();
  await future.write(JSON.stringify({ version: 99, payload: { xp: 1 } }));
  let futureBackup = null;
  future.backup = async (text) => { futureBackup = text; };
  const futureDetail = await createStore(future).loadDetailed();
  assert.strictEqual(futureDetail.problem, 'version');
  assert.ok(futureBackup && futureBackup.indexOf('"version":99') >= 0, '版本不符的档也要备份');

  // 空档没有可备份的东西
  const emptyBackups = [];
  const emptyWithBackup = memoryAdapter();
  emptyWithBackup.backup = async (text) => { emptyBackups.push(text); };
  await createStore(emptyWithBackup).loadDetailed();
  assert.deepStrictEqual(emptyBackups, [], '空档不应触发备份');

  console.log('slow-farm-store 通过');
})();
