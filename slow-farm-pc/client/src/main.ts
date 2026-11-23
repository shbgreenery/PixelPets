import Phaser from "phaser";
import { api } from "./api/client";
import type { Meta, Rules } from "./api/client";
import {
  DESIGN_HEIGHT,
  DESIGN_WIDTH,
  getStage,
  stageDpr,
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

  // 舞台盒子尺寸以常量为准，避免与 index.html 初值漂移。
  const stage = getStage();
  stage.style.width = `${DESIGN_WIDTH}px`;
  stage.style.height = `${DESIGN_HEIGHT}px`;

  // 后备分辨率 = 设计尺寸 × dpr；CSS 尺寸由样式固定为设计尺寸，画面不再随窗口拉伸。
  const dpr = stageDpr();
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: "game",
    width: DESIGN_WIDTH * dpr,
    height: DESIGN_HEIGHT * dpr,
    backgroundColor: "#120f09",
    scale: {
      mode: Phaser.Scale.NONE,
      autoCenter: Phaser.Scale.NO_CENTER,
    },
  });

  game.scene.add("FarmScene", FarmScene, true, { store });

  new Hud(store);
  startPolling(store, meta);

  // DPR 变化（如拖到外接屏）时整页重载，让后备分辨率与相机缩放重新对齐。
  let currentDpr = dpr;
  window.addEventListener("resize", () => {
    const next = stageDpr();
    if (next === currentDpr) return;
    currentDpr = next;
    window.location.reload();
  });
}

void bootstrap();
