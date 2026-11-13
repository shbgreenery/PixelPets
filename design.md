# PixelPets 设计规范

适用范围：`levels.html`（共用选关页）、`animal-elimination.html`（动物消除）、`sand-painting.html`（沙画）。
本文档只记录这三处已经落地的设计决定，以及改动时不能破坏的约束。数值均来自当前源码，改代码后请同步更新。

最后更新：2026-11-13

---

## 1. 总览

### 页面关系

```
index.html（游戏入口，暂未改造）
   └─ levels.html?game=<id>   选关页
        └─ <game>.html?level=N  游戏页（第 N 关）
```

`LEVEL_GAMES` 里有四个游戏共用选关页：`sand-painting`、`animal-elimination`、`link2d`、`express-delivery`。
本文档的视觉规范只覆盖沙画、动物消除、选关页三处；`link2d` 与 `express-delivery` 仍各自保留原有样式。

### 一句话方向

**深暖炭色桌面 + 纸白内容 + 单一琥珀强调色 + 黄铜细线。**
环境永远是暗的，颜色只留给玩法本身；UI 退到背景里，不跟棋盘抢注意力。

---

## 2. 色彩

### 2.1 深色侧（环境与 UI）

| 令牌 | 值 | 用途 | 不要用于 |
|---|---|---|---|
| `night` | `#1A1512` | 页面底色、画布背景 | 文字 |
| `nightTop` | `#2C231B` | 径向渐变顶部 | 大面积填充 |
| `nightBottom` | `#100D0A` | 径向渐变底部 | 卡片底 |
| `surface` | `#201A15` | HUD 条、次级面板 | 主按钮 |
| `surfaceHi` | `#2C241D` | HUD 高亮、未激活按钮 | 正文背景 |
| `line` | `#4A3B2C` | 分隔线、次级描边 | 文字 |
| `brass` | `#D9A75C` | 画框、黄铜线 | 文字、实心填充 |
| `brassDeep` | `#8A6534` | 黄铜渐变暗端 | 单独使用 |
| `amber` | `#E0A44A` | 唯一强调色，见规则 | 装饰性使用 |
| `amberSoft` | `#B47A2E` | 琥珀底按钮的描边 | 主色 |
| `text` | `#F5EFE6` | 正文、数字 | 纸面背景上 |
| `textDim` | `#A99C8C` | 说明文字、副标题 | 关键信息 |
| `danger` | `#C4553F` | 破坏性操作 | 普通强调 |
| `success` | `#7FAE72` | 完成反馈 | 普通强调 |
| `plateRing` | `#14100C` | 盘子/徽章外圈 | 其他 |

### 2.2 纸面侧（弹窗、关卡数字）

| 令牌 | 值 | 用途 |
|---|---|---|
| `paper` | `#F5EFE4` | 纸卡底、关卡数字 |
| `paperDeep` | `#EADFCF` | 次级纸面按钮 |
| `paperLine` | `#D8C9B0` | 纸卡描边 |
| `ink` | `#2A231D` | 纸面上的标题 |
| `inkSoft` | `#5A4C3D` | 纸面上的正文 |
| `inkMuted` | `#6E6252` | 纸面上的次要文字 |

沙画的 `C` 里没有 `paperDeep`、`inkSoft`、`inkMuted` 三项，用到时按上表补。

### 2.3 颜色使用规则

1. **琥珀是稀缺资源。** 同一屏只允许一处实心琥珀，代表「当前唯一该点的动作」。选关页里它属于继续卡；单页平铺时属于「继续」那一格；游戏里属于主按钮。
2. **黄铜只做线，不做面。** 画框、分隔、HUD 边框用 `brass`，不要拿它填按钮或写字。
3. **纸白只做小面积。** 弹窗、关卡数字、纸面按钮。不要用纸白铺整页背景。
4. **颜色不能是唯一线索。** 状态同时要有文字、图标或形状（例如未解锁格是虚线框 + 锁形 + 「未解锁」读屏文本）。
5. **游戏内颜色属于玩法。** 动物消除的 16 组颜色、沙画的 11 种沙色都是玩法信息，UI 不得使用相近的饱和色。

### 2.4 对比度基线

