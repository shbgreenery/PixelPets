// 深夜农场设计 token：土壤底、操作台面、语义色、凹槽、圆角与字号档位。
// 颜色只承担语义：琥珀=当前可做，草绿=生长中，麦黄=成熟，土红=短缺/不可用。

export const PALETTE = {
  night0: "#120f09",
  night1: "#191410",
  night2: "#221b14",
  night3: "#2b2318",
  night4: "#372c1f",
  line: "rgba(226, 193, 141, 0.13)",
  lineStrong: "rgba(226, 193, 141, 0.26)",
  ink: "#f3e9d7",
  ink2: "#cbb99e",
  ink3: "#a5947d",
  amber: "#e8a33d",
  amberSoft: "#ffc76b",
  amberInk: "#211509",
  grass: "#6f9448",
  grassSoft: "#a9c978",
  clay: "#b5643e",
  claySoft: "#d98052",
  clayInk: "#24100a",
} as const;

// Phaser 只接受 0xRRGGBB，场景层一律引用这里，不写字面色号。
export const STAGE_COLOR = {
  night0: 0x120f09,
  night1: 0x191410,
  night2: 0x221b14,
  night3: 0x2b2318,
  night4: 0x372c1f,
  soil: 0x2f2619,
  soilEmpty: 0x271f16,
  soilRipe: 0x3b2c1b,
  tray: 0x34291c,
  line: 0x7a6648,
  amber: 0xe8a33d,
  amberSoft: 0xffc76b,
  grass: 0x6f9448,
  grassSoft: 0xa9c978,
  clay: 0xb5643e,
  claySoft: 0xd98052,
  ink: 0xf3e9d7,
  ink2: 0xcbb99e,
  ink3: 0xa5947d,
  black: 0x000000,
  white: 0xffffff,
} as const;

// DOM 层色值：语义与 PALETTE 一一对应。
export const COLORS = {
  amber: PALETTE.amber,
  amberSoft: PALETTE.amberSoft,
  amberInk: PALETTE.amberInk,
  panel: PALETTE.night2,
  panelBorder: PALETTE.line,
  panelBorderStrong: PALETTE.lineStrong,
  text: PALETTE.ink,
  muted: PALETTE.ink3,
  subtle: PALETTE.ink2,
  grass: PALETTE.grassSoft,
  clay: PALETTE.claySoft,
} as const;

export const RADIUS = { sm: "9px", md: "12px", lg: "16px" } as const;

export const SPACING = { xs: 4, sm: 8, md: 12, lg: 16 } as const;

export const FONT_SIZE = { xs: 10.5, sm: 12, md: 13.5, lg: 15, xl: 18.5 } as const;

export const FONT_FAMILY = {
  sans: '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", system-ui, sans-serif',
  serif: '"Songti SC", "Noto Serif SC", "Source Han Serif SC", Georgia, serif',
  num: '"SF Mono", ui-monospace, Menlo, Consolas, monospace',
} as const;

export const FONT = `${FONT_SIZE.md}px ${FONT_FAMILY.sans}`;

// 卡片与操作台的投影，保证层级只在"台面比土壤亮一档"上表达。
export const SHADOW = {
  card: "inset 0 1px 0 rgba(255, 226, 178, 0.05), 0 10px 24px -16px rgba(0, 0, 0, 0.9)",
  panel: "0 26px 50px -42px rgba(0, 0, 0, 0.95)",
} as const;

// 台面渐变：卡片、分区、种子格、HUD 与底部入口各自只在亮度上差一档。
export const SURFACE = {
  card: "linear-gradient(180deg, #2b2218, #1f1911)",
  section: "linear-gradient(180deg, #2f2619, #271f16)",
  seed: "linear-gradient(180deg, #31271b, #292016)",
  seedSelected: "linear-gradient(180deg, #42311d, #2f2517)",
  overlay: "rgba(9, 7, 4, 0.72)",
  hud: "linear-gradient(180deg, rgba(38, 29, 20, 0.92), rgba(25, 20, 16, 0.9))",
  dock: "linear-gradient(180deg, rgba(30, 24, 17, 0.94), rgba(21, 17, 12, 0.97))",
  resource: "linear-gradient(180deg, #2a2218, #211a13)",
  activeAmber: "linear-gradient(180deg, rgba(232, 163, 61, 0.14), rgba(232, 163, 61, 0.045))",
  daily: "linear-gradient(180deg, rgba(72, 51, 28, 0.8), #2a2117)",
} as const;

// 禁用态：与 hover 无关的实色，明确"现在不能做"。
export const DISABLED = {
  fill: "#3a3126",
  line: "#463a2c",
  ink: "#a3937e",
  ghostInk: "#8a7c68",
} as const;

// 圆形图标凹槽：内阴影压住 emoji 的亮度，让它不抢文字层级。
export const GROOVE = {
  background: "radial-gradient(circle at 35% 24%, #443426, #241c14)",
  shadow: "inset 0 1px 0 rgba(255, 220, 170, 0.12), inset 0 -2px 5px rgba(0, 0, 0, 0.55)",
  filter: "saturate(0.88) contrast(1.03)",
} as const;
