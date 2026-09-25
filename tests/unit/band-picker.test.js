// 入力画面の時間帯の帯（複数選択）: つながる帯だけ選べる・範囲の表示・時刻の手直し・保存
const { boot, check, finish } = require('../helpers/harness');

const W = '2026-09-21';
const emp = { id: 'e1', name: '田中', color: '#2563eb', category: '日勤' };
const { w, $ } = boot({ employees: [emp], templateShifts: [], weeks: { [W]: { createdAt: 'x', shifts: [] } }, requirements: [], shiftMergeDone: true });

const btn    = (wrap, id) => w.document.querySelector(`#${wrap} .band-btn[data-band="${id}"]`);
const active = wrap => [...w.document.querySelectorAll(`#${wrap} .band-btn.active`)].map(b => b.dataset.band).join(',');
const disabled = wrap => [...w.document.querySelectorAll(`#${wrap} .band-btn:disabled`)].map(b => b.dataset.band).join(',');
const S = 'preset-buttons';
const setTimes = (st, en) => {
  $('shift-start').value = st; $('shift-end').value = en;
  $('shift-end').dispatchEvent(new w.Event('input'));
};

// ---- 開いたとき ----
w.openShiftModal();
check('新規: 既定の 9:00〜17:00 は「日勤」が選ばれた状態', active(S) === 'day' && $('shift-range-info').textContent === '9:00〜17:00（8時間）');
check('新規: つながる帯（早朝・夕勤）と日勤だけ押せる', disabled(S) === 'dawn,night');

// ---- つながる帯を足していく ----
w.document.querySelector(`#${S} .band-clear`).click();
check('クリア: 選択を外す（時刻はそのまま）', active(S) === '' && disabled(S) === '' && $('shift-start').value === '09:00');
btn(S, 'dawn').click();
check('明朝 → 3:00〜6:00', $('shift-start').value === '03:00' && $('shift-end').value === '06:00'
  && $('shift-range-info').textContent === '3:00〜6:00（3時間）');
btn(S, 'morn').click();
check('明朝＋早朝 → 3:00〜9:00（6時間）', active(S) === 'dawn,morn' && $('shift-start').value === '03:00' && $('shift-end').value === '09:00'
  && $('shift-range-info').textContent === '3:00〜9:00（6時間）');
check('つながらない帯（夕勤）と、翌6:00を超える夜勤は押せない', disabled(S) === 'eve,night');
btn(S, 'eve').click();
check('押せない帯を押しても変わらない', active(S) === 'dawn,morn');
btn(S, 'day').click();
check('明朝＋早朝＋日勤 → 3:00〜17:00', $('shift-end').value === '17:00' && $('shift-range-info').textContent === '3:00〜17:00（14時間）');
check('真ん中の帯（早朝）は外せない', btn(S, 'morn').disabled && !btn(S, 'dawn').disabled && !btn(S, 'day').disabled);
btn(S, 'dawn').click();
check('端の帯（明朝）は外せる → 6:00〜17:00', active(S) === 'morn,day' && $('shift-start').value === '06:00' && $('shift-end').value === '17:00');
btn(S, 'eve').click();
btn(S, 'dawn').click();
check('4つ（明朝〜夕勤）→ 3:00〜22:00', active(S) === 'dawn,morn,day,eve' && $('shift-range-info').textContent === '3:00〜22:00（19時間）');
check('5つ全部（24時間）は選べない', btn(S, 'night').disabled);

// ---- 夜勤→明朝（日付の境目）----
w.document.querySelector(`#${S} .band-clear`).click();
btn(S, 'night').click();
check('夜勤 → 22:00〜翌3:00', $('shift-start').value === '22:00' && $('shift-end').value === '03:00'
  && $('shift-range-info').textContent === '22:00〜翌3:00（5時間）');
btn(S, 'dawn').click();
check('夜勤＋明朝 → 22:00〜翌6:00（8時間）', active(S) === 'dawn,night' && $('shift-end').value === '06:00'
  && $('shift-range-info').textContent === '22:00〜翌6:00（8時間）');
check('夜勤＋明朝に早朝は足せない（翌9:00になる）', btn(S, 'morn').disabled && !btn(S, 'eve').disabled);
btn(S, 'eve').click();
check('夕勤＋夜勤＋明朝 → 17:00〜翌6:00', $('shift-start').value === '17:00' && $('shift-range-info').textContent === '17:00〜翌6:00（13時間）');

// ---- 時刻の手直し ----
setTimes('03:00', '09:30');
check('手直し: 帯と一致しなければ選択なし、表示は追従', active(S) === '' && $('shift-range-info').textContent === '3:00〜9:30（6時間30分）');
setTimes('06:00', '17:00');
check('手直し: 帯と一致すれば選択状態に（早朝＋日勤）', active(S) === 'morn,day');
setTimes('22:00', '06:00');
check('手直し: 22:00〜06:00 は夜勤＋明朝', active(S) === 'dawn,night');
setTimes('09:00', '09:00');
check('手直し: 同じ時刻は表示なし', $('shift-range-info').textContent === '' && active(S) === '');

// ---- よく使う時間 ----
[...w.document.querySelectorAll(`#${S} .band-extra .preset-btn`)].find(b => b.textContent === '13–17').click();
check('よく使う時間 13–17 → 13:00〜17:00（帯は選ばない）', $('shift-start').value === '13:00' && $('shift-end').value === '17:00'
  && active(S) === '' && $('shift-range-info').textContent === '13:00〜17:00（4時間）');

// ---- 保存 ----
w.document.querySelector(`#${S} .band-clear`).click();
btn(S, 'dawn').click();
btn(S, 'morn').click();
$('btn-shift-save').click();
const saved = w.__state.weeks[W].shifts;
check('保存: 明朝＋早朝で 3:00〜9:00 の勤務1つ', saved.length === 1 && saved[0].startMin === 0 && saved[0].endMin === 360);

w.openShiftModal(null, { day: '火', startMin: 1140, endMin: 1620 });
check('不足リストなどから開いた時刻（22:00〜翌6:00）に合わせて選択', active(S) === 'dawn,night');
$('btn-shift-save').click();
check('保存: 夜勤＋明朝で 22:00〜翌6:00', saved.some(s => s.day === '火' && s.startMin === 1140 && s.endMin === 1620));

w.openShiftModal(saved.find(s => s.day === '火').id);
check('編集で開くと保存済みの時刻に合わせて選択', active(S) === 'dawn,night' && $('shift-range-info').textContent === '22:00〜翌6:00（8時間）');
$('btn-shift-cancel').click();

// ---- 必要人数ルールの入力画面も同じ ----
const R = 'req-preset-buttons';
w.openReqModal();
check('ルール: 既定の 9:00〜17:00 は日勤', active(R) === 'day' && $('req-range-info').textContent === '9:00〜17:00（8時間）');
btn(R, 'eve').click();
btn(R, 'night').click();
check('ルール: 日勤＋夕勤＋夜勤 → 9:00〜翌3:00', $('req-start').value === '09:00' && $('req-end').value === '03:00'
  && $('req-range-info').textContent === '9:00〜翌3:00（18時間）');
$('btn-req-save').click();
const rule = w.__state.requirements.at(-1);
check('ルール: 保存 360〜1440', rule.startMin === 360 && rule.endMin === 1440);
w.openReqModal(rule.id);
check('ルール: 編集で開くと選択を合わせる', active(R) === 'day,eve,night');

finish();
