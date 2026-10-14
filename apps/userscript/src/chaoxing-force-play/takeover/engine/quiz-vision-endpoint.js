// @provides: _quizVisionCheckContext
// @requires: CONFIG, CoreState, _dsParseAnswer, quizCredentialStore
// @source-group: takeover/engine/quiz-vision.js
// 职责：视觉端点请求与流式响应；按 build-manifest 顺序拼接，保留共享 IIFE 与原有初始化顺序。

  function _quizVisionCancelled() {
    var error = new Error('视觉请求已取消'); error.name = 'AbortError'; return error;
  }
  function _quizVisionCheckContext(context) {
    if (context && ((context.signal && context.signal.aborted) || (context.valid && !context.valid()))) throw _quizVisionCancelled();
  }
  // 调用到达时捕获代次，而非在凭据就绪后捕获。答题引擎传入原请求；直接调用拥有独立许可。
  function _quizVisionCreateContext(qEl, context) {
    var owner = window.__CX_FORCE_PLAY, href = location.href, ended = false;
    var core = typeof CoreState !== 'undefined' ? CoreState : (owner && owner.CoreState);
    var token = core && typeof core.capture === 'function' ? core.capture('quiz-vision') : null;
    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var callerSignal = context && context.signal, unsubscribe = null;
    var abort = function () { if (controller) controller.abort(); };
    if (callerSignal && callerSignal.addEventListener) callerSignal.addEventListener('abort', abort);
    if (callerSignal && callerSignal.aborted) abort();
    if (core && typeof core.onCancel === 'function') unsubscribe = core.onCancel('quiz-vision', abort);
    return {
      signal: controller ? controller.signal : callerSignal,
      valid: function () {
        return !ended && window.__CX_FORCE_PLAY === owner && location.href === href &&
          !(callerSignal && callerSignal.aborted) && !(context && context.valid && !context.valid()) &&
          !(qEl && qEl.isConnected === false) &&
          (!token || !core || typeof core.valid !== 'function' || core.valid(token));
      },
      finish: function () {
        ended = true;
        if (unsubscribe) { unsubscribe(); unsubscribe = null; }
        if (callerSignal && callerSignal.removeEventListener) callerSignal.removeEventListener('abort', abort);
      }
    };
  }
  // 多模态 AI 端点：把截图 + 选项文本一起 POST，返回 {text, answer}（端点契约由用户配置，脚本不内置密钥）。
  // 安全：仅允许 http/https 端点，避免截图/题目经 file:/javascript: 等非预期协议外泄。
  // §9.2-2 + 6.2 增强：视觉端点主机白名单。题目截图仅允许发往 ① 本地回环(127.0.0.1/localhost/::1) ② 用户显式登记的主机。
  // 未登记任何白名单主机时，远程端点一律拒绝（仅本地可用），防止把截图泄露到任意主机。
  function _quizVisionHostAllowed(hostname) {
    try {
      if (/^(127\.0\.0\.1|localhost|\[?::1\]?)$/i.test(hostname)) return true;   // 本地回环恒允许
      var allow = (typeof CONFIG !== 'undefined' && CONFIG.QUIZ_VISION_ENDPOINT_ALLOW) || '';
      if (typeof localStorage !== 'undefined') {
        var _ls = localStorage.getItem('cx_quiz_vision_allow');
        if (_ls) allow = (allow ? allow + ',' : '') + _ls;   // localStorage 优先级叠加，便于用户临时加白
      }
      if (!allow) return false;
      var _hosts = allow.split(',').map(function (h) { return h.trim().toLowerCase(); }).filter(Boolean);
      return _hosts.indexOf(String(hostname).toLowerCase()) !== -1;
    } catch (e) { return false; }
  }
  // 多模态 AI 端点：把截图 + 视觉提示词 POST，返回 {text, answer}（端点契约由用户配置，脚本不内置密钥）。
  // 安全：仅允许 http/https 端点，避免截图/题目经 file:/javascript: 等非预期协议外泄。
  // 注意：超星题干/选项在 DOM 中为混淆替换后的假字（同形字/字体映射），textContent 与肉眼所见不同，
  // 只有截图(渲染后的视觉)才是真实题目 → 只发截图 + 视觉提示词，绝不附 DOM 文本（附假字会误导 AI）。
  // §9.2-2 + 6.2 增强：视觉端点主机白名单。题目截图仅允许发往 ① 本地回环 ② 用户显式登记的主机。
  function quizVisionAsk(dataUrl, prompt, context) {
    var requestContext = _quizVisionCreateContext(null, context);
    var ownsContext = requestContext !== context;
    var ask = function () {
    _quizVisionCheckContext(requestContext);
    var ep = (typeof CONFIG !== 'undefined' && CONFIG.QUIZ_VISION_ENDPOINT) || '';
    if (!ep) return Promise.reject(new Error('QUIZ_VISION_ENDPOINT 未配置'));
    try {
      var _u = new URL(ep, location.href);
      if (_u.protocol !== 'http:' && _u.protocol !== 'https:') {
        return Promise.reject(new Error('QUIZ_VISION_ENDPOINT 协议不被允许: ' + _u.protocol));
      }
      if (!_quizVisionHostAllowed(_u.hostname)) {   // §9.2-2：禁止把题目截图发往未登记主机
        return Promise.reject(new Error('QUIZ_VISION_ENDPOINT 主机不在白名单: ' + _u.hostname + '（请在面板/配置登记 cx_quiz_vision_allow）'));
      }
    } catch (e) { return Promise.reject(new Error('QUIZ_VISION_ENDPOINT 非法: ' + e.message)); }

    // 双通道备用机制：
    //   ① 默认（未启用 API Key）= 逆向/自建接口：沿用 {image,prompt} → {text,answer} 契约（非流式）。
    //   ② 启用 API Key = 官方 OpenAI 兼容接口：带 Authorization: Bearer <key>，请求改为 chat/completions 形态，流式解析。
    var useApiKey = !!(typeof CONFIG !== 'undefined' && CONFIG.QUIZ_VISION_USE_API_KEY);
    if (!useApiKey) {
      var payload = JSON.stringify({ image: dataUrl, prompt: prompt || undefined });
      return fetchWithTimeout(ep, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        signal: requestContext.signal
      }, 15000, requestContext).then(function (r) {
        _quizVisionCheckContext(requestContext);
        if (!r.ok) throw new Error('vision endpoint ' + r.status);
        return r.json();
      });
    }

    // ② 官方/逆向接口（带 Key）流式通道：OpenAI 兼容 chat/completions（含视觉多模态）
    return quizCredentialStore.use(_u.origin, function (apiKey) {
      _quizVisionCheckContext(requestContext);
      if (!CONFIG.QUIZ_VISION_USE_API_KEY || CONFIG.QUIZ_VISION_ENDPOINT !== ep) throw _quizVisionCancelled();
      if (!apiKey) throw new Error('请先在面板保存 API Key');
      if (!_quizVisionHostAllowed(_u.hostname)) throw new Error('视觉接口主机不在白名单');
      if (_u.username || _u.password) throw new Error('视觉接口地址不能包含账号凭据');
      if (_u.protocol !== 'https:' && !/^(127\.0\.0\.1|localhost|\[?::1\]?)$/i.test(_u.hostname)) throw new Error('远程 API Key 接口必须使用 HTTPS');
      var model = (typeof CONFIG !== 'undefined' && CONFIG.QUIZ_VISION_API_MODEL) || 'deepseek-chat';
      var body = JSON.stringify({
        model: model,
        messages: [
          { role: 'system', content: prompt || '你是答题助手，请阅读题目图片并只输出答案。' },
          { role: 'user', content: [
            { type: 'text', text: prompt || '请阅读题目图片，输出答案。' },
            { type: 'image_url', image_url: { url: dataUrl } }
          ] }
        ],
        stream: true
      });
      var headers = { 'Content-Type': 'application/json' };
      if (apiKey) headers['Authorization'] = 'Bearer ' + apiKey;
      var _timeout = (typeof CONFIG !== 'undefined' && CONFIG.QUIZ_VISION_TIMEOUT) || 60000;
      return Promise.resolve().then(function () {
        _quizVisionCheckContext(requestContext);
        return fetchWithTimeout(_u.href, {
        method: 'POST',
        headers: headers,
        body: body,
        redirect: 'error',
        signal: requestContext.signal
      }, _timeout, requestContext); }).then(function (r) {
        _quizVisionCheckContext(requestContext);
        if (!r.ok) {
          throw new Error('vision endpoint ' + r.status);
        }
        return _quizVisionReadStream(r, requestContext);
      }).then(function (fullText) {
        _quizVisionCheckContext(requestContext);
        fullText = String(fullText || '').split(apiKey).join('[凭据已隐藏]');
        var answer = (typeof _dsParseAnswer === 'function') ? _dsParseAnswer(fullText) : null;
        return { text: fullText || null, answer: answer };
      }).catch(function (error) {
        if (error && error.name === 'AbortError') throw _quizVisionCancelled();
        throw new Error('视觉接口请求失败，请检查端点、网络或凭据');
      });
    });
    };
    var pending; try { pending = ask(); } catch (error) { pending = Promise.reject(error); }
    return Promise.resolve(pending).finally(function () { if (ownsContext) requestContext.finish(); });
  }

  // 读取 OpenAI 兼容流式响应（text/event-stream SSE）：逐块累加 delta.content，遇 data:[DONE] 结束。
  // 端点不支持流式（无 body reader）时回退为一次性 JSON，最大化兼容自建/逆向接口。
  function _quizVisionReadStream(r, context) {
    return new Promise(function (resolve, reject) {
      _quizVisionCheckContext(context);
      var reader = (r && r.body && typeof r.body.getReader === 'function') ? r.body.getReader() : null;
      var signal = context && context.signal, done = false, buf = '', acc = '';
      var cleanup = function () { if (signal && signal.removeEventListener) signal.removeEventListener('abort', onAbort); };
      var fail = function (error) { if (done) return; done = true; cleanup(); reject(error); };
      var succeed = function (text) {
        if (done) return;
        try { _quizVisionCheckContext(context); } catch (error) { fail(error); return; }
        done = true; cleanup(); resolve(text);
      };
      var onAbort = function () {
        if (reader && reader.cancel) { try { Promise.resolve(reader.cancel()).catch(function () {}); } catch (e) {} }
        fail(_quizVisionCancelled());
      };
      if (signal && signal.addEventListener) signal.addEventListener('abort', onAbort);
      if (signal && signal.aborted) { onAbort(); return; }
      if (!reader) {
        Promise.resolve().then(function () { return r.json(); })
          .then(function (j) { succeed(_quizVisionContentOf(j) || ''); }, function () { succeed(''); });
        return;
      }
      var dec = new TextDecoder('utf-8');
      var finish = function () {
        if (buf) { var c = _quizVisionSSELine(buf.replace(/\r$/, '')); if (c && c !== '__DONE__') acc += c; }
        succeed(acc);
      };
      var step = function () {
        if (done) return;
        try { _quizVisionCheckContext(context); } catch (error) { onAbort(); return; }
        Promise.resolve().then(function () { return reader.read(); }).then(function (res) {
          if (done) return;
          _quizVisionCheckContext(context);
          if (res.done) { finish(); return; }
          buf += dec.decode(res.value, { stream: true });
          var nl;
          while ((nl = buf.indexOf('\n')) >= 0) {
            var line = buf.slice(0, nl).replace(/\r$/, '');
            buf = buf.slice(nl + 1);
            var c = _quizVisionSSELine(line);
            if (c === '__DONE__') { finish(); return; }
            if (c) acc += c;
          }
          step();
        }).catch(fail);
      };
      step();
    });
  }

  // 解析单条 SSE 行：data: <json> → 取出增量 content；data:[DONE] 返回哨兵；其余行（event:/id:/注释）忽略。
  function _quizVisionSSELine(line) {
    if (!line) return '';
    if (line.indexOf('data:') !== 0) return '';
    var data = line.slice(5);
    if (data.charAt(0) === ' ') data = data.slice(1);
    if (data === '[DONE]') return '__DONE__';
    try {
      var j = JSON.parse(data);
      var ch = j && j.choices && j.choices[0];
      if (ch) {
        if (typeof ch.delta === 'object' && ch.delta && typeof ch.delta.content === 'string') return ch.delta.content;
        if (ch.message && typeof ch.message.content === 'string') return ch.message.content;
      }
    } catch (e) {}
    return '';
  }

  // 回退路径：从一次性 JSON 响应抽取文本内容（兼容非 SSE 端点 / 旧 {text,answer} 形态）
  function _quizVisionContentOf(j) {
    if (!j) return '';
    if (typeof j === 'string') return j;
    if (typeof j.text === 'string') return j.text;
    var ch = j.choices && j.choices[0];
    if (ch) {
      if (ch.message && typeof ch.message.content === 'string') return ch.message.content;
      if (ch.delta && typeof ch.delta.content === 'string') return ch.delta.content;
    }
    return '';
  }
