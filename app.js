'use strict';

const STORAGE_KEY = 'dailyjournal_entries';
let stream = null;
let capturedDataUrl = null;
let currentMonth = null;
let editingEntry = null;

/* ── ユーティリティ ── */
const WEEKDAYS = ['日','月','火','水','木','金','土'];

function formatDateFull(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return `${d.getFullYear()}年${d.getMonth()+1}月${d.getDate()}日（${WEEKDAYS[d.getDay()]}）`;
}

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function monthKey(dateStr) { return dateStr.slice(0, 7); }

function monthLabel(ym) {
  const [y, m] = ym.split('-');
  return `${y}年${parseInt(m)}月`;
}

function loadEntries() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; }
  catch { return []; }
}

function saveEntries(entries) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

function showToast(msg) {
  const t = document.getElementById('save-toast');
  t.textContent = msg;
  t.hidden = false;
  t.style.animation = 'none';
  void t.offsetWidth;
  t.style.animation = '';
  setTimeout(() => { t.hidden = true; }, 2100);
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

/* ── ヘッダー日付 ── */
function initHeader() {
  const d = new Date();
  document.getElementById('header-date').textContent =
    `${d.getFullYear()}年${d.getMonth()+1}月${d.getDate()}日（${WEEKDAYS[d.getDay()]}）`;
}

/* ── ナビゲーション ── */
function initNav() {
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.screen;
      document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
      document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
      document.getElementById('screen-' + target).classList.add('active');
      btn.classList.add('active');
      if (target === 'history') renderHistory();
      if (target === 'record' && editingEntry) {
        // 編集中にナビで記録画面に戻った場合はキャンセル
        editingEntry = null;
        resetForm();
      }
    });
  });
}

/* ── カメラ ── */
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
      alert('カメラを起動できませんでした。\nブラウザでカメラの使用を許可してください。');
      console.error(err);
    }
  }

  function capturePhoto() {
    canvas.width  = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0);
    capturedDataUrl = canvas.toDataURL('image/jpeg', 0.75);
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
    placeholder.hidden = false;
    btnStart.hidden = false;
  }
}

function stopStream() {
  if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
}

/* ── フォームリセット ── */
function resetForm() {
  stopStream();
  capturedDataUrl = null;

  document.getElementById('weight-input').value  = '';
  document.getElementById('morning-input').value = '';
  document.getElementById('evening-input').value = '';
  document.getElementById('wake-input').value    = '';
  document.getElementById('sleep-input').value   = '';

  const preview     = document.getElementById('photo-preview');
  const placeholder = document.getElementById('camera-placeholder');
  preview.hidden          = true;
  preview.src             = '';
  placeholder.hidden      = false;
  document.getElementById('btn-start-camera').hidden = false;
  document.getElementById('btn-capture').hidden      = true;
  document.getElementById('btn-retake').hidden       = true;
  document.getElementById('camera-video').hidden     = true;

  initHeader();
}

/* ── 体重 ＋/− ── */
function initWeightControls() {
  document.querySelectorAll('.weight-adj').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = document.getElementById('weight-input');
      const delta = parseFloat(btn.dataset.delta);
      const next = Math.max(0, Math.round(((parseFloat(input.value) || 0) + delta) * 10) / 10);
      input.value = next.toFixed(1);
    });
  });
}

/* ── 保存 ── */
function initSave() {
  document.getElementById('btn-save').addEventListener('click', () => {
    const weight    = parseFloat(document.getElementById('weight-input').value);
    const morning   = document.getElementById('morning-input').value.trim();
    const evening   = document.getElementById('evening-input').value.trim();
    const wakeTime  = document.getElementById('wake-input').value  || null;
    const sleepTime = document.getElementById('sleep-input').value || null;

    if (!capturedDataUrl && !confirm('写真が撮影されていません。このまま保存しますか？')) return;
    if (isNaN(weight) && !confirm('体重が入力されていません。このまま保存しますか？')) return;

    const entries = loadEntries();
    const key = editingEntry ? editingEntry.date : todayKey();
    const idx = entries.findIndex(e => e.date === key);

    const entry = {
      date:      key,
      ts:        new Date().toISOString(),
      weight:    isNaN(weight) ? null : weight,
      morning,
      evening,
      photo:     capturedDataUrl || null,
      wakeTime,
      sleepTime,
    };

    if (idx !== -1) {
      // 編集中は確認なしで上書き、新規で既存あり場合は確認
      if (!editingEntry && !confirm('今日の記録がすでにあります。上書きしますか？')) return;
      entries[idx] = entry;
    } else {
      entries.unshift(entry);
    }

    saveEntries(entries);
    showToast(editingEntry ? '更新しました！' : '保存しました！');
    editingEntry = null;
    resetForm();
  });
}

