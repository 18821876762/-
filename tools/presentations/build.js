const path = require('path');
const projectPaths = require('./project-paths.cjs');
const pptxgen = require("pptxgenjs");

const pres = new pptxgen();
pres.layout = "LAYOUT_WIDE"; // 13.3 x 7.5
pres.author = "Architecture Team";
pres.title = "网课强制续播系统 · 架构与设计";

const W = 13.3, H = 7.5;
const C = {
  DARK: "0E1A36",
  DARK2: "15244A",
  PRIMARY: "1B2A4A",
  ACCENT: "16C79A",
  ACCENT_DK: "0E8C6E",
  ACCENT2: "F4A259",
  LIGHT: "F5F7FB",
  CARD: "FFFFFF",
  TEXT: "1F2A44",
  MUTED: "6B7790",
  LINE: "D8DEEA",
  ICE: "CADCFC",
};
const F = "Microsoft YaHei";

const makeShadow = () => ({ type: "outer", color: "000000", opacity: 0.12, blur: 8, offset: 3, angle: 135 });
const softShadow = () => ({ type: "outer", color: "000000", opacity: 0.08, blur: 6, offset: 2, angle: 135 });

function bg(slide, color) { slide.background = { color }; }

function footer(slide, n) {
  slide.addText("网课强制续播系统 · 架构与设计", { x: 0.7, y: 7.05, w: 8, h: 0.35, fontSize: 9, color: C.MUTED, fontFace: F });
  slide.addText(String(n), { x: 12.3, y: 7.05, w: 0.7, h: 0.35, fontSize: 9, color: C.MUTED, align: "right", fontFace: F });
}

function header(slide, kicker, title) {
  slide.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: W, h: 0.16, fill: { color: C.ACCENT } });
  slide.addText(kicker, { x: 0.7, y: 0.42, w: 12, h: 0.34, fontSize: 12, color: C.ACCENT_DK, bold: true, charSpacing: 2, fontFace: F });
  slide.addText(title, { x: 0.7, y: 0.76, w: 12, h: 0.7, fontSize: 28, bold: true, color: C.PRIMARY, fontFace: F });
}

function card(slide, x, y, w, h, accent) {
  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w, h, rectRadius: 0.08, fill: { color: C.CARD }, line: { color: C.LINE, width: 1 }, shadow: softShadow() });
  if (accent) slide.addShape(pres.shapes.RECTANGLE, { x, y: y + 0.12, w: 0.09, h: h - 0.24, fill: { color: accent } });
}

function sectionNum(slide, n, x, y) {
  slide.addShape(pres.shapes.OVAL, { x, y, w: 0.62, h: 0.62, fill: { color: C.ACCENT } });
  slide.addText(String(n), { x, y, w: 0.62, h: 0.62, fontSize: 22, bold: true, color: "FFFFFF", align: "center", valign: "middle", fontFace: F });
}

function arrow(slide, x, y, w, color) {
  slide.addShape(pres.shapes.LINE, { x, y, w, h: 0, line: { color: color || C.ACCENT_DK, width: 2.5, endArrowType: "triangle" } });
}

// ============================================================
// Slide 1 — Title
// ============================================================
(() => {
  const s = pres.addSlide();
  bg(s, C.DARK);
  s.addShape(pres.shapes.OVAL, { x: 9.8, y: -2.2, w: 6.5, h: 6.5, fill: { color: C.ACCENT, transparency: 82 } });
  s.addShape(pres.shapes.OVAL, { x: 11.2, y: 3.8, w: 3.6, h: 3.6, fill: { color: C.ACCENT2, transparency: 86 } });
  s.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: 0.18, h: H, fill: { color: C.ACCENT } });

  s.addText("SYSTEM ARCHITECTURE · 系统架构与设计", { x: 1.0, y: 2.0, w: 11, h: 0.5, fontSize: 14, color: C.ACCENT, charSpacing: 3, bold: true, fontFace: F });
  s.addText("网课强制续播系统", { x: 1.0, y: 2.5, w: 11.3, h: 1.4, fontSize: 52, bold: true, color: "FFFFFF", fontFace: F });
  s.addText([
    { text: "浏览器用户脚本（Tampermonkey / Violentmonkey） · 多平台网课自动化接管", options: { breakLine: true, color: C.ICE, fontSize: 17 } },
    { text: "强制续播  ·  智能答题  ·  视觉对抗  ·  外部平台联动", options: { color: C.ACCENT, fontSize: 17, bold: true } },
  ], { x: 1.0, y: 4.05, w: 11.3, h: 1.0, fontFace: F, lineSpacingMultiple: 1.3 });

  s.addShape(pres.shapes.LINE, { x: 1.0, y: 5.25, w: 6.2, h: 0, line: { color: C.ACCENT, width: 1.5 } });
  s.addText("apps/userscript/src/chaoxing-force-play   ·   services/perception/   ·   scripts/build.ps1   ·   apps/userscript/_sim", { x: 1.0, y: 5.45, w: 11.3, h: 0.4, fontSize: 12, color: "8FA3C8", fontFace: "Consolas" });
})();

// ============================================================
// Slide 2 — 系统总览
// ============================================================
(() => {
  const s = pres.addSlide();
  bg(s, C.LIGHT);
  header(s, "01 · OVERVIEW", "系统总览：它是什么");
  s.addText("一个注入到网课页面主世界的单文件用户脚本，在 11+ 平台上实现「接管视频、自动答题、对抗混淆、联动外部」四大能力。", { x: 0.7, y: 1.55, w: 12, h: 0.6, fontSize: 14, color: C.MUTED, fontFace: F });

  const caps = [
    { t: "强制续播", c: C.ACCENT, d: "接管视频播放，中和平台反挂机检测（静音劫持 / 暂停按钮禁用 / 1x 速率限制 / 水印 / 弹窗干扰），播放结束自动跳下一节。" },
    { t: "智能答题", c: C.ACCENT2, d: "对作业 / 章节 / 考试题「真答题」：抓题干+选项 → 可插拔答案源求答案回填；对上课弹窗随机作答以消除干扰保续播。" },
    { t: "视觉对抗", c: "5B8DEF", d: "题干被同形字 / 字体映射 / Canvas 混淆时，把题目截图后由 OCR 或多模态 AI 还原真实文本，再以截图为准作答。" },
    { t: "外部联动", c: "9B6DD6", d: "本地 Python 采集爬虫接收浏览器侧采集数据，并将题库回灌给答题引擎，形成「采集 → 落库 → 答题」闭环。" },
  ];
  const cw = 5.95, ch = 2.0, gx = 0.4, gy = 0.35, x0 = 0.7, y0 = 2.35;
  caps.forEach((cap, i) => {
    const x = x0 + (i % 2) * (cw + gx);
    const y = y0 + Math.floor(i / 2) * (ch + gy);
    card(s, x, y, cw, ch, cap.c);
    s.addShape(pres.shapes.OVAL, { x: x + 0.3, y: y + 0.32, w: 0.55, h: 0.55, fill: { color: cap.c } });
    s.addText(["①", "②", "③", "④"][i], { x: x + 0.3, y: y + 0.32, w: 0.55, h: 0.55, fontSize: 20, bold: true, color: "FFFFFF", align: "center", valign: "middle", fontFace: F });
    s.addText(cap.t, { x: x + 1.05, y: y + 0.3, w: cw - 1.3, h: 0.55, fontSize: 19, bold: true, color: C.PRIMARY, fontFace: F });
    s.addText(cap.d, { x: x + 0.35, y: y + 1.0, w: cw - 0.7, h: 0.9, fontSize: 12.5, color: C.TEXT, fontFace: F, lineSpacingMultiple: 1.18, valign: "top" });
  });
  footer(s, 2);
})();

