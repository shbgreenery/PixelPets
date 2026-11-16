'use strict';

// 麦田工坊领域层：只认节点、端口、等级、路线这些概念。
// 不碰 DOM、存储、系统时钟与随机数；规则对象由调用方传入。

function parsePortRef(ref) {
  const parts = String(ref).split(':');
  if (parts.length !== 3) throw new Error(`端口地址格式错误：${ref}`);
  const [nodeId, side, item] = parts;
  if (side !== 'in' && side !== 'out') throw new Error(`端口方向错误：${ref}`);
  return { nodeId, side, item };
}

function portCap(levelDef, side, item) {
  const caps = levelDef && levelDef.caps && levelDef.caps[side];
  const value = caps && caps[item];
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`等级缺少端口容量：${side}.${item}`);
  }
  return value;
}

function validateCost(cost) {
  if (!cost || typeof cost !== 'object') throw new Error('成本格式错误');
  const hasCoin = Object.prototype.hasOwnProperty.call(cost, 'coin');
  const hasAd = Object.prototype.hasOwnProperty.call(cost, 'ad');
  if (hasCoin === hasAd) throw new Error('成本必须且只能包含 coin 或 ad');
  if (hasCoin && !(Number.isFinite(cost.coin) && cost.coin >= 0)) {
    throw new Error('成本 coin 必须是非负数');
  }
  if (hasAd && !(typeof cost.ad === 'string' && cost.ad.length > 0)) {
    throw new Error('成本 ad 必须是非空字符串');
  }
}

