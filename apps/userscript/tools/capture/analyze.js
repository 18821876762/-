'use strict';
/*
 * 抓包日志离线分析器 —— 读取 capture-server.js 产出的 JSONL，按端点聚合，并标记风控可疑接口。
 *
 * 用法：
 *   node tools/capture/analyze.js [--file=<xxx.jsonl>] [--grep=<正则>] [--top=30]
 *                                 [--show-body] [--risk-only] [--json]
 * 说明：
 *   --file      指定日志；默认取 tools/capture/logs/ 下最新一个 capture-*.jsonl
 *   --grep      只统计 URL 命中正则的条目
 *   --top       输出条数上限（默认 30）
 *   --show-body 附带打印代表性请求体/响应体（截断 400 字符）
 *   --risk-only 只输出「风控可疑」端点
 *   --json      以 JSON 输出，便于二次处理
 */
const fs = require('fs');
const path = require('path');

const argv = process.argv.slice(2);
// 同时支持 `--name=value` 与 `--name value` 两种写法
function argOf(name, def) {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--' + name) {
      const v = argv[i + 1];
      return (v && !String(v).startsWith('--')) ? v : def;
    }
    if (String(a).startsWith('--' + name + '=')) return String(a).slice(name.length + 3);
  }
  return def;
}
const HAS = (n) => argv.indexOf('--' + n) >= 0;

const LOG_DIR = path.join(__dirname, 'logs');
const FILE = argOf('file', '');
const GREP = argOf('grep', '');
const TOP = parseInt(argOf('top', '30'), 10);
const SHOW_BODY = HAS('show-body');
const RISK_ONLY = HAS('risk-only');
const AS_JSON = HAS('json');

// 风控/进度上报可疑关键词（命中即打 ★ 标记，便于优先排查）
const RISK_RE = /(valid|check|verify|report|heartbeat|beat|log|save|record|progress|monitor|anti|cheat|risk|face|capture|duration|study|time)/i;

function pickLog() {
  if (FILE) return path.resolve(process.cwd(), FILE);
  if (!fs.existsSync(LOG_DIR)) return '';
  const files = fs.readdirSync(LOG_DIR).filter((f) => /^capture-.*\.jsonl$/.test(f)).sort();
  return files.length ? path.join(LOG_DIR, files[files.length - 1]) : '';
}

function pathOf(url) {
  try { const u = new URL(url); return u.origin + u.pathname; }
  catch (e) { return String(url).split('?')[0]; }
}

function main() {
  const file = pickLog();
  if (!file || !fs.existsSync(file)) {
    console.log('未找到抓包日志。请先运行 `npm run capture` 并在浏览器启用 cx-capture.user.js。');
    process.exit(1);
  }

  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
  const grep = GREP ? new RegExp(GREP, 'i') : null;

  /** @type {Map<string,any>} */
  const agg = new Map();
  let total = 0, skipped = 0;

  for (const line of lines) {
    let ev;
    try { ev = JSON.parse(line); } catch (e) { skipped++; continue; }
    const url = String(ev.url || '');
    if (grep && !grep.test(url)) continue;
    total++;
    const p = pathOf(url);
    const key = (ev.method || 'GET') + ' ' + p;
    let a = agg.get(key);
    if (!a) {
      a = { method: ev.method || 'GET', path: p, count: 0, status: {}, sumMs: 0, maxMs: 0, kinds: {},
            sampleReq: '', sampleRes: '', sampleUrl: url, risk: RISK_RE.test(p) || RISK_RE.test(url) };
      agg.set(key, a);
    }
    a.count++;
    const st = String(ev.status || 0);
    a.status[st] = (a.status[st] || 0) + 1;
    const ms = Number(ev.ms) || 0;
    a.sumMs += ms;
    if (ms > a.maxMs) a.maxMs = ms;
    a.kinds[ev.kind || '?'] = (a.kinds[ev.kind || '?'] || 0) + 1;
    if (!a.sampleReq && ev.reqBody) a.sampleReq = String(ev.reqBody).slice(0, 400);
    if (!a.sampleRes && ev.resBody) a.sampleRes = String(ev.resBody).slice(0, 400);
  }

  let rows = Array.from(agg.values()).sort((x, y) => y.count - x.count);
  if (RISK_ONLY) rows = rows.filter((r) => r.risk);
  rows = rows.slice(0, TOP);

  if (AS_JSON) {
    console.log(JSON.stringify({ file: file, total: total, skipped: skipped, rows: rows }, null, 2));
    return;
  }

  console.log('=== 抓包分析 ===');
  console.log('日志   : ' + file);
  console.log('命中条数: ' + total + (skipped ? '（跳过 ' + skipped + ' 条坏行）' : ''));
  console.log('端点数 : ' + rows.length + (RISK_ONLY ? '（仅风控可疑）' : '') + '\n');

  if (!rows.length) {
    console.log('（无命中条目）');
    return;
  }

  for (const r of rows) {
    const statusStr = Object.keys(r.status).map((k) => k + '×' + r.status[k]).join(' ');
    const kinds = Object.keys(r.kinds).join(',');
    console.log((r.risk ? '★ ' : '  ') + r.count + '×  ' + r.method + '  ' + r.path);
    console.log('      状态: ' + statusStr + '   均值: ' + Math.round(r.sumMs / r.count) + 'ms  峰值: ' + r.maxMs + 'ms   来源: ' + kinds);
    if (SHOW_BODY) {
      if (r.sampleReq) console.log('      请求体: ' + r.sampleReq.replace(/\s+/g, ' '));
      if (r.sampleRes) console.log('      响应体: ' + r.sampleRes.replace(/\s+/g, ' '));
    }
  }

  const riskRows = rows.filter((r) => r.risk);
  if (riskRows.length) {
    console.log('\n★ = 命中风控/进度上报关键词（valid|check|report|heartbeat|log|progress|time…），建议优先排查：');
    riskRows.slice(0, 10).forEach((r) => console.log('   ' + r.method + ' ' + r.path + '  (' + r.count + '×)'));
  }
}

main();
