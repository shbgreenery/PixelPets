'use strict';

// ============ 沙画核心逻辑 ============
// 纯逻辑模块：网格、程序生成插画、落沙模拟、吸沙、拆盘、队列分配。
// 不依赖 Phaser / DOM，可用 Node 直接跑单测（与 bfs.js 同约定）。

// ---------- 调色板：11 色固定 ----------
// 色值经过 ΔE(CIE76) 校验，任意两色在 4×4 沙粒尺寸下均可分辨（最小 ΔE 35.2）。
const SAND_PALETTE = [
  { name: '白色', hex: 0xF4F7FA },
  { name: '米色', hex: 0xC3AE87 },
  { name: '粉色', hex: 0xF26FA8 },
  { name: '橙色', hex: 0xF5A623 },
  { name: '红色', hex: 0xE02020 },
  { name: '深红', hex: 0x8B1A1A },
  { name: '紫色', hex: 0x7B3FB5 },
  { name: '蓝色', hex: 0x2E8BE6 },
  { name: '绿色', hex: 0x3FC93F },
  { name: '深绿', hex: 0x1A6B2E },
  { name: '黑色', hex: 0x1A1A1A },
];

// 调色板下标（供场景生成器使用）
const C_WHITE = 0, C_BEIGE = 1, C_PINK = 2, C_ORANGE = 3, C_RED = 4,
      C_DARKRED = 5, C_PURPLE = 6, C_BLUE = 7, C_GREEN = 8,
      C_DARKGREEN = 9, C_BLACK = 10;

// ---------- 尺寸常量 ----------
const SAND_COLS = 300;      // 网格列数
const SAND_ROWS = 400;      // 网格行数
const CELL_PX = 2;          // 每格 2×2 画布像素 → 沙盘 600 × 800
const DRAIN_ROWS = 10;      // 取料区：底部十行沙粒
const SAND_W = SAND_COLS * CELL_PX;
const SAND_H = SAND_ROWS * CELL_PX;
const TOTAL_SAND = SAND_COLS * SAND_ROWS;   // 120,000 颗

// ---------- 玩法常量 ----------
const PLATE_SLOTS = 6;      // 盘位数（开局值）
const MAX_PLATE_SLOTS = 10; // 盘位数上限（点按钮可增加）
const MAX_QUEUE_COLS = 5;   // 队列最大列数
const PLATE_TIERS = [2400, 1200, 600, 400, 200];  // 盘子容量档位（余数另算）
const ABSORB_PER_SEC = 500; // 每盘吸沙速率（颗/秒）
const SIM_HZ = 30;          // 落沙模拟频率（Hz）

// ---------- 传送带常量 ----------
const BELT_SPEED = 200;       // 带速（像素/秒）：600px 跑一圈 3 秒
const ABSORB_TOL = 34;        // 吸沙的左右容差（像素），略大于盘子半径 30
const BELT_IDLE_CYCLES = 3;   // 连续空转几圈后判定卡死
// 自动加速：队列空了、或 8 个槽位全占满时，玩家已经无事可做，
// 吸沙 / 传送带 / 落沙三项统一乘以这个倍率快进。
const FAST_MUL = 3;