function validateContent(rules) {
  const { ITEMS, PLAYER, MAPS, LINES, REWARDS, QUESTS } = rules;

  for (const [id, item] of Object.entries(ITEMS)) {
    if (!item || typeof item.name !== 'string' || !item.name) {
      throw new Error(`物品定义错误：${id}`);
    }
  }

  if (!PLAYER || !Array.isArray(PLAYER.levels) || PLAYER.levels.length === 0) {
    throw new Error('玩家等级表为空');
  }
  for (const level of PLAYER.levels) {
    if (!Number.isFinite(level.cap) || level.cap <= 0) throw new Error('玩家背包容量错误');
    validateCost(level.cost);
  }

  const consumed = new Set();
  const produced = new Set();

  for (const [mapId, map] of Object.entries(MAPS)) {
    if (!map || typeof map.name !== 'string') throw new Error(`地图定义错误：${mapId}`);
    if (map.unlock) validateCost(map.unlock);

    for (const [nodeId, node] of Object.entries(map.nodes)) {
      const inItems = new Set();
      const outItems = new Set();

      for (const port of node.in || []) {
        if (!ITEMS[port.item]) throw new Error(`节点 ${nodeId} 输入口物品未知：${port.item}`);
        if (inItems.has(port.item)) throw new Error(`节点 ${nodeId} 输入口重复：${port.item}`);
        if (port.coin != null && (!Number.isInteger(port.coin) || port.coin < 0)) {
          throw new Error(`节点 ${nodeId} 输入口送达金币错误：${port.item}`);
        }
        inItems.add(port.item);
      }
      for (const port of node.out || []) {
        if (!ITEMS[port.item]) throw new Error(`节点 ${nodeId} 输出口物品未知：${port.item}`);
        if (outItems.has(port.item)) throw new Error(`节点 ${nodeId} 输出口重复：${port.item}`);
        outItems.add(port.item);
      }

      if (node.source) {
        if (inItems.size > 0) throw new Error(`源节点 ${nodeId} 不应有输入口`);
        if (outItems.size === 0) throw new Error(`源节点 ${nodeId} 需要输出口`);
        continue;
      }

      if (!Array.isArray(node.levels) || node.levels.length === 0) {
        throw new Error(`节点 ${nodeId} 等级表为空`);
      }

      node.levels.forEach((level, index) => {
        if (!Number.isInteger(level.beats) || level.beats <= 0) {
          throw new Error(`节点 ${nodeId} 第 ${index + 1} 级节拍错误`);
        }
        validateCost(level.cost);

        for (const item of inItems) {
          const cap = level.caps && level.caps.in && level.caps.in[item];
          if (!Number.isInteger(cap) || cap <= 0) {
            throw new Error(`节点 ${nodeId} 第 ${index + 1} 级缺少输入口容量：${item}`);
          }
        }
        for (const item of outItems) {
          const cap = level.caps && level.caps.out && level.caps.out[item];
          if (!Number.isInteger(cap) || cap <= 0) {
            throw new Error(`节点 ${nodeId} 第 ${index + 1} 级缺少输出口容量：${item}`);
          }
        }

        const consume = level.consume || {};
        const produce = level.produce || {};
        if (Object.keys(consume).length === 0 && Object.keys(produce).length === 0) {
          throw new Error(`节点 ${nodeId} 第 ${index + 1} 级没有配方`);
        }
        for (const [item, qty] of Object.entries(consume)) {
          if (!ITEMS[item]) throw new Error(`节点 ${nodeId} 配方消耗未知物品：${item}`);
          if (!inItems.has(item)) throw new Error(`节点 ${nodeId} 配方消耗没有对应输入口：${item}`);
          if (!Number.isInteger(qty) || qty <= 0) throw new Error(`节点 ${nodeId} 消耗数量错误`);
          consumed.add(item);
        }
        for (const [item, qty] of Object.entries(produce)) {
          if (!ITEMS[item]) throw new Error(`节点 ${nodeId} 配方产出未知物品：${item}`);
          if (!ITEMS[item].ledger && !outItems.has(item)) {
            throw new Error(`节点 ${nodeId} 配方产出没有对应输出口：${item}`);
          }
          if (!Number.isInteger(qty) || qty <= 0) throw new Error(`节点 ${nodeId} 产出数量错误`);
          produced.add(item);
        }
      });

      if (node.unlock) validateCost(node.unlock);
    }

    for (const [routeId, route] of Object.entries(map.routes)) {
      if (!route.fromKind || !route.toKind) throw new Error(`路线 ${routeId} 缺少来源或去向类型`);
      if (!ITEMS[route.item]) throw new Error(`路线 ${routeId} 物品未知：${route.item}`);

      const sources = Object.entries(map.nodes).filter(([, node]) => node.kind === route.fromKind);
      const dests = Object.entries(map.nodes).filter(([, node]) => node.kind === route.toKind);
      if (!sources.length) throw new Error(`路线 ${routeId} 来源类型不存在：${route.fromKind}`);
      if (!dests.length) throw new Error(`路线 ${routeId} 去向类型不存在：${route.toKind}`);

      const fromSide = route.fromSide || 'out';
      const toSide = route.toSide || 'in';
      if (fromSide !== 'out' || toSide !== 'in') throw new Error(`路线 ${routeId} 端口方向错误`);

      for (const [, node] of sources) {
        if (!(node.out || []).some((port) => port.item === route.item)) {
          throw new Error(`路线 ${routeId} 来源缺少输出口：${route.item}`);
        }
      }
      for (const [, node] of dests) {
        if (!(node.in || []).some((port) => port.item === route.item)) {
          throw new Error(`路线 ${routeId} 去向缺少输入口：${route.item}`);
        }
      }

      const worker = route.worker;
      if (!worker || !Number.isInteger(worker.speed) || worker.speed <= 0) {
        throw new Error(`路线 ${routeId} 工人速度错误`);
      }
      if (!Number.isInteger(worker.backpack) || worker.backpack <= 0) {
        throw new Error(`路线 ${routeId} 工人背包错误`);
      }
      for (const level of worker.speedLevels || []) {
        if (!Number.isInteger(level.beats) || level.beats <= 0) throw new Error(`路线 ${routeId} 速度升级错误`);
        validateCost(level.cost);
      }
      for (const level of worker.backpackLevels || []) {
        if (!Number.isInteger(level.backpack) || level.backpack <= 0) throw new Error(`路线 ${routeId} 背包升级错误`);
        validateCost(level.cost);
      }

      if (!route.hire || !(route.hire.base > 0) || !(route.hire.growth > 0)) {
        throw new Error(`路线 ${routeId} 雇工参数错误`);
      }
    }
  }

  const questIds = new Set((QUESTS || []).map((quest) => quest.id));
  const kinds = new Set();
  const routeIds = new Set();
  const nodeIds = new Set();
  for (const map of Object.values(MAPS)) {
    for (const id of Object.keys(map.routes)) routeIds.add(id);
    for (const [id, node] of Object.entries(map.nodes)) {
      nodeIds.add(id);
      if (node.kind) kinds.add(node.kind);
    }
  }
  const questTypes = ['machineCount', 'machineLevel', 'build', 'hire', 'hireLevel', 'consume', 'produce', 'sell', 'delivered', 'bag', 'coins'];
  const stageKeys = new Set();
  for (const [lineId, line] of Object.entries(LINES || {})) {
    if (!line || typeof line.name !== 'string' || !line.name) throw new Error(`产线 ${lineId} 名称错误`);
    if (!Array.isArray(line.stages) || line.stages.length === 0) throw new Error(`产线 ${lineId} 阶段为空`);
    for (const stage of line.stages) {
      if (!stage || typeof stage.key !== 'string' || !stage.key) throw new Error(`产线 ${lineId} 阶段键错误`);
      if (stageKeys.has(stage.key)) throw new Error(`产线阶段键重复：${stage.key}`);
      stageKeys.add(stage.key);
      if (typeof stage.name !== 'string' || !stage.name) throw new Error(`产线 ${lineId} 阶段名称错误`);
      if (!Array.isArray(stage.nodes) || stage.nodes.length === 0) throw new Error(`产线 ${lineId} 阶段 ${stage.key} 节点为空`);
      for (const id of stage.nodes) {
        if (!nodeIds.has(id)) throw new Error(`产线 ${lineId} 节点未知：${id}`);
      }
    }
  }
  for (const quest of QUESTS || []) {
    if (!quest.id || !quest.title) throw new Error('任务定义错误');
    for (const cond of quest.conditions || []) {
      if (!questTypes.includes(cond.type)) throw new Error(`任务 ${quest.id} 条件类型未知`);
      if (!Number.isInteger(cond.count) || cond.count <= 0) throw new Error(`任务 ${quest.id} 条件数量错误`);
      if (cond.item && !ITEMS[cond.item]) throw new Error(`任务 ${quest.id} 物品未知`);
      if (cond.kind && !kinds.has(cond.kind)) throw new Error(`任务 ${quest.id} 机器类型未知`);
      if (cond.route && !routeIds.has(cond.route)) throw new Error(`任务 ${quest.id} 工段未知`);
      if (cond.node && !nodeIds.has(cond.node)) throw new Error(`任务 ${quest.id} 节点未知`);
      if ((cond.type === 'machineLevel' || cond.type === 'hireLevel') && (!Number.isInteger(cond.level) || cond.level <= 0)) {
        throw new Error(`任务 ${quest.id} 等级错误`);
      }
    }
    for (const req of quest.requires || []) {
      if (!questIds.has(req)) throw new Error(`任务 ${quest.id} 前置任务未知`);
    }
    if (quest.reward && quest.reward.coins != null && !(Number.isFinite(quest.reward.coins) && quest.reward.coins >= 0)) {
      throw new Error(`任务 ${quest.id} 奖励错误`);
    }
  }

  for (const item of produced) {
    if (ITEMS[item].ledger) continue;
    if (!consumed.has(item)) throw new Error(`物品无消费者：${item}`);
  }

  for (const [id, reward] of Object.entries(REWARDS || {})) {
    validateCost(reward.cost);
    for (const [item, qty] of Object.entries(reward.grant || {})) {
      if (item === 'coins') {
        if (!Number.isFinite(qty) || qty <= 0) throw new Error(`奖励 ${id} 金币数量错误`);
      } else if (!ITEMS[item]) {
        throw new Error(`奖励 ${id} 物品未知：${item}`);
      }
    }
  }

  return true;
}

