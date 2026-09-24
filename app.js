'use strict';

// ========= 定数 =========
const DAYS = ['月', '火', '水', '木', '金', '土', '日'];
const TOTAL_HOURS = 27;   // 3:00〜翌6:00 の 27 時間
const MAX_MIN     = 1620; // 27h * 60min

// 不足リストの時間帯フィルタ定義（startMin/endMin は深夜3:00起点の分）
const SHORTAGE_BANDS = [
  { id: 'all',   label: 'すべて',       startMin: 0,    endMin: Infinity },
  { id: 'dawn',  label: '明朝 3–6',    startMin: 0,    endMin: 180 },
  { id: 'morn',  label: '早朝 6–9',    startMin: 180,  endMin: 360 },
  { id: 'day',   label: '日勤 9–17',   startMin: 360,  endMin: 840 },
  { id: 'eve',   label: '夕勤 17–22',  startMin: 840,  endMin: 1140 },
  { id: 'night', label: '夜勤 22–翌3', startMin: 1140, endMin: 1620 },
];
let shortageFilterId  = 'all';
let tentativeFilterId = 'all';

// 1時間あたりの表示高さ（px）。3段階: コンパクト / 標準 / ゆったり
const HOUR_SIZES       = [24, 36, 48];
const HOUR_SIZE_LABELS = ['コンパクト', '標準', 'ゆったり'];
let hourSizeIdx = 0;   // localStorage で上書き
let HOUR_H      = HOUR_SIZES[hourSizeIdx];

