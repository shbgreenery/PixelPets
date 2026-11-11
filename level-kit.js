'use strict';

// ============ 通用关卡工具 ============
// 各游戏共用：关卡号 → 固定种子、关卡进度存档、URL 参数读取。
// 纯逻辑，不依赖 DOM / Phaser，可用 Node 直接跑。

// 支持关卡的 4 个游戏。GemMatch 是无限三消（无通关判定）、
// cube-link 是固定 4×4×4（无随机布局），因此不进入关卡体系。
const LEVEL_GAMES = {
  'sand-painting':      { name: '沙画',       file: 'sand-painting.html' },
  'animal-elimination': { name: '动物消除',   file: 'animal-elimination.html' },
  'link2d':             { name: '2D 连连看',  file: 'link2d.html' },
  'express-delivery':   { name: '快递哪去了', file: 'express-delivery.html' },
};

const LEVEL_KEY_PREFIX = 'pixelpets.maxLevel.';

// 关卡号 → 32 位稳定种子（FNV-1a）。
// 同一游戏 + 同一关卡号永远得到同一个种子，因此布局可复现。
function levelHash(gameId, level) {
  const s = gameId + '-level-' + level;
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// mulberry32：与沙画 core 同一算法，保证各游戏随机行为一致
function levelRng(seed) {
  let a = seed | 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 已解锁的最高关卡（1 起步）
function getMaxLevel(gameId) {
  try {
    let v = parseInt(localStorage.getItem(LEVEL_KEY_PREFIX + gameId), 10);
    if (!Number.isFinite(v) || v < 1) v = 1;
    // 兼容沙画旧版存档键
    if (gameId === 'sand-painting') {
      const legacy = parseInt(localStorage.getItem('sandPainting.maxLevel'), 10);
      if (Number.isFinite(legacy) && legacy > v) v = legacy;
    }
    return v;
  } catch (e) {
    return 1;
  }
}

// 解锁到指定关卡（只增不减），返回最新进度
function unlockLevel(gameId, level) {
  const cur = getMaxLevel(gameId);
  if (level <= cur) return cur;
  try { localStorage.setItem(LEVEL_KEY_PREFIX + gameId, String(level)); } catch (e) { /* 隐私模式忽略 */ }
  return level;
}

// 游戏页读取 ?level=N；缺省或非法返回 null
function getLevelFromUrl() {
  const v = parseInt(new URLSearchParams(location.search).get('level'), 10);
  return Number.isFinite(v) && v >= 1 ? v : null;
}

if (typeof module !== 'undefined') {
  module.exports = { LEVEL_GAMES, levelHash, levelRng, getMaxLevel, unlockLevel };
}
