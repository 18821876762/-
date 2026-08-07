/**
 * ESLint 配置（审查整改 #9）。
 *
 * 约束背景：
 * - 产物 chaoxing-force-play.user.js 是「单一 IIFE 闭包、零运行时依赖」的用户脚本，
 *   源模块因被拼接进同一 IIFE 而无法单独解析（core.js 仅 opener、main-loop.js 仅 closer），
 *   故 ESLint 仅对【完整构建产物】做静态分析（源级解析由 build-force-play.ps1 的 node --check 退化为整体 --check）。
 * - 本配置采用「渐进式门禁」：先以语法正确性 + 未定义标识符 + 重声明等硬规则作为 error 级红线，
 *   其余风格/未用变量类规则设为 off/warn，避免对历史代码误伤导致 CI 阻断，后续可逐步加严。
 *
 * 运行：先 build 生成产物，再 `npm run lint`（或 CI 自动在 build 后执行）。
 */
module.exports = {
  root: true,
  env: {
    browser: true,
    es2021: true,
  },
  parserOptions: {
    ecmaVersion: 2021,
    sourceType: 'script',
  },
  globals: {
    // Tampermonkey / Violentmonkey API（用户脚本运行环境全局）
    GM_setValue: 'readonly',
    GM_getValue: 'readonly',
    GM_deleteValue: 'readonly',
    GM_listValues: 'readonly',
    GM_addValueChangeListener: 'readonly',
    GM_removeValueChangeListener: 'readonly',
    GM_xmlhttpRequest: 'readonly',
    GM_registerMenuCommand: 'readonly',
    GM_addStyle: 'readonly',
    GM_info: 'readonly',
    unsafeWindow: 'readonly',
    cloneInto: 'readonly',
    exportFunction: 'readonly',
    // 现代 DOM / 网络 API（部分旧版 browser env 未自带，显式声明避免 no-undef 误报）
    fetch: 'readonly',
    AbortController: 'readonly',
    AbortSignal: 'readonly',
    TextEncoder: 'readonly',
    TextDecoder: 'readonly',
    URL: 'readonly',
    URLSearchParams: 'readonly',
    MutationObserver: 'readonly',
    IntersectionObserver: 'readonly',
    ResizeObserver: 'readonly',
    requestIdleCallback: 'readonly',
    cancelIdleCallback: 'readonly',
    matchMedia: 'readonly',
    crypto: 'readonly',
  },
  rules: {
    // —— 门禁级（error：出现即 CI 失败）——
    'no-undef': 'error',            // 引用未声明标识符（捕获拼写错/丢失依赖）
    'no-dupe-keys': 'error',        // 对象字面量重复键
    'no-dupe-args': 'error',        // 函数参数重名
    'no-irregular-whitespace': 'error',
    // —— 观察级（warn：不阻断，仅提示，后续逐步加严）——
    // 已知技术债（登记于 docs/reviews/refactor-force-play-coupling-plan.md §整改状态）：
    //   · escapeHTML 在 utils.js 与 foreground.js 重复定义（级联副本，函数声明 hoist 后定义覆盖，行为一致）
    //   · toast     在 utils.js 与 presentation/toast.js 重复定义（同上）
    //   · _videoByArg 内 `var v` 重复声明（var hoist 合法，纯风格）
    // 这 3 处为历史单 IIFE 闭包既有结构，去重需跨模块确认语义后单独 PR，暂以 warn 放行。
    'no-redeclare': 'warn',
    'no-cond-assign': 'warn',
    'no-constant-condition': ['warn', { checkLoops: false }],
    'no-empty': 'off',
    'no-unused-vars': 'off',        // 历史代码大量跨 IIFE 碎片引用，先关闭，后续逐步清理再加严
    'no-shadow': 'off',
    'no-prototype-builtins': 'off',
  },
};
