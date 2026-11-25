# 农场渲染层：从 Phaser 画布迁移到原生 DOM

2026-11-25

## 背景

家里那台 4K + 30Hz 的机器上，`slow-farm-pc` 帧率只有 15~20，点击"收获"等按钮有明显延迟。

诊断证据：

- 把窗口调小，帧率立刻上升 —— 帧率与画布像素面积成反比；
- `display/stage.ts` 的渲染上限为 3，4K 屏上后备画布是 3840×2160（约 830 万像素）；
- Phaser 的循环是"每帧清屏 + 全量重绘"，画面静止也照画不误；
- `scenes/PlotView.ts` 成熟地块的呼吸光晕用了 `repeat: -1` 的 tween，
  只要有一块地成熟，画布就永远不停地在重绘；
- 重绘占满主线程 / rAF，点击事件的处理被推迟，表现为"点了没反应"。

结论：这是**填充率和渲染循环模型**的问题，不是 30Hz 天花板，也不是业务逻辑慢。

## 目标

- 静止时零重绘、点击即时响应、滚动与动画不阻塞主线程；
- 移除 `phaser` 运行时依赖；
- 视觉与交互和现在**逐像素对齐**（同一套 1280×720 设计单位、同样的配色与动效）。

## 非目标

- 不做响应式重排：耕地列数、侧栏宽度、面板位置仍锁定 1280×720 设计单位；
- 不改服务端、存档、API 契约；
- 不改 8 个功能面板、HUD、种子条 —— 它们本来就是 DOM；
- 不追求 60fps：显示器物理刷新率是上限，DOM 化只保证"稳定跑满上限 + 低延迟"。

## 方案

把"仍然画在 canvas 上的四块"换成 DOM：

| 现在的 Phaser 对象 | 职责 |
| --- | --- |
| `FarmScene` | 编排：背景、分区标题、地块网格、畜舍、底部入口、toast 与收获反馈 |
| `PlotView` | 单块地：土壤底、作物图标、倒计时、进度条、可收获角标与呼吸光晕 |
| `BarnView` | 畜舍：三个栏位的卡片、围栏、进度条、状态文字 |
| `DockView` | 底部 7 个建筑入口、高亮态、订单角标 |

业务层（`state/store.ts`、`api/client.ts`、`display/format.ts`、`display/viewModels.ts`、
`display/icons.ts`、`display/barnView.ts`）**完全不动**，13 个测试文件里 12 个不受影响。

### 目标结构

```
client/src/
├─ display/                     纯展示逻辑，基本不变
│   ├─ stage.ts                 简化：只保留 fit 缩放，删除 renderScale 系列
│   ├─ plotView.ts              新：从 scenes/PlotView.ts 移入纯函数
│   ├─ theme.ts / format.ts / viewModels.ts / icons.ts / motion.ts / barnView.ts   不变
├─ ui/                          DOM 组件层
│   ├─ Hud.ts / *Panel.ts / panelStyles.ts                                        不变
│   ├─ FarmView.ts              新：编排（替代 FarmScene）
│   ├─ PlotCellView.ts          新：地块 DOM
│   ├─ BarnRackView.ts          新：畜舍 DOM
│   └─ DockBar.ts               新：底部入口 DOM
├─ state/store.ts              不变
├─ api/client.ts               不变
└─ main.ts                     改：去掉 Phaser.Game，只留 store + 视图 + 轮询
```

删除 `client/src/scenes/` 整个目录。

### 视觉还原对照表

下表是**几何转写的提示，不是规范**。实现时以现有画布的输出为准，逐条转写几何
（犁沟是 2px 线、从 `top + 8` 起每 11px 一条、横向 14px 内缩；背景两个径向渐变的
圆心 `(640, -40)` / `(640, 760)` 与半径 800 / 600 照抄 `FarmScene.createBackground`）。
CSS 与 canvas 的抗锯齿算法不同，"逐像素"指**人眼一致**，以迁移前的画布截图作为比对基线。

