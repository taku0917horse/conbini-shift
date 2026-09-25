// 勤務の結合の前後で表示が正しいか: 不足・募集中・募集一覧は変わらず、週間スケジュール・シフト表・印刷は1つにまとまる
const { boot, check, finish } = require('../helpers/harness');

const W = '2026-09-21';
const emps = [
  { id: 'e1', name: '田中', color: '#2563eb', category: '日勤' },
  { id: 'e2', name: '佐藤', color: '#16a34a', category: '夜勤' },
  { id: 'e3', name: '鈴木', color: '#dc2626', category: '夕勤' },
  { id: 'e4', name: '店長', color: '#ea580c', category: '日勤', isManager: true },
  { id: 'e5', name: '高橋', color: '#9333ea', category: '早朝' },
];
let n = 0;
const sh = (empId, day, startMin, endMin, extra = {}) =>
  ({ id: 's' + (n++), empId, day, startMin, endMin, breakMin: 0, tentativeStart: null, tentativeEnd: null, absent: false, ...extra });
const shifts = [
  sh('e1', '月', 360, 600), sh('e1', '月', 600, 840),                                          // 同じ日: 9〜13 + 13〜17
  sh('e2', '月', 1140, 1440), sh('e2', '火', 0, 180),                                          // 日付の境目: 月22〜翌3 + 火3〜6
  sh('e3', '水', 840, 960, { absent: true }), sh('e3', '水', 960, 1140, { absent: true }),     // 当欠同士
  sh('e4', '木', 360, 840), sh('e4', '木', 840, 1140, { tentativeStart: 840, tentativeEnd: 1140 }), // 仮あり
  sh('e5', '金', 180, 360), sh('e5', '金', 360, 840, { breakMin: 60 }),                        // 休憩あり
];
const requirements = ['月', '火', '水', '木', '金', '土', '日'].map(d => ({ id: 'r' + d, day: d, startMin: 0, endMin: 1620, count: 2 }));
const { w, $ } = boot({ employees: emps, templateShifts: [], weeks: { [W]: { createdAt: 'x', shifts } }, requirements, shiftMergeDone: true });
const ev = x => w.eval(x);
const DAYS = ['月', '火', '水', '木', '金', '土', '日'];

function capture() {
  const out = {};
  w.switchView('requirements');
  for (const f of ['all', 'dawn', 'morn', 'day', 'eve', 'night']) {
    w.document.querySelector(`.shortage-filter-btn[data-band="${f}"]`).click();
    out['shortage-' + f] = $('shortage-list').innerHTML;
    w.document.querySelector(`.tentative-filter-btn[data-band="${f}"]`).click();
    out['tentative-' + f] = $('tentative-list').innerHTML;
  }
  out.overlays = JSON.stringify(DAYS.map(d => w.getShortageOverlays(d)));
  out.help = JSON.stringify(ev(`collectHelpSlots('${W}').map(s => [s.date.getDate(), s.startMin, s.endMin, s.count, s.kind, s.absentNames, s.note])`));

  out.week = {};
  for (const e of emps) {
    w.openEmpWeekModal(e.id);
    out.week[e.id] = {
      rows: [...w.document.querySelectorAll('.emp-week-row')].map(r =>
        [...r.querySelectorAll('.emp-week-day, .emp-week-entry, .emp-week-rest')].map(e => e.textContent).join(' ')),
      total: $('emp-week-total').textContent,
    };
    w.closeEmpWeekModal();
  }

  out.chart = {};
  w.switchView('shift');
  for (const d of DAYS) {
    w.document.querySelector(`.day-tab[data-day="${d}"]`).click();
    out.chart[d] = [...w.document.querySelectorAll('#shift-lanes .shift-bar')]
      .map(b => [...b.querySelectorAll('span')].map(e => e.textContent).filter(Boolean).join(' ')).sort();
  }
  out.chartReq = JSON.stringify(DAYS.map(d => (w.document.querySelector(`.day-tab[data-day="${d}"]`).click(),
    [...w.document.querySelectorAll('#requirement-overlay .req-block')].map(b => b.style.cssText + b.textContent))));

  const ps = ev('printSettings');
  Object.assign(ps, { kind: 'shift', startMin: 0, endMin: 1440, weeks: 1, orient: 'portrait' });
  const sheet = ev('buildPrintPages()')[0];
  out.printBars  = [...sheet.querySelectorAll('.bg-bar')].map(b => b.textContent);
  out.printMarks = [...sheet.querySelectorAll('.bg-shortage-mark')].map(m => m.style.cssText + m.textContent);
  return out;
}

const before = capture();
const merged = ev('mergeAllShiftLists()');
ev('saveShifts()');
const after = capture();

check('5か所まとまる', merged === 5 && w.__state.weeks[W].shifts.length === 5);

