// ==UserScript==
// @name         学习通 · 自动下一课
// @namespace    https://github.com/cx-auto-next
// @version      4.0
// @description  (副脚本) 状态机架构：播完→扫答题入口→跳下一章。插播题遮罩自动暂停。Bridge优先+DOM兜底。与「强制续播」主脚本通过 __cxAN_hold（暂停锁）/ __cxAnDone（终态标记，避免误写主脚本拥有的 __cxEndedLock）/ __cxAddonQueue 契约通信。
// @author       cx-toolkit
// @homepage     https://github.com/cx-toolkit
// @match        *://*.chaoxing.com/*
// @match        *://*.edu.cn/*
// @match        *://*.nbedu.cn/*
// @exclude      *://*.chaoxing.com/space/*
// @exclude      *://*.chaoxing.com/work/*
// @exclude      *://*.chaoxing.com/mooc-ans/*
// @grant        none
// @run-at       document-end
// @license      MIT
// @noframes
// ==/UserScript==

(function () {
    'use strict';

    // 幂等守卫：与 video-ended-notify / keyboard-shortcuts / tamper-guard 一致，防止油猴重复注入叠加状态机与 ended/storage 监听导致重复导航
    if (window.__cxAnStarted) return;
    window.__cxAnStarted = true;

    // ====================================================================
    //  A. 配置常量（唯一的非注入全局——纯数据，无副作用）
    // ====================================================================
    var CFG = {
        DEBUG: false,

        // 导航
        NAV_LOCK_MS: 12000,
        CHAPTER_LOAD_MS: 4000,

        // 答题轮询
        QUIZ_POLL_INTERVAL: 1500,
        QUIZ_POLL_MAX: 20,
        QUIZ_CLICK_RETRY: 3,

        // 插播题遮罩
        OVERLAY_DEBOUNCE: 600,
        OVERLAY_SELECTORS: [
            '.ans-job-pop', '.popDiv', '.answerBg', '.maskDiv',
            '#editor', '.tiMu', '.mark_answer', '.tkAns_text', '.CyDownRight',
        ],

        // Bridge
        BRIDGE_PORTS: [7531, 7532, 7530, 17531],
        BRIDGE_PROBE_TIMEOUT: 1500,
    };

    // ====================================================================
    //  B. DI 容器工厂：所有外部依赖在此处注入，状态机只通过 container 访问外部世界
    // ====================================================================
    function createContainer() {
        var noop = function () {};

        // --- B1. $log ---------------------------------------------------
        var $log = {
            info: CFG.DEBUG ? function () { console.info.apply(console, ['[AN]'].concat([].slice.call(arguments))); } : noop,
            warn: function () { console.warn.apply(console, ['[AN]'].concat([].slice.call(arguments))); },
            err: function () { console.error.apply(console, ['[AN]'].concat([].slice.call(arguments))); },
        };

        // --- B2. $storage -----------------------------------------------
        var LS_KEY = 'cx_an_on';
        var $storage = {
            isOn: function () { try { return '1' === localStorage[LS_KEY]; } catch (e) { return false; } },
            setOn: function (v) { try { localStorage[LS_KEY] = v ? '1' : '0'; } catch (e) {} },
            listen: function (fn) {
                try { window.addEventListener('storage', function (e) { if (e.key === LS_KEY) fn(e.newValue === '1'); }); }
                catch (e) { $log.warn('storage listener failed'); }
            },
        };

        // --- B3. $dom ---------------------------------------------------
        var $dom = {
            one: function (sel, root) { try { return (root || document).querySelector(sel); } catch (e) { return null; } },
            all: function (sel, root) { try { return (root || document).querySelectorAll(sel); } catch (e) { return []; } },
            isVisible: function (el) {
                try {
                    if (!el) return false;
                    if (el.offsetParent === null && el.offsetWidth === 0 && el.offsetHeight === 0) return false;
                    var s = window.getComputedStyle(el);
                    return s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0';
                } catch (e) { return false; }
            },
            closest: function (el, sel) { try { return el.closest(sel); } catch (e) { return null; } },
        };

        // --- B4. $nav ---------------------------------------------------
        var $nav = {
            _param: function (name) {
                try {
                    var m = (window.location.search || '').match(new RegExp('[?&]' + name + '=([^&]*)'));
                    return m ? decodeURIComponent(m[1]) : null;
                } catch (e) { return null; }
            },
            kid: function () { return this._param('knowledgeId') || this._param('chapterId') || this._param('kid'); },
            cid: function () { return this._param('courseId') || this._param('courseid') || this._param('cid'); },
            clazzid: function () { return this._param('clazzid') || this._param('clazzId'); },
            isChapterPage: function () { return !!(this.kid() && this.cid()); },
            origin: function () { try { return window.location.origin; } catch (e) { return 'https://mooc1.chaoxing.com'; } },
            buildChapterUrl: function (ch) {
                var o = this.origin(), p = [];
                if (ch.knowledgeId || ch.id) p.push('knowledgeId=' + encodeURIComponent(ch.knowledgeId || ch.id));
                if (ch.courseId || this.cid()) p.push('courseId=' + encodeURIComponent(ch.courseId || this.cid()));
                if (ch.clazzId || this.clazzid()) p.push('clazzid=' + encodeURIComponent(ch.clazzId || this.clazzid()));
                if (ch.cpi != null) p.push('cpi=' + encodeURIComponent(ch.cpi));
                if (ch.chapterId) p.push('chapterId=' + encodeURIComponent(ch.chapterId));
                var base = ch.url || (o + '/mycourse/studentstudy');
                return base + (base.indexOf('?') >= 0 ? '&' : '?') + p.join('&');
            },
            goto: function (url) { try { window.location.href = url; return true; } catch (e) { return false; } },
        };

        // --- B5. $video -------------------------------------------------
        var $video = {
            set: function (v, flag, val) { try { if (val) v[flag] = val; else delete v[flag]; } catch (e) {} },
            get: function (v, flag) { try { return !!v[flag]; } catch (e) { return false; } },
            all: function () { return $dom.all('video'); },
            holdAll: function (on) {
                var vs = this.all();
                for (var i = 0; i < vs.length; i++) this.set(vs[i], '__cxAN_hold', on);
                if (vs.length) $log.info(on ? 'quiz-hold ON (' + vs.length + ' videos)' : 'quiz-hold OFF');
            },
        };

        // --- B6. $bridge ------------------------------------------------
        var _bridgeBase = null;
        var $bridge = {
            _corsFetch: function (url, timeout) {
                return new Promise(function (resolve, reject) {
                    var tid = 0, done = false;
                    try {
                        var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
                        if (timeout) tid = setTimeout(function () { done = true; if (ctrl) ctrl.abort(); reject(new Error('timeout')); }, timeout);
                        var opts = {};
                        if (ctrl) opts.signal = ctrl.signal;
                        fetch(url, opts).then(function (r) {
                            clearTimeout(tid);
                            if (done) return;
                            if (!r.ok) return reject(new Error('status ' + r.status));
                            r.json().then(function (d) { if (!done) resolve(d); }).catch(reject);
                        }).catch(function (e) { clearTimeout(tid); if (!done) reject(e); });
                    } catch (e) { clearTimeout(tid); reject(e); }
                });
            },
            probe: function () {
                var ports = CFG.BRIDGE_PORTS.slice();
                var self = this;
                function tryNext() {
                    if (!ports.length) return Promise.reject(new Error('no bridge'));
                    var p = ports.shift();
                    return self._corsFetch('http://127.0.0.1:' + p + '/ping', CFG.BRIDGE_PROBE_TIMEOUT).then(function () {
                        _bridgeBase = 'http://127.0.0.1:' + p;
                        return _bridgeBase;
                    }).catch(function () { return tryNext(); });
                }
                return tryNext();
            },
            getPlaylist: function (courseId) {
                if (!_bridgeBase) return Promise.reject(new Error('bridge not connected'));
                return this._corsFetch(_bridgeBase + '/playlist/' + encodeURIComponent(courseId), 10000).then(function (d) {
                    return (d && Array.isArray(d.chapters)) ? d.chapters : null;
                });
            },
            isConnected: function () { return !!_bridgeBase; },
            getBase: function () { return _bridgeBase; },
        };

        // --- B7. $timer -------------------------------------------------
        var _timers = {};
        var $timer = {
            set: function (id, fn, ms) { this.clear(id); _timers[id] = setTimeout(fn, ms); },
            clear: function (id) { if (_timers[id]) { clearTimeout(_timers[id]); delete _timers[id]; } },
        };

        // --- B8. $panel -------------------------------------------------
        var $panel = {
            register: function () {
                var addon = {
                    id: 'auto-next',
                    type: 'toggle',
                    label: '自动下一课',
                    note: '播完→答题入口或下一章；插播题自动暂停(Bridge+DOM)',
                    get: $storage.isOn,
                    set: function (v) { $storage.setOn(v); },
                };
                try {
                    if (!Array.isArray(window.__cxAddonQueue)) window.__cxAddonQueue = [];
                    window.__cxAddonQueue.push(addon);
                    $log.info('addon enqueued');
                    if (typeof window.__cxRegisterAddon === 'function') {
                        window.__cxRegisterAddon();
                        $log.info('addon drained');
                    }
                } catch (e) { $log.warn('addon registration failed'); }
            },
        };

        // --- assemble container -----------------------------------------
        return { $log: $log, $storage: $storage, $dom: $dom, $nav: $nav, $video: $video, $bridge: $bridge, $timer: $timer, $panel: $panel };
    }

    // ====================================================================
    //  C. 状态机
    // ====================================================================
    function createStateMachine(c) {
        // --- 状态枚举 ----------------------------------------------------
        var DISABLED = 'DISABLED';
        var IDLE = 'IDLE';
        var POLLING_QUIZ = 'POLLING_QUIZ';
        var TRYING_CLICK = 'TRYING_CLICK';
        var FINDING_NEXT = 'FINDING_NEXT';
        var NAVIGATING = 'NAVIGATING';
        var LOCKED = 'LOCKED';

        // --- 运行时状态 --------------------------------------------------
        var state = DISABLED;
        var sourceVideo = null;
        var pollTries = 0;
        var clickRetries = 0;
        var lockExpiry = 0;
        var seenVideos = new WeakSet();

        // --- 导航锁（单例：同时只允许一个导航流程运行） --------------------
        function navLock() { lockExpiry = Date.now() + CFG.NAV_LOCK_MS; }
        function navUnlock() { lockExpiry = 0; }
        function isNavLocked() { return lockExpiry > Date.now(); }

        // --- 副作用函数（仅在 transition 中调用） --------------------------
        function _stopPolling() { c.$timer.clear('poll'); c.$timer.clear('postClick'); }
        function _lockVideo(v) {
            if (!v) return;
            // 用 auto-next 自有标志 __cxAnDone 标记「跳转路径已穷尽」，不再写主脚本的 __cxEndedLock：
            // 后者由主脚本 force-play 拥有（ended 持久锁 + 重建去重判定），auto-next 写入会与主脚本 dedup 逻辑产生多写者碰撞。
            // 两者语义均为「终态」，但归属必须单一；auto-next 的终态判定以 seenVideos(WeakSet) 为准，不依赖节点标志。
            c.$video.set(v, '__cxAnDone', true);
            c.$log.warn('video locked (all paths exhausted): ' + ((v.currentSrc || v.src || '').split('/').pop() || '(unknown)'));
        }

        function _enterPollQuiz() {
            navLock();
            pollTries = CFG.QUIZ_POLL_MAX;
            clickRetries = CFG.QUIZ_CLICK_RETRY;
            _doPoll();
        }

        function _doPoll() {
            if (!c.$storage.isOn()) { transition(DISABLED); return; }
            if (pollTries <= 0) { c.$log.info('quiz poll exhausted → FINDING_NEXT'); transition(FINDING_NEXT); return; }

            // 验证码页→放弃
            if (c.$dom.one('.vcodeBox, .verification, .yanZM, .randCode, #verificationCode')) {
                c.$log.warn('verification page → LOCKED');
                transition(LOCKED);
                return;
            }

            var entry = findQuizEntry(c);
            if (entry) {
                c.$log.info('quiz found: ' + entry.label + ' (' + entry.type + ')');
                transition(TRYING_CLICK, entry);
            } else {
                pollTries--;
                if (pollTries % 4 === 0) c.$log.info('polling quiz… ' + pollTries + ' left');
                c.$timer.set('poll', _doPoll, CFG.QUIZ_POLL_INTERVAL);
            }
        }

        function _enterTryClick(entry) {
            clickQuizEntry(c, entry);
            _stopPolling();
            // 等页面反应
            c.$timer.set('postClick', function () {
                if (!c.$storage.isOn()) { transition(DISABLED); return; }
                var still = findQuizEntry(c);
                if (still) {
                    clickRetries--;
                    c.$log.warn('quiz still present after click, retries left: ' + clickRetries);
                    if (clickRetries > 0) {
                        transition(TRYING_CLICK, still);
                    } else {
                        c.$log.info('click retries exhausted → FINDING_NEXT');
                        transition(FINDING_NEXT);
                    }
                }
                // else: 跳走了，页面即将卸载
            }, 2000);
        }

        function _enterFindNext() {
            if (!c.$storage.isOn()) { transition(DISABLED); return; }
            _stopPolling();
            var cid = c.$nav.cid();
            if (!cid) {
                c.$log.warn('no courseId → try DOM next');
                _doNextDOM();
                return;
            }
            c.$log.info('bridge query: courseId=' + cid);
            c.$bridge.getPlaylist(cid).then(function (chapters) {
                var next = findNextChapter(c, chapters, c.$nav.kid());
                if (next) {
                    c.$log.info('bridge found next: ' + (next.title || next.knowledgeId));
                    transition(NAVIGATING, next);
                } else {
                    c.$log.warn('bridge no next → DOM fallback');
                    _doNextDOM();
                }
            }).catch(function (err) {
                c.$log.warn('bridge error: ' + (err && err.message) + ' → DOM fallback');
                _doNextDOM();
            });
        }

        function _doNextDOM() {
            var next = findNextChapterDOM(c);
            if (next) {
                c.$log.info('DOM found next: ' + next.label);
                transition(NAVIGATING, { url: next.url });
            } else {
                c.$log.warn('no next chapter (bridge+DOM) → LOCKED');
                transition(LOCKED);
            }
        }

        function _enterNavigate(target) {
            var url = target.url || c.$nav.buildChapterUrl(target);
            c.$log.info('navigating → ' + url.substring(0, 100));
            if (!c.$nav.goto(url)) {
                c.$log.err('navigation failed → LOCKED');
                transition(LOCKED);
            }
        }

        function _enterLocked() {
            _stopPolling();
            _lockVideo(sourceVideo);
            navUnlock();
            // 一段时间后重置，允许新的视频触发
            c.$timer.set('lockedReset', function () {
                if (state === LOCKED) transition(IDLE);
            }, CFG.NAV_LOCK_MS);
        }

        function _enterDisabled() {
            _stopPolling();
            navUnlock();
            sourceVideo = null;
        }

        function _enterIdle() {
            _stopPolling();
            navUnlock();
            sourceVideo = null;
        }

        // --- 状态转换引擎 ------------------------------------------------
        function transition(target, payload) {
            var prev = state;
            if (prev === target && target !== POLLING_QUIZ && target !== TRYING_CLICK) return; // 幂等（除可重入状态）

            c.$log.info('state: ' + prev + ' → ' + target + (payload ? ' [payload: ' + (payload.label || payload.type || JSON.stringify(payload).substring(0, 60)) + ']' : ''));

            // exit prev
            switch (prev) {
                case POLLING_QUIZ: _stopPolling(); break;
                case TRYING_CLICK: _stopPolling(); break;
            }

            state = target;

            // enter target
            switch (target) {
                case DISABLED: _enterDisabled(); break;
                case IDLE: _enterIdle(); break;
                case POLLING_QUIZ: _enterPollQuiz(); break;
                case TRYING_CLICK: _enterTryClick(payload); break;
                case FINDING_NEXT: _enterFindNext(); break;
                case NAVIGATING: _enterNavigate(payload); break;
                case LOCKED: _enterLocked(); break;
            }
        }

        // --- 公开接口：外部事件驱动状态转换 ------------------------------
        function onVideoEnded(v) {
            if (state === DISABLED || state === LOCKED) return;
            if (isNavLocked()) { c.$log.info('blocked by nav lock, state=' + state); return; }
            if (!c.$nav.isChapterPage()) { c.$log.info('not chapter page, skip'); return; }
            if (c.$video.get(v, '__cxForcePaused')) { c.$log.info('force-paused, defer'); return; }
            if (seenVideos.has(v)) { c.$log.info('video already handled, skip'); return; }
            seenVideos.add(v);
            sourceVideo = v;
            c.$log.info('video ended → POLLING_QUIZ');
            if (state !== POLLING_QUIZ) transition(POLLING_QUIZ);
        }

        function onToggleChanged(on) {
            if (on && (state === DISABLED || state === LOCKED)) {
                transition(IDLE);
            } else if (!on && state !== DISABLED) {
                transition(DISABLED);
            }
        }

        function getState() { return state; }

        return { onVideoEnded: onVideoEnded, onToggleChanged: onToggleChanged, transition: transition, getState: getState, sourceVideo: function () { return sourceVideo; } };
    }

    // ====================================================================
    //  D. 功能模块（纯函数，通过参数 c 接收注入容器）
    // ====================================================================

    // --- D1. 答题入口检测 ------------------------------------------------
    function findQuizEntry(c) {
        // 1. .ans-job-icon 容器
        var icons = c.$dom.all('.ans-job-icon');
        for (var i = 0; i < icons.length; i++) {
            var icon = icons[i];
            if (/finished|done/.test(icon.className)) continue;
            var a = c.$dom.closest(icon, 'a') || icon.querySelector('a');
            if (a && a.href && /work|mooc-ans|exam/i.test(a.href)) return { type: 'job-link', el: a, label: (a.textContent || '作业').trim() };
            var oc = icon.querySelector('[onclick*="workEnc"], [onclick*="dowork"], [onclick*="doWork"]');
            if (oc) return { type: 'job-onclick', el: oc, label: '作业' };
            if (icon.getAttribute('data')) return { type: 'job-data', el: icon, label: '作业' };
        }

        // 2. iframe
        var frames = c.$dom.all('.ans-attach-ct iframe[src]');
        for (var j = 0; j < frames.length; j++) {
            if (/work|mooc-ans|exam|test/i.test(frames[j].src || '')) return { type: 'iframe', el: frames[j], label: '答题(frame)' };
        }

        // 3. onclick 按钮
        var btns = c.$dom.all('.ans-attach-ct [onclick], .catalog_task [onclick]');
        for (var k = 0; k < btns.length; k++) {
            if (/workEnc|dowork|doWork|exam/.test(btns[k].getAttribute('onclick') || '')) return { type: 'onclick-btn', el: btns[k], label: '答题' };
        }

        // 4. 可见弹窗
        var pops = c.$dom.all('.ans-job-pop, .answerBg');
        for (var m = 0; m < pops.length; m++) {
            if (!c.$dom.isVisible(pops[m])) continue;
            var btn = pops[m].querySelector('a[href], button');
            if (btn && /作业|答题|开始|进入/.test(btn.textContent || '')) return { type: 'popup', el: btn, label: '弹窗答题' };
        }

        return null;
    }

    function clickQuizEntry(c, entry) {
        if (!entry || !entry.el) return false;
        c.$log.info('click: ' + entry.label);
        try { entry.el.click(); return true; } catch (e) { return false; }
    }

    // --- D2. 下一章查找 (Bridge) ----------------------------------------
    function findNextChapter(c, chapters, curKid) {
        if (!chapters) return null;
        var found = false;
        for (var i = 0; i < chapters.length; i++) {
            var ch = chapters[i];
            if (found) {
                if ((ch.unfinishedCount != null && ch.unfinishedCount > 0) || !ch.completed) return ch;
            }
            if (String(ch.knowledgeId || ch.id) === String(curKid)) found = true;
        }
        return null;
    }

    // --- D3. 下一章查找 (DOM) -------------------------------------------
    function findNextChapterDOM(c) {
        // nextChapter 按钮
        var btn = c.$dom.one('.nextChapter, #prevNextChapterNext, .next_prev_b .nextChapter');
        if (btn) {
            var href = btn.getAttribute('href') || btn.href;
            if (href && href !== '#' && !/javascript:void/.test(href)) return { url: href, label: '下一章(DOM)' };
        }

        // 关键词
        var as = c.$dom.all('a');
        for (var i = 0; i < as.length; i++) {
            var t = (as[i].textContent || as[i].title || '').trim();
            if (/下一章|下一节|下一课|后一章/.test(t)) {
                var h = as[i].getAttribute('href') || as[i].href;
                if (h && h !== '#') return { url: h, label: t };
            }
        }

        return null;
    }

    // --- D4. 插播题遮罩监控 ---------------------------------------------
    function createOverlayWatcher(c, sm) {
        var watching = false, timerId = 0, observer = null;

        function check() {
            if (!c.$storage.isOn()) return;
            var visible = false;
            var sels = CFG.OVERLAY_SELECTORS;
            for (var i = 0; !visible && i < sels.length; i++) {
                var els = c.$dom.all(sels[i]);
                for (var j = 0; j < els.length; j++) { if (c.$dom.isVisible(els[j])) { visible = true; break; } }
            }
            c.$video.holdAll(visible);
        }

        function start() {
            if (watching) return;
            watching = true;
            c.$log.info('overlay watcher ON');

            // 轮询
            function poll() { if (watching) { check(); timerId = setTimeout(poll, CFG.OVERLAY_DEBOUNCE); } }
            timerId = setTimeout(poll, CFG.OVERLAY_DEBOUNCE);

            // MO 副通道
            try {
                observer = new MutationObserver(function () {
                    clearTimeout(observer._debounce);
                    observer._debounce = setTimeout(function () { if (watching) check(); }, CFG.OVERLAY_DEBOUNCE);
                });
                observer.observe(document.body || document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] });
            } catch (e) { c.$log.warn('MO init failed'); }
        }

        function stop() {
            watching = false;
            clearTimeout(timerId);
            try { if (observer) { clearTimeout(observer._debounce); observer.disconnect(); observer = null; } } catch (e) {}
            c.$video.holdAll(false);
            c.$log.info('overlay watcher OFF');
        }

        return { start: start, stop: stop, check: check };
    }

    // ====================================================================
    //  E. 启动入口
    // ====================================================================
    function bootstrap() {
        var c = createContainer();
        var sm = createStateMachine(c);
        var watcher = createOverlayWatcher(c, sm);

        // 面板注册
        c.$panel.register();

        // 全局 video ended 监听
        document.addEventListener('ended', function (e) {
            var v = e.target;
            if (!v || v.tagName !== 'VIDEO') return;
            if (!c.$storage.isOn()) return;
            sm.onVideoEnded(v);
        }, true); // capture

        // 开关变动 → 状态机
        function syncToggle() {
            var on = c.$storage.isOn();
            sm.onToggleChanged(on);
            if (on) watcher.start(); else watcher.stop();
        }
        syncToggle();
        c.$storage.listen(function () { syncToggle(); });

        // Bridge 探活（非阻塞）
        c.$bridge.probe().then(function (base) {
            c.$log.info('bridge connected: ' + base);
        }).catch(function () {
            c.$log.info('bridge offline, DOM fallback only');
        });

        c.$log.info('v4.0 booted, state=' + sm.getState());
    }

    // 延迟启动：给主脚本先初始化的窗口
    setTimeout(bootstrap, 300);
})();
