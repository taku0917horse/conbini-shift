// 勤務の結合（mergeAdjacentShifts）: 時間帯ごとに分かれて入力された勤務を1つにまとめる条件
const { boot, check, finish } = require('../helpers/harness');

const { w } = boot({});
const merge = (shifts, opts) => w.mergeAdjacentShifts(shifts, opts);
let n = 0;
const sh = (empId, day, startMin, endMin, extra = {}) =>
  ({ id: 's' + (n++), empId, day, startMin, endMin, breakMin: 0, tentativeStart: null, tentativeEnd: null, absent: false, ...extra });
const brief = r => r.shifts.map(s => `${s.empId}:${s.day}:${s.startMin}-${s.endMin}`).sort().join(' ');

// ---- 同じ曜日の中 ----
{
  const a = sh('e1', '月', 0, 180, { breakMin: 0 });     // 3:00〜6:00
  const b = sh('e1', '月', 180, 360, { breakMin: 15 });  // 6:00〜9:00
  const r = merge([a, b]);
  check('つながる2つ → 3:00〜9:00 の1つ', r.merged === 1 && brief(r) === 'e1:月:0-360');
  check('開始が早い方の ID を残す', r.shifts[0].id === a.id);
  check('休憩は合計', r.shifts[0].breakMin === 15);
  check('元の配列・勤務は変更しない', a.endMin === 180 && b.startMin === 180);
}
{
  const r = merge([sh('e1', '月', 0, 180), sh('e1', '月', 180, 360), sh('e1', '月', 360, 840)]);
  check('3つ続けて → 3:00〜17:00', r.merged === 2 && brief(r) === 'e1:月:0-840');
}
{
  const r = merge([sh('e1', '月', 360, 840), sh('e1', '月', 0, 180), sh('e1', '月', 180, 360)]);
  check('並び順に関係なくまとめる', r.merged === 2 && brief(r) === 'e1:月:0-840');
}
check('間が空いていればまとめない', merge([sh('e1', '月', 0, 180), sh('e1', '月', 240, 360)]).merged === 0);
check('重なっていればまとめない', merge([sh('e1', '月', 0, 240), sh('e1', '月', 180, 360)]).merged === 0);
check('従業員が違えばまとめない', merge([sh('e1', '月', 0, 180), sh('e2', '月', 180, 360)]).merged === 0);

// ---- 当欠 ----
check('当欠の有無が違えばまとめない', merge([sh('e1', '月', 0, 180), sh('e1', '月', 180, 360, { absent: true })]).merged === 0);
{
  const r = merge([sh('e1', '月', 0, 180, { absent: true }), sh('e1', '月', 180, 360, { absent: true })]);
  check('両方当欠ならまとめる（当欠のまま）', r.merged === 1 && r.shifts[0].absent === true);
}
{
  const r = merge([sh('e1', '月', 0, 180), { ...sh('e1', '月', 180, 360), absent: undefined }]);
  check('当欠なし（false と未設定）は同じ扱い', r.merged === 1);
}

// ---- 仮（募集中） ----
{
  const r = merge([sh('e1', '月', 360, 840), sh('e1', '月', 840, 1140, { tentativeStart: 840, tentativeEnd: 1140 })]);
  const s = r.shifts[0];
  check('片方だけの仮の範囲は引き継ぐ', r.merged === 1 && s.startMin === 360 && s.endMin === 1140
    && s.tentativeStart === 840 && s.tentativeEnd === 1140);
}
{
  const r = merge([sh('e1', '月', 360, 840, { tentativeStart: 600, tentativeEnd: 840 }),
                   sh('e1', '月', 840, 1140, { tentativeStart: 840, tentativeEnd: 1000 })]);
  check('両方の仮がつながれば1つの範囲に', r.merged === 1 && r.shifts[0].tentativeStart === 600 && r.shifts[0].tentativeEnd === 1000);
}
check('両方の仮がつながらなければまとめない', merge([
  sh('e1', '月', 360, 840, { tentativeStart: 360, tentativeEnd: 600 }),
  sh('e1', '月', 840, 1140, { tentativeStart: 900, tentativeEnd: 1140 }),
]).merged === 0);
{
  const legacy = { ...sh('e1', '月', 840, 1140), tentativeStart: undefined, tentativeEnd: undefined, isTentative: true };
  const r = merge([sh('e1', '月', 360, 840), legacy]);
  const s = r.shifts[0];
  check('旧形式の「仮」フラグ（勤務全体）は範囲に置き換えて引き継ぐ', r.merged === 1
    && s.tentativeStart === 840 && s.tentativeEnd === 1140 && !('isTentative' in s));
}
{
  const r = merge([sh('e1', '月', 0, 180), sh('e1', '月', 180, 360)]);
  check('仮がなければ tentative は null', r.shifts[0].tentativeStart === null && r.shifts[0].tentativeEnd === null);
}

