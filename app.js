'use strict';

// ========= 定数 =========
const DAYS = ['月', '火', '水', '木', '金', '土', '日'];
const HOUR_H     = 48;
const TOTAL_HOURS = 27;   // 3:00〜翌6:00 の 27 時間
const MAX_MIN     = 1620; // 27h * 60min

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

// 実時刻文字列 "HH:MM" → 3:00起点の分（深夜またぎは呼び出し元で +1440 補正）
function timeToMin(str) {
  const [h, m] = str.split(':').map(Number);
  return ((h - 3 + 24) % 24) * 60 + m;
}

function minToPx(m) {
  return (m / 60) * HOUR_H;
}

const PRESETS = [
  ['3-6',   '03:00', '06:00'],
  ['6-9',   '06:00', '09:00'],
  ['9-13',  '09:00', '13:00'],
  ['13-17', '13:00', '17:00'],
  ['17-22', '17:00', '22:00'],
  ['22-3',  '22:00', '03:00'],
  ['22-4',  '22:00', '04:00'],
  ['22-6',  '22:00', '06:00'],
];

const COLORS = [
  '#2563eb', '#16a34a', '#dc2626', '#9333ea',
  '#ea580c', '#0891b2', '#be185d', '#65a30d',
];

// ========= ストレージ =========
const store = {
  load(key, def) {
    try { return JSON.parse(localStorage.getItem(key)) ?? def; }
    catch { return def; }
  },
  save(key, val) { localStorage.setItem(key, JSON.stringify(val)); },
};

// ========= 状態 =========
// requirements は配列: [{ id, day, startMin, endMin, count }]
// 旧フォーマット（object）の場合はリセット
let rawReqs = store.load('requirements', []);
if (!Array.isArray(rawReqs)) rawReqs = [];

const state = {
  employees:     store.load('employees', []),
  shifts:        store.load('shifts', []),
  requirements:  rawReqs,
  currentDay:    '月',
  editingShiftId: null,
  editingEmpId:   null,
  editingReqId:   null,
  reqModalCount:  2,
  selectedColor:  COLORS[0],
  reqDay:         '月',
};

function touchDataDate() { store.save('currentDataDate', new Date().toISOString()); }
function saveEmployees() { store.save('employees', state.employees); touchDataDate(); }
function saveShifts()    { store.save('shifts', state.shifts); touchDataDate(); }
function saveReqs()      { store.save('requirements', state.requirements); touchDataDate(); }
function uid()           { return Math.random().toString(36).slice(2, 10); }

