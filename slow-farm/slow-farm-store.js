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

// 存档文本 → 状态，不碰适配器：读档和导入共用同一套校验
function parse(text) {
  if (!text) return { state: null, problem: 'empty' };
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { state: null, problem: 'parse' };
  }
  if (!raw || typeof raw !== 'object') return { state: null, problem: 'parse' };
  if (raw.version !== SAVE_VERSION) return { state: null, problem: 'version' };
  return { state: migrate(raw), problem: null };
}

// 状态 → 存档文本：导出与写盘共用同一个包装
function exportText(state) {
  return JSON.stringify({ version: SAVE_VERSION, payload: state });
}

function createStore(adapter) {
  // 坏档先留一份原文：读不出来也别让下一次保存把它彻底冲掉。
  async function keepBackup(text) {
    if (typeof adapter.backup !== 'function') return;
    try {
      await adapter.backup(text);
    } catch (e) {
      // 备份失败不阻塞开局
    }
  }

  // 比 load 多一个 problem：empty / parse / version / read，供界面区分「没档」和「档坏了」
  async function loadDetailed() {
    let text;
    try {
      text = await adapter.read();
    } catch (e) {
      return { state: null, problem: 'read' };
    }
    const parsed = parse(text);
    // 坏档和版本不符先留原文，别让下一次保存把它冲掉
    if (parsed.problem === 'parse' || parsed.problem === 'version') await keepBackup(text);
    return parsed;
  }

  return {
    loadDetailed,
    load: async () => (await loadDetailed()).state,
    parse,
    exportText,

    // 返回是否落盘成功；调用方不能假设一定成功
    async save(state) {
      const text = exportText(state);
      try {
        const ok = await adapter.write(text);
        return ok !== false;
      } catch (e) {
        return false;
      }
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

    // 返回是否写入成功：隐私模式、存储被禁用或容量不足时返回 false，交由界面提示
    async write(text) {
      if (typeof localStorage === 'undefined') return false;
      try {
        localStorage.setItem(key, text);
        return true;
      } catch (e) {
        return false;
      }
    },

    // 坏档原文的归宿：只在备份位还空着时写入，避免覆盖更早的好备份
    async backup(text) {
      if (typeof localStorage === 'undefined') return;
      try {
        const backupKey = key + '.bak';
        if (!localStorage.getItem(backupKey)) localStorage.setItem(backupKey, text);
      } catch (e) {
        // 忽略
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
  module.exports = { SAVE_VERSION, SAVE_KEY, migrate, parse, exportText, createStore, localAdapter };
}
