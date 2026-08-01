// ==UserScript==
// @name         学习通·可见性/焦点欺骗 (边缘手段, 默认关闭)
// @namespace    http://cx.local/
// @version      2.0
// @author       anon
// @description  【副脚本·接入主控面板】覆盖 document.visibilityState/hidden/hasFocus 与 IntersectionObserver，欺骗 JS 级可见性/焦点/视口检查。默认关闭（强指纹风险，对 Edge 系统级节流基本无效）；开关已挂入 chaoxing-force-play(4.0) 主控面板（按 P 呼出 → 副脚本区），切换后刷新页面生效。
// @match        *://*.chaoxing.com/*
// @match        *://*.edu.cn/*
// @run-at       document-start
// @grant        none
// @license      MIT
// ==/UserScript==

(function () {
  'use strict';
  // 审查 JS1-2：把空 catch 的静默吞掉改为 SPOOF 下告警；默认关闭，静默不污染控制台
  function swallow(e, tag) {
    if (!SPOOF) return;
    try { console.warn('[CX-DECEIVE] ' + (tag || 'swallowed') + ':', (e && e.message) ? e.message : e); } catch (_) {}
  }

  // ===== 安全开关（v2.0 改由主控面板管理）=====
  // 默认关闭。原因：
  //  1) 覆盖 Document.prototype 的 visibilityState/hidden getter 是强指纹，
  //     反作弊扫一眼 getter 是否 [native code] 即可判定注入；
  //  2) Edge 的省电/效率模式用的是浏览器内部+OS 真实状态，JS getter 欺骗基本无效，
  //     真正让视频继续播的是主脚本 chaoxing-force-play 的定时 play() 轮询。
  // 开关来源：localStorage.cx_spoof_api（'1'=开）。通过主面板「副脚本」区切换；
  // 因覆盖必须在 document-start 尽早执行，切换后需刷新页面才生效。
  var SPOOF = false;
  try { SPOOF = localStorage.getItem('cx_spoof_api') === '1'; } catch (e) { swallow(e); }
  // ====================

  // ===== 副脚本接入主控面板（force-play v4.0）=====
  // 注册须在下方 return 之前执行，否则关闭状态下面板里看不到本开关、永远无法再打开。
  try {
    (window.__cxAddonQueue = window.__cxAddonQueue || []).push({
      id: 'deceive-api', type: 'toggle', label: '可见性欺骗（边缘手段）',
      note: '强指纹风险，默认关；切换后需刷新页面生效',
      get: function () { try { return localStorage.getItem('cx_spoof_api') === '1'; } catch (e) { return false; } },
      set: function (v) { try { localStorage.setItem('cx_spoof_api', v ? '1' : '0'); } catch (e) { swallow(e); } }
    });
    if (window.__cxRegisterAddon) window.__cxRegisterAddon();
  } catch (e) { swallow(e); }

  if (!SPOOF) return;                    // 默认惰性：脚本什么都不做

  // ---- 欺骗可见性 / 焦点 getter ----
  try {
    Object.defineProperty(Document.prototype, 'visibilityState', {
      configurable: true, get: function () { return 'visible'; }
    });
    Object.defineProperty(Document.prototype, 'hidden', {
      configurable: true, get: function () { return false; }
    });
    Document.prototype.hasFocus = function () { return true; };
  } catch (e) { swallow(e); }

  // ---- 欺骗 IntersectionObserver：始终回报“视频在视口内” ----
  // 修复 #17：用 Proxy 完整包装实例方法（observe/unobserve/disconnect/takeRecords），
  // 统一把 isIntersecting 置真。关键改进：observe(target) 被拦截后，立即向用户回调注入一条
  // 「在视口内」的合成 entry，使依赖 observe→回调才启动播放的代码在真实相交永不触发时也能跑通；
  // 同时回调内仍对真实 entry 做 isIntersecting 固化，double 保险。
  try {
    const r1 = window.IntersectionObserver;
    if (r1) {
      const _cxForgeEntry = function (target, realEntry) {
        // 优先从真实 entry 拷贝可见属性，缺失时基于 target 合成
        const e = {};
        if (realEntry) {
          for (const k in realEntry) {
            if (k !== 'isIntersecting' && k !== 'intersectionRatio' &&
                k !== 'intersectionRect' && k !== 'rootBounds') e[k] = realEntry[k];
          }
        }
        const rect = (target && target.getBoundingClientRect)
          ? target.getBoundingClientRect() : { top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0 };
        e.target = target;
        e.isIntersecting = true;
        e.intersectionRatio = 1;
        e.intersectionRect = rect;
        e.boundingClientRect = rect;
        e.rootBounds = rect;
        e.time = Date.now();
        return e;
      };

      const w1 = function (cb, o1) {
        const k1 = function (entries, obs) {
          try {
            const out = entries.map(function (en) { return _cxForgeEntry(en.target, en); });
            cb(out, obs);
          } catch (e2) {}
        };
        const inst = new r1(k1, o1);
        // Proxy 拦截：observe 立即回报一次「在视口内」；其余方法 bind(t) 转发（审查#4 Proxy Illegal Invocation 修复）
        const handler = {
          get(t, p) {
            if (p === 'observe') {
              return function (target) {
                try { cb([_cxForgeEntry(target, null)], inst); } catch (e3) {}
                return t.observe(target);
              };
            }
            // 原生方法调用时 this 绑定到 Proxy 会抛 Illegal invocation，统一 bind(t) 绑定到原生实例
            const val = t[p];
            return typeof val === 'function' ? val.bind(t) : val;
          },
        };
        return new Proxy(inst, handler);
      };
      window.IntersectionObserver = w1;
    }
  } catch (e) { swallow(e); }
})();
