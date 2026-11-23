# 慢慢农场 PC 版

本机运行的网页农场游戏：服务端（Fastify）计算并落盘状态，客户端（Vite + Phaser）只负责展示与输入。旧版 `slow-farm/` 保持冻结，本目录独立演进。

## 环境要求

- Node.js 24（依赖 Vite 8 / Vitest 5 的要求）
- pnpm 10 或更高版本（本目录用 pnpm workspaces 管理 `client` 与 `server` 两个包）
- 无需数据库或任何外部服务

首次安装依赖（在 `slow-farm-pc/` 下一次性安装两个包的依赖）：

```bash
cd slow-farm-pc
pnpm install
```

## 开发模式

```bash
pnpm dev
```

- 服务端：`tsx watch` 运行 `server/src/index.ts`，监听 `http://127.0.0.1:8787`
- 客户端：Vite 开发服务器，默认 `http://127.0.0.1:5173`，`/api` 代理到 8787

浏览器打开 `http://127.0.0.1:5173` 游玩。`pnpm dev` 通过 pnpm 的 `--parallel` 同时启动服务端与客户端，按 Ctrl+C 会一起结束。

## 本机生产模式

```bash
pnpm start
```

该命令先构建客户端（`tsc --noEmit && vite build`），再用 `tsx` 直接运行服务端。服务端 `start` 脚本选择 `tsx` 而非先编译：源码依赖 `server/core/*.js` 与相对路径 `server/data`、`client/dist`，直接运行 TypeScript 可避免产物目录结构带来的路径调整，且不需要新增依赖。

构建完成后服务端检测到 `client/dist` 会自动通过 `@fastify/static` 托管，浏览器打开：

```
http://127.0.0.1:8787
```

服务端只监听 `127.0.0.1`，不会暴露到局域网。

## 修改端口

默认端口 8787，可用 `PORT` 环境变量覆盖：

```bash
PORT=9000 pnpm start
# 或只重启服务端
PORT=9000 pnpm --filter ./server run start
```

开发模式下服务端改端口后，需同步修改 `client/vite.config.ts` 中的 `/api` 代理地址。

## 存档位置与恢复

- 存档：`server/data/save.json`
- 上一份备份：`server/data/save.json.bak`（每次覆盖前自动生成）
- 每日快照：`server/data/snapshots/YYYY-MM-DD.json`（每天首次写入前生成，保留最近 8 天（含今天））
- 日志：`server/data/server.log`（启动时裁剪 7 天前的行）

验证或测试时可用 `SLOW_FARM_DATA_DIR` 指向临时目录，避免覆盖真实存档：

```bash
SLOW_FARM_DATA_DIR=$(mktemp -d) PORT=8790 pnpm --filter ./server run start
```

写入流程为 `save.json.tmp` → `fsync` → `rename` 原子替换，进程中断不会留下半个存档。启动时依次尝试 `save.json`、`save.json.bak`，都不可用则新建初始状态。

恢复步骤：

1. 停止服务端进程
2. 用备份或快照覆盖主存档，例如：

   ```bash
   # 回退到上一次写入前的状态
   cp server/data/save.json.bak server/data/save.json

   # 或回退到某天的快照
   cp server/data/snapshots/2026-11-22.json server/data/save.json
   ```

3. 重新启动服务端

也可以让服务端保持运行，用 `PUT /api/save` 手工导入一份存档。先用 `GET /api/save` 取当前 `rev`，再把快照里的 `payload` 作为 `state` 提交：

```bash
# 1. 取当前 rev
curl -s http://127.0.0.1:8787/api/save

# 2. 用快照的 payload 覆盖当前状态；rev 必须与上一步返回的一致
curl -s -X PUT http://127.0.0.1:8787/api/save \
  -H 'Content-Type: application/json' \
  -d '{"state": <快照文件的 payload>, "rev": <GET 返回的 rev>}'
```

`PUT` 只接受结构合法的 `state`；`version` 省略或等于 `5` 时才通过校验，`rev` 不一致会返回 `409` 并带回最新状态。

## 视觉素材

- 动物贴图 `client/public/animals/chicken.png`、`cow.png` 复制自仓库根目录的 `assets/kenney/animals/`，原图未移动；素材来自 Kenney，授权为 CC0。
- `client/public/animals/` 是客户端静态资源目录，构建时原样复制到 `client/dist/animals/`，由服务端静态托管；`FarmScene.preload()` 按 `/animals/chicken.png`、`/animals/cow.png` 加载。
- 羊当前没有贴图，回退为 `icons.ts` 中的 emoji；贴图加载失败时也会回退 emoji。
- 以后换成像素素材时分三种情况：只替换已有动物贴图时，直接覆盖 `client/public/animals/` 下的同名文件即可；新增动物时，除了放入贴图文件，还要在 `client/src/scenes/FarmScene.ts` 的 `ANIMAL_TEXTURES` 中登记 `kind → 纹理 key`，并在 `preload()` 里用对应的 `/animals/<file>.png` 路径调用 `load.image()` 加载；`client/src/display/icons.ts` 目前是 emoji 字符串表（面板展示与贴图缺失回退都用它），若要改成图片图标，需要另行改造该模块，仅替换素材文件不会生效。

## 已知例外

- `PUT /api/save` 仅用于手工导入或恢复存档，允许存档内携带历史时间戳（如 `savedAt`、`lastSeenAt`）。正常游戏动作一律由服务端 `Date.now()` 生成时间，不接受客户端时间；该接口是这一约束的唯一例外。
- `GET /api/save` 在引擎未初始化时返回 `204`。当前实现是服务端启动时即创建并落盘初始状态，因此正常运行时不会出现 204，该分支只用于尚未初始化的场景。

## 测试

在 `slow-farm-pc/` 下运行：

```bash
pnpm test
```

依次执行 core 规则测试、服务端测试与客户端测试。