- `text` / `night` ≈ 15:1
- `textDim` / `night` ≈ 6.6:1
- `ink` / `amber` ≈ 8.1:1（琥珀底必须配墨色字，不要用白字）
- 未解锁格的淡化数字约 4.6:1，配合虚线框与锁图标使用

### 2.5 两种写法

游戏页是 Phaser，用 `const C = { amber: 0xE0A44A, ... }`；选关页是纯 CSS，用 `:root` 变量：

```css
:root {
  --night: #1A1512;
  --night-top: #2C231B;
  --night-bottom: #100D0A;
  --paper: #F5EFE4;
  --amber: #E0A44A;
  --amber-hi: #F0BE72;
  --ink: #1A1512;
  --text: #F5EFE6;
  --text-dim: #A99C8C;
  --line: rgba(245, 239, 228, 0.10);
  --line-hi: rgba(245, 239, 228, 0.20);
}
```

同一颜色改一处时，另一处必须一起改。

**一处已知差异**：选关页的 `--ink` 取的是 `#1A1512`（与 `night` 同值），游戏内的 `C.ink` 是 `#2A231D`。两者都用在琥珀底上的文字，对比度分别约 8.1:1 和 7.5:1，肉眼差异极小。后续统一时以 `#2A231D` 为准。

---

## 3. 字体

三套字体栈，职责不重叠：

```js
const FONT_UI      = '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", sans-serif';
const FONT_DISPLAY = '"Songti SC", "Noto Serif SC", "STSong", "SimSun", serif';
const FONT_NUM     = '"SF Mono", "Menlo", "Consolas", "Courier New", monospace';
```

| 字体 | 用在哪里 | 不用在哪里 |
|---|---|---|
| `FONT_UI` | 说明文字、按钮标签、副标题、正文 | 标题、数字 |
| `FONT_DISPLAY` | 页面标题、游戏名、弹窗标题、继续卡的大号关卡 | 长段正文 |
| `FONT_NUM` | 所有数字：关卡号、计数、倍速、页码区间 | 中文标签 |

规则：

- 数字一律用 `FONT_NUM`，并开 `font-variant-numeric: tabular-nums`，避免跳动。
- 中文标题用宋体而不是黑体加粗，这是「标本桌」气质的一半。
- 选关页里对应 `--font-ui` / `--font-display` / `--font-num`。

---

## 4. 材质与背景

三页共用同一层桌面：

```css
body {
  background: radial-gradient(120% 80% at 50% -10%, var(--night-top) 0%, var(--night) 52%, var(--night-bottom) 100%);
}
/* 细颗粒，只做材质 */
body::before {
  content: ""; position: fixed; inset: 0; z-index: 0; pointer-events: none;
  opacity: 0.035;
  /* 完整的 SVG feTurbulence data URI 见三个文件里的 body::before，三处必须逐字一致 */
  background-image: url("data:image/svg+xml,...");
}
/* 暗角 */
body::after {
  content: ""; position: fixed; inset: 0; z-index: 0; pointer-events: none;
  box-shadow: inset 0 0 200px rgba(0, 0, 0, 0.55);
}
```

游戏页另外给画布加 `filter: drop-shadow(0 26px 60px rgba(0,0,0,0.55))`，让棋盘浮在桌面上。

不要引入玻璃拟态、大面积渐变卡片或霓虹发光，这套语言的材质只靠底色、颗粒和细线。

---

## 5. 间距与圆角

- 间距走 4 的倍数，常用档位：4 / 8 / 12 / 16 / 20 / 24 / 32 / 48 / 64。
- 页面内边距：桌面 `24px 20px 64px`，≤420px 时 `20px 16px 48px`。
- 内容最大宽度：`960px`。
- 圆角：关卡格 `12px`、游戏卡 `14px`、纸卡弹窗 `18px`、按钮为胶囊（`高度 / 2`）、小标签 `8–10px`。
- 触控目标不小于 `44×44px`，相邻目标间隔不小于 `8px`。

---

## 6. 组件

### 6.1 主按钮 `makeCartoonButton`

动物消除与沙画共用。规格：

```
文字 22px（UI，bold）   横向内边距 1.4 倍字号
高度 = 字号 + 1.2 倍字号，圆角 = 高度 / 2
阴影：黑色 0.18，偏移 (2, 4)
底色：amber
描边：amberSoft 1px
高光：白色 0.14，高度 36% 的圆角矩形，距顶 4px
文字色：#241C15
```

