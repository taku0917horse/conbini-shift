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

// ---- 表の下端（翌3:00〜翌6:00）は、翌日の 3:00 から入る人も数える ----
{
  const e2 = { id: 'e2', name: '佐藤', color: '#16a34a', category: '夜勤' };
  const req = d => ({ id: 'n' + d, day: d, startMin: 1140, endMin: 1620, count: 1 }); // 22:00〜翌6:00 に1人
  const seed = (weeks, reqs) => ({ employees: [emp, e2], templateShifts: [], weeks, requirements: reqs, shiftMergeDone: true });
  {
    // 月 22:00〜翌3:00 は田中、火 3:00〜6:00 は佐藤
    const { w: w2 } = boot(seed({ [W]: { createdAt: 'x', shifts: [
      { id: 'a', empId: 'e1', day: '月', startMin: 1140, endMin: 1440, breakMin: 0 },
      { id: 'b', empId: 'e2', day: '火', startMin: 0, endMin: 180, breakMin: 0 },
    ] } }, [req('月')]));
    const mon = w2.getShortageOverlays('月');
    check('月の翌3:00〜翌6:00: 火の 3:00〜の人を数えて不足なし', !mon.some(o => o.endMin > 1440));
    w2.document.querySelector('.day-tab[data-day="月"]').click();
    check('月のシフト表の下端に「0人」を出さない', w2.document.querySelectorAll('#requirement-overlay .req-block').length === 0);
  }
  {
    // 火の必要人数ルール（3:00〜6:00 に2人）も月の下端に反映する
    const { w: w2 } = boot(seed({ [W]: { createdAt: 'x', shifts: [
      { id: 'a', empId: 'e1', day: '月', startMin: 1140, endMin: 1620, breakMin: 0 },
    ] } }, [req('月'), { id: 't', day: '火', startMin: 0, endMin: 180, count: 2 }]));
    const tail = w2.getShortageOverlays('月').filter(o => o.startMin >= 1440);
    check('月の翌3:00〜翌6:00: 火の早朝のルール（2人）も数える → あと1人', tail.length === 1 && tail[0].short === 1
      && tail[0].startMin === 1440 && tail[0].endMin === 1620);
  }
  {
    // 日曜の下端は翌週の月曜の早朝を数える（翌週が未作成なら数えない）
    const shiftsW = [{ id: 'a', empId: 'e1', day: '日', startMin: 1140, endMin: 1440, breakMin: 0 }];
    const nextMon = [{ id: 'b', empId: 'e2', day: '月', startMin: 0, endMin: 180, breakMin: 0 }];
    const { w: w2 } = boot(seed({ [W]: { createdAt: 'x', shifts: shiftsW } }, [req('日')]));
    check('日の下端: 翌週が未作成なら不足', w2.getShortageOverlays('日').some(o => o.startMin === 1440));
    const { w: w3 } = boot(seed({ [W]: { createdAt: 'x', shifts: shiftsW }, '2026-09-28': { createdAt: 'x', shifts: nextMon } }, [req('日')]));
    check('日の下端: 翌週の月曜 3:00〜の人を数える', !w3.getShortageOverlays('日').some(o => o.endMin > 1440));
  }
  {
    // テンプレートは日曜の次が月曜
    const { w: w2 } = boot({ employees: [emp, e2], weeks: {}, requirements: [req('日')], shiftMergeDone: true, templateShifts: [
      { id: 'a', empId: 'e1', day: '日', startMin: 1140, endMin: 1440, breakMin: 0 },
      { id: 'b', empId: 'e2', day: '月', startMin: 0, endMin: 180, breakMin: 0 },
    ] });
    w2.eval("state.mode = 'template'");
    check('テンプレート: 日の下端は月の 3:00〜の人を数える', !w2.getShortageOverlays('日').some(o => o.endMin > 1440));
  }
}

finish();
