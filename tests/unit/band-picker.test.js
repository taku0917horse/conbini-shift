// 入力画面の時間帯の帯（複数選択）: つながる帯は範囲を広げ、つながらない帯はその帯だけに切り替える
const { boot, check, finish } = require('../helpers/harness');

const W = '2026-09-21';
const emp = { id: 'e1', name: '田中', color: '#2563eb', category: '日勤' };
const { w, $ } = boot({ employees: [emp], templateShifts: [], weeks: { [W]: { createdAt: 'x', shifts: [] } }, requirements: [], shiftMergeDone: true });

const btn    = (wrap, id) => w.document.querySelector(`#${wrap} .band-btn[data-band="${id}"]`);
const active = wrap => [...w.document.querySelectorAll(`#${wrap} .band-btn.active`)].map(b => b.dataset.band).join(',');
const S = 'preset-buttons';
const tap = id => btn(S, id).click();
const times = () => `${$('shift-start').value}-${$('shift-end').value}`;
const info = () => $('shift-range-info').textContent;
const setTimes = (st, en) => {
  $('shift-start').value = st; $('shift-end').value = en;
  $('shift-end').dispatchEvent(new w.Event('input'));
};

// ---- 新しい勤務は何も選んでいない状態で開く ----
w.openShiftModal();
check('新規: 何も選んでいない・時刻も空欄', active(S) === '' && times() === '-' && info() === '');
check('押せない帯はない', w.document.querySelectorAll(`#${S} .band-btn:disabled`).length === 0);

// ---- 1タップで選べる ----
tap('eve');
check('1タップで夕勤 → 17:00〜22:00', active(S) === 'eve' && times() === '17:00-22:00' && info() === '17:00〜22:00（5時間）');
w.openShiftModal();
tap('night');
check('1タップで夜勤 → 22:00〜翌3:00', active(S) === 'night' && times() === '22:00-03:00' && info() === '22:00〜翌3:00（5時間）');

// ---- つながる帯は範囲を広げる ----
w.openShiftModal();
tap('dawn');
tap('morn');
check('明朝＋早朝 → 3:00〜9:00（6時間）', active(S) === 'dawn,morn' && times() === '03:00-09:00' && info() === '3:00〜9:00（6時間）');
tap('day');
check('＋日勤 → 3:00〜17:00', active(S) === 'dawn,morn,day' && times() === '03:00-17:00');

// ---- つながらない帯はその帯だけに切り替える（クリアしなくてよい） ----
tap('night');
check('3:00〜17:00 を選んだまま夜勤を1タップ → 夜勤だけ', active(S) === 'night' && times() === '22:00-03:00');
tap('dawn');
check('夜勤＋明朝 → 22:00〜翌6:00（日付の境目もつながる）', active(S) === 'dawn,night' && times() === '22:00-06:00' && info() === '22:00〜翌6:00（8時間）');
tap('morn');
check('翌6:00を超える（早朝）→ 早朝だけに切り替え', active(S) === 'morn' && times() === '06:00-09:00');
tap('eve');
check('離れた夕勤を1タップ → 夕勤だけ', active(S) === 'eve' && times() === '17:00-22:00');

// 4つ選んでから5つ目（24時間になる）→ その帯だけ
tap('day'); tap('morn'); tap('dawn');
check('明朝〜夕勤の4つ → 3:00〜22:00', active(S) === 'dawn,morn,day,eve' && info() === '3:00〜22:00（19時間）');
tap('night');
check('5つ目（24時間）を押すと夜勤だけ', active(S) === 'night');

