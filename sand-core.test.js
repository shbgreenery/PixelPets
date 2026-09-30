'use strict';

// 单测：锁定沙画核心的落沙守恒、吸沙边界、拆盘精确性、队列均分语义
const assert = require('assert');
const {
  SAND_COLS, SAND_ROWS, TOTAL_SAND, DRAIN_ROWS,
  PLATE_TIERS, MAX_QUEUE_COLS, SCENE_KINDS,
  ABSORB_TOL, BELT_SPEED, BELT_IDLE_CYCLES, VISIBLE_SLOTS, SAND_W,
  C_RED, C_BLUE, C_GREEN, C_WHITE,
  mulberry32, generateScene, SandGrid, Belt,
  splitPlates, distributeToQueues, rebalanceQueues,
} = require('./sand-core.js');

// ---------- 常量自洽 ----------
assert.strictEqual(SAND_COLS * SAND_ROWS, TOTAL_SAND, '沙粒总数应等于网格格数');
assert.strictEqual(TOTAL_SAND, 99000, '沙粒总数应为 99,000（沙盘压到 600×660 后）');
assert.strictEqual(PLATE_TIERS[0], 2400, '最大盘子档位应为 2400');

// ---------- generateScene：填满、合法、确定性 ----------
for (const kind of SCENE_KINDS) {
  const s = generateScene(kind, 12345, 60, 80);
  assert.strictEqual(s.length, 60 * 80, `${kind} 应返回 60*80 的网格`);
  let bad = 0;
  for (let i = 0; i < s.length; i++) if (s[i] < 0 || s[i] >= 11) bad++;
  assert.strictEqual(bad, 0, `${kind} 不应有空格或越界色号（场景必须填满整个沙盘）`);
}
const s1 = generateScene('mountain', 999, 40, 50);
const s2 = generateScene('mountain', 999, 40, 50);
assert.deepStrictEqual(Array.from(s1), Array.from(s2), '同 seed 应生成完全相同的场景');
const s3 = generateScene('mountain', 1000, 40, 50);
assert.notDeepStrictEqual(Array.from(s1), Array.from(s3), '不同 seed 应生成不同场景');

// ---------- 场景配色分布：单色不能吃掉半个沙盘，且要用到足够多的颜色 ----------
// 早期版本把天空/地面各当一整块单色填充，导致两个颜色占 93%，游戏里只有两色有意义。
// 现在天空与地面都切成分层色带，这两个阈值锁住这个改进。
{
  const N = 300 * 400;
  let worstPct = 0, minUsed = 99, worstCase = '';
  for (const kind of SCENE_KINDS) {
    for (let s = 1; s <= 20; s++) {
      const cells = generateScene(kind, s * 7919, 300, 400);
      const tally = new Array(11).fill(0);
      for (let i = 0; i < cells.length; i++) if (cells[i] >= 0) tally[cells[i]]++;
      const max = Math.max(...tally);
      const used = tally.filter(n => n > 0).length;
      if (max / N > worstPct) { worstPct = max / N; worstCase = `${kind} seed=${s * 7919}`; }
      if (used < minUsed) minUsed = used;
    }
  }
  assert.ok(worstPct <= 0.45,
    `最大单色占比应 <= 45%，实测 ${(worstPct * 100).toFixed(1)}%（${worstCase}）`);
  assert.ok(minUsed >= 6,
    `每个场景应至少用到 6 种颜色，实测最少 ${minUsed} 种`);
}

// ---------- SandGrid.tick：单颗沙粒落到底 ----------
{
  const g = new SandGrid(3, 5, 1);
  g.cells[0 * 3 + 1] = C_RED;
  let guard = 0;
  while (g.tick() > 0 && guard++ < 100);
  assert.strictEqual(g.cells[4 * 3 + 1], C_RED, '沙粒应落到最底行');
  assert.strictEqual(g.countAll(), 1, '落沙不应凭空增减沙粒');
}