function isFreeMap(mapDef) {
  return !mapDef.unlock || mapDef.unlock.coin === 0;
}

function createState(rules, nowMs) {
  const maps = {};
  const unlockedMaps = [];

  for (const [mapId, mapDef] of Object.entries(rules.MAPS)) {
    const nodes = {};
    for (const [nodeId, nodeDef] of Object.entries(mapDef.nodes)) {
      if (nodeDef.source) {
        nodes[nodeId] = { unlocked: true, source: true };
        continue;
      }
      const inBuf = {};
      for (const port of nodeDef.in || []) inBuf[port.item] = 0;
      const outBuf = {};
      for (const port of nodeDef.out || []) outBuf[port.item] = 0;
      nodes[nodeId] = {
        level: 1,
        counter: 0,
        unlocked: !nodeDef.unlock,
        in: inBuf,
        out: outBuf,
      };
    }

    const routes = {};
    for (const [routeId, routeDef] of Object.entries(mapDef.routes)) {
      routes[routeId] = {
        workers: [],
        unlocked: true,
      };
    }

    maps[mapId] = { nodes, routes };
    if (isFreeMap(mapDef)) unlockedMaps.push(mapId);
  }

  return {
    version: 1,
    lastTickAt: Number.isFinite(nowMs) ? nowMs : 0,
    coins: 0,
    player: { item: null, qty: 0, level: 1 },
    activeMap: unlockedMaps[0] || Object.keys(rules.MAPS)[0] || null,
    unlockedMaps,
    maps,
    stats: { consumed: {}, produced: {}, sold: {}, delivered: {} },
    quests: {
      active: (rules.QUESTS || []).filter((quest) => !(quest.requires || []).length).map((quest) => quest.id),
      claimed: [],
    },
  };
}

