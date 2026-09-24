// 夜通しの不足（不足リストの重複・行から追加した時刻）/ 夜勤の仮範囲 / 起動時の曜日タブ
const { boot, check, finish } = require('../helpers/harness');

const emp  = { id: 'e1', name: '田中', color: '#2563eb', category: '夜勤', isManager: true };
const emp2 = { id: 'e2', name: '佐藤', color: '#16a34a', category: '早朝' };
const night = d => ({ id: 'r' + d, day: d, startMin: 1140, endMin: 1620, count: 1 }); // 22:00〜翌6:00
const W = '2026-09-21', NEXT = '2026-09-28';

function rows(w, $) {
  w.switchView('requirements');
  return [...$('shortage-list').querySelectorAll('.shortage-section')].map(sec => ({
    title: sec.querySelector('.shortage-day-title').textContent,
    times: [...sec.querySelectorAll('.shortage-time')].map(e => e.textContent),
    rowEls: [...sec.querySelectorAll('.shortage-row')],
  }));
}

// --- 1. 同じ時間が2回出ない / 夜通しの不足は前日の行に 22:00〜翌6:00 ---
{
  const { w, $ } = boot({ employees: [emp, emp2], templateShifts: [], weeks: { [W]: { createdAt: 'x', shifts: [] } },
    requirements: ['月', '火'].map(night) });
  const r = rows(w, $);
  const mon = r.find(x => x.title.startsWith('9/21')), tue = r.find(x => x.title.startsWith('9/22')),
        wed = r.find(x => x.title.startsWith('9/23'));
  check('月: 22:00〜翌06:00', JSON.stringify(mon.times) === '["22:00〜翌06:00"]');
  check('火: 3:00〜6:00 が重複しない', JSON.stringify(tue.times) === '["22:00〜翌06:00"]');
  check('水: 前日から延ばした分は出ない', !wed);

  // --- 2. 行をタップして追加 → 22:00〜翌6:00 で保存 ---
  mon.rowEls[0].click();
  check('prefill 22:00 / 06:00', $('shift-start').value === '22:00' && $('shift-end').value === '06:00');
  $('btn-shift-save').click();
  const s = w.__state.weeks[W].shifts[0];
  check('保存: 月 1140〜1620', s.day === '月' && s.startMin === 1140 && s.endMin === 1620);
  const after = rows(w, $);
  check('追加後は月の不足が消える', !after.some(x => x.title.startsWith('9/21')));
}

// --- 翌日の早朝シフトで埋まっていれば、前日の行は翌3:00まで ---
{
  const { w, $ } = boot({ employees: [emp, emp2], templateShifts: [],
    weeks: { [W]: { createdAt: 'x', shifts: [{ id: 'a', empId: 'e2', day: '火', startMin: 0, endMin: 180, breakMin: 0 }] } },
    requirements: [night('月')] });
  const mon = rows(w, $).find(x => x.title.startsWith('9/21'));
  check('翌日早朝が埋まっていれば 22:00〜翌03:00', JSON.stringify(mon.times) === '["22:00〜翌03:00"]');
}

// --- 日曜: 翌週が未作成なら翌6:00まで / 翌週があれば翌週月曜の早朝と重複しない ---
{
  const { w, $ } = boot({ employees: [emp], templateShifts: [], weeks: { [W]: { createdAt: 'x', shifts: [] } },
    requirements: [night('日')] });
  const sun = rows(w, $).find(x => x.title.startsWith('9/27'));
  check('日曜（翌週未作成）: 22:00〜翌06:00', JSON.stringify(sun.times) === '["22:00〜翌06:00"]');
  w.__state.weeks[NEXT] = { createdAt: 'x', shifts: [] };
  const sun2 = rows(w, $).find(x => x.title.startsWith('9/27'));
  check('日曜（翌週あり）: 22:00〜翌06:00', JSON.stringify(sun2.times) === '["22:00〜翌06:00"]');
  w.__state.currentWeek = NEXT;
  const nextMon = rows(w, $).find(x => x.title.startsWith('9/28'));
  check('翌週の月曜に 3:00〜6:00 が重複しない', !nextMon);
}

// --- テンプレート: 日曜→月曜は循環 ---
{
  const { w, $ } = boot({ employees: [emp], templateShifts: [], weeks: {}, requirements: [night('日')] });
  w.__state.mode = 'template';
  const r = rows(w, $);
  check('テンプレート: 日曜 22:00〜翌06:00', JSON.stringify(r.find(x => x.title === '日曜日').times) === '["22:00〜翌06:00"]');
  check('テンプレート: 月曜に重複しない', !r.some(x => x.title === '月曜日'));
}

// --- 3. 夜勤の仮（募集中）の範囲 ---
{
  const { w, $, alerts } = boot({ employees: [emp], templateShifts: [], weeks: { [W]: { createdAt: 'x', shifts: [] } }, requirements: [] });
  const add = (ts, te) => {
    w.openShiftModal(null, { day: '月', startMin: 1140, endMin: 1620 });
    $('tentative-start').value = ts; $('tentative-end').value = te;
    $('btn-shift-save').click();
    return w.__state.weeks[W].shifts.at(-1);
  };
  const a = add('04:00', '05:00');
  check('翌4:00〜翌5:00 → 1500〜1560', a.tentativeStart === 1500 && a.tentativeEnd === 1560);
  const b = add('22:00', '03:00');
  check('22:00〜翌3:00 → 1140〜1440', b.tentativeStart === 1140 && b.tentativeEnd === 1440);
  const n = w.__state.weeks[W].shifts.length;
  add('07:00', '08:00');
  check('勤務時間外はエラーで保存しない', w.__state.weeks[W].shifts.length === n && alerts.at(-1).includes('勤務時間の範囲内'));
  // 以前の形式で保存されたデータ（翌4:00 が 60 として保存）は読み替える
  const legacy = { startMin: 1140, endMin: 1620, tentativeStart: 60, tentativeEnd: 120 };
  const r = w.getTentativeRange(legacy);
  check('以前の保存形式を読み替え', r.start === 1500 && r.end === 1560);
  const day = w.getTentativeRange({ startMin: 360, endMin: 1140, tentativeStart: 840, tentativeEnd: 1140 });
  check('日勤の仮範囲はそのまま', day.start === 840 && day.end === 1140);
}

// --- 4. 今日（木曜）のタブを選ぶ ---
{
  const { w, $ } = boot({ employees: [emp], templateShifts: [], weeks: {}, requirements: [] });
  const active = w.document.querySelector('.day-tab.active');
  check('起動時は今日（木）のタブ', active && active.dataset.day === '木' && w.__state.currentDay === '木');
  w.document.querySelector('.day-tab[data-day="月"]').click();
  $('btn-week-next').click();
  check('他の曜日を選んで週送りしても曜日は保持', w.__state.currentDay === '月'
    && w.document.querySelector('.day-tab.active').dataset.day === '月');
  $('btn-week-today').click();
  check('「今週」で今日のタブに戻る', w.__state.currentDay === '木' && w.__state.currentWeek === W
    && w.document.querySelector('.day-tab.active').dataset.day === '木');
}

finish();