// ============================================================
// Slide 3 — 目标与适用平台
// ============================================================
(() => {
  const s = pres.addSlide();
  bg(s, C.LIGHT);
  header(s, "02 · PLATFORMS", "目标与适用平台");

  // stat callout
  card(s, 0.7, 1.7, 3.4, 2.1, C.ACCENT);
  s.addText("11+", { x: 0.7, y: 1.95, w: 3.4, h: 1.0, fontSize: 60, bold: true, color: C.ACCENT_DK, align: "center", fontFace: F });
  s.addText("主流网课平台覆盖", { x: 0.7, y: 3.05, w: 3.4, h: 0.5, fontSize: 14, bold: true, color: C.PRIMARY, align: "center", fontFace: F });

  const platforms = [
    "超星学习通", "学银在线", "智慧树 / 知到", "中国大学 MOOC", "icourse163",
    "学堂在线", "ICVE（智慧职教）", "实验空间", "人卫", "Unipus", "U 校园",
  ];
  s.addText("通过 detectSite() 按 host 识别站点，各平台逻辑集中于 sites/ 适配层；新增平台 = 新增 sites/*.js + 在 SITES 登记，核心引擎无需改动。", { x: 4.4, y: 1.7, w: 8.2, h: 1.0, fontSize: 13.5, color: C.MUTED, fontFace: F, lineSpacingMultiple: 1.25, valign: "top" });

  const pw = 2.55, ph = 0.78, gx = 0.28, gy = 0.3, x0 = 4.4, y0 = 2.95;
  platforms.forEach((p, i) => {
    const x = x0 + (i % 3) * (pw + gx);
    const y = y0 + Math.floor(i / 3) * (ph + gy);
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w: pw, h: ph, rectRadius: 0.1, fill: { color: C.CARD }, line: { color: C.LINE, width: 1 }, shadow: softShadow() });
    s.addShape(pres.shapes.OVAL, { x: x + 0.22, y: y + ph / 2 - 0.11, w: 0.22, h: 0.22, fill: { color: C.ACCENT } });
    s.addText(p, { x: x + 0.55, y, w: pw - 0.65, h: ph, fontSize: 13, bold: true, color: C.TEXT, valign: "middle", fontFace: F });
  });
  footer(s, 3);
})();

// ============================================================
// Slide 4 — 分层架构图
// ============================================================
(() => {
  const s = pres.addSlide();
  bg(s, C.LIGHT);
  header(s, "03 · ARCHITECTURE", "分层架构：六层 + 构建验证");

  // main column bands
  const bx = 0.7, bw = 8.6;
  const bands = [
    { t: "表现层 Presentation", n: "13 模块", c: "9B6DD6", d: "panel / panel-core / panel-drag / dashboard / ds-console / toast …" },
    { t: "插件 · 工具库层 Plugins", n: "registry + 6 addons", c: "5B8DEF", d: "auto-next · keyboard · quiet-popups · tamper-guard · ended-notify · zh-auto-next" },
    { t: "站点适配层 Sites", n: "12 文件", c: C.ACCENT2, d: "chaoxing-exam · zhihuishu · zhihuishu-exam · icourse163 · icve · ilabx …" },
    { t: "接管层 Takeover", n: "foundation 9 + engine 11 + dom 3 + bootstrap", c: C.ACCENT, d: "site-router · state · quiz · quiz-vision · bridge · playback · policy …" },
  ];
  const bh = 1.12, gap = 0.18, y0 = 1.75;
  bands.forEach((b, i) => {
    const y = y0 + i * (bh + gap);
    card(s, bx, y, bw, bh, b.c);
    s.addShape(pres.shapes.RECTANGLE, { x: bx, y, w: 0.18, h: bh, fill: { color: b.c } });
    s.addText(b.t, { x: bx + 0.35, y: y + 0.16, w: 4.4, h: 0.45, fontSize: 16, bold: true, color: C.PRIMARY, fontFace: F });
    s.addText(b.n, { x: bx + 0.35, y: y + 0.62, w: 4.4, h: 0.4, fontSize: 12, color: b.c, bold: true, fontFace: F });
    s.addText(b.d, { x: bx + 4.6, y, w: bw - 4.8, h: bh, fontSize: 11.5, color: C.TEXT, valign: "middle", fontFace: F, lineSpacingMultiple: 1.15 });
    if (i < bands.length - 1) arrow(s, bx + bw / 2 - 0.02, y + bh, 0.04, C.MUTED);
  });

  // right column: external + build
  const rx = 9.7, rw = 3.0;
  s.addText("外部 / 构建", { x: rx, y: 1.5, w: rw, h: 0.35, fontSize: 12, bold: true, color: C.MUTED, fontFace: F });
  const ext = [
    { t: "外部平台层", c: "E25C7A", d: "Python 采集爬虫 · DeepSeek 网页版 · 外部 CDN（html2canvas / tesseract）" },
    { t: "构建 & 验证", c: C.PRIMARY, d: "scripts/build.ps1 拼接单文件 · _sim 沙箱回归 31+ 用例" },
  ];
  ext.forEach((e, i) => {
    const y = 1.9 + i * 2.05;
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: rx, y, w: rw, h: 1.85, rectRadius: 0.08, fill: { color: C.CARD }, line: { color: C.LINE, width: 1 }, shadow: softShadow() });
    s.addShape(pres.shapes.RECTANGLE, { x: rx, y: y + 0.12, w: 0.09, h: 1.6, fill: { color: e.c } });
    s.addText(e.t, { x: rx + 0.3, y: y + 0.22, w: rw - 0.5, h: 0.4, fontSize: 14.5, bold: true, color: C.PRIMARY, fontFace: F });
    s.addText(e.d, { x: rx + 0.3, y: y + 0.7, w: rw - 0.5, h: 1.0, fontSize: 11, color: C.TEXT, fontFace: F, lineSpacingMultiple: 1.15, valign: "top" });
  });
  arrow(s, bx + bw + 0.15, 2.7, rx - (bx + bw + 0.15), C.MUTED);
  s.addText("浏览器 → 外部", { x: bx + bw + 0.15, y: 2.35, w: rx - (bx + bw + 0.15), h: 0.3, fontSize: 9, color: C.MUTED, align: "center", fontFace: F });

  s.addText("运行期全部逻辑位于单一 IIFE 内，模块间以 @provides / @requires 注释元标注声明依赖，靠闭包共享全局名协作。", { x: 0.7, y: 6.55, w: 12, h: 0.4, fontSize: 11.5, italic: true, color: C.MUTED, fontFace: F });
  footer(s, 4);
})();