function hydrate(state, rules) {
  if (!state || typeof state !== 'object') return createState(rules, 0);

  if (!Number.isFinite(state.version)) state.version = 1;
  if (!Number.isFinite(state.lastTickAt)) state.lastTickAt = 0;
  if (!Number.isFinite(state.coins)) state.coins = 0;

  if (!state.player || typeof state.player !== 'object') {
    state.player = { item: null, qty: 0, level: 1 };
  }
  const player = state.player;
  if (!Number.isInteger(player.level) || player.level < 1) player.level = 1;
  if (player.level > rules.PLAYER.levels.length) player.level = rules.PLAYER.levels.length;
  const playerCap = rules.PLAYER.levels[player.level - 1].cap;
  if (!Number.isFinite(player.qty) || player.qty < 0) player.qty = 0;
  if (player.qty > playerCap) player.qty = playerCap;
  if (player.qty <= 0) {
    player.qty = 0;
    player.item = null;
  }
  if (player.item !== null && !rules.ITEMS[player.item]) {
    player.qty = 0;
    player.item = null;
  }

  if (!state.maps || typeof state.maps !== 'object') state.maps = {};

  for (const [mapId, mapDef] of Object.entries(rules.MAPS)) {
    if (!state.maps[mapId] || typeof state.maps[mapId] !== 'object') {
      state.maps[mapId] = { nodes: {}, routes: {} };
    }
    const mapState = state.maps[mapId];
    if (!mapState.nodes || typeof mapState.nodes !== 'object') mapState.nodes = {};
    if (!mapState.routes || typeof mapState.routes !== 'object') mapState.routes = {};

    for (const [nodeId, nodeDef] of Object.entries(mapDef.nodes)) {
      if (nodeDef.source) {
        mapState.nodes[nodeId] = { unlocked: true, source: true };
        continue;
      }
      if (!mapState.nodes[nodeId] || typeof mapState.nodes[nodeId] !== 'object') {
        const inBuf = {};
        for (const port of nodeDef.in || []) inBuf[port.item] = 0;
        const outBuf = {};
        for (const port of nodeDef.out || []) outBuf[port.item] = 0;
        mapState.nodes[nodeId] = {
          level: 1,
          counter: 0,
          unlocked: !nodeDef.unlock,
          in: inBuf,
          out: outBuf,
        };
      }

      const nodeState = mapState.nodes[nodeId];
      if (!Number.isInteger(nodeState.level) || nodeState.level < 1) nodeState.level = 1;
      if (nodeState.level > nodeDef.levels.length) nodeState.level = nodeDef.levels.length;
      if (!Number.isFinite(nodeState.counter) || nodeState.counter < 0) nodeState.counter = 0;
      if (typeof nodeState.unlocked !== 'boolean') nodeState.unlocked = !nodeDef.unlock;
      if (!nodeDef.unlock) nodeState.unlocked = true;
      if (!nodeState.in || typeof nodeState.in !== 'object') nodeState.in = {};
      if (!nodeState.out || typeof nodeState.out !== 'object') nodeState.out = {};

      const levelDef = nodeDef.levels[nodeState.level - 1];
      for (const port of nodeDef.in || []) {
        if (!Number.isFinite(nodeState.in[port.item]) || nodeState.in[port.item] < 0) {
          nodeState.in[port.item] = 0;
        }
        const cap = levelDef.caps.in && levelDef.caps.in[port.item];
        if (Number.isFinite(cap) && nodeState.in[port.item] > cap) nodeState.in[port.item] = cap;
      }
      for (const port of nodeDef.out || []) {
        if (!Number.isFinite(nodeState.out[port.item]) || nodeState.out[port.item] < 0) {
          nodeState.out[port.item] = 0;
        }
        const cap = levelDef.caps.out && levelDef.caps.out[port.item];
        if (Number.isFinite(cap) && nodeState.out[port.item] > cap) nodeState.out[port.item] = cap;
      }
    }

    for (const [routeId, routeDef] of Object.entries(mapDef.routes)) {
      if (!mapState.routes[routeId] || typeof mapState.routes[routeId] !== 'object') {
        mapState.routes[routeId] = { workers: [], unlocked: true };
      }

      const routeState = mapState.routes[routeId];
      if (!Array.isArray(routeState.workers)) routeState.workers = [];
      routeState.unlocked = true;
      routeState.workers.forEach((worker, workerIndex) => {
        if (!worker.id) worker.id = routeId + '-' + (workerIndex + 1);
        if (!Number.isInteger(worker.speed) || worker.speed <= 0) worker.speed = routeDef.worker.speed;
        if (!Number.isInteger(worker.backpack) || worker.backpack <= 0) worker.backpack = routeDef.worker.backpack;
        if (!Number.isInteger(worker.counter) || worker.counter < 0) worker.counter = 0;
        if (!Number.isInteger(worker.speedUpgrades) || worker.speedUpgrades < 0) worker.speedUpgrades = 0;
        if (!Number.isInteger(worker.backpackUpgrades) || worker.backpackUpgrades < 0) worker.backpackUpgrades = 0;
      });
    }
  }

  const mapIds = Object.keys(rules.MAPS);
  if (!Array.isArray(state.unlockedMaps)) state.unlockedMaps = [];
  state.unlockedMaps = state.unlockedMaps.filter((id) => mapIds.includes(id));
  for (const mapId of mapIds) {
    if (isFreeMap(rules.MAPS[mapId]) && !state.unlockedMaps.includes(mapId)) {
      state.unlockedMaps.push(mapId);
    }
  }
  if (!state.activeMap || !state.unlockedMaps.includes(state.activeMap)) {
    state.activeMap = state.unlockedMaps[0] || mapIds[0] || null;
  }

  if (!state.stats || typeof state.stats !== 'object') state.stats = {};
  for (const key of ['consumed', 'produced', 'sold', 'delivered']) {
    if (!state.stats[key] || typeof state.stats[key] !== 'object') state.stats[key] = {};
  }

  if (!state.quests || typeof state.quests !== 'object') state.quests = { active: [], claimed: [] };
  if (!Array.isArray(state.quests.active)) state.quests.active = [];
  if (!Array.isArray(state.quests.claimed)) state.quests.claimed = [];
  const questIds = (rules.QUESTS || []).map((quest) => quest.id);
  state.quests.claimed = state.quests.claimed.filter((id) => questIds.includes(id));
  state.quests.active = state.quests.active.filter((id) => questIds.includes(id) && !state.quests.claimed.includes(id));
  if (!state.quests.active.length) {
    for (const quest of rules.QUESTS || []) {
      if (state.quests.claimed.includes(quest.id) || state.quests.active.includes(quest.id)) continue;
      if ((quest.requires || []).every((id) => state.quests.claimed.includes(id))) state.quests.active.push(quest.id);
    }
  }

  return state;
}

