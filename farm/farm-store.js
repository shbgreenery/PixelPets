'use strict';

// 存档基础设施：版本包装、本地实现与在线接口预留。
// 只有本文件最外层的适配器允许接触 localStorage；领域层与用例层不感知。

const SAVE_VERSION = 2;
const SAVE_KEY = 'pixelpets.farm.save';

function migrate(save) {
  if (!save || typeof save !== 'object') throw new Error('存档格式错误');
  if (save.version !== SAVE_VERSION) throw new Error(`存档版本不支持：${save.version}`);
  return save.payload;
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

// 预留：将来换成线上接口时，只替换这个适配器。
function httpAdapter(baseUrl) {
  const notImplemented = () => Promise.reject(new Error(`未实现：${baseUrl}`));
  return {
    read: notImplemented,
    write: notImplemented,
    remove: notImplemented,
  };
}

if (typeof module !== 'undefined') {
  module.exports = { SAVE_VERSION, SAVE_KEY, migrate, createStore, localAdapter, httpAdapter };
}
