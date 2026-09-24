// ヘルプ募集一覧: 印刷できない場合の案内と、募集枠の集め方
const { boot, check, finish } = require('../helpers/harness');
const emp = { id: 'e1', name: '田中', color: '#2563eb', category: '日勤' };
const reqs = [{ id: 'r', day: '月', startMin: 360, endMin: 840, count: 1 }];
const { w, $ } = boot({ employees: [emp], templateShifts: [{ id: 't', empId: 'e1', day: '月', startMin: 360, endMin: 840, breakMin: 0 }], weeks: {}, requirements: reqs });
const ps = w.eval('printSettings');
ps.kind = 'help';
check('未作成週はブロック', /まだ作成されていません/.test(w.getPrintBlocker()));
$('btn-create-week').click();
check('不足なしならブロック', /募集枠.*ありません/.test(w.getPrintBlocker()));
w.__state.weeks['2026-09-21'].shifts[0].absent = true;
check('当欠で募集枠あり', w.getPrintBlocker() === null);
const slots = w.collectHelpSlots('2026-09-21');
check('募集枠の内容', slots.length === 1 && slots[0].startMin === 360 && slots[0].endMin === 840 && slots[0].kind === 'empty' && slots[0].absentNames[0] === '田中');
w.__state.mode = 'template';
check('テンプレート表示中はブロック', /週ごと/.test(w.getPrintBlocker()));
w.__state.mode = 'week';
// 時間帯 22:00〜翌6:00 は各日の 22〜翌3 と 3〜6 を対象にする
ps.startMin = 1140; ps.endMin = 1620;
check('時間帯外は対象外', w.collectHelpSlots('2026-09-21').length === 0);
ps.startMin = 600; ps.endMin = 720;
const c = w.collectHelpSlots('2026-09-21');
check('時間帯で切り出し', c.length === 1 && c[0].startMin === 600 && c[0].endMin === 720);

finish();