// ============================================================
// Slide 5 — 接管层模块清单
// ============================================================
(() => {
  const s = pres.addSlide();
  bg(s, C.LIGHT);
  header(s, "04 · TAKEOVER LAYER", "接管层：模块清单（24 模块）");

  const groups = [
    { t: "基础能力 foundation（9）", c: C.ACCENT, items: ["site-router · detectSite/SITES", "state · 跨 iframe 全局 store", "storage / keys · CX_KEYS 键名", "meta-config · CONFIG / CONST", "utils · 运行环境探测 / URL", "error-guard · 容错守卫", "（另含 metrics 运行指标）"] },
    { t: "引擎 engine（11）", c: C.ACCENT2, items: ["bridge · 跨 iframe 桥接", "quiz · 站点无关真答题", "quiz-vision · 视觉对抗层", "vision-deepseek-web · DeepSeek 后端", "dedup · 指纹去重", "playback · 播放/续播引擎", "policy · 中和策略", "foreground / targeting", "stats / quiz-merge"] },
    { t: "DOM & 引导（4）", c: "5B8DEF", items: ["dom · selectorOverrides", "lifecycle · 元素挂载观测", "session · 视频会话上下文", "bootstrap/main-loop · 主循环状态机"] },
  ];
  const cw = 4.0, gx = 0.25, x0 = 0.7, y0 = 1.75, ch = 4.7;
  groups.forEach((g, i) => {
    const x = x0 + i * (cw + gx);
    card(s, x, y0, cw, ch, g.c);
    s.addShape(pres.shapes.RECTANGLE, { x, y: y0, w: cw, h: 0.7, fill: { color: g.c } });
    s.addText(g.t, { x: x + 0.25, y: y0, w: cw - 0.4, h: 0.7, fontSize: 14.5, bold: true, color: "FFFFFF", valign: "middle", fontFace: F });
    s.addText(g.items.map((it, k) => ({ text: it, options: { bullet: { code: "2022", indent: 14 }, breakLine: true, color: C.TEXT, fontSize: 11.5, paraSpaceAfter: 7 } })),
      { x: x + 0.3, y: y0 + 0.95, w: cw - 0.55, h: ch - 1.2, fontFace: F, valign: "top", lineSpacingMultiple: 1.05 });
  });
  s.addText("站点隔离的唯一事实源 = site-router.detectSite()；跨 iframe 状态由顶层帧 owner 持有单一事实源（R5 防卸载冻结）。", { x: 0.7, y: 6.6, w: 12, h: 0.4, fontSize: 11.5, italic: true, color: C.MUTED, fontFace: F });
  footer(s, 5);
})();

// ============================================================
// Slide 6 — 强制续播流
// ============================================================
(() => {
  const s = pres.addSlide();
  bg(s, C.LIGHT);
  header(s, "05 · FLOW · PLAYBACK", "核心能力①：强制续播防护流");

  const steps = [
    { t: "扫描到 video", d: "overrideVideo 接管事件与属性", c: C.ACCENT },
    { t: "站内中立化", d: "静音·取消暂停禁用·强制 play·1x 速率·隐藏水印", c: C.ACCENT2 },
    { t: "检测 ended？", d: "ended 事件 / 保活轮询", c: "5B8DEF" },
    { t: "自动下一节", d: "站点 nextUrl / auto-next 插件", c: "9B6DD6" },
  ];
  const cw = 2.85, ch = 1.9, gx = 0.35, x0 = 0.7, y = 2.2;
  steps.forEach((st, i) => {
    const x = x0 + i * (cw + gx);
    card(s, x, y, cw, ch, st.c);
    s.addShape(pres.shapes.OVAL, { x: x + cw / 2 - 0.32, y: y + 0.25, w: 0.64, h: 0.64, fill: { color: st.c } });
    s.addText(String(i + 1), { x: x + cw / 2 - 0.32, y: y + 0.25, w: 0.64, h: 0.64, fontSize: 22, bold: true, color: "FFFFFF", align: "center", valign: "middle", fontFace: F });
    s.addText(st.t, { x: x + 0.2, y: y + 1.0, w: cw - 0.4, h: 0.4, fontSize: 15, bold: true, color: C.PRIMARY, align: "center", fontFace: F });
    s.addText(st.d, { x: x + 0.2, y: y + 1.4, w: cw - 0.4, h: 0.45, fontSize: 10.5, color: C.TEXT, align: "center", fontFace: F, lineSpacingMultiple: 1.1 });
    if (i < steps.length - 1) arrow(s, x + cw + 0.02, y + ch / 2, gx - 0.04, C.MUTED);
  });

  // popup branch
  card(s, 0.7, 4.75, 12.0, 1.5, "E25C7A");
  s.addShape(pres.shapes.RECTANGLE, { x: 0.7, y: 4.87, w: 0.09, h: 1.26, fill: { color: "E25C7A" } });
  s.addText("弹窗干扰分支", { x: 1.05, y: 4.95, w: 3, h: 0.45, fontSize: 14, bold: true, color: "B23A55", fontFace: F });
  s.addText([
    { text: "检测到弹窗 → ", options: { bold: true, color: C.PRIMARY } },
    { text: "popupQuizTick 随机作答 + 删弹窗，消除干扰以保证续播不受影响（与追求正确率的 quiz 不同）。", options: { color: C.TEXT } },
  ], { x: 1.05, y: 5.4, w: 11.3, h: 0.7, fontSize: 12.5, fontFace: F, lineSpacingMultiple: 1.2, valign: "top" });
  s.addText("主场景：超星 / 学银 / MOOC。反挂机中和由 policy.js 统一处理，避免在各站点散落逻辑。", { x: 0.7, y: 6.5, w: 12, h: 0.4, fontSize: 11.5, italic: true, color: C.MUTED, fontFace: F });
  footer(s, 6);
})();

