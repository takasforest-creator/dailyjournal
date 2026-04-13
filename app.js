'use strict';

const STORAGE_KEY = 'dailyjournal_entries';
let stream = null;
let capturedDataUrl = null;
let currentMonth = null;

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
    const weight  = parseFloat(document.getElementById('weight-input').value);
    const morning = document.getElementById('morning-input').value.trim();
    const evening = document.getElementById('evening-input').value.trim();

    if (!capturedDataUrl && !confirm('写真が撮影されていません。このまま保存しますか？')) return;
    if (isNaN(weight) && !confirm('体重が入力されていません。このまま保存しますか？')) return;

    const entries = loadEntries();
    const key = todayKey();
    const idx = entries.findIndex(e => e.date === key);

    const entry = {
      date:    key,
      ts:      new Date().toISOString(),
      weight:  isNaN(weight) ? null : weight,
      morning: morning,
      evening: evening,
      photo:   capturedDataUrl || null,
    };

    if (idx !== -1) {
      if (!confirm('今日の記録がすでにあります。上書きしますか？')) return;
      entries[idx] = entry;
    } else {
      entries.unshift(entry);
    }

    saveEntries(entries);
    showToast('保存しました！');

    document.getElementById('weight-input').value = '';
    document.getElementById('morning-input').value = '';
    document.getElementById('evening-input').value = '';
  });
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
      <div class="timeline-card">
        ${thumbHtml}
        <div class="timeline-info">
          ${weightHtml}
          ${commentHtml}
        </div>
        <div class="timeline-arrow">›</div>
      </div>`;

    li.addEventListener('click', () => openDetail(entry));
    list.appendChild(li);
  });
}

/* ── モーダル ── */
function initModal() {
  const modal = document.getElementById('detail-modal');
  const close = () => { modal.hidden = true; };
  modal.querySelector('.modal-backdrop').addEventListener('click', close);
  modal.querySelector('.modal-close').addEventListener('click', close);

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
