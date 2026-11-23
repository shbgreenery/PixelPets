# 自适应舞台：不同分辨率 PC 的等比缩放

2026-11-23

## 目标

让 1280×720 的固定舞台在任何窗口尺寸的 PC 上都能完整显示：

- 小窗（1366×768 笔记本、分屏半宽）不再裁掉顶部 HUD 与底部入口栏；
- 大屏（2K/4K、外接显示器）画面铺满窗口，而不是中央一小块。

## 非目标

- 不做"重新排版"的响应式：耕地列数、侧栏宽度、面板位置都不随窗口变化。
  布局常量是 1280×720 设计单位下的既定节奏，重排会破坏现有视觉比例。
- 不改动服务端与存档逻辑。

## 方案

保留 1280×720 作为唯一坐标系，只在"设计单位 → 屏幕像素"之间插一层等比缩放。

两个系数分开管：

| 系数 | 作用 | 取值 |
| --- | --- | --- |
| **显示系数** `fit` | `#stage` 的 CSS `transform: scale()`，决定占多大屏幕 | `min(vw/1280, vh/720)`，限幅 `[0.25, 4]` |
| **渲染系数** `render` | Phaser 画布后备分辨率、相机 `zoom`、文本 `setResolution` | `min(dpr, 2) × fit`，上限 3 |

`render` 上限 3 的理由：4K 屏 `fit = 3`、`dpr = 1` 时画布正好 3840×2160，已经逐像素对齐；
再往上只会增加显存占用而没有可见收益。

舞台用 `position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%) scale(fit)`
居中，不依赖 flex 溢出行为，宽高恒为设计尺寸，DOM 覆盖层与 Phaser 世界坐标继续共用同一套单位。

窗口变化时重算两个系数：`fit` 变化就改 `transform`；`render` 变化才调 `game.scale.resize()`
并重设相机 `zoom`（避免无谓的画布重建）。DPR 变化（拖到外接屏）走同一条路径，
原来的"整页重载"逻辑可以删掉。

## 取舍

- **为什么不用 `Phaser.Scale.FIT`**：它只缩放画布，HUD 与 8 个面板都是 DOM 覆盖层，
  会与画布脱节。整体 `transform` 能让 DOM 与画布一起缩放。
- **为什么不用 CSS `zoom`**：`zoom` 会改变布局盒尺寸，Phaser 的输入映射与 `getBoundingClientRect()`
  在部分浏览器上会出现非整数偏差；`transform` 的语义更稳定。
- **文本清晰度**：静态 `transform` 下浏览器按最终缩放重栅格化 DOM 文本，不会发糊；
  若将来改成动画缩放，需要改回按 `render` 重设字号。
- **钳制下限 0.25**：窗口极小时宁可字变小，也不裁切——被裁掉的 HUD 是没法操作的。

## 影响文件

- `client/src/display/stage.ts`：新增 `fitScaleFor` / `renderScaleFor` 纯函数与 `applyStageFit`
- `client/index.html`：`#stage` 改为 absolute 居中 + transform
- `client/src/main.ts`：启动时应用缩放，`resize` 时增量更新
- `client/src/scenes/FarmScene.ts`：相机 `zoom` 与文本分辨率改用 `renderScale()`
- `client/src/scenes/{PlotView,DockView,BarnView}.ts`：文本分辨率改 `renderScale()`
