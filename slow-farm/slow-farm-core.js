'use strict';

// 慢慢农场领域层：只认物品、作物、机器、配方这些概念。
// 不碰 DOM、存储、系统时钟与随机数；规则对象与时间均由调用方传入。

function isPositiveNumber(value) {
  return Number.isFinite(value) && value > 0;
}

function isNonNegativeNumber(value) {
  return Number.isFinite(value) && value >= 0;
}

function sumValue(bag, items) {
  let total = 0;
  for (const [itemId, quantity] of Object.entries(bag)) {
    total += items[itemId].sellPrice * quantity;
  }
  return total;
}

function profitPerHour(recipe, items) {
  const profit = sumValue(recipe.output, items) - sumValue(recipe.input, items);
  return profit / (recipe.ms / 3600000);
}

function validateItems(items) {
  for (const [id, item] of Object.entries(items)) {
    if (!item || typeof item.name !== 'string' || !item.name) {
      throw new Error(`物品定义错误：${id}`);
    }
    if (!isPositiveNumber(item.sellPrice)) {
      throw new Error(`物品售价错误：${id}`);
    }
    if (!Number.isInteger(item.unlockLevel) || item.unlockLevel < 1) {
      throw new Error(`物品解锁等级错误：${id}`);
    }
    if (item.category !== 'crop' && item.category !== 'product') {
      throw new Error(`物品分类错误：${id}`);
    }
  }
}

function validateCrops(crops, items) {
  for (const [id, crop] of Object.entries(crops)) {
    const item = items[id];
    if (!item || item.category !== 'crop') {
      throw new Error(`作物缺少对应的作物物品：${id}`);
    }
    if (!isNonNegativeNumber(crop.seedPrice)) {
      throw new Error(`作物种子价错误：${id}`);
    }
    if (!isPositiveNumber(crop.growMs)) {
      throw new Error(`作物生长时间错误：${id}`);
    }
    if (!Number.isInteger(crop.yield) || crop.yield < 1) {
      throw new Error(`作物产量错误：${id}`);
    }
  }
}

function validateMachines(machines) {
  for (const [id, machine] of Object.entries(machines)) {
    if (!machine || typeof machine.name !== 'string' || !machine.name) {
      throw new Error(`机器定义错误：${id}`);
    }
    if (!isNonNegativeNumber(machine.buildCost)) {
      throw new Error(`机器建造成本错误：${id}`);
    }
    if (!Number.isInteger(machine.unlockLevel) || machine.unlockLevel < 1) {
      throw new Error(`机器解锁等级错误：${id}`);
    }
  }
}

function validateRecipes(recipes, items, machines) {
  for (const [id, recipe] of Object.entries(recipes)) {
    if (!machines[recipe.machine]) {
      throw new Error(`配方 ${id} 的机器未知：${recipe.machine}`);
    }
    if (!isPositiveNumber(recipe.ms)) {
      throw new Error(`配方 ${id} 耗时错误`);
    }
    for (const itemId of Object.keys(recipe.input)) {
      if (!items[itemId]) throw new Error(`配方 ${id} 原料未知：${itemId}`);
    }
    for (const itemId of Object.keys(recipe.output)) {
      if (!items[itemId]) throw new Error(`配方 ${id} 产出未知：${itemId}`);
    }
  }
}

function validateProfit(recipes, items, machines) {
  const byMachine = new Map();
  for (const [id, recipe] of Object.entries(recipes)) {
    if (machines[recipe.machine] && machines[recipe.machine].noLadder) continue;
    if (!byMachine.has(recipe.machine)) byMachine.set(recipe.machine, []);
    byMachine.get(recipe.machine).push({
      id,
      unlockLevel: recipe.unlockLevel,
      rate: profitPerHour(recipe, items),
    });
  }

  const machineRates = [];

  for (const [machineId, list] of byMachine) {
    list.sort((a, b) => a.unlockLevel - b.unlockLevel);
    for (let i = 1; i < list.length; i += 1) {
      if (list[i].rate < list[i - 1].rate) {
        throw new Error(`机器 ${machineId} 的配方利润未随解锁等级递增：${list[i].id}`);
      }
    }
    machineRates.push({
      machineId,
      unlockLevel: machines[machineId].unlockLevel,
      min: list[0].rate,
      max: list[list.length - 1].rate,
    });
  }

  machineRates.sort((a, b) => a.unlockLevel - b.unlockLevel);
  for (let i = 1; i < machineRates.length; i += 1) {
    if (machineRates[i].min < machineRates[i - 1].max) {
      throw new Error(
        `机器 ${machineRates[i].machineId} 的利润未超过前一台机器 ${machineRates[i - 1].machineId}：`
        + `${machineRates[i].min} < ${machineRates[i - 1].max}`,
      );
    }
  }
}