// 3:00起点の分 → 表示用文字列（1440以上は「翌HH:MM」）
function minToTime(m) {
  const total = (m + 3 * 60) % (24 * 60);
  const h  = Math.floor(total / 60);
  const mm = total % 60;
  const t  = `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  return m >= 1440 ? `翌${t}` : t;
}

// input[type=time] の value 用（プレフィックスなし HH:MM）
function minToTimeInput(m) {
  const total = (m + 3 * 60) % (24 * 60);
  const h  = Math.floor(total / 60);
  const mm = total % 60;
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

// バー表示用（先頭ゼロなし・翌プレフィックスあり。例: 9:00, 13:30, 翌4:00）
function minToTimeShort(m) {
  const total = (m + 3 * 60) % (24 * 60);
  const h  = Math.floor(total / 60);
  const mm = total % 60;
  const ts = mm > 0 ? `${h}:${String(mm).padStart(2, '0')}` : `${h}:00`;
  return m >= 1440 ? `翌${ts}` : ts;
}

// 実時刻文字列 "HH:MM" → 3:00起点の分（深夜またぎは呼び出し元で +1440 補正）
function timeToMin(str) {
  const [h, m] = str.split(':').map(Number);
  return ((h - 3 + 24) % 24) * 60 + m;
}

function minToPx(m) {
  return (m / 60) * HOUR_H;
}

// ========= 週（日付）ユーティリティ =========
// 週は月曜始まり。週キーは月曜日の日付 'YYYY-MM-DD'（ローカル時刻）

// 3:00 区切りの営業日（0:00〜2:59 は前日扱い）
function getBusinessDate(now) {
  const d = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function toDateKey(d) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function parseDateKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function getWeekKey(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setDate(d.getDate() - (d.getDay() + 6) % 7);
  return toDateKey(d);
}

function addDaysToKey(key, n) {
  const d = parseDateKey(key);
  d.setDate(d.getDate() + n);
  return toDateKey(d);
}

// 週キー + 曜日 → その日の Date
function getDateOfDay(weekKey, day) {
  const d = parseDateKey(weekKey);
  d.setDate(d.getDate() + DAYS.indexOf(day));
  return d;
}

function formatMD(d) {
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

// 例: 9/21(月)〜9/27(日)。今年以外は年を付ける
function formatWeekRange(weekKey) {
  const mon = parseDateKey(weekKey);
  const sun = parseDateKey(addDaysToKey(weekKey, 6));
  const year = mon.getFullYear() !== new Date().getFullYear() ? `${mon.getFullYear()}/` : '';
  return `${year}${formatMD(mon)}(月)〜${formatMD(sun)}(日)`;
}

const PRESETS = [
  ['3-6',   '03:00', '06:00'],
  ['6-9',   '06:00', '09:00'],
  ['9-13',  '09:00', '13:00'],
  ['13-17', '13:00', '17:00'],
  ['17-22', '17:00', '22:00'],
  ['22-3',  '22:00', '03:00'],
];

const COLORS = [
  '#2563eb', '#16a34a', '#dc2626', '#9333ea',
  '#ea580c', '#0891b2', '#be185d', '#65a30d',
];

// シフト区分（5種）。表示・分類のみ。勤務入力には影響しない。
const CATEGORIES = ['明朝', '早朝', '日勤', '夕勤', '夜勤'];

// ========= ストレージ =========
const store = {
  load(key, def) {
    try { return JSON.parse(localStorage.getItem(key)) ?? def; }
    catch { return def; }
  },
  save(key, val) { localStorage.setItem(key, JSON.stringify(val)); },
};

// 行高さの設定を localStorage から復元
hourSizeIdx = store.load('hourSizeIdx', 0);
if (hourSizeIdx < 0 || hourSizeIdx >= HOUR_SIZES.length) hourSizeIdx = 0;
HOUR_H = HOUR_SIZES[hourSizeIdx];

// ========= 状態 =========
// requirements は配列: [{ id, day, startMin, endMin, count }]
// 旧フォーマット（object）の場合はリセット
let rawReqs = store.load('requirements', []);
if (!Array.isArray(rawReqs)) rawReqs = [];

// テンプレート（固定週パターン）: [{ id, empId, day, startMin, endMin, breakMin, tentativeStart, tentativeEnd }]
// 旧データ（'shifts' キー）はテンプレートとして自動移行。旧キーはバックアップとして残す
let rawTemplate = store.load('templateShifts', null);
if (!Array.isArray(rawTemplate)) {
  rawTemplate = store.load('shifts', []);
  if (!Array.isArray(rawTemplate)) rawTemplate = [];
  store.save('templateShifts', rawTemplate);
}

// 週データ: { 'YYYY-MM-DD'(月曜日): { createdAt, shifts: [テンプレートと同形式 + absent] } }
let rawWeeks = store.load('weeks', {});
if (!rawWeeks || typeof rawWeeks !== 'object' || Array.isArray(rawWeeks)) rawWeeks = {};

const state = {
  employees:      store.load('employees', []),
  templateShifts: rawTemplate,
  weeks:          rawWeeks,
  requirements:   rawReqs,
  mode:           'week',        // 'week'（日付付きの週） | 'template'
  currentWeek:    getWeekKey(getBusinessDate(new Date())),
  currentDay:     '月',
  editingShiftId: null,
  editingEmpId:   null,
  editingReqId:   null,
  reqModalCount:      2,
  selectedColor:      COLORS[0],
  selectedCategory:   '日勤',
  reqDay:             '月',
};

function touchDataDate() { store.save('currentDataDate', new Date().toISOString()); }
function saveEmployees() { store.save('employees', state.employees); touchDataDate(); }
function saveShifts() {
  store.save('templateShifts', state.templateShifts);
  store.save('weeks', state.weeks);
  touchDataDate();
}
function saveReqs()      { store.save('requirements', state.requirements); touchDataDate(); }
function uid()           { return Math.random().toString(36).slice(2, 10); }

// 仮（募集中）の時間範囲を返す。旧 isTentative フラグは全範囲として移行。
function getTentativeRange(shift) {
  if (shift.tentativeStart != null && shift.tentativeEnd != null) {
    return { start: shift.tentativeStart, end: shift.tentativeEnd };
  }
  if (shift.isTentative) {
    return { start: shift.startMin, end: shift.endMin };
  }
  return null;
}

// ========= 全データの取り出し・反映（エクスポート／インポート／クラウド同期で共用） =========
function getAllData() {
  return {
    employees:      state.employees,
    templateShifts: state.templateShifts,
    weeks:          state.weeks,
    requirements:   state.requirements,
  };
}

// 読み込んだデータを現行形式に揃える。不正なら null。
// 旧形式（shifts のみ・週データなし）は shifts をテンプレートとして扱う
function normalizeAllData(d) {
  if (!d || !Array.isArray(d.employees) || !Array.isArray(d.requirements)) return null;
  const templateShifts = Array.isArray(d.templateShifts) ? d.templateShifts
                       : Array.isArray(d.shifts)         ? d.shifts
                       : null;
  if (!templateShifts) return null;
  const weeks = d.weeks && typeof d.weeks === 'object' && !Array.isArray(d.weeks) ? d.weeks : {};
  return { employees: d.employees, templateShifts, weeks, requirements: d.requirements };
}

// d は normalizeAllData 済みのデータ。
// dataDate: 反映するデータの日時（ISO文字列）。saveXxx 経由だと touchDataDate が走るため直接書き込む
function applyAllData(d, dataDate) {
  state.employees      = d.employees;
  state.templateShifts = d.templateShifts;
  state.weeks          = d.weeks;
  state.requirements   = d.requirements;
  store.save('employees',      d.employees);
  store.save('templateShifts', d.templateShifts);
  store.save('weeks',          d.weeks);
  store.save('requirements',   d.requirements);
  store.save('currentDataDate', dataDate ?? new Date().toISOString());
}

// 表示中のビューを再描画
function rerenderCurrentView() {
  const active = document.querySelector('.nav-btn.active');
  switchView(active ? active.dataset.view : 'shift');
}

// ========= 日時フォーマット =========
function formatDatetime(d) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${p(d.getMonth()+1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// ========= エクスポート =========
function exportData() {
  const now     = new Date();
  const payload = {
    version:    2,
    exportedAt: now.toISOString(),
    data:       getAllData(),
  };

  store.save('currentDataDate', now.toISOString());

  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);

  const p = n => String(n).padStart(2, '0');
  const fname = `conbini-shift-${now.getFullYear()}${p(now.getMonth()+1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}.json`;

  const a = document.createElement('a');
  a.href     = url;
  a.download = fname;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

// ========= インポート =========
function handleImport(file) {
  if (!file) return;
  const reader = new FileReader();

  reader.onload = e => {
    let payload;
    try {
      payload = JSON.parse(e.target.result);
    } catch {
      alert('JSONの解析に失敗しました。ファイルが壊れているか、形式が正しくありません。');
      return;
    }

    // バリデーション（version 1 = 週データ導入前。shifts はテンプレートとして読み込む）
    if (payload.version !== 1 && payload.version !== 2) {
      alert(`非対応のデータ形式です（version: ${payload.version ?? '不明'}）`);
      return;
    }
    const d = normalizeAllData(payload.data);
    if (!d) {
      alert('データ構造が正しくありません。');
      return;
    }

    // 確認ダイアログ（日時を併記）
    const importedStr = payload.exportedAt
      ? formatDatetime(new Date(payload.exportedAt))
      : '（不明）';
    const currentDateRaw = store.load('currentDataDate', null);
    const currentStr = currentDateRaw
      ? formatDatetime(new Date(currentDateRaw))
      : '（不明）';

    const ok = confirm(
      `読み込むデータ: ${importedStr}\n現在のデータ: ${currentStr}\n\n現在のデータは上書きされます。よろしいですか?`
    );
    if (!ok) return;

    applyAllData(d, payload.exportedAt);
    switchView('shift');
    alert('読み込みが完了しました');
  };

  reader.onerror = () => alert('ファイルの読み込みに失敗しました。');
  reader.readAsText(file, 'utf-8');
}

// ========= 日またぎ展開 =========
function getPrevDay(day) {
  return DAYS[(DAYS.indexOf(day) + 6) % 7];
}

// ========= 表示・編集対象（テンプレート or 選択中の週） =========
function isTemplateMode() { return state.mode === 'template'; }

function getWeek(weekKey) { return state.weeks[weekKey] || null; }

// 表示・編集対象のシフト配列。未作成の週は null
function getTargetShifts() {
  if (isTemplateMode()) return state.templateShifts;
  const week = getWeek(state.currentWeek);
  return week ? week.shifts : null;
}

function findTargetShift(id) {
  return (getTargetShifts() || []).find(s => s.id === id) || null;
}

// テンプレートと全週のシフト配列（従業員の削除・店長フラグ解除で使う）
function getAllShiftLists() {
  return [state.templateShifts, ...Object.values(state.weeks).map(w => w.shifts)];
}

// 表示中の対象名（例: 9/21(月)〜9/27(日) / テンプレート）
function getTargetLabel() {
  return isTemplateMode() ? 'テンプレート' : formatWeekRange(state.currentWeek);
}

// テンプレートをコピーして週データを作る
function createWeekFromTemplate(weekKey) {
  state.weeks[weekKey] = {
    createdAt: new Date().toISOString(),
    shifts: state.templateShifts.map(s => ({ ...s, id: uid(), absent: false })),
  };
  saveShifts();
}

// 削除済みの従業員は過去の週の表示用に残る（deleted: true）
function getActiveEmployees() { return state.employees.filter(e => !e.deleted); }

function getEmpLabel(emp) { return emp.deleted ? `(削除済み)${emp.name}` : emp.name; }

// 今週（3:00 区切り）の週キー
function getThisWeekKey() { return getWeekKey(getBusinessDate(new Date())); }

// 人数に数えるシフトか（当欠は数えない。仮＝募集中は数える）
function isCounted(shift) { return !shift.absent; }

// 指定曜日の実効シフト（自日分 + 前日からの日またぎ分を当日座標に変換）
// 週表示の月曜は前週の日曜から日またぎ分を持ってくる（fromPrevWeek で識別）
function getEffectiveShiftsForDay(day) {
  const shifts  = getTargetShifts() || [];
  const prevDay = getPrevDay(day);
  let prevShifts = shifts;
  let fromPrevWeek = false;
  if (!isTemplateMode() && day === DAYS[0]) {
    const prevWeek = getWeek(addDaysToKey(state.currentWeek, -7));
    prevShifts   = prevWeek ? prevWeek.shifts : [];
    fromPrevWeek = true;
  }
  const own = shifts.filter(s => s.day === day);
  const overflow = prevShifts
    .filter(s => s.day === prevDay && s.endMin > 1440)
    .map(s => ({
      ...s,
      day,
      startMin: Math.max(0, s.startMin - 1440),
      endMin:   s.endMin - 1440,
      fromPrevWeek,
    }));
  return [...own, ...overflow];
}

// 指定曜日の実効ルール（自日分 + 前日からの日またぎ分を当日座標に変換）
function getEffectiveReqsForDay(day) {
  const prevDay = getPrevDay(day);
  const own = state.requirements.filter(r => r.day === day);
  const overflow = state.requirements
    .filter(r => r.day === prevDay && r.endMin > 1440)
    .map(r => ({
      ...r,
      day,
      startMin: Math.max(0, r.startMin - 1440),
      endMin:   r.endMin - 1440,
    }));
  return [...own, ...overflow];
}

// ========= 必要人数ロジック =========
// 指定時刻（3:00起点分）における必要人数。重複ルールは最大値。未設定は0。
function getRequiredCount(day, min) {
  const rules = getEffectiveReqsForDay(day).filter(
    r => r.startMin <= min && r.endMin > min
  );
  return rules.length === 0 ? 0 : Math.max(...rules.map(r => r.count));
}

// 曜日の不足区間をイベントベースで計算し、連続区間をマージして返す
function computeShortages(day) {
  if (!getTargetShifts()) return [];  // 未作成の週
  const dayShifts = getEffectiveShiftsForDay(day).filter(isCounted);
  const dayReqs   = getEffectiveReqsForDay(day);
  if (dayReqs.length === 0) return [];

  // ブレークポイント = 全シフト・全ルールの開始/終了
  const bp = new Set([0, MAX_MIN]);
  dayShifts.forEach(s => { bp.add(s.startMin); bp.add(Math.min(s.endMin, MAX_MIN)); });
  dayReqs.forEach(r   => { bp.add(r.startMin); bp.add(Math.min(r.endMin, MAX_MIN)); });

  const points = [...bp].sort((a, b) => a - b);
  const segs = [];

  for (let i = 0; i < points.length - 1; i++) {
    const start = points[i];
    const end   = points[i + 1];
    const req   = getRequiredCount(day, start);
    if (req === 0) continue;
    const actual = dayShifts.filter(s => s.startMin <= start && s.endMin > start).length;
    if (actual < req) segs.push({ startMin: start, endMin: end, short: req - actual });
  }

  // 隣接する不足区間をマージ（不足数は最大値を保持）
  const merged = [];
  for (const seg of segs) {
    const last = merged[merged.length - 1];
    if (last && last.endMin === seg.startMin) {
      last.endMin = seg.endMin;
      last.short  = Math.max(last.short, seg.short);
    } else {
      merged.push({ ...seg });
    }
  }
  return merged;
}

// 印刷・画像用：不足区間を { startMin, endMin, isEmpty } の配列で返す
function getShortageOverlays(day) {
  if (!getTargetShifts()) return [];  // 未作成の週
  const dayShifts = getEffectiveShiftsForDay(day).filter(isCounted);
  const dayReqs   = getEffectiveReqsForDay(day);
  if (dayReqs.length === 0) return [];
  const bp = new Set([0, MAX_MIN]);
  dayShifts.forEach(s => { bp.add(s.startMin); bp.add(Math.min(s.endMin, MAX_MIN)); });
  dayReqs.forEach(r   => { bp.add(r.startMin); bp.add(Math.min(r.endMin, MAX_MIN)); });
  const points = [...bp].sort((a, b) => a - b);
  const segs = [];
  for (let i = 0; i < points.length - 1; i++) {
    const start = points[i], end = points[i + 1];
    const req = getRequiredCount(day, start);
    if (req === 0) continue;
    const actual = dayShifts.filter(s => s.startMin <= start && s.endMin > start).length;
    if (actual < req) segs.push({ startMin: start, endMin: end, isEmpty: actual === 0 });
  }
  const merged = [];
  for (const seg of segs) {
    const last = merged[merged.length - 1];
    if (last && last.endMin === seg.startMin && last.isEmpty === seg.isEmpty) {
      last.endMin = seg.endMin;
    } else {
      merged.push({ ...seg });
    }
  }
  return merged;
}

// 行高さを1段階進めて再描画
function cycleHourSize() {
  hourSizeIdx = (hourSizeIdx + 1) % HOUR_SIZES.length;
  HOUR_H = HOUR_SIZES[hourSizeIdx];
  store.save('hourSizeIdx', hourSizeIdx);
  renderShiftChart();
}

// ========= 週バー（週切り替え・テンプレート切り替え）と曜日タブ =========
function renderWeekBar() {
  const tmpl    = isTemplateMode();
  const created = !!getTargetShifts();

  document.getElementById('week-bar').classList.toggle('template-mode', tmpl);
  document.getElementById('week-label').textContent = tmpl
    ? 'テンプレート（毎週の基本パターン）'
    : formatWeekRange(state.currentWeek);
  document.getElementById('week-date-input').value = state.currentWeek;
  document.getElementById('btn-mode-toggle').textContent = tmpl ? '週表示に戻る' : 'テンプレート';
  const status = document.getElementById('week-status');
  status.classList.toggle('hidden', tmpl);
  status.classList.toggle('created', created);
  document.getElementById('week-status-text').textContent = created
    ? 'この週のシフト'
    : 'この週のシフトはまだ作成されていません';
  document.getElementById('btn-create-week').classList.toggle('hidden', created);
  document.getElementById('btn-recreate-week').classList.toggle('hidden', !created);

  const addBtn = document.getElementById('btn-add-shift');
  addBtn.disabled = !created;

  // 曜日タブ（週表示は日付を併記、今日を強調）
  const todayKey = toDateKey(getBusinessDate(new Date()));
  document.querySelectorAll('.day-tab').forEach(tab => {
    const day = tab.dataset.day;
    tab.textContent = '';
    tab.appendChild(document.createTextNode(day));
    tab.classList.remove('today');
    if (!tmpl) {
      const date = getDateOfDay(state.currentWeek, day);
      const sub  = document.createElement('span');
      sub.className   = 'day-tab-date';
      sub.textContent = formatMD(date);
      tab.appendChild(sub);
      tab.classList.toggle('today', toDateKey(date) === todayKey);
    }
  });
}

function setCurrentWeek(weekKey) {
  state.currentWeek = weekKey;
  renderShiftChart();
}

// ========= シフトチャート描画 =========
function renderShiftChart() {
  const day     = state.currentDay;
  const labels  = document.getElementById('time-labels');
  const lanes   = document.getElementById('shift-lanes');
  const overlay = document.getElementById('requirement-overlay');

  labels.innerHTML  = '';
  lanes.innerHTML   = '';
  overlay.innerHTML = '';
  lanes.style.minHeight = (HOUR_H * TOTAL_HOURS) + 'px';

  // トグルボタンのラベルを現在モードに同期
  const sizeBtn = document.getElementById('btn-hour-size');
  if (sizeBtn) sizeBtn.textContent = HOUR_SIZE_LABELS[hourSizeIdx];

  renderWeekBar();

  // 区分開始時刻（3:00起点のhインデックス）→ ラベル太字
  const CHART_BOLD_H = new Set([0, 3, 6, 14, 19]); // 3/6/9/17/22時

  // 時刻ラベル & 水平線
  for (let h = 0; h <= TOTAL_HOURS; h++) {
    const y     = h * HOUR_H;
    const realH = (h + 3) % 24;
    const lbl   = document.createElement('div');
    lbl.className   = 'time-label' + (CHART_BOLD_H.has(h) ? ' time-label-bold' : '');
    lbl.style.top   = y + 'px';
    lbl.textContent = (h >= 24 ? '翌' : '') + `${String(realH).padStart(2, '0')}:00`;
    labels.appendChild(lbl);

    if (h < TOTAL_HOURS) {
      const line = document.createElement('div');
      line.className = 'hour-line';
      line.style.top = y + 'px';
      lanes.appendChild(line);
    }
  }

  // シフトバー（レーン割り当て: 開始時刻順・空きレーン再利用）
  // 前日からの日またぎ分も含む実効シフトを使用
  const dayShifts = getEffectiveShiftsForDay(day);
  const laneEnds  = [];
  const sorted    = [...dayShifts].sort((a, b) => a.startMin - b.startMin);

  const layouts = sorted.map(shift => {
    let lane = laneEnds.findIndex(e => e <= shift.startMin);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = shift.endMin;
    return { shift, lane };
  });

  const numLanes = Math.max(1, laneEnds.length);
  const laneW    = 1 / numLanes;

  layouts.forEach(({ shift, lane }) => {
    const emp = state.employees.find(e => e.id === shift.empId);
    if (!emp) return;

    const tentRange = getTentativeRange(shift);

    const bar = document.createElement('div');
    bar.className = 'shift-bar';
    bar.style.cssText = [
      `top:${minToPx(shift.startMin)}px`,
      `height:${Math.max(20, minToPx(shift.endMin - shift.startMin))}px`,
      `left:${lane * laneW * 100}%`,
      `width:${laneW * 100 - 1}%`,
      `background:${emp.color}`,
    ].join(';');

    // 仮の時間範囲オーバーレイ（バー内に斜線パターンで表示）
    if (tentRange) {
      const barDuration = shift.endMin - shift.startMin;
      const oStart = Math.max(0, tentRange.start - shift.startMin);
      const oEnd   = Math.min(barDuration, tentRange.end - shift.startMin);
      if (barDuration > 0 && oEnd > oStart) {
        const overlay = document.createElement('div');
        overlay.className = 'shift-bar-tentative-overlay';
        overlay.style.top    = `${(oStart / barDuration * 100).toFixed(2)}%`;
        overlay.style.height = `${((oEnd - oStart) / barDuration * 100).toFixed(2)}%`;
        bar.appendChild(overlay);
      }
    }

    if (shift.absent) bar.classList.add('is-absent');

    const startEl = document.createElement('span');
    startEl.className   = 'bar-start-time';
    startEl.textContent = minToTimeShort(shift.startMin);
    bar.appendChild(startEl);
    const nameEl = document.createElement('span');
    nameEl.className   = 'bar-emp-name';
    nameEl.textContent = getEmpLabel(emp);
    bar.appendChild(nameEl);
    if (shift.absent) {
      const abs = document.createElement('span');
      abs.className   = 'bar-absent';
      abs.textContent = '当欠';
      bar.appendChild(abs);
    }
    if (shift.breakMin > 0) {
      const brk = document.createElement('span');
      brk.className   = 'bar-break';
      brk.textContent = `休${shift.breakMin}`;
      bar.appendChild(brk);
    }
    bar.addEventListener('click', () => {
      if (shift.fromPrevWeek) {
        alert('前週の日曜日からの勤務です。前週に切り替えて編集してください。');
        return;
      }
      openShiftModal(shift.id);
    });
    lanes.appendChild(bar);
  });

  // 不足オーバーレイ（1時間単位）。未作成の週は表示しない
  const countedShifts = dayShifts.filter(isCounted);
  for (let h = 0; h < TOTAL_HOURS && getTargetShifts(); h++) {
    const hMin     = h * 60;
    const required = getRequiredCount(day, hMin);
    if (required === 0) continue;
    const count = countedShifts.filter(s => s.startMin <= hMin && s.endMin > hMin).length;
    if (count >= required) continue;

    const block = document.createElement('div');
    block.className   = 'req-block ' + (count === 0 ? 'empty' : 'shortage');
    block.style.top   = (h * HOUR_H) + 'px';
    block.style.height = HOUR_H + 'px';
    block.textContent = count === 0 ? '0人' : `あと${required - count}人`;
    overlay.appendChild(block);
  }
}

// ========= 従業員リスト描画（区分グループ表示） =========
function makeEmpListItem(emp) {
  const li = document.createElement('li');
  li.className = 'employee-item';
  const dn = emp.displayName || emp.name.slice(0, 2);
  const memoSnip = emp.memo
    ? ' · ' + emp.memo.slice(0, 24) + (emp.memo.length > 24 ? '…' : '')
    : '';
  const dot  = document.createElement('div');
  dot.className = 'emp-color-dot';
  dot.style.background = emp.color;
  const info = document.createElement('div');
  info.className = 'emp-info';
  const nameSpan = document.createElement('span');
  nameSpan.className   = 'emp-name';
  nameSpan.textContent = emp.name;
  if (emp.isManager) {
    const mgBadge = document.createElement('span');
    mgBadge.className   = 'manager-badge';
    mgBadge.textContent = '店長';
    nameSpan.appendChild(mgBadge);
  }
  const dnSpan = document.createElement('span');
  dnSpan.className   = 'emp-dn';
  dnSpan.textContent = `略称: ${dn}${memoSnip}`;
  info.appendChild(nameSpan);
  info.appendChild(dnSpan);
  li.appendChild(dot);
  li.appendChild(info);
  li.addEventListener('click', () => openEmpWeekModal(emp.id));
  return li;
}

function renderEmployeeList() {
  const ul = document.getElementById('employee-list');
  ul.innerHTML = '';

  const employees = getActiveEmployees();
  if (employees.length === 0) {
    const li = document.createElement('li');
    li.className   = 'empty-msg';
    li.textContent = '従業員を追加してください';
    ul.appendChild(li);
    return;
  }

  // 区分ごとにグループ化
  const catMap = new Map(CATEGORIES.map(c => [c, []]));
  const uncategorized = [];
  employees.forEach(emp => {
    if (catMap.has(emp.category)) catMap.get(emp.category).push(emp);
    else uncategorized.push(emp);
  });

  const renderSection = (label, emps) => {
    const hdr = document.createElement('li');
    hdr.className = 'emp-cat-header';
    const nameEl = document.createElement('span');
    nameEl.className   = 'emp-cat-name';
    nameEl.textContent = label;
    const cntEl = document.createElement('span');
    cntEl.className   = 'emp-cat-count' + (emps.length === 0 ? ' zero' : '');
    cntEl.textContent = `${emps.length}人`;
    hdr.appendChild(nameEl);
    hdr.appendChild(cntEl);
    ul.appendChild(hdr);

    if (emps.length === 0) {
      const empty = document.createElement('li');
      empty.className   = 'emp-cat-empty';
      empty.textContent = 'なし';
      ul.appendChild(empty);
    } else {
      emps.forEach(emp => ul.appendChild(makeEmpListItem(emp)));
    }
  };

  catMap.forEach((emps, cat) => renderSection(cat, emps));
  if (uncategorized.length > 0) renderSection('未設定', uncategorized);
}

// ========= 必要人数ルール描画（全曜日一覧） =========
function renderReqRules() {
  const list = document.getElementById('req-rules-list');
  list.innerHTML = '';

  DAYS.forEach(day => {
    const section = document.createElement('div');
    section.className = 'req-day-section';

    const title = document.createElement('div');
    title.className   = 'req-day-section-title';
    title.textContent = day + '曜日';
    section.appendChild(title);

    const dayRules = state.requirements
      .filter(r => r.day === day)
      .sort((a, b) => a.startMin - b.startMin);

    if (dayRules.length === 0) {
      const empty = document.createElement('div');
      empty.className   = 'req-rule-empty';
      empty.textContent = 'ルールなし';
      section.appendChild(empty);
    } else {
      dayRules.forEach(rule => {
        const item = document.createElement('div');
        item.className = 'req-rule-item';
        item.innerHTML = `
          <div class="req-rule-time">${minToTime(rule.startMin)}〜${minToTime(rule.endMin)}</div>
          <div class="req-rule-right"><span class="req-rule-count">${rule.count}</span>人</div>
        `;
        item.addEventListener('click', () => openReqModal(rule.id));
        section.appendChild(item);
      });
    }

    list.appendChild(section);
  });
}

// ========= 不足リスト描画 =========
function renderShortageList() {
  const list = document.getElementById('shortage-list');
  list.innerHTML = '';
  renderReqTargetLabel();

  // フィルタボタンのアクティブ状態を同期
  document.querySelectorAll('.shortage-filter-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.band === shortageFilterId);
  });

  if (!getTargetShifts()) {
    list.innerHTML = '<div class="empty-msg" style="padding-top:48px">この週はまだ作成されていません<br>（シフトタブの「この週を作成」から作成できます）</div>';
    return;
  }

  const band = SHORTAGE_BANDS.find(b => b.id === shortageFilterId);

  let hasAny = false;
  DAYS.forEach(day => {
    let shortages = computeShortages(day);

    // 時間帯フィルタ（不足の開始時刻がバンド内に収まるものだけ表示）
    if (band.id !== 'all') {
      shortages = shortages.filter(
        s => s.startMin >= band.startMin && s.startMin < band.endMin
      );
    }

    if (shortages.length === 0) return;
    hasAny = true;

    const section = document.createElement('div');
    section.className = 'shortage-section';

    const title = document.createElement('div');
    title.className   = 'shortage-day-title';
    title.textContent = getDayTitle(day);
    section.appendChild(title);

    const absentShifts = getEffectiveShiftsForDay(day).filter(s => s.absent);

    shortages.forEach(s => {
      // この不足区間に重なる当欠者
      const absentNames = absentShifts
        .filter(a => a.startMin < s.endMin && a.endMin > s.startMin)
        .map(a => state.employees.find(e => e.id === a.empId))
        .filter(Boolean)
        .map(getEmpLabel);

      const row = document.createElement('div');
      row.className = 'shortage-row shortage-row-tappable';
      row.innerHTML = `
        <div class="shortage-row-left">
          <span class="shortage-time">${minToTime(s.startMin)}〜${minToTime(s.endMin)}</span>
          <span class="shortage-absent"></span>
        </div>
        <div class="shortage-row-right">
          <span class="shortage-badge">あと${s.short}人</span>
          <span class="shortage-add-btn">＋</span>
        </div>
      `;
      const absentEl = row.querySelector('.shortage-absent');
      if (absentNames.length > 0) absentEl.textContent = `当欠: ${absentNames.join('、')}`;
      else absentEl.remove();

      row.addEventListener('click', () => {
        openShiftModal(null, { day, startMin: s.startMin, endMin: s.endMin });
      });
      section.appendChild(row);
    });

    list.appendChild(section);
  });

  if (!hasAny) {
    const msg = band.id !== 'all'
      ? `<div class="empty-msg" style="padding-top:48px">${band.label} の不足なし</div>`
      : '<div class="empty-msg" style="padding-top:48px">不足なし</div>';
    list.innerHTML = msg;
  }
}

// ========= 募集中リスト描画 =========
// 仮（募集中）の時間範囲と、当欠のシフトを一覧表示する
function renderTentativeList() {
  const list = document.getElementById('tentative-list');
  if (!list) return;
  list.innerHTML = '';
  renderReqTargetLabel();

  // フィルタボタンのアクティブ状態を同期
  document.querySelectorAll('.tentative-filter-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.band === tentativeFilterId);
  });

  const shifts = getTargetShifts();
  if (!shifts) {
    list.innerHTML = '<div class="empty-msg" style="padding-top:48px">この週はまだ作成されていません<br>（シフトタブの「この週を作成」から作成できます）</div>';
    return;
  }

  const band = SHORTAGE_BANDS.find(b => b.id === tentativeFilterId);

  let hasAny = false;
  DAYS.forEach(day => {
    // 仮の時間範囲 / 当欠の勤務について、バンドとの重複部分を計算する
    const entries = [];
    shifts.forEach(s => {
      if (s.day !== day) return;
      const range = s.absent
        ? { start: s.startMin, end: s.endMin }
        : getTentativeRange(s);
      if (!range) return;
      const kind = s.absent ? 'absent' : 'tentative';
      if (band.id === 'all') {
        entries.push({ shift: s, kind, dispStart: range.start, dispEnd: range.end });
      } else {
        // バンド境界でクリップして重複部分だけを表示
        const clippedStart = Math.max(range.start, band.startMin);
        const clippedEnd   = Math.min(range.end, band.endMin);
        if (clippedEnd > clippedStart) {
          entries.push({ shift: s, kind, dispStart: clippedStart, dispEnd: clippedEnd });
        }
      }
    });
    entries.sort((a, b) => a.dispStart - b.dispStart);

    if (entries.length === 0) return;
    hasAny = true;

    const section = document.createElement('div');
    section.className = 'shortage-section';

    const title = document.createElement('div');
    title.className   = 'shortage-day-title';
    title.textContent = getDayTitle(day);
    section.appendChild(title);

    entries.forEach(({ shift, kind, dispStart, dispEnd }) => {
      const emp = state.employees.find(e => e.id === shift.empId);
      if (!emp) return;
      const isAbsent = kind === 'absent';
      const row = document.createElement('div');
      row.className = 'tentative-row' + (isAbsent ? ' is-absent' : '');
      row.innerHTML = `
        <div class="tentative-info">
          <span class="shortage-time">${minToTime(dispStart)}〜${minToTime(dispEnd)}</span>
          <span class="tentative-name"></span>
        </div>
        <span class="tentative-badge">${isAbsent ? '当欠' : '募集中'}</span>
      `;
      row.querySelector('.tentative-name').textContent = isAbsent
        ? `${getEmpLabel(emp)}が当欠`
        : `${getEmpLabel(emp)}が仮で対応中`;
      row.addEventListener('click', () => openShiftModal(shift.id));
      section.appendChild(row);
    });

    list.appendChild(section);
  });

  if (!hasAny) {
    const msg = band.id !== 'all'
      ? `<div class="empty-msg" style="padding-top:48px">${band.label} の募集中・当欠なし</div>`
      : '<div class="empty-msg" style="padding-top:48px">募集中・当欠のシフトなし</div>';
    list.innerHTML = msg;
  }
}

// 一覧の曜日見出し（週表示は日付付き。例: 9/21(月)）
function getDayTitle(day) {
  if (isTemplateMode()) return day + '曜日';
  return `${formatMD(getDateOfDay(state.currentWeek, day))}(${day})`;
}

// 必要人数タブ: 不足・募集中の対象を表示
function renderReqTargetLabel() {
  document.getElementById('req-target-label').textContent = `対象: ${getTargetLabel()}`;
}

// ========= 印刷バーチャート生成 =========
const ABSENT_COLOR = '#9ca3af'; // 当欠バーの色（印刷・画像）

// 印刷・画像の曜日見出し（週表示は日付付き。例: 月 9/21）
function getPrintDayLabel(day) {
  if (isTemplateMode()) return day;
  return `${day} ${formatMD(getDateOfDay(state.currentWeek, day))}`;
}

// 基本帯の境界に対応するh値（3:00起点）: 3:00/6:00/9:00/13:00/17:00/22:00/翌3:00
const BAND_H = new Set([0, 3, 6, 10, 14, 19, 24]);

function buildPrintChart() {
  const wrapper = document.createElement('div');
  wrapper.className = 'print-chart';

  // ── ヘッダー行（曜日名） ──
  const headerRow = document.createElement('div');
  headerRow.className = 'print-chart-header';

  const corner = document.createElement('div');
  corner.className = 'print-corner';
  headerRow.appendChild(corner);

  DAYS.forEach(day => {
    const hdr = document.createElement('div');
    hdr.className = 'print-day-hdr';
    hdr.textContent = getPrintDayLabel(day);
    headerRow.appendChild(hdr);
  });
  wrapper.appendChild(headerRow);

  // ── ボディ行（時刻軸 + 7日分レーン） ──
  const bodyRow = document.createElement('div');
  bodyRow.className = 'print-chart-body';

  // 時刻軸
  const timeAxis = document.createElement('div');
  timeAxis.className = 'print-time-axis';
  for (let h = 0; h <= TOTAL_HOURS; h++) {
    const realH = (h + 3) % 24;
    const lbl = document.createElement('div');
    lbl.className = 'print-time-lbl' + (BAND_H.has(h) ? ' print-time-bold' : '');
    lbl.style.top = `calc(${h} * var(--print-hour-h))`;
    lbl.textContent = (h >= 24 ? '翌' : '') + String(realH).padStart(2, '0') + ':00';
    timeAxis.appendChild(lbl);
  }
  bodyRow.appendChild(timeAxis);

  // 7曜日分のレーン列
  DAYS.forEach(day => {
    const dayShifts = getEffectiveShiftsForDay(day);
    const sorted = [...dayShifts].sort((a, b) => a.startMin - b.startMin);

    // レーン割り当て（画面と同じアルゴリズム）
    const laneEnds = [];
    const layouts = sorted.map(shift => {
      let lane = laneEnds.findIndex(e => e <= shift.startMin);
      if (lane === -1) lane = laneEnds.length;
      laneEnds[lane] = shift.endMin;
      return { shift, lane };
    });
    const numLanes = Math.max(1, laneEnds.length);

    const lanesDiv = document.createElement('div');
    lanesDiv.className = 'print-lanes';

    // 水平線（h=1〜TOTAL_HOURS-1。h=0は上枠線、h=27は下枠線で代替）
    for (let h = 1; h < TOTAL_HOURS; h++) {
      const line = document.createElement('div');
      line.className = 'print-hline' + (BAND_H.has(h) ? ' print-band-line' : '');
      line.style.top = `calc(${h} * var(--print-hour-h))`;
      lanesDiv.appendChild(line);
    }

    // シフトバー
    layouts.forEach(({ shift, lane }) => {
      const emp = state.employees.find(e => e.id === shift.empId);
      if (!emp) return;

      const laneW = 1 / numLanes;
      const bar = document.createElement('div');
      bar.className = 'print-bar';
      bar.style.top        = `calc(${(shift.startMin / 60).toFixed(4)} * var(--print-hour-h))`;
      bar.style.height     = `calc(${((shift.endMin - shift.startMin) / 60).toFixed(4)} * var(--print-hour-h))`;
      bar.style.left       = `${(lane * laneW * 100).toFixed(2)}%`;
      bar.style.width      = `${(laneW * 100 - 0.5).toFixed(2)}%`;
      bar.style.background = shift.absent ? ABSENT_COLOR : emp.color;

      const label = (shift.absent ? '欠' : '') + (emp.displayName || emp.name.slice(0, 2));

      const startEl = document.createElement('div');
      startEl.className   = 'print-bar-start';
      startEl.textContent = minToTimeShort(shift.startMin);
      bar.appendChild(startEl);

      const nameEl = document.createElement('div');
      nameEl.className   = 'print-bar-name';
      nameEl.textContent = label;
      bar.appendChild(nameEl);

      const endEl = document.createElement('div');
      endEl.className   = 'print-bar-end';
      endEl.textContent = minToTimeShort(shift.endMin);
      bar.appendChild(endEl);

      lanesDiv.appendChild(bar);
    });

    // 不足オーバーレイ（バーの背後に配置）
    getShortageOverlays(day).forEach(({ startMin, endMin, isEmpty }) => {
      const ov = document.createElement('div');
      ov.className = 'print-shortage-ov' + (isEmpty ? ' print-shortage-ov-empty' : '');
      ov.style.top    = `calc(${(startMin / 60).toFixed(4)} * var(--print-hour-h))`;
      ov.style.height = `calc(${((endMin - startMin) / 60).toFixed(4)} * var(--print-hour-h))`;
      lanesDiv.appendChild(ov);
    });

    bodyRow.appendChild(lanesDiv);
  });

  wrapper.appendChild(bodyRow);
  return wrapper;
}

// ========= 画像エクスポート（Canvas 2D） =========
function canvasRoundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  if (r < 0) r = 0;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

function generateChartCanvas() {
  const BAND_H_SET = new Set([0, 3, 6, 10, 14, 19, 24]);
  const PX_PER_HOUR = 50;
  const TIME_W  = 60;
  const DAY_W   = 160; // 時刻（例:「12:30」）が切れないよう幅を確保
  const HDR_H   = 34;
  const CHART_H = TOTAL_HOURS * PX_PER_HOUR;
  const W = TIME_W + DAYS.length * DAY_W;
  const H = HDR_H + CHART_H;
  const SCALE = 2;

  const canvas = document.createElement('canvas');
  canvas.width  = W * SCALE;
  canvas.height = H * SCALE;
  const ctx = canvas.getContext('2d');
  ctx.scale(SCALE, SCALE);

  // 背景
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);

  // ヘッダー背景
  ctx.fillStyle = '#e5e7eb';
  ctx.fillRect(0, 0, W, HDR_H);

  // 曜日ヘッダー
  ctx.font = 'bold 19px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  DAYS.forEach((day, i) => {
    const x = TIME_W + i * DAY_W;
    ctx.strokeStyle = '#aaa';
    ctx.lineWidth = 0.5;
    ctx.strokeRect(x, 0, DAY_W, HDR_H);
    ctx.fillStyle = '#1f2937';
    ctx.fillText(getPrintDayLabel(day), x + DAY_W / 2, HDR_H / 2);
  });

  // コーナーセル区切り
  ctx.strokeStyle = '#aaa';
  ctx.lineWidth = 0.5;
  ctx.strokeRect(0, 0, TIME_W, HDR_H);

  // 時刻ラベル & 水平線
  for (let h = 0; h <= TOTAL_HOURS; h++) {
    const y = HDR_H + h * PX_PER_HOUR;
    const realH = (h + 3) % 24;
    const isBand = BAND_H_SET.has(h);
    const tlabel = (h >= 24 ? '翌' : '') + String(realH).padStart(2, '0') + ':00';

    ctx.fillStyle = isBand ? '#111' : '#6b7280';
    ctx.font = isBand ? 'bold 13px sans-serif' : '13px sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(tlabel, TIME_W - 3, y);

    if (h > 0 && h < TOTAL_HOURS) {
      ctx.strokeStyle = isBand ? '#333' : '#e0e0e0';
      ctx.lineWidth   = isBand ? 2 : 0.5;
      ctx.beginPath();
      ctx.moveTo(TIME_W, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }
  }

  // チャートエリア外枠（上辺 = 3:00 の帯線を兼ねる）
  ctx.strokeStyle = '#333';
  ctx.lineWidth = 2;
  ctx.strokeRect(TIME_W, HDR_H, W - TIME_W, CHART_H);

  // 不足オーバーレイ（バーの背後に描画）
  DAYS.forEach((day, di) => {
    const colX = TIME_W + di * DAY_W;
    getShortageOverlays(day).forEach(({ startMin, endMin, isEmpty }) => {
      const oy = HDR_H + (startMin / 60) * PX_PER_HOUR;
      const oh = ((endMin - startMin) / 60) * PX_PER_HOUR;
      ctx.fillStyle = isEmpty ? 'rgba(220,38,38,0.32)' : 'rgba(252,165,165,0.5)';
      ctx.fillRect(colX, oy, DAY_W, oh);
      ctx.fillStyle = isEmpty ? '#dc2626' : '#f87171';
      ctx.fillRect(colX, oy, 3, oh);
    });
  });

  // シフトバー
  DAYS.forEach((day, di) => {
    const colX = TIME_W + di * DAY_W;
    const dayShifts = getEffectiveShiftsForDay(day);
    const sorted = [...dayShifts].sort((a, b) => a.startMin - b.startMin);

    const laneEnds = [];
    const layouts = sorted.map(shift => {
      let lane = laneEnds.findIndex(e => e <= shift.startMin);
      if (lane === -1) lane = laneEnds.length;
      laneEnds[lane] = shift.endMin;
      return { shift, lane };
    });
    const numLanes = Math.max(1, laneEnds.length);

    layouts.forEach(({ shift, lane }) => {
      const emp = state.employees.find(e => e.id === shift.empId);
      if (!emp) return;

      const laneW = DAY_W / numLanes;
      const barX  = colX + lane * laneW + 0.5;
      const barW  = Math.max(2, laneW - 1);
      const barY  = HDR_H + (shift.startMin / 60) * PX_PER_HOUR + 0.5;
      const barH  = Math.max(3, ((shift.endMin - shift.startMin) / 60) * PX_PER_HOUR - 1);

      ctx.fillStyle = shift.absent ? ABSENT_COLOR : emp.color;
      canvasRoundRect(ctx, barX, barY, barW, barH, 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.45)';
      ctx.lineWidth = 3;
      canvasRoundRect(ctx, barX, barY, barW, barH, 2);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.95)';
      ctx.lineWidth = 2.5;
      canvasRoundRect(ctx, barX, barY, barW, barH, 2);
      ctx.stroke();

      ctx.save();
      canvasRoundRect(ctx, barX, barY, barW, barH, 2);
      ctx.clip();

      const nameLabel  = (shift.absent ? '欠' : '') + (emp.displayName || emp.name.slice(0, 2));
      const startLabel = minToTimeShort(shift.startMin);
      const endLabel   = minToTimeShort(shift.endMin);

      const TIME_FONT   = '13px sans-serif';
      const TIME_H      = 18; // 時刻1行分の高さ(px)
      const TIME_MARGIN = 2;

      // テキストに影を付けて視認性を上げる
      ctx.shadowColor   = 'rgba(0,0,0,0.5)';
      ctx.shadowBlur    = 2;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 1;

      // 開始時刻（バー上端）
      if (barH >= TIME_H + 2) {
        ctx.fillStyle = 'rgba(255,255,255,0.92)';
        ctx.font = TIME_FONT;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(startLabel, barX + 2, barY + TIME_MARGIN);
      }

      // 終了時刻（バー下端）
      if (barH >= TIME_H * 2 + 4) {
        ctx.fillStyle = 'rgba(255,255,255,0.92)';
        ctx.font = TIME_FONT;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';
        ctx.fillText(endLabel, barX + 2, barY + barH - TIME_MARGIN);
      }

      // 従業員名（縦書き：文字ごとに描画、開始・終了時刻の間に配置）
      const CHAR_SIZE = 18;
      const CHAR_H    = CHAR_SIZE * 1.25;
      const hasStart  = barH >= TIME_H + 2;
      const hasEnd    = barH >= TIME_H * 2 + 4;
      const nameTopY  = hasStart ? barY + TIME_H + 3 : barY + 2;
      const nameMaxY  = hasEnd   ? barY + barH - TIME_H - 2 : barY + barH - 2;
      ctx.fillStyle = '#ffffff';
      ctx.font = `bold ${CHAR_SIZE}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      const cx = barX + barW / 2;
      nameLabel.split('').forEach((ch, ci) => {
        const cy = nameTopY + ci * CHAR_H;
        if (cy + CHAR_SIZE > nameMaxY) return;
        ctx.fillText(ch, cx, cy);
      });

      ctx.restore();
    });
  });

  // 縦の列区切り線（シフトバーより前面に描画）
  DAYS.forEach((_, i) => {
    if (i === 0) return;
    const x = TIME_W + i * DAY_W;
    ctx.strokeStyle = '#111';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
  });

  return canvas;
}

