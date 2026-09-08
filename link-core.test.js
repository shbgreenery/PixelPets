'use strict';
const assert = require('assert');
const { CubeLink } = require('./link-core.js');

// --- 生成成对性：每种图案出现偶数次 ---
const c = new CubeLink(4, 12);
assert.strictEqual(c.remaining, 64, '4x4x4 应有 64 体素');
const count = {};
for (let x = 0; x < 4; x++)
  for (let y = 0; y < 4; y++)
    for (let z = 0; z < 4; z++) {
      const t = c.grid[x][y][z];
      assert.ok(t > 0 && t <= 12, '图案 id 应在 [1,12]');
      count[t] = (count[t] || 0) + 1;
    }
for (const t in count) assert.strictEqual(count[t] % 2, 0, `图案 ${t} 应为偶数次`);

// --- isEmpty：边界层可走，被挖空体素可走 ---
for (let x = 0; x < 4; x++) for (let y = 0; y < 4; y++) for (let z = 0; z < 4; z++) c.grid[x][y][z] = 0;
c.grid[1][1][1] = 5;
assert.strictEqual(c.isEmpty(1, 1, 1), false, '有体素位置不可走');
assert.strictEqual(c.isEmpty(1, 1, 2), true, '空位可走');
assert.strictEqual(c.isEmpty(-1, 1, 1), true, '边界外可走');
assert.strictEqual(c.isEmpty(4, 1, 1), true, 'N 处边界外可走');

// --- lineClear：同轴直线、中间无障碍 ---
c.grid[2][1][1] = 9; // 挡住
assert.strictEqual(c.lineClear({ x: 1, y: 1, z: 1 }, { x: 3, y: 1, z: 1 }), false, '中间有障碍应不通');
c.grid[2][1][1] = 0;
assert.strictEqual(c.lineClear({ x: 1, y: 1, z: 1 }, { x: 3, y: 1, z: 1 }), true, '清空后直线应通');

// --- canConnect 0 拐 ---
const c0 = new CubeLink(4, 3);
for (let x = 0; x < 4; x++) for (let y = 0; y < 4; y++) for (let z = 0; z < 4; z++) c0.grid[x][y][z] = 0;
c0.grid[0][0][0] = 1; c0.grid[3][0][0] = 1;
assert.ok(c0.canConnect({ x: 0, y: 0, z: 0 }, { x: 3, y: 0, z: 0 }), '0 拐同轴直线应连通');
c0.grid[1][0][0] = 7; // 中间放障碍
// 0 拐被挡后应能绕外部 2 拐（引入 y 维度，经边界层 r=-1 或 r=N 绕路）
const c0path = c0.canConnect({ x: 0, y: 0, z: 0 }, { x: 3, y: 0, z: 0 });
assert.ok(c0path, '0 拐被挡后 2 拐绕外部应可通');
assert.ok(c0path.length === 4, '2 拐路径应有 4 个关键点 [A, c1, c2, B]');
// 路径中间拐点应在边界层（某个分量 <0 或 >=N）
const inBounds = (p, N) => p.x >= 0 && p.x < N && p.y >= 0 && p.y < N && p.z >= 0 && p.z < N;
assert.ok(!inBounds(c0path[1], 4) || !inBounds(c0path[2], 4),
  '2 拐绕外部路径的拐点应经过边界层');

// --- canConnect 1 拐 ---
const c1 = new CubeLink(4, 3);
for (let x = 0; x < 4; x++) for (let y = 0; y < 4; y++) for (let z = 0; z < 4; z++) c1.grid[x][y][z] = 0;
c1.grid[0][0][0] = 2; c1.grid[2][1][0] = 2; // x、y 均不同，z 相同，属 1 拐
assert.ok(c1.canConnect({ x: 0, y: 0, z: 0 }, { x: 2, y: 1, z: 0 }), '1 拐应连通');

