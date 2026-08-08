// 纯函数单测（零 src 改动、零运行时依赖）
// 策略：用 vm 沙箱加载各 src 模块片段。这些模块顶层仅含函数声明（无顶层执行语句），
// 其依赖（swallow / _cxPanel 等）只在被调用时才用到；我们只调用其中的纯函数，
// 因此以最小 stub 提供 ctx 即可安全加载并捕获函数声明到沙箱全局。
//
// 覆盖（来自 code review 的"为纯函数加测试"建议）：
//   - escapeHTML            (takeover/foundation/utils/utils.js)        HTML 转义，防 XSS
//   - fmtTime               (presentation/dashboard.js)                 秒 → m:ss / h:mm:ss
//   - signatureOf           (takeover/engine/dedup.js)                  收集视频/iframe 的可定位签名（id/name/title/data-*）
//   - shortSrc              (takeover/engine/foreground.js)             视频源裁剪显示
//   - urlParam              (takeover/foundation/utils/url.js)          URL 查询参数解析（兼容 hash 路由）
//   - collectAttachmentIds  (takeover/engine/targeting.js)             附件 id 集合收集（去重 + 嵌套下钻）
//   - clampCfg              (takeover/foundation/storage/storage.js)    面板配置越界夹回允许范围
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = path.join(__dirname, '..', 'src', 'chaoxing-force-play');
const FILES = {
  escapeHTML: path.join(SRC, 'takeover', 'foundation', 'utils', 'utils.js'),
  fmtTime: path.join(SRC, 'presentation', 'dashboard.js'),
  signatureOf: path.join(SRC, 'takeover', 'engine', 'dedup.js'),
  shortSrc: path.join(SRC, 'takeover', 'engine', 'foreground.js'),
  urlParam: path.join(SRC, 'takeover', 'foundation', 'utils', 'url.js'),
  collectAttachmentIds: path.join(SRC, 'takeover', 'engine', 'targeting.js'),
  clampCfg: path.join(SRC, 'takeover', 'foundation', 'storage', 'storage.js'),
  mergeAnswers: path.join(SRC, 'takeover', 'engine', 'quiz-merge.js'),
};

let failures = 0, count = 0;
function assert(name, cond, detail) {
  count++;
  if (cond) { console.log('  PASS  ' + name); }
  else { failures++; console.error('  FAIL  ' + name + (detail ? '  -> ' + detail : '')); }
}

// 加载单个 src 模块到独立沙箱；stub 运行时依赖，使其顶层（函数声明）可安全求值
function load(file) {
  const ctx = {
    swallow: function () {},
    console: console,
    module: undefined,
    window: {},
    document: {},
    localStorage: { getItem: function () { return null; }, setItem: function () {}, removeItem: function () {} },
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, { filename: file });
  return ctx;
}

const utils = load(FILES.escapeHTML);
const dash = load(FILES.fmtTime);
const ded = load(FILES.signatureOf);
const fg = load(FILES.shortSrc);
const url = load(FILES.urlParam);
const tgt = load(FILES.collectAttachmentIds);
const store = load(FILES.clampCfg);
const mrg = load(FILES.mergeAnswers);

console.log('escapeHTML:');
const eh = utils.escapeHTML;
// 用无歧义输入：< > & "（四个特殊字符），避免单引号字符串里 \' 转义造成的构造歧义
const inp = '<a href="x">&';
assert('escapes < > & "', eh(inp) === '&lt;a href=&quot;x&quot;&gt;&amp;', eh(inp));
assert('escapes single quote', eh("a'b") === 'a&#39;b', eh("a'b"));
assert('null -> empty', eh(null) === '', 'got: ' + JSON.stringify(eh(null)));
assert('number passes through', eh(123) === '123', 'got: ' + JSON.stringify(eh(123)));
assert('undefined -> empty', eh(undefined) === '', 'got: ' + JSON.stringify(eh(undefined)));

console.log('fmtTime:');
const ft = dash.fmtTime;
assert('0 -> 0:00', ft(0) === '0:00', ft(0));
assert('65 -> 1:05', ft(65) === '1:05', ft(65));
assert('3661 -> 1:01:01', ft(3661) === '1:01:01', ft(3661));
assert('negative clamps to 0:00', ft(-5) === '0:00', ft(-5));
assert('NaN clamps to 0:00', ft(NaN) === '0:00', ft(NaN));
assert('3599 -> 59:59', ft(3599) === '59:59', ft(3599));