function kindNodes(mapDef, mapState, kind) {
  return Object.keys(mapDef.nodes)
    .filter((id) => mapDef.nodes[id].kind === kind && mapState.nodes[id] && mapState.nodes[id].unlocked)
    .sort();
}

function stepRoutes(state, mapState, mapDef, summary) {
  const routeIds = Object.keys(mapDef.routes).sort();

  for (const routeId of routeIds) {
    const routeDef = mapDef.routes[routeId];
    const routeState = mapState.routes[routeId];
    if (!routeState || !routeState.unlocked) continue;
    const workers = routeState.workers || [];

    workers.forEach((worker, workerIndex) => {
      worker.counter += 1;
      if (worker.counter % worker.speed !== 0) return;

      // 每个工人独立轮转，工段内的人不绑定某一台机器。
      const trip = Math.floor(worker.counter / worker.speed);
      const pick = trip - 1 + workerIndex;

      const dests = [];
      for (const id of kindNodes(mapDef, mapState, routeDef.toKind)) {
        const nodeState = mapState.nodes[id];
        const nodeDef = mapDef.nodes[id];
        const inPort = (nodeDef.in || []).find((port) => port.item === routeDef.item);
        if (!inPort) continue;
        const cap = portCap(nodeDef.levels[nodeState.level - 1], 'in', routeDef.item);
        const qty = nodeState.in[routeDef.item] || 0;
        if (qty < cap) dests.push({ id: id, space: cap - qty, nodeState: nodeState, nodeDef: nodeDef });
      }
      if (!dests.length) return;

      let src;
      const fromIds = kindNodes(mapDef, mapState, routeDef.fromKind);
      const isSource = fromIds.length > 0 && mapDef.nodes[fromIds[0]].source;
      if (isSource) {
        src = { infinite: true, qty: Infinity };
      } else {
        const sources = [];
        for (const id of fromIds) {
          const nodeState = mapState.nodes[id];
          const qty = (nodeState.out && nodeState.out[routeDef.item]) || 0;
          if (qty > 0) sources.push({ id: id, qty: qty, nodeState: nodeState });
        }
        if (!sources.length) return;
        src = sources[pick % sources.length];
      }

      const dest = dests[pick % dests.length];
      const amount = Math.min(worker.backpack, src.qty, dest.space);
      if (amount <= 0) return;

      if (!src.infinite) src.nodeState.out[routeDef.item] = src.qty - amount;
      dest.nodeState.in[routeDef.item] = (dest.nodeState.in[routeDef.item] || 0) + amount;
      state.stats.delivered[routeDef.item] = (state.stats.delivered[routeDef.item] || 0) + amount;

      const destPort = (dest.nodeDef.in || []).find((port) => port.item === routeDef.item);
      const reward = amount * ((destPort && destPort.coin) || 0);
      if (reward > 0) {
        state.coins += reward;
        summary.coins += reward;
      }
    });
  }
}

