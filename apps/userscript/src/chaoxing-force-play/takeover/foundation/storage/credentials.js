// @provides: quizCredentialStore
// @requires: CONFIG, CX_KEYS, EventBus
// 凭据只在用户脚本闭包和管理器私有存储内流转，不挂载到网页命名空间。
var quizCredentialStore = (function () {
  var storageKey = 'cx_private_vision_api_key_v1';
  var key = '', boundOrigin = '', revision = 0, persistent = false, loaded = false, clearFailed = false;
  var read = null, write = null, readOk = false;
  var queue = Promise.resolve();
  function notice(message) {
    try { if (typeof EventBus !== 'undefined') EventBus.emit('ui:toast', message, 'warn'); } catch (e) {}
  }
  function status() {
    return { hasKey: !!key, origin: boundOrigin, authorized: !!boundOrigin, persistent: persistent, loaded: loaded, clearFailed: clearFailed };
  }
  function originOf(endpoint, checkHost) {
    var url;
    try { url = new URL(endpoint); } catch (e) { throw new Error('请先填写完整 API 接口地址'); }
    if (url.username || url.password) throw new Error('API 接口地址不能包含账号凭据');
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && /^(127\.0\.0\.1|localhost|\[?::1\]?)$/i.test(url.hostname))) {
      throw new Error('远程 API Key 接口必须使用 HTTPS');
    }
    if (checkHost && !_quizVisionHostAllowed(url.hostname)) throw new Error('API 接口主机尚未登记到白名单');
    return url.origin;
  }
  function storedCredential(value) {
    var savedKey = typeof value === 'string' ? value : (value && typeof value.key === 'string' ? value.key : '');
    var savedOrigin = '';
    if (savedKey.trim() && value && typeof value === 'object' && typeof value.origin === 'string') {
      try { if (originOf(value.origin, false) === value.origin) savedOrigin = value.origin; } catch (e) {}
    }
    // 旧字符串和旧网页迁移值没有私有授权记录，不能用公开 CONFIG 自动建立信任。
    return { key: savedKey.trim(), origin: savedOrigin };
  }
  function noticeStatus() {
    if (key && !boundOrigin) notice('API Key 尚未授权接口，请确认 API 地址并重新输入 Key');
    if (key && !persistent) notice('API Key 仅在当前页面会话有效，刷新后需重新输入');
    if (clearFailed) notice('当前会话凭据已清空，但私有存储清理失败，请在脚本管理器中删除旧凭据');
  }
  try {
    if (typeof GM_getValue === 'function' && typeof GM_setValue === 'function') {
      read = function () { return GM_getValue(storageKey, ''); };
      write = function (value) { return GM_setValue(storageKey, value); };
    } else if (typeof GM !== 'undefined' && GM && typeof GM.getValue === 'function' && typeof GM.setValue === 'function') {
      read = function () { return GM.getValue(storageKey, ''); };
      write = function (value) { return GM.setValue(storageKey, value); };
    }
  } catch (e) {}

  // 旧网页存储只读取一次，立即删除；持久化失败时也不能把凭据放回网页。
  try {
    if (typeof localStorage !== 'undefined') {
      var legacy = localStorage.getItem(CX_KEYS.VISION_API_KEY);
      key = typeof legacy === 'string' ? legacy.trim() : '';
      localStorage.removeItem(CX_KEYS.VISION_API_KEY);
    }
  } catch (e) { notice('旧凭据清理失败，请在浏览器站点存储中删除旧 API Key'); }
  try {
    Object.defineProperty(CONFIG, 'QUIZ_VISION_API_KEY', {
      configurable: false, enumerable: false,
      get: function () { return ''; }, set: function () {}
    });
  } catch (e) { CONFIG.QUIZ_VISION_API_KEY = ''; }

  function persist(value, savedRevision) {
    queue = queue.then(function () {
      if (savedRevision !== revision) return;
      if (!write || !readOk) { persistent = false; if (!value && write) clearFailed = true; return; }
      return Promise.resolve(write(value)).then(function () {
        if (savedRevision === revision) { persistent = true; clearFailed = false; }
      });
    }).catch(function () {
      if (savedRevision === revision) { persistent = false; if (!value) clearFailed = true; }
    });
    return queue;
  }
  var ready = Promise.resolve().then(function () {
    if (!read) return '';
    return read();
  }).then(function (stored) {
    readOk = !!read;
    var credential = storedCredential(stored);
    if (!revision && credential.key) {
      key = credential.key; boundOrigin = credential.origin; persistent = true;
    } else if (!revision && key) {
      return persist({ key: key, origin: '' }, revision);
    }
  }).catch(function () { persistent = false; }).then(function () {
    loaded = true;
    noticeStatus();
    return status();
  });
  return {
    ready: ready,
    status: status,
    save: function (value, endpoint) {
      var nextKey = typeof value === 'string' ? value.trim() : '', nextOrigin = '';
      try { if (nextKey) nextOrigin = originOf(endpoint, true); } catch (e) { return Promise.reject(e); }
      key = nextKey; boundOrigin = nextOrigin; persistent = false; clearFailed = false;
      revision++;
      var savedRevision = revision, valueToSave = key ? { key: key, origin: boundOrigin } : '';
      return ready.then(function () { return persist(valueToSave, savedRevision); }).then(function () {
        noticeStatus();
        return status();
      });
    },
    use: function (origin, consume) {
      return ready.then(function () {
        if (!key) throw new Error('请先在面板保存 API Key');
        if (!boundOrigin || origin !== boundOrigin) throw new Error('API Key 未授权此接口，请确认地址并重新输入 Key');
        return consume(key);
      });
    },
    matches: function (value) { return !!key && typeof value === 'string' && value === key; },
    contains: function (value) { return !!key && typeof value === 'string' && value.indexOf(key) !== -1; }
  };
})();

// 导出/导入只处理普通设置，凭据键和值中的嵌套凭据均被拒绝。
function isCredentialConfigKey(name) {
  var value = String(name).replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
  return /(?:^|[_-])(?:api[_-]?key|secret|password|passwd|passphrase|token|cookie|cookies|credential|credentials|authorization|auth|session)(?:$|[_-])/.test(value);
}
function hasCredentialConfigValue(value, depth) {
  depth = depth || 0;
  if (depth > 20) return true;
  if (typeof value === 'string') {
    if (quizCredentialStore.contains(value)) return true;
    if (/\b(?:Bearer\s+\S+|sk-[A-Za-z0-9_-]{12,}|github_pat_[A-Za-z0-9_]{20,}|ghp_[A-Za-z0-9]{20,})/i.test(value)) return true;
    try { value = JSON.parse(value); } catch (e) { return false; }
  }
  if (!value || typeof value !== 'object') return false;
  return Object.keys(value).some(function (name) {
    return isCredentialConfigKey(name) || quizCredentialStore.contains(name) || hasCredentialConfigValue(value[name], depth + 1);
  });
}