// ---------- SandGrid.tick：静止后返回 0（调用方据此休眠） ----------
{
  const g = new SandGrid(3, 5, 1);
  g.cells[4 * 3 + 1] = C_RED;
  assert.strictEqual(g.tick(), 0, '已静止时 tick 应返回 0');
}

// ---------- SandGrid.tick：正下方被占时斜滑 ----------
{
  const g = new SandGrid(3, 4, 1);
  g.cells[3 * 3 + 1] = C_RED;    // 最底行中间被占
  g.cells[2 * 3 + 1] = C_BLUE;   // 正上方一颗蓝
  g.tick();
  const slid = g.cells[3 * 3 + 0] === C_BLUE || g.cells[3 * 3 + 2] === C_BLUE;
  assert.ok(slid, '正下方被占、斜下方为空时应斜滑');
}

// ---------- SandGrid.tick：斜下方【两边都要试】 ----------
// 曾经的 bug：随机选一边后就只检查那一边，另一边被挡时直接放弃，
// 导致"左下方空着、右下方被占"时有约一半概率原地不动（沙子挂在半空）。
// 正确做法是随机只决定"先试哪边"，两边都要试。
{
  let stuck = 0;
  for (let trial = 0; trial < 200; trial++) {
    const g = new SandGrid(3, 2, 1);
    g.cells[0 * 3 + 1] = C_BLUE;   // 待下落
    g.cells[1 * 3 + 1] = C_RED;    // 正下方被占
    g.cells[1 * 3 + 2] = C_RED;    // 右下方也被占，只剩左下方空着
    g.rndState = (trial * 2654435761) | 0;   // 每轮不同随机种子
    g.tick();
    if (g.cells[0 * 3 + 1] === C_BLUE) stuck++;
  }
  assert.strictEqual(stuck, 0,
    '左下方空着时，无论随机先试哪边都应滑过去，不能原地不动');
}

// ---------- 回归：挖洞 + 塌落不应产生横向漂移 ----------
// 曾经的 bug：tick 固定从左到右扫，被挖出的空洞总是先被【左边】那颗沙抢到
//（左邻先被处理，斜下方一探就是洞），等轮到右边的沙时洞已被填。
// 于是每轮"挖洞 → 塌落补位"都让沙子净向右挪，几百轮后塌成 45° 大斜坡。
// 修法是水平扫描方向逐 tick 翻转。居中挖洞后重心必须仍在中央。
{
  const W = 60, H = 60;
  const g = new SandGrid(W, H, 4);
  g.cells.fill(C_RED);
  for (let c = 20; c < 40; c++) g.cells[(H - 1) * W + c] = -1;   // 居中挖掉底行一段
  let guard = 0;
  while (g.tick() > 0 && guard++ < 20000);

  let sx = 0, n = 0;
  for (let r = 0; r < H; r++)
    for (let c = 0; c < W; c++) if (g.cells[r * W + c] >= 0) { sx += c; n++; }
  const com = sx / n;
  assert.ok(Math.abs(com - 29.5) < 1.0,
    `居中挖洞塌落后重心应仍在中央 29.5，实测 ${com.toFixed(2)}（偏离说明有横向漂移）`);
}

// ---------- 回归：反复"挖洞 → 塌落"后沙子不应横向漂移 ----------
// 这是上一条的强化版：跑几十轮把漂移放大。居中挖洞是对称操作，重心必须还在中央。
// 固定扫描方向时实测重心会漂到 22.9（偏左 6.6），翻转后稳定在 30.0（偏 0.5）。
{
  const W = 60, H = 60;
  const g = new SandGrid(W, H, 4);
  g.cells.fill(C_RED);
  for (let round = 0; round < 60; round++) {
    for (let c = 20; c < 40; c++) g.cells[(H - 1) * W + c] = -1;   // 每轮居中挖掉底行 20 格
    let guard = 0;
    while (g.tick() > 0 && guard++ < 20000);
  }
  let sx = 0, n = 0;
  for (let r = 0; r < H; r++)
    for (let c = 0; c < W; c++) if (g.cells[r * W + c] >= 0) { sx += c; n++; }
  const com = sx / n;
  assert.ok(Math.abs(com - 29.5) < 2.5,
    `居中挖洞 60 轮后重心应仍在中央 29.5，实测 ${com.toFixed(2)}（偏离说明沙子整体漂移了）`);
}