// ============================================================
// Slide 7 — 智能答题流
// ============================================================
(() => {
  const s = pres.addSlide();
  bg(s, C.LIGHT);
  header(s, "06 · FLOW · QUIZ", "核心能力②：智能答题（真答题）流");

  const steps = [
    { t: "抓题干/选项", d: "selector 并集 · _pqQueryAll", c: C.ACCENT },
    { t: "指纹去重", d: "_quizHandled 防重复作答", c: "5B8DEF" },
    { t: "答案源", d: "random / bank / ai / deepseek-web", c: C.ACCENT2 },
    { t: "回填选项", d: "写入 DOM 选中态", c: "9B6DD6" },
    { t: "二次确认提交", d: "标记 handled → 提交", c: "E25C7A" },
  ];
  const cw = 2.25, ch = 1.85, gx = 0.18, x0 = 0.7, y = 2.15;
  steps.forEach((st, i) => {
    const x = x0 + i * (cw + gx);
    card(s, x, y, cw, ch, st.c);
    s.addShape(pres.shapes.OVAL, { x: x + cw / 2 - 0.3, y: y + 0.22, w: 0.6, h: 0.6, fill: { color: st.c } });
    s.addText(String(i + 1), { x: x + cw / 2 - 0.3, y: y + 0.22, w: 0.6, h: 0.6, fontSize: 20, bold: true, color: "FFFFFF", align: "center", valign: "middle", fontFace: F });
    s.addText(st.t, { x: x + 0.12, y: y + 0.95, w: cw - 0.24, h: 0.4, fontSize: 13.5, bold: true, color: C.PRIMARY, align: "center", fontFace: F });
    s.addText(st.d, { x: x + 0.12, y: y + 1.35, w: cw - 0.24, h: 0.45, fontSize: 9.5, color: C.TEXT, align: "center", fontFace: F, lineSpacingMultiple: 1.05 });
    if (i < steps.length - 1) arrow(s, x + cw + 0.01, y + ch / 2, gx - 0.02, C.MUTED);
  });

  // answer sources + strict mode
  card(s, 0.7, 4.35, 6.0, 2.05, C.ACCENT2);
  s.addText("可插拔答案源", { x: 0.95, y: 4.5, w: 5.5, h: 0.4, fontSize: 14.5, bold: true, color: C.PRIMARY, fontFace: F });
  s.addText([
    { text: "random — 兜底随机", options: { bullet: true, breakLine: true } },
    { text: "bank — 本地题库（可由 Python 爬虫回灌）", options: { bullet: true, breakLine: true } },
    { text: "ai — 自建端点多模态识别", options: { bullet: true, breakLine: true } },
    { text: "deepseek-web — 跨页视觉问 DeepSeek（截图+提示词）", options: { bullet: true } },
  ], { x: 0.95, y: 4.95, w: 5.5, h: 1.3, fontSize: 11.5, color: C.TEXT, fontFace: F, lineSpacingMultiple: 1.15, paraSpaceAfter: 4 });

  card(s, 6.9, 4.35, 5.8, 2.05, "E25C7A");
  s.addText("严格 AI 模式", { x: 7.15, y: 4.5, w: 5.3, h: 0.4, fontSize: 14.5, bold: true, color: "B23A55", fontFace: F });
  s.addText([
    { text: "任何答案源失败都「停下报错」", options: { bullet: true, breakLine: true, color: C.TEXT } },
    { text: "绝不随机兜底，进入冷却重试", options: { bullet: true, breakLine: true, color: C.TEXT } },
    { text: "内存护栏：指纹/队列带上限淘汰与 TTL，防超长会话无限增长", options: { bullet: true, color: C.TEXT } },
  ], { x: 7.15, y: 4.95, w: 5.3, h: 1.3, fontSize: 11.5, fontFace: F, lineSpacingMultiple: 1.15, paraSpaceAfter: 4 });
  s.addText("ai 源异步回填 quizBank，后续同题命中 bank，减少重复请求。", { x: 0.7, y: 6.55, w: 12, h: 0.4, fontSize: 11.5, italic: true, color: C.MUTED, fontFace: F });
  footer(s, 7);
})();

// ============================================================
// Slide 8 — 视觉对抗
// ============================================================
(() => {
  const s = pres.addSlide();
  bg(s, C.LIGHT);
  header(s, "07 · FLOW · VISION", "核心能力③：视觉对抗（抗文本混淆）");

  // left problem, right solution
  card(s, 0.7, 1.85, 5.7, 4.6, "E25C7A");
  s.addShape(pres.shapes.RECTANGLE, { x: 0.7, y: 1.85, w: 5.7, h: 0.7, fill: { color: "E25C7A" } });
  s.addText("问题：DOM 文本不可信", { x: 0.95, y: 1.85, w: 5.3, h: 0.7, fontSize: 15, bold: true, color: "FFFFFF", valign: "middle", fontFace: F });
  s.addText([
    { text: "平台对题干做 同形字替换 / 字体映射 / Canvas 渲染", options: { bullet: true, breakLine: true } },
    { text: "DOM textContent 与肉眼所见不一致（「假字」）", options: { bullet: true, breakLine: true } },
    { text: "若直接读 DOM 文本作答 → 答非所问", options: { bullet: true, breakLine: true } },
    { text: "html2canvas 被 CDN 拦截时，靠多镜像 + 自定义地址兜底", options: { bullet: true } },
  ], { x: 1.0, y: 2.8, w: 5.2, h: 3.4, fontSize: 12.5, color: C.TEXT, fontFace: F, lineSpacingMultiple: 1.25, paraSpaceAfter: 10, valign: "top" });

  card(s, 6.9, 1.85, 5.8, 4.6, C.ACCENT);
  s.addShape(pres.shapes.RECTANGLE, { x: 6.9, y: 1.85, w: 5.8, h: 0.7, fill: { color: C.ACCENT } });
  s.addText("解法：一律以截图为准", { x: 7.15, y: 1.85, w: 5.3, h: 0.7, fontSize: 15, bold: true, color: "FFFFFF", valign: "middle", fontFace: F });
  s.addText([
    { text: "quiz-vision 多镜像 html2canvas 截图题目区域", options: { bullet: true, breakLine: true } },
    { text: "tesseract 本地 OCR 还原文本", options: { bullet: true, breakLine: true } },
    { text: "endpoint 多模态 AI 返回 text + answer", options: { bullet: true, breakLine: true } },
    { text: "deepseek-web 跨页问 DeepSeek 截图 + 提示词", options: { bullet: true, breakLine: true } },
    { text: "隐私优先：外部 CDN 须显式授权才加载，未授权静默拦截并 toast", options: { bullet: true } },
  ], { x: 7.2, y: 2.8, w: 5.3, h: 3.4, fontSize: 12.5, color: C.TEXT, fontFace: F, lineSpacingMultiple: 1.2, paraSpaceAfter: 9, valign: "top" });

  footer(s, 8);
})();

