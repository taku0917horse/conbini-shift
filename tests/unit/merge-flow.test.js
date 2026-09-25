// 勤務の結合の流れ: 保存時の自動結合 / 起動時に一度だけの結合（バックアップの案内）/ JSON 読み込み時の結合
const { boot, check, finish } = require('../helpers/harness');

const W = '2026-09-21';
const emp = { id: 'e1', name: '田中', color: '#2563eb', category: '日勤' };
const emp2 = { id: 'e2', name: '佐藤', color: '#16a34a', category: '夜勤' };
let n = 0;
const sh = (empId, day, startMin, endMin, extra = {}) =>
  ({ id: 'x' + (n++), empId, day, startMin, endMin, breakMin: 0, tentativeStart: null, tentativeEnd: null, absent: false, ...extra });
const brief = list => list.map(s => `${s.empId}:${s.day}:${s.startMin}-${s.endMin}`).sort().join(' ');

// localStorage の中身をそのまま引き継いで起動し直す
function reboot(w) {
  const seed = {};
  for (let i = 0; i < w.localStorage.length; i++) {
    const k = w.localStorage.key(i);
    seed[k] = JSON.parse(w.localStorage.getItem(k));
  }
  return boot(seed);
}
const modalOpen = $ => !$('modal-merge').classList.contains('hidden');

// ---- 保存時の自動結合 ----
{
  const { w, $ } = boot({ employees: [emp], templateShifts: [], weeks: { [W]: { createdAt: 'x', shifts: [] } }, requirements: [], shiftMergeDone: true });
  const add = (day, st, en, brk = '0') => {
    w.openShiftModal(null, { day, startMin: 0, endMin: 60 });
    $('shift-start').value = st; $('shift-end').value = en; $('shift-break').value = brk;
    $('btn-shift-save').click();
  };
  add('月', '03:00', '06:00');
  add('月', '06:00', '09:00', '15');
  const list = () => w.__state.weeks[W].shifts;
  check('保存時: 3:00〜6:00 + 6:00〜9:00 → 3:00〜9:00', brief(list()) === 'e1:月:0-360' && list()[0].breakMin === 15);
  check('保存時: localStorage にもまとめて保存', JSON.parse(w.localStorage.getItem('weeks'))[W].shifts.length === 1);
  check('保存時: シフト表のバーも1本', (w.document.querySelector('.day-tab[data-day="月"]').click(), w.document.querySelectorAll('.shift-bar').length === 1));

  add('月', '12:00', '15:00');
  const target = list().find(s => s.startMin === 540);
  w.openShiftModal(target.id);
  $('shift-start').value = '09:00';
  $('btn-shift-save').click();
  check('編集してつながった勤務もまとめる（3:00〜15:00）', brief(list()) === 'e1:月:0-720');

  add('月', '16:00', '17:00');
  check('つながらない勤務はそのまま', brief(list()) === 'e1:月:0-720 e1:月:780-840');

  // 夜勤: 月 22:00〜翌3:00 と 火 3:00〜6:00 → 月 22:00〜翌6:00
  add('月', '22:00', '03:00');
  add('火', '03:00', '06:00');
  check('日付の境目もまとめる（月 22:00〜翌6:00）', list().some(s => s.day === '月' && s.startMin === 1140 && s.endMin === 1620)
    && !list().some(s => s.day === '火'));
}
{
  // テンプレート: 日曜 22:00〜翌3:00 と 月曜 3:00〜6:00 → 日曜 22:00〜翌6:00
  const { w, $ } = boot({ employees: [emp], templateShifts: [], weeks: {}, requirements: [], shiftMergeDone: true });
  $('btn-mode-toggle').click();
  for (const [day, st, en] of [['日', '22:00', '03:00'], ['月', '03:00', '06:00']]) {
    w.openShiftModal(null, { day, startMin: 0, endMin: 60 });
    $('shift-start').value = st; $('shift-end').value = en;
    $('btn-shift-save').click();
  }
  check('テンプレート: 日曜→月曜もまとめる', brief(w.__state.templateShifts) === 'e1:日:1140-1620');
}

// ---- 保存時: まとめて16時間を超えるときは確認 ----
{
  const setup = () => {
    const r = boot({ employees: [emp], templateShifts: [], weeks: { [W]: { createdAt: 'x', shifts: [] } }, requirements: [], shiftMergeDone: true });
    r.confirms = [];
    r.w.confirm = m => { r.confirms.push(m); return r.answer; };
    r.add = (day, st, en) => {
      r.w.openShiftModal(null, { day, startMin: 0, endMin: 60 });
      r.$('shift-start').value = st; r.$('shift-end').value = en;
      r.$('btn-shift-save').click();
    };
    r.list = () => r.w.__state.weeks[W].shifts;
    return r;
  };
  {
    const r = setup();
    r.answer = true;
    r.add('月', '03:00', '06:00');
    r.add('月', '06:00', '09:00');
    check('16時間以内の結合は確認なし', r.confirms.length === 0 && brief(r.list()) === 'e1:月:0-360');
  }
  {
    const r = setup();
    r.answer = true;
    r.add('月', '09:00', '22:00');
    r.add('月', '22:00', '06:00');
    check('16時間を超える結合は確認（文言）', r.confirms.length === 1
      && r.confirms[0] === '田中さんの勤務がつながって21時間になります。まとめますか?');
    check('OK ならまとめる（9:00〜翌6:00）', brief(r.list()) === 'e1:月:360-1620');
  }
  {
    const r = setup();
    r.answer = false;
    r.add('月', '09:00', '22:00');
    r.add('月', '22:00', '06:00');
    check('キャンセルならまとめずに保存（入力した勤務は残る）', brief(r.list()) === 'e1:月:1140-1620 e1:月:360-1140');
  }
  {
    // キャンセルしても、16時間以内の結合はする（3:00〜9:00 はまとまり、9:00〜22:00 とはまとめない）
    const r = setup();
    r.answer = true;
    r.add('月', '03:00', '06:00');
    r.add('月', '09:00', '22:00');
    r.answer = false;
    r.add('月', '06:00', '09:00');
    check('キャンセル: 16時間以内の結合だけする', r.confirms.length === 1 && brief(r.list()) === 'e1:月:0-360 e1:月:360-1140');
  }
}

