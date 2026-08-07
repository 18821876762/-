  // ===== MODULE: 接管策略开关（biz/policy）=====
  // 域：业务·策略 —— 是否接管视频的「开关判定」，与通用工具解耦（原先错置于 takeover/foundation/utils/utils.js 顶层）。
  //   页面级 opt-out：?cxforce=off 或 localStorage.cx_force_off='1' → 全局停用（含原型 neutralize 与扫描接管）。
  //   元素级 opt-out：祖先含 [data-cx-force-skip] → 该视频不接管、保留原生暂停。
  // 使用方：takeover/foundation/meta-config/config.js（apply* 业务动作）、takeover/dom/dom.js（overrideVideo 接管前置判定），均为运行时调用。
  //   本模块仅依赖 utils/swallow（同 IIFE 闭包、函数声明 hoist，顺序无关）。

  // 帧级 / 页面级 opt-out：在 @match 限定的 chaoxing/edu.cn 内，仍允许用户关闭本页强制播放。
  //   URL 查询参数 ?cxforce=off 或 localStorage.cx_force_off === '1' 时全局停用（含原型 neutralize 与扫描接管）。
  function forcePlayEnabled() {
    try {
      if (/[?&]cxforce=off/i.test(window.location.search)) return false;
      if (localStorage.getItem('cx_force_off') === '1') return false;
    } catch (e) { swallow(e); }
    return true;
  }

  // 元素级 opt-out：给视频或其任意祖先加 data-cx-force-skip，使其不被接管、保留原生暂停。
  function cxVideoOptOut(v) {
    try {
      if (v && v.closest && v.closest('[data-cx-force-skip]')) return true;
    } catch (e) { swallow(e); }
    return false;
  }
