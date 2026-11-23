# slow-farm-pc 视觉升级设计（C 方案）

日期：2026-11-23
状态：已获用户批准，进入实现

## 目标

把 slow-farm-pc 从"色块占位 + 表单面板"升级为有设计感的游戏界面：现有卡通动物贴图 + emoji 图标 + 统一的卡片化 UI。玩法、服务端协议、存档格式全部不变。

## 非目标

- 不接入像素素材包（网络不可达，已建 item 3 跟踪）
- 不改玩法数值与规则
- 不做复杂动画系统；只加少量过渡（成熟闪烁、按钮 hover）

## 方案

1. **视觉 token 与 emoji 表集中定义**
   - 新增 `client/src/display/theme.ts`：颜色、圆角、间距、字号
   - 新增 `client/src/display/icons.ts`：作物/产出/机器/建筑的 emoji 映射（纯函数 + 单测）
   - 所有 emoji 只出现在这一处，方便未来整体替换为像素图标

2. **场景升级（FarmScene / PlotView / Hud）**
   - HUD：金币 🪙、等级 Lv、宝石 💎、沙漏 ⏳，图标 + 数值
   - 地块：土壤底色块 + 作物 emoji + 剩余时间；成熟地块加闪烁描边
   - 动物：鸡/牛使用现有 Kenney PNG（复制到 `client/public/animals/`），羊用 🐑；保留三态颜色描边
   - 建筑：emoji + 文字标签，悬停高亮

3. **面板卡片化（8 个面板）**
   - 统一卡片容器样式（深色半透明 + 圆角 + 琥珀强调）
   - 标题带 emoji，数值用强调色，按钮尺寸统一
   - 面板底部提示（note/toast）固定在可视区内

## 约束

- 不引入新依赖
- 资源从仓库 `assets/kenney/animals/` 复制到 `client/public/animals/`，不移动原文件
- 会改变状态的逻辑仍只在服务端；本次只改展示
- 现有测试必须保持通过；新增 icons 映射单测

## 验收

- 启动后场景与面板呈现新样式，截图对比
- `npx vitest run`、`npx tsc --noEmit`、`npx vite build` 全通过
- 玩法行为与升级前一致
