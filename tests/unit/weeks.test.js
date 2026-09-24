// 週データ（日付ベース）: テンプレートの移行・週の作成と切り替え・当欠・従業員の削除・書き出し形式
const { boot, check, finish } = require('../helpers/harness');

const emp = { id: 'e1', name: '田中', displayName: '田中', color: '#2563eb', category: '日勤', isManager: false };
const emp2 = { id: 'e2', name: '佐藤', displayName: '佐藤', color: '#16a34a', category: '夜勤', isManager: false };
const legacyShifts = [
  { id: 's1', empId: 'e1', day: '月', startMin: 360, endMin: 840, breakMin: 60 },   // 9-17
  { id: 's2', empId: 'e2', day: '日', startMin: 1140, endMin: 1620, breakMin: 0 },  // 22-翌6（月曜へまたぐ）
];
const reqs = [{ id: 'r1', day: '月', startMin: 360, endMin: 840, count: 1 }];

// --- 1. 旧データの自動移行 ---
let { w, alerts, $ } = boot({ employees: [emp, emp2], shifts: legacyShifts, requirements: reqs });
let st = w.__state;
check('旧 shifts がテンプレートに移行', st.templateShifts.length === 2);
check('templateShifts キーに保存', JSON.parse(w.localStorage.getItem('templateShifts')).length === 2);
check('旧 shifts キーは残す', w.localStorage.getItem('shifts') !== null);
check('現在週は 2026-09-21（月）', st.currentWeek === '2026-09-21');
check('週ラベル', $('week-label').textContent === '9/21〜9/27');
check('未作成: この週を作成を表示', !$('week-status').classList.contains('created') && !$('btn-create-week').classList.contains('hidden') && $('btn-recreate-week').classList.contains('hidden'));
check('未作成週は勤務追加不可', $('btn-add-shift').disabled === true);
check('未作成週はバー0本', w.document.querySelectorAll('.shift-bar').length === 0);
check('未作成週は不足オーバーレイなし', w.document.querySelectorAll('.req-block').length === 0);
check('今日(木)のタブ強調', w.document.querySelector('.day-tab[data-day="木"]').classList.contains('today'));

// --- 2. この週を作成 ---
$('btn-create-week').click();
w.document.querySelector('.day-tab[data-day="月"]').click(); // 起動時は今日（木）のタブなので月曜を選ぶ
const wk = st.weeks['2026-09-21'];
check('週データ作成', wk && wk.shifts.length === 2);
check('ID はテンプレートと別', wk.shifts.every(s => !['s1', 's2'].includes(s.id)));
check('作成済み: 作り直すを表示', $('week-status').classList.contains('created') && $('btn-create-week').classList.contains('hidden') && !$('btn-recreate-week').classList.contains('hidden'));
check('月曜のバー1本（前週未作成なので日またぎなし）', w.document.querySelectorAll('.shift-bar').length === 1);
check('月曜 不足なし', w.computeShortages('月').length === 0);

// --- 3. 週の編集はテンプレートに影響しない ---
const monShift = wk.shifts.find(s => s.day === '月');
w.openShiftModal(monShift.id);
check('当欠トグルが週データ編集で表示', !$('absent-group').classList.contains('hidden'));
$('shift-absent').checked = true;
$('btn-shift-save').click();
check('当欠フラグ保存', monShift.absent === true);
check('テンプレートは当欠なし', st.templateShifts.every(s => !s.absent));
const sh = w.computeShortages('月');
check('当欠で月曜9-17が不足', sh.length === 1 && sh[0].startMin === 360 && sh[0].endMin === 840 && sh[0].short === 1);
check('当欠バーの表示', w.document.querySelectorAll('.shift-bar.is-absent').length === 1);
w.switchView('requirements');
check('不足リストに当欠者名', $('shortage-list').textContent.includes('当欠: 田中'));
check('不足リストの見出しに日付', $('shortage-list').textContent.includes('9/21(月)'));
check('対象ラベル', $('req-target-label').textContent === '対象: 9/21(月)〜9/27(日)');
w.renderTentativeList();
check('募集中リストに当欠', $('tentative-list').textContent.includes('田中が当欠'));
w.switchView('shift');

// --- 4. 次週: 未作成 → 作成すると前週日曜の日またぎが月曜に出る ---
$('btn-week-next').click();
check('次週へ', st.currentWeek === '2026-09-28');
$('btn-create-week').click();
const monBars = [...w.document.querySelectorAll('.shift-bar')].map(b => b.textContent);
check('前週日曜22-翌6が月曜に表示', monBars.some(t => t.includes('佐藤')));
check('前週の週データは変わらない', st.weeks['2026-09-21'].shifts.find(s => s.day === '月').absent === true);
check('新しい週は当欠なし', st.weeks['2026-09-28'].shifts.every(s => !s.absent));

