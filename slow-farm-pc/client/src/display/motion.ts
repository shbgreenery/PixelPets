// 动效开关：呼吸描边与上浮飘字都受系统"减少动效"设置控制。
export interface MotionQuery {
  matches: boolean;
}

// 只有系统明确开启减少动效时才停动画；拿不到设置时保持动效。
export function motionAllowed(query: MotionQuery | null | undefined): boolean {
  return !(query?.matches ?? false);
}

export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return !motionAllowed(window.matchMedia("(prefers-reduced-motion: reduce)"));
}