// ---------- SandGrid.tick：两边都被占时才不动 ----------
{
  const g = new SandGrid(3, 2, 1);
  g.cells[0 * 3 + 1] = C_BLUE;
  g.cells[1 * 3 + 0] = C_RED;
  g.cells[1 * 3 + 1] = C_RED;
  g.cells[1 * 3 + 2] = C_RED;
  assert.strictEqual(g.tick(), 0, '三个方向都被占时应确实不动');
  assert.strictEqual(g.cells[0 * 3 + 1], C_BLUE, '蓝沙应留在原地');
}

// ---------- SandGrid.tick：守恒（大量随机下落不增减沙粒） ----------
{
  const g = new SandGrid(20, 30, 3);
  const rnd = mulberry32(7);
  let placed = 0;
  for (let i = 0; i < g.cells.length; i++) {
    if (rnd() < 0.6) { g.cells[i] = (rnd() * 11) | 0; placed++; }
  }
  let guard = 0;
  while (g.tick() > 0 && guard++ < 5000);
  assert.strictEqual(g.countAll(), placed, '落沙全过程应守恒');
}

// ---------- SandGrid.absorb：只吸取料区、优先最底行、不超取 ----------
{
  const g = new SandGrid(4, 6, 2);          // 取料区 = 底部 2 行
  g.cells[4 * 4 + 0] = C_RED;               // 取料区上层
  g.cells[4 * 4 + 1] = C_BLUE;
  g.cells[5 * 4 + 0] = C_RED;               // 取料区最底行
  g.cells[5 * 4 + 2] = C_RED;

  assert.strictEqual(g.absorb(C_RED, 1), 1, '应吸走 1 颗红');
  assert.strictEqual(g.cells[5 * 4 + 0], -1, '应优先吸走最底行的红');
  assert.strictEqual(g.absorb(C_RED, 5), 2, '取料区还剩 (5,2) 和 (4,0) 两颗红，应全部吸走');
  assert.strictEqual(g.absorb(C_RED, 5), 0, '红已吸完应返回 0');
  assert.strictEqual(g.cells[4 * 4 + 1], C_BLUE, '蓝不应被误吸');
}

// ---------- SandGrid.absorb：取料区之外的沙粒不被吸走 ----------
{
  const g = new SandGrid(4, 6, 2);
  g.cells[0 * 4 + 0] = C_RED;               // 沙盘顶部，不在取料区
  assert.strictEqual(g.absorb(C_RED, 99), 0, '取料区之外的沙粒不应被吸走');
}

// ---------- SandGrid.absorb：out 参数应写回真实被清掉的格下标 ----------
// 渲染层用这个列表作为"沙粒飞向盘子"的起飞点，保证动画与实际消失的沙粒严格对应。
{
  const g = new SandGrid(4, 6, 2);
  g.cells[5 * 4 + 0] = C_RED;
  g.cells[5 * 4 + 2] = C_RED;
  g.cells[4 * 4 + 1] = C_RED;
  const out = [];
  assert.strictEqual(g.absorb(C_RED, 2, out), 2, '应吸走 2 颗');
  assert.deepStrictEqual(out, [5 * 4 + 0, 5 * 4 + 2],
    'out 应按扫描顺序（最底行从左到右）写回被清掉的格下标');
  assert.strictEqual(g.cells[4 * 4 + 1], C_RED, '没吸到的那颗不应出现在 out 里');
  assert.strictEqual(g.absorb(C_RED, 99), 1, '不传 out 时仍应正常返回数量');
}

