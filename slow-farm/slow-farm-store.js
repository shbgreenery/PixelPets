'use strict';

// 存档基础设施：版本包装与本地实现。
// 只有本文件最外层的适配器允许接触 localStorage；领域层与用例层不感知。

// v2：仓库从「总件数上限」改为「格子制」，字段 siloLevel 换成 siloSlots。
// v3：种子改为现种现买，去掉种子袋字段 seeds。
// v4：机器改成生产队列（queueSize + queue），配方需要单独解锁（unlockedRecipes）。
// v5：加入养殖（animals），旧档直接丢弃。
const SAVE_VERSION = 5;
const SAVE_KEY = 'pixelpets.slowfarm.save';

function migrate(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('存档格式错误');
  if (raw.version !== SAVE_VERSION) throw new Error(`存档版本不支持：${raw.version}`);
  return raw.payload;
}

function createStore(adapter) {
  return {
    async load() {
      let text;
      try {
        text = await adapter.read();
      } catch (e) {
        return null;
      }
      if (!text) return null;
      try {
        return migrate(JSON.parse(text));
      } catch (e) {
        return null;
      }
    },

    async save(state) {
      const text = JSON.stringify({ version: SAVE_VERSION, payload: state });
      await adapter.write(text);
    },

    async clear() {
      await adapter.remove();
    },
  };
}

function localAdapter(key = SAVE_KEY) {
  return {
    async read() {
      if (typeof localStorage === 'undefined') return null;
      try {
        return localStorage.getItem(key);
      } catch (e) {
        return null;
      }
    },

    async write(text) {
      if (typeof localStorage === 'undefined') return;
      try {
        localStorage.setItem(key, text);
      } catch (e) {
        // 隐私模式或容量不足时静默失败
      }
    },

    async remove() {
      if (typeof localStorage === 'undefined') return;
      try {
        localStorage.removeItem(key);
      } catch (e) {
        // 忽略
      }
    },
  };
}

if (typeof module !== 'undefined') {
  module.exports = { SAVE_VERSION, SAVE_KEY, migrate, createStore, localAdapter };
}
