// 時間帯（区分）の定義の統合と、リストの絞り込みの基準
const { boot, check, finish } = require('../helpers/harness');

const emp  = { id: 'e1', name: '田中', color: '#2563eb', category: '夜勤', isManager: true };
const W = '2026-09-21';
const { w, $ } = boot({
  employees: [emp], templateShifts: [],
  weeks: { [W]: { createdAt: 'x', shifts: [] } },
  requirements: [
    { id: 'n', day: '月', startMin: 1140, endMin: 1620, count: 1 }, // 月 22:00〜翌6:00
    { id: 'm', day: '水', startMin: 300,  endMin: 420,  count: 1 }, // 水 8:00〜10:00
  ],
});
const ev = x => w.eval(x);

// --- 定義から作られるもの ---
check('区分', JSON.stringify(ev('CATEGORIES')) === '["明朝","早朝","日勤","夕勤","夜勤"]');
check('絞り込みの表記', JSON.stringify(ev('FILTER_BANDS').map(b => b.label)) ===
  '["すべて","明朝 3–6","早朝 6–9","日勤 9–17","夕勤 17–22","夜勤 22–翌3"]');
check('入力画面の帯ボタン（区分から作る）', JSON.stringify([...w.document.querySelectorAll('#preset-buttons .band-btn')].map(b => b.textContent)) ===
  '["明朝 3–6","早朝 6–9","日勤 9–17","夕勤 17–22","夜勤 22–翌3"]');
check('よく使う時間のボタン', JSON.stringify(ev('EXTRA_TIME_PRESETS').map(p => p.label)) === '["9–13","13–17"]');
check('印刷ボタン', JSON.stringify(ev('PRINT_PRESETS').map(p => p.label)) ===
  '["全日","明朝 3–6","早朝 6–9","日勤 9–17","夕勤 17–22","夜勤 22–翌3"]');
check('境目', JSON.stringify([...ev('BAND_BOUNDARY_MIN')]) === '[0,180,360,840,1140,1440]');

// --- 生成されたボタン ---
check('不足リストの絞り込みボタン 6個', w.document.querySelectorAll('#shortage-filter-bar .shortage-filter-btn').length === 6);
check('募集中リストの絞り込みボタン 6個', w.document.querySelectorAll('#tentative-filter-bar .tentative-filter-btn').length === 6);
check('区分ボタン 5個', [...w.document.querySelectorAll('#category-buttons .cat-btn')].map(b => b.dataset.cat).join() === '明朝,早朝,日勤,夕勤,夜勤');
w.openEmpModal();
w.document.querySelector('.cat-btn[data-cat="夜勤"]').click();
check('区分ボタンで選べる', w.document.querySelector('.cat-btn[data-cat="夜勤"]').classList.contains('active'));
$('btn-emp-cancel').click();

// --- シフト表の太線（3/6/9/17/22/翌3時。13時は太字にしない） ---
const bold = [...w.document.querySelectorAll('#time-labels .time-label-bold')].map(e => e.textContent);
check('シフト表の太字の時刻', JSON.stringify(bold) === '["03:00","06:00","09:00","17:00","22:00","翌03:00"]');

// --- 入力ボタン（詳しい動きは band-picker.test.js） ---
w.openShiftModal(); // 既定の 9:00〜17:00 で「日勤」が選ばれた状態で開く
w.document.querySelector('#preset-buttons .band-clear').click();
w.document.querySelector('#preset-buttons .band-btn[data-band="night"]').click();
check('夜勤 → 22:00 / 03:00', $('shift-start').value === '22:00' && $('shift-end').value === '03:00');
$('btn-shift-cancel').click();

// --- 不足リストの絞り込み（重なる部分を表示） ---
function listFor(filterId) {
  w.switchView('requirements');
  w.document.querySelector(`.shortage-filter-btn[data-band="${filterId}"]`).click();
  return [...$('shortage-list').querySelectorAll('.shortage-section')].map(sec =>
    sec.querySelector('.shortage-day-title').textContent + ' ' +
    [...sec.querySelectorAll('.shortage-time')].map(e => e.textContent).join(','));
}
check('すべて', JSON.stringify(listFor('all')) === '["9/21(月) 22:00〜翌06:00","9/23(水) 08:00〜10:00"]');
check('早朝: 重なる部分 8〜9時', JSON.stringify(listFor('morn')) === '["9/23(水) 08:00〜09:00"]');
check('日勤: 重なる部分 9〜10時', JSON.stringify(listFor('day')) === '["9/23(水) 09:00〜10:00"]');
check('夜勤: 22:00〜翌3:00 まで', JSON.stringify(listFor('night')) === '["9/21(月) 22:00〜翌03:00"]');
check('明朝: 翌3:00以降は翌日の明朝', JSON.stringify(listFor('dawn')) === '["9/22(火) 03:00〜06:00"]');
check('夕勤: なし', $('shortage-list').textContent.includes('明朝') || listFor('eve').length === 0);

// 明朝で絞り込んだ行から追加 → 火曜 3:00〜6:00 で保存
listFor('dawn');
$('shortage-list').querySelector('.shortage-row').click();
$('btn-shift-save').click();
const added = w.__state.weeks[W].shifts.at(-1);
check('明朝の行から追加 → 火 0〜180', added.day === '火' && added.startMin === 0 && added.endMin === 180);

// --- 募集中リストの絞り込み ---
w.__state.weeks[W].shifts = [{ id: 't', empId: 'e1', day: '月', startMin: 1140, endMin: 1620, breakMin: 0,
  tentativeStart: 1440, tentativeEnd: 1560, absent: false }]; // 仮: 翌3:00〜翌5:00
function tentFor(filterId) {
  w.switchView('requirements');
  w.document.querySelector(`.tentative-filter-btn[data-band="${filterId}"]`).click();
  return [...$('tentative-list').querySelectorAll('.shortage-section')].map(sec =>
    sec.querySelector('.shortage-day-title').textContent + ' ' +
    [...sec.querySelectorAll('.shortage-time')].map(e => e.textContent).join(','));
}
check('募集中 すべて: 月の翌3〜翌5', JSON.stringify(tentFor('all')) === '["9/21(月) 翌03:00〜翌05:00"]');
check('募集中 明朝: 火の 3〜5', JSON.stringify(tentFor('dawn')) === '["9/22(火) 03:00〜05:00"]');
check('募集中 夜勤: 該当なし', tentFor('night').length === 0);

// --- 印刷の太線（13時は太字にしない） ---
const ps = w.eval('printSettings');
ps.kind = 'shift'; ps.startMin = 360; ps.endMin = 1140; ps.weeks = 1; ps.orient = 'portrait';
w.switchView('print');
const pbold = [...w.document.querySelectorAll('#print-preview .bg-axis-lbl.bold')].map(e => e.textContent);
check('印刷の太字 9/17/22時（13時なし）', JSON.stringify(pbold) === '["9:00","17:00","22:00"]');
[...w.document.querySelectorAll('#print-preset-seg button')].find(b => b.textContent === '夜勤 22–翌3').click();
check('印刷ボタン 夜勤 → 1140〜1440', ps.startMin === 1140 && ps.endMin === 1440);

finish();