function stepNodes(state, mapState, mapDef, rules, summary) {
  const nodeIds = Object.keys(mapDef.nodes).sort();

  for (const nodeId of nodeIds) {
    const nodeDef = mapDef.nodes[nodeId];
    const nodeState = mapState.nodes[nodeId];
    if (!nodeState || !nodeState.unlocked) continue;
    if (nodeDef.source) continue;

    nodeState.counter += 1;
    const level = nodeDef.levels[nodeState.level - 1];
    if (nodeState.counter % level.beats !== 0) continue;

    const consume = level.consume || {};
    const produce = level.produce || {};

    let canProduce = true;
    for (const [item, qty] of Object.entries(consume)) {
      if ((nodeState.in[item] || 0) < qty) {
        canProduce = false;
        break;
      }
    }
    if (canProduce) {
      for (const [item, qty] of Object.entries(produce)) {
        if (rules.ITEMS[item].ledger) continue;
        if ((nodeState.out[item] || 0) + qty > portCap(level, 'out', item)) {
          canProduce = false;
          break;
        }
      }
    }
    if (!canProduce) continue;

    for (const [item, qty] of Object.entries(consume)) {
      nodeState.in[item] = (nodeState.in[item] || 0) - qty;
      state.stats.consumed[item] = (state.stats.consumed[item] || 0) + qty;
      if (!(nodeDef.out || []).length) {
        state.stats.sold[item] = (state.stats.sold[item] || 0) + qty;
      }
    }
    for (const [item, qty] of Object.entries(produce)) {
      if (rules.ITEMS[item].ledger) {
        state.coins += qty;
        summary.coins += qty;
      } else {
        nodeState.out[item] = (nodeState.out[item] || 0) + qty;
        state.stats.produced[item] = (state.stats.produced[item] || 0) + qty;
      }
    }
  }
}

function advance(state, beats, rules) {
  if (!state.stats) state.stats = { consumed: {}, produced: {}, sold: {}, delivered: {} };
  for (const key of ['consumed', 'produced', 'sold', 'delivered']) {
    if (!state.stats[key]) state.stats[key] = {};
  }
  const summary = { coins: 0 };
  const total = Math.max(0, Math.floor(beats));
  const mapIds = state.unlockedMaps.slice().sort();

  for (let i = 0; i < total; i += 1) {
    for (const mapId of mapIds) {
      const mapState = state.maps[mapId];
      const mapDef = rules.MAPS[mapId];
      if (!mapState || !mapDef) continue;
      stepRoutes(state, mapState, mapDef, summary);
      stepNodes(state, mapState, mapDef, rules, summary);
    }
  }

  return { coinsEarned: summary.coins };
}

function take(state, mapId, nodeId, item, rules) {
  const mapState = state.maps[mapId];
  const mapDef = rules.MAPS[mapId];
  if (!mapState || !mapDef) return { ok: false, reason: 'bad_port' };

  const nodeState = mapState.nodes[nodeId];
  const nodeDef = mapDef.nodes[nodeId];
  if (!nodeState || !nodeDef) return { ok: false, reason: 'bad_port' };
  if (!nodeState.unlocked) return { ok: false, reason: 'locked' };
  if (!(nodeDef.out || []).some((port) => port.item === item)) {
    return { ok: false, reason: 'bad_port' };
  }

  if (state.player.item !== null && state.player.item !== item) {
    return { ok: false, reason: 'wrong_item' };
  }

  const cap = rules.PLAYER.levels[state.player.level - 1].cap;
  const held = state.player.item === item ? state.player.qty : 0;
  const space = cap - held;
  if (space <= 0) return { ok: false, reason: 'backpack_full' };

  if (nodeDef.source) {
    state.player.item = item;
    state.player.qty = held + space;
    return { ok: true, qty: space, item };
  }

  const available = nodeState.out[item] || 0;
  if (available <= 0) return { ok: false, reason: 'empty' };

  const qty = Math.min(space, available);
  nodeState.out[item] = available - qty;
  state.player.item = item;
  state.player.qty = held + qty;
  return { ok: true, qty, item };
}

function deposit(state, mapId, nodeId, item, rules) {
  const mapState = state.maps[mapId];
  const mapDef = rules.MAPS[mapId];
  if (!mapState || !mapDef) return { ok: false, reason: 'bad_port' };

  const nodeState = mapState.nodes[nodeId];
  const nodeDef = mapDef.nodes[nodeId];
  if (!nodeState || !nodeDef) return { ok: false, reason: 'bad_port' };
  if (!nodeState.unlocked) return { ok: false, reason: 'locked' };

  if (state.player.qty <= 0) return { ok: false, reason: 'empty' };
  if (state.player.item !== item) return { ok: false, reason: 'wrong_item' };
  const inPort = (nodeDef.in || []).find((port) => port.item === item);
  if (!inPort) return { ok: false, reason: 'bad_port' };

  const level = nodeDef.levels[nodeState.level - 1];
  const cap = portCap(level, 'in', item);
  const space = cap - (nodeState.in[item] || 0);
  if (space <= 0) return { ok: false, reason: 'full' };

  const qty = Math.min(state.player.qty, space);
  nodeState.in[item] = (nodeState.in[item] || 0) + qty;
  state.player.qty -= qty;
  if (state.player.qty === 0) state.player.item = null;
  state.stats.delivered[item] = (state.stats.delivered[item] || 0) + qty;
  const reward = qty * (inPort.coin || 0);
  if (reward > 0) state.coins += reward;
  return { ok: true, qty, item, reward };
}

function discard(state) {
  const item = state.player.item;
  const qty = state.player.qty;
  state.player.item = null;
  state.player.qty = 0;
  return { ok: true, item, qty };
}

