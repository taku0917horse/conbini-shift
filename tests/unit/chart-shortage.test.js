// シフトタブの不足表示（実際の時刻の範囲で表示されるか）
const { boot, check, finish } = require('../helpers/harness');

const emp = { id: 'e1', name: '田中', color: '#2563eb', category: '日勤' };
const W = '2026-09-21';
// 水曜 9:00〜18:00 に1人必要。勤務は 9:30〜17:30
const { w, $ } = boot({
  employees: [emp], templateShifts: [],
  weeks: { [W]: { createdAt: 'x', shifts: [{ id: 'a', empId: 'e1', day: '水', startMin: 390, endMin: 870, breakMin: 0, absent: false }] } },
  requirements: [{ id: 'r', day: '水', startMin: 360, endMin: 900, count: 1 }],
});
w.document.querySelector('.day-tab[data-day="水"]').click();
const H = w.eval('HOUR_H');
const blocks = [...w.document.querySelectorAll('#requirement-overlay .req-block')].map(b => ({
  top: parseFloat(b.style.top), height: parseFloat(b.style.height), text: b.textContent, cls: b.className,
}));
console.log(JSON.stringify(blocks), 'HOUR_H=' + H);
check('不足は2区間（9:00〜9:30 と 17:30〜18:00）', blocks.length === 2);
check('9:00〜9:30 の位置', blocks[0].top === 6 * H && blocks[0].height === H / 2);
check('17:30〜18:00 を見落とさない', blocks[1].top === 14.5 * H && blocks[1].height === H / 2);
check('0人の表示', blocks.every(b => b.text === '0人' && b.cls.includes('empty')));

// 2人必要で1人いる → 「あと1人」、当欠は数えない
w.__state.requirements = [{ id: 'r', day: '水', startMin: 390, endMin: 870, count: 2 }];
w.renderShiftChart();
let b2 = [...w.document.querySelectorAll('#requirement-overlay .req-block')];
check('あと1人（1区間）', b2.length === 1 && b2[0].textContent === 'あと1人' && b2[0].className.includes('shortage'));
w.__state.weeks[W].shifts[0].absent = true;
w.renderShiftChart();
b2 = [...w.document.querySelectorAll('#requirement-overlay .req-block')];
check('当欠なら0人', b2.length === 1 && b2[0].textContent === '0人');

// 未作成の週は表示しない
$('btn-week-next').click();
check('未作成の週は不足表示なし', w.document.querySelectorAll('#requirement-overlay .req-block').length === 0);

// シフト表の表示サイズを変えても位置が追従する
$('btn-week-prev').click();
w.eval('cycleHourSize()');
const H2 = w.eval('HOUR_H');
const b3 = w.document.querySelector('#requirement-overlay .req-block');
check('表示サイズ変更に追従', parseFloat(b3.style.top) === 6.5 * H2);

finish();
