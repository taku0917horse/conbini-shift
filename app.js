'use strict';

// ========= 定数 =========
const DAYS = ['月', '火', '水', '木', '金', '土', '日'];
const HOUR_H = 48; // px per hour (matches CSS --hour-h)
const TOTAL_HOURS = 24;

// 3:00起点の分→実時刻文字列
function minToTime(m) {
  const total = (m + 3 * 60) % (24 * 60);
  const h = Math.floor(total / 60);
  const mm = total % 60;
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

// 実時刻文字列 "HH:MM" → 3:00起点の分
function timeToMin(str) {
  const [h, m] = str.split(':').map(Number);
  return ((h - 3 + 24) % 24) * 60 + m;
}

// 3:00起点の分 → ピクセル位置
function minToPx(m) {
  return (m / 60) * HOUR_H;
}

// プリセット定義 [ラベル, startTime, endTime]
const PRESETS = [
  ['3-6',   '03:00', '06:00'],
  ['6-9',   '06:00', '09:00'],
  ['9-13',  '09:00', '13:00'],
  ['13-17', '13:00', '17:00'],
  ['17-22', '17:00', '22:00'],
  ['22-3',  '22:00', '03:00'],
];

// デフォルト色パレット
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
let state = {
  employees: store.load('employees', []),
  shifts: store.load('shifts', []),
  requirements: store.load('requirements', {}),
  currentDay: '月',
  editingShiftId: null,
  editingEmpId: null,
  selectedColor: COLORS[0],
  reqDay: '月',
};

function saveEmployees() { store.save('employees', state.employees); }
function saveShifts()    { store.save('shifts', state.shifts); }
function saveReqs()      { store.save('requirements', state.requirements); }

function getReq(day, hour) {
  return state.requirements[`${day}-${hour}`] ?? 1;
}

function setReq(day, hour, val) {
  state.requirements[`${day}-${hour}`] = Math.max(0, val);
  saveReqs();
}

// ========= ID生成 =========
function uid() { return Math.random().toString(36).slice(2, 10); }

// ========= シフトチャート描画 =========
function renderShiftChart() {
  const day = state.currentDay;
  const labels = document.getElementById('time-labels');
  const lanes  = document.getElementById('shift-lanes');
  const overlay = document.getElementById('requirement-overlay');

  // 時刻ラベル & 水平線
  labels.innerHTML = '';
  lanes.innerHTML  = '';
  overlay.innerHTML = '';

  const totalPx = HOUR_H * TOTAL_HOURS;
  lanes.style.minHeight = totalPx + 'px';

  for (let h = 0; h <= TOTAL_HOURS; h++) {
    const y = h * HOUR_H;
    const realH = (h + 3) % 24;

    const lbl = document.createElement('div');
    lbl.className = 'time-label';
    lbl.style.top = y + 'px';
    lbl.textContent = `${String(realH).padStart(2, '0')}:00`;
    labels.appendChild(lbl);

    if (h < TOTAL_HOURS) {
      const line = document.createElement('div');
      line.className = 'hour-line';
      line.style.top = y + 'px';
      lanes.appendChild(line);
    }
  }

  // この曜日のシフトを取得
  const dayShifts = state.shifts.filter(s => s.day === day);

  // レーン割り当て（開始時刻順に処理して空きレーンを再利用）
  const laneEnds = []; // 各レーンの終了min（前の勤務）
  const sorted = [...dayShifts].sort((a, b) => a.startMin - b.startMin);

  const shiftLayouts = sorted.map(shift => {
    // 終了時刻 <= 開始時刻 のレーンを再利用（境界は重なりとみなさない）
    let lane = laneEnds.findIndex(e => e <= shift.startMin);
    if (lane === -1) { lane = laneEnds.length; }
    laneEnds[lane] = shift.endMin;
    return { shift, lane };
  });

  const numLanes = Math.max(1, laneEnds.length);
  const LANE_W = 1 / numLanes;

  shiftLayouts.forEach(({ shift, lane }) => {
    const emp = state.employees.find(e => e.id === shift.empId);
    if (!emp) return;

    const top    = minToPx(shift.startMin);
    const height = Math.max(20, minToPx(shift.endMin - shift.startMin));
    const left   = lane * LANE_W * 100 + '%';
    const width  = LANE_W * 100 - 1 + '%';

    const bar = document.createElement('div');
    bar.className = 'shift-bar';
    bar.style.cssText = `
      top: ${top}px;
      height: ${height}px;
      left: ${left};
      width: ${width};
      background: ${emp.color};
    `;
    bar.textContent = emp.name;
    bar.dataset.shiftId = shift.id;
    bar.addEventListener('click', () => openShiftModal(shift.id));
    lanes.appendChild(bar);
  });

  // 不足オーバーレイ
  for (let h = 0; h < TOTAL_HOURS; h++) {
    const required = getReq(day, (h + 3) % 24);
    if (required === 0) continue;

    const hMin = h * 60;
    const count = dayShifts.filter(s => s.startMin <= hMin && s.endMin > hMin).length;
    if (count >= required) continue;

    const block = document.createElement('div');
    block.className = 'req-block ' + (count === 0 ? 'empty' : 'shortage');
    block.style.top    = (h * HOUR_H) + 'px';
    block.style.height = HOUR_H + 'px';
    block.textContent  = count === 0 ? '0人' : `あと${required - count}人`;
    overlay.appendChild(block);
  }
}

// ========= 従業員リスト描画 =========
function renderEmployeeList() {
  const ul = document.getElementById('employee-list');
  ul.innerHTML = '';
  if (state.employees.length === 0) {
    ul.innerHTML = '<li style="padding:20px;text-align:center;color:#9ca3af">従業員を追加してください</li>';
    return;
  }
  state.employees.forEach(emp => {
    const li = document.createElement('li');
    li.className = 'employee-item';
    li.innerHTML = `
      <div class="emp-color-dot" style="background:${emp.color}"></div>
      <span class="emp-name">${emp.name}</span>
    `;
    li.addEventListener('click', () => openEmpModal(emp.id));
    ul.appendChild(li);
  });
}

// ========= 必要人数グリッド描画 =========
const REQ_BANDS = [
  { label: '3:00〜6:00',   hours: [3,4,5] },
  { label: '6:00〜9:00',   hours: [6,7,8] },
  { label: '9:00〜13:00',  hours: [9,10,11,12] },
  { label: '13:00〜17:00', hours: [13,14,15,16] },
  { label: '17:00〜22:00', hours: [17,18,19,20,21] },
  { label: '22:00〜翌3:00',hours: [22,23,0,1,2] },
];

function getBandReq(day, band) {
  return getReq(day, band.hours[0]);
}

function setBandReq(day, band, val) {
  band.hours.forEach(h => setReq(day, h, val));
}

function renderReqGrid() {
  const day = state.reqDay;
  const grid = document.getElementById('req-grid');
  grid.innerHTML = '';

  REQ_BANDS.forEach(band => {
    const current = getBandReq(day, band);
    const row = document.createElement('div');
    row.className = 'req-band';
    row.innerHTML = `
      <span class="req-band-label">${band.label}</span>
      <div class="req-band-control">
        <button class="req-dec">－</button>
        <span class="req-count">${current}</span>
        <button class="req-inc">＋</button>
      </div>
    `;
    row.querySelector('.req-dec').addEventListener('click', () => {
      setBandReq(day, band, getBandReq(day, band) - 1);
      renderReqGrid();
      renderShiftChart();
    });
    row.querySelector('.req-inc').addEventListener('click', () => {
      setBandReq(day, band, getBandReq(day, band) + 1);
      renderReqGrid();
      renderShiftChart();
    });
    grid.appendChild(row);
  });
}

// ========= 印刷テーブル生成 =========
function buildPrintTable() {
  const table = document.createElement('table');
  table.className = 'print-table';

  // ヘッダ行
  const thead = table.createTHead();
  const hrow  = thead.insertRow();
  hrow.insertCell().textContent = '時間';
  DAYS.forEach(d => {
    const th = document.createElement('th');
    th.textContent = d;
    hrow.appendChild(th);
  });

  // 時間行（3:00〜翌3:00, 1時間ごと）
  const tbody = table.createTBody();
  for (let h = 0; h < 24; h++) {
    const realH = (h + 3) % 24;
    const hMin  = h * 60;
    const tr = tbody.insertRow();

    const tc = tr.insertCell();
    tc.className = 'time-col';
    tc.textContent = `${String(realH).padStart(2,'0')}:00`;

    DAYS.forEach(day => {
      const td = tr.insertCell();
      const required = getReq(day, realH);
      const dayShifts = state.shifts.filter(s => s.day === day);
      const working   = dayShifts.filter(s => s.startMin <= hMin && s.endMin > hMin);

      if (working.length === 0 && required > 0) {
        td.className = 'print-empty print-cell';
      } else if (working.length < required) {
        td.className = 'print-shortage print-cell';
      } else {
        td.className = 'print-cell';
      }

      working.forEach(s => {
        const emp = state.employees.find(e => e.id === s.empId);
        if (!emp) return;
        const tag = document.createElement('span');
        tag.className = 'print-emp-tag';
        tag.style.background = emp.color;
        tag.textContent = emp.name;
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

// ========= 曜日トグルボタン描画 =========
function renderDayToggles(selectedDays, readonly = false) {
  const wrap = document.getElementById('day-toggle-buttons');
  const hint = document.getElementById('day-toggle-hint');
  wrap.innerHTML = '';
  hint.style.display = readonly ? 'none' : '';

  DAYS.forEach(d => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'day-toggle-btn' + (selectedDays.includes(d) ? ' on' : '');
    btn.textContent = d;
    if (!readonly) {
      btn.addEventListener('click', () => {
        btn.classList.toggle('on');
        updateSaveBtnState();
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

function updateSaveBtnState() {
  const saveBtn = document.getElementById('btn-shift-save');
  saveBtn.disabled = getSelectedDays().length === 0;
  saveBtn.style.opacity = saveBtn.disabled ? '0.4' : '';
}

// ========= モーダル: 勤務 =========
function openShiftModal(shiftId = null) {
  const modal   = document.getElementById('modal-shift');
  const title   = document.getElementById('modal-shift-title');
  const empSel  = document.getElementById('shift-emp-select');
  const startIn = document.getElementById('shift-start');
  const endIn   = document.getElementById('shift-end');
  const delBtn  = document.getElementById('btn-shift-delete');

  state.editingShiftId = shiftId;

  // 従業員セレクト更新
  empSel.innerHTML = '';
  if (state.employees.length === 0) {
    empSel.innerHTML = '<option value="">先に従業員を追加してください</option>';
  } else {
    state.employees.forEach(emp => {
      const opt = document.createElement('option');
      opt.value = emp.id;
      opt.textContent = emp.name;
      empSel.appendChild(opt);
    });
  }

  if (shiftId) {
    // 編集: 1曜日のみ（読み取り専用トグル）
    const shift = state.shifts.find(s => s.id === shiftId);
    title.textContent = '勤務編集';
    empSel.value  = shift.empId;
    startIn.value = minToTime(shift.startMin);
    endIn.value   = minToTime(shift.endMin);
    delBtn.classList.remove('hidden');
    renderDayToggles([shift.day], true);
  } else {
    // 新規追加: 現在の曜日をデフォルト選択
    title.textContent = '勤務追加';
    startIn.value = '09:00';
    endIn.value   = '17:00';
    delBtn.classList.add('hidden');
    renderDayToggles([state.currentDay], false);
  }

  updateSaveBtnState();
  modal.classList.remove('hidden');
}

function closeShiftModal() {
  document.getElementById('modal-shift').classList.add('hidden');
  state.editingShiftId = null;
}

// ========= モーダル: 従業員 =========
function openEmpModal(empId = null) {
  const modal  = document.getElementById('modal-employee');
  const title  = document.getElementById('modal-emp-title');
  const nameIn = document.getElementById('emp-name');
  const delBtn = document.getElementById('btn-emp-delete');

  state.editingEmpId = empId;

  if (empId) {
    const emp = state.employees.find(e => e.id === empId);
    title.textContent = '従業員編集';
    nameIn.value = emp.name;
    state.selectedColor = emp.color;
    delBtn.classList.remove('hidden');
  } else {
    title.textContent = '従業員追加';
    nameIn.value = '';
    state.selectedColor = COLORS[state.employees.length % COLORS.length];
    delBtn.classList.add('hidden');
  }

  renderColorPicker();
  modal.classList.remove('hidden');
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
    sw.className = 'color-swatch' + (c === state.selectedColor ? ' selected' : '');
    sw.style.background = c;
    sw.addEventListener('click', () => {
      state.selectedColor = c;
      renderColorPicker();
    });
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
  if (name === 'requirements') renderReqGrid();
  if (name === 'print')        renderPrintPreview();
}

// ========= 初期化 =========
function init() {
  // ナビボタン
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

  // ＋勤務追加
  document.getElementById('btn-add-shift').addEventListener('click', () => openShiftModal());

  // プリセットボタン生成
  const presetWrap = document.getElementById('preset-buttons');
  PRESETS.forEach(([label, start, end]) => {
    const btn = document.createElement('button');
    btn.className = 'preset-btn';
    btn.textContent = label;
    btn.type = 'button';
    btn.addEventListener('click', () => {
      document.getElementById('shift-start').value = start;
      document.getElementById('shift-end').value   = end;
    });
    presetWrap.appendChild(btn);
  });

  // 勤務保存
  document.getElementById('btn-shift-save').addEventListener('click', () => {
    const empId    = document.getElementById('shift-emp-select').value;
    const startStr = document.getElementById('shift-start').value;
    const endStr   = document.getElementById('shift-end').value;

    if (!empId || !startStr || !endStr) return;

    const startMin = timeToMin(startStr);
    let endMin     = timeToMin(endStr);
    if (endMin <= startMin) endMin += 1440; // 翌日越えを補正

    if (state.editingShiftId) {
      // 編集: 1件だけ更新（曜日はそのまま）
      const s = state.shifts.find(x => x.id === state.editingShiftId);
      Object.assign(s, { empId, startMin, endMin });
    } else {
      // 新規: 選択した全曜日に1件ずつ追加
      const days = getSelectedDays();
      if (days.length === 0) return;
      days.forEach(day => {
        state.shifts.push({ id: uid(), empId, day, startMin, endMin });
      });
    }

    saveShifts();
    closeShiftModal();
    renderShiftChart();
  });

  // 勤務削除
  document.getElementById('btn-shift-delete').addEventListener('click', () => {
    if (!state.editingShiftId) return;
    state.shifts = state.shifts.filter(s => s.id !== state.editingShiftId);
    saveShifts();
    closeShiftModal();
    renderShiftChart();
  });

  // 勤務キャンセル
  document.getElementById('btn-shift-cancel').addEventListener('click', closeShiftModal);

  // ＋従業員追加
  document.getElementById('btn-add-employee').addEventListener('click', () => openEmpModal());

  // 従業員保存
  document.getElementById('btn-emp-save').addEventListener('click', () => {
    const name = document.getElementById('emp-name').value.trim();
    if (!name) return;

    if (state.editingEmpId) {
      const emp = state.employees.find(e => e.id === state.editingEmpId);
      emp.name  = name;
      emp.color = state.selectedColor;
    } else {
      state.employees.push({ id: uid(), name, color: state.selectedColor });
    }

    saveEmployees();
    closeEmpModal();
    renderEmployeeList();
  });

  // 従業員削除
  document.getElementById('btn-emp-delete').addEventListener('click', () => {
    if (!state.editingEmpId) return;
    state.employees = state.employees.filter(e => e.id !== state.editingEmpId);
    state.shifts    = state.shifts.filter(s => s.empId !== state.editingEmpId);
    saveEmployees();
    saveShifts();
    closeEmpModal();
    renderEmployeeList();
  });

  // 従業員キャンセル
  document.getElementById('btn-emp-cancel').addEventListener('click', closeEmpModal);

  // 必要人数: 曜日切り替え
  document.getElementById('req-day-select').addEventListener('change', e => {
    state.reqDay = e.target.value;
    renderReqGrid();
  });

  // 全曜日コピー
  document.getElementById('btn-copy-all-days').addEventListener('click', () => {
    const day = state.reqDay;
    REQ_BANDS.forEach(band => {
      const val = getBandReq(day, band);
      DAYS.forEach(d => {
        if (d !== day) setBandReq(d, band, val);
      });
    });
    saveReqs();
    alert('全曜日にコピーしました');
  });

  // 印刷ボタン
  document.getElementById('btn-print').addEventListener('click', () => {
    renderPrintArea();
    window.print();
  });

  // モーダル外クリックで閉じる
  document.getElementById('modal-shift').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeShiftModal();
  });
  document.getElementById('modal-employee').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeEmpModal();
  });

  // 初期描画
  renderShiftChart();
}

document.addEventListener('DOMContentLoaded', init);