// ---- 外す ----
tap('eve'); tap('day');
check('日勤＋夕勤＋夜勤 → 9:00〜翌3:00', active(S) === 'day,eve,night' && times() === '09:00-03:00');
tap('night');
check('端（夜勤）を押すと外す → 9:00〜22:00', active(S) === 'day,eve' && times() === '09:00-22:00');
tap('day');
check('端（日勤）を押すと外す → 17:00〜22:00', active(S) === 'eve' && times() === '17:00-22:00');
tap('day'); tap('night');
tap('eve');
check('真ん中（夕勤）を押すと夕勤だけ', active(S) === 'eve' && times() === '17:00-22:00');
tap('eve');
check('1つだけのときに押すと選択なし（時刻はそのまま）', active(S) === '' && times() === '17:00-22:00');
tap('dawn'); tap('morn');
w.document.querySelector(`#${S} .band-clear`).click();
check('クリア: 選択を外す（時刻はそのまま）', active(S) === '' && times() === '03:00-09:00');

// ---- 時刻の手直し ----
setTimes('03:00', '09:30');
check('手直し: 帯と一致しなければ選択なし、表示は追従', active(S) === '' && info() === '3:00〜9:30（6時間30分）');
setTimes('06:00', '17:00');
check('手直し: 帯と一致すれば選択状態に（早朝＋日勤）', active(S) === 'morn,day');
tap('dawn');
check('手直し後もつながる帯で広げられる（3:00〜17:00）', active(S) === 'dawn,morn,day' && times() === '03:00-17:00');
setTimes('22:00', '06:00');
check('手直し: 22:00〜06:00 は夜勤＋明朝', active(S) === 'dawn,night');
setTimes('09:00', '09:00');
check('手直し: 同じ時刻は表示なし', info() === '' && active(S) === '');

// ---- よく使う時間 ----
[...w.document.querySelectorAll(`#${S} .band-extra .preset-btn`)].find(b => b.textContent === '13–17').click();
check('よく使う時間 13–17 → 13:00〜17:00（帯は選ばない）', times() === '13:00-17:00' && active(S) === '' && info() === '13:00〜17:00（4時間）');
tap('eve');
check('そこから夕勤を1タップ → 夕勤だけ', active(S) === 'eve' && times() === '17:00-22:00');

// ---- 保存 ----
w.openShiftModal();
$('btn-shift-save').click();
check('何も選ばずに保存 → 理由を表示して保存しない', w.__state.weeks[W].shifts.length === 0);
tap('dawn'); tap('morn');
$('btn-shift-save').click();
const saved = w.__state.weeks[W].shifts;
check('保存: 明朝＋早朝で 3:00〜9:00 の勤務1つ', saved.length === 1 && saved[0].startMin === 0 && saved[0].endMin === 360);

w.openShiftModal(null, { day: '火', startMin: 1140, endMin: 1620 });
check('不足リストなどから開いた時刻（22:00〜翌6:00）に合わせて選択', active(S) === 'dawn,night');
$('btn-shift-save').click();
check('保存: 夜勤＋明朝で 22:00〜翌6:00', saved.some(s => s.day === '火' && s.startMin === 1140 && s.endMin === 1620));

w.openShiftModal(saved.find(s => s.day === '火').id);
check('編集で開くと保存済みの時刻に合わせて選択', active(S) === 'dawn,night' && info() === '22:00〜翌6:00（8時間）');
$('btn-shift-cancel').click();

// ---- 必要人数ルールの入力画面も同じ部品 ----
const R = 'req-preset-buttons';
w.openReqModal();
check('ルール: 既定の 9:00〜17:00 は日勤', active(R) === 'day' && $('req-range-info').textContent === '9:00〜17:00（8時間）');
btn(R, 'night').click();
check('ルール: 夜勤を1タップ → 夜勤だけ', active(R) === 'night' && $('req-start').value === '22:00' && $('req-end').value === '03:00');
btn(R, 'eve').click();
check('ルール: 夕勤＋夜勤 → 17:00〜翌3:00', active(R) === 'eve,night' && $('req-range-info').textContent === '17:00〜翌3:00（10時間）');
$('btn-req-save').click();
const rule = w.__state.requirements.at(-1);
check('ルール: 保存 840〜1440', rule.startMin === 840 && rule.endMin === 1440);
w.openReqModal(rule.id);
check('ルール: 編集で開くと選択を合わせる', active(R) === 'eve,night');

finish();