console.log('signatureOf:');
const sig = ded.signatureOf;
assert('collects id/name/title',
  JSON.stringify(sig({ id: 'i1', name: 'n1', title: 't1', getAttribute: function () { return null; }, attributes: [] })) ===
  JSON.stringify(['i1', 'n1', 't1']), 'collect id/name/title');
assert('collects data-* and bare "data" attr',
  JSON.stringify(sig({ getAttribute: function (n) { return n === 'data' ? 'D' : null; }, attributes: [{ name: 'data', value: 'D' }, { name: 'data-x', value: 'vx' }, { name: 'class', value: 'c' }] })) === JSON.stringify(['D', 'vx']), 'data attrs');
assert('empty element -> []',
  JSON.stringify(sig({ getAttribute: function () { return null; }, attributes: [] })) === JSON.stringify([]), 'empty');

console.log('shortSrc:');
const ss = fg.shortSrc;
assert('unknown src -> placeholder', ss({}) === '(未知源)', ss({}));
assert('plain src passthrough', ss({ src: 'http://a/b.mp4' }) === 'http://a/b.mp4', ss({ src: 'http://a/b.mp4' }));
assert('currentSrc preferred over src', ss({ src: 'http://a/b.mp4', currentSrc: 'http://a/c.mp4' }) === 'http://a/c.mp4', ss({ src: 'x', currentSrc: 'y' }));
const longSrc = 'http://x.example.com/' + 'a'.repeat(120);
assert('long src truncated with ellipsis', ss({ src: longSrc }) === (longSrc.slice(0, 48) + '…' + longSrc.slice(-26)), ss({ src: longSrc }));

console.log('urlParam:');
const up = url.urlParam;
assert('single key', up('https://x.com/a?kid=123&t=2', 'kid') === '123', up('https://x.com/a?kid=123&t=2', 'kid'));
assert('hash route param', up('https://x.com/a#kid=999', 'kid') === '999', up('https://x.com/a#kid=999', 'kid'));
// 多键数组语义 = 候选键按优先级取首个命中的单值（真实用法：['chapterId','knowledgeId']）
assert('multi keys -> first hit value', up('?a=1&b=2', ['a', 'b']) === '1', up('?a=1&b=2', ['a', 'b']));
assert('multi keys -> falls back to 2nd', up('?b=2', ['a', 'b']) === '2', up('?b=2', ['a', 'b']));
assert('multi keys none present -> null', up('?c=3', ['a', 'b']) === null, up('?c=3', ['a', 'b']));
assert('missing key -> null', up('https://x.com/', 'kid') === null, up('https://x.com/', 'kid'));
assert('url-encoded value decoded', up('?n=%E4%B8%AD', 'n') === '中', up('?n=%E4%B8%AD', 'n'));

console.log('collectAttachmentIds:');
const collect = tgt.collectAttachmentIds;
const r1 = collect([{ property: { objectid: 'A1' } }, { property: { mid: 'M1' } }, { property: { id: 'ID1' } }, { property: { objectId: 'A2' } }]);
assert('collects objectid/mid/id/objectId (each item one id)', !!(r1 && r1.ids && r1.ids['A1'] && r1.ids['M1'] && r1.ids['ID1'] && r1.ids['A2']), JSON.stringify(r1));
const r2 = collect([{ property: { objectid: 'X', childList: [{ objectid: 'Y' }], attachments: [{ id: 'Z' }] } }]);
assert('walks nested childList/attachments', !!(r2 && r2.ids['X'] && r2.ids['Y'] && r2.ids['Z']), JSON.stringify(r2));
assert('empty array -> null', collect([]) === null, 'got ' + JSON.stringify(collect([])));
assert('non-array -> null', collect('nope') === null, 'got ' + JSON.stringify(collect('nope')));
assert('null arg -> null', collect(null) === null, 'got ' + JSON.stringify(collect(null)));