function openImageFallback(canvas) {
  const url = canvas.toDataURL('image/png');
  const w = window.open('', '_blank');
  if (w) {
    w.document.open();
    w.document.write(
      '<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<title>シフト表</title></head>' +
      '<body style="margin:0;background:#111;color:#fff;font-family:sans-serif">' +
      '<p style="font-size:13px;text-align:center;padding:10px;margin:0">' +
      '画像を長押し → 「写真に保存」または「共有」でLINEに送れます</p>' +
      '<img src="' + url + '" style="width:100%;display:block">' +
      '</body></html>'
    );
    w.document.close();
  } else {
    const a = document.createElement('a');
    a.href = url;
    a.download = 'シフト表.png';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }
}

async function exportChartImage() {
  const canvas = generateChartCanvas();
  canvas.toBlob(async blob => {
    if (!blob) { alert('画像の生成に失敗しました'); return; }
    const file = new File([blob], 'シフト表.png', { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: 'シフト表' });
        return;
      } catch (e) {
        if (e.name === 'AbortError') return;
      }
    }
    openImageFallback(canvas);
  }, 'image/png');
}

function renderPrintPreview() {
  const preview = document.getElementById('print-preview');
  preview.innerHTML = '';
  preview.appendChild(buildPrintChart());
}

function renderPrintArea() {
  const area = document.getElementById('print-area');
  area.innerHTML = '';
  area.appendChild(buildPrintChart());
}