// ========= 日時フォーマット =========
function formatDatetime(d) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${p(d.getMonth()+1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// ========= エクスポート =========
function exportData() {
  const now     = new Date();
  const payload = {
    version:    1,
    exportedAt: now.toISOString(),
    data: {
      employees:    state.employees,
      shifts:       state.shifts,
      requirements: state.requirements,
    },
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

    // バリデーション
    if (payload.version !== 1) {
      alert(`非対応のデータ形式です（version: ${payload.version ?? '不明'}）`);
      return;
    }
    const d = payload.data;
    if (!d || !Array.isArray(d.employees) || !Array.isArray(d.shifts) || !Array.isArray(d.requirements)) {
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

    // データ適用（saveXxx 経由にすると touchDataDate が走るため直接書き込み、最後に日時をセット）
    state.employees    = d.employees;
    state.shifts       = d.shifts;
    state.requirements = d.requirements;
    store.save('employees',    d.employees);
    store.save('shifts',       d.shifts);
    store.save('requirements', d.requirements);
    store.save('currentDataDate', payload.exportedAt ?? new Date().toISOString());

    switchView('shift');
    alert('読み込みが完了しました');
  };

  reader.onerror = () => alert('ファイルの読み込みに失敗しました。');
  reader.readAsText(file, 'utf-8');
}

// ========= 必要人数ロジック =========
// 指定時刻（3:00起点分）における必要人数。重複ルールは最大値。未設定は0。
function getRequiredCount(day, min) {
  const rules = state.requirements.filter(
    r => r.day === day && r.startMin <= min && r.endMin > min
  );
  return rules.length === 0 ? 0 : Math.max(...rules.map(r => r.count));
}

// 曜日の不足区間をイベントベースで計算し、連続区間をマージして返す
function computeShortages(day) {
  const dayShifts = state.shifts.filter(s => s.day === day);
  const dayReqs   = state.requirements.filter(r => r.day === day);
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

  // 時刻ラベル & 水平線
  for (let h = 0; h <= TOTAL_HOURS; h++) {
    const y     = h * HOUR_H;
    const realH = (h + 3) % 24;
    const lbl   = document.createElement('div');
    lbl.className   = 'time-label';
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
  const dayShifts = state.shifts.filter(s => s.day === day);
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

    const bar = document.createElement('div');
    bar.className = 'shift-bar';
    bar.style.cssText = [
      `top:${minToPx(shift.startMin)}px`,
      `height:${Math.max(20, minToPx(shift.endMin - shift.startMin))}px`,
      `left:${lane * laneW * 100}%`,
      `width:${laneW * 100 - 1}%`,
      `background:${emp.color}`,
    ].join(';');
    const nameSpan = document.createElement('span');
    nameSpan.textContent = emp.name;
    bar.appendChild(nameSpan);
    if (shift.breakMin > 0) {
      const brk = document.createElement('span');
      brk.className   = 'bar-break';
      brk.textContent = `休${shift.breakMin}`;
      bar.appendChild(brk);
    }
    bar.addEventListener('click', () => openShiftModal(shift.id));
    lanes.appendChild(bar);
  });

  // 不足オーバーレイ（1時間単位）
  for (let h = 0; h < TOTAL_HOURS; h++) {
    const hMin     = h * 60;
    const required = getRequiredCount(day, hMin);
    if (required === 0) continue;
    const count = dayShifts.filter(s => s.startMin <= hMin && s.endMin > hMin).length;
    if (count >= required) continue;

    const block = document.createElement('div');
    block.className   = 'req-block ' + (count === 0 ? 'empty' : 'shortage');
    block.style.top   = (h * HOUR_H) + 'px';
    block.style.height = HOUR_H + 'px';
    block.textContent = count === 0 ? '0人' : `あと${required - count}人`;
    overlay.appendChild(block);
  }
}

// ========= 従業員リスト描画 =========
function renderEmployeeList() {
  const ul = document.getElementById('employee-list');
  ul.innerHTML = '';
  if (state.employees.length === 0) {
    ul.innerHTML = '<li class="empty-msg">従業員を追加してください</li>';
    return;
  }
  state.employees.forEach(emp => {
    const li = document.createElement('li');
    li.className = 'employee-item';
    const dn = emp.displayName || emp.name.slice(0, 2);
    li.innerHTML = `
      <div class="emp-color-dot" style="background:${emp.color}"></div>
      <div class="emp-info">
        <span class="emp-name">${emp.name}</span>
        <span class="emp-dn">略称: ${dn}</span>
      </div>
    `;
    li.addEventListener('click', () => openEmpModal(emp.id));
    ul.appendChild(li);
  });
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

  let hasAny = false;
  DAYS.forEach(day => {
    const shortages = computeShortages(day);
    if (shortages.length === 0) return;
    hasAny = true;

    const section = document.createElement('div');
    section.className = 'shortage-section';

    const title = document.createElement('div');
    title.className   = 'shortage-day-title';
    title.textContent = day + '曜日';
    section.appendChild(title);

    shortages.forEach(s => {
      const row = document.createElement('div');
      row.className = 'shortage-row';
      row.innerHTML = `
        <span class="shortage-time">${minToTime(s.startMin)}〜${minToTime(s.endMin)}</span>
        <span class="shortage-badge">あと${s.short}人</span>
      `;
      section.appendChild(row);
    });

    list.appendChild(section);
  });

  if (!hasAny) {
    list.innerHTML = '<div class="empty-msg" style="padding-top:48px">不足なし</div>';
  }
}

// ========= 印刷テーブル生成 =========
// 基本帯の境界に対応するh値（3:00起点）: 3:00/6:00/9:00/13:00/17:00/22:00/翌3:00
const BAND_H = new Set([0, 3, 6, 10, 14, 19, 24]);

function buildPrintTable() {
  const colData = DAYS.map(day => {
    const dayShifts = state.shifts.filter(s => s.day === day);

    // 時間ごとの勤務者セット（比較キーと表示用リスト）
    const slots = Array.from({ length: 27 }, (_, h) => {
      const hMin = h * 60;
      const ws   = dayShifts
        .filter(s => s.startMin <= hMin && s.endMin > hMin)
        .sort((a, b) => a.startMin - b.startMin);
      return {
        key:   ws.map(s => s.empId).sort().join(','),
        items: ws.map(s => {
          const emp = state.employees.find(e => e.id === s.empId);
          return emp ? { emp, breakMin: s.breakMin || 0 } : null;
        }).filter(Boolean),
      };
    });

    // 同一セットが連続する区間をまとめてrowspanを計算
    const cells = [];
    let h = 0;
    while (h < 27) {
      const { key, items } = slots[h];
      let span = 1;
      while (h + span < 27 && slots[h + span].key === key) span++;
      cells.push({ items, rowspan: span, startH: h, skip: false });
      for (let j = 1; j < span; j++) cells.push({ skip: true });
      h += span;
    }
    return { cells, day };
  });

  // テーブル組立
  const table = document.createElement('table');
  table.className = 'print-table';

  const thead = table.createTHead();
  const hrow  = thead.insertRow();
  hrow.insertCell().textContent = '時間';
  DAYS.forEach(d => {
    const th = document.createElement('th');
    th.textContent = d;
    hrow.appendChild(th);
  });

  const tbody = table.createTBody();
  for (let h = 0; h < 27; h++) {
    const realH = (h + 3) % 24;
    const tr    = tbody.insertRow();
    if (BAND_H.has(h)) tr.classList.add('band-row');
    const tc    = tr.insertCell();
    tc.className   = 'time-col';
    tc.textContent = (h >= 24 ? '翌' : '') + `${String(realH).padStart(2,'0')}:00`;

    colData.forEach(({ cells, day }) => {
      const cell = cells[h];
      if (cell.skip) return;

      const td = tr.insertCell();
      if (cell.rowspan > 1) td.rowSpan = cell.rowspan;

      // スパン全体で不足チェック
      const cnt = cell.items.length;
      let cls = 'print-cell';
      for (let hi = h; hi < h + cell.rowspan; hi++) {
        const req = getRequiredCount(day, hi * 60);
        if (req > 0 && cnt === 0)   { cls = 'print-empty print-cell'; break; }
        if (req > 0 && cnt < req && cls !== 'print-empty print-cell') {
          cls = 'print-shortage print-cell';
        }
      }
      td.className = cls;

      // 従業員タグ（略称 + 休憩マーク）
      cell.items.forEach(({ emp, breakMin }) => {
        const tag = document.createElement('span');
        tag.className        = 'print-emp-tag';
        tag.style.background = emp.color;
        const label = emp.displayName || emp.name.slice(0, 2);
        tag.textContent = breakMin > 0 ? `${label}休` : label;
        td.appendChild(tag);
      });
    });
  }
  return table;
}

function renderPrintPreview() {
  const preview = document.getElementById('print-preview');
  preview.innerHTML = '';
  preview.appendChild(buildPrintTable());
}

function renderPrintArea() {
  const area = document.getElementById('print-area');
  area.innerHTML = '';
  area.appendChild(buildPrintTable());
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
function openShiftModal(shiftId = null) {
  state.editingShiftId = shiftId;
  const empSel  = document.getElementById('shift-emp-select');
  const startIn = document.getElementById('shift-start');
  const endIn   = document.getElementById('shift-end');
  const breakIn = document.getElementById('shift-break');
  const delBtn  = document.getElementById('btn-shift-delete');

  empSel.innerHTML = state.employees.length === 0
    ? '<option value="">先に従業員を追加してください</option>'
    : '';
  state.employees.forEach(emp => {
    const opt = document.createElement('option');
    opt.value = emp.id;
    opt.textContent = emp.name;
    empSel.appendChild(opt);
  });

  if (shiftId) {
    const shift = state.shifts.find(s => s.id === shiftId);
    document.getElementById('modal-shift-title').textContent = '勤務編集';
    empSel.value  = shift.empId;
    startIn.value = minToTimeInput(shift.startMin);
    endIn.value   = minToTimeInput(shift.endMin);
    breakIn.value = shift.breakMin || 0;
    delBtn.classList.remove('hidden');
    renderDayToggles([shift.day], true);
  } else {
    document.getElementById('modal-shift-title').textContent = '勤務追加';
    startIn.value = '09:00';
    endIn.value   = '17:00';
    breakIn.value = 0;
    delBtn.classList.add('hidden');
    renderDayToggles([state.currentDay], false);
  }

  updateBreakBtnState();
  updateShiftSaveBtnState();
  document.getElementById('modal-shift').classList.remove('hidden');
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
  const delBtn = document.getElementById('btn-emp-delete');

  if (empId) {
    const emp = state.employees.find(e => e.id === empId);
    document.getElementById('modal-emp-title').textContent = '従業員編集';
    nameIn.value        = emp.name;
    dnIn.value          = emp.displayName || '';
    state.selectedColor = emp.color;
    delBtn.classList.remove('hidden');
  } else {
    document.getElementById('modal-emp-title').textContent = '従業員追加';
    nameIn.value        = '';
    dnIn.value          = '';
    state.selectedColor = COLORS[state.employees.length % COLORS.length];
    delBtn.classList.add('hidden');
  }
  renderColorPicker();
  document.getElementById('modal-employee').classList.remove('hidden');
}

function closeEmpModal() {
  document.getElementById('modal-employee').classList.add('hidden');
  state.editingEmpId = null;
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

  document.getElementById('btn-shift-save').addEventListener('click', () => {
    const empId    = document.getElementById('shift-emp-select').value;
    const startStr = document.getElementById('shift-start').value;
    const endStr   = document.getElementById('shift-end').value;
    if (!empId || !startStr || !endStr) return;

    const startMin = timeToMin(startStr);
    let endMin     = timeToMin(endStr);
    if (endMin <= startMin) endMin += 1440;
    const breakMin = parseInt(document.getElementById('shift-break').value) || 0;

    if (state.editingShiftId) {
      const s = state.shifts.find(x => x.id === state.editingShiftId);
      Object.assign(s, { empId, startMin, endMin, breakMin });
    } else {
      const days = getSelectedDays();
      if (days.length === 0) return;
      days.forEach(day => state.shifts.push({ id: uid(), empId, day, startMin, endMin, breakMin }));
    }
    saveShifts();
    closeShiftModal();
    renderShiftChart();
  });

  document.getElementById('btn-shift-delete').addEventListener('click', () => {
    if (!state.editingShiftId) return;
    state.shifts = state.shifts.filter(s => s.id !== state.editingShiftId);
    saveShifts();
    closeShiftModal();
    renderShiftChart();
  });

  document.getElementById('btn-shift-cancel').addEventListener('click', closeShiftModal);

  document.getElementById('modal-shift').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeShiftModal();
  });

  // === 従業員モーダル ===
  document.getElementById('btn-add-employee').addEventListener('click', () => openEmpModal());

  document.getElementById('btn-emp-save').addEventListener('click', () => {
    const name        = document.getElementById('emp-name').value.trim();
    const displayName = document.getElementById('emp-display-name').value.trim();
    if (!name) return;
    if (state.editingEmpId) {
      const emp = state.employees.find(e => e.id === state.editingEmpId);
      emp.name        = name;
      emp.displayName = displayName;
      emp.color       = state.selectedColor;
    } else {
      state.employees.push({ id: uid(), name, displayName, color: state.selectedColor });
    }
    saveEmployees();
    closeEmpModal();
    renderEmployeeList();
  });

  document.getElementById('btn-emp-delete').addEventListener('click', () => {
    if (!state.editingEmpId) return;
    state.employees = state.employees.filter(e => e.id !== state.editingEmpId);
    state.shifts    = state.shifts.filter(s => s.empId !== state.editingEmpId);
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
      if (btn.dataset.subtab === 'shortage') renderShortageList();
      if (btn.dataset.subtab === 'rules')    renderReqRules();
    });
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

  // === 印刷 ===
  document.getElementById('btn-print').addEventListener('click', () => {
    renderPrintArea();
    window.print();
  });

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
