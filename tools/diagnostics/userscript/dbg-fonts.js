const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!DOCTYPE html><html><body><div style="font-family: font-cxsecret">测试</div></body></html>', {
  url: 'https://mooc1.chaoxing.com/mycourse/studentstudy?courseId=1',
  runScripts: 'dangerously',
  pretendToBeVisual: true,
});
const win = dom.window;
console.log('document.fonts:', typeof win.document.fonts, win.document.fonts ? Object.getOwnPropertyNames(Object.getPrototypeOf(win.document.fonts)) : null);
if (win.document.fonts) {
  try { console.log('check(中):', win.document.fonts.check('14px font-cxsecret', '中')); } catch (e) { console.log('check threw:', String(e)); }
  try { console.log('check(sans):', win.document.fonts.check('14px sans-serif', '中')); } catch (e) { console.log('check2 threw:', String(e)); }
  try { console.log('check(A):', win.document.fonts.check('14px font-cxsecret', 'A')); } catch (e) { console.log('check3 threw:', String(e)); }
}
const el = win.document.querySelector('div');
console.log('fontFamily:', win.getComputedStyle(el).fontFamily);
console.log('ready:', !!win.document.fonts.ready);