// ========= 曜日トグルボタン =========
function renderDayToggles(selectedDays, readonly = false) {
  const wrap = document.getElementById('day-toggle-buttons');
  const hint = document.getElementById('day-toggle-hint');
  wrap.innerHTML = '';
  hint.style.display = readonly ? 'none' : '';

  DAYS.forEach(d => {
    const btn = document.createElement('button');
    btn.type      = 'button';
    btn.className = 'day-toggle-btn' + (selectedDays.includes(d) ? ' on' : '');
    btn.textContent = d;
    if (!readonly) {
      btn.addEventListener('click', () => {
        btn.classList.toggle('on');
        updateShiftSaveBtnState();
      });
    } else {
      btn.style.cursor = 'default';
    }
    wrap.appendChild(btn);
  });
}

function getSelectedDays() {
  return [...document.querySelectorAll('.day-toggle-btn.on')].map(b => b.textContent);
}

function updateShiftSaveBtnState() {
  const btn = document.getElementById('btn-shift-save');
  btn.disabled     = getSelectedDays().length === 0;
  btn.style.opacity = btn.disabled ? '0.4' : '';
}

function updateBreakBtnState() {
  const val = document.getElementById('shift-break').value;
  document.querySelectorAll('.break-preset-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.min === val);
  });
}

