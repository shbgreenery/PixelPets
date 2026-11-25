'use strict';
const assert = require('assert');
const rules = require('../slow-farm-rules.js');
const core = require('../slow-farm-core.js');

function makeState() {
  const state = core.createState(rules, () => 0);
  state.machines = {
    mill: { unlocked: true, queueSize: 2, queue: [{ recipeId: 'flour', startedAt: 0, readyAt: 100 }] },
    bakery: { unlocked: true, queueSize: 2, queue: [{ recipeId: 'bread', startedAt: 0, readyAt: 100 }] },
  };
  state.silo = {};
  state.siloSlots = rules.SILO.initial;
  state.stats = { ...state.stats, crafted: 0 };
  return state;
}

// 两台机器的完成项都会被收进仓库
const s = makeState();
const r = core.collectAllMachines(s, 200, rules);
assert.strictEqual(r.ok, true);
assert.strictEqual(r.collected, 2);
assert.strictEqual(r.skipped, 0);
assert.strictEqual(r.items.flour, 1);
assert.strictEqual(r.items.bread, 1);
assert.strictEqual(s.silo.flour, 1);
assert.strictEqual(s.machines.mill.queue.length, 0);
assert.strictEqual(s.machines.bakery.queue.length, 0);

// 仓库满时跳过收不下的任务，已收的不回滚
const full = makeState();
full.silo = { wheat: 1 };
full.siloSlots = 1;
const r2 = core.collectAllMachines(full, 200, rules);
assert.strictEqual(r2.ok, true);
assert.strictEqual(r2.collected, 0);
assert.strictEqual(r2.skipped, 2);
assert.strictEqual(full.machines.mill.queue.length, 1, '收不下时任务留在队列里');

// 没有完成项时返回 0，不报错
const idle = makeState();
idle.machines.mill.queue = [];
idle.machines.bakery.queue = [];
const r3 = core.collectAllMachines(idle, 200, rules);
assert.deepStrictEqual(r3, { ok: true, items: {}, collected: 0, skipped: 0 });

console.log('machine-batch collectAllMachines 通过');

// 一键加料：每台机器反复放入首个材料足够的已解锁配方，直到队列满或材料耗尽
const e = makeState();
e.machines = {
  mill: { unlocked: true, queueSize: 2, queue: [] },
  bakery: { unlocked: true, queueSize: 2, queue: [] },
};
e.silo = { wheat: 4, flour: 1 };
e.unlockedRecipes = { flour: true, bread: true };
const q = core.enqueueAll(e, 0, rules);
assert.strictEqual(q.ok, true);
assert.strictEqual(q.queued, 3, '磨坊放 2 份面粉，面包房放 1 份面包后缺面粉');
assert.strictEqual(e.machines.mill.queue.length, 2);
assert.strictEqual(e.machines.bakery.queue.length, 1);
assert.strictEqual(q.blocked, 'missing_input');

// 多配方机器：第一个配方材料不够时继续尝试下一个。
// 真实规则里 bakery 的两个配方都需要 flour，构造不出"前者不够、后者够"，因此用精简规则表。
const multiRules = {
  ...rules,
  RECIPES: {
    bread: { name: '面包', machine: 'bakery', input: { flour: 5 }, ms: 1000, output: { bread: 1 }, unlockLevel: 1 },
    cornBread: { name: '玉米面包', machine: 'bakery', input: { corn: 1 }, ms: 1000, output: { cornBread: 1 }, unlockLevel: 1 },
  },
};
const multi = makeState();
multi.machines = { bakery: { unlocked: true, queueSize: 2, queue: [] } };
multi.silo = { corn: 1 };
multi.unlockedRecipes = { bread: true, cornBread: true };
const q2 = core.enqueueAll(multi, 0, multiRules);
assert.strictEqual(q2.queued, 1, '应跳过缺面包原料的面包，放入玉米面包');
assert.strictEqual(multi.machines.bakery.queue[0].recipeId, 'cornBread');

// 队列已满时不放入，blocked 为 null
const queueFull = makeState();
queueFull.machines = { mill: { unlocked: true, queueSize: 1, queue: [{ recipeId: 'flour', startedAt: 0, readyAt: 1 }] } };
queueFull.silo = { wheat: 10 };
queueFull.unlockedRecipes = { flour: true };
const q3 = core.enqueueAll(queueFull, 0, rules);
assert.strictEqual(q3.queued, 0);
assert.strictEqual(q3.blocked, null);

// 未建造的机器不参与
const locked = makeState();
locked.machines = { mill: { unlocked: false, queueSize: 2, queue: [] } };
locked.silo = { wheat: 10 };
locked.unlockedRecipes = { flour: true };
assert.strictEqual(core.enqueueAll(locked, 0, rules).queued, 0);

console.log('machine-batch enqueueAll 通过');

// 一键加速：只有沙漏时才能加速生产中的机器，用完即停
const h = makeState();
h.machines = {
  mill: { unlocked: true, queueSize: 2, queue: [{ recipeId: 'flour', startedAt: 0, readyAt: 1000 }] },
  bakery: { unlocked: true, queueSize: 2, queue: [{ recipeId: 'bread', startedAt: 0, readyAt: 2000 }] },
};
h.hourglasses = 1;
const u = core.useHourglassOnMachines(h, 0, rules);
assert.strictEqual(u.ok, true);
assert.strictEqual(u.used, 1);
assert.strictEqual(u.stopped, 'no_hourglass');
assert.strictEqual(h.hourglasses, 0);

// 没有生产中的机器时不用沙漏
const calm = makeState();
calm.machines = { mill: { unlocked: true, queueSize: 2, queue: [] } };
calm.hourglasses = 3;
const u2 = core.useHourglassOnMachines(calm, 0, rules);
assert.strictEqual(u2.used, 0);
assert.strictEqual(u2.stopped, null);
assert.strictEqual(calm.hourglasses, 3);

console.log('machine-batch useHourglassOnMachines 通过');