// --- 5. 日付指定 ---
$('week-date-input').value = '2026-12-31';
$('week-date-input').dispatchEvent(new w.Event('change'));
check('日付指定で 2026-12-28 の週', st.currentWeek === '2026-12-28');
$('btn-week-today').click();
check('今週に戻る', st.currentWeek === '2026-09-21');

// --- 6. テンプレート編集モード ---
$('btn-mode-toggle').click();
check('テンプレートモード', st.mode === 'template' && $('week-bar').classList.contains('template-mode'));
w.openShiftModal(null);
check('テンプレートでは追加時に当欠非表示', $('absent-group').classList.contains('hidden'));
$('shift-start').value = '17:00';
$('shift-end').value = '22:00';
$('btn-shift-save').click();
check('テンプレートに追加', st.templateShifts.length === 3 && !('absent' in st.templateShifts[2]));
check('既存の週には影響しない', st.weeks['2026-09-21'].shifts.length === 2);
$('btn-mode-toggle').click();

// --- 7. 書き出し形式 / 旧形式の読み込み ---
const all = w.getAllData();
check('getAllData に weeks と templateShifts', Array.isArray(all.templateShifts) && typeof all.weeks === 'object');
const v1 = w.normalizeAllData({ employees: [emp], shifts: legacyShifts, requirements: reqs });
check('旧形式(shifts)はテンプレートとして読める', v1 && v1.templateShifts.length === 2 && Object.keys(v1.weeks).length === 0);
check('不正データは null', w.normalizeAllData({ employees: [] }) === null);

// --- 8. 従業員削除: テンプレートと今週以降から削除、過去の週は残す ---
// 過去の週（9/14）を作って佐藤の勤務を入れておく
w.__state.weeks['2026-09-14'] = { createdAt: 'x', shifts: [{ id: 'p1', empId: 'e2', day: '火', startMin: 360, endMin: 600, breakMin: 0, absent: false }] };
w.openEmpModal('e2');
$('btn-emp-delete').click();
check('テンプレートから削除', st.templateShifts.every(s => s.empId !== 'e2'));
check('今週から削除', st.weeks['2026-09-21'].shifts.every(s => s.empId !== 'e2'));
check('来週から削除', st.weeks['2026-09-28'].shifts.every(s => s.empId !== 'e2'));
check('過去の週は残る', st.weeks['2026-09-14'].shifts.length === 1);
check('従業員は削除済みとして残る', st.employees.find(e => e.id === 'e2').deleted === true);
w.switchView('employees');
check('従業員一覧に出ない', !$('employee-list').textContent.includes('佐藤'));
w.switchView('shift');
$('week-date-input').value = '2026-09-15';
$('week-date-input').dispatchEvent(new w.Event('change'));
w.document.querySelector('.day-tab[data-day="火"]').click();
check('過去の週で(削除済み)表示', [...w.document.querySelectorAll('.bar-emp-name')].some(e => e.textContent === '(削除済み)佐藤'));
w.openShiftModal('p1');
check('過去勤務の編集で削除済みを選択可', $('shift-emp-select').value === 'e2' && $('shift-emp-select').selectedOptions[0].textContent === '(削除済み)佐藤');
$('btn-shift-cancel').click();
w.openShiftModal(null);
check('新規追加では削除済みは選べない', ![...$('shift-emp-select').options].some(o => o.value === 'e2'));
$('btn-shift-cancel').click();
// 勤務がどこにも残らない従業員は完全に削除
st.employees.push({ id: 'e3', name: '鈴木', color: '#000', category: '日勤' });
w.openEmpModal('e3');
$('btn-emp-delete').click();
check('過去勤務なしなら完全削除', !st.employees.some(e => e.id === 'e3'));

// --- 8b. テンプレートから作り直す ---
$('btn-week-today').click();
const before = st.weeks['2026-09-21'].shifts.map(s => s.id).join();
$('btn-recreate-week').click();
const wkNew = st.weeks['2026-09-21'];
check('作り直しで新しいID', wkNew.shifts.map(s => s.id).join() !== before);
check('作り直しで当欠が消える', wkNew.shifts.every(s => !s.absent));
check('作り直しはテンプレートと同じ件数', wkNew.shifts.length === st.templateShifts.length);
w.confirm = () => false;
const before2 = wkNew.shifts.map(s => s.id).join();
$('btn-recreate-week').click();
check('キャンセルで変更なし', st.weeks['2026-09-21'].shifts.map(s => s.id).join() === before2);
w.confirm = () => true;

// --- 9. 再起動しても保持 ---
({ w, $ } = boot(Object.fromEntries(Object.keys(w.localStorage).map(k => [k, JSON.parse(w.localStorage.getItem(k))]))));
check('再起動後も週データ保持', Object.keys(w.__state.weeks).length === 3);

finish();