function validateOrderSlots(orders) {
  if (!Number.isInteger(orders.initialSlots) || orders.initialSlots < 1) {
    throw new Error('订单位初始数量错误');
  }
  if (!Number.isInteger(orders.maxSlots) || orders.maxSlots < orders.initialSlots) {
    throw new Error('订单位上限错误');
  }
  if (!Array.isArray(orders.slotPrices) || orders.slotPrices.length !== orders.maxSlots - orders.initialSlots) {
    throw new Error('订单位价格数量与可开位数不符');
  }
  for (const [index, cost] of orders.slotPrices.entries()) {
    if (!isNonNegativeNumber(cost)) {
      throw new Error(`第 ${index + 1} 个订单位的价格错误`);
    }
  }
}

function validateOrders(orders) {
  const tiers = orders.tiers;
  if (!Array.isArray(tiers) || tiers.length === 0) {
    throw new Error('订单分档为空');
  }
  for (let i = 0; i < tiers.length; i += 1) {
    const tier = tiers[i];
    if (!Number.isInteger(tier.min) || !Number.isInteger(tier.max) || tier.min < 1 || tier.max < tier.min) {
      throw new Error(`订单分档数量错误：第 ${i + 1} 档`);
    }
    if (i > 0 && !(tier.maxPrice > tiers[i - 1].maxPrice)) {
      throw new Error('订单分档未按售价升序');
    }
  }
  if (tiers[tiers.length - 1].maxPrice !== Infinity) {
    throw new Error('订单分档最高档必须覆盖 Infinity');
  }
}

function validateLevels(levels) {
  if (!Array.isArray(levels) || levels.length === 0) {
    throw new Error('等级表为空');
  }
  for (let i = 1; i < levels.length; i += 1) {
    if (levels[i] <= levels[i - 1]) throw new Error('等级经验门槛未严格递增');
  }
}

function validateGems(gems) {
  if (!Array.isArray(gems.hourglassPacks) || gems.hourglassPacks.length === 0) {
    throw new Error('沙漏礼包为空');
  }
  let lastQty = 0;
  for (const pack of gems.hourglassPacks) {
    if (!Number.isInteger(pack.qty) || pack.qty <= lastQty) {
      throw new Error('沙漏礼包数量必须严格递增');
    }
    if (!isNonNegativeNumber(pack.cost)) {
      throw new Error('沙漏礼包价格错误');
    }
    lastQty = pack.qty;
  }
}

function validateSilo(silo) {
  if (!Number.isInteger(silo.perSlot) || silo.perSlot < 1) {
    throw new Error('每格容量错误');
  }
  if (!Number.isInteger(silo.initial) || silo.initial < 1) {
    throw new Error('初始格子数错误');
  }
  if (!Number.isInteger(silo.max) || silo.max < silo.initial) {
    throw new Error('最大格子数错误');
  }
  if (!Array.isArray(silo.prices) || silo.prices.length !== silo.max - silo.initial) {
    throw new Error('开格价格数量与可开格子数不符');
  }
  for (const [index, cost] of silo.prices.entries()) {
    if (!isNonNegativeNumber(cost)) {
      throw new Error(`第 ${index + 1} 个格的开启价格错误`);
    }
  }
}

function validatePlots(plots) {
  if (!Array.isArray(plots.prices)) {
    throw new Error('地块扩建价格表错误');
  }
  if (plots.prices.length !== plots.max - plots.initial) {
    throw new Error('地块扩建价格数量与可扩地块数不符');
  }
  for (const [index, entry] of plots.prices.entries()) {
    if (!entry || !Number.isInteger(entry.level) || entry.level < 1) {
      throw new Error(`第 ${index + 1} 块扩建地块的解锁等级错误`);
    }
    if (!isNonNegativeNumber(entry.cost)) {
      throw new Error(`第 ${index + 1} 块扩建地块的价格错误`);
    }
  }
}

function validateContent(rules) {
  const { ITEMS, CROPS, MACHINES, RECIPES, LEVELS, PLOTS, SILO, ORDERS } = rules;

  validateItems(ITEMS);
  validateCrops(CROPS, ITEMS);
  validateMachines(MACHINES);
  validateRecipes(RECIPES, ITEMS, MACHINES);
  validateProfit(RECIPES, ITEMS, MACHINES);
  validateOrders(ORDERS);
  validateOrderSlots(ORDERS);
  validateLevels(LEVELS);
  validateSilo(SILO);
  validateGems(rules.GEMS);
  validateAnimals(rules.ANIMALS, ITEMS);
  validatePlots(PLOTS);

  return true;
}

function buildPlots(count) {
  const plots = [];
  for (let i = 0; i < count; i += 1) {
    plots.push({ id: i + 1, cropId: null, plantedAt: 0, readyAt: 0 });
  }
  return plots;
}

function buildAnimals(animals, rules) {
  const result = {};
  for (const [kind, def] of Object.entries(animals)) {
    result[kind] = { slots: def.initialSlots, list: [] };
  }
  return result;
}

