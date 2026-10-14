// 诊断：_glyphHash 在仿真模式下的碰撞率
const SHIFT = 0x1000;
let lastChar = '';
const fakeCtx = {
  clearRect() {},
  fillText(ch) { lastChar = String(ch); },
  getImageData() {
    const cp = lastChar.charCodeAt(0) || 0;
    const eff = (cp >= 0x4e00 + SHIFT && cp <= 0x9fa5 + SHIFT) ? cp - SHIFT : cp;
    const data = new Uint8ClampedArray(20 * 20 * 4).fill(255);
    let x = (eff * 2654435761) >>> 0;
    x ^= x >>> 13; x = (x * 2246822519) >>> 0; x ^= x >>> 11;
    for (let i = 0; i < 60; i++) {
      x = (x * 1103515245 + 12345) >>> 0;
      const idx = (x % 400) * 4;
      data[idx] = 0; data[idx + 1] = 0; data[idx + 2] = 0; data[idx + 3] = 255;
    }
    return { data };
  },
};
function glyphHash(ch) {
  const ctx = fakeCtx;
  ctx.clearRect(0, 0, 20, 20);
  ctx.fillText(ch, 2, 2);
  const d = ctx.getImageData(0, 0, 20, 20).data;
  let h1 = 0, h2 = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i] < 128) { h1 = (h1 * 31 + (i >> 2)) | 0; h2 = (h2 * 65599 + ((d[i + 1] << 8) | d[i + 2])) | 0; n++; }
  }
  return n ? h1 + ':' + h2 : null;
}
// 1) 关键字符哈希是否互异
const targets = ['中', '国', '的', '首', '都', '是', '？', '文', '本', '普', '通'];
const seen = {};
for (const c of targets) {
  const h = glyphHash(c);
  console.log(c, h, seen[h] ? ' COLLISION with ' + seen[h] : '');
  seen[h] = c;
}
// 2) 全表碰撞率
const map = {};
let coll = 0, total = 0, uniq = 0;
for (let cp = 0x4e00; cp <= 0x4f00; cp++) {   // 只测 256 个样本
  const h = glyphHash(String.fromCharCode(cp));
  total++;
  if (h == null) continue;
  if (map[h]) coll++; else { map[h] = 1; uniq++; }
}
console.log('sample total=' + total + ' uniq=' + uniq + ' collisions=' + coll);
