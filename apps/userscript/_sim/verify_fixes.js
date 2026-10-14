// 校验本次修复是否落入产物
var fs = require('fs');
var s = fs.readFileSync(require('../scripts/project-paths.cjs').personalProduct, 'utf8');

var tests = {
  // P0-1: quizAutoSubmit 替代重复 quizAuto
  'quizAutoSubmit_rename': s.includes('quizAutoSubmit'),
  // P0-2: ninja toast 反转修复
  'ninja_toast_fix': s.includes('n 模式已') && (s.indexOf('开') < s.indexOf('关') || s.match(/'\u5f00'\s*:\s*'\u5173'/) !== null),
  // P0-3: window.EventBus 暴露 + window.Store 别名
  'window_Store_exposed': s.includes('window.EventBus = EventBus') && s.includes('window.Store = EventBus'),
  // P0-4: _mo 赋值分离
  'mo_split': s.includes('_mo = new MutationObserver(function') && s.includes('_mo.observe(document.documentElement'),
  // P0-5: scanVideos 签名修复（2026-08-14 校准：源码已增第 4 参 incremental，子串改为去尾括号避免与 3 参旧签名歧义）
  'scanVideos_hostSigs': s.includes('scanVideos(root, hostSigs, depth,'),
  // P0-6: seeking handler 命名 + userResume 拆除
  'seekHandler_named': s.includes('__seekHandler'),
  'userResume_removeHandler': s.includes('removeEventListener') && s.includes('__seekHandler'),
  // P0-7: 答案字母→索引转换（2026-08-14 校准：源码改用 charCode 实现，标记改为实际实现片段）
  'answer_letter_to_idx': s.includes('charCodeAt(0) - 65'),
  // P0-8: 键盘快捷键自定义键修复
  // v4.19.51：userPaused 已 Symbol 化，正则同步改为 FLAGS.userPaused 访问形式
  'kb_play_toggle_fix': s.match(/var pass = !\(v && v\[FLAGS\.userPaused\]\)/),
  // P0-9: throttle 捕获最新参数
  'throttle_latest_args': s.includes('始终捕获最新参数'),
  // P1-1: auto-next .catch()
  'autonext_outer_catch': s.includes('probeQuizEntry error'),
  // P1-2: EventBus.state._loopTimer 镜像同步
  'loopTimer_mirror_commands': s.includes('EventBus.state._loopTimer = _loopTimer'),
  // P1-3: KVS.set/del return Promise
  'kvs_return_promise': s.includes('return Promise.resolve'),
  // P1-6: tamper-guard 防双定时器（2026-08-14 校准：源码注释为「避免双重调度」，标记对齐实际文案）
  'tg_double_timer_fix': s.includes('_tgTimer') && s.includes('避免双重调度'),
  // P1-7: ds-console ticker cleanup
  'ds_ticker_cleanup': s.includes('pagehide') && s.includes('__cxDsTicker') && s.includes('clearInterval')
};

var allOk = true;
Object.keys(tests).forEach(function (k) {
  var ok = tests[k];
  console.log((ok ? 'PASS' : 'FAIL') + ': ' + k);
  if (!ok) allOk = false;
});
console.log('\n' + (allOk ? 'ALL_FIXES_VERIFIED' : 'SOME_FIXES_MISSING'));
process.exit(allOk ? 0 : 1);
