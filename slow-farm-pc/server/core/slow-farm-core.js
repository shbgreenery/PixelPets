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
    lastSeenAt: 0,
    dailyDay: '',
    dailyOrder: null,
    stats: { planted: 0, harvested: 0, crafted: 0, animalItems: 0, delivered: 0, earned: 0 },
    achievements: {},
    taskIndex: 0,
    tabsSeen: {},
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

// 一个格子只放一种物品，数量不设上限
function siloSlotsUsed(state) {
  let total = 0;
  for (const quantity of Object.values(state.silo)) {
    if (quantity > 0) total += 1;
  }
  return total;
}

function projectedSlots(state, additions) {
  let total = 0;

  for (const [itemId, quantity] of Object.entries(state.silo)) {
    if (quantity + (additions[itemId] || 0) > 0) total += 1;
  }
  for (const [itemId, quantity] of Object.entries(additions)) {
    if (!Object.prototype.hasOwnProperty.call(state.silo, itemId) && quantity > 0) total += 1;
  }

  return total;
}

function canStore(state, additions) {
  return projectedSlots(state, additions) <= state.siloSlots;
}

function siloSlotsFree(state) {
  return Math.max(0, state.siloSlots - siloSlotsUsed(state));
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
  target.lastSeenAt = toCount(target.lastSeenAt);
  target.dailyDay = typeof target.dailyDay === 'string' ? target.dailyDay : '';
  target.dailyOrder = normalizeOrder(target.dailyOrder, rules);

  const savedStats = target.stats && typeof target.stats === 'object' ? target.stats : {};
  target.stats = {
    planted: toCount(savedStats.planted),
    harvested: toCount(savedStats.harvested),
    crafted: toCount(savedStats.crafted),
    animalItems: toCount(savedStats.animalItems),
    delivered: toCount(savedStats.delivered),
    earned: toCount(savedStats.earned),
  };

  const achievements = {};
  for (const id of Object.keys(target.achievements || {})) {
    if (target.achievements[id]) achievements[id] = true;
  }
  target.achievements = achievements;

  target.taskIndex = Math.min(toCount(target.taskIndex), rules.TASKS.length);
  const tabsSeen = {};
  for (const tab of Object.keys(target.tabsSeen || {})) {
    if (target.tabsSeen[tab]) tabsSeen[tab] = true;
  }
  target.tabsSeen = tabsSeen;

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
  state.stats.planted += 1;
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
  if (!canStore(state, addition)) return { ok: false, reason: 'silo_full' };

  state.silo[itemId] = (state.silo[itemId] || 0) + qty;
  state.xp += 1;
  state.stats.harvested += qty;
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
    if (!canStore(state, recipe.output)) {
      remaining.push(job);
      skipped += 1;
      continue;
    }
    for (const [itemId, quantity] of Object.entries(recipe.output)) {
      state.silo[itemId] = (state.silo[itemId] || 0) + quantity;
      items[itemId] = (items[itemId] || 0) + quantity;
      state.stats.crafted += quantity;
    }
    collected += 1;
  }

  machine.queue = remaining;
  return { ok: true, items, collected, skipped };
}

// 遍历所有机器收取已完成任务；仓库满的任务留在队列里，计入 skipped。
function collectAllMachines(state, nowMs, rules) {
  const items = {};
  let collected = 0;
  let skipped = 0;
  for (const machineId of Object.keys(state.machines)) {
    const result = collectReady(state, machineId, nowMs, rules);
    if (!result.ok) continue;
    collected += result.collected;
    skipped += result.skipped;
    for (const [itemId, quantity] of Object.entries(result.items)) {
      items[itemId] = (items[itemId] || 0) + quantity;
    }
  }
  return { ok: true, items, collected, skipped };
}

// 按配方定义顺序找该机器第一个已解锁且材料足够的配方；没有则返回 null。
function autoRecipe(state, machineId, rules) {
  for (const [recipeId, recipe] of Object.entries(rules.RECIPES)) {
    if (recipe.machine !== machineId) continue;
    if (!state.unlockedRecipes[recipeId]) continue;
    const enough = Object.entries(recipe.input)
      .every(function (entry) { return (state.silo[entry[0]] || 0) >= entry[1]; });
    if (enough) return recipeId;
  }
  return null;
}

