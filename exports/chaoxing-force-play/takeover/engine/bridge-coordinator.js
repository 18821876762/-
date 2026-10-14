// @requires: CONST, CoreState, bestEffort
  // 同源帧共享网络资源；每个消费者仍由自己的运行令牌与页面身份决定是否可落地。
  function BridgeCoordinator() {
    var pending = Object.create(null), cache = Object.create(null), generation = 0, probing = 0;
    var state = { reachable: {}, dead: {} }, allDeadUntil = 0;
    var registry = window.__CX_FORCE_PLAY.TimerRegistry;
    var owner = window.__CX_FORCE_PLAY, disposed = false;
    function usable(consumer) {
      return !disposed && window.__CX_FORCE_PLAY === owner && consumer.active && consumer.valid();
    }
    function settle(entry, error, data) {
      if (entry.done) return;
      entry.done = true;
      if (entry.timer !== null) registry.clearTimeout(entry.timer);
      if (pending[entry.url] === entry) delete pending[entry.url];
      var consumers = entry.consumers.slice(), any = consumers.some(usable);
      if (any) cache[entry.url] = { error: error, data: data, until: Date.now() + (error ? 60000 : 10000) };
      consumers.forEach(function (consumer) {
        if (!consumer.active) return;
        consumer.active = false;
        consumer.detach();
        if (!consumer.valid()) consumer.reject(new Error('bridge cancelled'));
        else if (error) consumer.reject(error);
        else consumer.resolve(data);
      });
      entry.consumers = [];
    }
    function abort(entry) {
      if (entry.done) return;
      if (entry.controller) bestEffort(function () { entry.controller.abort(); }, 'bridge.abort');
      settle(entry, new Error('bridge cancelled'), null);
    }
    function live(entry) {
      if (entry.done) return false;
      if (entry.consumers.some(usable)) return true;
      abort(entry);
      return false;
    }
    function request(url, context, fresh) {
      if (disposed || !context.valid()) return Promise.reject(new Error('bridge cancelled'));
      var keys = Object.keys(cache);
      keys.forEach(function (key, index) { if (cache[key].until <= Date.now() || index < keys.length - 256) delete cache[key]; });
      var saved = cache[url];
      if (saved && saved.until <= Date.now()) { delete cache[url]; saved = null; }
      if (!fresh && saved) return saved.error ? Promise.reject(saved.error) : Promise.resolve(saved.data);
      var entry = pending[url];
      if (!entry || entry.done) {
        entry = { url: url, consumers: [], controller: typeof AbortController === 'function' ? new AbortController() : null, timer: null, done: false, started: false };
        pending[url] = entry;
      }
      return new Promise(function (resolve, reject) {
        var consumer = { active: true, valid: context.valid, resolve: resolve, reject: reject, detach: function () {} };
        function cancel() {
          if (!consumer.active) return;
          consumer.active = false;
          consumer.detach();
          reject(new Error('bridge cancelled'));
          live(entry);
        }
        consumer.detach = context.subscribe(cancel);
        entry.consumers.push(consumer);
        if (entry.started) return;
        entry.started = true;
        entry.timer = registry.setTimeout(function () {
          if (entry.controller) bestEffort(function () { entry.controller.abort(); }, 'bridge.timeout');
          settle(entry, new Error('bridge timeout'), null);
        }, CONST.BRIDGE_TIMEOUT_MS || 5000, 'bridge');
        // Keep the timeout through body parsing; fetch() resolves before r.json().
        var response;
        try { response = fetch(url, entry.controller ? { mode: 'cors', signal: entry.controller.signal } : { mode: 'cors' }); }
        catch (error) { settle(entry, error, null); return; }
        Promise.resolve(response).then(function (r) {
          if (!live(entry)) return null;
          if (!r || !r.ok) throw new Error('bridge unavailable');
          return r.json();
        }).then(function (data) {
          if (live(entry)) settle(entry, null, data);
        }).catch(function (error) {
          if (live(entry)) settle(entry, error, null);
        });
      });
    }
    function probe(context, preferred, fresh) {
      if (!context.valid()) return Promise.resolve(null);
      if (allDeadUntil > Date.now()) return Promise.resolve(null);
      if (allDeadUntil && allDeadUntil <= Date.now()) { allDeadUntil = 0; state.dead = {}; }
      var candidates = preferred ? [preferred] : [];
      CONST.BRIDGE_PROBE_PORTS.forEach(function (port) {
        var base = 'http://127.0.0.1:' + port;
        if (candidates.indexOf(base) < 0) candidates.push(base);
      });
      var index = 0;
      probing++;
      function next() {
        if (!context.valid()) return Promise.resolve(null);
        if (index >= candidates.length) { allDeadUntil = Date.now() + 60000; return Promise.resolve(null); }
        var base = candidates[index++];
        return request(base + '/ping', context, fresh).then(function (data) {
          if (!context.valid()) return null;
          state.reachable[base] = true;
          delete state.dead[base];
          return { base: base, version: data && data.version || null };
        }).catch(function () {
          if (!context.valid()) return null;
          state.dead[base] = true;
          return next();
        });
      }
      return next().then(function (value) { probing--; return value; }, function (error) { probing--; throw error; });
    }
    function cancelAll() {
      generation++;
      Object.keys(pending).forEach(function (url) { abort(pending[url]); });
      cache = Object.create(null);
      state.reachable = {}; state.dead = {}; allDeadUntil = 0;
    }
    var offChange = CoreState.onChange(function (view) {
      // 局部 scope reset 只摘该帧消费者；全局停止才取消整个同源共享池。
      if (view.state !== 'RUNNING') cancelAll();
      if (view.state === 'DISPOSED') { disposed = true; offChange(); }
    });
    return { request: request, probe: probe, generation: function () { return generation; },
      state: function () { return { inFlight: probing > 0, state: state }; },
      reset: function () { cancelAll(); } };
  }
