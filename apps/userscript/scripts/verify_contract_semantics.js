/**
 * verify_contract_semantics.js —— 跨文件契约「语义级」门禁（门禁 ⑥）
 *
 * 背景（code-review-report.md 附录 D.4 遗留盲区②）：
 *   门禁 ④ 只校验「命名空间挂载点 ↔ 跨文件读点」是否成对；
 *   门禁 ⑤ 只校验「docs/CONTRACT.md 的挂载点总表是否漂移」。
 *   两者都只看「符号是否登记」，**不看语义**——例如某个面板写函数是否真的加了 owner 守卫、
 *   卸载路径是否真的还原了实例级 hook。这类条款此前只能靠人工评审 + 沙箱间接守护。
 *
 * 本脚本把 docs/CONTRACT.md 第 1–6 章的**手写不变量**翻译成可执行的静态断言：
 *   条款失守 → 构建失败，并指出条款号 / 文件 / 原因 / 修法。
 *
 * 边界（诚实标注）：静态文本断言不是类型系统，只能守住「结构性写法」这一层；
 *   运行期行为仍由 _sim 沙箱用例守护，二者互补。
 */
'use strict';

var fs = require('fs');
var path = require('path');

// 允许指向源码副本：供「变异自检」（故意破坏契约，验证门禁真的会红）使用，避免污染真实源码
var SRC = process.env.CX_CONTRACT_SRC || path.join(__dirname, '..', 'src', 'chaoxing-force-play');

/* ── 工具：递归收集源码文件 ───────────────────────────────────────── */
function walk(dir, out) {
  out = out || [];
  var ents = fs.readdirSync(dir, { withFileTypes: true });
  for (var i = 0; i < ents.length; i++) {
    var p = path.join(dir, ents[i].name);
    if (ents[i].isDirectory()) walk(p, out);
    else if (/\.js$/.test(ents[i].name)) out.push(p);
  }
  return out;
}
function rel(p) { return path.relative(SRC, p).replace(/\\/g, '/'); }
function read(relPath) { return require('./source-groups.cjs').readSource(SRC, relPath); }

/**
 * 按函数名抽取函数体（含大括号配对，跳过字符串/注释里的括号）。
 * 找不到返回 null —— 调用方需把「函数不存在」本身当作违约（可能被改名/删除）。
 */
function extractFunction(code, name) {
  var re = new RegExp('function\\s+' + name + '\\s*\\(', 'g');
  var m = re.exec(code);
  if (!m) return null;
  var i = code.indexOf('{', m.index);
  if (i < 0) return null;
  var depth = 0, inStr = null, inLine = false, inBlock = false;
  for (var j = i; j < code.length; j++) {
    var c = code[j], n = code[j + 1];
    if (inLine) { if (c === '\n') inLine = false; continue; }
    if (inBlock) { if (c === '*' && n === '/') { inBlock = false; j++; } continue; }
    if (inStr) {
      if (c === '\\') { j++; continue; }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === '/' && n === '/') { inLine = true; j++; continue; }
    if (c === '/' && n === '*') { inBlock = true; j++; continue; }
    if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return code.slice(i, j + 1); }
  }
  return null;
}