/* ── 編集開始 ── */
function startEdit(entry) {
  editingEntry = entry;

  // 記録画面に切り替え
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
  document.getElementById('screen-record').classList.add('active');
  document.querySelector('.nav-item[data-screen="record"]').classList.add('active');

  // フォームに値をセット
  document.getElementById('weight-input').value  = entry.weight != null ? entry.weight.toFixed(1) : '';
  document.getElementById('morning-input').value = entry.morning   || '';
  document.getElementById('evening-input').value = entry.evening   || '';
  document.getElementById('wake-input').value    = entry.wakeTime  || '';
  document.getElementById('sleep-input').value   = entry.sleepTime || '';

  // 写真プレビュー
  stopStream();
  capturedDataUrl = entry.photo || null;
  const preview     = document.getElementById('photo-preview');
  const placeholder = document.getElementById('camera-placeholder');
  if (entry.photo) {
    preview.src = entry.photo;
    preview.hidden      = false;
    placeholder.hidden  = true;
    document.getElementById('btn-start-camera').hidden = true;
    document.getElementById('btn-capture').hidden      = true;
    document.getElementById('btn-retake').hidden       = false;
  } else {
    preview.hidden      = true;
    preview.src         = '';
    placeholder.hidden  = false;
    document.getElementById('btn-start-camera').hidden = false;
    document.getElementById('btn-capture').hidden      = true;
    document.getElementById('btn-retake').hidden       = true;
  }

  // ヘッダーに編集中の日付を表示
  document.getElementById('header-date').textContent =
    formatDateFull(entry.date) + '（編集中）';
}

