// @provides: bestEffort, safeGet
// @requires: swallow
// ===== DOMAIN: foundation/error-guard =====
// ===== MODULE: 分层错误卫士（Guard）=====
// 替代散落全仓库的 700+ try/catch，提供三层语义化容错原语。
// Tier 0（删除）：永不会抛错的操作 → 移除 try/catch
// Tier 1（safeGet）：纯取值有兜底 → safeGet(fn, fallback)
// Tier 2（bestEffort）：副作用不中断主流程 → bestEffort(fn, tag)
// Tier 3（保留）：有恢复/补偿逻辑 → 原样保留 + 标记注释
// 注意：三个函数都是模块级独立函数，Guard 对象是它们的薄包装（用于 toolkit 暴露）。
//       所有 IIFE 内代码可直接调用 bestEffort/safeGet/safeDOM（无需 Guard. 前缀）。

/**
 * 安全取值：try { fn() } catch → fallback
 *   示例：safeGet(function() { return video.currentTime; }, 0)
 */
function safeGet(fn, fallback) {
  try { var v = fn(); return v !== undefined ? v : fallback; }
  catch (_) { return fallback; }
}

/**
 * 尽力而为：副作用失败不中断主流程，进 swallow 诊断
 *   示例：bestEffort(function() { EventBus.emit('ui:toast', msg); }, 'toast')
 */
function bestEffort(fn, tag) {
  try { fn(); } catch (e) { if (typeof swallow === 'function') swallow(e, tag || 'guard.be'); } // 防御：swallow 契约断裂时自身不抛错（避免雪崩中断主流程）
}

/**
 * 安全 DOM 遍历：root 可为 null，中间 null 自动兜底
 *   示例：safeDOM(el, function(n) { return n.querySelector('.sel').getAttribute('data-x'); }, '')
 */
function safeDOM(root, fn, fallback, tag) {
  if (!root) return fallback;
  try { var v = fn(root); return v != null ? v : fallback; }
  catch (e) { swallow(e, tag || 'guard.dom'); return fallback; }
}

// 薄包装：暴露到 toolkit 供外部工具库项复用
var Guard = { safeGet: safeGet, bestEffort: bestEffort, safeDOM: safeDOM };
// 修复：guard.js 排 build-manifest 第 1 位，而 toolkit 在 utils.js（第 9 位）才创建 →
// 原 `if (toolkit)` 永远为 false，Guard 永不暴露。改为挂顶层命名空间（不依赖 toolkit 创建时机）；
// 若 toolkit 已存在也同步一份，保证两处表面都能拿到（IIFE 内其他模块直引 safeGet/bestEffort/safeDOM 不受影响）。
try {
  window.__CX_FORCE_PLAY = window.__CX_FORCE_PLAY || {};
  window.__CX_FORCE_PLAY.Guard = Guard;
  if (window.__CX_FORCE_PLAY.toolkit) window.__CX_FORCE_PLAY.toolkit.Guard = Guard;
} catch (_) {}
