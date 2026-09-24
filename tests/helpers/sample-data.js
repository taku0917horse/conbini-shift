// ブラウザのテスト・確認用の見本データ（localStorage にそのまま入れる形）
// 2026-09-21 の週から3週分を作成済み（4週目は未作成）。当欠・仮（募集中）・人数不足・夜勤の日またぎを含む
const C = ['#2563eb', '#16a34a', '#dc2626', '#9333ea', '#ea580c', '#0891b2'];
const DAYS = ['月', '火', '水', '木', '金', '土', '日'];

const employees = [
  { id: 'e1', name: '田中', displayName: '田中', color: C[0], category: '日勤' },
  { id: 'e2', name: '佐藤', displayName: '佐藤', color: C[1], category: '夜勤' },
  { id: 'e3', name: '鈴木', displayName: '鈴木', color: C[2], category: '夕勤' },
  { id: 'e4', name: '高橋', displayName: '高橋', color: C[3], category: '早朝' },
  { id: 'e5', name: '店長', displayName: '店長', color: C[4], category: '日勤', isManager: true },
  { id: 'e6', name: '伊藤', displayName: '伊藤', color: C[5], category: '夕勤' },
];

let n = 0;
const sh = (empId, day, startMin, endMin, extra = {}) => ({
  id: 's' + (n++), empId, day, startMin, endMin, breakMin: 0,
  tentativeStart: null, tentativeEnd: null, absent: false, ...extra,
});

const baseShifts = [];
DAYS.forEach((d, i) => {
  baseShifts.push(sh('e4', d, 180, 360));                                                   // 6:00〜9:00
  baseShifts.push(sh('e1', d, 360, 840, i === 2 ? { absent: true } : {}));                  // 9:00〜17:00（水は当欠）
  baseShifts.push(sh('e5', d, 360, 1140, i === 4 ? { tentativeStart: 840, tentativeEnd: 1140 } : {})); // 9:00〜22:00（金 17〜22 仮）
  if (i !== 5) baseShifts.push(sh('e3', d, 840, 1140));                                     // 17:00〜22:00（土は休み → 不足）
  baseShifts.push(sh('e6', d, 960, 1140));                                                  // 19:00〜22:00
  baseShifts.push(sh('e2', d, 1140, 1620, i === 1 ? { tentativeStart: 1440, tentativeEnd: 1560 } : {})); // 22:00〜翌6:00（火は翌3〜5仮）
});

const requirements = DAYS.flatMap(d => [
  { id: 'r1' + d, day: d, startMin: 180,  endMin: 1140, count: 2 },
  { id: 'r2' + d, day: d, startMin: 1140, endMin: 1620, count: 1 },
]);

// 2週目の木曜は高橋がいない（6:00〜9:00 が0人 → 不足2）。当欠は1週目だけ
const weeks = Object.fromEntries(['2026-09-21', '2026-09-28', '2026-10-05'].map((key, wi) => [key, {
  createdAt: '2026-09-01T00:00:00.000Z',
  shifts: baseShifts
    .filter(s => !(wi === 1 && s.empId === 'e4' && s.day === '木'))
    .map(s => ({ ...s, id: `${s.id}_${wi}`, absent: wi === 0 ? s.absent : false })),
}]));

const SAMPLE = {
  employees,
  templateShifts: baseShifts.map(({ absent, ...s }) => s),
  weeks,
  requirements,
};

// ページを開いてから見本データを入れ、2026-09-21 の週を表示する
async function loadSample(page, url) {
  await page.goto(url, { waitUntil: 'networkidle0' });
  await page.evaluate(seed => {
    localStorage.clear();
    for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, JSON.stringify(v));
  }, SAMPLE);
  await page.reload({ waitUntil: 'networkidle0' });
  await page.evaluate(() => { state.currentWeek = '2026-09-21'; renderShiftChart(); });
}

module.exports = { SAMPLE, loadSample };