// ---- 起動時に一度だけ ----
const splitSeed = () => ({
  employees: [emp, emp2],
  templateShifts: [sh('e1', '月', 0, 180), sh('e1', '月', 180, 360), sh('e2', '日', 1140, 1440), sh('e2', '月', 0, 180)],
  weeks: {
    [W]: { createdAt: 'x', shifts: [sh('e1', '水', 360, 600), sh('e1', '水', 600, 840), sh('e2', '水', 1140, 1440), sh('e2', '木', 0, 180)] },
    '2026-09-28': { createdAt: 'x', shifts: [sh('e1', '月', 360, 840)] },
  },
  requirements: [],
});
{
  let { w, $, alerts } = boot(splitSeed());
  check('起動時: 分かれた勤務があれば案内を出す', modalOpen($));
  check('起動時: まとめられる箇所の数（テンプレート2 + 週2）', $('merge-count').textContent === '4');
  $('btn-merge-later').click();
  check('「今はしない」: 案内を閉じる', !modalOpen($));
  check('「今はしない」: データは変えない', w.__state.templateShifts.length === 4 && w.__state.weeks[W].shifts.length === 4);
  check('「今はしない」: 済みの印は付けない', w.localStorage.getItem('shiftMergeDone') === null);

  ({ w, $, alerts } = reboot(w));
  check('次の起動でもう一度聞く', modalOpen($));
  $('btn-merge-run').click();
  check('「まとめる」: テンプレート', brief(w.__state.templateShifts) === 'e1:月:0-360 e2:日:1140-1620');
  check('「まとめる」: 週', brief(w.__state.weeks[W].shifts) === 'e1:水:360-840 e2:水:1140-1620');
  check('「まとめる」: ほかの週はそのまま', w.__state.weeks['2026-09-28'].shifts.length === 1);
  check('「まとめる」: 件数を知らせる', alerts.at(-1) === '分かれていた勤務を 4 か所まとめました。');
  check('「まとめる」: 案内を閉じて済みの印', !modalOpen($) && JSON.parse(w.localStorage.getItem('shiftMergeDone')) === true);
  check('「まとめる」: localStorage にも保存', JSON.parse(w.localStorage.getItem('templateShifts')).length === 2);

  ({ w, $ } = reboot(w));
  check('済みなら次から案内は出ない', !modalOpen($));
}
{
  // 「書き出してからまとめる」: JSON を書き出してから結合する
  const { w, $ } = boot(splitSeed());
  const downloads = [];
  w.URL.createObjectURL = () => 'blob:test';
  w.URL.revokeObjectURL = () => {};
  w.HTMLAnchorElement.prototype.click = function () {
    downloads.push({ name: this.download, templateLen: w.__state.templateShifts.length });
  };
  $('btn-merge-export').click();
  check('「書き出してからまとめる」: まとめる前のデータを書き出す', downloads.length === 1
    && /^conbini-shift-\d{8}-\d{4}\.json$/.test(downloads[0].name) && downloads[0].templateLen === 4);
  check('「書き出してからまとめる」: その後まとめる', w.__state.templateShifts.length === 2 && !modalOpen($));
}
{
  const { w, $ } = boot({ employees: [emp], templateShifts: [sh('e1', '月', 0, 180)], weeks: {}, requirements: [] });
  check('分かれた勤務がなければ案内は出さず、済みの印だけ付ける', !modalOpen($)
    && JSON.parse(w.localStorage.getItem('shiftMergeDone')) === true);
}

// ---- JSON の読み込み ----
{
  const { w, $, alerts } = boot({ employees: [emp], templateShifts: [], weeks: {}, requirements: [], shiftMergeDone: true });
  const payload = { version: 2, exportedAt: '2026-09-20T00:00:00.000Z', data: splitSeed() };
  const file = new w.File([JSON.stringify(payload)], 'backup.json', { type: 'application/json' });
  w.handleImport(file);
  setTimeout(() => {
    check('JSON 読み込み: 分かれた勤務をまとめる', brief(w.__state.templateShifts) === 'e1:月:0-360 e2:日:1140-1620'
      && brief(w.__state.weeks[W].shifts) === 'e1:水:360-840 e2:水:1140-1620');
    check('JSON 読み込み: まとめた数を知らせる', alerts.at(-1) === '読み込みが完了しました\n（分かれていた勤務を 4 か所まとめました）');
    check('JSON 読み込み: まとめた形で保存', JSON.parse(w.localStorage.getItem('templateShifts')).length === 2);
    finish();
  }, 200);
}