| Phaser 原语 | 位置 | DOM 等价物 |
| --- | --- | --- |
| 径向渐变背景纹理 | `FarmScene.createBackground` | `#stage` 的 `background: radial-gradient(...), radial-gradient(...), #120f09` |
| `fillRoundedRect` 地块底 | `PlotView.paintCard` | `div` + `border-radius: 14px` + 语义底色 |
| 犁沟横向循环 `lineBetween` | `PlotView.paintCard` | `repeating-linear-gradient(180deg, transparent 0 9px, rgba(0,0,0,.16) 9px 11px)` |
| 内阴影 `strokeRoundedRect` | `PlotView.paintCard` | `box-shadow: inset 0 0 0 2px rgba(0,0,0,.35)` |
| 顶部受光边 | `PlotView.paintCard` | `box-shadow: inset 0 1px 0 rgba(255,255,255,.045)` |
| 琥珀呼吸光晕 tween | `PlotView.applyStage` | `@keyframes` + `animation: breathe 1.3s ease-in-out infinite alternate` |
| 成熟描边色切换 | `PlotView.applyStage` | `.plot[data-stage="ready"]` 选择器 |
| 收获粒子（10 个 circle） | `PlotView.playHarvest` | 10 个 `span` + Web Animations API `el.animate()` |
| 上浮飘字 | `PlotView.playHarvest` | `span` + `el.animate()`，`fill: forwards` |
| 进度条 + `setScale` | `PlotView.update` | `div` + `transform: scaleX()`（HUD 已有同款做法） |
| 可收获角标 | `PlotView` | `span` + `border-radius: 9px` |
| 地块命中区 | `PlotView.hit` | 直接在地块 `div` 上绑 `click` |
| 畜舍卡片 | `BarnView.paintCard` | `div` + `border-radius: 14px` + `box-shadow` |
| 畜舍围栏凹槽 | `BarnView.buildStall` | `div` + `radial-gradient` + `inset` 阴影 |
| 动物贴图 | `BarnView.buildStall` | `<img src="/animals/chicken.png">`，失败回退 emoji |
| 底部入口背景 | `DockView` 构造 | `div` + `linear-gradient` |
| 高亮态（琥珀底 + 顶部指示条） | `DockView.paint` | `.active` 类 + `::before` 顶部条 |
| 订单角标 | `DockView.setOrderBadge` | `span` |
| 分区标题 + 琥珀短线 | `FarmScene.createSectionTitle` | `div` + `::after` |
| 所有文本 | 全部 | `textContent` |

### 状态订阅与更新

保留现有模式：`store.subscribe(() => view.refresh())`。

- 状态变化时**只改 `textContent` 和 `style`**，不重建元素；
- **值没变就不写**：每个字段缓存上一次的值，相同则跳过 DOM 写入。
  这是"静止 0 paint"的前提，也是 DOM 相对 Phaser `Text.setTexture` 的主要收益；
- 250ms 节拍保留现有 `refreshLabels()` 的**全部职责**：地块倒计时、分区统计、
  畜舍状态文案（含"产出中 m:ss"）、Dock 订单角标 —— 不能只刷地块，否则畜舍倒计时
  会退化到 5s 轮询才更新，是可见的行为回退；
- 阶段切换用 `data-stage` 属性驱动 CSS，不在 JS 里拼样式。

### 动效与"减少动效"

`prefers-reduced-motion` 已经在 `ui/panelStyles.ts` 里做了全局兜底
（`animation-duration: 0.001ms !important`）。迁移后呼吸光晕与粒子自动受控，
可以删掉 `PlotView` 里手写的 `this.motion` 判断。

Web Animations API 的调用点仍需判断一次（CSS 全局规则管不到 `el.animate()`），
`display/motion.ts` 的 `prefersReducedMotion()` 保留给这一处用。

### 缩放

`#stage` 的 `transform: scale(fit)` 保留 —— 这是 DOM 与画布共用的坐标系，
DOM 化后它是唯一的缩放机制。`stage.ts` 只删"渲染系数"那一半：

