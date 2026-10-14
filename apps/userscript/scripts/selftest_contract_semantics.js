/**
 * selftest_contract_semantics.js —— 「语义门禁」自身的变异自检
 *
 * 为什么需要：静态断言最大的风险是**空转**——正则写错/函数改名后断言恒真，
 * 门禁天天绿灯却什么都没守住。本脚本把源码复制到临时目录，**故意破坏**每条契约，
 * 断言门禁必须报出对应条款；若某个变异仍然通过，说明该条规则已失效（假绿灯）。
 *
 * 不修改真实源码：全部变异发生在 os.tmpdir() 下的副本，运行结束即删除。
 */
'use strict';

var fs = require('fs');
var os = require('os');
var path = require('path');
var cp = require('child_process');

var SRC = path.join(__dirname, '..', 'src', 'chaoxing-force-play');
var GATE = path.join(__dirname, 'verify_contract_semantics.js');

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  fs.readdirSync(from, { withFileTypes: true }).forEach(function (e) {
    var s = path.join(from, e.name), d = path.join(to, e.name);
    if (e.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  });
}
function rmDir(p) { fs.rmSync(p, { recursive: true, force: true }); }

/** 在副本里做一次字符串替换；替换未命中即视为变异失败（源码结构已变，需同步更新自检） */
function mutate(root, relFile, find, replace) {
  var parts = require('./source-groups.cjs').groupFiles(root, relFile);
  for (var part of parts) {
    var p = path.join(root, part);
    var code = fs.readFileSync(p, 'utf8');
    if (code.indexOf(find) < 0) continue;
    fs.writeFileSync(p, code.replace(find, replace), 'utf8');
    return true;
  }
  return false;
}

/* 每个变异 = 一种「真实会发生的退化」，expect 为必须被报出的条款号 */
var MUTATIONS = [
  {
    name: '删掉 renderVideoList 的 owner 守卫（多 iframe 抢绘/点错视频）',
    expect: 'C1.2',
    apply: function (root) {
      return mutate(root, 'presentation/dashboard.js',
        'if (!_cxPanelOwnerClaim()) return;   // R4+R5', '// (mutated) 守卫被删');
    }
  },
  {
    name: '把 owner 判定退化为「纯判等」（owner 帧卸载后列表永久冻结）',
    expect: 'C1.3',
    apply: function (root) {
      return mutate(root, 'presentation/panel-core.js',
        'if (!_cxPanel._cxPanelOwner) { _cxPanel._cxPanelOwner = window; return true; }',
        '/* (mutated) 抢占分支被删 */');
    }
  },
  {
    name: '卸载路径漏掉实例级 play/pause 还原（卸载后视频被 no-op 锁死）',
    expect: 'C4.2',
    apply: function (root) {
      return mutate(root, 'takeover/dom/lifecycle.js',
        'delete _iv.pause; delete _iv.play;', '/* (mutated) 实例还原被删 */');
    }
  },
  {
    name: '卸载路径漏掉根命名空间撤销（外部仍能拿到半死接口）',
    expect: 'C4.2',
    apply: function (root) {
      return mutate(root, 'takeover/dom/lifecycle.js',
        "delete window.__CX_FORCE_PLAY; }, 'cleanup.ns.root'",
        "void 0; }, 'cleanup.ns.root'");
    }
  },
  {
    name: '视频列表去掉失败占位行（行数 < 视频数 → 视觉错位）',
    expect: 'C3.1',
    apply: function (root) {
      return mutate(root, 'presentation/dashboard.js', 'cx-video-item-failed', 'cx-video-item-x');
    }
  },
  {
    name: '弹窗答题入口去掉站点守卫（在无关站点误删 DOM）',
    expect: 'C6.2',
    apply: function (root) {
      var p = path.join(root, 'sites/popup-quiz.js');
      var code = fs.readFileSync(p, 'utf8');
      var i = code.indexOf('function popupQuizTick');
      if (i < 0) return false;
      var seg = code.slice(i);
      if (seg.indexOf('_pqSiteGuard()') < 0) return false;
      fs.writeFileSync(p, code.slice(0, i) + seg.replace('_pqSiteGuard()', 'true'), 'utf8');
      return true;
    }
  },
  {
    name: '面板改用「链式取元素后直接赋值」（精简模板下 TypeError 中断刷新）',
    expect: 'C2.1',
    apply: function (root) {
      var p = path.join(root, 'presentation/dashboard.js');
      var code = fs.readFileSync(p, 'utf8');
      var i = code.indexOf('function refreshPanelState');
      if (i < 0) return false;
      var j = code.indexOf('\n', i);
      fs.writeFileSync(p, code.slice(0, j + 1) +
        "    _cxPanel.querySelector('#__cxVer').textContent = 'x';\n" + code.slice(j + 1), 'utf8');
      return true;
    }
  },
  {
    name: '还原函数只定义不调用（静音后永不还原，R6 复发）',
    expect: 'C5.2',
    apply: function (root) {
      return mutate(root, 'plugins/addons/video-ended-notify.js',
        "bestEffort(restoreIfNeeded, 'ven.restoreOnPlay')", "bestEffort(function () {}, 'ven.restoreOnPlay')");
    }
  },
  {
    name: '越过 detectSite() 直接读 location.hostname 做站点分支',
    expect: 'C6.1',
    apply: function (root) {
      return mutate(root, 'takeover/bootstrap/main-loop.js',
        'function _loopTick', "function _mutantSite() { return location.hostname === 'x'; }\n  function _loopTick");
    }
  },
  {
    name: "待调用函数用 `typeof f !== 'undefined' && f` 冗余双判（R9 复发）",
    expect: 'C6.3',
    apply: function (root) {
      return mutate(root, 'takeover/dom/lifecycle.js',
        "if (typeof restorePrototypePause === 'function') restorePrototypePause();",
        "if (typeof restorePrototypePause !== 'undefined' && restorePrototypePause) restorePrototypePause();");
    }
  },
  {
    name: '凭据请求重新从公开 CONFIG 读取 Key',
    expect: 'C7.1',
    apply: function (root) {
      return mutate(root, 'takeover/engine/quiz-vision-endpoint.js',
        'if (!apiKey) throw', 'apiKey = CONFIG.QUIZ_VISION_API_KEY; if (!apiKey) throw');
    }
  },
  {
    name: '携带 Key 的请求恢复自动重定向',
    expect: 'C7.1',
    apply: function (root) {
      return mutate(root, 'takeover/engine/quiz-vision-endpoint.js', "redirect: 'error'", "redirect: 'follow'");
    }
  },
  {
    name: '配置导入取消凭据键检查',
    expect: 'C7.1',
    apply: function (root) {
      return mutate(root, 'presentation/panel-controls-data.js',
        'return isCredentialConfigKey(name) || quizCredentialStore.contains(name) || hasCredentialConfigValue(cfg[name]);',
        'return quizCredentialStore.contains(name) || hasCredentialConfigValue(cfg[name]);');
    }
  },
  {
    name: '私有凭据消费取消 Origin 比对',
    expect: 'C7.1',
    apply: function (root) {
      return mutate(root, 'takeover/foundation/storage/credentials.js',
        'if (!boundOrigin || origin !== boundOrigin)', 'if (!boundOrigin)');
    }
  },
  {
    name: 'Key 保存绕过端点白名单验证',
    expect: 'C7.1',
    apply: function (root) {
      return mutate(root, 'takeover/foundation/storage/credentials.js',
        'if (nextKey) nextOrigin = originOf(endpoint, true);', 'if (nextKey) nextOrigin = originOf(endpoint, false);');
    }
  },
  {
    name: '凭据请求校验后仍用未经规范化的地址发送',
    expect: 'C7.1',
    apply: function (root) {
      return mutate(root, 'takeover/engine/quiz-vision-endpoint.js', 'fetchWithTimeout(_u.href, {', 'fetchWithTimeout(ep, {');
    }
  }
];