交互：hover `scale 1.02`、按下 `0.97`、松开回 `1`。
禁用态：底色换 `surfaceHi`，字色 `inkMuted`，不要只降透明度。

### 6.2 幽灵按钮 `makeGhostButton`

`110×38` 基准尺寸，透明底 + `line` 描边 + `text` 文字，用于「取消」「跳过」这类次要动作。

### 6.3 纸卡弹窗 `drawPaperPanel`

```
尺寸 420×230（基准，随 UI_SCALE 缩放）
纸底 paper，描边 paperLine 1px，圆角 18
投影：黑色 0.28，偏移 (6, 8)
橙色短横线：48×3，圆角 1.5，位于标题下方
标题：24px，FONT_DISPLAY，ink
正文：17px，FONT_UI，inkSoft，行距 6，折行宽度 356
确认按钮：18px
```

进出场：`alpha 0→1`、`scale 0.96→1`、`200ms`、`Cubic.easeOut`。关闭直接隐藏，不做退场动画。
遮罩：`#0B0806`、透明度 `0.72`。

### 6.4 关卡格

四种状态，全部由 `getMaxLevel()` 一个数字推导：

| 类名 | 含义 | 视觉 | 可点 |
|---|---|---|---|
| `.is-open` | 已解锁、非当前 | 纸面感低对比底 `rgba(245,239,228,0.05)`，纸白数字 | 是 |
| `.is-current` | 当前进度（分页模式） | 琥珀描边 `rgba(224,164,74,0.55)` + 淡琥珀底 `0.12` + 格内「当前」 | 是 |
| `.is-next` | 当前进度（单页模式） | 琥珀实底 + 墨色数字 + 格内「继续」 | 是 |
| `.is-locked` | 未解锁 | 虚线框 + 小锁图标 + 数字淡化到 46% | 否 |

规格：最小 `84px`、`aspect-ratio: 1/1`、圆角 `12`、间距 `12`、数字 `1.55rem` 等宽。
未解锁格用 `<div>` 而不是 `<a>`：不进 Tab 序列，也不能被点到。
超过当前关后最多补 3 个未解锁预览格（`LOCKED_PREVIEW = 3`）。

### 6.5 继续卡

分页模式下页面唯一的实心琥珀块。

```
整行，padding 20px 24px，圆角 14
底色 amber，文字 ink
小标签「继续」0.72rem，字距 0.18em，透明度 0.7
大号「第 N 关」1.6rem，FONT_DISPLAY，600，nowrap
右侧「进入 →」0.95rem，aria-hidden
```

### 6.6 分页条

- 每页 20 关（`PAGE_SIZE = 20`），桌面固定 10 列，正好两整行；≤860px 五列；≤460px 三列。
- 默认打开最后一页，并在用户停留于末页时持续跟随最新进度。
- 页码标签写关卡区间（`41–50`），不写序号。
- 页码窗口：首页、末页、当前页及左右各一页，其余用省略号。
- 上一页/下一页在到头时 `disabled`。
- 按钮最小 44px、纸白焦点环、当前页 `aria-current="page"`。

### 6.7 游戏卡（选关页列表）

`min-height 88px`，圆角 14，`rgba(245,239,228,0.04)` 底 + `line` 描边；游戏名 1.25rem `FONT_DISPLAY`，下方「已解锁 N 关」，右侧箭头随 hover 右移 3px。

---

## 7. 关卡与进度模型

数据全部来自 `level-kit.js`：

```js
levelHash(gameId, level)   // 游戏 + 关卡号 → 32 位稳定种子
levelRng(seed)             // mulberry32
getMaxLevel(gameId)        // 唯一进度数据：最高已解锁关，最小 1
unlockLevel(gameId, level) // 只增不减
getLevelFromUrl()          // ?level=N
```

约束：

- **只有 `maxLevel` 一个数字**，没有每关是否通关的记录。因此界面只能写「已解锁」，不能写「已通关」——用 `?level=100` 直接跳关并获胜会让记录失真。
- **不虚构总关数**。关卡是程序生成的，没有上限。任何百分比进度条都是编的。
- 术语统一：已解锁 / 当前 / 未解锁。不要出现「通关率」「完成度」。
- 存档键 `pixelpets.maxLevel.<gameId>`，沙画兼容旧键 `sandPainting.maxLevel`。不要改这两个键。

