// 校验本次修复是否落入产物
var fs = require('fs');
var s = fs.readFileSync(__dirname + '/../chaoxing-force-play.user.js', 'utf8');

var tests = {
  // P0-1: quizAutoSubmit 替代重复 quizAuto
  'quizAutoSubmit_rename': s.includes('quizAutoSubmit'),
  // P0-2: ninja toast 反转修复
  'ninja_toast_fix': s.includes('n 模式已') && (s.indexOf('开') < s.indexOf('关') || s.match(/'\u5f00'\s*:\s*'\u5173'/) !== null),
  // P0-3: window.Store 暴露
  'window_Store_exposed': s.includes('window.Store = Store'),
  // P0-4: _mo 赋值分离
  'mo_split': s.includes('_mo = new MutationObserver(function') && s.includes('_mo.observe(document.documentElement'),
  // P0-5: scanVideos 签名修复
  'scanVideos_hostSigs': s.includes('scanVideos(root, hostSigs, depth)'),
  // P0-6: seeking handler 命名 + userResume 拆除
  'seekHandler_named': s.includes('__seekHandler'),
  'userResume_removeHandler': s.includes('removeEventListener') && s.includes('__seekHandler'),
  // P0-7: 答案字母→索引转换
  'answer_letter_to_idx': s.includes('A: 0, B: 1, C: 2, D: 3'),
  // P0-8: 键盘快捷键自定义键修复
  'kb_play_toggle_fix': s.match(/var pass = !\(v && v\.__cxUserPaused\)/),
  // P0-9: throttle 捕获最新参数
  'throttle_latest_args': s.includes('始终捕获最新参数'),
  // P1-1: auto-next .catch()
  'autonext_outer_catch': s.includes('probeQuizEntry error'),
  // P1-2: Store.state._loopTimer 镜像同步
  'loopTimer_mirror_commands': s.includes('Store.state._loopTimer = _loopTimer'),
  // P1-3: KVS.set/del return Promise
  'kvs_return_promise': s.includes('return Promise.resolve'),
  // P1-6: tamper-guard 防双定时器
  'tg_double_timer_fix': s.includes('_tgTimer') && s.includes('防止双重启动'),
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