// ---- 3:00 の日付の境目 ----
{
  const r = merge([sh('e2', '月', 1140, 1440), sh('e2', '火', 0, 180)]); // 月 22:00〜翌3:00 + 火 3:00〜6:00
  check('月 22:00〜翌3:00 + 火 3:00〜6:00 → 月 22:00〜翌6:00', r.merged === 1 && brief(r) === 'e2:月:1140-1620');
}
{
  const r = merge([sh('e2', '月', 1140, 1440), sh('e2', '火', 0, 180, { tentativeStart: 0, tentativeEnd: 120 })]);
  check('日付の境目をまたぐ仮の範囲は前日の時刻に直す（翌3:00〜翌5:00）',
    r.shifts[0].tentativeStart === 1440 && r.shifts[0].tentativeEnd === 1560);
}
check('翌6:00を超えるならまとめない（22:00〜翌9:00）',
  merge([sh('e2', '月', 1140, 1440), sh('e2', '火', 0, 360)]).merged === 0);
check('すでに翌6:00までの勤務に翌日の 6:00〜 はつなげない',
  merge([sh('e2', '月', 1140, 1620), sh('e2', '火', 180, 360)]).merged === 0);
check('週データの日曜と月曜（翌週）はまとめない',
  merge([sh('e2', '日', 1140, 1440), sh('e2', '月', 0, 180)]).merged === 0);
{
  const r = merge([sh('e2', '日', 1140, 1440), sh('e2', '月', 0, 180)], { wrapWeek: true });
  check('テンプレートは日曜→月曜もまとめる（日曜 22:00〜翌6:00）', r.merged === 1 && brief(r) === 'e2:日:1140-1620');
}
{
  // テンプレート: 月 3:00〜6:00 と 6:00〜9:00（先にまとまる）→ さらに日曜の夜勤とつながる
  const r = merge([sh('e2', '月', 0, 180), sh('e2', '月', 180, 360), sh('e2', '日', 1140, 1440)], { wrapWeek: true });
  check('テンプレート: 翌6:00を超える場合は日曜とはまとめない', r.merged === 1 && brief(r) === 'e2:日:1140-1440 e2:月:0-360');
}
{
  const r = merge([sh('e2', '日', 1140, 1440), sh('e2', '月', 0, 180), sh('e3', '月', 0, 180)], { wrapWeek: true });
  check('テンプレート: 別の従業員の月曜は残る', r.merged === 1 && brief(r) === 'e2:日:1140-1620 e3:月:0-180');
}

// ---- 複数の従業員・曜日が混ざっていても ----
{
  const r = merge([
    sh('e1', '月', 0, 180), sh('e1', '月', 180, 360), sh('e2', '月', 0, 180),
    sh('e1', '火', 0, 180), sh('e2', '月', 1140, 1440), sh('e2', '火', 0, 180),
  ]);
  check('混ざったデータ: まとめるものだけまとめる', r.merged === 2
    && brief(r) === 'e1:月:0-360 e1:火:0-180 e2:月:0-180 e2:月:1140-1620');
}
check('何もなければそのまま', merge([]).merged === 0 && merge([]).shifts.length === 0);

finish();