// --- canConnect 2 拐退化（平面） ---
const c2 = new CubeLink(4, 3);
for (let x = 0; x < 4; x++) for (let y = 0; y < 4; y++) for (let z = 0; z < 4; z++) c2.grid[x][y][z] = 0;
c2.grid[0][0][0] = 3; c2.grid[2][2][0] = 3; // x、y 均不同，z 同
c2.grid[2][0][0] = 9; c2.grid[0][2][0] = 9; // 堵死 1 拐两拐点，迫使 2 拐绕中间行
assert.ok(c2.canConnect({ x: 0, y: 0, z: 0 }, { x: 2, y: 2, z: 0 }), '2 拐退化经中间行应连通');

// --- canConnect 2 拐一般（三维） ---
const c3 = new CubeLink(4, 3);
for (let x = 0; x < 4; x++) for (let y = 0; y < 4; y++) for (let z = 0; z < 4; z++) c3.grid[x][y][z] = 0;
c3.grid[0][0][0] = 4; c3.grid[3][3][3] = 4; // 三个分量都不同
assert.ok(c3.canConnect({ x: 0, y: 0, z: 0 }, { x: 3, y: 3, z: 3 }), '2 拐三维唯一拐点应连通');

// 封死 A 的三个相邻方向，2 拐无法走出
const c3b = new CubeLink(4, 3);
for (let x = 0; x < 4; x++) for (let y = 0; y < 4; y++) for (let z = 0; z < 4; z++) c3b.grid[x][y][z] = 0;
c3b.grid[0][0][0] = 4; c3b.grid[1][1][1] = 4;
c3b.grid[1][0][0] = 9; c3b.grid[0][1][0] = 9; c3b.grid[0][0][1] = 9;
assert.strictEqual(c3b.canConnect({ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 }), null, '2 拐三维三方向被封应不通');

// --- findPair / hasPair ---
const c4 = new CubeLink(4, 12);
assert.strictEqual(c4.hasPair(), true, '满棋盘应有可消对');
const pair = c4.findPair();
assert.ok(pair && pair.a && pair.b && pair.path, 'findPair 应返回 { a, b, path }');
assert.strictEqual(c4.grid[pair.a.x][pair.a.y][pair.a.z],
  c4.grid[pair.b.x][pair.b.y][pair.b.z], '寻到的对图案应相同');
assert.ok(Array.isArray(pair.path) && pair.path.length >= 2, 'path 应为关键点数组');

// --- eliminate ---
const before = c4.remaining;
c4.eliminate(pair.a, pair.b);
assert.strictEqual(c4.remaining, before - 2, '消除后剩余数减 2');
assert.strictEqual(c4.isEmpty(pair.a.x, pair.a.y, pair.a.z), true, '消除后位置变空');
assert.strictEqual(c4.isEmpty(pair.b.x, pair.b.y, pair.b.z), true, '消除后位置变空');

// --- shuffle 保持偶数次与剩余数 ---
const c5 = new CubeLink(4, 12);
for (let x = 0; x < 4; x++) for (let y = 0; y < 4; y++) for (let z = 0; z < 4; z++) c5.grid[x][y][z] = 0;
c5.grid[0][0][0] = 1; c5.grid[0][0][1] = 1; c5.grid[0][0][2] = 2; c5.grid[0][0][3] = 2;
c5.remaining = 4;
c5.shuffle();
let total = 0; const cnt = {};
for (let x = 0; x < 4; x++) for (let y = 0; y < 4; y++) for (let z = 0; z < 4; z++) {
  const t = c5.grid[x][y][z];
  if (t > 0) { total++; cnt[t] = (cnt[t] || 0) + 1; }
}
assert.strictEqual(total, 4, '洗牌后体素总数不变');
for (const t in cnt) assert.strictEqual(cnt[t] % 2, 0, '洗牌后每种图案仍偶数次');

console.log('Task 4 断言通过');

console.log('Task 3 断言通过');

console.log('Task 2 断言通过');

console.log('Task 1 断言通过');
