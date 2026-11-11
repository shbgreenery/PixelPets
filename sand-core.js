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
// 沙盘做成接近方形（600×660），是为了给下方队列腾出空间：
// 手机上的缩放系数由【屏宽】决定（390/600 = 0.65），画布总高因此不能超过约 1150 游戏单位。
// 队列要一屏显示 4 列 × 5 行（参考同类游戏），需要 264 单位，只能从沙盘里省。
const SAND_COLS = 300;      // 网格列数
const SAND_ROWS = 330;      // 网格行数
const CELL_PX = 2;          // 每格 2×2 画布像素 → 沙盘 600 × 660
const DRAIN_ROWS = 10;      // 取料区：底部十行沙粒
const SAND_W = SAND_COLS * CELL_PX;
const SAND_H = SAND_ROWS * CELL_PX;
const TOTAL_SAND = SAND_COLS * SAND_ROWS;   // 99,000 颗

// ---------- 玩法常量 ----------
const PLATE_SLOTS = 6;      // 盘位数（开局值）
const MAX_PLATE_SLOTS = 10; // 盘位数上限（点按钮可增加）
const MAX_QUEUE_COLS = 4;   // 队列最大列数（配合一屏 5 行的网格，可见 20 个盘子）
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

// ---------- 扫描顺序 ----------
// 落沙的方向性偏置来自"处理顺序的连贯性"：只要同一行内按固定方向扫，
// 先处理的沙粒腾出位置 → 后处理的邻居抢先占掉 → 正上方那颗只能再斜一格，
// 一行传一行，整块沙就斜着滑走（实测单 tick 内"向右斜 19 次 vs 向左斜 1 次"）。
//
// 试过两种更简单的改法，都不行：
//   · 逐 tick 翻转方向 —— 只把偏置换了个方向，单 tick 内照样连锁
//   · 只随机【块顺序】—— 块内仍是固定方向，连锁在块内发生，反而偏得更狠（左20/右380）
//
// 必须把【整行的列顺序】完全打乱。参考 Hartrik/sand-game-js 的 Processor：
// 预生成多组打乱的顺序表，每行随机选一组（避免每格都调随机数）。
// 表按每个网格实例的列数生成 —— 曾按全局 SAND_COLS 生成，小网格测试时列号越界，
// 导致大片格子被跳过、沙子根本不动。
const SCAN_VARIANTS = 8;                   // 预生成几组顺序
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

// ============ 关卡 ============
// 图片主体：沙盘的图案不再由程序绘制，而是把 Kenney 动物图量化到网格。
// 关卡与动物的对应关系固定下来，同一关永远同一只动物。
const LEVEL_ANIMALS = [
  'bear', 'buffalo', 'chick', 'chicken', 'cow', 'crocodile', 'dog', 'duck',
  'elephant', 'frog', 'giraffe', 'goat', 'gorilla', 'hippo', 'horse', 'monkey',
  'moose', 'narwhal', 'owl', 'panda', 'parrot', 'penguin', 'pig', 'rabbit',
  'rhino', 'sloth', 'snake', 'walrus', 'whale', 'zebra',
];

