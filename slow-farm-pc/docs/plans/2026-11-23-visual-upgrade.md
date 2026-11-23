# slow-farm-pc 视觉升级实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 slow-farm-pc 的界面从色块/表单升级为 emoji + 现有动物贴图 + 统一卡片风，玩法与服务端协议不变。

**Architecture:** 新增集中式 `theme.ts`（颜色/间距/圆角/字号）与 `icons.ts`（emoji 映射，纯函数）；场景层（FarmScene/PlotView/Hud）替换为图标化渲染；8 个 HTML 面板统一使用共享卡片样式模块；动物贴图从仓库 `assets/kenney/animals/` 复制到 `client/public/animals/`。

**Tech Stack:** 现有 Vite + TypeScript + Phaser 4 + Vitest；不新增依赖。

**Spec:** `slow-farm-pc/docs/2026-11-23-visual-upgrade-design.md`

## Global Constraints

- 玩法逻辑、服务端协议、存档格式不得改变
- 所有 emoji 只能出现在 `client/src/display/icons.ts`，其他文件通过函数取用
- 不引入新依赖
- 不移动 `assets/kenney/` 原文件，只复制到 `client/public/animals/`
- 提交信息中文，格式 `feat(scope): 描述`
- 现有测试保持通过

## Review Focus

1. 缺少映射的 id 不能抛错，必须有兜底图标
2. 动物 PNG 加载失败时不能白块，应回退 emoji
3. 场景每 250ms 刷新不能反复创建对象造成泄漏
4. 面板样式统一后不能改变按钮可用性与动作参数
5. emoji 不得散落到 icons.ts 之外的源码

---

## Task 1: 主题 token 与 emoji 映射

**Files:**
- Create: `slow-farm-pc/client/src/display/theme.ts`
- Create: `slow-farm-pc/client/src/display/icons.ts`
- Test: `slow-farm-pc/client/src/display/icons.test.ts`

**Interfaces:**
- Consumes: 无
- Produces:
  - `theme.ts` 导出 `COLORS`（`amber`, `amberSoft`, `panel`, `panelBorder`, `text`, `muted`, `soil`, `ready` 等字符串/数字常量）、`RADIUS`、`SPACING`、`FONT`
  - `icons.ts` 导出 `cropIcon(cropId: string): string`、`itemIcon(itemId: string): string`、`machineIcon(machineId: string): string`、`buildingIcon(key: string): string`、`animalIcon(kind: string): string`，全部返回非空字符串，未知 id 返回 `"❔"`

- [ ] **Step 1: 写失败的测试**

```ts
it("已知作物返回对应 emoji", () => {
  expect(cropIcon("wheat")).toBe("🌾");
  expect(cropIcon("corn")).toBe("🌽");
});
it("未知 id 返回兜底图标而不是抛错", () => {
  expect(cropIcon("unknown")).toBe("❔");
  expect(itemIcon("unknown")).toBe("❔");
});
it("动物映射含鸡/牛/羊", () => {
  expect(animalIcon("chicken")).toBe("🐔");
  expect(animalIcon("sheep")).toBe("🐑");
});
```

映射表（照抄）：

- 作物：wheat 🌾、corn 🌽、carrot 🥕、soybean 🌱、strawberry 🍓、sugarcane 🎍、pumpkin 🎃、lavender 🌸、coffeeBean ☕、cocoa 🍫
- 产出：egg 🥚、milk 🥛、wool 🧶、flour 🥣、bread 🍞、cornBread 🌽、carrotJuice 🥤、soyMilk 🥛、sugar 🍬、soySauce 🍶、pumpkinJam 🍯、vegCan 🥫、fruitCan 🥫、feed 🌿、butter 🧈、cheese 🧀、yarn 🧵、wheat/corn/carrot/soybean/strawberry/sugarcane/pumpkin/lavender/coffeeBean/cocoa 沿用作物图标
- 机器：mill 🌀、bakery 🍞、juicer 🧃、sugarMill 🏭、sauceMill 🍯、cannery 🥫、feedMill 🌿、dairy 🥛、loom 🧵
- 建筑：farm 🌱、silo 📦、machines 🏭、orders 📋、animals 🐄、shop 🛒、achievements 🏆、seed 🌰
- 动物：chicken 🐔、cow 🐄、sheep 🐑