// ========= モーダル: 勤務 =========
function openShiftModal(shiftId = null, prefill = null) {
  const shift = shiftId ? findTargetShift(shiftId) : null;
  if (shiftId && !shift) return;
  if (!shiftId && !getTargetShifts()) {
    alert('この週はまだ作成されていません。先に「この週を作成」をしてください。');
    return;
  }
  state.editingShiftId = shiftId;

  const empSel  = document.getElementById('shift-emp-select');
  const startIn = document.getElementById('shift-start');
  const endIn   = document.getElementById('shift-end');
  const breakIn = document.getElementById('shift-break');
  const delBtn  = document.getElementById('btn-shift-delete');

  const selectable = state.employees.filter(e => !e.deleted || (shift && e.id === shift.empId));
  empSel.innerHTML = selectable.length === 0
    ? '<option value="">先に従業員を追加してください</option>'
    : '';
  selectable.forEach(emp => {
    const opt = document.createElement('option');
    opt.value = emp.id;
    opt.textContent = getEmpLabel(emp);
    empSel.appendChild(opt);
  });

  // 当欠は週データの既存勤務のみ
  const absentGroup = document.getElementById('absent-group');
  absentGroup.classList.toggle('hidden', !shift || isTemplateMode());
  document.getElementById('shift-absent').checked = !!(shift && shift.absent);

  if (shift) {
    document.getElementById('modal-shift-title').textContent = `勤務編集 ${isTemplateMode() ? '（テンプレート）' : getDayTitle(shift.day)}`;
    empSel.value  = shift.empId;
    startIn.value = minToTimeInput(shift.startMin);
    endIn.value   = minToTimeInput(shift.endMin);
    breakIn.value = shift.breakMin || 0;
    const range = getTentativeRange(shift);
    if (range) {
      document.getElementById('tentative-start').value = minToTimeInput(range.start);
      document.getElementById('tentative-end').value   = minToTimeInput(range.end);
    } else {
      document.getElementById('tentative-start').value = '';
      document.getElementById('tentative-end').value   = '';
    }
    delBtn.classList.remove('hidden');
    renderDayToggles([shift.day], true);
  } else {
    document.getElementById('modal-shift-title').textContent = `勤務追加 ${isTemplateMode() ? '（テンプレート）' : '（' + formatWeekRange(state.currentWeek) + '）'}`;
    document.getElementById('tentative-start').value = '';
    document.getElementById('tentative-end').value   = '';
    if (prefill) {
      startIn.value = minToTimeInput(prefill.startMin);
      endIn.value   = minToTimeInput(prefill.endMin);
      renderDayToggles([prefill.day], false);
    } else {
      startIn.value = '09:00';
      endIn.value   = '17:00';
      renderDayToggles([state.currentDay], false);
    }
    breakIn.value = 0;
    delBtn.classList.add('hidden');
  }

  updateBreakBtnState();
  updateShiftSaveBtnState();
  updateTentativeGroup();
  document.getElementById('modal-shift').classList.remove('hidden');
}

