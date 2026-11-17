'use strict';

// 用例层：读档与动作编排。不碰 DOM。
// 本层没有 tick：所有计时靠绝对时间戳，状态不会自己变化。

const core = typeof require !== 'undefined'
  ? require('./slow-farm-core.js')
  : {
      createState,
      hydrate,
      plant,
      harvest,
      plantAll,
      harvestAll,
      enqueue,
      collectReady,
      unlockRecipe,
      buyQueueSlot,
      deliverOrder,
      abandonOrder,
      buyOrderSlot,
      buyPlot,
      buyMachine,
      buySiloSlot,
      sellItem,
      buyAnimal,
      feedAnimal,
      collectAnimal,
      feedAll,
      collectAll,
      buyStableSlot,
      buyHourglass,
      useHourglass,
      useHourglassOnPlots,
      grantAdGems,
      grantPaidGems,
    };

// 本地模式下的广告实现：点击即成功。将来接真实激励视频只替换这里。
const instantAdProvider = {
  async show() { return true; },
};

const reasons = {
  no_state: '还没读档',
  bad_plot: '地块编号无效',
  plot_occupied: '这块地已经种了',
  unknown_crop: '没有这种作物',
  locked: '等级不够',
  empty_plot: '这块地是空的',
  not_ready: '还没成熟',
  silo_full: '仓库已满',
  unknown_machine: '没有这台机器',
  machine_locked: '机器还没建',
  queue_full: '队列已满',
  unknown_recipe: '没有这个配方',
  wrong_machine: '这个配方不属于这台机器',
  missing_input: '原料不足',
  recipe_locked: '配方还没解锁',
  max_queue: '队列位置已满',
  max_order_slots: '订单位已满',
  unknown_animal: '没有这种动物',
  stable_full: '畜舍满了',
  animal_busy: '这只动物还在产',
  unknown_order: '订单不存在',
  missing_items: '库存不足',
  bad_quantity: '数量不正确',
  no_coins: '金币不够',
  max_plots: '地块已满',
  already: '已经拥有',
  max_slots: '仓库格已满',
  unknown_item: '没有这种物品',
  not_enough: '库存不足',
  bad_target: '目标无效',
  no_hourglass: '没有沙漏',
  nothing_running: '没有正在进行的计时',
  ad_failed: '广告加载失败',
};

function createApp({ rules, store, now, rng = Math.random, adProvider = instantAdProvider, wrapState = (x) => x }) {
  let state = null;

  async function persist() {
    if (state) await store.save(state);
  }

  async function start() {
    const loaded = await store.load();
    state = wrapState(loaded ? core.hydrate(loaded, rules, rng) : core.createState(rules, rng));
    await persist();
    return { state };
  }

  async function run(action) {
    if (!state) return { ok: false, reason: 'no_state' };
    const result = action();
    if (result.ok) await persist();
    return result;
  }

  function current() {
    return state;
  }

  return {
    start,
    getState: current,
    save: persist,

    plant: (plotIndex, cropId) => run(() => core.plant(state, plotIndex, cropId, now(), rules)),
    harvest: (plotIndex) => run(() => core.harvest(state, plotIndex, now(), rules)),
    plantAll: (cropId) => run(() => core.plantAll(state, cropId, now(), rules)),
    harvestAll: () => run(() => core.harvestAll(state, now(), rules)),

    enqueue: (machineId, recipeId) => run(() => core.enqueue(state, machineId, recipeId, now(), rules)),
    collectReady: (machineId) => run(() => core.collectReady(state, machineId, now(), rules)),
    unlockRecipe: (recipeId) => run(() => core.unlockRecipe(state, recipeId, rules)),
    buyQueueSlot: (machineId) => run(() => core.buyQueueSlot(state, machineId, rules)),

    deliverOrder: (orderId) => run(() => core.deliverOrder(state, orderId, rules, rng)),
    abandonOrder: (orderId) => run(() => core.abandonOrder(state, orderId, rules, rng)),
    buyOrderSlot: () => run(() => core.buyOrderSlot(state, rules, rng)),

    buyPlot: () => run(() => core.buyPlot(state, rules)),
    buyMachine: (machineId) => run(() => core.buyMachine(state, machineId, rules)),
    buySiloSlot: () => run(() => core.buySiloSlot(state, rules)),

    buyAnimal: (kind) => run(() => core.buyAnimal(state, kind, rules)),
    feedAnimal: (kind, index) => run(() => core.feedAnimal(state, kind, index, now(), rules)),
    collectAnimal: (kind, index) => run(() => core.collectAnimal(state, kind, index, now(), rules)),
    feedAll: (kind) => run(() => core.feedAll(state, kind, now(), rules)),
    collectAll: (kind) => run(() => core.collectAll(state, kind, now(), rules)),
    buyStableSlot: (kind) => run(() => core.buyStableSlot(state, kind, rules)),
    sellItem: (itemId, quantity) => run(() => core.sellItem(state, itemId, quantity, rules)),

    buyHourglass: (quantity) => run(() => core.buyHourglass(state, quantity, rules)),
    useHourglass: (target) => run(() => core.useHourglass(state, target, now(), rules)),
    useHourglassOnPlots: () => run(() => core.useHourglassOnPlots(state, now(), rules)),

    buyGems: () => run(() => core.grantPaidGems(state, rules)),

    async watchAd() {
      if (!state) return { ok: false, reason: 'no_state' };
      const shown = await adProvider.show('rewarded');
      if (!shown) return { ok: false, reason: 'ad_failed' };
      return run(() => core.grantAdGems(state, rules));
    },
  };
}

if (typeof module !== 'undefined') {
  module.exports = { createApp, instantAdProvider, reasons };
}
