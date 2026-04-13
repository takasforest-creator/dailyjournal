'use strict';

/* =========================================
   定数 & 状態
   ========================================= */
const STORAGE_KEY = 'dailyjournal_entries';

let stream = null;          // MediaStream
let capturedDataUrl = null; // 撮影した写真の DataURL

/* =========================================
   ユーティリティ
   ========================================= */
function formatDate(isoString) {
  const d = new Date(isoString);
  const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日（${weekdays[d.getDay()]}）`;
}

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function loadEntries() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch {
    return [];
  }
}

function saveEntries(entries) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

function showToast(message) {
  const toast = document.getElementById('save-toast');
  toast.textContent = message;
  toast.hidden = false;
  toast.style.animation = 'none';
  // reflow
  void toast.offsetWidth;
  toast.style.animation = '';
  setTimeout(() => { toast.hidden = true; }, 2100);
}

/* =========================================
   ヘッダー日付
   ========================================= */
function initHeader() {
  const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
  const d = new Date();
  document.getElementById('today-date').textContent =
    `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}（${weekdays[d.getDay()]}）`;
}

/* =========================================
   タブ切り替え
   ========================================= */
function initTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(s => s.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
      if (btn.dataset.tab === 'history') renderHistory();
    });
  });
}

/* =========================================
   カメラ
   ========================================= */
function initCamera() {
  const video       = document.getElementById('camera-video');
  const canvas      = document.getElementById('camera-canvas');
  const preview     = document.getElementById('photo-preview');
  const placeholder = document.getElementById('camera-placeholder');
  const btnStart    = document.getElementById('btn-start-camera');
  const btnCap      = document.getElementById('btn-capture');
  const btnRetake   = document.getElementById('btn-retake');

  btnStart.addEventListener('click', startCamera);
  btnCap.addEventListener('click', capturePhoto);
  btnRetake.addEventListener('click', retake);

  async function startCamera() {
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 720 }, height: { ideal: 960 } },
        audio: false,
      });
      video.srcObject = stream;
      placeholder.hidden = true;
      video.hidden = false;
      btnStart.hidden = true;
      btnCap.hidden = false;
      capturedDataUrl = null;
    } catch (err) {
      alert('カメラを起動できませんでした。\nブラウザの設定でカメラの許可をしてください。');
      console.error(err);
    }
  }

  function capturePhoto() {
    canvas.width  = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    // 前面カメラの映像は左右反転して描画（自然な見た目に）
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0);
    capturedDataUrl = canvas.toDataURL('image/jpeg', 0.75);

    // カメラを止めてプレビュー表示
    stopStream();
    video.hidden = true;
    preview.src = capturedDataUrl;
    preview.hidden = false;
    btnCap.hidden = true;
    btnRetake.hidden = false;
  }

  function retake() {
    capturedDataUrl = null;
    preview.hidden = true;
    preview.src = '';
    btnRetake.hidden = true;
    placeholder.hidden = true;
    startCamera();
  }
}

function stopStream() {
  if (stream) {
    stream.getTracks().forEach(t => t.stop());
    stream = null;
  }
}

/* =========================================
   体重 ＋/− ボタン
   ========================================= */
function initWeightControls() {
  document.querySelectorAll('.weight-adj').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = document.getElementById('weight-input');
      const delta = parseFloat(btn.dataset.delta);
      const current = parseFloat(input.value) || 0;
      const next = Math.max(0, Math.round((current + delta) * 10) / 10);
      input.value = next.toFixed(1);
    });
  });
}

/* =========================================
   保存
   ========================================= */
function initSave() {
  document.getElementById('btn-save').addEventListener('click', () => {
    const weight = parseFloat(document.getElementById('weight-input').value);
    const memo   = document.getElementById('memo-input').value.trim();

    if (!capturedDataUrl && !confirm('写真が撮影されていません。体重だけで保存しますか？')) return;
    if (isNaN(weight) && !confirm('体重が入力されていません。このまま保存しますか？')) return;

    const entries = loadEntries();
    const key = todayKey();
    const existingIndex = entries.findIndex(e => e.date === key);

    const entry = {
      date:   key,
      ts:     new Date().toISOString(),
      weight: isNaN(weight) ? null : weight,
      memo:   memo,
      photo:  capturedDataUrl || null,
    };

    if (existingIndex !== -1) {
      if (!confirm('今日の記録がすでにあります。上書きしますか？')) return;
      entries[existingIndex] = entry;
    } else {
      entries.unshift(entry);
    }

    saveEntries(entries);
    showToast('保存しました！');

    // フォームリセット
    document.getElementById('weight-input').value = '';
    document.getElementById('memo-input').value = '';
  });
}

/* =========================================
   履歴レンダリング
   ========================================= */
function renderHistory() {
  const entries = loadEntries();
  const list  = document.getElementById('history-list');
  const empty = document.getElementById('history-empty');
  list.innerHTML = '';

  if (entries.length === 0) {
    empty.hidden = false;
    list.hidden  = true;
    return;
  }

  empty.hidden = true;
  list.hidden  = false;

  entries.forEach(entry => {
    const li = document.createElement('li');
    li.className = 'history-item';
    li.innerHTML = `
      ${entry.photo
        ? `<img class="history-thumb" src="${entry.photo}" alt="写真" />`
        : `<div class="history-thumb-placeholder">🙂</div>`}
      <div class="history-info">
        <div class="history-date">${formatDate(entry.date + 'T00:00:00')}</div>
        <div class="history-weight">${entry.weight != null ? entry.weight.toFixed(1) + ' kg' : '—'}</div>
        ${entry.memo ? `<div class="history-memo">${escapeHtml(entry.memo)}</div>` : ''}
      </div>
    `;
    li.addEventListener('click', () => openDetail(entry));
    list.appendChild(li);
  });
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* =========================================
   詳細モーダル
   ========================================= */
function initModal() {
  const modal   = document.getElementById('detail-modal');
  const backdrop = modal.querySelector('.modal-backdrop');
  const closeBtn = modal.querySelector('.modal-close');
  const delBtn  = document.getElementById('modal-delete');

  function closeModal() { modal.hidden = true; }
  backdrop.addEventListener('click', closeModal);
  closeBtn.addEventListener('click', closeModal);

  delBtn.addEventListener('click', () => {
    const date = modal.dataset.entryDate;
    if (!confirm('この記録を削除しますか？')) return;
    const entries = loadEntries().filter(e => e.date !== date);
    saveEntries(entries);
    closeModal();
    renderHistory();
  });
}

function openDetail(entry) {
  const modal       = document.getElementById('detail-modal');
  const modalDate   = document.getElementById('modal-date');
  const modalPhoto  = document.getElementById('modal-photo');
  const modalWeight = document.getElementById('modal-weight');
  const modalMemo   = document.getElementById('modal-memo');

  modal.dataset.entryDate = entry.date;
  modalDate.textContent   = formatDate(entry.date + 'T00:00:00');

  if (entry.photo) {
    modalPhoto.src = entry.photo;
    modalPhoto.hidden = false;
  } else {
    modalPhoto.hidden = true;
    modalPhoto.src = '';
  }

  modalWeight.textContent = entry.weight != null ? `${entry.weight.toFixed(1)} kg` : '体重未記録';
  modalMemo.textContent   = entry.memo || '';

  modal.hidden = false;
}

/* =========================================
   初期化
   ========================================= */
document.addEventListener('DOMContentLoaded', () => {
  initHeader();
  initTabs();
  initCamera();
  initWeightControls();
  initSave();
  initModal();
});