function updateTentativeGroup() {
  const empId = document.getElementById('shift-emp-select').value;
  const emp   = state.employees.find(e => e.id === empId);
  const group = document.getElementById('tentative-group');
  if (emp && emp.isManager) {
    group.classList.remove('hidden');
  } else {
    group.classList.add('hidden');
    document.getElementById('tentative-start').value = '';
    document.getElementById('tentative-end').value   = '';
  }
}

function closeShiftModal() {
  document.getElementById('modal-shift').classList.add('hidden');
  state.editingShiftId = null;
}

// ========= モーダル: 必要人数ルール =========
function openReqModal(ruleId = null) {
  state.editingReqId = ruleId;
  const delBtn   = document.getElementById('btn-req-delete');
  const dayModal = document.getElementById('req-day-modal');

  if (ruleId) {
    const rule = state.requirements.find(r => r.id === ruleId);
    document.getElementById('modal-req-title').textContent = 'ルール編集';
    dayModal.value = rule.day;
    document.getElementById('req-start').value = minToTimeInput(rule.startMin);
    document.getElementById('req-end').value   = minToTimeInput(rule.endMin);
    state.reqModalCount = rule.count;
    delBtn.classList.remove('hidden');
  } else {
    document.getElementById('modal-req-title').textContent = 'ルール追加';
    dayModal.value = state.reqDay;
    document.getElementById('req-start').value = '09:00';
    document.getElementById('req-end').value   = '17:00';
    state.reqModalCount = 2;
    delBtn.classList.add('hidden');
  }
  document.getElementById('req-count-val').textContent = state.reqModalCount;
  document.getElementById('modal-req').classList.remove('hidden');
}