console.log('clampCfg:');
// 注入 CONFIG/DEBUG 全局（storage.js 的 clampCfg 直接读写这两个全局），再调用验证越界夹回
store.CONFIG = {
  AUTO_STOP_MIN: 200, RESUME_AFTER_MIN: -5, RESCAN_INTERVAL: 99999, END_RELEASE_SEC: 200,
  USER_RATE: 99, LOOP_PLAY: false, SINGLE_VIDEO: false, NINJA_MODE: false,
  PANEL_W: 10, PANEL_POS: { x: 1, y: 1 }, INTRUSION_MODE: 'weird', POLITE_MODE: 0
};
store.DEBUG = 'yes';
store.clampCfg();
const C = store.CONFIG;
assert('AUTO_STOP_MIN clamped to 120', C.AUTO_STOP_MIN === 120, 'got ' + C.AUTO_STOP_MIN);
assert('RESUME_AFTER_MIN clamped to 0', C.RESUME_AFTER_MIN === 0, 'got ' + C.RESUME_AFTER_MIN);
assert('RESCAN_INTERVAL clamped to 5000', C.RESCAN_INTERVAL === 5000, 'got ' + C.RESCAN_INTERVAL);
assert('END_RELEASE_SEC clamped to 120', C.END_RELEASE_SEC === 120, 'got ' + C.END_RELEASE_SEC);
assert('USER_RATE clamped to 4 (hi)', C.USER_RATE === 4, 'got ' + C.USER_RATE);
assert('PANEL_W clamped to 288 (lo bound)', C.PANEL_W === 288, 'got ' + C.PANEL_W);
assert('INTRUSION_MODE invalid -> auto', C.INTRUSION_MODE === 'auto', 'got ' + C.INTRUSION_MODE);
assert('POLITE_MODE coerced to bool', C.POLITE_MODE === false, 'got ' + JSON.stringify(C.POLITE_MODE));
assert('DEBUG coerced to bool', store.DEBUG === true, 'got ' + JSON.stringify(store.DEBUG));

console.log('mergeAnswers / decisionFor:');
const mergeAnswers = mrg.mergeAnswers;
const decisionFor = mrg.decisionFor;
assert('empty array -> null', mergeAnswers([]) === null, 'got ' + JSON.stringify(mergeAnswers([])));
assert('null arg -> null', mergeAnswers(null) === null, 'got ' + JSON.stringify(mergeAnswers(null)));
const ma = mergeAnswers([{ idx: 0, source: 'bank' }]);
assert('single bank -> idx 0, conf 1.0', ma && ma.index === 0 && Math.abs(ma.confidence - 1.0) < 1e-9 && ma.sources.join() === 'bank', JSON.stringify(ma));
const mb = mergeAnswers([{ idx: 2, source: 'ai' }]);
assert('single ai -> idx 2, conf 0.7', mb && mb.index === 2 && Math.abs(mb.confidence - 0.7) < 1e-9, JSON.stringify(mb));
const mc = mergeAnswers([{ idx: 1, source: 'random' }]);
assert('single random -> conf 0.3', mc && Math.abs(mc.confidence - 0.3) < 1e-9, JSON.stringify(mc));
const md = mergeAnswers([{ idx: 0, source: 'bank' }, { idx: 0, source: 'ai' }]);
assert('bank+ai agree -> conf 1.0 (unanimous), idx 0', md && md.index === 0 && Math.abs(md.confidence - 1.0) < 1e-9, JSON.stringify(md));
const me = mergeAnswers([{ idx: 0, source: 'bank' }, { idx: 1, source: 'ai' }]);
// agg: bank 1.0*1.0=1.0 ; ai 0.7*0.7=0.49 → conf = 1.0/(1.0+0.49)=0.6711..., idx 0
assert('bank vs ai disagree -> idx 0, conf≈0.671', me && me.index === 0 && Math.abs(me.confidence - (1.0 / 1.49)) < 1e-9, JSON.stringify(me));
const mf = mergeAnswers([{ idx: '2', source: 'bank' }]);
assert('string idx normalized to number', mf && mf.index === 2 && typeof mf.index === 'number', JSON.stringify(mf));
assert('decisionFor 1.0 -> auto', decisionFor(1.0) === 'auto', decisionFor(1.0));
assert('decisionFor 0.7 -> confirm', decisionFor(0.7) === 'confirm', decisionFor(0.7));
assert('decisionFor 0.5 -> review', decisionFor(0.5) === 'review', decisionFor(0.5));
assert('decisionFor NaN -> review', decisionFor(NaN) === 'review', decisionFor(NaN));
assert('decisionFor custom thresholds', decisionFor(0.8, 0.9, 0.7) === 'confirm' && decisionFor(0.95, 0.9, 0.7) === 'auto', decisionFor(0.8, 0.9, 0.7));

console.log('\n' + (failures === 0 ? 'ALL PASS (' + count + ' assertions)' : (failures + '/' + count + ' ASSERTION(S) FAILED')));
process.exit(failures === 0 ? 0 : 1);