function buildMachines(machines, rules) {
  const result = {};
  for (const [id, def] of Object.entries(machines)) {
    result[id] = {
      unlocked: def.unlockLevel === 1,
      queueSize: rules.QUEUE.initial,
      queue: [],
    };
  }
  return result;
}

function createState(rules, rng) {
  const state = {
    coins: rules.START.coins,
    gems: rules.START.gems,
    xp: 0,
    plots: buildPlots(rules.PLOTS.initial),
    silo: {},
    siloSlots: rules.SILO.initial,
    machines: buildMachines(rules.MACHINES, rules),
    unlockedRecipes: {},
    animals: buildAnimals(rules.ANIMALS, rules),
    hourglasses: 0,
    orders: [],
    orderSlots: rules.ORDERS.initialSlots,
    orderSeq: 0,
    ordersGenerated: 0,
  };
  for (let i = 0; i < state.orderSlots; i += 1) {
    state.orders.push(generateOrder(state, rules, rng));
  }
  return state;
}

function levelOf(xp, rules) {
  const levels = rules.LEVELS;
  let level = 1;
  for (let i = 0; i < levels.length; i += 1) {
    if (xp >= levels[i]) level = i + 1;
  }
  return level;
}

function siloCap(state) {
  return state.siloSlots;
}

function slotsFor(quantity, rules) {
  if (!(quantity > 0)) return 0;
  return Math.ceil(quantity / rules.SILO.perSlot);
}

function siloSlotsUsed(state, rules) {
  let total = 0;
  for (const quantity of Object.values(state.silo)) total += slotsFor(quantity, rules);
  return total;
}

function projectedSlots(state, additions, rules) {
  let total = 0;
  const seen = {};

  for (const [itemId, quantity] of Object.entries(state.silo)) {
    total += slotsFor(quantity + (additions[itemId] || 0), rules);
    seen[itemId] = true;
  }
  for (const [itemId, quantity] of Object.entries(additions)) {
    if (!seen[itemId]) total += slotsFor(quantity, rules);
  }

  return total;
}

function canStore(state, additions, rules) {
  return projectedSlots(state, additions, rules) <= state.siloSlots;
}

function siloSlotsFree(state, rules) {
  return Math.max(0, state.siloSlots - siloSlotsUsed(state, rules));
}

function remainingMs(readyAt, nowMs) {
  return Math.max(0, readyAt - nowMs);
}

function formatDuration(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (value) => String(value).padStart(2, '0');
  if (hours > 0) return `${hours}:${pad(minutes)}:${pad(seconds)}`;
  return `${minutes}:${pad(seconds)}`;
}