// ---------- SandGrid.drainHas / drainOccupied ----------
{
  const g = new SandGrid(4, 6, 2);
  g.cells[0 * 4 + 0] = C_GREEN;             // 取料区之外
  assert.strictEqual(g.drainHas(C_GREEN), false, '取料区外的不算 drainHas');
  assert.strictEqual(g.drainOccupied(), 0, '取料区初始应为空');
  g.cells[5 * 4 + 3] = C_GREEN;
  assert.strictEqual(g.drainHas(C_GREEN), true, '取料区内的应算 drainHas');
  assert.strictEqual(g.drainOccupied(), 1, '取料区占用数应为 1');
}

// ---------- SandGrid.countByColor ----------
{
  const g = new SandGrid(3, 3, 1);
  g.cells[0] = C_RED; g.cells[1] = C_RED; g.cells[2] = C_BLUE;
  const c = g.countByColor(11);
  assert.strictEqual(c[C_RED], 2);
  assert.strictEqual(c[C_BLUE], 1);
  assert.strictEqual(c[C_GREEN], 0);
}

// ---------- splitPlates：总容量必须【精确等于】沙粒数（否则死锁） ----------
{
  const counts = new Array(11).fill(0);
  counts[C_RED] = 10000;
  const plates = splitPlates(counts);
  const total = plates.reduce((s, p) => s + p.capacity, 0);
  assert.strictEqual(total, 10000, '盘子总容量应精确等于该色沙粒数');
  assert.ok(plates.every(p => p.capacity > 0), '不应出现 0 容量盘子');
  assert.ok(plates.every(p => p.color === C_RED), '颜色应一致');
  // 档位贪心：2400×4 + 余数 400
  assert.deepStrictEqual(plates.map(p => p.capacity), [2400, 2400, 2400, 2400, 400],
    '应从最大档位贪心拆分，最后一盘吃掉余数');
}

// ---------- splitPlates：余数盘容量精确等于余数 ----------
{
  const counts = new Array(11).fill(0);
  counts[C_BLUE] = 109;
  const plates = splitPlates(counts);
  assert.strictEqual(plates.length, 1, '109 颗应只拆成 1 盘');
  assert.strictEqual(plates[0].capacity, 109, '余数盘容量应精确等于 109，不能凑整到 200');
}

