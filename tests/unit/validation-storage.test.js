// 勤務時間の入力チェック（24時間勤務の防止など）/ localStorage に保存できないときの対処
const { boot, check, finish, createWindow, runScript, APP_JS } = require('../helpers/harness');

const emp = { id: 'e1', name: '田中', color: '#2563eb', category: '日勤' };
const W = '2026-09-21';

// ---- 24時間勤務 ----
{
  const { w, $, alerts } = boot({ employees: [emp], templateShifts: [], weeks: { [W]: { createdAt: 'x', shifts: [] } }, requirements: [] });
  const shifts = () => w.__state.weeks[W].shifts;
  const confirms = [];
  let answer = true;
  w.confirm = m => { confirms.push(m); return answer; };
  const tryAdd = (st, en) => {
    w.openShiftModal();
    $('shift-start').value = st; $('shift-end').value = en;
    $('btn-shift-save').click();
  };

  tryAdd('09:00', '09:00');
  check('同じ時刻はエラーで保存しない', shifts().length === 0 && alerts.at(-1).includes('同じ時刻'));
  check('モーダルは開いたまま', !$('modal-shift').classList.contains('hidden'));
  $('btn-shift-cancel').click();

  answer = false;
  tryAdd('09:00', '08:00');
  check('23時間は確認（キャンセルで保存しない）', shifts().length === 0 && confirms.at(-1) === '23時間の勤務になります。よろしいですか?');
  $('btn-shift-cancel').click();
  answer = true;
  tryAdd('09:00', '08:00');
  check('確認でOKなら保存', shifts().length === 1 && shifts()[0].endMin - shifts()[0].startMin === 23 * 60);

  const nConf = confirms.length;
  tryAdd('09:00', '22:00');
  check('13時間は確認なしで保存', shifts().length === 2 && confirms.length === nConf);
  tryAdd('22:00', '06:00');
  // 夜勤そのものは16時間以内なので長時間の確認は出ない。
  // ただし直前の 9:00〜22:00 とつながり、まとめると21時間になるので「まとめますか?」の確認が1回出る（OK → まとまる）
  check('夜勤 22:00〜翌6:00 は長時間の確認なし（結合の確認だけ）', confirms.length === nConf + 1
    && confirms.at(-1) === '田中さんの勤務がつながって21時間になります。まとめますか?'
    && shifts().length === 2 && shifts().some(s => s.startMin === 360 && s.endMin === 1620));

  // 未入力
  w.openShiftModal();
  $('shift-start').value = '';
  $('btn-shift-save').click();
  check('時刻が空なら理由を表示', alerts.at(-1).includes('開始時刻と終了時刻'));
  $('btn-shift-cancel').click();
  w.__state.employees = [];
  w.openShiftModal();
  $('btn-shift-save').click();
  check('従業員がいなければ理由を表示', alerts.at(-1).includes('従業員を選んで'));
}

// ---- localStorage に書き込めない ----
{
  const { w, $, alerts } = boot({ employees: [emp], templateShifts: [], weeks: { [W]: { createdAt: 'x', shifts: [] } }, requirements: [] });
  const quota = () => { const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e; };
  w.Storage.prototype.setItem = quota;
  w.console.error = () => {};
  check('最初は帯なし', $('storage-error').classList.contains('hidden'));
  let threw = null;
  try {
    w.openShiftModal();
    $('shift-start').value = '09:00'; $('shift-end').value = '17:00';
    $('btn-shift-save').click();
  } catch (e) { threw = e; }
  check('保存に失敗しても例外で止まらない', threw === null);
  check('画面上は追加される', w.__state.weeks[W].shifts.length === 1 && w.document.querySelectorAll('.shift-bar').length >= 0);
  check('モーダルは閉じる', $('modal-shift').classList.contains('hidden'));
  check('帯を表示', !$('storage-error').classList.contains('hidden'));
  check('アラートは出さない', alerts.length === 0);
  $('btn-storage-error-close').click();
  check('×で帯を閉じる', $('storage-error').classList.contains('hidden'));
}

// ---- 起動時から localStorage が使えない（読み書きとも例外） ----
{
  const w = createWindow();
  const errs = [];
  w.addEventListener('error', e => errs.push(e.message));
  w.console.error = () => {};
  Object.defineProperty(w, 'localStorage', { get() { throw new w.DOMException('denied', 'SecurityError'); } });
  runScript(w, APP_JS);
  w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
  check('localStorage が使えなくても起動する', errs.length === 0 && w.document.querySelectorAll('.day-tab').length === 7);
  check('帯で知らせる', !w.document.getElementById('storage-error').classList.contains('hidden'));
}

finish();
