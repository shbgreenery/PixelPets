'use strict';

// 3D 连连看核心逻辑：体素模型、图案生成、≤2 拐点轴对齐折线判定、寻对与死局检测。
// 纯逻辑，不依赖 Three.js / DOM。判定使用扩展网格 [-1, N]，越界位置视为可走边界层
// （类比 2D 连连看棋盘外一圈隐藏路径）。

// 洗牌工具：Fisher-Yates，就地打乱数组
function shuffleArr(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

class CubeLink {
  constructor(N, numTypes, rng = Math.random) {
    this.N = N;
    this.rng = rng;
    this.remaining = N * N * N;
    // 三维数组 grid[x][y][z]，0 空 / >0 图案 id
    this.grid = Array.from({ length: N }, () =>
      Array.from({ length: N }, () => Array(N).fill(0))
    );
    // 生成成对图案：N³/2 对，每对同一随机图案，保证每种图案偶数次
    const types = [];
    for (let i = 0; i < N * N * N / 2; i++) {
      const t = 1 + Math.floor(rng() * numTypes);
      types.push(t, t);
    }
    shuffleArr(types, rng);
    let idx = 0;
    for (let x = 0; x < N; x++)
      for (let y = 0; y < N; y++)
        for (let z = 0; z < N; z++)
          this.grid[x][y][z] = types[idx++];
  }

  // 该坐标是否可走：越界（边界层）或被挖空
  isEmpty(x, y, z) {
    if (x < 0 || y < 0 || z < 0 || x >= this.N || y >= this.N || z >= this.N) return true;
    return this.grid[x][y][z] === 0;
  }

  // a、b 在同一条轴对齐直线上时，中间格子是否全空（不含端点）
  lineClear(a, b) {
    if (a.x === b.x && a.y === b.y) {
      const lo = Math.min(a.z, b.z), hi = Math.max(a.z, b.z);
      for (let z = lo + 1; z < hi; z++) if (!this.isEmpty(a.x, a.y, z)) return false;
      return true;
    }
    if (a.x === b.x && a.z === b.z) {
      const lo = Math.min(a.y, b.y), hi = Math.max(a.y, b.y);
      for (let y = lo + 1; y < hi; y++) if (!this.isEmpty(a.x, y, a.z)) return false;
      return true;
    }
    if (a.y === b.y && a.z === b.z) {
      const lo = Math.min(a.x, b.x), hi = Math.max(a.x, b.x);
      for (let x = lo + 1; x < hi; x++) if (!this.isEmpty(x, a.y, a.z)) return false;
      return true;
    }
    return false; // 不在同轴直线上
  }

  // 判定 A、B 能否消除，返回路径关键点数组 [A, ...拐角..., B]，不可消返回 null。
  // 路径可走：被挖空的体素位 + 立方体外一圈隐藏边界层（isEmpty 对越界返回 true）。
  //
  // 判断逻辑（按拐点数量递增，统一枚举拐点）：
  //   0 拐：A 与 B 有 2 个维度相同 → 同轴直线，中间全空
  //   1 拐：枚举拐点 C，C 与 A 有 2 个维度相同 且 C 与 B 有 2 个维度相同
  //         （即 C 在 A 的某条轴 与 B 的某条轴 的交点上）
  //   2 拐：枚举 C1、C2，C1 与 A 有 2 个维度相同，C2 与 B 有 2 个维度相同，
  //         C1 与 C2 有 2 个维度相同（即 C1、C2 在某条轴上共线）
  canConnect(a, b) {
    if (a.x === b.x && a.y === b.y && a.z === b.z) return null;
    if (this.grid[a.x][a.y][a.z] <= 0) return null;
    if (this.grid[b.x][b.y][b.z] <= 0) return null;
    if (this.grid[a.x][a.y][a.z] !== this.grid[b.x][b.y][b.z]) return null;

    // 0 拐：A 与 B 2 维相同 → 同轴直线
    const sameX = a.x === b.x, sameY = a.y === b.y, sameZ = a.z === b.z;
    const sameCount = (sameX ? 1 : 0) + (sameY ? 1 : 0) + (sameZ ? 1 : 0);
    if (sameCount === 2 && this.lineClear(a, b)) return [a, b];

    // 1 拐：枚举拐点 C，C 与 A 2 维相同 且 C 与 B 2 维相同
    // C 在 A 的某条轴 ∩ B 的某条轴 的交点上（最多 2 个有效候选，取决于哪 1 维相同）
    if (sameCount >= 1) {
      const p = this.oneTurn(a, b);
      if (p) return p;
    }

    // 2 拐：枚举 C1、C2，C1 与 A 2 维相同，C2 与 B 2 维相同，C1 与 C2 2 维相同
    // 不依赖 sameCount——即使 A 与 B 有 1 维或 2 维相同，2 拐也可能通过引入新维度绕路
    const diff = [];
    if (!sameX) diff.push('x');
    if (!sameY) diff.push('y');
    if (!sameZ) diff.push('z');
    if (diff.length === 2) {
      return this.twoTurnOnPlane(a, b, diff);
    }
    if (diff.length === 1) {
      // A 与 B 只有 1 维不同，引入相同维度之一作为绕行方向
      const sameAxes = [sameX ? 'x' : null, sameY ? 'y' : null, sameZ ? 'z' : null].filter(Boolean);
      for (const extra of sameAxes) {
        const path = this.twoTurnOnPlane(a, b, [diff[0], extra]);
        if (path) return path;
      }
      return null;
    }
    return this.twoTurn3D(a, b);
  }

  // 1 拐：枚举拐点 C，C 与 A 2 维相同 且 C 与 B 2 维相同
  // 即 C 在 A 的某条轴 与 B 的某条轴 的交点上
  // 只有当 A 与 B 恰好 1 维相同时才有 2 个有效候选（交叉点）
  oneTurn(a, b) {
    // 找 A 与 B 相同的维度
    const same = [];
    if (a.x === b.x) same.push('x');
    if (a.y === b.y) same.push('y');
    if (a.z === b.z) same.push('z');
    if (same.length !== 1) return null; // 只有恰好 1 维相同时才有 2 个候选
    const diff = ['x', 'y', 'z'].filter(k => k !== same[0]);
    // 2 个候选拐点：交叉点
    const c1 = { x: a.x, y: a.y, z: a.z }; c1[diff[0]] = b[diff[0]];
    const c2 = { x: a.x, y: a.y, z: a.z }; c2[diff[1]] = b[diff[1]];
    if (this.isEmpty(c1.x, c1.y, c1.z) && this.lineClear(a, c1) && this.lineClear(c1, b))
      return [a, c1, b];
    if (this.isEmpty(c2.x, c2.y, c2.z) && this.lineClear(a, c2) && this.lineClear(c2, b))
      return [a, c2, b];
    return null;
  }

  // 2 拐退化：A、B 在 diff 的两个分量上不同，枚举中间行/列（含边界层 -1..N）
  twoTurnOnPlane(a, b, diff) {
    const [d1, d2] = diff;
    // 情形1：固定 d1 端点，枚举中间 d2 值 r
    for (let r = -1; r <= this.N; r++) {
      const c1 = { x: a.x, y: a.y, z: a.z }; c1[d2] = r;
      const c2 = { x: b.x, y: b.y, z: b.z }; c2[d2] = r;
      if (this.isEmpty(c1.x, c1.y, c1.z) && this.isEmpty(c2.x, c2.y, c2.z)
        && this.lineClear(a, c1) && this.lineClear(c1, c2) && this.lineClear(c2, b))
        return [a, c1, c2, b];
    }
    // 情形2：固定 d2 端点，枚举中间 d1 值 c
    for (let c = -1; c <= this.N; c++) {
      const c1 = { x: a.x, y: a.y, z: a.z }; c1[d1] = c;
      const c2 = { x: b.x, y: b.y, z: b.z }; c2[d1] = c;
      if (this.isEmpty(c1.x, c1.y, c1.z) && this.isEmpty(c2.x, c2.y, c2.z)
        && this.lineClear(a, c1) && this.lineClear(c1, c2) && this.lineClear(c2, b))
        return [a, c1, c2, b];
    }
    return null;
  }

  // 2 拐一般：A、B 三个分量都不同，6 种轴顺序各唯一确定两个拐点
  twoTurn3D(a, b) {
    const perms = [
      ['x', 'y', 'z'], ['x', 'z', 'y'],
      ['y', 'x', 'z'], ['y', 'z', 'x'],
      ['z', 'x', 'y'], ['z', 'y', 'x'],
    ];
    for (const [d1, d2, d3] of perms) {
      const p1 = { x: a.x, y: a.y, z: a.z }; p1[d1] = b[d1];
      const p2 = { x: b.x, y: b.y, z: b.z }; p2[d3] = a[d3];
      if (this.isEmpty(p1.x, p1.y, p1.z) && this.isEmpty(p2.x, p2.y, p2.z)
        && this.lineClear(a, p1) && this.lineClear(p1, p2) && this.lineClear(p2, b))
        return [a, p1, p2, b];
    }
    return null;
  }

  // 收集所有存活体素，按图案类型分组
  byType() {
    const map = new Map();
    for (let x = 0; x < this.N; x++)
      for (let y = 0; y < this.N; y++)
        for (let z = 0; z < this.N; z++) {
          const t = this.grid[x][y][z];
          if (t > 0) {
            if (!map.has(t)) map.set(t, []);
            map.get(t).push({ x, y, z });
          }
        }
    return map;
  }

  // 找一对可消除的相同图案，返回 { a, b, path }（path 为折线关键点数组），无可消返回 null
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

  // 消除 a、b 两个体素
  eliminate(a, b) {
    this.grid[a.x][a.y][a.z] = 0;
    this.grid[b.x][b.y][b.z] = 0;
    this.remaining -= 2;
  }

  // 重排剩余体素图案（保持每种偶数次，因图案集合不变仅打乱）
  shuffle() {
    const types = [];
    const positions = [];
    for (let x = 0; x < this.N; x++)
      for (let y = 0; y < this.N; y++)
        for (let z = 0; z < this.N; z++)
          if (this.grid[x][y][z] > 0) {
            types.push(this.grid[x][y][z]);
            positions.push([x, y, z]);
          }
    shuffleArr(types, this.rng);
    positions.forEach(([x, y, z], i) => { this.grid[x][y][z] = types[i]; });
  }
}

if (typeof module !== 'undefined') module.exports = { CubeLink };
