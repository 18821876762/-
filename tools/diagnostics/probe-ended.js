'use strict';
const projectPaths = require('./project-paths.cjs');
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');
const code = fs.readFileSync(projectPaths.bundle, 'utf8');
const html = `<!DOCTYPE html><html><head><title>学习通</title></head><body><video id="v1" src="https://mooc1.chaoxing.com/a1.mp4" preload="metadata"></video><div class="ans-attach-ct"></div></body></html>`;
const dom = new JSDOM(html, { url: 'https://mooc1.chaoxing.com/studyvideoweb/studyVideo.html?courseId=1&knowledgeId=2', runScripts: 'dangerously', pretendToBeVisual: true });
const { window } = dom;
const { document } = window;
const mockCtx = new Proxy({}, { get: (t, p) => { if (p === 'createLinearGradient') return () => ({ addColorStop() {} }); if (p === 'getImageData') return () => ({ data: [] }); return () => {}; } });
window.HTMLCanvasElement.prototype.getContext = function () { return mockCtx; };
window.HTMLMediaElement.prototype.play = function () { return Promise.resolve(); };
window.HTMLMediaElement.prototype.pause = function () {};
if (!window.HTMLMediaElement.prototype.load) window.HTMLMediaElement.prototype.load = function () {};
const liveDoc = new Map();
const endedHandlers = [];
function bump(map, type, d) { map.set(type, (map.get(type) || 0) + d); }
const rawAdd = window.document.addEventListener.bind(window.document);
const rawRemove = window.document.removeEventListener.bind(window.document);
window.document.addEventListener = function (type, fn, opt) { bump(liveDoc, type, 1); if (type === 'ended') endedHandlers.push((fn && fn.name) + ':' + (fn && fn.toString().slice(0, 30).replace(/\n/g, ' '))); return rawAdd(type, fn, opt); };
window.document.removeEventListener = function (type, fn, opt) { bump(liveDoc, type, -1); if (type === 'ended') { const i = endedHandlers.findIndex(function (h) { return h.indexOf((fn && fn.name)) >= 0; }); if (i >= 0) endedHandlers.splice(i, 1); } return rawRemove(type, fn, opt); };
console.log('STEP load start');
try { window.eval(code); } catch (e) { console.log('LOAD ERR', e.stack || e); }
console.log('STEP loaded');
document.getElementById('v1').dispatchEvent(new window.Event('play'));
console.log('ended before uninstall =', liveDoc.get('ended') || 0);
window.__CX_FORCE_PLAY.registerPopupQuizEnded('__probe', {});
console.log('ended after manual call =', liveDoc.get('ended') || 0);
console.log('has registerPopupQuizEnded =', typeof (window.__CX_FORCE_PLAY && window.__CX_FORCE_PLAY.registerPopupQuizEnded));
console.log('has cleanups =', Array.isArray(window.__cxAddonCleanups), window.__cxAddonCleanups && window.__cxAddonCleanups.length);
console.log('ended BEFORE ns.uninstall =', liveDoc.get('ended') || 0);
if (window.__CX_FORCE_PLAY && window.__CX_FORCE_PLAY.uninstall) { window.__CX_FORCE_PLAY.uninstall(); }
console.log('ended AFTER ns.uninstall =', liveDoc.get('ended') || 0, JSON.stringify(endedHandlers));
console.log('cleanups after uninstall =', Array.isArray(window.__cxAddonCleanups) ? window.__cxAddonCleanups.length : 'cleared');
console.log('addon cleanups len =', (window.__cxAddonCleanups && window.__cxAddonCleanups.length));
process.exit(0);