- [ ] **Step 2: 运行测试确认失败**

Run: `cd slow-farm-pc/client && npx vitest run src/display/icons.test.ts`
Expected: 模块不存在

- [ ] **Step 3: 实现 theme.ts 与 icons.ts**

`theme.ts` 常量建议值：`amber "#e0a44a"`、`amberSoft "#ffe8a3"`、`panel "rgba(20, 26, 32, 0.92)"`、`panelBorder "rgba(224, 164, 74, 0.35)"`、`text "#e8edf2"`、`muted "#9aa7b2"`、`soil 0x6b4a2f`、`ready 0xf2c14e`；`RADIUS = "10px"`；`SPACING = { xs: 4, sm: 8, md: 12, lg: 16 }`；`FONT = "14px system-ui, -apple-system, sans-serif"`。

`icons.ts` 用 `Record<string, string>` 表 + 查表函数，未知返回 `"❔"`。

- [ ] **Step 4: 运行测试确认通过**

Run: `cd slow-farm-pc/client && npx vitest run src/display/icons.test.ts`
Expected: 3 个用例 PASS

- [ ] **Step 5: 提交**

```bash
git add slow-farm-pc/client/src/display/theme.ts slow-farm-pc/client/src/display/icons.ts slow-farm-pc/client/src/display/icons.test.ts
git commit -m "feat(slow-farm-pc): 主题 token 与 emoji 图标表"
```

---

## Task 2: 场景升级（HUD、地块、动物、建筑）

**Files:**
- Create: `slow-farm-pc/client/public/animals/chicken.png`（从 `assets/kenney/animals/chicken.png` 复制）
- Create: `slow-farm-pc/client/public/animals/cow.png`（同上）
- Modify: `slow-farm-pc/client/src/ui/Hud.ts`
- Modify: `slow-farm-pc/client/src/scenes/PlotView.ts`
- Modify: `slow-farm-pc/client/src/scenes/FarmScene.ts`

**Interfaces:**
- Consumes: Task 1 的 `COLORS`、`cropIcon`、`buildingIcon`、`animalIcon`
- Produces: 场景外观升级，公开方法与事件不变（`FarmScene.create/update`、`PlotView.update` 签名保持）

- [ ] **Step 1: 跑现有测试作为基线**

Run: `cd slow-farm-pc/client && npx vitest run`
Expected: 全绿（记录数量）

- [ ] **Step 2: 复制动物贴图**

```bash
mkdir -p slow-farm-pc/client/public/animals
cp assets/kenney/animals/chicken.png slow-farm-pc/client/public/animals/
cp assets/kenney/animals/cow.png slow-farm-pc/client/public/animals/
```

- [ ] **Step 3: 实现场景升级**

- `FarmScene`：在 `preload()` 里 `this.load.image("animal-chicken", "/animals/chicken.png")` 与 `animal-cow`；加载失败用 `loaderror` 事件标记，作者回退到 emoji。
- HUD：文案改为 `🪙 金币`、`Lv.7`、`💎`、`⏳`，数值用 `COLORS.amberSoft`。
- 地块：底色 `COLORS.soil`，作物 emoji 用 `cropIcon(plot.cropId)` 居上，剩余时间在下；成熟地块加 2px `COLORS.ready` 描边并做简单 alpha 呼吸（`this.tweens`）。
- 动物：`syncAnimals` 中鸡/牛使用 image，羊用 `animalIcon` 文本；三态颜色描边保持；贴图缺失时用 emoji。
- 建筑：emoji + 文字（`buildingIcon("farm")` 等），hover 时描边高亮。
- 每 250ms 的刷新必须复用已有 Text/Image 对象（`setText`/`setTexture`），不得新建。