// ============================================================
// Slide 9 — 外部平台联动
// ============================================================
(() => {
  const s = pres.addSlide();
  bg(s, C.LIGHT);
  header(s, "08 · FLOW · BRIDGE", "核心能力④：跨进程桥接（浏览器 → Python）");

  const steps = [
    { t: "浏览器脚本采集", d: "bridge / progress-panel /media-collector", c: C.ACCENT },
    { t: "HTTP 采集", d: "发送至本地 HTTP 桥", c: "5B8DEF" },
    { t: "bridge.py 落库", d: "output/ 落 json · html", c: C.ACCENT2 },
    { t: "题库回灌", d: "写入 quizBank", c: "9B6DD6" },
    { t: "bank 答案源", d: "quiz.js 命中本地题库", c: "E25C7A" },
  ];
  const cw = 2.25, ch = 1.85, gx = 0.18, x0 = 0.7, y = 2.2;
  steps.forEach((st, i) => {
    const x = x0 + i * (cw + gx);
    card(s, x, y, cw, ch, st.c);
    s.addShape(pres.shapes.OVAL, { x: x + cw / 2 - 0.3, y: y + 0.22, w: 0.6, h: 0.6, fill: { color: st.c } });
    s.addText(String(i + 1), { x: x + cw / 2 - 0.3, y: y + 0.22, w: 0.6, h: 0.6, fontSize: 20, bold: true, color: "FFFFFF", align: "center", valign: "middle", fontFace: F });
    s.addText(st.t, { x: x + 0.12, y: y + 0.95, w: cw - 0.24, h: 0.4, fontSize: 13, bold: true, color: C.PRIMARY, align: "center", fontFace: F });
    s.addText(st.d, { x: x + 0.12, y: y + 1.35, w: cw - 0.24, h: 0.45, fontSize: 9.5, color: C.TEXT, align: "center", fontFace: F, lineSpacingMultiple: 1.05 });
    if (i < steps.length - 1) arrow(s, x + cw + 0.01, y + ch / 2, gx - 0.02, C.MUTED);
  });

  card(s, 0.7, 4.5, 12.0, 1.85, "9B6DD6");
  s.addShape(pres.shapes.RECTANGLE, { x: 0.7, y: 4.62, w: 0.09, h: 1.6, fill: { color: "9B6DD6" } });
  s.addText("services/perception/ 采集爬虫（cx_crawler/）", { x: 1.05, y: 4.7, w: 11, h: 0.45, fontSize: 14.5, bold: true, color: C.PRIMARY, fontFace: F });
  s.addText([
    { text: "bridge.py（本地 HTTP 桥） · chapters.py · courses.py · quizzes.py", options: { breakLine: true } },
    { text: "dump.py · render.py · session.py · api_client.py · heartbeat.py · config.py", options: { breakLine: true } },
    { text: "输出落 output/ → 题库回灌 __CX_FORCE_PLAY.quizBank（键 CX_KEYS.QUIZ_BANK）→ bank 答案源直接命中。", options: {} },
  ], { x: 1.05, y: 5.2, w: 11.3, h: 1.0, fontSize: 12, color: C.TEXT, fontFace: F, lineSpacingMultiple: 1.2, valign: "top" });
  footer(s, 9);
})();

// ============================================================
// Slide 10 — 站点适配层
// ============================================================
(() => {
  const s = pres.addSlide();
  bg(s, C.LIGHT);
  header(s, "09 · SITES", "站点适配层：12 个站点文件");

  const cols = [
    { t: "主流网课（真答题）", c: C.ACCENT, items: ["chaoxing-exam.js（超星/学银）", "zhihuishu.js（智慧树/知到）", "zhihuishu-exam.js（作业/考试）", "icourse163.js（中国大学 MOOC）", "xuetangx.js（学堂在线）"] },
    { t: "职教 / 实验 / 出版", c: C.ACCENT2, items: ["icve.js（智慧职教）", "ilabx.js（实验空间）", "renwei.js（人卫）", "unipus.js（Unipus）", "ucampus.js（U 校园）"] },
    { t: "共享骨架", c: "5B8DEF", items: ["quiz-selectors.js（选择器并集）", "popup-quiz.js（弹窗随机作答）", "各站提供 selectors 同构映射", "调用 quizTick / popupQuizTick", "暴露站点专属能力接口"] },
  ];
  const cw = 4.0, gx = 0.25, x0 = 0.7, y0 = 1.8, ch = 4.6;
  cols.forEach((col, i) => {
    const x = x0 + i * (cw + gx);
    card(s, x, y0, cw, ch, col.c);
    s.addShape(pres.shapes.RECTANGLE, { x, y: y0, w: cw, h: 0.7, fill: { color: col.c } });
    s.addText(col.t, { x: x + 0.25, y: y0, w: cw - 0.4, h: 0.7, fontSize: 14, bold: true, color: "FFFFFF", valign: "middle", fontFace: F });
    s.addText(col.items.map((it) => ({ text: it, options: { bullet: { code: "2022", indent: 14 }, breakLine: true, color: C.TEXT, fontSize: 12, paraSpaceAfter: 9 } })),
      { x: x + 0.3, y: y0 + 0.95, w: cw - 0.55, h: ch - 1.2, fontFace: F, valign: "top", lineSpacingMultiple: 1.1 });
  });
  s.addText("站点隔离：新增平台只需新增 sites/*.js + 在 SITES 登记，核心引擎（quiz / quiz-vision / playback）零改动。", { x: 0.7, y: 6.6, w: 12, h: 0.4, fontSize: 11.5, italic: true, color: C.MUTED, fontFace: F });
  footer(s, 10);
})();