/** 去掉行注释/块注释，避免「注释里写了就算数」的假通过 */
function stripComments(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/* ── 违规收集 ─────────────────────────────────────────────────────── */
var violations = [];
var checked = 0;
function fail(clause, where, why, how) {
  violations.push({ clause: clause, where: where, why: why, how: how });
}
function assert(cond, clause, where, why, how) {
  checked++;
  if (!cond) fail(clause, where, why, how);
}

var ALL = walk(SRC).map(function (p) { return { rel: rel(p), code: fs.readFileSync(p, 'utf8') }; });

/* ══ C1.2 面板写函数必须先过 owner 守卫，且守卫在首次 DOM 访问之前 ══ */
var PANEL_WRITERS = [
  { file: 'presentation/dashboard.js', fn: 'refreshPanelState' },
  { file: 'presentation/dashboard.js', fn: 'renderVideoList' },
  { file: 'presentation/panel.js', fn: 'syncPanelInputs' }
];
PANEL_WRITERS.forEach(function (w) {
  var body = extractFunction(read(w.file), w.fn);
  assert(body, 'C1.2', w.file + ':' + w.fn,
    '未找到该函数（被改名/删除？）', '恢复函数或同步更新 docs/CONTRACT.md §1 与本门禁的 PANEL_WRITERS 清单');
  if (!body) return;
  var clean = stripComments(body);
  var gi = clean.search(/if\s*\(\s*!\s*_cxPanelOwnerClaim\s*\(\s*\)\s*\)\s*return/);
  assert(gi >= 0, 'C1.2', w.file + ':' + w.fn,
    '缺少 owner 守卫 `if (!_cxPanelOwnerClaim()) return;`',
    '在函数入口补守卫：非 owner 帧不得改写面板 DOM（多 iframe 下会与创建者帧索引错位→点错视频）');
  if (gi < 0) return;
  var di = clean.search(/\.(querySelector|querySelectorAll|getElementById)\s*\(|\.innerHTML\s*=/);
  assert(di < 0 || gi < di, 'C1.2', w.file + ':' + w.fn,
    'owner 守卫出现在首次 DOM 访问之后（守卫失效：非 owner 帧仍已改写 DOM）',
    '把守卫上移到任何 DOM 读写之前');
});

/* ══ C1.3 _cxPanelOwnerClaim 必须「空则抢占 + 同帧才可写」双语义 ══ */
(function () {
  var body = extractFunction(read('presentation/panel-core.js'), '_cxPanelOwnerClaim');
  assert(body, 'C1.3', 'presentation/panel-core.js:_cxPanelOwnerClaim',
    '未找到 owner 判定函数', '恢复该函数——它是面板单一事实源的唯一入口');
  if (!body) return;
  var clean = stripComments(body);
  assert(/_cxPanel\._cxPanelOwner\s*=\s*window/.test(clean), 'C1.3',
    'presentation/panel-core.js:_cxPanelOwnerClaim',
    '缺少「owner 为空则本帧抢占」分支',
    '补 `if (!_cxPanel._cxPanelOwner) { _cxPanel._cxPanelOwner = window; return true; }`，否则 owner 帧卸载后列表永久冻结');
  assert(/_cxPanel\._cxPanelOwner\s*===\s*window/.test(clean), 'C1.3',
    'presentation/panel-core.js:_cxPanelOwnerClaim',
    '缺少「owner 为他帧则拒写」判等',
    '补 `return _cxPanel._cxPanelOwner === window;`');
})();

/* ══ C1.4 owner 注册与释放必须成对（注册在 panel-core，摘除在 lifecycle）══ */
(function () {
  var pc = stripComments(read('presentation/panel-core.js'));
  var lc = stripComments(read('takeover/dom/lifecycle.js'));
  assert(/_ownerReleaseFn\s*=\s*function/.test(pc) && /addEventListener\s*\(\s*'pagehide'\s*,\s*_ownerReleaseFn/.test(pc),
    'C1.4', 'presentation/panel-core.js',
    'owner 释放钩子未注册（_ownerReleaseFn + pagehide）',
    'owner 帧卸载必须置空 _cxPanelOwner，否则存活帧永远抢不到写权');
  assert(/removeEventListener\s*\(\s*'pagehide'\s*,\s*_ownerReleaseFn/.test(lc),
    'C1.4', 'takeover/dom/lifecycle.js',
    '卸载路径未摘除 owner 释放钩子', '在 cleanupListeners 内 removeEventListener 并置 _ownerReleaseFn = null');
  assert(/_cxPanel\._cxPanelOwner\s*=\s*null/.test(lc),
    'C1.4', 'takeover/dom/lifecycle.js',
    '卸载路径未释放 _cxPanelOwner', '卸载时若 owner 是本帧须置 null，交还写权');
})();

/* ══ C2.1 禁止「链式取元素后直接写属性」——精简/改版模板下必 TypeError ══ */
(function () {
  var re = /(querySelector|querySelectorAll|getElementById)\s*\([^()]*\)\s*\.\s*(textContent|innerHTML|innerText|value|checked|disabled|className)\s*=/;
  ALL.forEach(function (f) {
    var clean = stripComments(f.code);
    var m = clean.match(re);
    assert(!m, 'C2.1', f.rel,
      '存在链式写法 `' + (m ? m[0] : '') + '`：元素缺失时抛 TypeError，会中断整段刷新',
      '改为先取变量再判空：`var el = root.querySelector(...); if (el) el.xxx = ...;`');
  });
})();

/* ══ C3.1/C3.3 视频列表：读状态失败也要出「占位行」，且占位行不得带开关 ══ */
(function () {
  var body = extractFunction(read('presentation/dashboard.js'), 'renderVideoList');
  if (!body) return;   // C1.2 已报缺函数
  var clean = stripComments(body);
  assert(/cx-video-item-failed/.test(clean), 'C3.1', 'presentation/dashboard.js:renderVideoList',
    '缺少读状态失败时的占位行',
    '失败项也必须产出带 data-vi 的行，否则行数 < 视频数 → data-vi 与 _lastVideoList 错位 → 点错视频');
  var fi = clean.indexOf('cx-video-item-failed');
  if (fi >= 0) {
    var seg = clean.slice(fi, fi + 700);
    assert(/data-vi="\s*'\s*\+\s*idx/.test(seg), 'C3.1', 'presentation/dashboard.js:renderVideoList',
      '占位行未写入 data-vi=idx', '占位行必须保留原始下标，索引才对得上');
    assert(seg.indexOf('cx-video-toggle') < 0, 'C3.3', 'presentation/dashboard.js:renderVideoList',
      '占位行带了开关按钮：状态不可读却可点，会误操作',
      '占位行只渲染名称与「状态不可读」，不渲染 toggle');
  }
  assert(/data-vi="\s*'\s*\+\s*idx/.test(clean) && !/data-vi="\s*'\s*\+\s*[a-z_$]*(count|shown|k|n)\b/i.test(clean),
    'C3.2', 'presentation/dashboard.js:renderVideoList',
    'data-vi 疑似使用「渲染计数」而非原始下标', 'data-vi 必须恒等于 allVideos() 的原始下标');
})();

/* ══ C4.2 卸载还原清单：关键层级一个都不能少 ══ */
(function () {
  var body = extractFunction(read('takeover/dom/lifecycle.js'), 'cleanupListeners');
  assert(body, 'C4.2', 'takeover/dom/lifecycle.js:cleanupListeners',
    '未找到卸载函数', '恢复 cleanupListeners——它是唯一的还原入口');
  if (!body) return;
  var clean = stripComments(body);
  var MUST = [
    ['原型级 pause 还原', /restorePrototypePause\s*\(\s*\)/, '缺少原型 pause 还原：卸载后站点仍无法暂停'],
    ['原型级 rate 还原', /restorePrototypeRate\s*\(\s*\)/, '缺少倍速属性还原'],
    ['实例级 play/pause 还原', /delete\s+\w+\.pause\s*;\s*delete\s+\w+\.play/, '缺少实例 own 属性删除：已接管视频卸载后仍被 no-op 锁死（R3）'],
    ['实例级标记清除', /for\s*\(\s*var\s+\w+\s+in\s+FLAGS\s*\)/, '缺少 FLAGS 标记清除：残留 __cxForcePaused 等会影响再次注入'],
    ['play 即时接管监听摘除', /removeEventListener\s*\(\s*'play'\s*,/, '缺少 play 监听摘除'],
    ['答题观察器断开', /quizDisconnect\s*\(\s*\)/, '缺少答题 MutationObserver 断开'],
    ['定时器清除', /clearInterval\s*\(/, '缺少主循环定时器清除'],
    ['命名空间撤销', /delete\s+window\.__CX_FORCE_PLAY/, '缺少根命名空间撤销：外部仍能拿到半死接口']
  ];
  MUST.forEach(function (item) {
    assert(item[1].test(clean), 'C4.2', 'takeover/dom/lifecycle.js:cleanupListeners',
      item[2], '按 docs/CONTRACT.md §4 的还原清单补齐「' + item[0] + '」');
  });
  // 还原动作必须逐条 bestEffort 包裹：任一条抛错不得中断后续还原
  var deletes = (clean.match(/bestEffort\s*\(/g) || []).length;
  assert(deletes >= 20, 'C4.3', 'takeover/dom/lifecycle.js:cleanupListeners',
    '还原动作的 bestEffort 包裹数异常偏少（' + deletes + '）：可能有裸语句，一处抛错会吞掉后续还原',
    '每个还原动作单独 bestEffort(fn, tag) 包裹');
})();

/* ══ C5.2 「改状态」必须有配对的「还原」调用点（非仅定义）══ */
(function () {
  ALL.forEach(function (f) {
    var clean = stripComments(f.code);
    var re = /function\s+(restore[A-Za-z0-9_$]*)\s*\(/g, m;
    while ((m = re.exec(clean))) {
      var name = m[1];
      var uses = clean.split(new RegExp('\\b' + name + '\\b')).length - 1;
      assert(uses >= 2, 'C5.2', f.rel + ':' + name,
        '还原函数只有定义、没有任何调用点（状态改了回不去）',
        '把还原挂到对偶事件上（如静音→任一视频 play 即 restore），或删除死代码');
    }
  });
})();

/* ══ C6.1 站点判定唯一入口：禁止在 site-router 之外用 location 做站点分支 ══ */
(function () {
  var ALLOW = {
    'takeover/foundation/site/site-router.js': '站点判定的唯一权威实现',
    'takeover/engine/vision-deepseek-bootstrap.js': '判定「本页是否就是应答端站点」，非业务站点分支',
    'presentation/diagnostics.js': '仅用于诊断信息展示，不做分支'
  };
  ALL.forEach(function (f) {
    if (ALLOW[f.rel]) return;
    var clean = stripComments(f.code);
    assert(!/location\s*\.\s*(hostname|host)\b/.test(clean), 'C6.1', f.rel,
      '越过 detectSite() 直接读 location.host(name) 做站点判断',
      '统一走 detectSite()/currentSiteCfg()；确有例外须在本门禁 ALLOW 中登记理由');
  });
})();

/* ══ C6.2 弹窗答题入口必须先过站点守卫（否则在无关站点误删 DOM）══ */
(function () {
  var code = read('sites/popup-quiz.js');
  ['popupQuizTick', 'popupQuizBlock'].forEach(function (fn) {
    var body = extractFunction(code, fn);
    assert(body, 'C6.2', 'sites/popup-quiz.js:' + fn, '未找到该入口函数', '恢复函数或同步更新契约');
    if (!body) return;
    var clean = stripComments(body);
    var gi = clean.search(/_pqSiteGuard\s*\(\s*\)/);
    assert(gi >= 0, 'C6.2', 'sites/popup-quiz.js:' + fn,
      '缺少站点守卫 _pqSiteGuard()', '入口首行判定站点，未命中直接 return，避免在无关站点误删弹窗');
    var qi = clean.search(/querySelector(All)?\s*\(/);
    assert(gi < 0 || qi < 0 || gi < qi, 'C6.2', 'sites/popup-quiz.js:' + fn,
      '站点守卫出现在 DOM 扫描之后', '守卫必须前置于任何 DOM 操作');
  });
})();

/* ══ C6.3 「待调用的函数」禁用 `typeof x !== 'undefined' && x` 冗余双判（R9）══
 * 仅针对**随后被当函数调用**的标识符：函数声明恒为 'function'，`!== 'undefined' && x` 是
 * 冗余双判，且无法区分「同名非函数变量」。
 * 反例豁免：`typeof _cxPanel !== 'undefined' && _cxPanel && _cxPanel.x` —— 这里 `&& _cxPanel`
 * 是**判空**（该变量可为 null），不是冗余，必须放行。判据 = 该标识符是否以 `x(` 形式被调用。
 */
(function () {
  ALL.forEach(function (f) {
    var clean = stripComments(f.code);
    var re = /typeof\s+([A-Za-z_$][\w$]*)\s*!==\s*'undefined'\s*&&\s*\1\b/g, m;
    while ((m = re.exec(clean))) {
      var name = m[1];
      var tail = clean.slice(m.index + m[0].length, m.index + m[0].length + 160);
      var calledLater = new RegExp('\\b' + name + '\\s*\\(').test(tail);
      var isFnDecl = new RegExp('function\\s+' + name + '\\s*\\(').test(clean);
      assert(!(calledLater || isFnDecl), 'C6.3', f.rel,
        '冗余双判 `' + m[0].replace(/\s+/g, ' ') + '`：' + name + ' 随后被当函数调用，typeof 已足够',
        "统一写成 `typeof " + name + " === 'function'`（与 lifecycle.js 既有风格一致）");
    }
  });
})();

/* ══ C7.1 凭据私有边界：配置、网页存储与共享命名空间不能保存 Key ══ */
(function () {
  var credentialFile = 'takeover/foundation/storage/credentials.js';
  ALL.forEach(function (f) {
    var clean = stripComments(f.code);
    if (f.rel !== credentialFile) {
      assert(!/CONFIG\s*\.\s*QUIZ_VISION_API_KEY\b/.test(clean), 'C7.1', f.rel,
        '公开 CONFIG 读写真实凭据', '只在闭包内通过 quizCredentialStore 取凭据；公开配置仅保留开关/状态');
      if (f.rel !== 'takeover/foundation/storage/keys.js') assert(!/CX_KEYS\s*\.\s*VISION_API_KEY\b/.test(clean), 'C7.1', f.rel,
        '绕过一次性迁移直接读写旧网页 Key', '旧 Key 只允许由 credentials.js 读取并删除');
    }
    assert(!/__CX_FORCE_PLAY\s*\.\s*quizCredentialStore\s*=/.test(clean), 'C7.1', f.rel,
      '私有凭据接口挂载到公开命名空间', '私有凭据模块只能在主 IIFE 内调用');
  });
  var data = stripComments(read('presentation/panel-controls-data.js'));
  var exportAt = data.indexOf('var btnExportCfg'), importAt = data.indexOf('var btnImportCfg');
  var exporting = data.slice(exportAt, importAt), importing = data.slice(importAt);
  [exporting, importing].forEach(function (body, index) {
    assert(exportAt >= 0 && importAt > exportAt && /isCredentialConfigKey/.test(body) && /hasCredentialConfigValue/.test(body),
      'C7.1', 'presentation/panel-controls-data.js:' + (index ? 'import' : 'export'),
      '配置导出/导入缺少凭据键和值过滤', '拒绝凭据类键、嵌套凭据与敏感串，不向网页存储写入');
  });
  var endpoint = stripComments(read('takeover/engine/quiz-vision-endpoint.js'));
  assert(/redirect\s*:\s*'error'/.test(endpoint), 'C7.1', 'takeover/engine/quiz-vision-endpoint.js',
    '携带凭据的请求允许重定向', '设置 redirect:error，避免转发到未登记端点');
  var credentials = stripComments(read(credentialFile));
  assert(/if\s*\(\s*!boundOrigin\s*\|\|\s*origin\s*!==\s*boundOrigin\s*\)/.test(credentials), 'C7.1', credentialFile,
    '凭据消费缺少私有 Origin 精确校验', '请求来源必须与保存时的私有授权来源相同');
  assert(/if\s*\(nextKey\)\s*nextOrigin\s*=\s*originOf\(endpoint,\s*true\)/.test(credentials) && /key:\s*key,\s*origin:\s*boundOrigin/.test(credentials), 'C7.1', credentialFile,
    '非空 Key 保存未验证端点并持久保存授权来源', '只有重新输入 Key 才绑定经协议与白名单验证的接口 Origin');
  assert(/quizCredentialStore\.use\(_u\.origin,/.test(endpoint) && /fetchWithTimeout\(_u\.href,/.test(endpoint), 'C7.1', 'takeover/engine/quiz-vision-endpoint.js',
    '凭据请求校验来源与实际发送地址不一致', '以同一个 URL 的 origin 授权和 href 发送请求');
})();

/* ── 输出 ─────────────────────────────────────────────────────────── */
if (violations.length) {
  console.error('[contract-semantics] 语义契约校验 FAILED —— ' + violations.length + ' 处违约（共 ' + checked + ' 项断言）\n');
  violations.forEach(function (v, i) {
    console.error('  ' + (i + 1) + ') [' + v.clause + '] ' + v.where);
    console.error('     原因：' + v.why);
    console.error('     修法：' + v.how);
  });
  console.error('\n  条款正文见 docs/CONTRACT.md（章节号与上方 [Cx.y] 对应）');
  process.exit(1);
}
console.log('[contract-semantics] OK —— ' + checked + ' 项语义断言全部通过（覆盖 C1.2/C1.3/C1.4/C2.1/C3.x/C4.x/C5.2/C6.x/C7.1）');
process.exit(0);