function payCoins(state, amount) {
  if (!Number.isFinite(amount) || amount < 0) return false;
  if (state.coins < amount) return false;
  state.coins -= amount;
  return true;
}

function upgradeCost(rules, def, currentLevel) {
  if (!def || !Array.isArray(def.levels)) return null;
  const next = def.levels[currentLevel];
  return next ? next.cost : null;
}

function clampPorts(nodeState, levelDef) {
  for (const side of ['in', 'out']) {
    const caps = levelDef.caps && levelDef.caps[side];
    if (!caps) continue;
    for (const item of Object.keys(nodeState[side])) {
      const cap = caps[item];
      if (Number.isFinite(cap) && nodeState[side][item] > cap) {
        nodeState[side][item] = cap;
      }
    }
  }
}

function applyNodeUpgrade(state, mapId, nodeId, rules) {
  const mapState = state.maps[mapId];
  const mapDef = rules.MAPS[mapId];
  const nodeState = mapState && mapState.nodes[nodeId];
  const nodeDef = mapDef && mapDef.nodes[nodeId];
  if (!nodeState || !nodeDef) return { ok: false, reason: 'bad_node' };
  if (!nodeDef.levels) return { ok: false, reason: 'max' };
  if (nodeState.level >= nodeDef.levels.length) return { ok: false, reason: 'max' };
  nodeState.level += 1;
  clampPorts(nodeState, nodeDef.levels[nodeState.level - 1]);
  return { ok: true };
}

function workerUpgradeLevel(routeDef, worker, stat) {
  const workerDef = routeDef.worker;
  if (!workerDef) return null;
  const list = stat === 'speed' ? workerDef.speedLevels : workerDef.backpackLevels;
  const index = stat === 'speed' ? worker.speedUpgrades : worker.backpackUpgrades;
  return list && list[index] ? list[index] : null;
}

function workerUpgradeCost(routeDef, worker, stat) {
  const level = workerUpgradeLevel(routeDef, worker, stat);
  return level ? level.cost : null;
}

function applyWorkerUpgrade(state, mapId, routeId, workerId, stat, rules) {
  const mapDef = rules.MAPS[mapId];
  const mapState = state.maps[mapId];
  const routeDef = mapDef && mapDef.routes[routeId];
  const routeState = mapState && mapState.routes[routeId];
  if (!routeDef || !routeState) return { ok: false, reason: 'bad_route' };
  if (stat !== 'speed' && stat !== 'backpack') return { ok: false, reason: 'bad_stat' };

  const worker = (routeState.workers || []).find((item) => item.id === workerId);
  if (!worker) return { ok: false, reason: 'bad_worker' };
  const next = workerUpgradeLevel(routeDef, worker, stat);
  if (!next) return { ok: false, reason: 'max' };

  if (stat === 'speed') {
    worker.speed = next.beats;
    worker.speedUpgrades += 1;
  } else {
    worker.backpack = next.backpack;
    worker.backpackUpgrades += 1;
  }
  return { ok: true, cost: next.cost };
}

function applyBackpackUpgrade(state, rules) {
  const levels = rules.PLAYER.levels;
  if (state.player.level >= levels.length) return { ok: false, reason: 'max' };
  state.player.level += 1;
  const cap = levels[state.player.level - 1].cap;
  if (state.player.qty > cap) state.player.qty = cap;
  if (state.player.qty <= 0) {
    state.player.qty = 0;
    state.player.item = null;
  }
  return { ok: true };
}

function hireCost(routeDef, workers) {
  return Math.floor(routeDef.hire.base * routeDef.hire.growth ** workers);
}

function hireWorker(state, mapId, routeId, rules) {
  const mapState = state.maps[mapId];
  const mapDef = rules.MAPS[mapId];
  const routeState = mapState && mapState.routes[routeId];
  const routeDef = mapDef && mapDef.routes[routeId];
  if (!routeState || !routeDef) return { ok: false, reason: 'bad_route' };
  if (!routeState.unlocked) return { ok: false, reason: 'locked' };

  const cost = hireCost(routeDef, routeState.workers.length);
  if (!payCoins(state, cost)) return { ok: false, reason: 'coins', cost };
  const worker = {
    id: routeId + '-' + (routeState.workers.length + 1),
    speed: routeDef.worker.speed,
    backpack: routeDef.worker.backpack,
    speedUpgrades: 0,
    backpackUpgrades: 0,
    counter: 0,
  };
  routeState.workers.push(worker);
  return { ok: true, cost, worker };
}

function unlockCost(def) {
  return def && def.unlock ? def.unlock : null;
}

