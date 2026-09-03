'use strict';

// ============ BFS 最短路径扩散（Dijkstra 松弛版） ============
// 从某个食物位置（盘列）出发，8 方向逆向扩散，维护每个可达格子到食物的最短距离
// 与回溯路径，并按颜色收集可达动物。纯逻辑，不依赖 Phaser / DOM。
//
// 与普通 BFS 的关键区别：格子会随时间变成空白，从而开出更短的路径。因此这里
// 用最小堆做 Dijkstra 松弛——距离默认无穷，发现更小距离就更新 parent 并重新入堆，
// 而不是「第一次访问就锁死」。

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
      for (const [dr, dc] of [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]]) {
        const nr = row + dr, nc = col + dc;
        if (this.cellAt(nr, nc) === null) continue;
        this.relax(nr, nc, d + 1, row, col);
      }
    }
  }

  // 某格子变为空白后：重算其到食物的正确距离，并向外重新松弛
  markBlank(row, col) {
    const key = `${row},${col}`;
    // 新距离 = 所有可穿越邻居（空白格/通道）的最短距离 + 1
    let bestD = Infinity, bestP = null;
    for (const [dr, dc] of [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]]) {
      const nr = row + dr, nc = col + dc;
      if (this.cellAt(nr, nc) !== -1) continue; // 只有空白/通道邻居可穿越
      const nd = this.dist.get(`${nr},${nc}`);
      if (nd !== undefined && nd + 1 < bestD) {
        bestD = nd + 1;
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