---

## 8. 页面流与导航

- `levels.html` 只有在带 `?game=` 时才直接进关卡视图；否则显示游戏列表。
- 点游戏卡片时**在页内切换**，不依赖地址栏参数（预览器会吞参数）。能 `history.replaceState` 就顺手写上，失败不影响结果。
- 返回按钮随入口变化：从列表进来的显示「← 选择游戏」，原地退回列表；带参数进来的显示「← 全部游戏」。
- 切换视图后焦点落到 `h1`（`tabindex="-1"`），键盘用户不丢位置。
- 游戏页用 `location.replace()` 跳下一关，避免在历史记录里堆关卡。因此按浏览器后退会回到选关页。

---

## 9. 动效

- 时长：交互反馈 160ms，列表入场 240ms，弹窗 200ms。
- 缓动：`cubic-bezier(0.2, 0.7, 0.3, 1)`；弹窗用 `Cubic.easeOut`。
- 关卡格入场：`translateY(8px) + opacity 0→1`，错峰 `35ms`，超过 10 个不再累加延迟。
- 只动 `transform` 与 `opacity`，不动 `width` / `height` / `top` / `left`。
- `prefers-reduced-motion: reduce` 下关闭全部动画与位移，保留状态样式。

---

## 10. 可达性

- 所有可点元素有 `:focus-visible` 纸白描边：`2px solid var(--paper)`、`outline-offset: 3px`。
- 可点卡片自己有 `color` 和 `text-decoration: none`，不吃浏览器默认链接样式。
- 关卡格 `aria-label="第 N 关"`；当前关追加「，当前进度」；未解锁格附带「未解锁」读屏文本。
- 分页当前项用 `aria-current="page"`，不靠颜色单独表达。
- 章节、按钮类控件用真实 `<button>`，Enter / Space 原生可用。
- 布局在系统字体放大与 375px 宽度下不横向滚动。

---

## 11. 文件与改动范围

| 文件 | 角色 | 可否随意改 |
|---|---|---|
| `levels.html` | 共用选关页，单文件含样式与逻辑 | 可改，本文档主对象 |
| `animal-elimination.html` | 动物消除主文件 | 可改视觉层，玩法模块别碰 |
| `sand-painting.html` | 沙画主文件 | 同上 |
| `level-kit.js` | 关卡工具与存档 | 只读，改需同步四个游戏 |
| `sand-core.js` / `bfs.js` | 纯逻辑 | 不动 |
| `animal-assets.js` | 30 张动物 PNG 的 data URI | 不动 |
| `index.html` | 游戏入口 | 仍是原紫色渐变，未纳入本规范 |

不要改的：

- 存档键名、`levelHash` 种子算法（改了会让同一关的布局变化）。
- 游戏内的 16 组颜色与动物绑定、沙画的 11 色板。
- `animal-assets.js` 与 HTML 必须同目录，`file://` 下靠内嵌 data URI 才能跑。

---

## 12. 已知未完成

1. `index.html` 仍是紫色渐变 + 玻璃卡片，与本文档的材质语言不一致，从首页进选关会有一次风格跳变。
2. 四个游戏页都没有「返回选关」按钮，只能靠浏览器后退。
3. 选关页刷新后会回到最后一页，不记住上次浏览的页码（这是刻意的默认行为，若要改见第 6.6 节）。
4. `link2d` 与 `express-delivery` 仍是各自原有配色，未统一。

---

## 13. 改动前自检

- [ ] 新增颜色是否来自第 2 节，还是随手写了一个近似值
- [ ] 这一屏是不是出现了两处实心琥珀
- [ ] 数字是否用了 `FONT_NUM` 等宽
- [ ] 状态是否只靠颜色表达
- [ ] 触控目标是否 ≥ 44px，是否进了 Tab 序列
- [ ] 动效是否在 `prefers-reduced-motion` 下关闭
- [ ] 文案是否误用了「已通关」「完成度」
- [ ] 改动后 `levels.html` 是否同步到了 `PixelPets/levels.html`