// 关卡号 → 稳定种子（FNV-1a）。同一关永远得到同一背景与动物。
function levelSeed(level) {
  const s = 'level-' + level;
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function animalForLevel(level) {
  return LEVEL_ANIMALS[(level - 1) % LEVEL_ANIMALS.length];
}

// 关卡背景：三段天空 + 远/近两层起伏地面。
// 不画任何景物 —— 画面主体由 Kenney 图片叠加，这里只保证背景有层次且颜色可控。
function generateBackdrop(seed, cols, rows) {
  cols = cols || SAND_COLS;
  rows = rows || SAND_ROWS;
  const rnd = mulberry32(seed >>> 0);
  const cells = new Int16Array(cols * rows);
  const pick = (arr) => arr[(rnd() * arr.length) | 0];
  const pickNot = (arr, ...not) => {
    const ok = arr.filter(c => !not.includes(c));
    return ok.length ? pick(ok) : arr[0];
  };

  const sky = pick(SKY_TRIPLES);
  const horizon = Math.round(rows * (0.52 + rnd() * 0.08));
  const b1 = Math.round(horizon * 0.38);
  const b2 = Math.round(horizon * 0.72);
  const band = (y0, y1, c) => {
    const end = Math.min(rows, Math.max(0, y1));
    for (let y = Math.max(0, y0); y < end; y++) cells.fill(c, y * cols, y * cols + cols);
  };
  band(0, b1, sky[0]);
  band(b1, b2, sky[1]);
  band(b2, horizon, sky[2]);

  const far = pickNot([C_PURPLE, C_BLUE, C_BEIGE, C_DARKRED, C_DARKGREEN], sky[0], sky[1], sky[2]);
  const ground = pickNot([C_DARKGREEN, C_GREEN, C_BEIGE, C_DARKRED, C_BLACK],
                         far, sky[0], sky[1], sky[2]);
  const amp = rows * (0.02 + rnd() * 0.03);
  const freq = 0.02 + rnd() * 0.02;
  const phase = rnd() * 6.28;
  const base = rows * (0.86 + rnd() * 0.04);

  for (let x = 0; x < cols; x++) {
    const y = Math.round(base - amp * (Math.sin(x * freq + phase) * 0.62 +
                                      Math.sin(x * freq * 2.37 + phase * 1.7) * 0.38));
    const yFar = Math.max(horizon, Math.min(rows, y));
    for (let yy = horizon; yy < yFar; yy++) cells[yy * cols + x] = far;
    for (let yy = yFar; yy < rows; yy++) cells[yy * cols + x] = ground;
  }
  return cells;
}

// 天空配色（从天顶 → 地平线，三层色带）
// 沙画没法做真渐变，但用 3 条明度递变的色带就能读出纵深，比单一底色强得多。
// 三条必须互不相同：曾经用过 [蓝, 蓝, 白] 的"晴空"，结果蓝色吃掉天空 2/3，
// 再叠上海面倒影后单色占比冲到 52.6%。
const SKY_TRIPLES = [
  [C_PURPLE, C_PINK, C_ORANGE],    // 日落
  [C_BLUE, C_PINK, C_ORANGE],      // 黄昏
  [C_BLUE, C_PURPLE, C_PINK],      // 暮色
  [C_PURPLE, C_BLUE, C_BEIGE],     // 阴天
  [C_DARKGREEN, C_BLUE, C_BEIGE],  // 山间晨雾
  [C_PURPLE, C_BLUE, C_WHITE],     // 晴空
];

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
    const r2 = r * r;
    for (let y = Math.ceil(cy - r); y <= cy + r; y++)
      for (let x = Math.ceil(cx - r); x <= cx + r; x++)
        if ((x - cx) * (x - cx) + (y - cy) * (y - cy) <= r2) setPx(x, y, c);
  };
  // 起伏曲线：两条正弦叠加，用来画丘陵和地面，避免一条条平直色带
  const ridge = (x, base, amp, freq, phase) =>
    base - amp * (Math.sin(x * freq + phase) * 0.62 + Math.sin(x * freq * 2.37 + phase * 1.7) * 0.38);

  const horizon = Math.round(rows * (0.50 + rnd() * 0.10));

  // ---------- 天空：三层色带（天顶 → 地平线） ----------
  const sky = pick(SKY_TRIPLES);
  const b1 = Math.round(horizon * (0.38 + rnd() * 0.10));
  const b2 = Math.round(horizon * (0.70 + rnd() * 0.10));
  fillRect(0, 0, cols, b1, sky[0]);
  fillRect(0, b1, cols, b2 - b1, sky[1]);
  fillRect(0, b2, cols, horizon - b2, sky[2]);

  // ---------- 太阳 / 月亮：外圈光晕 + 内核，比一个纯色圆有存在感 ----------
  const sunR = Math.round(cols * (0.05 + rnd() * 0.04));
  const sunX = Math.round(cols * (0.18 + rnd() * 0.64));
  const sunY = Math.round(b2 * (0.30 + rnd() * 0.45));
  const core = pickNot([C_WHITE, C_ORANGE, C_PINK, C_RED], sky[0], sky[1], sky[2]);
  disc(sunX, sunY, sunR * 2.1, sky[2]);                    // 光晕用最靠地平线那层的色
  disc(sunX, sunY, sunR * 1.35, pickNot([C_ORANGE, C_PINK, C_BEIGE], sky[2], core));
  disc(sunX, sunY, sunR, core);

  // ---------- 云：几个圆堆成蓬松形状，比方块自然 ----------
  const nCloud = 2 + ((rnd() * 4) | 0);
  for (let i = 0; i < nCloud; i++) {
    const cw = cols * (0.10 + rnd() * 0.14);
    const cx = Math.round(rnd() * cols);
    const cy = Math.round(b1 * (0.15 + rnd() * 0.95));
    const cc = pickNot([C_WHITE, C_PINK, C_BEIGE, C_ORANGE], sky[0], sky[1], sky[2], core);
    const lobes = 3 + ((rnd() * 3) | 0);
    for (let k = 0; k < lobes; k++) {
      const t = k / (lobes - 1);
      disc(cx + (t - 0.5) * cw, cy - Math.sin(t * Math.PI) * cw * 0.16,
           cw * (0.13 + Math.sin(t * Math.PI) * 0.10), cc);
    }
  }

  // ---------- 飞鸟 ----------
  const nBird = (rnd() * 4) | 0;
  for (let i = 0; i < nBird; i++) {
    const bx = Math.round(rnd() * cols), by = Math.round(b1 * (0.2 + rnd() * 0.9));
    const s = 2 + ((rnd() * 2) | 0);
    fillRect(bx - s, by, s, 1, C_BLACK);
    fillRect(bx + 1, by, s, 1, C_BLACK);
  }

  // ---------- 地面基准线（逐列起伏） ----------
  // 地形一律填到这条线为止，下面交给"近景地面"。
  // 不能让地形一路填到画面底部：那样最后画的那座山会覆盖掉整个下半屏，
  // 单色占比实测能冲到 55%（山体+地面都是同一个色）。
  const gAmp = rows * (0.02 + rnd() * 0.03);
  const gFreq = 0.02 + rnd() * 0.02;
  const gPhase = rnd() * 6.28;
  const gBase = rows * (0.87 + rnd() * 0.05);
  const groundY = new Int32Array(cols);
  for (let x = 0; x < cols; x++) groundY[x] = Math.round(ridge(x, gBase, gAmp, gFreq, gPhase));

  // ---------- 地形：远层（淡）+ 近层（深），制造纵深 ----------
  const far = pickNot([C_PURPLE, C_BLUE, C_BEIGE, C_DARKRED, C_DARKGREEN], sky[0], sky[1], sky[2]);
  const near = pickNot([C_DARKGREEN, C_DARKRED, C_PURPLE, C_BLUE, C_GREEN], far, sky[0], sky[1], sky[2]);
  const ground = pickNot([C_DARKGREEN, C_GREEN, C_BEIGE, C_DARKRED, C_BLACK], far, near, sky[0], sky[1], sky[2]);

  if (kind === 'mountain') {
    // 远山脊：一串【相连的峰】而不是几个互相重叠的大三角。
    // 大三角的问题：每座跨度接近整幅，几座叠起来会合并成一大坨同色（实测单色冲到 50%）。
    // 山脊用两种远景色交替，把这一条（约画面 1/3）拆成多个色块。
    const far2 = pickNot([C_PURPLE, C_BLUE, C_BEIGE, C_DARKRED, C_DARKGREEN, C_BLACK],
                         far, sky[0], sky[1], sky[2]);
    const nPeak = 5 + ((rnd() * 5) | 0);
    const peaks = [];
    for (let k = 0; k <= nPeak; k++) {
      peaks.push({
        x: cols * k / nPeak,
        h: (k === 0 || k === nPeak) ? 0 : rows * (0.05 + rnd() * 0.15),
      });
    }
    for (let x = 0; x < cols; x++) {
      let k = 0;
      while (k < peaks.length - 2 && peaks[k + 1].x < x) k++;
      const a = peaks[k], b = peaks[k + 1];
      const t = (x - a.x) / Math.max(1, b.x - a.x);
      const yTop = Math.round(horizon - (a.h + (b.h - a.h) * t));
      fillRect(x, yTop, 1, groundY[x] - yTop, (k % 2) ? far : far2);
    }
    // 近山：一两座明显的峰，压在远山脊前面
    const nNear = 1 + ((rnd() * 2) | 0);
    for (let m = 0; m < nNear; m++) {
      const px = cols * (0.25 + rnd() * 0.5);
      const py = horizon - rows * (0.10 + rnd() * 0.12);
      const hw = cols * (0.12 + rnd() * 0.10);
      const snow = rnd() < 0.5;
      for (let x = Math.floor(px - hw); x <= px + hw; x++) {
        if (x < 0 || x >= cols) continue;
        const t = 1 - Math.abs(x - px) / hw;
        if (t <= 0) continue;
        const yTop = Math.round(horizon + (py - horizon) * t);
        fillRect(x, yTop, 1, groundY[x] - yTop, near);
        if (snow) fillRect(x, yTop, 1, Math.max(1, Math.round((horizon - yTop) * 0.18)), C_WHITE);
      }
    }

  } else if (kind === 'city') {
    // 远景楼群：细、矮、用远景色（大气透视）
    let x = 0;
    while (x < cols) {
      const w = Math.round(cols * (0.02 + rnd() * 0.03));
      const h = Math.round(rows * (0.05 + rnd() * 0.10));
      fillRect(x, horizon - h, w, groundY[Math.min(cols - 1, x)] - (horizon - h), far);
      x += w + Math.round(cols * (0.004 + rnd() * 0.012));
    }
    // 近景楼群：粗、高、带窗户
    x = 0;
    while (x < cols) {
      const w = Math.round(cols * (0.04 + rnd() * 0.055));
      const h = Math.round(rows * (0.10 + rnd() * 0.28));
      const bc = pickNot([C_PURPLE, C_DARKRED, C_BLACK, C_BLUE, C_RED, C_DARKGREEN],
                         far, sky[0], sky[1], sky[2]);
      const gy = groundY[Math.min(cols - 1, x)];
      fillRect(x, horizon - h, w, gy - (horizon - h), bc);
      const winC = pickNot([C_ORANGE, C_WHITE, C_PINK, C_BEIGE], bc);
      for (let wy = horizon - h + 5; wy < Math.min(gy, horizon) - 4; wy += 8)
        for (let wx = x + 3; wx < x + w - 4; wx += 7)
          if (rnd() < 0.5) fillRect(wx, wy, 3, 4, winC);
      x += w + Math.round(cols * (0.006 + rnd() * 0.018));
    }

  } else if (kind === 'sea') {
    // 海面：用天空色【倒序】铺，读起来像倒影
    const refl = [sky[2], sky[1], sky[0], near];
    const bands = 5 + ((rnd() * 3) | 0);
    for (let b = 0; b < bands; b++) {
      const y0 = horizon + Math.round((rows - horizon) * b / bands);
      const y1 = horizon + Math.round((rows - horizon) * (b + 1) / bands);
      const c = refl[Math.min(b, refl.length - 1)];
      const amp = 1.5 + rnd() * 3;
      for (let y = y0; y < y1; y++) {
        const base = y * cols;
        for (let xx = 0; xx < cols; xx++)
          if (y >= y0 + Math.round(Math.sin((xx + b * 41) * 0.055) * amp)) cells[base + xx] = c;
      }
    }
    // 日光在海面的反光带
    if (sunY < horizon) {
      const glit = pickNot([C_WHITE, C_ORANGE, C_BEIGE], sky[2], sky[1], sky[0], near);
      for (let y = horizon; y < rows; y += 3) {
        const w = Math.max(1, Math.round(cols * 0.05 * (1 - (y - horizon) / (rows - horizon))));
        fillRect(sunX - w + Math.round(Math.sin(y * 0.3) * w * 0.5), y, w * 2, 1, glit);
      }
    }

  } else { // field：远丘 + 中景丘 + 树（两层丘用不同色，否则一整片地面就是同一个色）
    const far2 = pickNot([C_PURPLE, C_BLUE, C_BEIGE, C_DARKRED, C_DARKGREEN, C_BLACK],
                         far, sky[0], sky[1], sky[2]);
    const hAmp = rows * (0.05 + rnd() * 0.06);
    const hFreq = 0.016 + rnd() * 0.014;
    const hPhase = rnd() * 6.28;
    for (let x = 0; x < cols; x++) {
      const yTop = Math.round(ridge(x, horizon + hAmp * 0.4, hAmp, hFreq, hPhase));
      fillRect(x, yTop, 1, groundY[x] - yTop, far);
    }
    const m2Amp = rows * (0.035 + rnd() * 0.045);
    const m2Freq = 0.02 + rnd() * 0.018;
    const m2Phase = rnd() * 6.28;
    const m2Base = horizon + rows * (0.12 + rnd() * 0.08);
    for (let x = 0; x < cols; x++) {
      const yTop = Math.round(ridge(x, m2Base, m2Amp, m2Freq, m2Phase));
      fillRect(x, yTop, 1, groundY[x] - yTop, far2);
    }
    const nTree = 5 + ((rnd() * 5) | 0);
    for (let i = 0; i < nTree; i++) {
      const tx = Math.round(rnd() * cols);
      const ty = Math.round(ridge(tx, m2Base, m2Amp, m2Freq, m2Phase)) + Math.round(rows * 0.02);
      const th = Math.round(rows * (0.07 + rnd() * 0.09));
      const tw = Math.max(3, Math.round(th * 0.42));
      const leaf = pickNot([C_DARKGREEN, C_GREEN, C_PURPLE, C_DARKRED], far, far2, near);
      for (let y = ty - th; y < ty; y++) {
        const t = (y - (ty - th)) / th;
        const w = Math.max(1, Math.round(tw * t));
        fillRect(tx - w, y, w * 2, 1, leaf);
      }
      fillRect(tx - 1, ty, 3, Math.max(2, Math.round(th * 0.22)), C_DARKRED);
    }
  }

  // ---------- 近景地面：沿基准线盖住地形下半部（海面除外） ----------
  if (kind !== 'sea') {
    for (let x = 0; x < cols; x++) fillRect(x, groundY[x], 1, rows - groundY[x], ground);
    // 地面上的石头：圆形，不是随机撒的方块
    const nRock = 3 + ((rnd() * 4) | 0);
    for (let i = 0; i < nRock; i++) {
      const rx = Math.round(rnd() * cols);
      const ry = groundY[rx] + Math.round(rnd() * rows * 0.05);
      disc(rx, ry, 2 + ((rnd() * 3) | 0), pickNot([C_BLACK, C_BEIGE, C_DARKRED], ground, far, near));
    }
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

    // 扫描顺序表：整行列顺序的若干组随机排列，每行随机选一组（见文件顶部说明）
    this.scanOrders = [];
    let seed = 987654321 >>> 0;
    const next = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    for (let v = 0; v < SCAN_VARIANTS; v++) {
      const a = new Uint16Array(this.cols);
      for (let i = 0; i < this.cols; i++) a[i] = i;
      for (let i = this.cols - 1; i > 0; i--) {          // Fisher-Yates
        const j = (next() * (i + 1)) | 0;
        const t = a[i]; a[i] = a[j]; a[j] = t;
      }
      this.scanOrders.push(a);
    }
  }

  clear() {
    this.cells.fill(-1);
  }

  // 落沙模拟：从下往上逐行扫描，直落优先，否则斜滑（两边都试）。
  // 返回移动的格数——0 表示已静止（调用方可据此休眠，避免空转）。
  // 落沙模拟：从下往上逐行扫描，直落优先，否则斜滑（两边都试）。
  // 行内按【随机分块顺序】处理，打散方向性偏置（见文件顶部 SCAN_ORDERS 的说明）。
  // 返回移动的格数——0 表示已静止（调用方可据此休眠，避免空转）。
  tick() {
    const { cols, rows, cells } = this;
    let s = this.rndState | 0;
    let moved = 0;
    const dirty = this._dirty ? this._dirty : (this._dirty = []);
    dirty.length = 0;

    for (let r = rows - 2; r >= 0; r--) {
      const base = r * cols, below = base + cols;
      // 每行随机挑一组列顺序，打散方向性偏置
      s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
      const order = this.scanOrders[(s >>> 28) & (SCAN_VARIANTS - 1)];

      for (let k = 0; k < cols; k++) {
        const c = order[k];
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
// 各列长度尽量均分（10 个分 4 列 → 3,3,2,2，而不是 ceil 分块的 3,3,3,1）。
function dealInto(plates, n) {
  const cols = [];
  const base = Math.floor(plates.length / n);
  const extra = plates.length % n;
  let i = 0;
  for (let k = 0; k < n; k++) {
    const size = base + (k < extra ? 1 : 0);
    if (size === 0) continue;
    cols.push(plates.slice(i, i + size));
    i += size;
  }
  return cols.length ? cols : [[]];
}

// 开局分配：按颜色【轮流取】后再连续分块。
//
// 两个目标同时满足：
//   1. 同色不要在一列里连成一片 —— 那样玩家能背出"红色在第 3 列"，可玩性低
//   2. 每列头部尽量是不同颜色 —— 可见的 10 个槽位要覆盖更多色，否则找不到要用的盘子
//
// 单纯随机打乱只能满足第 1 条：实测可见颜色反而从 6 种降到 5.5 种，
// 因为各颜色的盘子数极不均匀（有的色 1 盘、有的色 20 盘），随机抽样会反复抽到多的那几个。
function distributeToQueues(plates, maxCols) {
  const byColor = new Map();
  for (const p of plates) {
    if (!byColor.has(p.color)) byColor.set(p.color, []);
    byColor.get(p.color).push(p);
  }
  // 颜色顺序随机（否则总是同一色开头），同色内大容量在前
  const groups = shuffle([...byColor.values()]);
  for (const gp of groups) gp.sort((a, b) => b.capacity - a.capacity);

  // 轮流从每种颜色取一个，直到取完
  const seq = [];
  let pending = groups.filter(gp => gp.length > 0);
  while (pending.length > 0) {
    const next = [];
    for (const gp of pending) {
      seq.push(gp.shift());
      if (gp.length > 0) next.push(gp);
    }
    pending = next;
  }

  const n = Math.max(1, Math.min(maxCols || MAX_QUEUE_COLS, seq.length));
  return dealInto(seq, n);
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
  constructor(width, slotCount, origin) {
    this.window = width;                  // 可视窗口宽度（= 画布宽度，含棋盘两侧留白）
    this.origin = origin || 0;            // 沙盘左边界在画布上的 x（左右留白宽度）
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

  // 槽位 i 覆盖的列区间 [c0, c1)（按容差展开）。屏幕外、或走到两侧留白区的槽位返回空区间。
  slotColumns(i, cellPx) {
    const x = this.slotX(i);
    if (x >= this.window) return [0, 0];
    const local = x - this.origin;
    const span = this.window - this.origin * 2;   // 沙盘可视宽度
    if (local < 0 || local >= span) return [0, 0];
    const c0 = Math.max(0, Math.floor((local - ABSORB_TOL) / cellPx));
    const c1 = Math.min(Math.round(span / cellPx), Math.ceil((local + ABSORB_TOL) / cellPx));
    return c0 < c1 ? [c0, c1] : [0, 0];
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
    LEVEL_ANIMALS, levelSeed, animalForLevel, generateBackdrop,
    splitPlates, shuffle, distributeToQueues, rebalanceQueues,
  };
}
