const path = require('path');
const projectPaths = require('./project-paths.cjs');
const PptxGenJS = require("pptxgenjs");

const T = {
  color: {
    bg: "FAFAFA", surface: "FFFFFF", ink: "1A1A2E", muted: "5A5A72", faint: "9A9AB0",
    accent: "1657D6", accentLight: "E8F0FE", accentDark: "0B3D91",
    positive: "16A34A", positiveLight: "DCFCE7", caution: "D97706", cautionLight: "FEF3C7",
    risk: "DC2626", riskLight: "FEE2E2", hairline: "D5D5E0",
    dark: "1A1A2E", darkSurface: "252540", darkAccent: "3D5AFE", codeBg: "F0F4F8",
  },
  font: { cn: "Microsoft YaHei", en: "Segoe UI", mono: "Consolas" },
  size: { deckTitle: 36, title: 26, claim: 18, sectionLabel: 10, body: 12, small: 10, annotation: 9, source: 8, metric: 28, label: 11 },
};

const W = 13.33, H = 7.5, M = 0.65;

function addHeader(slide, sectionLabel, pageNum) {
  slide.addText(sectionLabel.toUpperCase(), { x: M, y: 0.3, w: 3, h: 0.3, fontFace: T.font.en, fontSize: T.size.sectionLabel, color: T.color.faint, bold: true, charSpacing: 2 });
  if (pageNum) {
    slide.addText(String(pageNum).padStart(2, "0"), { x: W - M - 0.5, y: 0.3, w: 0.5, h: 0.3, fontFace: T.font.en, fontSize: T.size.sectionLabel, color: T.color.faint, bold: true, align: "right" });
  }
  slide.addShape("line", { x: M, y: 0.68, w: W - M * 2, h: 0, line: { color: T.color.hairline, width: 0.75 } });
}

function addFooter(slide) {
  slide.addText("网课强制续播系统 · chaoxing-force-play", { x: M, y: H - 0.4, w: 5, h: 0.25, fontFace: T.font.cn, fontSize: T.size.source, color: T.color.faint });
  slide.addText("MIT License · 仅供技术学习", { x: W - M - 4, y: H - 0.4, w: 4, h: 0.25, fontFace: T.font.cn, fontSize: T.size.source, color: T.color.faint, align: "right" });
}

function addTitle(slide, title) {
  slide.addText(title, { x: M, y: 0.95, w: W - M * 2, h: 0.6, fontFace: T.font.cn, fontSize: T.size.title, color: T.color.ink, bold: true });
  slide.addShape("rect", { x: M, y: 1.55, w: 0.5, h: 0.04, fill: { color: T.color.accent }, line: { type: "none" } });
}

function contentPage(pres, sectionLabel, title, pageNum) {
  const slide = pres.addSlide();
  slide.background = { fill: T.color.bg };
  addHeader(slide, sectionLabel, pageNum);
  addTitle(slide, title);
  addFooter(slide);
  return slide;
}

function addCard(slide, x, y, w, h, opts) {
  opts = opts || {};
  slide.addShape("roundRect", { x, y, w, h, fill: { color: opts.fill || T.color.surface }, line: { color: opts.border || T.color.hairline, width: 0.75 }, rectRadius: 0.06, shadow: opts.shadow ? { type: "outer", color: "00000020", blur: 3, offset: { x: 0, y: 1 } } : undefined });
  if (opts.accent) {
    slide.addShape("roundRect", { x, y, w: 0.06, h, fill: { color: opts.accent }, line: { type: "none" }, rectRadius: 0.03 });
  }
}

