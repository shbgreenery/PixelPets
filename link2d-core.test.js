'use strict';
const assert = require('assert');
const { Link2D } = require('./link2d-core.js');

// 图案成对性：每种图案恰好出现 4 次
const g = new Link2D(4, 4);
assert.strictEqual(g.rows, 4);
assert.strictEqual(g.cols, 4);
assert.strictEqual(g.remaining, 16, '4x4 应有 16 个方块');
const cnt = {};
for (let y = 0; y < 4; y++)
  for (let x = 0; x < 4; x++) {
    const t = g.grid[y][x];
    assert.ok(t >= 1 && t <= 4, '图案 id 应在 [1,4]');
    cnt[t] = (cnt[t] || 0) + 1;
  }
for (const t in cnt) assert.strictEqual(cnt[t], 4, `图案 ${t} 应出现 4 次`);

// --- isEmpty：边界层可走，空位可走 ---
const e = new Link2D(4, 4);
for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) e.grid[y][x] = 0;
e.grid[1][1] = 5;
assert.strictEqual(e.isEmpty(1, 1), false, '有方块位置不可走');
assert.strictEqual(e.isEmpty(1, 2), true, '空位可走');
assert.strictEqual(e.isEmpty(-1, 1), true, '越界可走');
assert.strictEqual(e.isEmpty(1, -1), true, '越界可走');
assert.strictEqual(e.isEmpty(4, 1), true, 'rows 处越界可走');

// --- lineClear：同轴直线、中间无障碍 ---
e.grid[1][2] = 9;
assert.strictEqual(e.lineClear({ x: 1, y: 1 }, { x: 3, y: 1 }), false, '中间有障碍应不通');
e.grid[1][2] = 0;
assert.strictEqual(e.lineClear({ x: 1, y: 1 }, { x: 3, y: 1 }), true, '清空后直线应通');

// --- canConnect 0 拐 ---
const c0 = new Link2D(4, 4);
for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) c0.grid[y][x] = 0;
c0.grid[0][0] = 1; c0.grid[0][3] = 1;
assert.ok(c0.canConnect({ x: 0, y: 0 }, { x: 3, y: 0 }), '0 拐同轴直线应连通');

// --- canConnect 1 拐 ---
const c1 = new Link2D(4, 4);
for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) c1.grid[y][x] = 0;
c1.grid[0][0] = 2; c1.grid[2][1] = 2; // x、y 均不同，属 1 拐
assert.ok(c1.canConnect({ x: 0, y: 0 }, { x: 1, y: 2 }), '1 拐应连通');

// --- canConnect 2 拐（中间被挡，绕外部边界层） ---
const c2 = new Link2D(4, 4);
for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) c2.grid[y][x] = 0;
c2.grid[0][0] = 3; c2.grid[0][3] = 3;
c2.grid[0][1] = 9; c2.grid[0][2] = 9; // 挡住 0 拐直线
const p2 = c2.canConnect({ x: 0, y: 0 }, { x: 3, y: 0 });
assert.ok(p2, '0 拐被挡后 2 拐应绕外部边界层连通');
assert.ok(p2.length === 4, '2 拐路径应有 4 个关键点');
const inB = (p, r, c) => p.x >= 0 && p.x < c && p.y >= 0 && p.y < r;
assert.ok(!inB(p2[1], 4, 4) || !inB(p2[2], 4, 4), '2 拐绕外部路径的拐点应经过边界层');

// --- canConnect 图案不同或位置为空应返回 null ---
assert.strictEqual(c2.canConnect({ x: 0, y: 0 }, { x: 0, y: 2 }), null, '空位不可消');
const c3 = new Link2D(4, 4);
for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) c3.grid[y][x] = 0;
c3.grid[0][0] = 1; c3.grid[0][3] = 2;
assert.strictEqual(c3.canConnect({ x: 0, y: 0 }, { x: 3, y: 0 }), null, '图案不同不可消');

console.log('Task 1 断言通过');

