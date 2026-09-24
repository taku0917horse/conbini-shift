// UI: 週の表示（短い表記）/ 共有・データタブの並び / 必要人数は全週共通の説明
const { boot, check, finish } = require('../helpers/harness');

const { w, $ } = boot({ employees: [], templateShifts: [], weeks: {}, requirements: [] });

// 1. 週の表示
check('週の表示は短い表記', $('week-label').textContent === '9/21〜9/27');
$('btn-mode-toggle').click();
check('テンプレート表示は今まで通り', $('week-label').textContent === 'テンプレート（毎週の基本パターン）');
$('btn-mode-toggle').click();
$('week-date-input').value = '2027-01-06';
$('week-date-input').dispatchEvent(new w.Event('change'));
check('今年以外は年を付ける', $('week-label').textContent === '2027/1/4〜1/10');

// 2. 共有・データタブの並び
const order = [...$('print-scroll-area').children].map(e => e.id);
check('並び: クラウド同期 → データ管理 → 印刷 → プレビュー',
  JSON.stringify(order) === '["cloud-section","data-section","print-section","print-preview"]');

// 4. 必要人数は全週共通
w.switchView('requirements');
check('不足リストでは対象の週を表示', !$('req-target-label').classList.contains('hidden'));
w.document.querySelector('.req-subtab[data-subtab="rules"]').click();
check('ルール設定に「全週で共通」の説明', $('req-sub-rules').textContent.includes('必要人数はすべての週で共通です'));
check('ルール設定では対象の週を隠す', $('req-target-label').classList.contains('hidden'));
w.switchView('shift');
w.switchView('requirements');
check('タブを行き来しても（ルール設定のまま）隠れたまま', $('req-target-label').classList.contains('hidden'));
w.document.querySelector('.req-subtab[data-subtab="tentative"]').click();
check('募集中に切り替えると対象の週を表示', !$('req-target-label').classList.contains('hidden'));

finish();