function toCount(value) {
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

function normalizeOrder(order, rules) {
  if (!order || typeof order !== 'object') return null;
  if (typeof order.id !== 'string' || !order.id) return null;
  if (!Array.isArray(order.lines) || order.lines.length === 0) return null;
  if (!Number.isFinite(order.coins) || order.coins < 0) return null;
  if (!Number.isFinite(order.xp) || order.xp < 0) return null;

  const lines = [];
  for (const line of order.lines) {
    if (!line || !rules.ITEMS[line.itemId]) return null;
    if (!Number.isInteger(line.quantity) || line.quantity <= 0) return null;
    lines.push({ itemId: line.itemId, quantity: line.quantity });
  }

  return { id: order.id, lines, coins: order.coins, xp: order.xp };
}

function hydrate(state, rules, rng) {
  const target = state && typeof state === 'object' ? state : {};
  const random = typeof rng === 'function' ? rng : Math.random;

  target.coins = Number.isFinite(target.coins) && target.coins >= 0 ? target.coins : rules.START.coins;
  target.gems = Number.isFinite(target.gems) && target.gems >= 0 ? target.gems : rules.START.gems;
  target.xp = Number.isFinite(target.xp) && target.xp >= 0 ? target.xp : 0;
  target.hourglasses = toCount(target.hourglasses);
  target.orderSeq = toCount(target.orderSeq);
  target.ordersGenerated = toCount(target.ordersGenerated);

  const savedOrders = Array.isArray(target.orders) ? target.orders : [];
  const orders = [];
  for (const saved of savedOrders) {
    const order = normalizeOrder(saved, rules);
    if (order) orders.push(order);
  }
  target.orders = orders;

  // 订单号必须大于历史最大号，否则新单会和残留订单撞号
  let maxSeq = 0;
  for (const order of orders) {
    const matched = /^o(\d+)$/.exec(order.id);
    if (matched) maxSeq = Math.max(maxSeq, Number(matched[1]));
  }
  target.orderSeq = Math.max(target.orderSeq, maxSeq);

  target.orderSlots = Number.isInteger(target.orderSlots)
    ? Math.min(Math.max(target.orderSlots, rules.ORDERS.initialSlots), rules.ORDERS.maxSlots)
    : rules.ORDERS.initialSlots;

  while (target.orders.length < target.orderSlots) {
    target.orders.push(generateOrder(target, rules, random));
  }
  if (target.orders.length > target.orderSlots) {
    target.orders.length = target.orderSlots;
  }

  const silo = {};
  for (const [itemId, quantity] of Object.entries(target.silo || {})) {
    if (rules.ITEMS[itemId] && Number.isInteger(quantity) && quantity > 0) {
      silo[itemId] = quantity;
    }
  }
  target.silo = silo;

  target.siloSlots = Number.isInteger(target.siloSlots)
    ? Math.min(Math.max(target.siloSlots, rules.SILO.initial), rules.SILO.max)
    : rules.SILO.initial;

  const savedPlots = Array.isArray(target.plots) ? target.plots : [];
  const plots = savedPlots.slice(0, rules.PLOTS.max).map((plot, index) => {
    const source = plot && typeof plot === 'object' ? plot : {};
    const cropId = rules.CROPS[source.cropId] ? source.cropId : null;
    return {
      id: Number.isInteger(source.id) ? source.id : index + 1,
      cropId,
      plantedAt: cropId ? toCount(source.plantedAt) : 0,
      readyAt: cropId ? toCount(source.readyAt) : 0,
    };
  });
  while (plots.length < rules.PLOTS.initial) {
    plots.push({ id: plots.length + 1, cropId: null, plantedAt: 0, readyAt: 0 });
  }
  target.plots = plots;

  const savedMachines = target.machines && typeof target.machines === 'object' ? target.machines : {};
  const machines = {};
  for (const [id, def] of Object.entries(rules.MACHINES)) {
    const saved = savedMachines[id] || {};
    const unlocked = typeof saved.unlocked === 'boolean' ? saved.unlocked : def.unlockLevel === 1;
    const queueSize = Number.isInteger(saved.queueSize)
      ? Math.min(Math.max(saved.queueSize, rules.QUEUE.initial), rules.QUEUE.max)
      : rules.QUEUE.initial;

    const queue = [];
    if (Array.isArray(saved.queue)) {
      for (const job of saved.queue.slice(0, queueSize)) {
        const recipe = job && rules.RECIPES[job.recipeId];
        if (!recipe || recipe.machine !== id) continue;
        queue.push({
          recipeId: job.recipeId,
          startedAt: toCount(job.startedAt),
          readyAt: toCount(job.readyAt),
        });
      }
    }

    machines[id] = { unlocked, queueSize, queue };
  }
  target.machines = machines;

  const savedAnimals = target.animals && typeof target.animals === 'object' ? target.animals : {};
  const animals = {};
  for (const [kind, def] of Object.entries(rules.ANIMALS)) {
    const saved = savedAnimals[kind] || {};
    const slots = Number.isInteger(saved.slots)
      ? Math.min(Math.max(saved.slots, def.initialSlots), def.maxSlots)
      : def.initialSlots;
    const list = [];
    if (Array.isArray(saved.list)) {
      for (const animal of saved.list.slice(0, slots)) {
        list.push({ readyAt: toCount(animal && animal.readyAt) });
      }
    }
    animals[kind] = { slots, list };
  }
  target.animals = animals;

  const unlockedRecipes = {};
  for (const recipeId of Object.keys(target.unlockedRecipes || {})) {
    if (rules.RECIPES[recipeId] && target.unlockedRecipes[recipeId]) {
      unlockedRecipes[recipeId] = true;
    }
  }
  target.unlockedRecipes = unlockedRecipes;

  return target;
}

function plant(state, plotIndex, cropId, nowMs, rules) {
  const plot = state.plots[plotIndex];
  if (!plot) return { ok: false, reason: 'bad_plot' };
  if (plot.cropId) return { ok: false, reason: 'plot_occupied' };

  const crop = rules.CROPS[cropId];
  const item = rules.ITEMS[cropId];
  if (!crop || !item) return { ok: false, reason: 'unknown_crop' };
  if (item.unlockLevel > levelOf(state.xp, rules)) return { ok: false, reason: 'locked' };
  if (state.coins < crop.seedPrice) return { ok: false, reason: 'no_coins' };

  state.coins -= crop.seedPrice;
  plot.cropId = cropId;
  plot.plantedAt = nowMs;
  plot.readyAt = nowMs + crop.growMs;
  return { ok: true };
}

function harvest(state, plotIndex, nowMs, rules) {
  const plot = state.plots[plotIndex];
  if (!plot) return { ok: false, reason: 'bad_plot' };
  if (!plot.cropId) return { ok: false, reason: 'empty_plot' };
  if (nowMs < plot.readyAt) return { ok: false, reason: 'not_ready' };

  const itemId = plot.cropId;
  const qty = rules.CROPS[itemId].yield;
  const addition = {};
  addition[itemId] = qty;
  if (!canStore(state, addition, rules)) return { ok: false, reason: 'silo_full' };

  state.silo[itemId] = (state.silo[itemId] || 0) + qty;
  state.xp += 1;
  plot.cropId = null;
  plot.plantedAt = 0;
  plot.readyAt = 0;
  return { ok: true, itemId, qty };
}

function unlockRecipe(state, recipeId, rules) {
  const recipe = rules.RECIPES[recipeId];
  if (!recipe) return { ok: false, reason: 'unknown_recipe' };
  if (state.unlockedRecipes[recipeId]) return { ok: false, reason: 'already' };
  if (recipe.unlockLevel > levelOf(state.xp, rules)) return { ok: false, reason: 'locked' };

  state.unlockedRecipes[recipeId] = true;
  return { ok: true };
}

function queueSlotCost(state, machineId, rules) {
  const machine = state.machines[machineId];
  if (!machine) return null;
  const index = machine.queueSize - rules.QUEUE.initial;
  if (index < 0 || index >= rules.QUEUE.prices.length) return null;
  return rules.QUEUE.prices[index];
}

function buyQueueSlot(state, machineId, rules) {
  const machine = state.machines[machineId];
  if (!machine) return { ok: false, reason: 'unknown_machine' };

  const cost = queueSlotCost(state, machineId, rules);
  if (cost === null) return { ok: false, reason: 'max_queue' };
  if (state.coins < cost) return { ok: false, reason: 'no_coins' };

  state.coins -= cost;
  machine.queueSize += 1;
  return { ok: true };
}

function tailReadyAt(queue) {
  let last = 0;
  for (const job of queue) {
    if (job.readyAt > last) last = job.readyAt;
  }
  return last;
}

function enqueue(state, machineId, recipeId, nowMs, rules) {
  const machine = state.machines[machineId];
  if (!machine) return { ok: false, reason: 'unknown_machine' };
  if (!machine.unlocked) return { ok: false, reason: 'machine_locked' };

  const recipe = rules.RECIPES[recipeId];
  if (!recipe) return { ok: false, reason: 'unknown_recipe' };
  if (recipe.machine !== machineId) return { ok: false, reason: 'wrong_machine' };
  if (!state.unlockedRecipes[recipeId]) return { ok: false, reason: 'recipe_locked' };
  if (machine.queue.length >= machine.queueSize) return { ok: false, reason: 'queue_full' };

  for (const [itemId, quantity] of Object.entries(recipe.input)) {
    if (!((state.silo[itemId] || 0) >= quantity)) return { ok: false, reason: 'missing_input' };
  }

  for (const [itemId, quantity] of Object.entries(recipe.input)) {
    state.silo[itemId] -= quantity;
  }

  const startedAt = Math.max(nowMs, tailReadyAt(machine.queue));
  machine.queue.push({ recipeId, startedAt, readyAt: startedAt + recipe.ms });
  return { ok: true, readyAt: startedAt + recipe.ms };
}

function collectReady(state, machineId, nowMs, rules) {
  const machine = state.machines[machineId];
  if (!machine) return { ok: false, reason: 'unknown_machine' };

  const hasReady = machine.queue.some(function (job) { return job.readyAt <= nowMs; });
  if (!hasReady) return { ok: false, reason: 'not_ready' };

  const items = {};
  const remaining = [];
  let collected = 0;
  let skipped = 0;

  for (const job of machine.queue) {
    if (job.readyAt > nowMs) {
      remaining.push(job);
      continue;
    }
    const recipe = rules.RECIPES[job.recipeId];
    if (!canStore(state, recipe.output, rules)) {
      remaining.push(job);
      skipped += 1;
      continue;
    }
    for (const [itemId, quantity] of Object.entries(recipe.output)) {
      state.silo[itemId] = (state.silo[itemId] || 0) + quantity;
      items[itemId] = (items[itemId] || 0) + quantity;
    }
    collected += 1;
  }

  machine.queue = remaining;
  return { ok: true, items, collected, skipped };
}

function pickInt(rng, min, max) {
  return min + Math.floor(rng() * (max - min + 1));
}

function orderPool(state, rules, newbieOnly) {
  const level = levelOf(state.xp, rules);
  const pool = [];
  for (const [id, item] of Object.entries(rules.ITEMS)) {
    if (item.unlockLevel > level) continue;
    if (newbieOnly && item.category !== 'crop') continue;
    pool.push(id);
  }
  return pool;
}

function quantityFor(price, rules, rng) {
  const tiers = rules.ORDERS.tiers;
  const tier = tiers.find((entry) => price <= entry.maxPrice) || tiers[tiers.length - 1];
  return pickInt(rng, tier.min, tier.max);
}

function generateOrder(state, rules, rng) {
  const newbieOnly = state.ordersGenerated < rules.ORDERS.newbieCount;
  const pool = orderPool(state, rules, newbieOnly);
  const lineCount = Math.min(pool.length, 1 + Math.floor(rng() * 2));
  const lines = [];
  const used = new Set();

  for (let i = 0; i < lineCount; i += 1) {
    const candidates = pool.filter((id) => !used.has(id));
    if (candidates.length === 0) break;
    const itemId = candidates[Math.floor(rng() * candidates.length)];
    used.add(itemId);
    lines.push({ itemId, quantity: quantityFor(rules.ITEMS[itemId].sellPrice, rules, rng) });
  }

  let value = 0;
  for (const line of lines) {
    value += rules.ITEMS[line.itemId].sellPrice * line.quantity;
  }

  state.orderSeq += 1;
  state.ordersGenerated += 1;
  return {
    id: `o${state.orderSeq}`,
    lines,
    coins: Math.floor(value * rules.ORDERS.rewardCoinMul),
    xp: Math.ceil(value / rules.ORDERS.rewardXpDivisor),
  };
}

function buyOrderSlot(state, rules, rng) {
  if (state.orderSlots >= rules.ORDERS.maxSlots) return { ok: false, reason: 'max_order_slots' };
  const index = state.orderSlots - rules.ORDERS.initialSlots;
  const cost = rules.ORDERS.slotPrices[index];
  if (state.coins < cost) return { ok: false, reason: 'no_coins' };

  state.coins -= cost;
  state.orderSlots += 1;
  state.orders.push(generateOrder(state, rules, rng));
  return { ok: true };
}

function orderSlotCost(state, rules) {
  if (state.orderSlots >= rules.ORDERS.maxSlots) return null;
  const index = state.orderSlots - rules.ORDERS.initialSlots;
  return rules.ORDERS.slotPrices[index];
}

function abandonOrder(state, orderId, rules, rng) {
  const index = state.orders.findIndex((order) => order.id === orderId);
  if (index < 0) return { ok: false, reason: 'unknown_order' };

  state.orders.splice(index, 1);
  state.orders.push(generateOrder(state, rules, rng));
  return { ok: true };
}

function deliverOrder(state, orderId, rules, rng) {
  const index = state.orders.findIndex((order) => order.id === orderId);
  if (index < 0) return { ok: false, reason: 'unknown_order' };
  const order = state.orders[index];

  const need = {};
  for (const line of order.lines) {
    need[line.itemId] = (need[line.itemId] || 0) + line.quantity;
  }
  for (const [itemId, quantity] of Object.entries(need)) {
    if (!((state.silo[itemId] || 0) >= quantity)) return { ok: false, reason: 'missing_items' };
  }

  for (const [itemId, quantity] of Object.entries(need)) {
    state.silo[itemId] -= quantity;
  }

  state.orders.splice(index, 1);
  state.orders.push(generateOrder(state, rules, rng));
  state.coins += order.coins;
  state.xp += order.xp;
  return { ok: true, coins: order.coins, xp: order.xp };
}

function buyPlot(state, rules) {
  if (state.plots.length >= rules.PLOTS.max) return { ok: false, reason: 'max_plots' };

  const next = rules.PLOTS.prices[state.plots.length - rules.PLOTS.initial];
  if (levelOf(state.xp, rules) < next.level) return { ok: false, reason: 'locked' };
  if (state.coins < next.cost) return { ok: false, reason: 'no_coins' };

  let maxId = 0;
  for (const plot of state.plots) {
    if (plot.id > maxId) maxId = plot.id;
  }
  state.coins -= next.cost;
  state.plots.push({ id: maxId + 1, cropId: null, plantedAt: 0, readyAt: 0 });
  return { ok: true };
}

function buyMachine(state, machineId, rules) {
  const def = rules.MACHINES[machineId];
  if (!def) return { ok: false, reason: 'unknown_machine' };

  const machine = state.machines[machineId];
  if (!machine) return { ok: false, reason: 'unknown_machine' };
  if (machine.unlocked) return { ok: false, reason: 'already' };
  if (def.unlockLevel > levelOf(state.xp, rules)) return { ok: false, reason: 'locked' };
  if (state.coins < def.buildCost) return { ok: false, reason: 'no_coins' };

  state.coins -= def.buildCost;
  machine.unlocked = true;
  return { ok: true };
}

function buySiloSlot(state, rules) {
  if (state.siloSlots >= rules.SILO.max) return { ok: false, reason: 'max_slots' };
  const cost = rules.SILO.prices[state.siloSlots - rules.SILO.initial];
  if (state.coins < cost) return { ok: false, reason: 'no_coins' };

  state.coins -= cost;
  state.siloSlots += 1;
  return { ok: true };
}

function sellItem(state, itemId, quantity, rules) {
  const item = rules.ITEMS[itemId];
  if (!item) return { ok: false, reason: 'unknown_item' };
  if (!Number.isInteger(quantity) || quantity <= 0) return { ok: false, reason: 'bad_quantity' };
  if (!((state.silo[itemId] || 0) >= quantity)) return { ok: false, reason: 'not_enough' };

  // 用整数百分比再除，避免 45 * 2 * 0.7 = 62.999… 被 floor 成 62
  const ratioPercent = Math.round(rules.SELL_RATIO * 100);
  const coins = Math.floor((item.sellPrice * quantity * ratioPercent) / 100);
  state.silo[itemId] -= quantity;
  state.coins += coins;
  return { ok: true, coins };
}

function buyAnimal(state, kind, rules) {
  const def = rules.ANIMALS[kind];
  if (!def) return { ok: false, reason: 'unknown_animal' };
  if (levelOf(state.xp, rules) < def.unlockLevel) return { ok: false, reason: 'locked' };

  const group = state.animals[kind];
  if (!group) return { ok: false, reason: 'unknown_animal' };
  if (group.list.length >= group.slots) return { ok: false, reason: 'stable_full' };
  if (state.coins < def.price) return { ok: false, reason: 'no_coins' };

  state.coins -= def.price;
  group.list.push({ readyAt: 0 });
  return { ok: true };
}

function feedAnimal(state, kind, index, nowMs, rules) {
  const def = rules.ANIMALS[kind];
  const group = state.animals[kind];
  const animal = group && group.list[index];
  if (!def || !animal) return { ok: false, reason: 'unknown_animal' };
  if (animal.readyAt > 0) return { ok: false, reason: 'animal_busy' };
  if (!((state.silo.feed || 0) > 0)) return { ok: false, reason: 'missing_input' };

  state.silo.feed -= 1;
  animal.readyAt = nowMs + def.cycleMs;
  return { ok: true };
}

function collectAnimal(state, kind, index, nowMs, rules) {
  const def = rules.ANIMALS[kind];
  const group = state.animals[kind];
  const animal = group && group.list[index];
  if (!def || !animal) return { ok: false, reason: 'unknown_animal' };
  if (animal.readyAt === 0 || animal.readyAt > nowMs) return { ok: false, reason: 'not_ready' };

  const addition = {};
  addition[def.product] = 1;
  if (!canStore(state, addition, rules)) return { ok: false, reason: 'silo_full' };

  state.silo[def.product] = (state.silo[def.product] || 0) + 1;
  animal.readyAt = 0;
  return { ok: true, itemId: def.product };
}

function feedAll(state, kind, nowMs, rules) {
  const group = state.animals[kind];
  if (!group) return { ok: false, reason: 'unknown_animal' };

  let fed = 0;
  for (let i = 0; i < group.list.length; i += 1) {
    if (feedAnimal(state, kind, i, nowMs, rules).ok) fed += 1;
  }
  return { ok: true, fed };
}

function collectAll(state, kind, nowMs, rules) {
  const group = state.animals[kind];
  if (!group) return { ok: false, reason: 'unknown_animal' };
  const def = rules.ANIMALS[kind];

  const items = {};
  let skipped = 0;
  for (let i = 0; i < group.list.length; i += 1) {
    const result = collectAnimal(state, kind, i, nowMs, rules);
    if (result.ok) {
      items[def.product] = (items[def.product] || 0) + 1;
    } else if (result.reason === 'silo_full') {
      skipped += 1;
    }
  }
  return { ok: true, items, skipped };
}

function buyStableSlot(state, kind, rules) {
  const def = rules.ANIMALS[kind];
  const group = state.animals[kind];
  if (!def || !group) return { ok: false, reason: 'unknown_animal' };

  const index = group.slots - def.initialSlots;
  if (index < 0 || index >= def.slotPrices.length) return { ok: false, reason: 'max_slots' };
  const cost = def.slotPrices[index];
  if (state.coins < cost) return { ok: false, reason: 'no_coins' };

  state.coins -= cost;
  group.slots += 1;
  return { ok: true };
}

function validateAnimals(animals, items) {
  for (const [kind, def] of Object.entries(animals)) {
    if (!def || typeof def.name !== 'string' || !def.name) throw new Error(`动物定义错误：${kind}`);
    if (!items[def.product]) throw new Error(`动物 ${kind} 的产出物品未知：${def.product}`);
    if (!isPositiveNumber(def.cycleMs)) throw new Error(`动物 ${kind} 的产出周期错误`);
    if (!isNonNegativeNumber(def.price)) throw new Error(`动物 ${kind} 的价格错误`);
    if (!Number.isInteger(def.initialSlots) || def.initialSlots < 1) throw new Error(`动物 ${kind} 的初始位置错误`);
    if (!Number.isInteger(def.maxSlots) || def.maxSlots < def.initialSlots) throw new Error(`动物 ${kind} 的位置上限错误`);
    if (!Array.isArray(def.slotPrices) || def.slotPrices.length !== def.maxSlots - def.initialSlots) {
      throw new Error(`动物 ${kind} 的扩位价格数量不符`);
    }
  }
}

function buyHourglass(state, quantity, rules) {
  const pack = rules.GEMS.hourglassPacks.find(function (item) { return item.qty === quantity; });
  if (!pack) return { ok: false, reason: 'bad_quantity' };
  const cost = pack.cost;
  if (state.gems < cost) return { ok: false, reason: 'no_gems' };

  state.gems -= cost;
  state.hourglasses += quantity;
  return { ok: true };
}

function useHourglass(state, target, nowMs, rules) {
  if (!target || (target.kind !== 'plot' && target.kind !== 'machine')) {
    return { ok: false, reason: 'bad_target' };
  }

  let readyAt;
  if (target.kind === 'plot') {
    const plot = state.plots[target.index];
    if (!plot || !plot.cropId) return { ok: false, reason: 'nothing_running' };
    readyAt = plot.readyAt;
  } else {
    const machine = state.machines[target.id];
    const running = machine && machine.queue.find(function (job) { return job.readyAt > nowMs; });
    if (!running) return { ok: false, reason: 'nothing_running' };
    readyAt = running.readyAt;
  }
  if (readyAt <= nowMs) return { ok: false, reason: 'nothing_running' };

  if (!(state.hourglasses > 0)) return { ok: false, reason: 'no_hourglass' };

  if (target.kind === 'plot') {
    state.plots[target.index].readyAt = nowMs;
  } else {
    const machine = state.machines[target.id];
    const saved = readyAt - nowMs;
    for (const job of machine.queue) {
      if (job.readyAt <= nowMs) continue;
      if (job.startedAt >= readyAt) {
        job.startedAt -= saved;
        job.readyAt -= saved;
      } else {
        job.readyAt = nowMs;
      }
    }
  }
  state.hourglasses -= 1;
  return { ok: true };
}

function grantAdGems(state, rules) {
  state.gems += rules.GEMS.adReward;
  return { ok: true, gems: state.gems };
}

function grantPaidGems(state, rules) {
  state.gems += rules.GEMS.buyReward;
  return { ok: true, gems: state.gems };
}

function plantAll(state, cropId, nowMs, rules) {
  const crop = rules.CROPS[cropId];
  const item = rules.ITEMS[cropId];
  if (!crop || !item) return { ok: false, reason: 'unknown_crop' };
  if (item.unlockLevel > levelOf(state.xp, rules)) return { ok: false, reason: 'locked' };

  let planted = 0;
  let blocked = null;

  for (let i = 0; i < state.plots.length; i += 1) {
    if (state.plots[i].cropId) continue;
    if (state.coins < crop.seedPrice) {
      blocked = 'no_coins';
      break;
    }
    if (plant(state, i, cropId, nowMs, rules).ok) planted += 1;
  }

  if (planted === 0 && blocked === null) blocked = 'no_empty';
  return { ok: true, planted, blocked };
}

function harvestAll(state, nowMs, rules) {
  const items = {};
  let skipped = 0;

  for (let i = 0; i < state.plots.length; i += 1) {
    const plot = state.plots[i];
    if (!plot.cropId || nowMs < plot.readyAt) continue;
    const result = harvest(state, i, nowMs, rules);
    if (result.ok) {
      items[result.itemId] = (items[result.itemId] || 0) + result.qty;
    } else if (result.reason === 'silo_full') {
      skipped += 1;
    }
  }

  return { ok: true, items, skipped };
}

// 农场页的一键加速只作用于地里，机器在各自主页单独加速。
function useHourglassOnPlots(state, nowMs, rules) {
  const targets = [];
  state.plots.forEach((plot, index) => {
    if (plot.cropId && plot.readyAt > nowMs) targets.push({ kind: 'plot', index });
  });

  let used = 0;
  let stopped = null;
  for (const target of targets) {
    if (!(state.hourglasses > 0)) {
      stopped = 'no_hourglass';
      break;
    }
    if (useHourglass(state, target, nowMs, rules).ok) used += 1;
  }

  return { ok: true, used, stopped };
}

if (typeof module !== 'undefined') {
  module.exports = {
    validateContent,
    createState,
    hydrate,
    levelOf,
    siloCap,
    siloSlotsUsed,
    siloSlotsFree,
    canStore,
    remainingMs,
    formatDuration,
    plant,
    harvest,
    unlockRecipe,
    buyQueueSlot,
    queueSlotCost,
    enqueue,
    collectReady,
    generateOrder,
    deliverOrder,
    abandonOrder,
    buyOrderSlot,
    orderSlotCost,
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
    grantAdGems,
    grantPaidGems,
    plantAll,
    harvestAll,
    useHourglassOnPlots,
  };
}