// ============================================================
// Slide 11 — 插件与表现层
// ============================================================
(() => {
  const s = pres.addSlide();
  bg(s, C.LIGHT);
  header(s, "10 · PLUGINS & UI", "插件·工具库层 与 表现层");

  // plugins
  card(s, 0.7, 1.85, 6.0, 4.6, C.ACCENT2);
  s.addShape(pres.shapes.RECTANGLE, { x: 0.7, y: 1.85, w: 6.0, h: 0.7, fill: { color: C.ACCENT2 } });
  s.addText("插件 · 工具库层（registry + 6 addons）", { x: 0.95, y: 1.85, w: 5.6, h: 0.7, fontSize: 14, bold: true, color: "FFFFFF", valign: "middle", fontFace: F });
  const addons = [
    "registry.js — 插件注册表（__cxRegisterAddon / __cxRegisterCommand）",
    "auto-next.js — 自动下一节",
    "keyboard-shortcuts.js — 快捷键（P 开关面板）",
    "quiet-popups.js — 静默弹窗消干扰",
    "tamper-guard.js — 防篡改守卫",
    "video-ended-notify.js — 视频结束通知",
    "zhihuishu-auto-next.js — 智慧树自动下一节",
  ];
  s.addText(addons.map((it) => ({ text: it, options: { bullet: { code: "2022", indent: 14 }, breakLine: true, color: C.TEXT, fontSize: 12, paraSpaceAfter: 8 } })),
    { x: 1.0, y: 2.8, w: 5.5, h: 3.4, fontFace: F, valign: "top", lineSpacingMultiple: 1.1 });

  // presentation
  card(s, 6.9, 1.85, 5.8, 4.6, "5B8DEF");
  s.addShape(pres.shapes.RECTANGLE, { x: 6.9, y: 1.85, w: 5.8, h: 0.7, fill: { color: "5B8DEF" } });
  s.addText("表现层 Presentation（13 模块）", { x: 7.15, y: 1.85, w: 5.4, h: 0.7, fontSize: 14, bold: true, color: "FFFFFF", valign: "middle", fontFace: F });
  s.addText([
    { text: "panel / panel-core — 总装 + 跨帧 owner 抢占", options: { bullet: true, breakLine: true } },
    { text: "panel-drag — Ninja FAB 拖拽（lostpointercapture 自愈）", options: { bullet: true, breakLine: true } },
    { text: "panel-template — 场景自适应（强制续播 / 作业助手 / 应答端控制台）", options: { bullet: true, breakLine: true } },
    { text: "panel-controls — 控件持久化到 localStorage", options: { bullet: true, breakLine: true } },
    { text: "panel-ds-console — DeepSeek 应答端控制台", options: { bullet: true, breakLine: true } },
    { text: "dashboard / diagnostics / commands / toast", options: { bullet: true, breakLine: true } },
    { text: "panel-toast-feed / styles / zhihuishu-fab", options: { bullet: true } },
  ], { x: 7.2, y: 2.8, w: 5.3, h: 3.4, fontSize: 12, color: C.TEXT, fontFace: F, valign: "top", lineSpacingMultiple: 1.12, paraSpaceAfter: 7 });
  footer(s, 11);
})();

// ============================================================
// Slide 12 — 主循环 / 启动数据流
// ============================================================
(() => {
  const s = pres.addSlide();
  bg(s, C.LIGHT);
  header(s, "11 · MAIN LOOP", "启动接管 & 主循环状态机");

  // left: startup
  card(s, 0.7, 1.85, 5.7, 2.15, C.ACCENT);
  s.addShape(pres.shapes.RECTANGLE, { x: 0.7, y: 1.85, w: 5.7, h: 0.6, fill: { color: C.ACCENT } });
  s.addText("启动流", { x: 0.95, y: 1.85, w: 5.3, h: 0.6, fontSize: 14.5, bold: true, color: "FFFFFF", valign: "middle", fontFace: F });
  s.addText([
    { text: "脚本注入（IIFE）→ meta.js 构建 __CX_FORCE_PLAY 命名空间", options: { bullet: true, breakLine: true } },
    { text: "初始化 state / storage / CONFIG / site-router / utils(环境探测)", options: { bullet: true, breakLine: true } },
    { text: "main-loop 启动定时 tick", options: { bullet: true } },
  ], { x: 1.0, y: 2.6, w: 5.2, h: 1.3, fontSize: 12, color: C.TEXT, fontFace: F, lineSpacingMultiple: 1.2, paraSpaceAfter: 6, valign: "top" });

  // right: per-tick loop
  card(s, 6.9, 1.85, 5.8, 2.15, C.ACCENT2);
  s.addShape(pres.shapes.RECTANGLE, { x: 6.9, y: 1.85, w: 5.8, h: 0.6, fill: { color: C.ACCENT2 } });
  s.addText("每轮 tick", { x: 7.15, y: 1.85, w: 5.3, h: 0.6, fontSize: 14.5, bold: true, color: "FFFFFF", valign: "middle", fontFace: F });
  s.addText([
    { text: "detectSite() → currentSiteCfg() 取能力集", options: { bullet: true, breakLine: true } },
    { text: "_pqQueryAll 扫描 video / 题目", options: { bullet: true, breakLine: true } },
    { text: "overrideVideo 接管 + 站内中立化", options: { bullet: true, breakLine: true } },
    { text: "按站点执行 答题 / 续播 / 面板", options: { bullet: true } },
  ], { x: 7.2, y: 2.6, w: 5.3, h: 1.3, fontSize: 12, color: C.TEXT, fontFace: F, lineSpacingMultiple: 1.2, paraSpaceAfter: 6, valign: "top" });

  // bottom: event bus single-direction
  card(s, 0.7, 4.35, 12.0, 2.05, "5B8DEF");
  s.addShape(pres.shapes.RECTANGLE, { x: 0.7, y: 4.35, w: 12.0, h: 0.6, fill: { color: "5B8DEF" } });
  s.addText("UI 事件流：事件上行 + 存储下行（单向数据流）", { x: 0.95, y: 4.35, w: 11, h: 0.6, fontSize: 14.5, bold: true, color: "FFFFFF", valign: "middle", fontFace: F });
  s.addText([
    { text: "engine / bootstrap 只发事件 → EventBus.emit(ui:toast / ui:status / videos:scanned / ds-*)", options: { bullet: true, breakLine: true, color: C.TEXT } },
    { text: "presentation 只订阅渲染 → 用户操作写 localStorage(CX_KEYS) → 配置热更新", options: { bullet: true, breakLine: true, color: C.TEXT } },
    { text: "main-loop 下一 tick 读取最新配置 → 形成「事件上行 + 存储下行」闭环，UI 与逻辑解耦。", options: { bullet: true, color: C.TEXT } },
  ], { x: 1.0, y: 5.1, w: 11.3, h: 1.1, fontSize: 12, fontFace: F, lineSpacingMultiple: 1.2, paraSpaceAfter: 6, valign: "top" });
  footer(s, 12);
})();