function closeReqModal() {
  document.getElementById('modal-req').classList.add('hidden');
  state.editingReqId = null;
}

// ========= モーダル: 従業員 =========
function openEmpModal(empId = null) {
  state.editingEmpId = empId;
  const nameIn = document.getElementById('emp-name');
  const dnIn   = document.getElementById('emp-display-name');
  const memoIn = document.getElementById('emp-memo');
  const delBtn = document.getElementById('btn-emp-delete');

  const isManagerChk = document.getElementById('emp-is-manager');
  if (empId) {
    const emp = state.employees.find(e => e.id === empId);
    document.getElementById('modal-emp-title').textContent = '従業員編集';
    nameIn.value              = emp.name;
    dnIn.value                = emp.displayName || '';
    memoIn.value              = emp.memo || '';
    state.selectedColor       = emp.color;
    state.selectedCategory    = emp.category || '日勤';
    isManagerChk.checked      = emp.isManager || false;
    delBtn.classList.remove('hidden');
  } else {
    document.getElementById('modal-emp-title').textContent = '従業員追加';
    nameIn.value              = '';
    dnIn.value                = '';
    memoIn.value              = '';
    state.selectedColor       = COLORS[state.employees.length % COLORS.length];
    state.selectedCategory    = '日勤';
    isManagerChk.checked      = false;
    delBtn.classList.add('hidden');
  }
  renderCategoryBtns();
  renderColorPicker();
  document.getElementById('modal-employee').classList.remove('hidden');
}

function closeEmpModal() {
  document.getElementById('modal-employee').classList.add('hidden');
  state.editingEmpId = null;
}

function renderCategoryBtns() {
  document.querySelectorAll('.cat-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.cat === state.selectedCategory);
  });
}

function renderColorPicker() {
  const picker = document.getElementById('color-picker');
  picker.innerHTML = '';
  COLORS.forEach(c => {
    const sw = document.createElement('div');
    sw.className  = 'color-swatch' + (c === state.selectedColor ? ' selected' : '');
    sw.style.background = c;
    sw.addEventListener('click', () => { state.selectedColor = c; renderColorPicker(); });
    picker.appendChild(sw);
  });
}

// ========= 従業員週間スケジュール =========
let weekViewEmpId = null;

function openEmpWeekModal(empId) {
  weekViewEmpId = empId;
  const emp = state.employees.find(e => e.id === empId);
  if (!emp) return;

  // ヘッダー
  document.getElementById('emp-week-color-dot').style.background = emp.color;
  document.getElementById('emp-week-emp-name').textContent = emp.name;
  const catLine = [emp.category || '未設定', emp.memo].filter(Boolean).join(' · ');
  document.getElementById('emp-week-category').textContent = catLine;

  // 週間スケジュール生成
  const body = document.getElementById('emp-week-body');
  body.innerHTML = '';
  let totalMin = 0;

  // 表示中の週（未作成ならテンプレート）
  const srcShifts = getTargetShifts() || state.templateShifts;
  const srcLabel  = getTargetShifts() ? getTargetLabel() : 'テンプレート';

  DAYS.forEach(day => {
    const dayShifts = srcShifts
      .filter(s => s.empId === empId && s.day === day)
      .sort((a, b) => a.startMin - b.startMin);

    const row = document.createElement('div');
    row.className = 'emp-week-row';

    const dayEl = document.createElement('div');
    dayEl.className   = 'emp-week-day';
    dayEl.textContent = srcShifts === state.templateShifts ? day : getDayTitle(day);
    row.appendChild(dayEl);

    const shiftsEl = document.createElement('div');
    shiftsEl.className = 'emp-week-shifts';

    if (dayShifts.length === 0) {
      const rest = document.createElement('div');
      rest.className   = 'emp-week-rest';
      rest.textContent = '休み';
      shiftsEl.appendChild(rest);
    } else {
      dayShifts.forEach(s => {
        if (!s.absent) totalMin += Math.max(0, (s.endMin - s.startMin) - (s.breakMin || 0));
        const entry = document.createElement('div');
        entry.className = 'emp-week-entry' + (s.absent ? ' is-absent' : '');
        const brk = s.breakMin > 0 ? `（休${s.breakMin}分）` : '';
        const abs = s.absent ? ' 当欠' : '';
        entry.textContent = `${minToTime(s.startMin)}〜${minToTime(s.endMin)}${brk}${abs}`;
        shiftsEl.appendChild(entry);
      });
    }

    row.appendChild(shiftsEl);
    body.appendChild(row);
  });

  // 週合計（実働）
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  const totalLabel = totalMin === 0 ? '0時間' : (m > 0 ? `${h}時間${m}分` : `${h}時間`);
  document.getElementById('emp-week-total').textContent = `${srcLabel} の合計（実働）: ${totalLabel}`;

  document.getElementById('modal-emp-week').classList.remove('hidden');
}

function closeEmpWeekModal() {
  document.getElementById('modal-emp-week').classList.add('hidden');
  weekViewEmpId = null;
}

// ========= ビュー切り替え =========
function switchView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(`view-${name}`).classList.add('active');
  document.querySelectorAll('.nav-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.view === name);
  });

  if (name === 'shift')        renderShiftChart();
  if (name === 'employees')    renderEmployeeList();
  if (name === 'requirements') renderShortageList();
  if (name === 'print')        renderPrintPreview();
}

