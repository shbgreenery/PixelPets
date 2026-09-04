'use strict';

// ============ BFS 最短路径扩散（Dijkstra 松弛版） ============
// 从某个食物位置（盘列）出发，8 方向逆向扩散，维护每个可达格子到食物的最短距离
// 与回溯路径，并按颜色收集可达动物。纯逻辑，不依赖 Phaser / DOM。
//
// 与普通 BFS 的关键区别：格子会随时间变成空白，从而开出更短的路径。因此这里
// 用最小堆做 Dijkstra 松弛——距离默认无穷，发现更小距离就更新 parent 并重新入堆，
// 而不是「第一次访问就锁死」。

// 8 个方向：上下左右 + 四个对角
const DIRS = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
// 移动代价：直走 1，斜走 √2（约 1.414）。斜走更贵，让最短路优先走直线
const stepCost = (dr, dc) => (dr !== 0 && dc !== 0) ? Math.SQRT2 : 1;

// 最小二叉堆，元素 { row, col, d }，按 d 升序
class MinHeap {
  constructor() {
    this.a = [];
  }
  size() {
    return this.a.length;
  }
  push(node) {
    const a = this.a;
    a.push(node);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].d <= a[i].d) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop() {
    const a = this.a;
    const top = a[0];
    const last = a.pop();
    if (a.length > 0) {
      a[0] = last;
      let i = 0;
      while (true) {
        const l = 2 * i + 1, r = 2 * i + 2;
        let m = i;
        if (l < a.length && a[l].d < a[m].d) m = l;
        if (r < a.length && a[r].d < a[m].d) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m], a[i]];
        i = m;
      }
    }
    return top;
  }
}

class BFS {
  constructor(grid, ROWS, COLS, BLANK_ROWS, numColors, plateCol) {
    this.grid = grid;
    this.ROWS = ROWS;
    this.COLS = COLS;
    this.BLANK_ROWS = BLANK_ROWS;
    this.plateCol = plateCol;
    this.dist = new Map();       // "r,c" -> 到食物的最短距离（缺省视为 Infinity）
    this.parent = new Map();     // "r,c" -> { row, col }
    this.heap = new MinHeap();
    this.queues = Array(numColors).fill(null).map(() => []); // 颜色 -> 可达动物位置
    this.queued = new Set();     // 已入队动物格，防止重复

    // 食物源点：最底行（ROWS + BLANK_ROWS）的盘列，距离 0
    const sr = ROWS + BLANK_ROWS, sc = plateCol;
    this.dist.set(`${sr},${sc}`, 0);
    this.heap.push({ row: sr, col: sc, d: 0 });
    this.expand();
  }

  // 返回 (nr,nc) 的格子值：动物格返回颜色，空白通道返回 -1，越界或源点行返回 null
  cellAt(nr, nc) {
    if (nr < 0 || nc < 0 || nc >= this.COLS) return null;
    if (nr >= this.ROWS + this.BLANK_ROWS) return null; // 源点行及以下，仅源点自身可达
    if (nr >= this.ROWS) return -1;   // 空白通道，全程可走
    return this.grid[nr][nc];
  }

  // 从 (fromRow,fromCol) 松弛邻居 (nr,nc)：若 nd 更短则更新 dist/parent
  relax(nr, nc, nd, fromRow, fromCol) {
    const key = `${nr},${nc}`;
    const old = this.dist.get(key);
    if (old !== undefined && old <= nd) return; // 无改进
    this.dist.set(key, nd);
    this.parent.set(key, { row: fromRow, col: fromCol });
    const cell = this.cellAt(nr, nc);
    if (cell === -1) {
      // 空白格：可穿越，继续扩散
      this.heap.push({ row: nr, col: nc, d: nd });
    } else if (cell >= 0 && cell < this.queues.length) {
      // 动物格：入队（仅首次），距离后续在 take 时按 dist 实时读取
      if (!this.queued.has(key)) {
        this.queued.add(key);
        this.queues[cell].push({ row: nr, col: nc });
      }
    }
  }