// ============================================================
// Slide 13 — 跨模块契约
// ============================================================
(() => {
  const s = pres.addSlide();
  bg(s, C.LIGHT);
  header(s, "12 · CONTRACTS", "跨模块契约（共享全局名）");

  const rows = [
    [{ text: "状态命名空间", options: { bold: true, color: "FFFFFF", fill: { color: C.ACCENT_DK } } }, { text: "window.__CX_FORCE_PLAY（state store / toolkit / quizBank / DS 状态）", options: { color: C.TEXT } }],
    [{ text: "插件契约", options: { bold: true, color: "FFFFFF", fill: { color: C.ACCENT_DK } } }, { text: "__cxAddonQueue / __cxRegisterAddon / __cxRegisterCommand", options: { color: C.TEXT } }],
    [{ text: "配置 / 常量", options: { bold: true, color: "FFFFFF", fill: { color: C.ACCENT_DK } } }, { text: "CONFIG / CONST / CX_KEYS", options: { color: C.TEXT } }],
    [{ text: "事件总线", options: { bold: true, color: "FFFFFF", fill: { color: C.ACCENT_DK } } }, { text: "EventBus：ui:toast / ui:status / videos:scanned / targets:updated / zh-exam:state / ds-*", options: { color: C.TEXT } }],
    [{ text: "工具函数", options: { bold: true, color: "FFFFFF", fill: { color: C.ACCENT_DK } } }, { text: "bestEffort / safeGet / swallow / lsGet / lsSet", options: { color: C.TEXT } }],
    [{ text: "站点 / 续播 / 答题", options: { bold: true, color: "FFFFFF", fill: { color: C.ACCENT_DK } } }, { text: "detectSite / currentVideo / allVideos / foregroundVideo · applyUserRateAll / savePanelCfg · quizTick / popupQuizTick / dsAvailable", options: { color: C.TEXT } }],
  ];
  s.addTable(rows, {
    x: 0.7, y: 1.9, w: 12.0, colW: [2.6, 9.4],
    fontSize: 12.5, fontFace: F, valign: "middle",
    border: { type: "solid", pt: 1, color: C.LINE },
    rowH: [0.78, 0.78, 0.62, 0.78, 0.62, 0.95],
    align: "left", autoPage: false,
  });
  s.addText("契约是 UI 与逻辑解耦的核心：engine/bootstrap 仅发事件，presentation 仅订阅渲染；新增模块须遵守同一组全局名。", { x: 0.7, y: 6.5, w: 12, h: 0.4, fontSize: 11.5, italic: true, color: C.MUTED, fontFace: F });
  footer(s, 13);
})();

// ============================================================
// Slide 14 — 关键设计模式（上）
// ============================================================
(() => {
  const s = pres.addSlide();
  bg(s, C.LIGHT);
  header(s, "13 · DESIGN (1/2)", "关键设计模式与决策");

  const items = [
    ["单文件 IIFE + 元标注", "58 源文件开发期分文件，@provides/@requires 声明依赖，构建拼为单个 .user.js；闭包共享全局名，绕开 ESM 兼容问题。"],
    ["站点隔离 detectSite", "所有站点逻辑经 currentSiteCfg() 取能力集，核心引擎禁止散落 @match host 判断；新增平台零改核心。"],
    ["答案源可插拔", "quiz.js 不编造答案：random/bank/ai/deepseek-web 可切换；严格 AI 模式失败即报错，不随机兜底。"],
    ["视觉对抗（抗混淆）", "题干被混淆时 DOM 不可信，一律截图经 OCR / 多模态 AI 还原。"],
  ];
  const cw = 5.95, ch = 2.15, gx = 0.4, gy = 0.5, x0 = 0.7, y0 = 1.9;
  items.forEach((it, i) => {
    const x = x0 + (i % 2) * (cw + gx);
    const y = y0 + Math.floor(i / 2) * (ch + gy);
    card(s, x, y, cw, ch, C.ACCENT);
    sectionNum(s, i + 1, x + 0.3, y + 0.28);
    s.addText(it[0], { x: x + 1.1, y: y + 0.26, w: cw - 1.35, h: 0.5, fontSize: 14.5, bold: true, color: C.PRIMARY, fontFace: F });
    s.addText(it[1], { x: x + 0.35, y: y + 0.95, w: cw - 0.7, h: 1.05, fontSize: 11, color: C.TEXT, fontFace: F, lineSpacingMultiple: 1.15, valign: "top" });
  });
  footer(s, 14);
})();

// ============================================================
// Slide 15 — 关键设计模式（下）
// ============================================================
(() => {
  const s = pres.addSlide();
  bg(s, C.LIGHT);
  header(s, "13 · DESIGN (2/2)", "关键设计模式与决策");

  const items = [
    ["隐私优先", "外部 CDN（html2canvas/tesseract）须显式授权才加载；未授权静默拦截并 toast 提示。"],
    ["多 iframe / 跨域鲁棒", "面板挂顶层帧保证全站唯一；跨域不可达 safeGet 回退本帧；owner 抢占(R5)+缓存自愈(R11)防面板消失。"],
    ["内存护栏", "指纹/队列带上限淘汰与 TTL，防超长会话无限增长。"],
    ["增量 diff 优化", "MutationObserver 递增 _quizDirtyGen，指纹跨 tick 缓存(WeakMap)，稳态零重算 textContent。"],
  ];
  const cw = 5.95, ch = 2.15, gx = 0.4, gy = 0.5, x0 = 0.7, y0 = 1.9;
  items.forEach((it, i) => {
    const x = x0 + (i % 2) * (cw + gx);
    const y = y0 + Math.floor(i / 2) * (ch + gy);
    card(s, x, y, cw, ch, C.ACCENT);
    sectionNum(s, i + 5, x + 0.3, y + 0.28);
    s.addText(it[0], { x: x + 1.1, y: y + 0.26, w: cw - 1.35, h: 0.5, fontSize: 14.5, bold: true, color: C.PRIMARY, fontFace: F });
    s.addText(it[1], { x: x + 0.35, y: y + 0.95, w: cw - 0.7, h: 1.05, fontSize: 11, color: C.TEXT, fontFace: F, lineSpacingMultiple: 1.15, valign: "top" });
  });
  footer(s, 15);
})();

