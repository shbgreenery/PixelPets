'use strict';

// ============ BFS 最短路径扩散 ============
// 从某个食物位置（盘列）出发，8 方向逆向扩散，维护每个可达格子到食物的切比雪夫距离
// 与回溯路径，并按颜色收集可达动物。纯逻辑，不依赖 Phaser / DOM。
class BFS {
  constructor(grid, ROWS, COLS, BLANK_ROWS, numColors, plateCol) {
    this.grid = grid;
    this.ROWS = ROWS;
    this.COLS = COLS;
    this.BLANK_ROWS = BLANK_ROWS;
    this.plateCol = plateCol;
    this.dist = new Map();       // "r,c" -> 到食物的切比雪夫距离
    this.parent = new Map();     // "r,c" -> { row, col }
    this.frontier = [];
    this.queues = Array(numColors).fill(null).map(() => []); // 颜色 -> 可达动物

    // 食物源点：最底行（ROWS + BLANK_ROWS）的盘列，距离 0
    this.dist.set(`${ROWS + BLANK_ROWS},${plateCol}`, 0);
    this.frontier.push({ row: ROWS + BLANK_ROWS, col: plateCol });
    this.expand();
  }

  // 返回 (nr,nc) 的格子值：动物格返回颜色，空白通道返回 -1，越界或源点行返回 null
  cellAt(nr, nc) {
    if (nr < 0 || nc < 0 || nc >= this.COLS) return null;
    if (nr >= this.ROWS + this.BLANK_ROWS) return null; // 源点行及以下，仅源点自身可达
    if (nr >= this.ROWS) return -1;   // 空白通道，全程可走
    return this.grid[nr][nc];
  }

  expand() {
    while (this.frontier.length > 0) {
      const { row, col } = this.frontier.shift();
      const curDist = this.dist.get(`${row},${col}`);
      for (const [dr, dc] of [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]]) {
        const nr = row + dr, nc = col + dc;
        const cell = this.cellAt(nr, nc);
        if (cell === null) continue;
        const key = `${nr},${nc}`;
        if (this.dist.has(key)) continue;
        this.dist.set(key, curDist + 1);
        this.parent.set(key, { row, col });
        if (cell === -1) this.frontier.push({ row: nr, col: nc });
        else if (cell >= 0 && cell < this.queues.length) this.queues[cell].push({ row: nr, col: nc, distance: curDist + 1 });
      }
    }
  }

  // 某格子变为空白后，从它重新扩散
  markBlank(row, col) {
    this.dist.set(`${row},${col}`, 0);
    this.frontier.push({ row, col });
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

  // 从某颜色队列取走至多 n 只仍在场的动物（过滤掉已离场的幽灵条目）
  take(color, n) {
    const q = this.queues[color];
    const result = [];
    while (result.length < n && q.length > 0) {
      const a = q.shift();
      if (this.grid[a.row][a.col] === color) result.push(a);
    }
    return result;
  }

  // 某颜色是否还有仍在场的可达动物
  hasAnimals(color) {
    return this.queues[color].some(a => this.grid[a.row][a.col] === color);
  }
}

if (typeof module !== 'undefined') module.exports = { BFS };