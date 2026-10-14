// 测试 fixture：还原答题页真实站点结构模拟 HTML，供 sim-quiz-pages-fixture.js 做选择器校准回归。
// 注意：本文件为 synthetic 还原（真实答题页 DOM dump 尚未固化），结构依据 src 内校准注释与 best-effort 并集构造；
//      真机校准后请用真实 dump 片段替换，保持与「面板报 0 题」诊断一致。
// 对应断言：sim-quiz-pages-fixture.js C1–C6 / D1–D6。
module.exports = {
  // 超星学习通作业/考试页（doHomeWorkNew 类）—— 依据 2026-08-14 真机 doHomeWorkNew DOM dump 校准：
  //   题块 div.TiMu.newTiMu → 题干 div.Zy_TItle.clearfix > span.newZy_TItle + 选项 ul.Zy_ulTop.w-top.fl > li.before-after-checkbox
  //   选项 li 属性: qid / qtype(1=多选) / role=checkbox / tabindex / aria-label="A 示例选项一选择" / onclick="addMultipleChoice(this)"
  //   选项子结构: label.fl.before / a.fl.after / div.clear
  //   已选标记: li[aria-checked=true] 或 内层 span.num_option.check_answer
  //   提交: 页面级 a.btnSubmit.workBtnIndex（题块外，故 quizTick 按题块内查找不自动交卷）
  // 注: ul.Zy_ulTop 是选项列表(题块内)，不得作为 questionSel，否则与 div.TiMu 双重计数。
  chaoxingQuizHtml: function () {
    function qBlock(stem, opts, selectedIdx) {
      var lis = opts.map(function (o, i) {
        var sel = (i === selectedIdx) ? ' aria-checked="true"' : '';
        var innerChk = (i === selectedIdx) ? '<span class="num_option check_answer">' + o.letter + '</span>' : '';
        return '      <li class="before-after-checkbox" qid="' + o.qid + '" qtype="1" role="checkbox" tabindex="0" ' +
          'aria-label="' + o.letter + ' ' + o.text + '选择"' + sel + ' onclick="addMultipleChoice(this)">\n' +
          '        <label class="fl before">' + o.letter + '</label>\n' +
          '        <a class="fl after">' + o.text + '</a>\n' +
          innerChk +
          '        <div class="clear"></div>\n' +
          '      </li>';
      }).join('\n');
      return '  <div class="TiMu newTiMu">\n' +
        '    <div class="Zy_TItle clearfix"><span class="newZy_TItle">' + stem + '</span></div>\n' +
        '    <div class="clearfix">\n' +
        '      <ul class="Zy_ulTop w-top fl">\n' + lis + '\n      </ul>\n' +
        '    </div>\n' +
        '  </div>';
    }
    var a = { letter: 'A', text: '示例选项一', qid: '99000001' };
    var b = { letter: 'B', text: '示例选项二', qid: '99000001' };
    var c = { letter: 'C', text: '示例选项三', qid: '99000001' };
    var d = { letter: 'D', text: '示例选项四', qid: '99000001' };
    return [
      '<html><body>',
      '  <div class="Zy_Title">第一章 章节测验</div>',
      qBlock('1 【多选题】请选择示例选项。', [a, b, c, d], 0),
      qBlock('2 【单选题】下列哪项属于安全操作规程？', [a, b, c, d], -1),
      '  <a class="btnSubmit workBtnIndex">提交</a>',
      '</body></html>'
    ].join('\n');
  },

  // 智慧树作业/考试页 —— 依据 zhihuishu-exam.js CFG 的 best-effort 并集：
  //   题目容器 .question-item（含题干），选项 .option-item（内层 input[type=radio/checkbox]），
  //   翻页 .next-page，交卷 .submit-btn；已选由 .option-item.active 等 class 标出（对应 _zheOptions/anySel）。
  zhihuishuExamHtml: function () {
    return [
      '<html><body>',
      '  <div class="exam-main">',
      '    <div class="question-item">',
      '      <div class="question-title">1. 下列哪项正确？</div>',
      '      <div class="option-item"><input type="radio" name="q1" value="A"><span>A. 甲</span></div>',
      '      <div class="option-item"><input type="radio" name="q1" value="B"><span>B. 乙</span></div>',
      '      <div class="option-item"><input type="radio" name="q1" value="C"><span>C. 丙</span></div>',
      '    </div>',
      '    <div class="question-item">',
      '      <div class="question-title">2. 多选题</div>',
      '      <div class="option-item active"><input type="checkbox" name="q2" value="A" checked><span>A. 甲</span></div>',
      '      <div class="option-item"><input type="checkbox" name="q2" value="B"><span>B. 乙</span></div>',
      '    </div>',
      '    <button class="next-page">下一页</button>',
      '    <button class="submit-btn">提交</button>',
      '  </div>',
      '</body></html>'
    ].join('\n');
  }
};