// --- Task 3 测试：物效 applyEffect ---
// 构造辅助：空棋盘 + 指定位置的方块
function mkGrid(rows, cols, cells) {
  const g = new Link2D(rows, cols);
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) g.grid[y][x] = 0;
  for (const { x, y, t } of cells) g.grid[y][x] = t;
  return g;
}
// 断言某位置方块类型
const at = (g, x, y) => g.grid[y][x];

// --- up：每列向上沉，空位沉列底 ---
let gu = mkGrid(3, 3, [{ x: 0, y: 1, t: 1 }, { x: 0, y: 2, t: 2 }]);
gu.applyEffect('up');
assert.strictEqual(at(gu, 0, 0), 1, 'up 后原 (0,1) 方块应浮到 (0,0)');
assert.strictEqual(at(gu, 0, 1), 2, 'up 后原 (0,2) 方块应浮到 (0,1)');
assert.strictEqual(at(gu, 0, 2), 0, 'up 后列底应为空');

// --- down：每列向下沉 ---
let gd = mkGrid(3, 3, [{ x: 0, y: 0, t: 1 }, { x: 0, y: 1, t: 2 }]);
gd.applyEffect('down');
assert.strictEqual(at(gd, 0, 2), 2, 'down 后原 (0,1) 方块应沉到 (0,2)');
assert.strictEqual(at(gd, 0, 1), 1, 'down 后原 (0,0) 方块应沉到 (0,1)');
assert.strictEqual(at(gd, 0, 0), 0, 'down 后列顶应为空');

// --- left：每行向左沉 ---
let gl = mkGrid(3, 3, [{ x: 1, y: 0, t: 1 }, { x: 2, y: 0, t: 2 }]);
gl.applyEffect('left');
assert.strictEqual(at(gl, 0, 0), 1, 'left 后原 (1,0) 方块应靠到 (0,0)');
assert.strictEqual(at(gl, 1, 0), 2, 'left 后原 (2,0) 方块应靠到 (1,0)');
assert.strictEqual(at(gl, 2, 0), 0, 'left 后行右应为空');

// --- right：每行向右沉 ---
let gr = mkGrid(3, 3, [{ x: 0, y: 0, t: 1 }, { x: 1, y: 0, t: 2 }]);
gr.applyEffect('right');
assert.strictEqual(at(gr, 2, 0), 2, 'right 后原 (1,0) 方块应靠到 (2,0)');
assert.strictEqual(at(gr, 1, 0), 1, 'right 后原 (0,0) 方块应靠到 (1,0)');
assert.strictEqual(at(gr, 0, 0), 0, 'right 后行左应为空');

// --- lr-spread：左半向左沉、右半向右沉，空位向中间列 ---
let gs = mkGrid(2, 4, [{ x: 1, y: 0, t: 1 }, { x: 2, y: 0, t: 2 }]);
gs.applyEffect('lr-spread');
assert.strictEqual(at(gs, 0, 0), 1, 'lr-spread 后左半方块应靠到最左');
assert.strictEqual(at(gs, 3, 0), 2, 'lr-spread 后右半方块应靠到最右');
assert.strictEqual(at(gs, 1, 0), 0, 'lr-spread 后中间应空');

// --- ud-spread：上半向上沉、下半向下沉 ---
let gu2 = mkGrid(4, 2, [{ x: 0, y: 1, t: 1 }, { x: 0, y: 2, t: 2 }]);
gu2.applyEffect('ud-spread');
assert.strictEqual(at(gu2, 0, 0), 1, 'ud-spread 后上半方块应靠到最上');
assert.strictEqual(at(gu2, 0, 3), 2, 'ud-spread 后下半方块应靠到最下');
assert.strictEqual(at(gu2, 0, 1), 0, 'ud-spread 后中间应空');

