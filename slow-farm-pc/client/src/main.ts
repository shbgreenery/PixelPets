import { api } from "./api/client";
import type { Meta, Rules } from "./api/client";
import { applyStageFit } from "./display/stage";
import { GameStore } from "./state/store";
import { FarmView } from "./ui/FarmView";
import { Hud } from "./ui/Hud";

// 后端不可达时仍要启动视图并显示提示，因此准备一份空规则占位。
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

  applyStageFit();
  new Hud(store);
  new FarmView(store);
  startPolling(store, meta);

  window.addEventListener("resize", () => applyStageFit());
}

void bootstrap();