/* ── 履歴レンダリング ── */
function renderHistory() {
  const entries = loadEntries();
  const list   = document.getElementById('history-list');
  const empty  = document.getElementById('history-empty');
  const filter = document.getElementById('month-filter');

  list.innerHTML   = '';
  filter.innerHTML = '';

  if (entries.length === 0) {
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  const months = [...new Set(entries.map(e => monthKey(e.date)))];
  if (!currentMonth || !months.includes(currentMonth)) {
    currentMonth = months[0];
  }

  months.forEach(ym => {
    const btn = document.createElement('button');
    btn.className = 'month-chip' + (ym === currentMonth ? ' active' : '');
    btn.textContent = monthLabel(ym);
    btn.addEventListener('click', () => { currentMonth = ym; renderHistory(); });
    filter.appendChild(btn);
  });

  const filtered = entries.filter(e => monthKey(e.date) === currentMonth);

  filtered.forEach((entry, i) => {
    const d = new Date(entry.date + 'T00:00:00');
    const li = document.createElement('li');
    li.className = 'history-item';
    const isLast = i === filtered.length - 1;

    const thumbHtml = entry.photo
      ? `<img class="timeline-thumb" src="${entry.photo}" alt="写真" />`
      : `<div class="timeline-thumb-placeholder">🙂</div>`;

    const commentText = entry.morning || entry.evening || '';
    const commentHtml = commentText
      ? `<div class="timeline-comment">${escapeHtml(commentText)}</div>`
      : '';

    const weightHtml = entry.weight != null
      ? `<div class="timeline-weight">${entry.weight.toFixed(1)} kg</div>`
      : `<div class="timeline-weight-empty">体重未記録</div>`;

    li.innerHTML = `
      <div class="timeline-date">
        <div class="timeline-day">${d.getDate()}</div>
        <div class="timeline-weekday">${WEEKDAYS[d.getDay()]}</div>
        ${!isLast ? '<div class="timeline-line"></div>' : ''}
      </div>
      <div class="swipe-container">
        <div class="swipe-bg swipe-bg-right">✏️ 編集</div>
        <div class="swipe-bg swipe-bg-left">🗑 削除</div>
        <div class="timeline-card">
          ${thumbHtml}
          <div class="timeline-info">
            ${weightHtml}
            ${commentHtml}
          </div>
          <div class="timeline-arrow">›</div>
        </div>
      </div>`;

    // ── スワイプ処理 ──
    const card = li.querySelector('.timeline-card');
    let txStart = 0;
    let tyStart = 0;
    let horizontal = null; // null=未決, true=横, false=縦
    let dragged = false;

    li.addEventListener('touchstart', e => {
      txStart = e.touches[0].clientX;
      tyStart = e.touches[0].clientY;
      horizontal = null;
      dragged = false;
      card.style.transition = 'none';
    }, { passive: true });

    li.addEventListener('touchmove', e => {
      if (horizontal === false) return;
      const dx = e.touches[0].clientX - txStart;
      const dy = e.touches[0].clientY - tyStart;
      if (horizontal === null) {
        if (Math.abs(dx) > 6 || Math.abs(dy) > 6) {
          horizontal = Math.abs(dx) >= Math.abs(dy);
        }
        return;
      }
      dragged = true;
      e.preventDefault();
      card.style.transform = `translateX(${dx}px)`;
    }, { passive: false });

    li.addEventListener('touchend', e => {
      card.style.transition = 'transform 0.25s ease';
      card.style.transform = '';
      if (!dragged) return;
      const dx = e.changedTouches[0].clientX - txStart;
      if (dx > 80) {
        // 右スワイプ → 編集
        startEdit(entry);
      } else if (dx < -80) {
        // 左スワイプ → 削除
        if (confirm('この記録を削除しますか？')) {
          saveEntries(loadEntries().filter(e => e.date !== entry.date));
          renderHistory();
        }
      }
    });

    li.addEventListener('click', () => { if (!dragged) openDetail(entry); });
    list.appendChild(li);
  });
}

/* ── モーダル ── */
function initModal() {
  const modal = document.getElementById('detail-modal');
  const close = () => { modal.hidden = true; };
  modal.querySelector('.modal-backdrop').addEventListener('click', close);
  modal.querySelector('.modal-close').addEventListener('click', close);

  document.getElementById('modal-edit').addEventListener('click', () => {
    const entry = loadEntries().find(e => e.date === modal.dataset.entryDate);
    if (!entry) return;
    close();
    startEdit(entry);
  });

  document.getElementById('modal-delete').addEventListener('click', () => {
    if (!confirm('この記録を削除しますか？')) return;
    saveEntries(loadEntries().filter(e => e.date !== modal.dataset.entryDate));
    close();
    renderHistory();
  });
}

function openDetail(entry) {
  const modal = document.getElementById('detail-modal');
  modal.dataset.entryDate = entry.date;
  document.getElementById('modal-date').textContent = formatDateFull(entry.date);

  const photo   = document.getElementById('modal-photo');
  const noPhoto = document.getElementById('modal-no-photo');
  if (entry.photo) {
    photo.src = entry.photo;
    photo.hidden = false;
    noPhoto.hidden = true;
  } else {
    photo.hidden = true;
    photo.src = '';
    noPhoto.hidden = false;
  }

  document.getElementById('modal-weight').textContent =
    entry.weight != null ? `${entry.weight.toFixed(1)} kg` : '体重未記録';

  const wakeEl  = document.getElementById('modal-wake');
  const sleepEl = document.getElementById('modal-sleep');
  if (entry.wakeTime) {
    document.getElementById('modal-wake-text').textContent = `起床 ${entry.wakeTime}`;
    wakeEl.hidden = false;
  } else {
    wakeEl.hidden = true;
  }
  if (entry.sleepTime) {
    document.getElementById('modal-sleep-text').textContent = `就寝 ${entry.sleepTime}`;
    sleepEl.hidden = false;
  } else {
    sleepEl.hidden = true;
  }

  const morningEl = document.getElementById('modal-morning');
  const eveningEl = document.getElementById('modal-evening');
  if (entry.morning) {
    document.getElementById('modal-morning-text').textContent = entry.morning;
    morningEl.hidden = false;
  } else {
    morningEl.hidden = true;
  }
  if (entry.evening) {
    document.getElementById('modal-evening-text').textContent = entry.evening;
    eveningEl.hidden = false;
  } else {
    eveningEl.hidden = true;
  }

  modal.hidden = false;
}

/* ── 初期化 ── */
document.addEventListener('DOMContentLoaded', () => {
  initHeader();
  initNav();
  initCamera();
  initWeightControls();
  initSave();
  initModal();
});