function unlockNode(state, mapId, nodeId, rules) {
  const mapState = state.maps[mapId];
  const mapDef = rules.MAPS[mapId];
  const nodeState = mapState && mapState.nodes[nodeId];
  const nodeDef = mapDef && mapDef.nodes[nodeId];
  if (!nodeState || !nodeDef) return { ok: false, reason: 'bad_node' };
  if (nodeState.unlocked) return { ok: false, reason: 'already' };

  const cost = unlockCost(nodeDef);
  if (!cost) return { ok: false, reason: 'already' };
  if (!Number.isFinite(cost.coin)) return { ok: false, reason: 'payment_required', cost };
  if (!payCoins(state, cost.coin)) return { ok: false, reason: 'coins', cost };

  nodeState.unlocked = true;
  for (const [routeId, routeDef] of Object.entries(mapDef.routes)) {
    if (routeDef.requires === nodeId) {
      mapState.routes[routeId].unlocked = true;
    }
  }
  return { ok: true, cost };
}

function beatsForOffline(elapsedMs, rules) {
  const capped = Math.min(Math.max(0, elapsedMs), rules.OFFLINE_CAP_MS);
  return Math.floor(capped / rules.BEAT_MS * rules.OFFLINE_EFFICIENCY);
}

function claimReward(state, rewardId, rules) {
  const reward = rules.REWARDS && rules.REWARDS[rewardId];
  if (!reward) return { ok: false, reason: 'unknown' };

  const grant = reward.grant || {};
  for (const [item, qty] of Object.entries(grant)) {
    if (item === 'coins') state.coins += qty;
    else return { ok: false, reason: 'unsupported' };
  }
  return { ok: true, reward };
}

function questConditionCurrent(state, cond, rules) {
  const mapId = state.activeMap;
  const mapDef = rules.MAPS[mapId];
  const mapState = state.maps[mapId];
  const stats = state.stats || { consumed: {}, produced: {}, sold: {}, delivered: {} };
  const kindNodes = Object.keys(mapDef.nodes).filter(
    (id) => mapDef.nodes[id].kind === cond.kind && mapState.nodes[id] && mapState.nodes[id].unlocked
  );

  switch (cond.type) {
    case 'machineCount':
      return kindNodes.length;
    case 'machineLevel':
      return kindNodes.filter((id) => mapState.nodes[id].level >= cond.level).length;
    case 'build':
      return mapState.nodes[cond.node] && mapState.nodes[cond.node].unlocked ? 1 : 0;
    case 'hire':
      if (cond.route) {
        const routeState = mapState.routes[cond.route];
        return routeState ? (routeState.workers || []).length : 0;
      }
      return Object.values(mapState.routes).reduce((sum, rs) => sum + (rs.workers || []).length, 0);
    case 'hireLevel': {
      const routeState = mapState.routes[cond.route];
      if (!routeState) return 0;
      return (routeState.workers || []).filter((worker) => {
        const level = cond.stat === 'speed'
          ? worker.speedUpgrades
          : cond.stat === 'backpack'
            ? worker.backpackUpgrades
            : worker.speedUpgrades + worker.backpackUpgrades;
        return level >= cond.level;
      }).length;
    }
    case 'consume':
      return stats.consumed[cond.item] || 0;
    case 'produce':
      return stats.produced[cond.item] || 0;
    case 'sell':
      return stats.sold[cond.item] || 0;
    case 'delivered':
      return stats.delivered[cond.item] || 0;
    case 'bag':
      return state.player.item === cond.item ? state.player.qty : 0;
    case 'coins':
      return state.coins;
    default:
      return 0;
  }
}

function questStatus(state, quest, rules) {
  const conditions = (quest.conditions || []).map((cond) => {
    const current = questConditionCurrent(state, cond, rules);
    return {
      type: cond.type,
      item: cond.item,
      kind: cond.kind,
      route: cond.route,
      node: cond.node,
      level: cond.level,
      stat: cond.stat,
      current: current,
      target: cond.count,
      done: current >= cond.count,
    };
  });
  return { done: conditions.every((cond) => cond.done), conditions: conditions };
}

function claimQuest(state, questId, rules) {
  const quest = (rules.QUESTS || []).find((item) => item.id === questId);
  if (!quest) return { ok: false, reason: 'unknown' };
  if (state.quests.claimed.includes(questId)) return { ok: false, reason: 'claimed' };
  if (!state.quests.active.includes(questId)) return { ok: false, reason: 'inactive' };
  if (!questStatus(state, quest, rules).done) return { ok: false, reason: 'incomplete' };

  state.quests.claimed.push(questId);
  state.quests.active = state.quests.active.filter((id) => id !== questId);
  for (const next of rules.QUESTS || []) {
    if (state.quests.claimed.includes(next.id) || state.quests.active.includes(next.id)) continue;
    if ((next.requires || []).every((id) => state.quests.claimed.includes(id))) state.quests.active.push(next.id);
  }

  const reward = quest.reward || {};
  if (reward.coins) state.coins += reward.coins;
  return { ok: true, reward: reward };
}

if (typeof module !== 'undefined') {
  module.exports = {
    validateContent,
    parsePortRef,
    portCap,
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
}