- [ ] **Step 4: 验证**

Run: `cd slow-farm-pc/client && npx vitest run && npx tsc --noEmit && npx vite build`
Expected: 全绿

手动：`npm start` 后确认 HUD、地块、动物、建筑显示正常，点击行为不变

- [ ] **Step 5: 提交**

```bash
git add slow-farm-pc/client
git commit -m "feat(slow-farm-pc): 场景图标化与动物贴图"
```

---

## Task 3: 面板卡片化

**Files:**
- Create: `slow-farm-pc/client/src/ui/panelStyles.ts`
- Modify: `slow-farm-pc/client/src/ui/SeedPanel.ts`
- Modify: `slow-farm-pc/client/src/ui/SiloPanel.ts`
- Modify: `slow-farm-pc/client/src/ui/FarmPanel.ts`
- Modify: `slow-farm-pc/client/src/ui/MachinePanel.ts`
- Modify: `slow-farm-pc/client/src/ui/OrdersPanel.ts`
- Modify: `slow-farm-pc/client/src/ui/AnimalPanel.ts`
- Modify: `slow-farm-pc/client/src/ui/AchievementsPanel.ts`
- Modify: `slow-farm-pc/client/src/ui/ShopPanel.ts`

**Interfaces:**
- Consumes: `theme.ts`、`icons.ts`
- Produces: `panelStyles.ts` 导出 `CARD_STYLE`、`HEADER_STYLE`、`TITLE_STYLE`、`ROW_STYLE`、`MUTED_STYLE`、`BUTTON_STYLE`、`makeButton(label, disabled, onClick)`

- [ ] **Step 1: 跑现有测试作为基线**

Run: `cd slow-farm-pc/client && npx vitest run`
Expected: 全绿

- [ ] **Step 2: 实现共享样式模块**

统一卡片背景、边框、圆角、标题字号；`makeButton` 接受禁用态并返回 `HTMLButtonElement`。样式值全部取自 `theme.ts`。

- [ ] **Step 3: 逐个面板替换**

- 标题加 emoji：种子 🌰、仓库 📦、农场 🌱、机器 🏭、订单 📋、养殖 🐄、成就 🏆、商店 🛒
- 列表项加物品/作物图标（`itemIcon`/`cropIcon`），数值使用强调色
- 删除各面板私有的 `BUTTON_STYLE`/`OVERLAY_STYLE`/`MUTED_STYLE` 重复定义
- 不改任何按钮的可用条件、动作名与参数

- [ ] **Step 4: 验证**

Run: `cd slow-farm-pc/client && npx vitest run && npx tsc --noEmit && npx vite build`
Expected: 全绿

手动：逐个打开 8 个面板，确认样式一致、操作正常

- [ ] **Step 5: 提交**

```bash
git add slow-farm-pc/client
git commit -m "feat(slow-farm-pc): 面板统一卡片化与图标"
```

---

## Task 4: 资源与验收

**Files:**
- Modify: `slow-farm-pc/README.md`（记录动物贴图来源与替换方法）
- Test: 无需新增

**Interfaces:**
- Consumes: 前三任务的成果
- Produces: 可验收的版本

- [ ] **Step 1: README 补充素材说明**

写清 `client/public/animals/` 两个 PNG 的来源（仓库 `assets/kenney/animals/`，Kenney CC0），以及以后换像素素材时只需要替换该目录与 `icons.ts` 映射。

- [ ] **Step 2: 全量验证**

Run: `cd slow-farm-pc && npm test && npx --prefix client tsc --noEmit && npx --prefix client vite build`
Expected: 全绿

- [ ] **Step 3: 截图验收**

启动服务，截取主场景与至少 3 个面板，确认与设计一致。

- [ ] **Step 4: 提交**

```bash
git add slow-farm-pc
git commit -m "docs(slow-farm-pc): 视觉升级素材说明与验收"
```