// 每台已建机器反复放入自动配方，直到队列满或材料耗尽；材料不足的机器跳过继续下一台。
function enqueueAll(state, nowMs, rules) {
  let queued = 0;
  let blocked = null;
  for (const machineId of Object.keys(state.machines)) {
    const machine = state.machines[machineId];
    if (!machine.unlocked) continue;
    while (machine.queue.length < machine.queueSize) {
      const recipeId = autoRecipe(state, machineId, rules);
      if (recipeId === null) {
        if (blocked === null) blocked = 'missing_input';
        break;
      }
      const result = enqueue(state, machineId, recipeId, nowMs, rules);
      if (!result.ok) {
        if (blocked === null) blocked = result.reason;
        break;
      }
      queued += 1;
    }
  }
  return { ok: true, queued, blocked };
}

// 依次加速生产中的机器；沙漏用完时停止并把原因带回。
function useHourglassOnMachines(state, nowMs, rules) {
  let used = 0;
  let stopped = null;
  for (const machineId of Object.keys(state.machines)) {
    const machine = state.machines[machineId];
    if (!machine.unlocked) continue;
    if (!machine.queue.some(function (job) { return job.readyAt > nowMs; })) continue;
    if (!(state.hourglasses > 0)) {
      stopped = 'no_hourglass';
      break;
    }
    const result = useHourglass(state, { kind: 'machine', id: machineId }, nowMs, rules);
    if (result.ok) used += 1;
  }
  return { ok: true, used, stopped };
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
  if (state.dailyOrder && state.dailyOrder.id === orderId) {
    const daily = state.dailyOrder;
    const needed = {};
    for (const line of daily.lines) needed[line.itemId] = (needed[line.itemId] || 0) + line.quantity;
    for (const [itemId, quantity] of Object.entries(needed)) {
      if (!((state.silo[itemId] || 0) >= quantity)) return { ok: false, reason: 'missing_items' };
    }
    for (const [itemId, quantity] of Object.entries(needed)) {
      state.silo[itemId] -= quantity;
    }
    state.dailyOrder = null;
    state.coins += daily.coins;
    state.xp += daily.xp;
    state.stats.delivered += 1;
    state.stats.earned += daily.coins;
    return { ok: true, coins: daily.coins, xp: daily.xp, daily: true };
  }

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
  state.stats.delivered += 1;
  state.stats.earned += order.coins;
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
  state.stats.earned += coins;
  return { ok: true, coins };
}

// 回归概览：现在有多少东西在等你处理
function metricValue(state, metric, rules) {
  if (metric === 'plots') return state.plots.length;
  if (metric === 'machines') {
    return Object.values(state.machines).filter(function (m) { return m.unlocked; }).length;
  }
  if (metric === 'animalKinds') {
    return Object.values(state.animals).filter(function (group) { return group.list.length > 0; }).length;
  }
  if (metric === 'level') return levelOf(state.xp, rules);
  return state.stats[metric] || 0;
}

function dayKey(nowMs) {
  const date = new Date(nowMs);
  return date.getFullYear() + '-' + (date.getMonth() + 1) + '-' + date.getDate();
}

// 每天一张特供单：奖励翻倍，交完当天不再出现
// dailyDay 记录「今天已经发放过」，交付清空 dailyOrder 后日期仍保留，避免当天重开又补一张
function ensureDailyOrder(state, rules, rng, nowMs) {
  const key = dayKey(nowMs);
  if (state.dailyDay === key) return false;

  const base = generateOrder(state, rules, rng);
  state.dailyDay = key;
  state.dailyOrder = {
    id: 'd' + base.id.slice(1),
    lines: base.lines,
    coins: base.coins * 2,
    xp: base.xp * 2,
  };
  return true;
}

function taskMetric(state, metric, rules) {
  if (metric === 'level') return levelOf(state.xp, rules);
  if (metric === 'hourglasses') return state.hourglasses;
  if (metric.indexOf('visited:') === 0) {
    return state.tabsSeen[metric.slice(8)] ? 1 : 0;
  }
  if (metric.indexOf('recipe:') === 0) {
    return state.unlockedRecipes[metric.slice(7)] ? 1 : 0;
  }
  if (metric.indexOf('machine:') === 0) {
    const machine = state.machines[metric.slice(8)];
    return machine && machine.unlocked ? 1 : 0;
  }
  if (metric.indexOf('animal:') === 0) {
    const group = state.animals[metric.slice(7)];
    return group ? group.list.length : 0;
  }
  return state.stats[metric] || 0;
}