function buildDeck() {
  const pres = new PptxGenJS();
  pres.defineLayout({ name: "WIDE", width: W, height: H });
  pres.layout = "WIDE";
  pres.author = "TraeDesign";
  pres.company = "chaoxing-force-play";
  pres.subject = "网课强制续播系统 · 项目介绍";

  // SLIDE 1: Cover
  {
    const s = pres.addSlide();
    s.background = { fill: T.color.dark };
    s.addShape("rect", { x: 0, y: 0, w: 0.08, h: H, fill: { color: T.color.darkAccent }, line: { type: "none" } });
    s.addShape("ellipse", { x: W - 3, y: H - 3, w: 5, h: 5, fill: { color: T.color.darkSurface }, line: { type: "none" } });
    s.addShape("ellipse", { x: W - 2, y: H - 2, w: 3, h: 3, fill: { color: "2A2A50" }, line: { type: "none" } });
    s.addText("PROJECT OVERVIEW", { x: M + 0.3, y: 1.2, w: 4, h: 0.35, fontFace: T.font.en, fontSize: T.size.sectionLabel, color: T.color.darkAccent, bold: true, charSpacing: 3 });
    s.addText("网课强制续播系统", { x: M + 0.3, y: 1.7, w: 10, h: 1.0, fontFace: T.font.cn, fontSize: 44, color: "FFFFFF", bold: true });
    s.addText("浏览器用户脚本 + 本地感知层", { x: M + 0.3, y: 2.75, w: 10, h: 0.5, fontFace: T.font.cn, fontSize: 20, color: "A0A0C0" });
    s.addText("强制续播 · 防暂停 · 自动答题 · 主控面板 · 跨平台站点适配", { x: M + 0.3, y: 3.35, w: 10, h: 0.4, fontFace: T.font.cn, fontSize: 13, color: "707090" });
    s.addShape("line", { x: M + 0.3, y: 5.5, w: 4, h: 0, line: { color: "3D5AFE", width: 1.5 } });
    s.addText([{ text: "架构层级  ", options: { color: "606080", fontSize: 10 } }, { text: "三层", options: { color: "FFFFFF", fontSize: 10, bold: true } }, { text: "    能力域  ", options: { color: "606080", fontSize: 10 } }, { text: "4 域 / 56 模块", options: { color: "FFFFFF", fontSize: 10, bold: true } }, { text: "    支持平台  ", options: { color: "606080", fontSize: 10 } }, { text: "9+", options: { color: "FFFFFF", fontSize: 10, bold: true } }], { x: M + 0.3, y: 5.7, w: 10, h: 0.3, fontFace: T.font.cn });
    s.addText("MIT License · 仅供技术学习与个人自动化研究", { x: M + 0.3, y: 6.4, w: 10, h: 0.3, fontFace: T.font.cn, fontSize: 9, color: "505070" });
  }

  // SLIDE 2: 项目定位
  {
    const s = contentPage(pres, "01 · 项目定位", "它是什么", 2);
    const cx = M + 0.1, cw = W - M * 2 - 0.2;
    addCard(s, cx, 1.95, cw, 1.1, { accent: T.color.accent, shadow: true });
    s.addText("一个注入到网课页面主世界的浏览器用户脚本（Tampermonkey / Violentmonkey），配合本地 Python 爬虫，在多平台上实现强制续播、防暂停、自动答题与主控面板。", { x: cx + 0.25, y: 2.05, w: cw - 0.5, h: 0.9, fontFace: T.font.cn, fontSize: T.size.body, color: T.color.ink, valign: "middle" });
    const colW = (cw - 0.4) / 3;
    const items = [{ label: "构建", desc: "scripts/build.ps1\n拼接 56 个源模块为\n单个 .user.js", accent: T.color.accent }, { label: "测试", desc: "56 个仿真回归\n+ 纯函数单测\n+ 构建门禁", accent: T.color.positive }, { label: "发布", desc: "CI 自动构建\nGitHub Releases\n附 commit SHA", accent: T.color.caution }];
    items.forEach((item, i) => {
      const x = cx + i * (colW + 0.2);
      addCard(s, x, 3.35, colW, 1.5, { border: T.color.hairline });
      s.addShape("rect", { x, y: 3.35, w: colW, h: 0.05, fill: { color: item.accent }, line: { type: "none" } });
      s.addText(item.label, { x: x + 0.2, y: 3.5, w: colW - 0.4, h: 0.35, fontFace: T.font.cn, fontSize: 14, color: item.accent, bold: true });
      s.addText(item.desc, { x: x + 0.2, y: 3.9, w: colW - 0.4, h: 0.85, fontFace: T.font.cn, fontSize: T.size.body, color: T.color.muted, lineSpacingMultiple: 1.3 });
    });
    const feats = ["✦ 零运行时依赖：单文件 IIFE，不依赖任何外部 npm 包", "✦ 站点隔离：detectSite() 统一识别，新增平台不动核心引擎", "✦ 可卸载：uninstall() 完整还原页面到注入前状态"];
    feats.forEach((f, i) => { s.addText(f, { x: cx, y: 5.15 + i * 0.32, w: cw, h: 0.28, fontFace: T.font.cn, fontSize: T.size.small, color: T.color.muted }); });
  }

  // SLIDE 3: 三层架构
  {
    const s = contentPage(pres, "02 · 架构总览", "三层架构 · 各司其职", 3);
    const tx = M + 0.05, tw = W - M * 2 - 0.1;
    const hdrH = 0.45, col1W = 1.3, col2W = 2.0, col3W = tw - col1W - col2W;
    s.addShape("rect", { x: tx, y: 2.0, w: tw, h: hdrH, fill: { color: T.color.dark }, line: { type: "none" } });
    s.addText("层", { x: tx + 0.15, y: 2.0, w: col1W, h: hdrH, fontFace: T.font.cn, fontSize: T.size.body, color: "FFFFFF", bold: true, valign: "middle" });
    s.addText("目录", { x: tx + col1W + 0.15, y: 2.0, w: col2W, h: hdrH, fontFace: T.font.en, fontSize: T.size.body, color: "FFFFFF", bold: true, valign: "middle" });
    s.addText("职责", { x: tx + col1W + col2W + 0.15, y: 2.0, w: col3W, h: hdrH, fontFace: T.font.cn, fontSize: T.size.body, color: "FFFFFF", bold: true, valign: "middle" });
    const rows = [{ layer: "生态层", dir: "apps/userscript/", desc: "唯一交付物 chaoxing-force-play.user.js（单文件、零运行时依赖）。由 src/ 按 4 个能力域 56 个源模块构建拼接；含跨进程桥（127.0.0.1:7531）与 postMessage 协议。", accent: T.color.accent }, { layer: "感知层", dir: "services/perception/", desc: "Python cx_crawler 爬虫：本地 HTTP 桥提供权威章节清单 / 媒体采集 / DeepSeek 应答端（自动答题 AI）。可选组件，不装也能跑基础续播。", accent: T.color.positive }, { layer: "文档层", dir: "docs/", desc: "规则文档（改码前必读：架构红线 / 契约 / 选择器校准）与历史文档（设计稿 / 评审快照 / 变更史）分离管理。", accent: T.color.caution }];
    const rowH = 1.25;
    rows.forEach((r, i) => {
      const ry = 2.0 + hdrH + i * rowH;
      const fillC = i % 2 === 0 ? T.color.surface : T.color.codeBg;
      s.addShape("rect", { x: tx, y: ry, w: tw, h: rowH, fill: { color: fillC }, line: { color: T.color.hairline, width: 0.5 } });
      s.addShape("rect", { x: tx, y: ry, w: 0.06, h: rowH, fill: { color: r.accent }, line: { type: "none" } });
      s.addText(r.layer, { x: tx + 0.2, y: ry, w: col1W - 0.2, h: rowH, fontFace: T.font.cn, fontSize: 14, color: r.accent, bold: true, valign: "middle" });
      s.addText(r.dir, { x: tx + col1W + 0.15, y: ry, w: col2W, h: rowH, fontFace: T.font.mono, fontSize: 10, color: T.color.muted, valign: "middle" });
      s.addText(r.desc, { x: tx + col1W + col2W + 0.15, y: ry, w: col3W - 0.3, h: rowH, fontFace: T.font.cn, fontSize: T.size.small, color: T.color.ink, valign: "middle", lineSpacingMultiple: 1.25 });
    });
  }

  // SLIDE 4: 核心能力
  {
    const s = contentPage(pres, "03 · 核心能力", "四大核心能力", 4);
    const gx = M + 0.05, gw = W - M * 2 - 0.1, cardW = (gw - 0.3) / 2, cardH = 1.95;
    const caps = [{ icon: "▶", title: "强制续播", accent: T.color.accent, desc: "接管视频播放事件与属性，中和平台反挂机检测：静音劫持还原、暂停按钮禁用解除、1x 速率限制绕过、水印隐藏。播放结束后自动跳下一节。" }, { icon: "✓", title: "智能答题", accent: T.color.positive, desc: "对作业 / 章节 / 考试题做真答题：抓题干+选项，经可插拔答案源（random / bank / ai / deepseek-web）求答案回填。弹窗题则随机作答+删弹窗消除干扰。" }, { icon: "◉", title: "视觉对抗", accent: T.color.caution, desc: "平台对题干做同形字 / 字体映射 / Canvas 混淆时，DOM textContent 不可信。截图后经 OCR 或多模态 AI 还原真实文本再作答。" }, { icon: "⇄", title: "外部联动", accent: T.color.risk, desc: "本地 Python 爬虫接收浏览器侧采集数据，提供权威章节清单；可将题库回灌给答题引擎，实现精确跳到下一未完成章节等增强能力。" }];
    caps.forEach((c, i) => {
      const col = i % 2, row = Math.floor(i / 2);
      const x = gx + col * (cardW + 0.3), y = 1.95 + row * (cardH + 0.25);
      addCard(s, x, y, cardW, cardH, { accent: c.accent, shadow: true });
      s.addShape("ellipse", { x: x + 0.25, y: y + 0.25, w: 0.5, h: 0.5, fill: { color: c.accent }, line: { type: "none" } });
      s.addText(c.icon, { x: x + 0.25, y: y + 0.25, w: 0.5, h: 0.5, fontFace: T.font.en, fontSize: 16, color: "FFFFFF", bold: true, align: "center", valign: "middle" });
      s.addText(c.title, { x: x + 0.9, y: y + 0.22, w: cardW - 1.1, h: 0.55, fontFace: T.font.cn, fontSize: 16, color: T.color.ink, bold: true, valign: "middle" });
      s.addText(c.desc, { x: x + 0.25, y: y + 0.85, w: cardW - 0.5, h: 1.0, fontFace: T.font.cn, fontSize: T.size.small, color: T.color.muted, lineSpacingMultiple: 1.3 });
    });
  }

  // SLIDE 5: 支持平台
  {
    const s = contentPage(pres, "04 · 平台覆盖", "支持平台 · 9+ 站点", 5);
    const platforms = [{ name: "超星学习通", note: "含学银在线", code: "chaoxing-exam" }, { name: "智慧树 / 知到", note: "含作业/考试答题页", code: "zhihuishu" }, { name: "中国大学 MOOC", note: "爱课程 / icourse163", code: "icourse163" }, { name: "学堂在线", note: "xuetangx", code: "xuetangx" }, { name: "智慧职教", note: "ICVE", code: "icve" }, { name: "实验空间", note: "ilabx", code: "ilabx" }, { name: "人卫", note: "renwei", code: "renwei" }, { name: "随行课堂", note: "Unipus", code: "unipus" }, { name: "U 校园", note: "ucampus", code: "ucampus" }];
    const gx = M + 0.05, gw = W - M * 2 - 0.1, cols = 3, gap = 0.2, cardW = (gw - gap * (cols - 1)) / cols, cardH = 1.05;
    platforms.forEach((p, i) => {
      const col = i % cols, row = Math.floor(i / cols);
      const x = gx + col * (cardW + gap), y = 1.95 + row * (cardH + 0.18);
      addCard(s, x, y, cardW, cardH, { border: T.color.hairline });
      s.addShape("rect", { x, y, w: 0.06, h: cardH, fill: { color: T.color.accent }, line: { type: "none" } });
      s.addText(p.name, { x: x + 0.2, y: y + 0.12, w: cardW - 0.35, h: 0.35, fontFace: T.font.cn, fontSize: 13, color: T.color.ink, bold: true });
      s.addText(p.note, { x: x + 0.2, y: y + 0.48, w: cardW - 0.35, h: 0.25, fontFace: T.font.cn, fontSize: T.size.annotation, color: T.color.faint });
      s.addText(p.code, { x: x + 0.2, y: y + 0.72, w: cardW - 0.35, h: 0.25, fontFace: T.font.mono, fontSize: 8, color: T.color.accent });
    });
    s.addShape("rect", { x: gx, y: 5.55, w: gw, h: 0.5, fill: { color: T.color.accentLight }, line: { type: "none" } });
    s.addText("新增平台 = 新增 sites/*.js + 在 SITES 配置表登记，不动核心引擎逻辑", { x: gx + 0.2, y: 5.55, w: gw - 0.4, h: 0.5, fontFace: T.font.cn, fontSize: T.size.small, color: T.color.accentDark, bold: true, valign: "middle" });
  }

  // SLIDE 6: 四大能力域
  {
    const s = contentPage(pres, "05 · 代码结构", "四大能力域 · 56 个源模块", 6);
    const gx = M + 0.05, gw = W - M * 2 - 0.1, cols = 4, gap = 0.18, cardW = (gw - gap * (cols - 1)) / cols, cardH = 3.2;
    const domains = [{ name: "takeover", cn: "接管域", count: "28 模块", accent: T.color.accent, desc: "站点无关的核心引擎", items: ["foundation/ 基础能力", "engine/ 引擎", "dom/ DOM 接管", "bootstrap/ 主循环", "meta.js 入口引导"] }, { name: "sites", cn: "站点域", count: "12 模块", accent: T.color.positive, desc: "各平台专属逻辑", items: ["chaoxing-exam", "zhihuishu / zhihuishu-exam", "icourse163 / xuetangx", "icve / ilabx / renwei", "unipus / ucampus", "popup-quiz / quiz-selectors"] }, { name: "plugins", cn: "插件域", count: "7 模块", accent: T.color.caution, desc: "工具库 / 扩展项", items: ["registry.js 注册中心", "auto-next 自动下一节", "keyboard-shortcuts 快捷键", "tamper-guard 防篡改", "quiet-popups 静默弹窗", "video-ended-notify"] }, { name: "presentation", cn: "呈现域", count: "13 模块", accent: T.color.risk, desc: "面板 / 诊断 / 洞察", items: ["panel.js 主控面板", "panel-core / panel-drag", "panel-template 场景自适应", "dashboard 仪表盘", "diagnostics 诊断", "toast / styles"] }];
    domains.forEach((d, i) => {
      const x = gx + i * (cardW + gap), y = 1.95;
      addCard(s, x, y, cardW, cardH, { border: T.color.hairline });
      s.addShape("rect", { x, y, w: cardW, h: 0.06, fill: { color: d.accent }, line: { type: "none" } });
      s.addText(d.name, { x: x + 0.15, y: y + 0.18, w: cardW - 0.3, h: 0.3, fontFace: T.font.mono, fontSize: 13, color: d.accent, bold: true });
      s.addText(d.cn, { x: x + 0.15, y: y + 0.48, w: cardW - 0.3, h: 0.28, fontFace: T.font.cn, fontSize: 14, color: T.color.ink, bold: true });
      s.addText(d.count, { x: x + 0.15, y: y + 0.76, w: cardW - 0.3, h: 0.25, fontFace: T.font.en, fontSize: T.size.annotation, color: T.color.faint });
      s.addShape("line", { x: x + 0.15, y: y + 1.08, w: cardW - 0.3, h: 0, line: { color: T.color.hairline, width: 0.5 } });
      s.addText(d.desc, { x: x + 0.15, y: y + 1.15, w: cardW - 0.3, h: 0.3, fontFace: T.font.cn, fontSize: T.size.annotation, color: T.color.muted, bold: true });
      d.items.forEach((item, j) => { s.addText("· " + item, { x: x + 0.15, y: y + 1.5 + j * 0.27, w: cardW - 0.3, h: 0.24, fontFace: T.font.mono, fontSize: 8.5, color: T.color.muted }); });
    });
  }

  // SLIDE 7: 架构分层图
  {
    const s = contentPage(pres, "06 · 系统架构", "分层架构与数据流", 7);
    const gx = M + 0.1, gw = W - M * 2 - 0.2;
    const hostX = gx, hostY = 2.0, hostW = gw, hostH = 3.6;
    s.addShape("roundRect", { x: hostX, y: hostY, w: hostW, h: hostH, fill: { color: T.color.codeBg }, line: { color: T.color.hairline, width: 1 }, rectRadius: 0.08 });
    s.addText("宿主页面（多平台 / 多 iframe / 跨域嵌入）", { x: hostX + 0.15, y: hostY + 0.1, w: hostW - 0.3, h: 0.3, fontFace: T.font.cn, fontSize: T.size.annotation, color: T.color.faint, bold: true });
    const tkX = hostX + 0.2, tkY = hostY + 0.5, tkW = hostW * 0.55, tkH = 2.5;
    s.addShape("roundRect", { x: tkX, y: tkY, w: tkW, h: tkH, fill: { color: T.color.accentLight }, line: { color: T.color.accent, width: 1 }, rectRadius: 0.06 });
    s.addText("takeover/  接管层（IIFE 包装）", { x: tkX + 0.15, y: tkY + 0.08, w: tkW - 0.3, h: 0.28, fontFace: T.font.cn, fontSize: T.size.annotation, color: T.color.accentDark, bold: true });
    const fY = tkY + 0.42;
    s.addShape("roundRect", { x: tkX + 0.15, y: fY, w: tkW - 0.3, h: 0.45, fill: { color: "FFFFFF" }, line: { color: T.color.accent, width: 0.75 }, rectRadius: 0.04 });
    s.addText("foundation/  state · storage · config · site-router · utils · error-guard", { x: tkX + 0.25, y: fY, w: tkW - 0.5, h: 0.45, fontFace: T.font.mono, fontSize: 8, color: T.color.ink, valign: "middle" });
    const eY = fY + 0.55;
    s.addShape("roundRect", { x: tkX + 0.15, y: eY, w: tkW - 0.3, h: 0.45, fill: { color: "FFFFFF" }, line: { color: T.color.accent, width: 0.75 }, rectRadius: 0.04 });
    s.addText("engine/  bridge · quiz · quiz-vision · playback · policy · foreground", { x: tkX + 0.25, y: eY, w: tkW - 0.5, h: 0.45, fontFace: T.font.mono, fontSize: 8, color: T.color.ink, valign: "middle" });
    const dY = eY + 0.55;
    s.addShape("roundRect", { x: tkX + 0.15, y: dY, w: tkW - 0.3, h: 0.45, fill: { color: "FFFFFF" }, line: { color: T.color.accent, width: 0.75 }, rectRadius: 0.04 });
    s.addText("dom/  selectorOverrides · overrideVideo · observers · lifecycle", { x: tkX + 0.25, y: dY, w: tkW - 0.5, h: 0.45, fontFace: T.font.mono, fontSize: 8, color: T.color.ink, valign: "middle" });
    const bY = dY + 0.55;
    s.addShape("roundRect", { x: tkX + 0.15, y: bY, w: tkW - 0.3, h: 0.45, fill: { color: T.color.accentDark }, line: { type: "none" }, rectRadius: 0.04 });
    s.addText("bootstrap/main-loop.js  主循环·状态机", { x: tkX + 0.25, y: bY, w: tkW - 0.5, h: 0.45, fontFace: T.font.mono, fontSize: 9, color: "FFFFFF", valign: "middle", bold: true });
    const rX = tkX + tkW + 0.2, rW = hostW - (rX - hostX) - 0.2;
    const rDomains = [{ name: "sites/", desc: "12 个站点适配\nchaoxing · zhihuishu\nicourse163 · xuetangx ...", fill: T.color.positiveLight, border: T.color.positive, txt: T.color.positive }, { name: "plugins/", desc: "registry + 6 个 addons\nauto-next · tamper-guard\nkeyboard-shortcuts ...", fill: T.color.cautionLight, border: T.color.caution, txt: T.color.caution }, { name: "presentation/", desc: "13 个面板/诊断模块\npanel · dashboard\ndiagnostics · toast ...", fill: T.color.riskLight, border: T.color.risk, txt: T.color.risk }];
    rDomains.forEach((d, i) => {
      const dy = tkY + i * 0.85;
      s.addShape("roundRect", { x: rX, y: dy, w: rW, h: 0.75, fill: { color: d.fill }, line: { color: d.border, width: 0.75 }, rectRadius: 0.04 });
      s.addText(d.name, { x: rX + 0.12, y: dy + 0.05, w: rW - 0.24, h: 0.25, fontFace: T.font.mono, fontSize: 9, color: d.txt, bold: true });
      s.addText(d.desc, { x: rX + 0.12, y: dy + 0.28, w: rW - 0.24, h: 0.45, fontFace: T.font.cn, fontSize: 7.5, color: T.color.muted, lineSpacingMultiple: 1.1 });
    });
    const extY = hostY + hostH + 0.2, extW = (gw - 0.4) / 3;
    const exts = [{ label: "services/perception/cx_crawler/", desc: "Python 爬虫 · 本地 HTTP 桥", accent: T.color.positive }, { label: "chat.deepseek.com", desc: "DeepSeek 网页版应答端", accent: T.color.accent }, { label: "外部 CDN", desc: "html2canvas · tesseract", accent: T.color.caution }];
    exts.forEach((e, i) => {
      const ex = gx + i * (extW + 0.2);
      s.addShape("roundRect", { x: ex, y: extY, w: extW, h: 0.55, fill: { color: T.color.surface }, line: { color: e.accent, width: 1, dashType: "dash" }, rectRadius: 0.04 });
      s.addText(e.label, { x: ex + 0.1, y: extY + 0.04, w: extW - 0.2, h: 0.25, fontFace: T.font.mono, fontSize: 9, color: e.accent, bold: true });
      s.addText(e.desc, { x: ex + 0.1, y: extY + 0.28, w: extW - 0.2, h: 0.22, fontFace: T.font.cn, fontSize: 8, color: T.color.muted });
    });
    const bldY = extY + 0.75;
    s.addShape("roundRect", { x: gx, y: bldY, w: gw, h: 0.45, fill: { color: T.color.dark }, line: { type: "none" }, rectRadius: 0.04 });
    s.addText("scripts/build.ps1  模块拼接 → chaoxing-force-play.user.js  →  apps/userscript/_sim/ 沙箱仿真回归", { x: gx + 0.15, y: bldY, w: gw - 0.3, h: 0.45, fontFace: T.font.mono, fontSize: 9, color: "FFFFFF", valign: "middle", bold: true });
  }

  // SLIDE 8: 续播防护流
  {
    const s = contentPage(pres, "07 · 核心数据流", "续播防护流 · 超星 / 学银 / MOOC 主场景", 8);
    const fy = 2.1, fh = 0.6, fx = M + 0.5, fw = W - M * 2 - 1;
    const steps = [{ label: "扫描到 video", desc: "_pqQueryAll", w: 2.2, color: T.color.accent }, { label: "overrideVideo", desc: "接管事件/属性", w: 2.2, color: T.color.accent }, { label: "站内中立化", desc: "静音·取消暂停·强制play\n1x速率·隐藏水印", w: 2.6, color: T.color.positive }, { label: "检测 ended?", desc: "播放结束判定", w: 1.8, color: T.color.caution }];
    let curX = fx;
    steps.forEach((st, i) => {
      s.addShape("roundRect", { x: curX, y: fy, w: st.w, h: fh, fill: { color: T.color.surface }, line: { color: st.color, width: 1.25 }, rectRadius: 0.04 });
      s.addShape("rect", { x: curX, y: fy, w: 0.06, h: fh, fill: { color: st.color }, line: { type: "none" } });
      s.addText(st.label, { x: curX + 0.15, y: fy + 0.05, w: st.w - 0.25, h: 0.25, fontFace: T.font.mono, fontSize: 9, color: st.color, bold: true });
      s.addText(st.desc, { x: curX + 0.15, y: fy + 0.28, w: st.w - 0.25, h: 0.3, fontFace: T.font.cn, fontSize: 8, color: T.color.muted, lineSpacingMultiple: 1.1 });
      if (i < steps.length - 1) { s.addShape("rightArrow", { x: curX + st.w + 0.02, y: fy + fh / 2 - 0.08, w: 0.22, h: 0.16, fill: { color: T.color.faint }, line: { type: "none" } }); }
      curX += st.w + 0.24;
    });
    const branchY = fy + fh + 0.35;
    s.addShape("roundRect", { x: fx + 5.2, y: branchY, w: 2.4, h: 0.55, fill: { color: T.color.riskLight }, line: { color: T.color.risk, width: 1 }, rectRadius: 0.04 });
    s.addText("弹窗干扰?", { x: fx + 5.35, y: branchY + 0.03, w: 2.1, h: 0.25, fontFace: T.font.cn, fontSize: 10, color: T.color.risk, bold: true });
    s.addText("popupQuizTick 随机作答 + 删弹窗", { x: fx + 5.35, y: branchY + 0.27, w: 2.1, h: 0.22, fontFace: T.font.mono, fontSize: 7.5, color: T.color.muted });
    s.addShape("roundRect", { x: fx + 2.4, y: branchY, w: 2.4, h: 0.55, fill: { color: T.color.positiveLight }, line: { color: T.color.positive, width: 1 }, rectRadius: 0.04 });
    s.addText("自动下一节", { x: fx + 2.55, y: branchY + 0.03, w: 2.1, h: 0.25, fontFace: T.font.cn, fontSize: 10, color: T.color.positive, bold: true });
    s.addText("站点 nextUrl / auto-next 插件", { x: fx + 2.55, y: branchY + 0.27, w: 2.1, h: 0.22, fontFace: T.font.mono, fontSize: 7.5, color: T.color.muted });
    s.addShape("roundRect", { x: fx, y: branchY, w: 2.1, h: 0.55, fill: { color: T.color.codeBg }, line: { color: T.color.faint, width: 1 }, rectRadius: 0.04 });
    s.addText("持续保活轮询", { x: fx + 0.15, y: branchY + 0.03, w: 1.8, h: 0.25, fontFace: T.font.cn, fontSize: 10, color: T.color.muted, bold: true });
    s.addText("main-loop tick ~2s", { x: fx + 0.15, y: branchY + 0.27, w: 1.8, h: 0.22, fontFace: T.font.mono, fontSize: 7.5, color: T.color.faint });
    const notes = ["▸ overrideVideo: 事件 + 属性劫持，接管 play/pause/rate，mediaSession 接管", "▸ 中和策略 (policy.js): 静音劫持还原、暂停禁用解除、速率限制绕过、水印隐藏", "▸ 增量 diff 优化: _quizDirtyGen 由 MutationObserver 递增，稳态零重算 textContent"];
    notes.forEach((n, i) => { s.addText(n, { x: M, y: 4.3 + i * 0.35, w: W - M * 2, h: 0.3, fontFace: T.font.cn, fontSize: T.size.small, color: T.color.muted }); });
    s.addShape("roundRect", { x: M, y: 5.5, w: W - M * 2, h: 0.55, fill: { color: T.color.accentLight }, line: { type: "none" }, rectRadius: 0.04 });
    s.addText("温和/礼貌模式: INTRUSION_MODE (auto/gentle/aggressive) + POLITE_MODE 伪装 toString() 规避平台反篡改扫描", { x: M + 0.2, y: 5.5, w: W - M * 2 - 0.4, h: 0.55, fontFace: T.font.cn, fontSize: T.size.small, color: T.color.accentDark, bold: true, valign: "middle" });
  }

  // SLIDE 9: 真答题流
  {
    const s = contentPage(pres, "08 · 核心数据流", "真答题流 · 含视觉对抗", 9);
    const lx = M + 0.15, lw = 5.2;
    const nodes = [{ label: "quizTick(sel)", desc: "站点无关真答题引擎入口", color: T.color.accent, y: 1.95 }, { label: "抓题干/选项", desc: "selector 并集 · best-effort 全量查询", color: T.color.accent, y: 2.55 }, { label: "指纹去重 _quizHandled", desc: "指纹生成/查询/淘汰 · 站点无关", color: T.color.caution, y: 3.15 }, { label: "题目文本被混淆?", desc: "同形字 / 字体映射 / Canvas 混淆", color: T.color.caution, y: 3.75 }, { label: "答案源求答案", desc: "random(兜底) / bank(题库) / ai(端点) / deepseek-web", color: T.color.positive, y: 4.5 }, { label: "回填选项 → 二次确认提交", desc: "严格 AI 模式失败则停下报错，不随机兜底", color: T.color.risk, y: 5.15 }];
    nodes.forEach((n, i) => {
      s.addShape("roundRect", { x: lx, y: n.y, w: lw, h: 0.48, fill: { color: T.color.surface }, line: { color: n.color, width: 1 }, rectRadius: 0.04 });
      s.addShape("rect", { x: lx, y: n.y, w: 0.06, h: 0.48, fill: { color: n.color }, line: { type: "none" } });
      s.addText(n.label, { x: lx + 0.18, y: n.y + 0.03, w: lw - 0.3, h: 0.22, fontFace: T.font.mono, fontSize: 9, color: n.color, bold: true });
      s.addText(n.desc, { x: lx + 0.18, y: n.y + 0.25, w: lw - 0.3, h: 0.2, fontFace: T.font.cn, fontSize: 8, color: T.color.muted });
      if (i < nodes.length - 1) { s.addShape("downArrow", { x: lx + lw / 2 - 0.06, y: n.y + 0.5, w: 0.12, h: 0.06, fill: { color: T.color.faint }, line: { type: "none" } }); }
    });
    const rx = lx + lw + 0.35, rw = W - M - rx - 0.1;
    s.addShape("roundRect", { x: rx, y: 1.95, w: rw, h: 3.75, fill: { color: T.color.cautionLight }, line: { color: T.color.caution, width: 1, dashType: "dash" }, rectRadius: 0.06 });
    s.addText("视觉对抗层 quiz-vision.js", { x: rx + 0.15, y: 2.02, w: rw - 0.3, h: 0.3, fontFace: T.font.cn, fontSize: 12, color: T.color.caution, bold: true });
    s.addShape("rightArrow", { x: lx + lw + 0.01, y: 3.9, w: 0.3, h: 0.16, fill: { color: T.color.caution }, line: { type: "none" } });
    const vNodes = [{ label: "html2canvas 截图", desc: "多镜像 CDN 容错加载", y: 2.45 }, { label: "tesseract OCR", desc: "本地 OCR 还原文本", y: 3.05 }, { label: "endpoint 多模态", desc: "AI 返回 text + answer", y: 3.65 }, { label: "deepseek-web", desc: "跨页问 DeepSeek 截图+提示词", y: 4.25 }];
    vNodes.forEach((v) => {
      s.addShape("roundRect", { x: rx + 0.15, y: v.y, w: rw - 0.3, h: 0.42, fill: { color: "FFFFFF" }, line: { color: T.color.caution, width: 0.75 }, rectRadius: 0.04 });
      s.addText(v.label, { x: rx + 0.25, y: v.y + 0.02, w: rw - 0.5, h: 0.2, fontFace: T.font.mono, fontSize: 8.5, color: T.color.caution, bold: true });
      s.addText(v.desc, { x: rx + 0.25, y: v.y + 0.22, w: rw - 0.5, h: 0.18, fontFace: T.font.cn, fontSize: 7.5, color: T.color.muted });
    });
    s.addText("还原文本 → 答案源", { x: lx + lw + 0.32, y: 4.62, w: 2.5, h: 0.3, fontFace: T.font.cn, fontSize: 8, color: T.color.positive, bold: true });
    s.addShape("roundRect", { x: M, y: 5.85, w: W - M * 2, h: 0.55, fill: { color: T.color.accentLight }, line: { type: "none" }, rectRadius: 0.04 });
    s.addText("隐私优先: 外部 CDN 脚本须 QUIZ_VISION_PRIVACY_OK 显式授权才加载；未授权静默拦截并 toast 提示", { x: M + 0.2, y: 5.85, w: W - M * 2 - 0.4, h: 0.55, fontFace: T.font.cn, fontSize: T.size.small, color: T.color.accentDark, bold: true, valign: "middle" });
  }

  // SLIDE 10: 核心设计模式
  {
    const s = contentPage(pres, "09 · 设计决策", "关键设计模式与决策", 10);
    const gx = M + 0.05, gw = W - M * 2 - 0.1, cols = 4, gap = 0.15, cardW = (gw - gap * (cols - 1)) / cols, cardH = 2.35;
    const patterns = [{ num: "01", title: "单文件 IIFE", desc: "56 个源文件开发期分文件，@provides/@requires 声明依赖，构建时拼接为单个 .user.js", accent: T.color.accent }, { num: "02", title: "站点隔离", desc: "所有站点逻辑经 currentSiteCfg() 取能力集，禁止散落 host 判断", accent: T.color.positive }, { num: "03", title: "答案源可插拔", desc: "random(兜底)/bank(题库)/ai(端点)/deepseek-web(跨页视觉)，严格模式失败即停", accent: T.color.caution }, { num: "04", title: "视觉对抗", desc: "题干被混淆时 DOM textContent 不可信，一律以截图为准经 OCR 或 AI 还原", accent: T.color.risk }, { num: "05", title: "隐私优先", desc: "外部 CDN 脚本须 QUIZ_VISION_PRIVACY_OK 显式授权才加载，未授权静默拦截", accent: T.color.accent }, { num: "06", title: "多 iframe 鲁棒", desc: "面板挂顶层帧，跨域 safeGet 回退，owner 抢占 + 缓存节点脱连自愈", accent: T.color.positive }, { num: "07", title: "内存护栏", desc: "指纹/队列带上限淘汰与 TTL，防超长会话无限增长", accent: T.color.caution }, { num: "08", title: "增量 diff 优化", desc: "_quizDirtyGen 由 MO 递增，指纹跨 tick 缓存(WeakMap)，稳态零重算", accent: T.color.risk }];
    patterns.forEach((p, i) => {
      const col = i % cols, row = Math.floor(i / cols);
      const x = gx + col * (cardW + gap), y = 1.95 + row * (cardH + 0.2);
      addCard(s, x, y, cardW, cardH, { border: T.color.hairline });
      s.addShape("rect", { x, y, w: cardW, h: 0.05, fill: { color: p.accent }, line: { type: "none" } });
      s.addText(p.num, { x: x + 0.15, y: y + 0.15, w: 0.6, h: 0.35, fontFace: T.font.en, fontSize: 18, color: p.accent, bold: true });
      s.addText(p.title, { x: x + 0.15, y: y + 0.55, w: cardW - 0.3, h: 0.3, fontFace: T.font.cn, fontSize: 13, color: T.color.ink, bold: true });
      s.addText(p.desc, { x: x + 0.15, y: y + 0.9, w: cardW - 0.3, h: 1.3, fontFace: T.font.cn, fontSize: 9, color: T.color.muted, lineSpacingMultiple: 1.25 });
    });
  }

  // SLIDE 11: 跨模块契约
  {
    const s = contentPage(pres, "10 · 工程质量", "跨模块契约体系", 11);
    const gx = M + 0.05, gw = W - M * 2 - 0.1, lw = gw * 0.58;
    s.addText("行为不变量（人读 + 构建门禁静态校验）", { x: gx, y: 1.9, w: lw, h: 0.3, fontFace: T.font.cn, fontSize: T.size.label, color: T.color.accent, bold: true });
    const contracts = [{ id: "C1", title: "面板单一事实源", desc: "面板 DOM 只有一份（挂 window.top），写面板 DOM 须 _cxPanelOwnerClaim() 验证所有权", color: T.color.accent }, { id: "C3", title: "列表渲染索引契约", desc: "DOM 行序 ↔ _lastVideoList 下标严格一致，失败项也输出占位行", color: T.color.positive }, { id: "C4", title: "卸载还原清单", desc: "uninstall() 承诺页面回到注入前状态：定时器/全局API/实例级/原型/监听/DOM 全部还原", color: T.color.caution }, { id: "C5", title: "状态改写对偶还原", desc: "任何批量状态改写(muteAll/pauseAll)必须有被真实调用的还原路径，且幂等", color: T.color.risk }, { id: "C6", title: "站点隔离真值判断", desc: "站点能力一律经 detectSite() 判定，禁止直接读 location.host 做分支", color: T.color.accent }];
    contracts.forEach((c, i) => {
      const y = 2.3 + i * 0.58;
      addCard(s, gx, y, lw, 0.5, { accent: c.color });
      s.addText(c.id, { x: gx + 0.2, y: y + 0.04, w: 0.4, h: 0.25, fontFace: T.font.en, fontSize: 11, color: c.color, bold: true, valign: "middle" });
      s.addText(c.title, { x: gx + 0.65, y: y + 0.04, w: 1.5, h: 0.25, fontFace: T.font.cn, fontSize: 10, color: T.color.ink, bold: true, valign: "middle" });
      s.addText(c.desc, { x: gx + 0.65, y: y + 0.24, w: lw - 0.8, h: 0.22, fontFace: T.font.cn, fontSize: 8, color: T.color.muted, valign: "middle" });
    });
    const rx = gx + lw + 0.25, rw = gw - lw - 0.25;
    s.addText("构建门禁 · 全自动", { x: rx, y: 1.9, w: rw, h: 0.3, fontFace: T.font.cn, fontSize: T.size.label, color: T.color.positive, bold: true });
    const gates = [{ name: "verify_contracts.js", desc: "挂载 ↔ 读点一致性", num: "门禁 4" }, { name: "verify_contract_doc.js", desc: "挂载总表不漂移", num: "门禁 5" }, { name: "verify_contract_semantics.js", desc: "条款是否真被实现", num: "门禁 6" }, { name: "verify_cross_module.js", desc: "跨模块裸全局校验", num: "门禁 8" }, { name: "node --check", desc: "语法校验", num: "门禁 1" }, { name: "ESLint", desc: "静态分析 (no-undef 等)", num: "门禁 9" }];
    gates.forEach((g, i) => {
      const y = 2.3 + i * 0.48;
      addCard(s, rx, y, rw, 0.4, { border: T.color.hairline });
      s.addText(g.num, { x: rx + 0.12, y: y + 0.03, w: 0.6, h: 0.3, fontFace: T.font.en, fontSize: 9, color: T.color.positive, bold: true, valign: "middle" });
      s.addText(g.name, { x: rx + 0.75, y: y + 0.03, w: 1.8, h: 0.3, fontFace: T.font.mono, fontSize: 8.5, color: T.color.ink, bold: true, valign: "middle" });
      s.addText(g.desc, { x: rx + 0.75, y: y + 0.22, w: rw - 0.85, h: 0.16, fontFace: T.font.cn, fontSize: 7.5, color: T.color.muted, valign: "middle" });
    });
    const statY = 5.5, statW = (gw - 0.3) / 4;
    const stats = [{ num: "210", label: "挂载符号", color: T.color.accent }, { num: "56+", label: "仿真回归用例", color: T.color.positive }, { num: "6", label: "行为契约章节", color: T.color.caution }, { num: "8", label: "构建门禁", color: T.color.risk }];
    stats.forEach((st, i) => {
      const x = gx + i * (statW + 0.1);
      addCard(s, x, statY, statW, 0.65, { border: T.color.hairline });
      s.addText(st.num, { x, y: statY + 0.05, w: statW, h: 0.35, fontFace: T.font.en, fontSize: 22, color: st.color, bold: true, align: "center" });
      s.addText(st.label, { x, y: statY + 0.42, w: statW, h: 0.2, fontFace: T.font.cn, fontSize: 8, color: T.color.muted, align: "center" });
    });
  }

  // SLIDE 12: 构建与质量保障
  {
    const s = contentPage(pres, "11 · 工程化", "构建流水线与质量保障", 12);
    const gx = M + 0.05, gw = W - M * 2 - 0.1;
    s.addText("构建流水线", { x: gx, y: 1.9, w: gw, h: 0.3, fontFace: T.font.cn, fontSize: T.size.label, color: T.color.accent, bold: true });
    const pipe = [{ label: "src/*.js", desc: "56 源模块", color: T.color.accent }, { label: "build-manifest", desc: "域顺序清单", color: T.color.accent }, { label: "scripts/build.ps1", desc: "拼接+多镜像+校验", color: T.color.accentDark }, { label: "chaoxing-force-play.user.js", desc: "单文件产物", color: T.color.positive }, { label: "apps/userscript/_sim/ 回归", desc: "56 仿真用例", color: T.color.positive }];
    const pw = (gw - 0.4) / 5;
    pipe.forEach((p, i) => {
      const x = gx + i * (pw + 0.1);
      s.addShape("roundRect", { x, y: 2.3, w: pw, h: 0.55, fill: { color: T.color.surface }, line: { color: p.color, width: 1 }, rectRadius: 0.04 });
      s.addText(p.label, { x: x + 0.08, y: 2.33, w: pw - 0.16, h: 0.25, fontFace: T.font.mono, fontSize: 7.5, color: p.color, bold: true, align: "center" });
      s.addText(p.desc, { x: x + 0.08, y: 2.55, w: pw - 0.16, h: 0.25, fontFace: T.font.cn, fontSize: 7.5, color: T.color.muted, align: "center" });
      if (i < pipe.length - 1) { s.addShape("rightArrow", { x: x + pw + 0.01, y: 2.48, w: 0.08, h: 0.16, fill: { color: T.color.faint }, line: { type: "none" } }); }
    });
    s.addText("质量保障矩阵", { x: gx, y: 3.15, w: gw, h: 0.3, fontFace: T.font.cn, fontSize: T.size.label, color: T.color.accent, bold: true });
    const qItems = [{ area: "语法", tool: "node --check", target: "全 src 模块", color: T.color.accent }, { area: "静态分析", tool: "ESLint", target: "完整构建产物", color: T.color.accentDark }, { area: "模块体积", tool: "check-module-size.ps1", target: "软 300 / 硬 350 行", color: T.color.caution }, { area: "产物体积", tool: "check-build-size.js", target: "软 200KB / 硬 300KB", color: T.color.caution }, { area: "纯函数单测", tool: "pure.test.js", target: "vm 沙箱 · 零依赖", color: T.color.positive }, { area: "仿真回归", tool: "sim-*.js", target: "56 用例 · jsdom 沙箱", color: T.color.positive }, { area: "契约语义", tool: "verify_contract_semantics", target: "变异自检防空转", color: T.color.risk }, { area: "持续集成", tool: "GitHub Actions CI", target: "push/PR → 全套校验", color: T.color.risk }];
    const qCols = 4, qGap = 0.12, qW = (gw - qGap * (qCols - 1)) / qCols, qH = 0.78;
    qItems.forEach((q, i) => {
      const col = i % qCols, row = Math.floor(i / qCols);
      const x = gx + col * (qW + qGap), y = 3.5 + row * (qH + 0.12);
      addCard(s, x, y, qW, qH, { border: T.color.hairline });
      s.addShape("rect", { x, y, w: 0.06, h: qH, fill: { color: q.color }, line: { type: "none" } });
      s.addText(q.area, { x: x + 0.18, y: y + 0.06, w: qW - 0.3, h: 0.22, fontFace: T.font.cn, fontSize: 10, color: q.color, bold: true });
      s.addText(q.tool, { x: x + 0.18, y: y + 0.28, w: qW - 0.3, h: 0.22, fontFace: T.font.mono, fontSize: 8, color: T.color.ink });
      s.addText(q.target, { x: x + 0.18, y: y + 0.5, w: qW - 0.3, h: 0.22, fontFace: T.font.cn, fontSize: 7.5, color: T.color.muted });
    });
    s.addShape("roundRect", { x: gx, y: 5.45, w: gw, h: 0.5, fill: { color: T.color.dark }, line: { type: "none" }, rectRadius: 0.04 });
    s.addText("$ powershell -ExecutionPolicy Bypass -File scripts/build.ps1   # 产出 chaoxing-force-play.user.js", { x: gx + 0.15, y: 5.45, w: gw - 0.3, h: 0.5, fontFace: T.font.mono, fontSize: 9, color: "8FD4FF", valign: "middle" });
  }

  // SLIDE 13: 合规声明 + 总结
  {
    const s = pres.addSlide();
    s.background = { fill: T.color.dark };
    s.addShape("rect", { x: 0, y: 0, w: 0.08, h: H, fill: { color: T.color.risk }, line: { type: "none" } });
    s.addShape("ellipse", { x: W - 3, y: -1.5, w: 4, h: 4, fill: { color: T.color.darkSurface }, line: { type: "none" } });
    s.addText("COMPLIANCE NOTICE", { x: M + 0.3, y: 0.8, w: 4, h: 0.35, fontFace: T.font.en, fontSize: T.size.sectionLabel, color: T.color.risk, bold: true, charSpacing: 3 });
    s.addText("合规与风险声明", { x: M + 0.3, y: 1.15, w: 10, h: 0.6, fontFace: T.font.cn, fontSize: T.size.title, color: "FFFFFF", bold: true });
    s.addShape("line", { x: M + 0.3, y: 1.75, w: 0.5, h: 0, line: { color: T.color.risk, width: 2 } });
    const notices = ["本项目仅用于技术学习、个人自动化与学术研究目的，不鼓励任何形式的学术不端或违反平台服务条款的行为。", "使用本项目可能违反所适用教育平台的用户协议或服务条款，由此产生的账号封禁、成绩无效等风险由使用者自行承担。", "项目可能读取/缓存与学习账号相关的本地数据（如 cookies、课程进度），敏感文件已被 .gitignore 默认忽略，请勿提交或公开。", "代码中的 best-effort 选择器与 DOM 驱动依赖真实平台结构，可能随平台改版失效；请在受控环境测试。"];
    notices.forEach((n, i) => { s.addText("▸ " + n, { x: M + 0.3, y: 2.0 + i * 0.52, w: 11, h: 0.45, fontFace: T.font.cn, fontSize: T.size.body, color: "B0B0C8", lineSpacingMultiple: 1.2 }); });
    s.addShape("line", { x: M + 0.3, y: 4.3, w: W - M * 2 - 0.6, h: 0, line: { color: "3A3A5A", width: 0.75 } });
    s.addText("项目规模", { x: M + 0.3, y: 4.5, w: 3, h: 0.3, fontFace: T.font.cn, fontSize: T.size.label, color: T.color.faint, bold: true });
    const metrics = [{ num: "56", label: "源模块", color: T.color.darkAccent }, { num: "9+", label: "支持平台", color: T.color.positive }, { num: "56+", label: "仿真回归", color: T.color.caution }, { num: "210", label: "契约符号", color: "A0A0FF" }, { num: "8", label: "构建门禁", color: T.color.risk }];
    const mw = (W - M * 2 - 0.6) / 5;
    metrics.forEach((m, i) => {
      const x = M + 0.3 + i * mw;
      s.addText(m.num, { x, y: 4.9, w: mw, h: 0.5, fontFace: T.font.en, fontSize: 32, color: m.color, bold: true, align: "center" });
      s.addText(m.label, { x, y: 5.4, w: mw, h: 0.25, fontFace: T.font.cn, fontSize: T.size.small, color: "8080A0", align: "center" });
    });
    s.addText("MIT License · 仅供技术学习与个人自动化研究", { x: M + 0.3, y: 6.2, w: 10, h: 0.3, fontFace: T.font.cn, fontSize: T.size.source, color: "505070" });
    s.addText("chaoxing-force-play", { x: M + 0.3, y: 6.5, w: 10, h: 0.3, fontFace: T.font.mono, fontSize: T.size.source, color: "404060" });
  }

  const outPath = projectPaths.writableFile(process.argv[2] || path.join(projectPaths.outputRoot, '网课强制续播系统-项目介绍.pptx'));
  pres.writeFile({ fileName: outPath }).then(() => {
    console.log("PPTX generated: " + outPath);
  }).catch(err => {
    console.error("Error:", err);
    process.exit(1);
  });
}

buildDeck();