// ---------- 确定性随机数 ----------
function mulberry32(a) {
  a = a | 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ============ 程序生成插画 ============
// 只用调色板里的颜色作画，所以映射到色板时零歧义（不需要量化）。
// 场景填满整个网格，返回 Int16Array(cols*rows)，值为调色板下标。

const SCENE_KINDS = ['mountain', 'city', 'sea', 'field'];

function generateScene(kind, seed, cols, rows) {
  cols = cols || SAND_COLS;
  rows = rows || SAND_ROWS;
  const rnd = mulberry32(seed >>> 0);
  const cells = new Int16Array(cols * rows);
  const pick = (arr) => arr[(rnd() * arr.length) | 0];
  const pickNot = (arr, ...not) => {
    const ok = arr.filter(c => !not.includes(c));
    return ok.length ? pick(ok) : arr[0];
  };

  const setPx = (x, y, c) => {
    if (x >= 0 && x < cols && y >= 0 && y < rows) cells[y * cols + x] = c;
  };
  const fillRect = (x0, y0, w, h, c) => {
    const x1 = Math.min(cols, x0 + w), y1 = Math.min(rows, y0 + h);
    for (let y = Math.max(0, y0); y < y1; y++) {
      const base = y * cols;
      for (let x = Math.max(0, x0); x < x1; x++) cells[base + x] = c;
    }
  };
  const disc = (cx, cy, r, c) => {
    for (let y = cy - r; y <= cy + r; y++)
      for (let x = cx - r; x <= cx + r; x++)
        if ((x - cx) * (x - cx) + (y - cy) * (y - cy) <= r * r) setPx(x, y, c);
  };

  const SKY = [C_BLUE, C_PURPLE, C_PINK, C_ORANGE, C_WHITE];
  const GROUND = [C_DARKGREEN, C_GREEN, C_BEIGE, C_DARKRED, C_BLACK, C_PURPLE, C_BLUE];
  const ACCENT = [C_RED, C_ORANGE, C_PINK, C_WHITE, C_BEIGE, C_BLACK, C_PURPLE];

  const horizon = Math.round(rows * (0.46 + rnd() * 0.14));

  // --- 天空：切成两条色带，模拟沙画的层叠铺沙 ---
  // 单块填充会让一个颜色吃掉半个画面（实测两色占 93%），分层后最大占比降到约 30%
  const sky1 = pick(SKY);
  const sky2 = pickNot(SKY, sky1);
  const bandY = Math.round(horizon * (0.5 + rnd() * 0.3));
  fillRect(0, 0, cols, bandY, sky1);
  fillRect(0, bandY, cols, horizon - bandY, sky2);

  // --- 太阳 / 月亮 ---
  const sunR = Math.round(cols * (0.05 + rnd() * 0.055));
  disc(Math.round(cols * (0.15 + rnd() * 0.7)),
       Math.round(bandY * (0.35 + rnd() * 0.5)),
       sunR, pickNot(ACCENT, sky1, sky2));

  // --- 云 ---
  const nCloud = 2 + ((rnd() * 4) | 0);
  for (let i = 0; i < nCloud; i++) {
    const cw = Math.round(cols * (0.10 + rnd() * 0.16));
    const ch = Math.max(2, Math.round(cw * 0.26));
    const cx = Math.round(rnd() * cols), cy = Math.round(bandY * (0.06 + rnd() * 0.9));
    const cc = pickNot([C_WHITE, C_PINK, C_BEIGE, C_ORANGE], sky1, sky2);
    fillRect(cx, cy, cw, ch, cc);
    fillRect(cx + Math.round(cw * 0.18), cy - Math.round(ch * 0.7),
             Math.round(cw * 0.6), Math.round(ch * 0.7), cc);
  }

  // --- 飞鸟 ---
  const nBird = (rnd() * 5) | 0;
  for (let i = 0; i < nBird; i++) {
    const bx = Math.round(rnd() * cols), by = Math.round(bandY * (0.1 + rnd() * 0.7));
    const s = 2 + ((rnd() * 2) | 0);
    fillRect(bx - s, by, s, 1, C_BLACK);
    fillRect(bx + 1, by, s, 1, C_BLACK);
  }

  // --- 地形 ---
  if (kind === 'mountain') {
    const n = 3 + ((rnd() * 2) | 0);
    const mc1 = pick([C_DARKGREEN, C_PURPLE, C_DARKRED, C_BLUE]);
    const mc2 = pickNot([C_DARKGREEN, C_GREEN, C_PURPLE, C_DARKRED, C_BLUE], mc1);
    for (let m = 0; m < n; m++) {
      const peakX = cols * ((m + 0.5) / n) + (rnd() - 0.5) * cols / n;
      const peakY = horizon - rows * (0.10 + rnd() * 0.22);
      const halfW = (cols / n) * (1.0 + rnd() * 0.6);
      const mc = (m % 2) ? mc1 : mc2;
      const snow = rnd() < 0.6;
      for (let x = Math.floor(peakX - halfW); x <= peakX + halfW; x++) {
        if (x < 0 || x >= cols) continue;
        const t = 1 - Math.abs(x - peakX) / halfW;
        if (t <= 0) continue;
        const yTop = Math.round(horizon + (peakY - horizon) * t);
        fillRect(x, yTop, 1, horizon - yTop, mc);
        if (snow) fillRect(x, yTop, 1, Math.max(1, Math.round((horizon - yTop) * 0.22)), C_WHITE);
      }
    }

  } else if (kind === 'city') {
    const BC = [C_PURPLE, C_DARKRED, C_BLACK, C_BLUE, C_RED, C_DARKGREEN, C_BEIGE];
    let x = 0;
    while (x < cols) {
      const w = Math.round(cols * (0.035 + rnd() * 0.055));
      const h = Math.round(rows * (0.09 + rnd() * 0.32));
      const bc = pick(BC);
      fillRect(x, horizon - h, w, h, bc);
      const winC = pickNot([C_ORANGE, C_WHITE, C_PINK, C_BEIGE], bc);
      for (let wy = horizon - h + 5; wy < horizon - 4; wy += 8)
        for (let wx = x + 3; wx < x + w - 4; wx += 7)
          if (rnd() < 0.55) fillRect(wx, wy, 3, 4, winC);
      x += w + Math.round(cols * (0.006 + rnd() * 0.02));
    }

  } else if (kind === 'sea') {
    const bands = 5 + ((rnd() * 3) | 0);
    const SC = [C_BLUE, C_DARKGREEN, C_PURPLE, C_DARKRED, C_GREEN, C_BLACK];
    for (let b = 0; b < bands; b++) {
      const y0 = horizon + Math.round((rows - horizon) * b / bands);
      const y1 = horizon + Math.round((rows - horizon) * (b + 1) / bands);
      const c = SC[b % SC.length];
      const amp = 2 + rnd() * 4;
      for (let y = y0; y < y1; y++) {
        const base = y * cols;
        for (let x = 0; x < cols; x++) {
          if (y >= y0 + Math.round(Math.sin((x + b * 37) * 0.05) * amp)) cells[base + x] = c;
        }
      }
    }

  } else { // field
    const nTree = 6 + ((rnd() * 6) | 0);
    for (let i = 0; i < nTree; i++) {
      const tx = Math.round(rnd() * cols);
      const ty = horizon + Math.round(rnd() * (rows - horizon) * 0.8);
      const th = Math.round(rows * (0.06 + rnd() * 0.10));
      const tw = Math.max(2, Math.round(th * 0.55));
      const leaf = pick([C_DARKGREEN, C_GREEN, C_PURPLE, C_DARKRED]);
      for (let y = ty - th; y < ty; y++) {
        const t = (y - (ty - th)) / th;
        const w = Math.max(1, Math.round(tw * t));
        fillRect(tx - w, y, w * 2, 1, leaf);
      }
      fillRect(tx - 1, ty, 3, Math.max(2, Math.round(th * 0.28)), C_DARKRED);
    }
  }

  // --- 地面：分层色带 ---
  // 地面占画面近一半，单块填充会让一个色吃掉近半个沙盘，所以同样切成色带
  const ground1 = pickNot(GROUND, sky1, sky2);
  const ground2 = pickNot(GROUND, ground1, sky1, sky2);
  const ground3 = pickNot(GROUND, ground1, ground2, sky1, sky2);
  const midY = horizon + Math.round((rows - horizon) * (0.45 + rnd() * 0.2));
  fillRect(0, horizon, cols, midY - horizon, ground1);
  fillRect(0, midY, cols, rows - midY, ground2);
  const shadowY = Math.round(rows * (0.92 + rnd() * 0.04));
  fillRect(0, shadowY, cols, rows - shadowY, ground3);

  // --- 前景点缀：随机小色块，进一步打散大色块占比 ---
  const nDot = 6 + ((rnd() * 10) | 0);
  for (let i = 0; i < nDot; i++) {
    const dw = Math.round(cols * (0.03 + rnd() * 0.08));
    const dh = Math.round(rows * (0.012 + rnd() * 0.03));
    fillRect(Math.round(rnd() * cols), Math.round(horizon + rnd() * (rows - horizon) * 0.85),
             dw, dh, pick(ACCENT));
  }

  return cells;
}

// ============ 沙盘网格 ============
// cells: Int16Array(cols*rows)，-1 = 空，其余为调色板下标
class SandGrid {
  constructor(cols, rows, drainRows) {
    this.cols = cols || SAND_COLS;
    this.rows = rows || SAND_ROWS;
    this.drainRows = drainRows || DRAIN_ROWS;
    this.cells = new Int16Array(this.cols * this.rows).fill(-1);
    this.rndState = 0x9E3779B9 | 0;
    this.scanFlip = false;   // 水平扫描方向，逐 tick 翻转以抵消方向性漂移
    this._dirty = null;   // 本 tick 移动过的格下标，供渲染层做局部重绘
  }

  clear() {
    this.cells.fill(-1);
  }

  // 落沙模拟：从下往上逐行扫描，直落优先，否则斜滑（两边都试）。
  // 返回移动的格数——0 表示已静止（调用方可据此休眠，避免空转）。
  tick() {
    const { cols, rows, cells } = this;
    let s = this.rndState | 0;
    let moved = 0;
    const dirty = this._dirty ? this._dirty : (this._dirty = []);
    dirty.length = 0;

    // 水平扫描方向逐 tick 翻转。
    // 固定从左到右会出问题：被吸出的空洞总是先被【左边】那颗沙抢到
    //（左邻先被处理，斜下方一探就是洞），等轮到右边的沙时洞已被填。
    // 于是每轮"吸出空洞 → 塌落补位"都让沙子净向右漂移。
    // 实测：吸沙+落沙联跑时左半只吸到 26%，而纯吸沙是精确的 50/50。
    this.scanFlip = !this.scanFlip;
    const dir = this.scanFlip ? 1 : -1;
    const cStart = dir > 0 ? 0 : cols - 1;
    const cEnd = dir > 0 ? cols : -1;

    for (let r = rows - 2; r >= 0; r--) {
      const base = r * cols, below = base + cols;
      for (let c = cStart; c !== cEnd; c += dir) {
        const i = base + c;
        const v = cells[i];
        if (v < 0) continue;

        // 1) 正下方为空 → 直落
        if (cells[below + c] < 0) {
          cells[below + c] = v; cells[i] = -1;
          dirty.push(i, below + c);
          moved++;
          continue;
        }
        // 2) 斜下方：两边都要试。先试哪边由随机决定（避免整体单向偏移），
        //    但另一边被挡时不能直接放弃 —— 否则沙子会卡在明明有空隙的位置上
        //    （实测：左下方空着、右下方被占时，有 49% 的概率原地不动）。
        s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
        const d1 = (s & 1) ? 1 : -1;
        let nc = c + d1;
        if (nc < 0 || nc >= cols || cells[below + nc] >= 0) nc = c - d1;   // 换另一边
        if (nc >= 0 && nc < cols && cells[below + nc] < 0) {
          cells[below + nc] = v; cells[i] = -1;
          dirty.push(i, below + nc);
          moved++;
        }
      }
    }
    this.rndState = s;
    return moved;
  }

  // 本 tick 移动过的格下标数组（成对出现：源格、目标格）
  get dirty() { return this._dirty; }

  // 从取料区【指定列区间 [c0, c1)】里吸走至多 n 颗 color 沙粒，返回实际吸走数。
  // 传送带上盘子只覆盖它正下方那一小段，所以吸沙必须限定列范围。
  // 扫描顺序：从最底行往上、每行从左到右（确定，不含随机）。
  // 传入 out 数组可收集被清掉的格下标 —— 渲染层用它作为"沙粒飞向盘子"的真实起点。
  absorbInColumns(color, c0, c1, n, out) {
    const { cols, rows, cells, drainRows } = this;
    let taken = 0;
    const dirty = this._dirty ? this._dirty : (this._dirty = []);
    const lo = Math.max(0, c0), hi = Math.min(cols, c1);
    for (let r = rows - 1; r >= rows - drainRows && taken < n; r--) {
      const base = r * cols;
      for (let c = lo; c < hi && taken < n; c++) {
        const i = base + c;
        if (cells[i] === color) {
          cells[i] = -1;
          dirty.push(i);
          if (out) out.push(i);
          taken++;
        }
      }
    }
    return taken;
  }

  // 整个取料区（不限列）—— 等价于 absorbInColumns 覆盖全部列
  absorb(color, n, out) {
    return this.absorbInColumns(color, 0, this.cols, n, out);
  }

  // 取料区是否还有该色沙粒
  drainHas(color) {
    const { cols, rows, cells, drainRows } = this;
    for (let r = rows - drainRows; r < rows; r++) {
      const base = r * cols;
      for (let c = 0; c < cols; c++) if (cells[base + c] === color) return true;
    }
    return false;
  }

  // 取料区已占用的格数
  drainOccupied() {
    const { cols, rows, cells, drainRows } = this;
    let n = 0;
    for (let r = rows - drainRows; r < rows; r++) {
      const base = r * cols;
      for (let c = 0; c < cols; c++) if (cells[base + c] >= 0) n++;
    }
    return n;
  }

  // 各色沙粒数
  countByColor(numColors) {
    const counts = new Array(numColors).fill(0);
    const cells = this.cells;
    for (let i = 0; i < cells.length; i++) {
      const v = cells[i];
      if (v >= 0 && v < numColors) counts[v]++;
    }
    return counts;
  }

  // 剩余沙粒总数
  countAll() {
    const cells = this.cells;
    let n = 0;
    for (let i = 0; i < cells.length; i++) if (cells[i] >= 0) n++;
    return n;
  }
}

// ============ 盘子 ============
// 每色按容量档位从大到小贪心拆分，最后一盘精确吃掉余数。
// 关键：最后一盘容量必须【精确等于】余数，否则会出现永远吸不满、永远占着槽位的死锁。
function splitPlates(counts, tiers) {
  tiers = tiers || PLATE_TIERS;
  const plates = [];
  for (let color = 0; color < counts.length; color++) {
    let left = counts[color];
    while (left > 0) {
      let cap = 0;
      for (let i = 0; i < tiers.length; i++) {
        if (tiers[i] <= left) { cap = tiers[i]; break; }
      }
      if (cap === 0) cap = left;   // 余数盘：精确等于剩余量
      plates.push({
        color,
        capacity: cap,
        remaining: cap,
        attracted: 0,
        plateIndex: -1,
        active: false,
      });
      left -= cap;
    }
  }
  return plates;
}

function shuffle(arr, rnd) {
  rnd = rnd || Math.random;
  for (let i = arr.length - 1; i > 0; i--) {
    const j = (rnd() * (i + 1)) | 0;
    const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  }
  return arr;
}

// 把盘子分成 n 列。用【连续分块】而不是轮流分配：
// 轮流分配会让 5 列 × 2 槽 = 10 个可见盘子全部落在颜色区间的最前面，
// 玩家需要某个颜色时很可能看不见；连续分块让可见盘子跨越整个颜色区间。
function dealInto(plates, n) {
  const cols = [];
  const per = Math.ceil(plates.length / n);
  for (let i = 0; i < n; i++) {
    const chunk = plates.slice(i * per, (i + 1) * per);
    if (chunk.length > 0) cols.push(chunk);
  }
  return cols.length ? cols : [[]];
}

// 按颜色排序（同色相邻），同色内大容量在前 —— 玩家一眼能看出队列里有哪些颜色
function sortByColor(plates) {
  return plates.slice().sort((a, b) =>
    a.color !== b.color ? a.color - b.color : b.capacity - a.capacity);
}

// 开局分配：最多 maxCols 列
function distributeToQueues(plates, maxCols) {
  const sorted = sortByColor(plates);
  const n = Math.max(1, Math.min(maxCols || MAX_QUEUE_COLS, sorted.length));
  return dealInto(sorted, n);
}

// 某列被点空后：只丢掉那一列，其余各列的内容原样不动。
// 不做"全部摊平 → 按颜色重排 → 重新均分"——沙画必须放对颜色，
// 玩家会主动记住"红色在第 3 列"，一重排就白记了。列间距由渲染层按新列数重算。
function rebalanceQueues(queues) {
  const kept = queues.filter(q => q.length > 0);
  return kept.length ? kept : [[]];
}

// ============ 直线传送带 ============
// 槽位按固定间距排布，整条带匀速右移，跑出右端从左边回来。
// 盘子只有移动到某颗沙粒正下方（左右容差内）才能吸走它 —— 这让"位置"第一次有意义。
//
// 关于"带长"：它不是一个独立参数，而是【由盘位数推出来的】。
// 间距固定为一屏 VISIBLE_SLOTS 个，带长 = 盘位数 × 间距。
// 盘位数 ≤ VISIBLE_SLOTS 时正好铺满一屏；超过之后带比屏幕长，一屏只看到约 VISIBLE_SLOTS 个，
// 其余转到屏幕外 —— 屏幕外没有沙盘，所以那些盘子此时不吸沙，等转进来才工作。
const VISIBLE_SLOTS = 7;      // 一屏显示几个盘位（决定槽位间距）

class Belt {
  constructor(width, slotCount) {
    this.window = width;                  // 可视窗口宽度（= 沙盘宽度）
    this.n = slotCount || PLATE_SLOTS;
    this.recompute();
    this.offset = 0;              // 带已移动的距离（归一化在 [0, length)）
    this.cycles = 0;              // 累计跑过的整圈数
    this.idleCycles = 0;          // 连续空转（一圈内一颗都没吸到）的圈数
    this.absorbedThisCycle = 0;
    this.slots = new Array(this.n).fill(null);   // 每个槽位放什么，由调用方决定
  }

  // 由盘位数推导间距与带长
  recompute() {
    this.spacing = this.window / Math.min(this.n, VISIBLE_SLOTS);
    this.length = this.n * this.spacing;
    if (this.length > 0) this.offset = (this.offset || 0) % this.length;
  }

  // 槽位 i 当前在屏幕上的 x 坐标（槽位中心）。返回值 >= window 表示已转到屏幕外。
  slotX(i) {
    let x = (i * this.spacing + this.offset) % this.length;
    if (x < 0) x += this.length;
    return x;
  }

  // 该槽位此刻是否在可视窗口内（屏幕外的盘子吸不到沙）
  isVisible(i) {
    return this.slotX(i) < this.window;
  }

  // 前进 dt 秒；返回本帧跨过的整圈数
  advance(dt, speed) {
    this.offset += (speed === undefined ? BELT_SPEED : speed) * dt;
    let wrapped = 0;
    while (this.offset >= this.length) { this.offset -= this.length; wrapped++; }
    for (let k = 0; k < wrapped; k++) {
      this.cycles++;
      if (this.absorbedThisCycle === 0) this.idleCycles++;
      else this.idleCycles = 0;
      this.absorbedThisCycle = 0;
    }
    return wrapped;
  }

  // 记一次成功吸沙 —— 用于"空转圈数"的判定
  markAbsorbed() {
    this.absorbedThisCycle++;
    this.idleCycles = 0;
  }

  // 槽位 i 覆盖的列区间 [c0, c1)（按容差展开）。屏幕外的槽位返回空区间。
  slotColumns(i, cellPx) {
    const x = this.slotX(i);
    if (x >= this.window) return [0, 0];
    const c0 = Math.max(0, Math.floor((x - ABSORB_TOL) / cellPx));
    const c1 = Math.min(Math.round(this.window / cellPx), Math.ceil((x + ABSORB_TOL) / cellPx));
    return [c0, c1];
  }

  // 离 x 最近的【可见】空槽位下标；没有则返回 -1
  nearestEmpty(x) {
    let best = -1, bestD = Infinity;
    for (let i = 0; i < this.n; i++) {
      if (this.slots[i]) continue;
      const sx = this.slotX(i);
      if (sx >= this.window) continue;              // 屏幕外的空位放不了（玩家看不到）
      const d = Math.abs(sx - x);
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  // 某色在带上占用的槽位下标列表
  colorSlots(color) {
    const out = [];
    for (let i = 0; i < this.n; i++) {
      const p = this.slots[i];
      if (p && p.color === color) out.push(i);
    }
    return out;
  }

  // 改变槽位数：保住已在带上的盘子，并把它们【等间距摊开】。
  // 不能简单地按原顺序塞进前几个槽位 —— 那样盘子会挤成一小撮，
  // 而吸沙是按列范围算的，挤在一起等于只覆盖窄窄一条带，削弱传送带机制。
  setSlotCount(n) {
    if (n === this.n) return;
    const keep = this.slots.filter(Boolean);
    if (n < keep.length) return;      // 装不下就不缩，避免丢盘子
    this.n = n;
    this.recompute();                 // 间距与带长都随盘位数重新推导
    this.slots = new Array(n).fill(null);
    const k = keep.length;
    for (let i = 0; i < k; i++) {
      let idx = Math.round(i * n / k) % n;
      while (this.slots[idx]) idx = (idx + 1) % n;   // 落点被占就顺延，保证不丢
      this.slots[idx] = keep[i];
    }
  }

  isEmpty() { return this.slots.every(s => s === null); }
  count() { return this.slots.reduce((n, s) => n + (s ? 1 : 0), 0); }
}

if (typeof module !== 'undefined') {
  module.exports = {
    SAND_PALETTE, SAND_COLS, SAND_ROWS, CELL_PX, DRAIN_ROWS, SAND_W, SAND_H, TOTAL_SAND,
    PLATE_SLOTS, MAX_PLATE_SLOTS, MAX_QUEUE_COLS, PLATE_TIERS, ABSORB_PER_SEC, SIM_HZ,
    BELT_SPEED, ABSORB_TOL, BELT_IDLE_CYCLES, FAST_MUL, VISIBLE_SLOTS,
    C_WHITE, C_BEIGE, C_PINK, C_ORANGE, C_RED, C_DARKRED, C_PURPLE, C_BLUE,
    C_GREEN, C_DARKGREEN, C_BLACK,
    SCENE_KINDS, mulberry32, generateScene, SandGrid, Belt,
    splitPlates, shuffle, distributeToQueues, rebalanceQueues,
  };
}
