// 诊断2：假字形模式本身是否互异 vs 哈希碰撞
const SHIFT = 0x1000;
let lastChar = '';
function patternOf(eff) {
  const data = new Uint8ClampedArray(20 * 20 * 4).fill(255);
  let s = (eff * 2654435761) >>> 0;
  s ^= s >>> 15; s = (s * 2246822519) >>> 0; s ^= s >>> 13;
  const pts = [];
  for (let i = 0; i < 60; i++) {
    s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
    pts.push(s % 400);
  }
  return pts.join(',');
}
function glyphHash(eff) {
  const d = new Uint8ClampedArray(20 * 20 * 4).fill(255);
  let s = (eff * 2654435761) >>> 0;
  s ^= s >>> 15; s = (s * 2246822519) >>> 0; s ^= s >>> 13;
  for (let i = 0; i < 60; i++) {
    s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
    const idx = (s % 400) * 4;
    d[idx] = 0;
  }
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
const pats = {}, hashes = {};
let patColl = 0, hashColl = 0, total = 0;
const N = 5000;
for (let cp = 0x4e00; cp < 0x4e00 + N; cp++) {
  total++;
  const p = patternOf(cp);
  if (pats[p]) patColl++; else pats[p] = 1;
  const h = glyphHash(cp);
  if (hashes[h]) hashColl++; else hashes[h] = 1;
}
console.log('total=' + total + ' patternCollisions=' + patColl + ' hashCollisions=' + hashColl);
