// 诊断：模拟 _buildSecretMap 构建过程，检查 map 大小与目标字符命中
const SHIFT = 0x1000;
let lastChar = '';
const fakeCtx = {
  clearRect() {},
  fillText(ch) { lastChar = String(ch); },
  getImageData() {
    const cp = lastChar.charCodeAt(0) || 0;
    const eff = (cp >= 0x4e00 + SHIFT && cp <= 0x9fa5 + SHIFT) ? cp - SHIFT : cp;
    const data = new Uint8ClampedArray(20 * 20 * 4).fill(255);
    let s = (eff * 2654435761) >>> 0;
    s ^= s >>> 15; s = (s * 2246822519) >>> 0; s ^= s >>> 13;
    for (let i = 0; i < 60; i++) {
      s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
      const idx = (s % 400) * 4;
      data[idx] = 0; data[idx + 1] = 0; data[idx + 2] = 0; data[idx + 3] = 255;
    }
    return { data };
  },
};
function glyphHash(ch) {
  fakeCtx.clearRect(0, 0, 20, 20);
  fakeCtx.fillText(ch, 2, 2);
  const d = fakeCtx.getImageData(0, 0, 20, 20).data;
  let h1 = 0x811c9dc5, h2 = 0x9e3779b9, n = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i] < 128) {
      const p = i >> 2;
      h1 = ((h1 ^ (p + 1)) * 16777619) | 0;
      h2 = ((h2 ^ ((p << 8) | (d[i + 1] & 0xf0))) * 2246822519) | 0;
      n++;
    }
  }
  return n ? (h1 >>> 0).toString(36) + ':' + (h2 >>> 0).toString(36) : null;
}
const map = {};
const targets = ['中', '国', '的', '首', '都', '是', '文', '本', '选', '项', '普', '通'];
const tset = {};
targets.forEach((t) => { tset[t.charCodeAt(0)] = t; });
for (let cp = 0x4e00; cp <= 0x9fa5; cp++) {
  const ch = String.fromCharCode(cp);
  const h = glyphHash(ch);
  if (h && !map[h]) map[h] = ch;
}
console.log('map size:', Object.keys(map).length);
for (const t of targets) {
  const h = glyphHash(t);
  const got = map[h];
  console.log(t, 'U+' + t.charCodeAt(0).toString(16), '->', got, got === t ? 'OK' : (got ? 'WRONG:' + got : 'MISSING'));
}