// 任务链是线性的：当前这条没完成，后面的不推进
function evaluateTasks(state, rules) {
  const done = [];
  while (state.taskIndex < rules.TASKS.length) {
    const task = rules.TASKS[state.taskIndex];
    if (taskMetric(state, task.check.metric, rules) < task.check.goal) break;
    state.taskIndex += 1;
    state.coins += task.reward;
    state.stats.earned += task.reward;
    done.push(task);
  }
  return done;
}

function visitTab(state, tab, rules) {
  if (state.tabsSeen[tab]) return [];
  state.tabsSeen[tab] = true;
  return evaluateTasks(state, rules);
}

function evaluateAchievements(state, rules) {
  const unlocked = [];
  for (const def of rules.ACHIEVEMENTS) {
    if (state.achievements[def.id]) continue;
    if (metricValue(state, def.metric, rules) >= def.goal) {
      state.achievements[def.id] = true;
      if (def.reward) {
        state.coins += def.reward;
        state.stats.earned += def.reward;
      }
      unlocked.push(def);
    }
  }
  return unlocked;
}

function waitingSummary(state, nowMs, rules) {
  let plots = 0;
  for (const plot of state.plots) {
    if (plot.cropId && plot.readyAt <= nowMs) plots += 1;
  }

  let machineItems = 0;
  for (const id of Object.keys(state.machines)) {
    for (const job of state.machines[id].queue) {
      if (job.readyAt <= nowMs) machineItems += 1;
    }
  }

  let animalItems = 0;
  for (const kind of Object.keys(state.animals)) {
    for (const animal of state.animals[kind].list) {
      if (animal.readyAt > 0 && animal.readyAt <= nowMs) animalItems += 1;
    }
  }

  let orders = 0;
  for (const order of state.orders) {
    const ready = order.lines.every(function (line) {
      return (state.silo[line.itemId] || 0) >= line.quantity;
    });
    if (ready) orders += 1;
  }

  return { plots, machineItems, animalItems, orders };
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
  if (!canStore(state, addition)) return { ok: false, reason: 'silo_full' };

  state.silo[def.product] = (state.silo[def.product] || 0) + 1;
  state.xp += 1;
  state.stats.animalItems += 1;
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
  if (!target || (target.kind !== 'plot' && target.kind !== 'machine' && target.kind !== 'animal')) {
    return { ok: false, reason: 'bad_target' };
  }

  let readyAt;
  let animal = null;
  if (target.kind === 'plot') {
    const plot = state.plots[target.index];
    if (!plot || !plot.cropId) return { ok: false, reason: 'nothing_running' };
    readyAt = plot.readyAt;
  } else if (target.kind === 'animal') {
    const group = state.animals[target.kindId];
    animal = group && group.list[target.index];
    if (!animal) return { ok: false, reason: 'nothing_running' };
    readyAt = animal.readyAt;
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
  } else if (target.kind === 'animal') {
    animal.readyAt = nowMs;
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

// 养殖页的一键加速只作用于正在产出的动物。
function useHourglassOnAnimals(state, kind, nowMs, rules) {
  const group = state.animals[kind];
  if (!group) return { ok: false, reason: 'unknown_animal' };

  const targets = [];
  group.list.forEach((animal, index) => {
    if (animal.readyAt > nowMs) targets.push({ kind: 'animal', kindId: kind, index });
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

const CORE = {
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
  collectAllMachines,
  enqueueAll,
  useHourglassOnMachines,
  generateOrder,
  deliverOrder,
  abandonOrder,
  buyOrderSlot,
  orderSlotCost,
  buyPlot,
  buyMachine,
  buySiloSlot,
  sellItem,
  waitingSummary,
  dayKey,
  ensureDailyOrder,
  evaluateAchievements,
  evaluateTasks,
  taskMetric,
  visitTab,
  metricValue,
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
  useHourglassOnAnimals,
};

if (typeof module !== 'undefined') {
  module.exports = CORE;
}