- 保留：`fitScaleFor`、`fitScale`、`applyStageFit`、`getStage`、`DESIGN_*` 布局常量；
- 删除：`renderScaleFor`、`renderScale`、`clampDpr`、`MAX_RENDER_SCALE`、`DPR_LIMIT`。

## 测试影响

| 文件 | 影响 |
| --- | --- |
| `display/stage.test.ts` | 删除 `renderScaleFor` 的 describe 块，`fitScaleFor` 全部保留 |
| `display/plotView.test.ts`（由 `scenes/plotView.test.ts` 移入） | 纯函数不动，仅改 import 路径 |
| `display/motion.test.ts` / `barnView.test.ts` / `viewModels.test.ts` / `format.test.ts` / `icons.test.ts` | 不受影响 |
| `state/store.test.ts` / `api/client.test.ts` / 4 个 panel 测试 | 不受影响 |

不新增 DOM 快照测试：jsdom 不做布局，断言 `getBoundingClientRect` 恒为 0，
测样式意义不大。视觉正确性靠浏览器手动比对（见"验收"）。

## 验收

1. `pnpm test` 全绿（core + server + client）；
2. `pnpm --filter ./client run build` 通过，产物里**没有** phaser chunk；
3. 浏览器实测（DevTools Performance，4K 屏）：
   - 无生长/成熟地块、无面板打开时，静止期 **0 次 paint**；
   - 有生长地块时，每次倒计时只触发**文字区域的局部 paint**（面积远小于整块画布），
     不出现 3840×2160 级别的全画布 paint；
   - 呼吸光晕只动 `opacity`，走合成器，不产生 paint；
4. 点击地块（播种/收获）到视觉反馈出现，**渲染线程耗时 < 16ms**
   （不含本地 HTTP 往返；127.0.0.1 实测通常 < 5ms）。
   反馈时机**保持现状——服务端确认后才播放**，不引入乐观 UI；
5. 视觉逐屏对比：背景、地块（空/生长/成熟三态）、畜舍（四态）、Dock 高亮、toast、收获粒子。

## 取舍

- **为什么不用 CSS `content-visibility` 优化 Phaser**：画布是单个 canvas 元素，
  浏览器无法对其内部做分区合成；`content-visibility` 只对 DOM 子树有效。
- **为什么保留 `transform` 缩放而不是改 `rem`**：`transform` 不改变布局盒，
  1280×720 的设计单位在 CSS 里可以照样写 `px`，与现有面板代码一致。
- **为什么删 `scenes/` 而不是原地改**：目录名 `scenes` 是 Phaser 的术语，
  留下会误导后来的人以为还有场景系统。迁移后语义是"视图"，归入 `ui/`。
- **粒子为什么用 Web Animations API 而不是 CSS keyframes**：10 个粒子方向各不相同，
  用 CSS 要么生成 10 组 keyframes，要么用 `calc(cos())`（兼容性差）；
  `el.animate()` 一行一个，且同样走合成器。

## 风险

- **视觉回归**：最大风险。缓解：迁移时逐块对照上表，每迁完一块就在浏览器截图比对；
- **输入坐标**：`#stage` 的 `transform` 缩放会让 `getBoundingClientRect` 返回缩放后的值，
  DOM 的 `click` 事件自带正确坐标，不需要像 Phaser 那样手动换算 —— 这条反而更简单；
- **滚动穿透**：面板已经在 `#stage` 内，`overflow: hidden` 不受影响；
- **回收**：`FarmView.destroy()` 需要移除定时器与事件监听，避免热更新残留。

## 实施顺序

1. `stage.ts` 瘦身 + `index.html` 去掉 `#game` + `main.ts` 去掉 `Phaser.Game`（此时页面只有 HUD 和面板，地空白）；
2. `FarmView` + 背景 + 分区标题 + 地块网格（三态还原）；
3. 畜舍与底部入口；
4. toast、收获粒子与上浮飘字；
5. 删除 `scenes/`、`phaser` 依赖、`motion.ts` 的冗余判断；
6. 跑全量测试与构建，浏览器逐屏比对。
