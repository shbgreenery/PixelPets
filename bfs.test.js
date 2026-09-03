'use strict';

// 单测：锁定 BFS 类的 8 方向最短路、食物源点、markBlank / tracePath / take / hasAnimals 语义
const assert = require('assert');
const { BFS } = require('./bfs.js');

// 3x3 棋盘，2 种颜色，1 行空白通道，盘子在第 1 列
//   row0: 0 1 0
//   row1: 1 0 1
//   row2: 0 1 0
const ROWS = 3, COLS = 3, BLANK_ROWS = 1, NUM_COLORS = 2, PLATE_COL = 1;
const grid = [
  [0, 1, 0],
  [1, 0, 1],
  [0, 1, 0],
];

// --- 初始扩散：源点 (ROWS+BLANK_ROWS, plateCol)，通道与最底行可达 ---
const bfs = new BFS(grid, ROWS, COLS, BLANK_ROWS, NUM_COLORS, PLATE_COL);

assert.strictEqual(bfs.hasAnimals(0), true, '颜色0 应有可达动物');
assert.strictEqual(bfs.hasAnimals(1), true, '颜色1 应有可达动物');
assert.strictEqual(bfs.take(0, 99).length, 2, '颜色0 应有 2 只（行2 两格）');
assert.strictEqual(bfs.take(0, 99).length, 0, '颜色0 取空后应为空');
assert.strictEqual(bfs.hasAnimals(0), false, '颜色0 取空后 hasAnimals 应为 false');

// --- tracePath：从动物回溯到食物源点，终点行 = ROWS + BLANK_ROWS、列 = plateCol ---
const bfs2 = new BFS(grid, ROWS, COLS, BLANK_ROWS, NUM_COLORS, PLATE_COL);
const path = bfs2.tracePath(2, 1);
assert.deepStrictEqual(path[0], { row: 2, col: 1 }, '路径起点应是动物自身');
assert.strictEqual(path[path.length - 1].row, ROWS + BLANK_ROWS, '路径终点应在食物源点行');
assert.strictEqual(path[path.length - 1].col, PLATE_COL, '路径终点应在盘列');

// --- markBlank：某格变空白后，向上一行继续扩散 ---
grid[2][1] = -1;               // 行2 中间动物离开，格子变空白
bfs2.markBlank(2, 1);
const p2 = bfs2.tracePath(1, 0);
assert.deepStrictEqual(p2[0], { row: 1, col: 0 }, 'markBlank 后应能回溯到上一行');
assert.strictEqual(p2[p2.length - 1].row, ROWS + BLANK_ROWS, 'markBlank 后路径终点仍在源点行');

// --- 回归：动物离场（grid 变 -1）后，take/hasAnimals 不应返回幽灵动物 ---
const g2 = [
  [0, 0, 0],
  [0, 0, 0],
  [0, 1, 0],
];
const bfs3 = new BFS(g2, ROWS, COLS, BLANK_ROWS, NUM_COLORS, PLATE_COL);
assert.strictEqual(bfs3.hasAnimals(1), true, '离场前颜色1 应有动物');
g2[2][1] = -1;          // 唯一一只颜色1 动物离场
bfs3.markBlank(2, 1);
assert.strictEqual(bfs3.hasAnimals(1), false, '离场后 hasAnimals(1) 应为 false');
assert.strictEqual(bfs3.take(1, 99).length, 0, '离场后 take(1) 应为空');

// --- 回归：markBlank 后距离应正确松弛为真实最短路，而非归零 ---
const g3 = [
  [0, 0, 0],
  [0, 0, 0],
  [0, 0, 0],
];
const bfs4 = new BFS(g3, ROWS, COLS, BLANK_ROWS, NUM_COLORS, PLATE_COL);
g3[2][0] = -1;          // 行2 左侧动物离场，格子变空白
bfs4.markBlank(2, 0);
// (1,0) 经 (2,0)→通道(3,0)→源点(4,1)，真实最短距离应为 3；旧实现 markBlank 归零会错记为 1
const t4 = bfs4.take(0, 99);
const a10 = t4.find(a => a.row === 1 && a.col === 0);
assert.strictEqual(a10.distance, 3, 'markBlank 后距离应为真实最短路 3，而非 1');

console.log('全部断言通过');