  expand() {
    while (this.heap.size() > 0) {
      const { row, col, d } = this.heap.pop();
      if (this.dist.get(`${row},${col}`) !== d) continue; // 过期堆条目
      for (const [dr, dc] of DIRS) {
        const nr = row + dr, nc = col + dc;
        if (this.cellAt(nr, nc) === null) continue;
        this.relax(nr, nc, d + stepCost(dr, dc), row, col);
      }
    }
  }

  // 某格子变为空白后：重算其到食物的正确距离，并向外重新松弛
  markBlank(row, col) {
    const key = `${row},${col}`;
    // 新距离 = 所有可穿越邻居（空白格/通道）的最短距离 + 一步代价
    let bestD = Infinity, bestP = null;
    for (const [dr, dc] of DIRS) {
      const nr = row + dr, nc = col + dc;
      if (this.cellAt(nr, nc) !== -1) continue; // 只有空白/通道邻居可穿越
      const nd = this.dist.get(`${nr},${nc}`);
      if (nd !== undefined && nd + stepCost(dr, dc) < bestD) {
        bestD = nd + stepCost(dr, dc);
        bestP = { row: nr, col: nc };
      }
    }
    if (bestP === null) return; // 无可穿越邻居，孤立空白格
    this.dist.set(key, bestD);
    this.parent.set(key, bestP);
    this.heap.push({ row, col, d: bestD });
    this.expand();
  }

  // 回溯从动物到食物的完整路径，终点即源点
  tracePath(animalRow, animalCol) {
    const path = [];
    let current = { row: animalRow, col: animalCol };
    while (this.parent.has(`${current.row},${current.col}`)) {
      path.push({ row: current.row, col: current.col });
      current = this.parent.get(`${current.row},${current.col}`);
    }
    path.push({ row: current.row, col: current.col });
    return path;
  }

  // 从 (r0,c0) 到 (r1,c1) 的直线段是否只穿过空白格（不含动物格）
  lineClear(r0, c0, r1, c1) {
    const dr = r1 - r0, dc = c1 - c0;
    const dist = Math.hypot(dr, dc);
    if (dist < 0.001) return true;
    const N = Math.max(1, Math.ceil(dist * 2));
    for (let k = 1; k < N; k++) {
      const rr = Math.round(r0 + dr * k / N);
      const cc = Math.round(c0 + dc * k / N);
      if (rr === r0 && cc === c0) continue;
      if (rr === r1 && cc === c1) continue;
      const cell = this.cellAt(rr, cc);
      if (cell !== null && cell !== -1) return false; // 撞到动物格
    }
    return true;
  }

  // 字符串拉紧：贪心删掉能被直线替换的中间拐点
  smoothPath(path) {
    if (path.length <= 2) return path;
    const out = [path[0]];
    let i = 0;
    while (i < path.length - 1) {
      let j = path.length - 1;
      while (j > i + 1 && !this.lineClear(path[i].row, path[i].col, path[j].row, path[j].col)) {
        j--;
      }
      out.push(path[j]);
      i = j;
    }
    return out;
  }

  // 从某颜色队列取走至多 n 只仍在场的动物，距离按 dist 实时读取
  take(color, n) {
    const q = this.queues[color];
    const result = [];
    while (result.length < n && q.length > 0) {
      const a = q.shift();
      if (this.grid[a.row][a.col] === color) {
        result.push({ row: a.row, col: a.col, distance: this.dist.get(`${a.row},${a.col}`) });
      }
    }
    return result;
  }

  // 某颜色是否还有仍在场的可达动物
  hasAnimals(color) {
    return this.queues[color].some(a => this.grid[a.row][a.col] === color);
  }
}

if (typeof module !== 'undefined') module.exports = { BFS };
