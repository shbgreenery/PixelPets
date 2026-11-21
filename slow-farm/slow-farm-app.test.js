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

  // 动物加速：单个 target 与一键加速都经 app 透传并落盘
  state.xp = 500;
  state.coins = 5000;
  state.silo.feed = 2;
  await app.buyAnimal('chicken');
  await app.buyAnimal('chicken');
  await app.feedAnimal('chicken', 0);
  await app.feedAnimal('chicken', 1);
  state.hourglasses = 2;
  const rushOne = await app.useHourglass({ kind: 'animal', kindId: 'chicken', index: 0 });
  assert.strictEqual(rushOne.ok, true, 'app 透传动物 target');
  assert.strictEqual(state.animals.chicken.list[0].readyAt, clock, '动物 readyAt 被拉到当前时刻');
  const batchRush = await app.useHourglassOnAnimals('chicken');
  assert.deepStrictEqual(batchRush, { ok: true, used: 1, stopped: null });
  assert.strictEqual(state.animals.chicken.list[1].readyAt, clock);
  assert.strictEqual(state.hourglasses, 0);
  await app.collectAnimal('chicken', 0);
  await app.collectAnimal('chicken', 1);
  assert.strictEqual(state.xp, 502, '收集动物加经验');

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

  // 写盘失败时动作照样成功，但必须带上 saveFailed 让界面提示
  const failingAdapter = memoryAdapter();
  failingAdapter.write = async () => false;
  const failingStore = createStore(failingAdapter);
  const failingApp = createApp({ rules, store: failingStore, now: () => clock, rng: () => 0 });
  const failingStart = await failingApp.start();
  assert.strictEqual(failingStart.saveFailed, true, '读档后的首次落盘失败要上报');
  const failingPlant = await failingApp.plant(failingApp.getState().plots.length - 1, 'wheat');
  assert.strictEqual(failingPlant.ok, true, '写盘失败不影响内存里的动作结果');
  assert.strictEqual(failingPlant.saveFailed, true, '动作写盘失败要标记');

  // 坏档重开：要能告诉界面「档坏了」，而不是假装全新开局
  const badAdapter = memoryAdapter();
  await badAdapter.write('{bad json');
  const badApp = createApp({ rules, store: createStore(badAdapter), now: () => clock, rng: () => 0 });
  const badStart = await badApp.start();
  assert.strictEqual(badStart.loadProblem, 'parse', '坏档要上报 problem');
  assert.strictEqual(badStart.state.xp, 0);

  // 正常读档时 problem 为空
  const cleanAdapter = memoryAdapter();
  const cleanApp = createApp({ rules, store: createStore(cleanAdapter), now: () => clock, rng: () => 0 });
  const cleanStart = await cleanApp.start();
  assert.strictEqual(cleanStart.loadProblem, null);
  assert.strictEqual(cleanStart.saveFailed, false);

  // 导出：拿到的是完整存档文本，且能被重新读回
  const exportedText = cleanApp.exportSave();
  assert.ok(typeof exportedText === 'string', '导出应有文本');
  assert.strictEqual(JSON.parse(exportedText).payload.xp, cleanApp.getState().xp, '导出的是当前状态');

  // 导入前的预览：不碰当前进度，只告诉你文件里是什么
  const importTarget = createApp({ rules, store: createStore(memoryAdapter()), now: () => clock, rng: () => 0 });
  await importTarget.start();
  const preview = importTarget.inspectSave(exportedText);
  assert.strictEqual(preview.ok, true, '合法文件应能预览');
  assert.strictEqual(preview.level, 1, '预览里带等级');
  assert.strictEqual(importTarget.getState().xp, 0, '预览不能改动当前状态');

  // 导入：写入成功并落盘，之后读档能看到导入的进度
  const importAdapter = memoryAdapter();
  const importApp = createApp({ rules, store: createStore(importAdapter), now: () => clock, rng: () => 0 });
  await importApp.start();
  const sourceState = importApp.getState();
  sourceState.xp = 27000;
  sourceState.coins = 12345;
  const sourceText = importApp.exportSave();

  const targetApp = createApp({ rules, store: createStore(importAdapter), now: () => clock, rng: () => 0 });
  await targetApp.start();
  const imported = await targetApp.importSave(sourceText);
  assert.strictEqual(imported.ok, true, '合法存档应导入成功');
  assert.strictEqual(targetApp.getState().xp, 27000, '内存里换成导入的进度');
  const persisted = await createStore(importAdapter).load();
  assert.strictEqual(persisted.xp, 27000, '导入后必须立刻落盘');

  // 坏文件不能被导入，也不能破坏当前进度
  const beforeXp = targetApp.getState().xp;
  const rejected = await targetApp.importSave('{bad json');
  assert.strictEqual(rejected.ok, false, '坏文件必须拒绝');
  assert.strictEqual(rejected.reason, 'bad_file');
  assert.strictEqual(targetApp.getState().xp, beforeXp, '拒绝时不能改动当前进度');
  assert.strictEqual(targetApp.inspectSave('').ok, false, '空文件也要拒绝');

  // 导入时写盘失败要上报，不能假装成功
  const noWriteAdapter = memoryAdapter();
  const noWriteApp = createApp({ rules, store: createStore(noWriteAdapter), now: () => clock, rng: () => 0 });
  await noWriteApp.start();
  noWriteAdapter.write = async () => false;
  const failedImport = await noWriteApp.importSave(sourceText);
  assert.strictEqual(failedImport.ok, true, '内存导入仍算成功');
  assert.strictEqual(failedImport.saveFailed, true, '写盘失败必须标记');

  console.log('slow-farm-app 通过');
})();
