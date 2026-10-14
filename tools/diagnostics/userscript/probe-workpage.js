(() => {
  const out = [];
  const walk = (w, d) => {
    try {
      const ns = w.__CX_FORCE_PLAY;
      const doc = w.document;
      const tiMu = doc.querySelectorAll('div.TiMu').length;
      const opt1 = doc.querySelectorAll('div.TiMu ul.Zy_ulTop > li').length;
      const opt2 = doc.querySelectorAll('div.TiMu li.before-after-checkbox').length;
      const opt3 = doc.querySelectorAll('div.TiMu li').length;
      const opt4 = doc.querySelectorAll('div.TiMu ul > li').length;
      const stats = ns && ns.quizStats;
      const lights = (ns && ns.quizLights) || [];
      const local = lights.filter(l => !l.remote);
      let vision = null;
      try { vision = { enabled: localStorage.getItem('cx_quiz_vision_enabled'), ocr: localStorage.getItem('cx_quiz_vision_ocr') }; } catch (e) {}
      out.push({ d, url: w.location.href.slice(0, 70), lights: lights.length, local: local.length,
        tiMu, opt_zy: opt1, opt_check: opt2, opt_li: opt3, opt_ul_li: opt4,
        stats: stats ? { scanned: stats.scanned, answered: stats.answered, strict: !!stats.strictMode, src: stats.source } : null,
        vision, auto: (ns && ns.quizAutoStartOn) ? ns.quizAutoStartOn() : null });
      for (let i = 0; i < w.frames.length; i++) { try { walk(w.frames[i], d + 1); } catch (e) {} }
    } catch (e) { out.push({ d, x: 1, err: String(e).slice(0, 60) }); }
  };
  walk(window.top, 0);
  let firstQ = null;
  const walkQ = (w) => {
    if (firstQ) return;
    try { const q = w.document.querySelector('div.TiMu'); if (q) { firstQ = { url: w.location.href.slice(0, 70), html: q.outerHTML.slice(0, 1500) }; return; } } catch (e) {}
    for (let i = 0; i < w.frames.length; i++) { try { walkQ(w.frames[i]); } catch (e) {} }
  };
  walkQ(window.top);
  return JSON.stringify({ frames: out, firstQ }, null, 1);
})()