// --- scatter：左右分散后再上下分散，空位向中心 ---
let gc = mkGrid(4, 4, [{ x: 0, y: 0, t: 1 }, { x: 3, y: 3, t: 2 }]);
gc.applyEffect('scatter');
assert.strictEqual(at(gc, 0, 0), 1, 'scatter 后左上角方块应保持或贴左上角');
assert.strictEqual(at(gc, 3, 3), 2, 'scatter 后右下角方块应保持或贴右下角');

// --- gather：向中心聚拢，空位向四周 ---
let gg = mkGrid(4, 4, [{ x: 0, y: 0, t: 1 }, { x: 3, y: 3, t: 2 }]);
gg.applyEffect('gather');
const gcount = (() => { let n = 0; for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) if (gg.grid[y][x] > 0) n++; return n; })();
assert.strictEqual(gcount, 2, 'gather 后方块总数不变');

// scatter 补强：非角方块应向四周散开（向对应角靠拢）
let gc2 = mkGrid(4, 4, [{ x: 1, y: 1, t: 5 }]);
gc2.applyEffect('scatter');
assert.strictEqual(at(gc2, 0, 0), 5, 'scatter 后 (1,1) 方块应散到左上角 (0,0)');

// gather 补强：角方块应向中心聚拢
let gg2 = mkGrid(4, 4, [{ x: 0, y: 0, t: 6 }]);
gg2.applyEffect('gather');
assert.strictEqual(at(gg2, 1, 1), 6, 'gather 后 (0,0) 方块应聚到中心区 (1,1)');

// --- none：不改写 grid，返回空数组 ---
let gn = mkGrid(3, 3, [{ x: 0, y: 0, t: 1 }]);
const nmoves = gn.applyEffect('none');
assert.strictEqual(nmoves.length, 0, 'none 应返回空移动数组');
assert.strictEqual(at(gn, 0, 0), 1, 'none 不改写 grid');

// --- 移动映射：up 返回 from/to 正确 ---
let gm = mkGrid(3, 3, [{ x: 0, y: 2, t: 7 }]);
const mv = gm.applyEffect('up');
assert.strictEqual(mv.length, 1, 'up 应记录一次移动');
assert.deepStrictEqual(mv[0], { from: { x: 0, y: 2 }, to: { x: 0, y: 0 } }, '移动映射 from/to 正确');

// --- findPair / hasPair / eliminate / shuffle ---
const f = new Link2D(4, 4);
assert.strictEqual(f.hasPair(), true, '满棋盘应有可消对');
const pair = f.findPair();
assert.ok(pair && pair.a && pair.b && pair.path, 'findPair 返回 { a, b, path }');
assert.ok(Array.isArray(pair.path) && pair.path.length >= 2, 'path 应为关键点数组');
assert.strictEqual(f.grid[pair.a.y][pair.a.x], f.grid[pair.b.y][pair.b.x], '寻到的对图案应相同');

const before = f.remaining;
f.eliminate(pair.a, pair.b);
assert.strictEqual(f.remaining, before - 2, '消除后剩余数减 2');
assert.strictEqual(f.isEmpty(pair.a.x, pair.a.y), true, '消除后位置变空');
assert.strictEqual(f.isEmpty(pair.b.x, pair.b.y), true, '消除后位置变空');

// --- shuffle 保持方块总数与偶数次 ---
const s = new Link2D(4, 4);
for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) s.grid[y][x] = 0;
s.grid[0][0] = 1; s.grid[0][1] = 1; s.grid[0][2] = 2; s.grid[0][3] = 2;
s.remaining = 4;
s.shuffle();
let total = 0; const scnt = {};
for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
  const t = s.grid[y][x];
  if (t > 0) { total++; scnt[t] = (scnt[t] || 0) + 1; }
}
assert.strictEqual(total, 4, '洗牌后方块总数不变');
for (const t in scnt) assert.strictEqual(scnt[t] % 2, 0, '洗牌后每种图案仍偶数次');

console.log('Task 4 断言通过');

console.log('Task 3 断言通过');
console.log('Task 2 断言通过');