// ---------- splitPlates：多色互不干扰，且每色总额精确 ----------
{
  const counts = [50, 2500, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const plates = splitPlates(counts);
  const sum = {};
  for (const p of plates) sum[p.color] = (sum[p.color] || 0) + p.capacity;
  assert.strictEqual(sum[0], 50, '颜色0 总额应为 50');
  assert.strictEqual(sum[1], 2500, '颜色1 总额应为 2500');
  assert.strictEqual(plates.length, 3, '应为 50 + (2400+100) 共 3 盘');
}

// ---------- splitPlates：全 0 输入返回空 ----------
assert.strictEqual(splitPlates(new Array(11).fill(0)).length, 0, '全 0 应返回空盘列表');

// ---------- distributeToQueues：列数不超过上限、盘子不丢、尽量均分、同色内大容量在前 ----------
{
  const counts = new Array(11).fill(0);
  counts[C_RED] = 20000;                       // → 2400×8 + 600 + 200 = 10 盘
  const plates = splitPlates(counts);
  const q = distributeToQueues(plates, MAX_QUEUE_COLS);
  assert.strictEqual(q.length, MAX_QUEUE_COLS, `应分成 ${MAX_QUEUE_COLS} 列`);
  const total = q.reduce((s, c) => s + c.length, 0);
  assert.strictEqual(total, plates.length, '分配后盘子总数不应变化');
  const lens = q.map(c => c.length);
  assert.ok(Math.max(...lens) - Math.min(...lens) <= 1, '各列盘子数应尽量均分');
  // 同色内大容量在前
  assert.ok(q[0][0].capacity >= q[0][1].capacity, '同色内应按容量从大到小排列');
}

// ---------- distributeToQueues：盘子少时不硬凑满列 ----------
{
  const counts = new Array(11).fill(0);
  counts[C_RED] = 50;
  const q = distributeToQueues(splitPlates(counts), MAX_QUEUE_COLS);
  assert.strictEqual(q.length, 1, '只有 1 个盘子时应只开 1 列');
}

// ---------- 队列排序：可见的 10 个盘子应跨越颜色区间，而不是挤在最前面几个色 ----------
// 轮流分配会让 5 列 × 2 槽的可见盘子全部落在颜色号最小的那 4 种；
// 连续分块 + 按色排序后提升到 6 种。10 个槽位最多只能显示 10 种颜色，6 是当前结构的实际上限。
{
  const counts = new Array(11).fill(0);
  for (let c = 0; c < 11; c++) counts[c] = 6000;   // 每色 → 2400+2400+1200 = 3 盘
  const q = distributeToQueues(splitPlates(counts), MAX_QUEUE_COLS);
  const visible = new Set();
  for (const col of q) for (let i = 0; i < 2 && i < col.length; i++) visible.add(col[i].color);
  assert.ok(visible.size >= 6,
    `队列可见的 10 个盘子应覆盖 >= 6 种颜色（轮流分配只有 4 种），实测 ${visible.size} 种`);
}

// ---------- rebalanceQueues：某列空了 → 只丢掉那一列，其余各列原样不动 ----------
// 不做均分：沙画必须放对颜色，玩家会记住"红色在第 3 列"，一重排就白记了。
{
  const mk = (color) => ({ color, capacity: 10, remaining: 10 });
  const q = [
    [mk(0), mk(1)],
    [mk(2)],
    [mk(3), mk(4), mk(5)],
    [],                        // 这一列被点空了
    [mk(6)],
  ];
  const r = rebalanceQueues(q);
  assert.strictEqual(r.length, 4, '空列应被丢掉，剩 4 列');
  assert.deepStrictEqual(r.map(c => c.length), [2, 1, 3, 1],
    '其余各列的内容应原样保留，不做均分');
  assert.deepStrictEqual(r.map(c => c[0].color), [0, 2, 3, 6],
    '各列头部的盘子不应变化（玩家记住的位置不能失效）');
  assert.strictEqual(r.reduce((s, c) => s + c.length, 0), 7, '盘子总数不变');
  assert.ok(r.every(c => c.length > 0), '不应留下空列');
}

// ---------- rebalanceQueues：全部空了 → 返回一个空列占位 ----------
{
  const r = rebalanceQueues([[], [], []]);
  assert.strictEqual(r.length, 1, '全空时应返回 1 个空列占位，而不是空数组');
  assert.strictEqual(r[0].length, 0, '占位列应为空');
}

// ---------- rebalanceQueues：只剩 1 列时保持 1 列 ----------
{
  const mk = (color) => ({ color, capacity: 10, remaining: 10 });
  const r = rebalanceQueues([[], [mk(0), mk(1), mk(2)]]);
  assert.strictEqual(r.length, 1, '只剩一列时应保持 1 列');
  assert.strictEqual(r[0].length, 3, '盘子应全部保留');
}

// ---------- 集成：吸沙 → 塌落补位 → 新沙进入取料区 ----------
{
  const COLS = 10, ROWS = 30, DRAIN = 5;
  const g = new SandGrid(COLS, ROWS, DRAIN);
  g.cells.fill(C_RED);
  for (let r = 22; r < 25; r++)                  // 取料区上方 3 行改成蓝色
    for (let c = 0; c < COLS; c++) g.cells[r * COLS + c] = C_BLUE;

  assert.strictEqual(g.drainOccupied(), COLS * DRAIN, '取料区初始应满');
  assert.strictEqual(g.drainHas(C_RED), true, '取料区初始有红');

  const sucked = g.absorb(C_RED, 9999);
  assert.strictEqual(sucked, COLS * DRAIN, '应把取料区的红全部吸走');
  assert.strictEqual(g.drainHas(C_RED), false, '吸完后取料区应无红');
  assert.strictEqual(g.drainOccupied(), 0, '吸完后取料区应为空');

  let guard = 0;
  while (g.tick() > 0 && guard++ < 20000);

  assert.strictEqual(g.drainOccupied(), COLS * DRAIN, '塌落后取料区应被上方沙子重新填满');
  assert.strictEqual(g.countAll(), COLS * ROWS - sucked, '总沙粒数应等于初始减去吸走的');
  assert.strictEqual(g.drainHas(C_BLUE), true, '塌落后取料区应出现原本在上方的蓝色');
}

// ---------- absorbInColumns：只吸指定列区间内的沙粒 ----------
// 传送带上盘子只覆盖它正下方那一小段，越界的沙粒吸不到 —— 这是"位置有意义"的核心。
{
  const g = new SandGrid(10, 6, 2);
  for (let r = 4; r < 6; r++)
    for (let c = 0; c < 10; c++) g.cells[r * 10 + c] = C_RED;

  const out = [];
  const taken = g.absorbInColumns(C_RED, 3, 6, 99, out);
  assert.strictEqual(taken, 6, '列区间 [3,6) × 2 行应吸走 6 颗');
  assert.ok(out.every(i => (i % 10) >= 3 && (i % 10) < 6), 'out 里所有格都应落在列区间内');
  assert.strictEqual(g.cells[4 * 10 + 2], C_RED, '区间左边的沙粒不应被吸走');
  assert.strictEqual(g.cells[4 * 10 + 6], C_RED, '区间右边的沙粒不应被吸走');
  assert.strictEqual(g.absorbInColumns(C_RED, 0, 99, 99), 14, '全区间应吸走剩下的 14 颗');
}

// ---------- absorbInColumns：列区间越界应被钳制，不崩 ----------
{
  const g = new SandGrid(10, 6, 2);
  for (let r = 4; r < 6; r++)
    for (let c = 0; c < 10; c++) g.cells[r * 10 + c] = C_RED;
  assert.strictEqual(g.absorbInColumns(C_RED, -5, 3, 99), 6, '左越界应钳到 0');
  assert.strictEqual(g.absorbInColumns(C_RED, 8, 999, 99), 4, '右越界应钳到列数');
}
// ---------- Belt：间距固定为"一屏 VISIBLE_SLOTS 个"，带长由盘位数推导 ----------
// 带长不是独立参数：盘位数 ≤ VISIBLE_SLOTS 时正好铺满一屏；超过后带比屏幕长。
{
  const b = new Belt(600, 6);
  assert.strictEqual(b.spacing, 100, '6 个盘位（≤一屏 7 个）间距应为 600/6 = 100');
  assert.strictEqual(b.length, 600, '6 个盘位时带长应正好一屏');
  assert.deepStrictEqual(
    Array.from({ length: 6 }, (_, i) => b.slotX(i)), [0, 100, 200, 300, 400, 500],
    'offset=0 时槽位应等距铺满一屏');
}

{
  const b = new Belt(600, 10);
  assert.ok(Math.abs(b.spacing - 600 / VISIBLE_SLOTS) < 1e-9, '超过一屏后间距固定为 600/7');
  assert.ok(Math.abs(b.length - b.spacing * 10) < 1e-9, '带长 = 盘位数 × 间距');
  assert.ok(b.length > 600, '10 个盘位时带长应超过一屏');

  let visible = 0;
  for (let i = 0; i < 10; i++) if (b.isVisible(i)) visible++;
  assert.strictEqual(visible, VISIBLE_SLOTS, `一屏应正好看到 ${VISIBLE_SLOTS} 个槽位`);

  // 转动过程中可见数量应保持恒定（不会一会儿多一会儿少）
  for (let k = 1; k <= 40; k++) {
    b.offset = k * 20;
    let v = 0;
    for (let i = 0; i < 10; i++) if (b.isVisible(i)) v++;
    assert.strictEqual(v, VISIBLE_SLOTS, `offset=${b.offset} 时可见槽位数应仍为 ${VISIBLE_SLOTS}`);
  }
}

// ---------- Belt：advance 累计 offset 并统计整圈数 ----------
{
  const b = new Belt(600, 6);
  assert.strictEqual(b.advance(b.length / BELT_SPEED), 1, '跑满一圈应返回 1');
  assert.strictEqual(b.cycles, 1, 'cycles 应累计到 1');
  assert.ok(Math.abs(b.offset) < 1e-6, '跑满一圈后 offset 应归零');
}

// ---------- Belt：空转圈数判定 ----------
// 规则：一圈内一颗都没吸到 → idleCycles+1；吸到过 → 归零。
{
  const b = new Belt(600, 6);
  const lap = b.length / BELT_SPEED;
  for (let i = 0; i < BELT_IDLE_CYCLES; i++) b.advance(lap);
  assert.strictEqual(b.idleCycles, BELT_IDLE_CYCLES, `连续空转 ${BELT_IDLE_CYCLES} 圈应累计`);

  b.markAbsorbed();
  assert.strictEqual(b.idleCycles, 0, 'markAbsorbed 应立即清零空转计数');
  b.advance(lap);
  assert.strictEqual(b.idleCycles, 0, '有吸到沙的那一圈不应算空转');
  b.advance(lap);
  assert.strictEqual(b.idleCycles, 1, '接下来空转的一圈才应计入');
}

// ---------- Belt：nearestEmpty 只考虑【屏幕上可见】的空槽位 ----------
{
  const b = new Belt(600, 6);          // 槽位在 0,100,200,300,400,500
  assert.strictEqual(b.nearestEmpty(520), 5, '离 520 最近的是槽位 5（x=500）');
  assert.strictEqual(b.nearestEmpty(0), 0, '离 0 最近的是槽位 0');

  // 10 个盘位时只有 7 个可见，屏幕外的空位不能放（玩家看不到，放了会莫名其妙）
  const b10 = new Belt(600, 10);
  for (let i = 0; i < VISIBLE_SLOTS; i++) b10.slots[i] = { color: C_RED };
  assert.strictEqual(b10.nearestEmpty(300), -1, '只剩屏幕外的空位时应返回 -1');

  // 空出一个可见位就应该能放
  b10.slots[3] = null;
  assert.strictEqual(b10.nearestEmpty(300), 3, '空出可见位后应能放进去');
}

// ---------- Belt：slotColumns —— 屏幕外的槽位返回空列区间 ----------
{
  const b = new Belt(600, 6);
  const cellPx = 2;
  const [c0, c1] = b.slotColumns(4, cellPx);          // 槽位 4 在 x=400
  assert.strictEqual(c0, Math.floor((400 - ABSORB_TOL) / cellPx), '左边界应含容差');
  assert.strictEqual(c1, Math.ceil((400 + ABSORB_TOL) / cellPx), '右边界应含容差');

  const [e0, e1] = b.slotColumns(0, cellPx);          // 槽位 0 在 x=0，靠左端
  assert.strictEqual(e0, 0, '左端槽位的列区间不应为负');
  assert.ok(e1 <= Math.round(SAND_W / cellPx), '列区间不应超出沙盘宽度');

  // 屏幕外的槽位：没有沙盘在下面，吸不到任何东西
  const b10 = new Belt(600, 10);
  assert.deepStrictEqual(b10.slotColumns(9, cellPx), [0, 0], '屏幕外的槽位应返回空列区间');
}

// ---------- Belt：colorSlots 按颜色找槽位 ----------
{
  const b = new Belt(600, 6);
  b.slots[1] = { color: C_BLUE };
  b.slots[4] = { color: C_BLUE };
  b.slots[3] = { color: C_GREEN };
  assert.deepStrictEqual(b.colorSlots(C_BLUE), [1, 4], '应返回该色占用的全部槽位');
  assert.deepStrictEqual(b.colorSlots(C_GREEN), [3], '单槽位也应正确返回');
  assert.deepStrictEqual(b.colorSlots(C_RED), [], '没有该色时应返回空数组');
}

// ---------- Belt：setSlotCount 保住盘子、等间距摊开、并重算带长 ----------
{
  const b = new Belt(600, 6);
  b.slots[0] = { color: C_RED };
  b.slots[2] = { color: C_BLUE };
  b.slots[5] = { color: C_GREEN };

  b.setSlotCount(10);
  assert.strictEqual(b.n, 10, '槽位数应改为 10');
  assert.ok(Math.abs(b.spacing - 600 / VISIBLE_SLOTS) < 1e-9, '间距应重算为 600/7');
  assert.ok(Math.abs(b.length - b.spacing * 10) < 1e-9, '带长应重算');
  assert.strictEqual(b.slots.length, 10, '槽位数组长度应跟着变');
  assert.deepStrictEqual(b.slots.filter(Boolean).map(p => p.color), [C_RED, C_BLUE, C_GREEN],
    '已有盘子应按原顺序保留，一个都不能丢');
  assert.strictEqual(b.count(), 3, '盘子总数不变');

  // 摊开：3 个盘子不应挤在相邻槽位
  const used = b.slots.map((p, i) => p ? i : -1).filter(i => i >= 0);
  assert.ok(used[1] - used[0] >= 2 && used[2] - used[1] >= 2,
    `3 个盘子应摊开而不是挤在一起，实际落在槽位 ${used.join(',')}`);

  // 装不下时不缩，避免丢盘子
  b.setSlotCount(2);
  assert.strictEqual(b.n, 10, '目标槽位数装不下现有盘子时应拒绝');
  assert.strictEqual(b.count(), 3, '拒绝后盘子仍在');
}

// ---------- distributeToQueues：同色不应在一列里连成一片 ----------
// 旧实现是"按颜色排序后连续分块"，每列就是一个连续色段（实测第 5 列整列 12 个全同色），
// 玩家能背出"红色在第 3 列"，可玩性低。现在改成按颜色轮流取。
// 注意不能断言"最长连续段"——最后剩余的大颜色组会落在序列尾部（实测尾部 8 个同色），
// 所以改断言"色段总数"，它才反映整体打散程度。
{
  const counts = new Array(11).fill(0);
  for (let c = 0; c < 11; c++) counts[c] = 6000;   // 每色 3 盘
  const plates = splitPlates(counts);
  const q = distributeToQueues(plates, MAX_QUEUE_COLS);

  let runs = 0;
  for (const col of q) {
    if (col.length === 0) continue;
    runs++;
    for (let k = 1; k < col.length; k++) if (col[k].color !== col[k - 1].color) runs++;
  }
  assert.ok(runs >= plates.length * 0.6,
    `色段总数应 >= 盘子数的 60%（说明同色已打散），实测 ${runs}/${plates.length}`);
}

// ---------- distributeToQueues：颜色顺序随机，不应每次都从同一个色开头 ----------
{
  const counts = new Array(11).fill(0);
  for (let c = 0; c < 11; c++) counts[c] = 6000;
  const plates = splitPlates(counts);
  const heads = new Set();
  for (let k = 0; k < 20; k++) heads.add(distributeToQueues(plates, MAX_QUEUE_COLS)[0][0].color);
  assert.ok(heads.size >= 5,
    `首列第一个盘子不应总是同一个颜色，实测 20 次里出现 ${heads.size} 种`);
}

console.log('全部断言通过');
