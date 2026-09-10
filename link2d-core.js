'use strict';

// 2D 连连看核心逻辑：图案生成、≤2 拐点折线判定、消除后物效重排、寻对与死局检测。
// 纯逻辑，不依赖 Phaser / DOM。判定使用扩展网格 [-1, rows] x [-1, cols]，
// 越界位置视为可走边界层（棋盘外一圈隐藏路径）。

// 洗牌工具：Fisher-Yates，就地打乱数组
function shuffleArr(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

class Link2D {
  constructor(rows, cols, rng = Math.random) {
    this.rows = rows;
    this.cols = cols;
    this.rng = rng;
    this.remaining = rows * cols;
    // grid[y][x]，0 空 / >0 图案 id
    this.grid = Array.from({ length: rows }, () => Array(cols).fill(0));
    // 每种图案出现 4 次，种类数 = 总格数 / 4
    const total = rows * cols;
    const typeCount = total / 4;
    const types = [];
    for (let t = 1; t <= typeCount; t++)
      for (let k = 0; k < 4; k++) types.push(t);
    shuffleArr(types, rng);
    let idx = 0;
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < cols; x++)
        this.grid[y][x] = types[idx++];
  }

  // 该坐标是否可走：越界（边界层）或空位
  isEmpty(x, y) {
    if (x < 0 || y < 0 || x >= this.cols || y >= this.rows) return true;
    return this.grid[y][x] === 0;
  }

  // a、b 在同一条轴对齐直线上时，中间格子是否全空（不含端点）
  lineClear(a, b) {
    if (a.x === b.x) {
      const lo = Math.min(a.y, b.y), hi = Math.max(a.y, b.y);
      for (let y = lo + 1; y < hi; y++) if (!this.isEmpty(a.x, y)) return false;
      return true;
    }
    if (a.y === b.y) {
      const lo = Math.min(a.x, b.x), hi = Math.max(a.x, b.x);
      for (let x = lo + 1; x < hi; x++) if (!this.isEmpty(x, a.y)) return false;
      return true;
    }
    return false;
  }

  // 判定 A、B 能否消除，返回路径关键点数组 [A, ...拐角..., B]，不可消返回 null。
  // 0 拐：同轴直线且中间全空；1 拐：枚举拐点 (a.x,b.y) 与 (b.x,a.y)；
  // 2 拐：枚举中间水平线 y∈[-1,rows] 与中间垂直线 x∈[-1,cols]。
  canConnect(a, b) {
    if (a.x === b.x && a.y === b.y) return null;
    if (this.grid[a.y][a.x] <= 0 || this.grid[b.y][b.x] <= 0) return null;
    if (this.grid[a.y][a.x] !== this.grid[b.y][b.x]) return null;

    // 0 拐
    if ((a.x === b.x || a.y === b.y) && this.lineClear(a, b)) return [a, b];

    // 1 拐：两个候选拐点
    const c1 = { x: a.x, y: b.y };
    if (this.isEmpty(c1.x, c1.y) && this.lineClear(a, c1) && this.lineClear(c1, b)) return [a, c1, b];
    const c2 = { x: b.x, y: a.y };
    if (this.isEmpty(c2.x, c2.y) && this.lineClear(a, c2) && this.lineClear(c2, b)) return [a, c2, b];

    // 2 拐：中间水平线
    for (let y = -1; y <= this.rows; y++) {
      const p1 = { x: a.x, y }, p2 = { x: b.x, y };
      if (this.isEmpty(p1.x, p1.y) && this.isEmpty(p2.x, p2.y)
        && this.lineClear(a, p1) && this.lineClear(p1, p2) && this.lineClear(p2, b))
        return [a, p1, p2, b];
    }
    // 2 拐：中间垂直线
    for (let x = -1; x <= this.cols; x++) {
      const p1 = { x, y: a.y }, p2 = { x, y: b.y };
      if (this.isEmpty(p1.x, p1.y) && this.isEmpty(p2.x, p2.y)
        && this.lineClear(a, p1) && this.lineClear(p1, p2) && this.lineClear(p2, b))
        return [a, p1, p2, b];
    }
    return null;
  }

  // 一维紧凑：把 arr 中非零元素朝 dir（-1=低索引端，+1=高索引端）紧凑，保序。
  // 返回 { out, moves }，moves 为 [{ from, to }]（一维索引）。
  compact1D(arr, dir) {
    const n = arr.length;
    const out = new Array(n).fill(0);
    const moves = [];
    let p = dir < 0 ? 0 : n - 1;
    for (let k = 0; k < n; k++) {
      const i = dir < 0 ? k : n - 1 - k;
      if (arr[i] !== 0) {
        out[p] = arr[i];
        if (p !== i) moves.push({ from: i, to: p });
        p -= dir;
      }
    }
    return { out, moves };
  }

  // 对某一行/列做一次紧凑，把一维移动换算成二维坐标写入 moves 数组。
  // axis: 'y' 表示按行处理（lineIndex 为行号，一维索引是列号 x）；'x' 表示按列处理。
  applyLine(axis, lineIndex, dir, newGrid, moves) {
    const len = axis === 'y' ? this.cols : this.rows;
    const arr = new Array(len);
    for (let k = 0; k < len; k++) {
      arr[k] = axis === 'y' ? newGrid[lineIndex][k] : newGrid[k][lineIndex];
    }
    const { out, moves: m1d } = this.compact1D(arr, dir);
    for (let k = 0; k < len; k++) {
      if (axis === 'y') newGrid[lineIndex][k] = out[k];
      else newGrid[k][lineIndex] = out[k];
    }
    for (const { from, to } of m1d) {
      const fx = axis === 'y' ? from : lineIndex;
      const fy = axis === 'y' ? lineIndex : from;
      const tx = axis === 'y' ? to : lineIndex;
      const ty = axis === 'y' ? lineIndex : to;
      moves.push({ from: { x: fx, y: fy }, to: { x: tx, y: ty } });
    }
  }

  // 按物效方向重排棋盘，改写 this.grid，返回移动映射 [{ from, to }]。
  applyEffect(effect) {
    const moves = [];
    if (effect === 'none') return moves;
    const newGrid = this.grid.map(row => row.slice());
    const R = this.rows, C = this.cols;
    const midC = Math.floor(C / 2);
    const midR = Math.floor(R / 2);

    const single = (axis, dir) => {
      const n = axis === 'y' ? R : C;
      for (let i = 0; i < n; i++) this.applyLine(axis, i, dir, newGrid, moves);
    };
    // 半区变体：axis='y' 时按行劈左/右半，axis='x' 时按列劈上/下半
    const split = (axis, dirLow, dirHigh) => {
      const n = axis === 'y' ? R : C;
      const mid = axis === 'y' ? midC : midR;
      for (let i = 0; i < n; i++) {
        // 半区逐段紧凑：把该行/列拆成 [0, mid) 与 [mid, len) 两段分别沉底
        const len = axis === 'y' ? C : R;
        const line = axis === 'y' ? newGrid[i].slice() : newGrid.map(r => r[i]);
        const low = this.compact1D(line.slice(0, mid), dirLow);
        const high = this.compact1D(line.slice(mid), dirHigh);
        // 写回：低段结果占 [0, mid)，高段结果占 [mid, len)
        for (let k = 0; k < mid; k++) {
          const v = low.out[k];
          if (axis === 'y') newGrid[i][k] = v; else newGrid[k][i] = v;
        }
        for (let k = 0; k < len - mid; k++) {
          const v = high.out[k];
          const colIdx = mid + k;
          if (axis === 'y') newGrid[i][colIdx] = v; else newGrid[colIdx][i] = v;
        }
        // 记录低段移动
        for (const { from, to } of low.moves) {
          const fromXY = axis === 'y' ? { x: from, y: i } : { x: i, y: from };
          const toXY = axis === 'y' ? { x: to, y: i } : { x: i, y: to };
          moves.push({ from: fromXY, to: toXY });
        }
        // 记录高段移动（索引需加上 mid 偏移）
        for (const { from, to } of high.moves) {
          const fromXY = axis === 'y' ? { x: mid + from, y: i } : { x: i, y: mid + from };
          const toXY = axis === 'y' ? { x: mid + to, y: i } : { x: i, y: mid + to };
          moves.push({ from: fromXY, to: toXY });
        }
      }
    };

    switch (effect) {
      case 'up': single('x', -1); break;      // 每列向上沉
      case 'down': single('x', 1); break;     // 每列向下沉
      case 'left': single('y', -1); break;    // 每行向左沉
      case 'right': single('y', 1); break;    // 每行向右沉
      case 'lr-spread': split('y', -1, 1); break;  // 左半左沉、右半右沉
      case 'ud-spread': split('x', -1, 1); break;  // 上半上沉、下半下沉
      case 'scatter': split('y', -1, 1); split('x', -1, 1); break; // 左右分散再上下分散
      case 'gather': split('y', 1, -1); split('x', 1, -1); break;  // 水平向心再垂直向心
      default: throw new Error('未知物效: ' + effect);
    }
    this.grid = newGrid;
    return moves;
  }

  // 收集所有存活方块，按图案类型分组
  byType() {
    const map = new Map();
    for (let y = 0; y < this.rows; y++)
      for (let x = 0; x < this.cols; x++) {
        const t = this.grid[y][x];
        if (t > 0) {
          if (!map.has(t)) map.set(t, []);
          map.get(t).push({ x, y });
        }
      }
    return map;
  }

  // 找一对可消除的相同图案，返回 { a, b, path }，无可消返回 null
  findPair() {
    for (const list of this.byType().values()) {
      for (let i = 0; i < list.length; i++)
        for (let j = i + 1; j < list.length; j++) {
          const path = this.canConnect(list[i], list[j]);
          if (path) return { a: list[i], b: list[j], path };
        }
    }
    return null;
  }

  hasPair() {
    return this.findPair() !== null;
  }

  // 消除 a、b 两个方块
  eliminate(a, b) {
    this.grid[a.y][a.x] = 0;
    this.grid[b.y][b.x] = 0;
    this.remaining -= 2;
  }

  // 重排剩余方块图案（图案集合不变，仅打乱位置）
  shuffle() {
    const types = [];
    const positions = [];
    for (let y = 0; y < this.rows; y++)
      for (let x = 0; x < this.cols; x++)
        if (this.grid[y][x] > 0) {
          types.push(this.grid[y][x]);
          positions.push([x, y]);
        }
    shuffleArr(types, this.rng);
    positions.forEach(([x, y], i) => { this.grid[y][x] = types[i]; });
  }
}

if (typeof module !== 'undefined') module.exports = { Link2D };