// ---- 変わらないもの（人がいる時間は同じ） ----
for (const f of ['all', 'dawn', 'morn', 'day', 'eve', 'night']) {
  check(`不足リスト（${f}）は変わらない`, before['shortage-' + f] === after['shortage-' + f]);
}
// 募集中リスト: 仮の行は変わらず、分かれていた当欠の行は1つにまとまる
const tentRows = html => { const d = new (w.DOMParser)().parseFromString(html, 'text/html');
  return [...d.querySelectorAll('.tentative-row')].map(r => r.querySelector('.shortage-time').textContent + ' ' + r.querySelector('.tentative-name').textContent); };
for (const f of ['all', 'morn', 'day', 'eve', 'night']) {
  const b = tentRows(before['tentative-' + f]).filter(r => !r.includes('鈴木'));
  const a = tentRows(after['tentative-' + f]).filter(r => !r.includes('鈴木'));
  check(`募集中リスト（${f}）: 仮の行は変わらない`, JSON.stringify(a) === JSON.stringify(b));
}
check('募集中リスト: 店長の仮 17:00〜22:00 は残る', tentRows(after['tentative-all']).includes('17:00〜22:00 店長が仮で対応中'));
check('募集中リスト: 鈴木の当欠 17:00〜19:00 と 19:00〜22:00 → 17:00〜22:00 の1行',
  JSON.stringify(tentRows(before['tentative-all']).filter(r => r.includes('鈴木'))) === '["17:00〜19:00 鈴木が当欠","19:00〜22:00 鈴木が当欠"]'
  && JSON.stringify(tentRows(after['tentative-all']).filter(r => r.includes('鈴木'))) === '["17:00〜22:00 鈴木が当欠"]');
check('不足の区間は変わらない', before.overlays === after.overlays);
check('ヘルプ募集一覧の募集枠は変わらない', before.help === after.help);
check('シフトタブの不足表示は変わらない', before.chartReq === after.chartReq);
check('印刷の不足の帯は変わらない', JSON.stringify(before.printMarks) === JSON.stringify(after.printMarks));

// ---- 週間スケジュール: 1行にまとまり、合計は変わらない ----
const monRow = (x, id) => x.week[id].rows.find(r => r.startsWith('9/21(月)'));
const tueRow = (x, id) => x.week[id].rows.find(r => r.startsWith('9/22(火)'));
check('週間スケジュール: 田中 月 9:00〜13:00 と 13:00〜17:00 → 1行', monRow(before, 'e1') === '9/21(月) 09:00〜13:00 13:00〜17:00'
  && monRow(after, 'e1') === '9/21(月) 09:00〜17:00');
check('週間スケジュール: 佐藤 月 22:00〜翌06:00 の1行、火は休み', monRow(after, 'e2') === '9/21(月) 22:00〜翌06:00'
  && tueRow(before, 'e2') === '9/22(火) 03:00〜06:00' && tueRow(after, 'e2') === '9/22(火) 休み');
check('週間スケジュール: 当欠同士は1行（当欠のまま）', after.week.e3.rows.find(r => r.startsWith('9/23(水)')) === '9/23(水) 17:00〜22:00 当欠');
check('週間スケジュール: 休憩は合計して表示', after.week.e5.rows.find(r => r.startsWith('9/25(金)')) === '9/25(金) 06:00〜17:00（休60分）');
for (const e of emps) {
  check(`週間スケジュール: ${e.name}の合計（実働）は変わらない（${after.week[e.id].total.split(': ')[1]}）`,
    before.week[e.id].total === after.week[e.id].total);
}

// ---- シフト表: バーがまとまる ----
check('シフト表: 月の田中は1本（9:00〜）', before.chart['月'].filter(t => t.includes('田中')).length === 2
  && after.chart['月'].filter(t => t.includes('田中')).length === 1);
check('シフト表: 火の佐藤は前日からの1本（前日〜）', before.chart['火'].some(t => t.startsWith('3:00 佐藤'))
  && after.chart['火'].some(t => t.startsWith('前日 佐藤')) && after.chart['火'].filter(t => t.includes('佐藤')).length === 1);
check('シフト表: 木の店長は1本（仮の範囲は残る）', after.chart['木'].filter(t => t.includes('店長')).length === 1
  && w.__state.weeks[W].shifts.find(s => s.empId === 'e4').tentativeStart === 840);
check('シフト表: 水の鈴木（当欠）は1本', after.chart['水'].filter(t => t.includes('鈴木')).length === 1
  && after.chart['水'].find(t => t.includes('鈴木')).includes('当欠'));

// ---- 印刷: バーがまとまる（火の佐藤は前日からの分として残るので -4） ----
check(`印刷: バーが ${before.printBars.length} → ${after.printBars.length} 本`, after.printBars.length === before.printBars.length - 4);
check('印刷: 佐藤の月曜は 22:00〜翌6:00 の1本', after.printBars.filter(t => t.startsWith('22:00佐藤')).length === 1
  && after.printBars.some(t => t === '22:00佐藤翌6:00'));

finish();
