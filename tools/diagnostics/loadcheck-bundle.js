'use strict';
const projectPaths = require('./project-paths.cjs');
// 临时沙箱：加载完整重建产物，模拟同源 / 跨域 iframe，抓启动期顶层抛错。
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const SRC = projectPaths.bundle;
const code = fs.readFileSync(SRC, 'utf8');

function makeShim(crossOrigin) {
  const errors = [];
  // 极简 document 垫片
  const docEl = {
    style: {}, appendChild(){}, removeChild(){}, addEventListener(){}, removeEventListener(){},
    querySelector(){return null;}, querySelectorAll(){return [];}, getElementById(){return null;},
    createElement(){return {style:{}, appendChild(){}, addEventListener(){}, select(){}, setAttribute(){}};},
    body: { appendChild(){}, removeChild(){}, style:{} },
    documentElement: { style:{} },
    addEventListener(){}, removeEventListener(){},
    get readyState(){return 'complete';},
    get visibilityState(){return 'visible';},
  };
  const topWin = {};
  // 顶层 window：crossOrigin 时 .document 抛 SecurityError
  const win = {};
  if (crossOrigin) {
    Object.defineProperty(topWin, 'document', { get(){ throw new Error('SecurityError: Blocked a frame... accessing a cross-origin frame'); } });
    topWin.top = topWin;
    topWin.self = topWin;
  } else {
    topWin.document = docEl;
    topWin.top = topWin;
    topWin.self = topWin;
  }
  win.document = docEl;
  win.top = crossOrigin ? topWin : win;   // 同源时 top===self；跨域时 top 是另一个会抛 .document 的窗口
  win.self = win;
  win.location = { hostname: 'mooc1.chaoxing.com', pathname: '/mycourse/learn/xxx', host: 'mooc1.chaoxing.com', href: 'https://mooc1.chaoxing.com/', origin: 'https://mooc1.chaoxing.com' };
  win.navigator = { userAgent: 'Mozilla/5.0', clipboard: { writeText(){ return Promise.resolve(); } }, mediaSession: null };
  win.localStorage = { _d:{}, getItem(k){return this._d[k]||null;}, setItem(k,v){this._d[k]=''+v;}, removeItem(k){delete this._d[k];}, get length(){return Object.keys(this._d).length;}, key(i){return Object.keys(this._d)[i];} };
  win.GM_info = { scriptHandler: 'Tampermonkey' };
  win.console = console;
  win.performance = { memory: { usedJSHeapSize: 1000000, jsHeapSizeLimit: 4000000000 } };
  win.BroadcastChannel = function(){ return { postMessage(){}, close(){}, addEventListener(){}, removeEventListener(){} }; };
  win.setInterval = function(){ return 0; };
  win.clearInterval = function(){};
  win.setTimeout = function(fn){ return 0; };  // 不真正执行，避免异步副作用
  win.clearTimeout = function(){};
  win.addEventListener = function(t,fn){ if(t==='error'){ win.__errHandlers = win.__errHandlers||[]; win.__errHandlers.push(fn); } };
  win.removeEventListener = function(){};
  win.postMessage = function(){};
  // HTMLMediaElement 原型垫片
  const proto = { pause(){}, play(){}, addEventListener(){}, removeEventListener(){} };
  Object.defineProperty(proto, 'playbackRate', { get(){return 1;}, set(){}, configurable:true });
  win.HTMLMediaElement = function(){};
  win.HTMLMediaElement.prototype = proto;
  win.HTMLElement = function(){};
  win.HTMLElement.prototype = {};
  win.Object = Object; win.Array = Array; win.Date = Date; win.Math = Math; win.JSON = JSON; win.String = String; win.Number = Number; win.RegExp = RegExp; win.Boolean = Boolean; win.Error = Error; win.Function = Function; win.Proxy = Proxy; win.Symbol = Symbol; win.Promise = Promise; win.parseInt = parseInt; win.parseFloat = parseFloat; win.isNaN = isNaN; win.escape = escape; win.unescape = unescape;
  win.window = win;
  return { win, errors };
}

function run(label, crossOrigin) {
  console.log('\n===== 场景: ' + label + ' (crossOrigin=' + crossOrigin + ') =====');
  const { win } = makeShim(crossOrigin);
  const ctx = vm.createContext(win);
  try {
    vm.runInContext(code, ctx, { filename: 'chaoxing-force-play.user.js' });
    console.log('[LOAD] 完成，无同步顶层抛错');
  } catch (e) {
    console.log('[LOAD-FAIL] 顶层抛错: ' + (e && e.stack ? e.stack.split('\n').slice(0,6).join('\n') : e));
  }
  // 报告 window.__CX_FORCE_PLAY 关键导出是否就绪
  const fp = win.__CX_FORCE_PLAY;
  if (fp) {
    const checks = ['detectSite','scanVideos','ensurePanel','savePanelCfg','restartLoopTimer','buildDiagnostics'];
    checks.forEach(k => console.log('  export ' + k + ': ' + (typeof fp[k] === 'function' ? 'OK' : 'MISSING')));
    console.log('  started: ' + fp.started);
  } else {
    console.log('  window.__CX_FORCE_PLAY 未初始化！');
  }
}

run('同源 iframe (top===self)', false);
run('跨域 iframe (top.document 抛 SecurityError)', true);
