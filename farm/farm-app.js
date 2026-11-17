'use strict';

// 用例层：读档、推进、操作编排与成本支付。不碰 DOM。

const core = typeof require !== 'undefined'
  ? require('./farm-core.js')
  : {
      createState,
      hydrate,
      advance,
      take,
      deposit,
      discard,
      payCoins,
      upgradeCost,
      applyNodeUpgrade,
      applyBackpackUpgrade,
      workerUpgradeCost,
      applyWorkerUpgrade,
      hireCost,
      hireWorker,
      unlockCost,
      unlockNode,
      beatsForOffline,
      claimReward,
      questStatus,
      claimQuest,
    };

// 离线与本地模式下的广告实现：点击即成功。将来换成微信激励视频只替换这里。
const instantAdProvider = {
  async show() { return true; },
};

function createApp({ rules, store, now, adProvider, wrapState = (x) => x }) {
  let state = null;
  let lastSaveAt = 0;

  function saveSoon(force) {
    if (!state) return;
    if (!force && now() - lastSaveAt < 5000) return;
    lastSaveAt = now();
    store.save(state).catch(() => {});
  }

  async function start() {
    const loaded = await store.load();
    state = wrapState(loaded ? core.hydrate(loaded, rules) : core.createState(rules, now()));

    const elapsed = Math.max(0, now() - state.lastTickAt);
    let offline = null;

    if (elapsed > rules.OFFLINE_THRESHOLD_MS) {
      const beats = core.beatsForOffline(elapsed, rules);
      const before = state.coins;
      core.advance(state, beats, rules);
      offline = { elapsedMs: elapsed, beats, coins: state.coins - before };
    } else if (elapsed > 0) {
      core.advance(state, Math.floor(elapsed / rules.BEAT_MS), rules);
    }

    state.lastTickAt = now();
    await store.save(state);
    lastSaveAt = now();
    return { state, offline };
  }

  // 回到前台：在内存态上补算，不重读磁盘，避免一次写失败把已付款进度回滚。
  function resume() {
    if (!state) return start();

    const elapsed = Math.max(0, now() - state.lastTickAt);
    let offline = null;

    if (elapsed > rules.OFFLINE_THRESHOLD_MS) {
      const beats = core.beatsForOffline(elapsed, rules);
      const before = state.coins;
      core.advance(state, beats, rules);
      offline = { elapsedMs: elapsed, beats, coins: state.coins - before };
    } else if (elapsed > 0) {
      core.advance(state, Math.floor(elapsed / rules.BEAT_MS), rules);
    }

    state.lastTickAt = now();
    saveSoon(true);
    return { state, offline };
  }

  function tick() {
    if (!state) return { coinsEarned: 0 };

    const elapsed = Math.max(0, now() - state.lastTickAt);
    if (elapsed < rules.BEAT_MS) return { coinsEarned: 0 };

    let result;
    if (elapsed > rules.OFFLINE_THRESHOLD_MS) {
      const beats = core.beatsForOffline(elapsed, rules);
      result = core.advance(state, beats, rules);
      state.lastTickAt = now();
    } else {
      const beats = Math.floor(elapsed / rules.BEAT_MS);
      result = core.advance(state, beats, rules);
      state.lastTickAt += beats * rules.BEAT_MS;
    }

    saveSoon(false);
    return result;
  }

  async function pay(cost) {
    if (!cost) return { ok: false, reason: 'bad_cost' };
    if (Number.isFinite(cost.coin)) {
      return core.payCoins(state, cost.coin) ? { ok: true } : { ok: false, reason: 'coins', cost };
    }
    if (typeof cost.ad === 'string') {
      return (await adProvider.show(cost.ad)) ? { ok: true } : { ok: false, reason: 'ad_failed', cost };
    }
    return { ok: false, reason: 'bad_cost' };
  }

  async function upgradeNode(mapId, nodeId) {
    if (!state) return { ok: false, reason: 'no_state' };
    const mapDef = rules.MAPS[mapId];
    const nodeDef = mapDef && mapDef.nodes[nodeId];
    const nodeState = state.maps[mapId] && state.maps[mapId].nodes[nodeId];
    if (!nodeDef || !nodeState) return { ok: false, reason: 'bad_node' };

    const cost = core.upgradeCost(rules, nodeDef, nodeState.level);
    if (!cost) return { ok: false, reason: 'max' };
    const paid = await pay(cost);
    if (!paid.ok) return paid;

    const result = core.applyNodeUpgrade(state, mapId, nodeId, rules);
    saveSoon(true);
    return result;
  }

  async function upgradeWorker(mapId, routeId, workerId, stat) {
    if (!state) return { ok: false, reason: 'no_state' };
    if (stat !== 'speed' && stat !== 'backpack') return { ok: false, reason: 'bad_stat' };
    const mapDef = rules.MAPS[mapId];
    const routeDef = mapDef && mapDef.routes[routeId];
    const routeState = state.maps[mapId] && state.maps[mapId].routes[routeId];
    if (!routeDef || !routeState) return { ok: false, reason: 'bad_route' };
    const worker = (routeState.workers || []).find((item) => item.id === workerId);
    if (!worker) return { ok: false, reason: 'bad_worker' };

    const cost = core.workerUpgradeCost(routeDef, worker, stat);
    if (!cost) return { ok: false, reason: 'max' };
    const paid = await pay(cost);
    if (!paid.ok) return paid;

    const result = core.applyWorkerUpgrade(state, mapId, routeId, workerId, stat, rules);
    saveSoon(true);
    return result;
  }

  async function upgradeBackpack() {
    if (!state) return { ok: false, reason: 'no_state' };

    const cost = core.upgradeCost(rules, rules.PLAYER, state.player.level);
    if (!cost) return { ok: false, reason: 'max' };
    const paid = await pay(cost);
    if (!paid.ok) return paid;

    const result = core.applyBackpackUpgrade(state, rules);
    saveSoon(true);
    return result;
  }

  function hire(mapId, routeId) {
    if (!state) return { ok: false, reason: 'no_state' };
    const result = core.hireWorker(state, mapId, routeId, rules);
    if (result.ok) saveSoon(true);
    return result;
  }

  function unlockNode(mapId, nodeId) {
    if (!state) return { ok: false, reason: 'no_state' };
    const result = core.unlockNode(state, mapId, nodeId, rules);
    if (result.ok) saveSoon(true);
    return result;
  }

  async function claimReward(id) {
    if (!state) return { ok: false, reason: 'no_state' };
    const reward = rules.REWARDS && rules.REWARDS[id];
    if (!reward) return { ok: false, reason: 'unknown' };
    if (reward.cost && !(await pay(reward.cost))) return { ok: false, reason: 'payment' };

    const result = core.claimReward(state, id, rules);
    if (result.ok) saveSoon(true);
    return result;
  }

  async function claimAdCoins() {
    if (!state) return { ok: false, reason: 'no_state' };
    const config = rules.AD || { coins: 100, placement: 'rewarded' };
    if (!(await adProvider.show(config.placement))) return { ok: false, reason: 'ad_failed' };
    state.coins += config.coins;
    saveSoon(true);
    return { ok: true, coins: config.coins };
  }

  function claimQuest(id) {
    if (!state) return { ok: false, reason: 'no_state' };
    const result = core.claimQuest(state, id, rules);
    if (result.ok) saveSoon(true);
    return result;
  }

  function take(mapId, nodeId, item) {
    if (!state) return { ok: false, reason: 'no_state' };
    const result = core.take(state, mapId, nodeId, item, rules);
    if (result.ok) saveSoon(true);
    return result;
  }

  function deposit(mapId, nodeId, item) {
    if (!state) return { ok: false, reason: 'no_state' };
    const result = core.deposit(state, mapId, nodeId, item, rules);
    if (result.ok) saveSoon(true);
    return result;
  }

  function discard() {
    if (!state) return { ok: false, reason: 'no_state' };
    const result = core.discard(state);
    saveSoon(true);
    return result;
  }

  function switchMap(mapId) {
    if (!state) return { ok: false, reason: 'no_state' };
    if (!state.unlockedMaps.includes(mapId)) return { ok: false, reason: 'locked' };
    state.activeMap = mapId;
    saveSoon(true);
    return { ok: true };
  }

  async function save() {
    if (state) await store.save(state);
  }

  function getState() {
    return state;
  }

  return {
    start,
    resume,
    tick,
    take,
    deposit,
    discard,
    hire,
    upgradeNode,
    upgradeWorker,
    upgradeBackpack,
    unlockNode,
    claimReward,
    claimAdCoins,
    claimQuest,
    save,
    getState,
    switchMap,
  };
}

if (typeof module !== 'undefined') {
  module.exports = { createApp, instantAdProvider };
}
