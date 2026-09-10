# PixelPets

纯前端小游戏合集，点开即玩，无需安装。

在线地址：[https://shbgreenery.github.io/PixelPets/](https://shbgreenery.github.io/PixelPets/)

## 游戏列表

| 游戏 | 技术栈 | 说明 |
|------|--------|------|
| [动物消除](animal-elimination.html) | Phaser 4 | 图片转棋盘，BFS 寻路把动物喂饱。支持自定义棋盘大小、倍速、一键重排 |
| [快递哪去了](express-delivery.html) | Phaser 3 | 10x10 逻辑推理：每行每列每种颜色只有一个快递，快递互不相邻 |
| [消消乐](GemMatch.html) | 纯 DOM | 经典三消，可自定义倒计时（1-15 分钟），带暂停、连击、最高分记录 |
| [3D 连连看](cube-link.html) | Three.js | 4x4x4 体素立方体，任意两个相同图案用 <=2 拐点连线消除，路径可绕到立方体外 |
| [2D 连连看](link2d.html) | Phaser 4 | 8x8/12x12/16x16 三种尺寸，≤2 拐点连线消除，消除后按随机物效方向沉底重排 |

## 项目结构

```
index.html              # 游戏导航首页
animal-elimination.html # 动物消除
express-delivery.html   # 快递哪去了
GemMatch.html           # 消消乐
cube-link.html          # 3D 连连看
bfs.js                  # 动物消除核心：Dijkstra 松弛版 BFS 寻路
bfs.test.js             # BFS 单元测试
link-core.js            # 3D 连连看核心：体素模型、<=2 拐点折线判定
link-core.test.js       # 连连看核心单元测试
link2d.html             # 2D 连连看
link2d-core.js          # 2D 连连看核心：连接判定、9 种物效重排、寻对与死局检测
link2d-core.test.js     # 2D 连连看核心单元测试
```

核心算法与渲染分离 -- `bfs.js` 和 `link-core.js` 是纯逻辑模块，不依赖任何游戏引擎或 DOM，可独立测试。

## 运行

纯静态项目，无需构建。任选一种方式：

```bash
# 直接用浏览器打开 index.html
open index.html

# 或用任意 HTTP 服务器
npx serve .
python3 -m http.server 8080
```

## 测试

用 Node 运行单元测试：

```bash
node bfs.test.js
node link-core.test.js
node link2d-core.test.js
```

## 技术选型

- **Phaser 4** -- 动物消除，利用 WebGL 渲染大规模棋盘
- **Phaser 3** -- 快递哪去了，成熟的 2D 游戏框架
- **Three.js** -- 3D 连连看，体素立方体的 3D 渲染与交互
- **纯 DOM** -- 消消乐，零依赖，CSS 动画驱动
- 所有依赖通过 CDN 引入，无 npm、无打包工具