var base = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-contract-selftest-'));
var pass = 0, fail = 0, lines = [];

/* ① 基线：未变异副本必须绿（否则说明副本机制本身有问题） */
(function () {
  var root = path.join(base, 'baseline');
  copyDir(SRC, root);
  var r = cp.spawnSync(process.execPath, [GATE], { env: Object.assign({}, process.env, { CX_CONTRACT_SRC: root }), encoding: 'utf8' });
  if (r.status === 0) { pass++; lines.push('  PASS  基线副本通过门禁'); }
  else { fail++; lines.push('  FAIL  基线副本未通过门禁（自检机制本身有问题）\n' + (r.stdout || '') + (r.stderr || '')); }
})();

/* ② 变异：每种退化都必须被对应条款捕获 */
MUTATIONS.forEach(function (mu, idx) {
  var root = path.join(base, 'm' + idx);
  copyDir(SRC, root);
  var applied = false;
  try { applied = mu.apply(root); } catch (e) { applied = false; }
  if (!applied) {
    fail++;
    lines.push('  FAIL  ' + mu.name + '\n        变异未能施加：源码结构已变，需同步更新本自检的锚点字符串');
    return;
  }
  var r = cp.spawnSync(process.execPath, [GATE], { env: Object.assign({}, process.env, { CX_CONTRACT_SRC: root }), encoding: 'utf8' });
  var out = (r.stdout || '') + (r.stderr || '');
  if (r.status !== 0 && out.indexOf('[' + mu.expect + ']') >= 0) {
    pass++;
    lines.push('  PASS  [' + mu.expect + '] ' + mu.name);
  } else {
    fail++;
    lines.push('  FAIL  [' + mu.expect + '] ' + mu.name +
      '\n        门禁未报出该条款（规则空转 = 假绿灯）；实际 exit=' + r.status);
  }
});

rmDir(base);

console.log('\n=== 语义门禁变异自检 ===');
lines.forEach(function (l) { console.log(l); });
console.log('结论: ' + (fail === 0 ? 'PASS' : 'FAIL') + ' (' + pass + '/' + (pass + fail) + ')');
process.exit(fail === 0 ? 0 : 1);