// ========= 初期化 =========
function init() {
  // ナビ
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });

  // 曜日タブ
  document.querySelectorAll('.day-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.day-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      state.currentDay = tab.dataset.day;
      renderShiftChart();
    });
  });

  // === 週切り替え ===
  document.getElementById('btn-week-prev').addEventListener('click', () => {
    setCurrentWeek(addDaysToKey(state.currentWeek, -7));
  });
  document.getElementById('btn-week-next').addEventListener('click', () => {
    setCurrentWeek(addDaysToKey(state.currentWeek, 7));
  });
  const weekDateInput = document.getElementById('week-date-input');
  weekDateInput.addEventListener('click', () => {
    try { weekDateInput.showPicker(); } catch { /* 非対応ブラウザはネイティブ動作に任せる */ }
  });
  weekDateInput.addEventListener('change', () => {
    if (!weekDateInput.value) return;
    setCurrentWeek(getWeekKey(parseDateKey(weekDateInput.value)));
  });
  document.getElementById('btn-week-today').addEventListener('click', () => {
    setCurrentWeek(getWeekKey(getBusinessDate(new Date())));
  });
  document.getElementById('btn-mode-toggle').addEventListener('click', () => {
    state.mode = isTemplateMode() ? 'week' : 'template';
    renderShiftChart();
  });
  document.getElementById('btn-create-week').addEventListener('click', () => {
    if (getWeek(state.currentWeek)) return;
    createWeekFromTemplate(state.currentWeek);
    renderShiftChart();
  });
  document.getElementById('btn-recreate-week').addEventListener('click', () => {
    if (!getWeek(state.currentWeek)) return;
    const ok = confirm(
      `${formatWeekRange(state.currentWeek)} のシフトを、テンプレートから作り直します。
` +
      'この週で行った編集・当欠の設定はすべて消えます。よろしいですか?'
    );
    if (!ok) return;
    createWeekFromTemplate(state.currentWeek);
    renderShiftChart();
  });

  // === 行高さトグル ===
  document.getElementById('btn-hour-size').addEventListener('click', cycleHourSize);

  // === 勤務モーダル ===
  document.getElementById('btn-add-shift').addEventListener('click', () => openShiftModal());

  // シフトプリセット
  const presetWrap = document.getElementById('preset-buttons');
  PRESETS.forEach(([label, start, end]) => {
    const btn = document.createElement('button');
    btn.className   = 'preset-btn';
    btn.textContent = label;
    btn.type        = 'button';
    btn.addEventListener('click', () => {
      document.getElementById('shift-start').value = start;
      document.getElementById('shift-end').value   = end;
    });
    presetWrap.appendChild(btn);
  });

  // 休憩プリセットボタン
  document.querySelectorAll('.break-preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.getElementById('shift-break').value = btn.dataset.min;
      updateBreakBtnState();
    });
  });
  document.getElementById('shift-break').addEventListener('input', updateBreakBtnState);

  // 従業員切替時に仮トグルの表示を更新
  document.getElementById('shift-emp-select').addEventListener('change', updateTentativeGroup);

  document.getElementById('btn-shift-save').addEventListener('click', () => {
    const empId    = document.getElementById('shift-emp-select').value;
    const startStr = document.getElementById('shift-start').value;
    const endStr   = document.getElementById('shift-end').value;
    if (!empId || !startStr || !endStr) return;

    const emp = state.employees.find(e => e.id === empId);

    const startMin = timeToMin(startStr);
    let endMin     = timeToMin(endStr);
    if (endMin <= startMin) endMin += 1440;
    const breakMin = parseInt(document.getElementById('shift-break').value) || 0;

    // 仮の時間範囲（店長のみ）
    let tentativeStart = null, tentativeEnd = null;
    if (emp && emp.isManager) {
      const tsStr = document.getElementById('tentative-start').value;
      const teStr = document.getElementById('tentative-end').value;
      if (tsStr && teStr) {
        tentativeStart = timeToMin(tsStr);
        tentativeEnd   = timeToMin(teStr);
        if (tentativeEnd <= tentativeStart) tentativeEnd += 1440;
      }
    }

    const target = getTargetShifts();
    if (!target) return;
    if (state.editingShiftId) {
      const s = findTargetShift(state.editingShiftId);
      if (!s) return;
      Object.assign(s, { empId, startMin, endMin, breakMin });
      s.tentativeStart = tentativeStart;
      s.tentativeEnd   = tentativeEnd;
      delete s.isTentative; // 旧フォーマットを新フォーマットに移行
      if (!isTemplateMode()) s.absent = document.getElementById('shift-absent').checked;
    } else {
      const days = getSelectedDays();
      if (days.length === 0) return;
      const absent = isTemplateMode() ? {} : { absent: false };
      days.forEach(day => target.push({ id: uid(), empId, day, startMin, endMin, breakMin, tentativeStart, tentativeEnd, ...absent }));
    }
    saveShifts();
    closeShiftModal();
    renderShiftChart();
    renderShortageList();
    renderTentativeList();
  });

  document.getElementById('btn-shift-delete').addEventListener('click', () => {
    if (!state.editingShiftId) return;
    const target = getTargetShifts() || [];
    const idx = target.findIndex(s => s.id === state.editingShiftId);
    if (idx >= 0) target.splice(idx, 1);
    saveShifts();
    closeShiftModal();
    renderShiftChart();
    renderShortageList();
    renderTentativeList();
  });

  document.getElementById('btn-shift-cancel').addEventListener('click', closeShiftModal);

  document.getElementById('modal-shift').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeShiftModal();
  });

  // === 従業員週間スケジュールモーダル ===
  document.getElementById('btn-emp-week-close').addEventListener('click', closeEmpWeekModal);
  document.getElementById('btn-emp-week-edit').addEventListener('click', () => {
    const id = weekViewEmpId;
    closeEmpWeekModal();
    openEmpModal(id);
  });
  document.getElementById('modal-emp-week').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeEmpWeekModal();
  });

  // === 従業員モーダル ===
  document.getElementById('btn-add-employee').addEventListener('click', () => openEmpModal());

  // 区分ボタン
  document.querySelectorAll('.cat-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.selectedCategory = btn.dataset.cat;
      renderCategoryBtns();
    });
  });

  document.getElementById('btn-emp-save').addEventListener('click', () => {
    const name        = document.getElementById('emp-name').value.trim();
    const displayName = document.getElementById('emp-display-name').value.trim();
    const memo        = document.getElementById('emp-memo').value.trim();
    const isManager   = document.getElementById('emp-is-manager').checked;
    if (!name) return;
    if (state.editingEmpId) {
      const emp = state.employees.find(e => e.id === state.editingEmpId);
      emp.name        = name;
      emp.displayName = displayName;
      emp.color       = state.selectedColor;
      emp.category    = state.selectedCategory;
      emp.memo        = memo;
      emp.isManager   = isManager;
      // 店長フラグが外れたら仮の設定も解除
      if (!isManager) {
        getAllShiftLists().flat().filter(s => s.empId === emp.id).forEach(s => {
          s.isTentative    = false;
          s.tentativeStart = null;
          s.tentativeEnd   = null;
        });
        saveShifts();
      }
    } else {
      state.employees.push({
        id: uid(), name, displayName,
        color: state.selectedColor,
        category: state.selectedCategory,
        memo,
        isManager,
      });
    }
    saveEmployees();
    closeEmpModal();
    renderEmployeeList();
  });

  document.getElementById('btn-emp-delete').addEventListener('click', () => {
    const empId = state.editingEmpId;
    const emp   = state.employees.find(e => e.id === empId);
    if (!emp) return;
    if (!confirm(`${emp.name}さんを削除します。
テンプレートと今週以降のシフトからも削除されます（過去の週のシフトは残ります）。`)) return;

    const thisWeek = getThisWeekKey();
    state.templateShifts = state.templateShifts.filter(s => s.empId !== empId);
    let keepsPast = false;
    Object.entries(state.weeks).forEach(([weekKey, w]) => {
      if (weekKey >= thisWeek) w.shifts = w.shifts.filter(s => s.empId !== empId);
      else if (w.shifts.some(s => s.empId === empId)) keepsPast = true;
    });
    // 過去の週に勤務が残る場合は、名前表示のため「削除済み」として従業員データを残す
    if (keepsPast) emp.deleted = true;
    else state.employees = state.employees.filter(e => e.id !== empId);
    saveEmployees();
    saveShifts();
    closeEmpModal();
    renderEmployeeList();
  });

  document.getElementById('btn-emp-cancel').addEventListener('click', closeEmpModal);

  document.getElementById('modal-employee').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeEmpModal();
  });

  // === 必要人数サブタブ ===
  document.querySelectorAll('.req-subtab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.req-subtab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.req-subview').forEach(v => v.classList.add('hidden'));
      document.getElementById(`req-sub-${btn.dataset.subtab}`).classList.remove('hidden');
      if (btn.dataset.subtab === 'shortage')  renderShortageList();
      if (btn.dataset.subtab === 'tentative') renderTentativeList();
      if (btn.dataset.subtab === 'rules')     renderReqRules();
    });
  });

  // 不足リスト 時間帯フィルタ
  document.querySelectorAll('.shortage-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      shortageFilterId = btn.dataset.band;
      renderShortageList();
    });
  });

  // 募集中リスト 時間帯フィルタ
  document.querySelectorAll('.tentative-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      tentativeFilterId = btn.dataset.band;
      renderTentativeList();
    });
  });

  // 仮の時間範囲「全範囲」ボタン
  document.getElementById('btn-tentative-all').addEventListener('click', () => {
    const sv = document.getElementById('shift-start').value;
    const ev = document.getElementById('shift-end').value;
    if (sv) document.getElementById('tentative-start').value = sv;
    if (ev) document.getElementById('tentative-end').value   = ev;
  });

  // 全日コピー（req-copy-src から元曜日を読む）
  document.getElementById('btn-copy-all-days').addEventListener('click', () => {
    const day      = document.getElementById('req-copy-src').value;
    const dayRules = state.requirements.filter(r => r.day === day);
    if (!confirm(`${day}曜日のルールを全曜日にコピーします。\n他の曜日の設定は上書きされます。`)) return;
    state.requirements = state.requirements.filter(r => r.day === day);
    DAYS.forEach(d => {
      if (d === day) return;
      dayRules.forEach(rule => state.requirements.push({ ...rule, id: uid(), day: d }));
    });
    saveReqs();
    renderReqRules();
    renderShiftChart();
  });

  // === ルールモーダル ===
  document.getElementById('btn-add-req').addEventListener('click', () => openReqModal());

  // ルールプリセット
  const reqPresetWrap = document.getElementById('req-preset-buttons');
  PRESETS.forEach(([label, start, end]) => {
    const btn = document.createElement('button');
    btn.className   = 'preset-btn';
    btn.textContent = label;
    btn.type        = 'button';
    btn.addEventListener('click', () => {
      document.getElementById('req-start').value = start;
      document.getElementById('req-end').value   = end;
    });
    reqPresetWrap.appendChild(btn);
  });

  document.getElementById('req-count-dec').addEventListener('click', () => {
    state.reqModalCount = Math.max(0, state.reqModalCount - 1);
    document.getElementById('req-count-val').textContent = state.reqModalCount;
  });
  document.getElementById('req-count-inc').addEventListener('click', () => {
    state.reqModalCount++;
    document.getElementById('req-count-val').textContent = state.reqModalCount;
  });

  document.getElementById('btn-req-save').addEventListener('click', () => {
    const startStr = document.getElementById('req-start').value;
    const endStr   = document.getElementById('req-end').value;
    if (!startStr || !endStr) return;

    const startMin = timeToMin(startStr);
    let endMin     = timeToMin(endStr);
    if (endMin <= startMin) endMin += 1440;
    const day = document.getElementById('req-day-modal').value;
    state.reqDay = day;

    if (state.editingReqId) {
      const rule = state.requirements.find(r => r.id === state.editingReqId);
      Object.assign(rule, { day, startMin, endMin, count: state.reqModalCount });
    } else {
      state.requirements.push({
        id: uid(), day,
        startMin, endMin, count: state.reqModalCount,
      });
    }
    saveReqs();
    closeReqModal();
    renderReqRules();
    renderShiftChart();
  });

  document.getElementById('btn-req-delete').addEventListener('click', () => {
    if (!state.editingReqId) return;
    state.requirements = state.requirements.filter(r => r.id !== state.editingReqId);
    saveReqs();
    closeReqModal();
    renderReqRules();
    renderShiftChart();
  });

  document.getElementById('btn-req-cancel').addEventListener('click', closeReqModal);

  document.getElementById('modal-req').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeReqModal();
  });

  // === 画像保存 ===
  document.getElementById('btn-save-image').addEventListener('click', exportChartImage);

  // === エクスポート ===
  document.getElementById('btn-export').addEventListener('click', exportData);

  // === インポート ===
  document.getElementById('btn-import-trigger').addEventListener('click', () => {
    document.getElementById('import-file').value = ''; // 同ファイル再選択を許可
    document.getElementById('import-file').click();
  });

  document.getElementById('import-file').addEventListener('change', e => {
    handleImport(e.target.files[0]);
  });

  renderShiftChart();
}

document.addEventListener('DOMContentLoaded', init);