// ============================================================
// Slide 15 — 构建与验证
// ============================================================
(() => {
  const s = pres.addSlide();
  bg(s, C.LIGHT);
  header(s, "14 · BUILD & VERIFY", "构建与验证链路");

  // pipeline
  const steps = [
    { t: "源码 src/*.js", d: "58 个源文件", c: C.ACCENT },
    { t: "build-manifest", d: "域顺序单一事实源", c: "5B8DEF" },
    { t: "build.ps1", d: "拼接+多镜像+校验", c: C.ACCENT2 },
    { t: "user.js", d: "单文件产物", c: "9B6DD6" },
    { t: "_sim 回归", d: "31+ 沙箱用例", c: "E25C7A" },
  ];
  const cw = 2.25, ch = 1.5, gx = 0.18, x0 = 0.7, y = 1.9;
  steps.forEach((st, i) => {
    const x = x0 + i * (cw + gx);
    card(s, x, y, cw, ch, st.c);
    s.addText(st.t, { x: x + 0.15, y: y + 0.25, w: cw - 0.3, h: 0.5, fontSize: 13.5, bold: true, color: C.PRIMARY, align: "center", fontFace: F });
    s.addText(st.d, { x: x + 0.15, y: y + 0.85, w: cw - 0.3, h: 0.5, fontSize: 10.5, color: C.TEXT, align: "center", fontFace: F });
    if (i < steps.length - 1) arrow(s, x + cw + 0.01, y + ch / 2, gx - 0.02, C.MUTED);
  });
  // feedback loop arrow
  arrow(s, x0 + 4 * (cw + gx) + cw / 2, y + ch + 0.15, 0.001, C.MUTED);
  s.addShape(pres.shapes.LINE, { x: x0 + 4 * (cw + gx) + cw / 2, y: y + ch + 0.15, w: -(4 * (cw + gx) + cw / 2 - (x0 + cw / 2)), h: 0, line: { color: C.MUTED, width: 1.5, dashType: "dash", beginArrowType: "triangle", endArrowType: "triangle" } });
  s.addText("FAIL 回退重构建", { x: x0 + 1.2, y: y + ch + 0.2, w: 4, h: 0.3, fontSize: 9.5, color: C.MUTED, fontFace: F });

  // left stats card
  card(s, 0.7, 3.9, 4.0, 2.5, C.ACCENT);
  s.addShape(pres.shapes.RECTANGLE, { x: 0.7, y: 3.9, w: 0.09, h: 2.5, fill: { color: C.ACCENT } });
  s.addText("构建要点", { x: 1.0, y: 4.05, w: 3.5, h: 0.4, fontSize: 14.5, bold: true, color: C.PRIMARY, fontFace: F });
  s.addText([
    { text: "拼接：meta.js + core.js(开 IIFE) + takeover → sites → plugins → presentation + })();", options: { bullet: true, breakLine: true } },
    { text: "main-loop 为 takeover 域内末位，整体末位为 IIFE 闭合", options: { bullet: true, breakLine: true } },
    { text: "卡控：node --check + _sim 回归（ninja / quiz-vision / zh-exam / popup-block）", options: { bullet: true } },
  ], { x: 1.0, y: 4.5, w: 3.5, h: 1.8, fontSize: 10.5, color: C.TEXT, fontFace: F, lineSpacingMultiple: 1.15, paraSpaceAfter: 6, valign: "top" });

  // right chart: module distribution
  card(s, 5.0, 3.9, 7.7, 2.5, "5B8DEF");
  s.addShape(pres.shapes.RECTANGLE, { x: 5.0, y: 3.9, w: 0.09, h: 2.5, fill: { color: "5B8DEF" } });
  s.addText("源码模块分布（按层）", { x: 5.3, y: 4.0, w: 7, h: 0.4, fontSize: 14.5, bold: true, color: C.PRIMARY, fontFace: F });
  s.addChart(pres.charts.BAR, [{
    name: "模块数", labels: ["接管层", "站点适配", "插件工具库", "表现层", "外部平台"], values: [24, 12, 7, 13, 12],
  }], {
    x: 5.2, y: 4.35, w: 7.3, h: 1.95, barDir: "col",
    chartColors: [C.ACCENT, C.ACCENT2, "5B8DEF", "9B6DD6", "E25C7A"],
    chartArea: { fill: { color: "FFFFFF" } },
    catAxisLabelColor: "64748B", valAxisLabelColor: "64748B",
    valGridLine: { color: "E2E8F0", size: 0.5 }, catGridLine: { style: "none" },
    showValue: true, dataLabelPosition: "outEnd", dataLabelColor: "1E293B", dataLabelFontSize: 10,
    showLegend: false, showTitle: false,
  });
  footer(s, 16);
})();

// ============================================================
// Slide 17 — 总结
// ============================================================
(() => {
  const s = pres.addSlide();
  bg(s, C.DARK);
  s.addShape(pres.shapes.OVAL, { x: -2.0, y: 4.5, w: 6.5, h: 6.5, fill: { color: C.ACCENT, transparency: 84 } });
  s.addShape(pres.shapes.OVAL, { x: 11.0, y: -2.0, w: 4.5, h: 4.5, fill: { color: C.ACCENT2, transparency: 86 } });
  s.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: 0.18, h: H, fill: { color: C.ACCENT } });

  s.addText("总结", { x: 1.0, y: 1.1, w: 11, h: 0.5, fontSize: 16, color: C.ACCENT, charSpacing: 3, bold: true, fontFace: F });
  s.addText("一套可扩展的网课自动化接管系统", { x: 1.0, y: 1.55, w: 11.3, h: 1.0, fontSize: 38, bold: true, color: "FFFFFF", fontFace: F });

  const pts = [
    ["分层清晰", "接管 / 站点 / 插件 / 表现 / 外部 五层 + 构建验证，边界明确、职责单一。"],
    ["站点隔离", "detectSite 为唯一事实源，新平台零改核心引擎，适配成本极低。"],
    ["答案可插拔", "random/bank/ai/deepseek-web 可切换，严格 AI 模式保正确率。"],
    ["抗混淆 + 隐私", "视觉对抗以截图为准；外部 CDN 须显式授权，隐私优先。"],
    ["鲁棒 & 可验证", "多 iframe 自愈、内存护栏、增量 diff；_sim 31+ 用例守护每次构建。"],
  ];
  const cw = 2.35, gx = 0.2, x0 = 1.0, y = 3.0;
  pts.forEach((p, i) => {
    const x = x0 + i * (cw + gx);
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w: cw, h: 2.4, rectRadius: 0.08, fill: { color: C.DARK2 }, line: { color: "2A3C63", width: 1 } });
    s.addShape(pres.shapes.OVAL, { x: x + cw / 2 - 0.3, y: y + 0.28, w: 0.6, h: 0.6, fill: { color: C.ACCENT } });
    s.addText(String(i + 1), { x: x + cw / 2 - 0.3, y: y + 0.28, w: 0.6, h: 0.6, fontSize: 20, bold: true, color: "FFFFFF", align: "center", valign: "middle", fontFace: F });
    s.addText(p[0], { x: x + 0.15, y: y + 1.0, w: cw - 0.3, h: 0.4, fontSize: 13.5, bold: true, color: C.ACCENT, align: "center", fontFace: F });
    s.addText(p[1], { x: x + 0.2, y: y + 1.42, w: cw - 0.4, h: 0.9, fontSize: 10, color: C.ICE, align: "center", fontFace: F, lineSpacingMultiple: 1.15, valign: "top" });
  });

  s.addText("apps/userscript/src/chaoxing-force-play  ·  services/perception/  ·  scripts/build.ps1  ·  apps/userscript/_sim", { x: 1.0, y: 6.4, w: 11.3, h: 0.4, fontSize: 11, color: "8FA3C8", fontFace: "Consolas" });
})();

pres.writeFile({ fileName: projectPaths.writableFile(process.argv[2] || path.join(projectPaths.outputRoot, '网课强制续播系统-架构与设计.pptx')) }).then((fn) => {
  console.log("Saved:", fn);
}).catch(err => { console.error(err); process.exitCode = 1; });
