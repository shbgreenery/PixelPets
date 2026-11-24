import Phaser from "phaser";
import { api } from "./api/client";
import type { Meta, Rules } from "./api/client";
import {
  DESIGN_HEIGHT,
  DESIGN_WIDTH,
  applyStageFit,
} from "./display/stage";
import { FarmScene } from "./scenes/FarmScene";
import { GameStore } from "./state/store";
import { Hud } from "./ui/Hud";

// 后端不可达时仍要启动场景并显示提示，因此准备一份空规则占位。
const EMPTY_RULES: Rules = { CROPS: {}, ITEMS: {}, LEVELS: [] };

const POLL_INTERVAL_MS = 5_000;

// 每 5 秒拉一次存档；页面重新可见时立即拉取，隐藏时停止计时。
function startPolling(store: GameStore, meta: Meta | null): void {
  let timer: number | null = null;

  const poll = () => {
    void store.load(meta ?? undefined);
  };
  const start = () => {
    if (timer !== null) return;
    timer = window.setInterval(poll, POLL_INTERVAL_MS);
  };
  const stop = () => {
    if (timer === null) return;
    window.clearInterval(timer);
    timer = null;
  };

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      poll();
      start();
    } else {
      stop();
    }
  });

  if (document.visibilityState === "visible") start();
}

async function bootstrap(): Promise<void> {
  let meta: Meta | null = null;
  try {
    meta = await api.getMeta();
  } catch {
    // 忽略：store.load() 会再次尝试并把网络错误标记为 offline。
  }

  const store = new GameStore(api, meta?.rules ?? EMPTY_RULES);
  await store.load(meta ?? undefined);

  // 舞台按窗口等比缩放；返回的 render 是后备像素倍数，同时决定画布尺寸。
  let { render } = applyStageFit();

  // 后备分辨率 = 设计尺寸 × 渲染系数；CSS 尺寸固定为设计尺寸，放大交给 #stage 的 transform。
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: "game",
    width: DESIGN_WIDTH * render,
    height: DESIGN_HEIGHT * render,
    backgroundColor: "#120f09",
    scale: {
      mode: Phaser.Scale.NONE,
      autoCenter: Phaser.Scale.NO_CENTER,
    },
    // Phaser 默认在 window 上额外挂一对 mousedown/mouseup 监听，
    // 且 onMouseUp 不校验事件目标——DOM 弹层上的点击会漏进画布，
    // 造成"点弹窗却触发了下面的地块"。本项目没有拖拽玩法，
    // 关掉 window 级监听即可；代价仅是 POINTER_UP_OUTSIDE 不再派发。
    input: {
      windowEvents: false,
    },
  });

  game.scene.add("FarmScene", FarmScene, true, { store });

  new Hud(store);
  startPolling(store, meta);

  // 窗口变化（含拖到不同 DPR 的外接屏）时，显示系数总会更新。
  // 渲染系数变了才重建画布；没变也必须 refresh()：CSS transform 改变了画布的
  // 实际显示尺寸，不重算 displayScale 的话指针坐标会整体偏移
  //（Retina 上 render 顶到上限后就会出现这种情况）。
  window.addEventListener("resize", () => {
    const next = applyStageFit();
    if (next.render === render) {
      game.scale.refresh();
      return;
    }
    render = next.render;
    game.scale.resize(DESIGN_WIDTH * render, DESIGN_HEIGHT * render);
  });
}

void bootstrap();
