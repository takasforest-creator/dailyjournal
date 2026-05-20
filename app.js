'use strict';

const STORAGE_KEY = 'dailyjournal_entries';
let stream = null;
let capturedDataUrl = null;
let currentMonth = null;
let editingEntry = null;
let viewMode = 'list';       // 'list' | 'grid'
let detailEntries = [];
let detailIndex   = 0;
let currentUserId = null;

/* ── Supabase ── */
const SUPABASE_URL = 'https://nraanwywbbmdwpcxwgop.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5yYWFud3l3YmJtZHdwY3h3Z29wIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg0OTU1MTksImV4cCI6MjA5NDA3MTUxOX0.Yl4i4rZk55ypEkxZLfIJa3KtNWwnqMVkzsTbgFunmh8';
let sbClient = null;
let sbPhotoCache = new Map(); // date -> base64（localStorage には保存しない）

function getPhoto(entry) {
  return sbPhotoCache.get(entry.date) || entry.photo || null;
}

function initSupabase() {
  if (window.supabase) {
    sbClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  }
}

function showLoginScreen() {
  document.getElementById('screen-login').classList.add('active');
  document.getElementById('screen-record').classList.remove('active');
  document.getElementById('screen-history').classList.remove('active');
  document.querySelector('.bottom-nav').hidden = true;
}

function showApp() {
  document.getElementById('screen-login').classList.remove('active');
  document.getElementById('screen-record').classList.add('active');
  document.querySelector('.nav-item[data-screen="record"]').classList.add('active');
  document.querySelector('.bottom-nav').hidden = false;
}

async function migrateUserIds() {
  if (!sbClient || !currentUserId) return;
  try {
    await sbClient.from('entries')
      .update({ user_id: currentUserId })
      .is('user_id', null);
  } catch (err) {
    console.error('migrateUserIds error:', err);
  }
}

async function onLoggedIn(session) {
  currentUserId = session.user.id;
  showApp();
  await migrateUserIds();
  sbSync();
}

async function checkAuth() {
  if (!sbClient) return;
  const { data: { session } } = await sbClient.auth.getSession();
  if (session) {
    await onLoggedIn(session);
    return;
  }
  showLoginScreen();
  sbClient.auth.onAuthStateChange(async (event, session) => {
    if (session && !currentUserId) await onLoggedIn(session);
  });
}

function initAuth() {
  let pendingEmail = '', pendingPassword = '';

  function getCredentials() {
    return {
      email:    document.getElementById('login-email').value.trim(),
      password: document.getElementById('login-password').value,
    };
  }

  function showSignupStep() {
    document.getElementById('login-form-wrap').hidden = true;
    document.getElementById('login-signup-wrap').hidden = false;
  }

  function showLoginStep() {
    document.getElementById('login-signup-wrap').hidden = true;
    document.getElementById('login-form-wrap').hidden = false;
  }

  document.getElementById('btn-login').addEventListener('click', async () => {
    const { email, password } = getCredentials();
    if (!email || !password) { alert('メールアドレスとパスワードを入力してください'); return; }
    pendingEmail = email;
    pendingPassword = password;
    const btn = document.getElementById('btn-login');
    btn.disabled = true;
    const { data, error } = await sbClient.auth.signInWithPassword({ email, password });
    btn.disabled = false;
    if (!error && data?.session) {
      await onLoggedIn(data.session);
    } else if (error && (error.message.includes('Invalid login credentials') || error.message.includes('invalid_credentials'))) {
      showSignupStep();
    } else if (error) {
      alert('ログイン失敗: ' + error.message);
    }
  });

  document.getElementById('btn-signup').addEventListener('click', async () => {
    const btn = document.getElementById('btn-signup');
    btn.disabled = true;
    const { data, error } = await sbClient.auth.signUp({ email: pendingEmail, password: pendingPassword });
    btn.disabled = false;
    if (!error && data?.session) {
      await onLoggedIn(data.session);
    } else if (!error && data?.user) {
      // メール確認が必要な場合（Supabase設定による）
      alert('確認メールを送信しました。メールのリンクをクリックしてから再度ログインしてください。');
      showLoginStep();
    } else if (error) {
      alert('登録失敗: ' + error.message);
    }
  });

  document.getElementById('btn-back-login').addEventListener('click', showLoginStep);

  document.getElementById('login-password').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('btn-login').click();
  });
}

function entryToRow(e) {
  return {
    date:       e.date,
    ts:         e.ts ? new Date(e.ts).getTime() : null,
    weight:     e.weight ?? null,
    morning:    e.morning  || null,
    evening:    e.evening  || null,
    photo:      e.photo || null,
    wake_time:  e.wakeTime  || null,
    sleep_time: e.sleepTime || null,
    updated_at: new Date().toISOString(),
    user_id:    currentUserId,
  };
}

function rowToEntry(row) {
  return {
    date:      row.date,
    ts:        row.ts ? new Date(row.ts).toISOString() : null,
    weight:    row.weight,
    morning:   row.morning,
    evening:   row.evening,
    photo:     null, // localStorageには保存しない（sbPhotoCacheを使う）
    wakeTime:  row.wake_time,
    sleepTime: row.sleep_time,
  };
}

async function sbPush(entry) {
  if (!sbClient) return;
  try {
    const { error } = await sbClient.from('entries')
      .upsert(entryToRow(entry), { onConflict: 'date' });
    if (error) { alert('DB保存エラー:\n' + error.message); throw error; }
  } catch (err) {
    console.error('sbPush error:', err);
  }
}

async function sbDelete(date) {
  if (!sbClient) return;
  sbPhotoCache.delete(date);
  try {
    await sbClient.from('entries').delete().eq('date', date);
  } catch (err) {
    console.error('sbDelete error:', err);
  }
}

async function sbSync() {
  if (!sbClient) return;
  try {
    const { data, error } = await sbClient.from('entries')
      .select('*').order('date', { ascending: false });
    if (error) throw error;

    const local   = loadEntries();
    const sbDates = new Set((data || []).map(r => r.date));

    // ローカルにあって Supabase にないエントリを同期
    for (const entry of local) {
      if (!sbDates.has(entry.date)) {
        const photo = sbPhotoCache.get(entry.date) || entry.photo || null;
        await sbPush({ ...entry, photo });
      }
    }

    // Supabase のデータをキャッシュに反映
    (data || []).forEach(row => {
      if (row.photo) sbPhotoCache.set(row.date, row.photo);
    });

    // localStorage にはメタデータのみ保存（写真なし）
    const merged = new Map(local.map(e => [e.date, e]));
    (data || []).forEach(row => merged.set(row.date, rowToEntry(row)));
    const sorted = [...merged.values()].sort((a, b) => b.date.localeCompare(a.date));
    saveEntries(sorted);

    if (document.getElementById('screen-history').classList.contains('active')) {
      renderHistory();
    }
  } catch (err) {
    console.error('sbSync error:', err);
  }
}

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
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch (e) {
    if (e.name === 'QuotaExceededError' || e.code === 22) {
      alert('保存容量が不足しています。\n古い記録の写真をいくつか削除するか、バックアップ後に古い記録を整理してください。');
    } else {
      throw e;
    }
  }
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
    const MAX = 480;
    const ow = video.videoWidth, oh = video.videoHeight;
    const scale = Math.min(1, MAX / Math.max(ow, oh));
    canvas.width  = Math.round(ow * scale);
    canvas.height = Math.round(oh * scale);
    const ctx = canvas.getContext('2d');
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    capturedDataUrl = canvas.toDataURL('image/jpeg', 0.65);
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

    const photoBase64 = capturedDataUrl || null;
    const isNewCapture  = photoBase64 && photoBase64.startsWith('data:');
    const isExistingUrl = photoBase64 && !photoBase64.startsWith('data:');
    // localStorage には URL のみ保存（base64 は保存しない）
    const localPhoto = isExistingUrl ? photoBase64 : (idx !== -1 && !isNewCapture ? (entries[idx].photo || null) : null);

    const entry = {
      date:      key,
      ts:        new Date().toISOString(),
      weight:    isNaN(weight) ? null : weight,
      morning,
      evening,
      photo:     localPhoto,
      wakeTime,
      sleepTime,
    };

    if (idx !== -1) {
      if (!editingEntry && !confirm('今日の記録がすでにあります。上書きしますか？')) return;
      entries[idx] = entry;
    } else {
      entries.unshift(entry);
    }

    saveEntries(entries);
    showToast(editingEntry ? '更新しました！' : '保存しました！');
    editingEntry = null;
    resetForm();

    // 写真をキャッシュに保存して Supabase に同期
    (async () => {
      const finalPhoto = isNewCapture ? photoBase64 : localPhoto;
      if (finalPhoto) sbPhotoCache.set(entry.date, finalPhoto);
      if (isNewCapture && document.getElementById('screen-history').classList.contains('active')) {
        renderHistory();
      }
      await sbPush({ ...entry, photo: finalPhoto });
    })();
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
  capturedDataUrl = getPhoto(entry) || null;
  const preview     = document.getElementById('photo-preview');
  const placeholder = document.getElementById('camera-placeholder');
  if (capturedDataUrl) {
    preview.src = capturedDataUrl;
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
  const list    = document.getElementById('history-list');
  const grid    = document.getElementById('photo-grid');
  const empty   = document.getElementById('history-empty');
  const filter  = document.getElementById('month-filter');

  list.innerHTML = grid.innerHTML = filter.innerHTML = '';

  if (entries.length === 0) { empty.hidden = false; return; }
  empty.hidden = true;

  const months = [...new Set(entries.map(e => monthKey(e.date)))];
  if (!currentMonth || !months.includes(currentMonth)) currentMonth = months[0];

  months.forEach(ym => {
    const btn = document.createElement('button');
    btn.className = 'month-chip' + (ym === currentMonth ? ' active' : '');
    btn.textContent = monthLabel(ym);
    btn.addEventListener('click', () => { currentMonth = ym; renderHistory(); });
    filter.appendChild(btn);
  });

  const filtered = entries.filter(e => monthKey(e.date) === currentMonth);

  if (viewMode === 'grid') {
    list.hidden = true;
    grid.hidden = false;
    renderPhotoGrid(filtered, entries);
  } else {
    grid.hidden = true;
    list.hidden = false;
    renderTimeline(filtered, entries);
  }
}

function renderTimeline(filtered, entries) {
  const list = document.getElementById('history-list');

  filtered.forEach((entry, i) => {
    const d = new Date(entry.date + 'T00:00:00');
    const li = document.createElement('li');
    li.className = 'history-item';
    const isLast = i === filtered.length - 1;

    const photo = getPhoto(entry);
    const thumbInner = photo
      ? `<img class="timeline-thumb" src="${photo}" alt="写真" />`
      : `<div class="timeline-thumb-placeholder">🙂</div>`;
    const weightLabel = entry.weight != null ? `${entry.weight.toFixed(1)} kg` : '';
    const thumbHtml = `<div class="timeline-photo-col">${thumbInner}${weightLabel ? `<div class="timeline-thumb-weight">${weightLabel}</div>` : ''}</div>`;

    const wakeHtml  = entry.wakeTime  ? `<span class="tl-time">⏰ ${entry.wakeTime}</span>`  : '';
    const sleepHtml = entry.sleepTime ? `<span class="tl-time">🛏 ${entry.sleepTime}</span>` : '';
    const timesHtml = (wakeHtml || sleepHtml)
      ? `<div class="timeline-times">${wakeHtml}${sleepHtml}</div>` : '';
    const morningHtml = entry.morning
      ? `<div class="timeline-comment">🌅 ${escapeHtml(entry.morning)}</div>` : '';
    const eveningHtml = entry.evening
      ? `<div class="timeline-comment">🌙 ${escapeHtml(entry.evening)}</div>` : '';

    li.innerHTML = `
      <div class="timeline-date">
        <div class="timeline-day">${d.getDate()}</div>
        <div class="timeline-weekday">${WEEKDAYS[d.getDay()]}</div>
        ${!isLast ? '<div class="timeline-line"></div>' : ''}
      </div>
      <div class="swipe-container">
        <div class="swipe-bg swipe-bg-right">🗑 削除</div>
        <div class="swipe-bg swipe-bg-left">✏️ 編集</div>
        <div class="timeline-card">
          ${thumbHtml}
          <div class="timeline-info">
            ${timesHtml}
            ${morningHtml}
            ${eveningHtml}
          </div>
          <div class="timeline-arrow">›</div>
        </div>
      </div>`;

    const card = li.querySelector('.timeline-card');
    let txStart = 0, tyStart = 0, horizontal = null, dragged = false;

    li.addEventListener('touchstart', e => {
      txStart = e.touches[0].clientX;
      tyStart = e.touches[0].clientY;
      horizontal = null; dragged = false;
      card.style.transition = 'none';
    }, { passive: true });

    li.addEventListener('touchmove', e => {
      if (horizontal === false) return;
      const dx = e.touches[0].clientX - txStart;
      const dy = e.touches[0].clientY - tyStart;
      if (horizontal === null) {
        if (Math.abs(dx) > 6 || Math.abs(dy) > 6) horizontal = Math.abs(dx) >= Math.abs(dy);
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
        if (confirm('この記録を削除しますか？')) {
          saveEntries(loadEntries().filter(e => e.date !== entry.date));
          sbDelete(entry.date);
          renderHistory();
        }
      } else if (dx < -80) {
        startEdit(entry);
      }
    });

    li.addEventListener('click', () => { if (!dragged) openDetail(entry, entries); });
    list.appendChild(li);
  });
}

function renderPhotoGrid(filtered, entries) {
  const grid = document.getElementById('photo-grid');
  filtered.forEach(entry => {
    const d    = new Date(entry.date + 'T00:00:00');
    const tile = document.createElement('div');
    tile.className = 'photo-tile';
    const dateLabel = `${d.getMonth()+1}/${d.getDate()}`;
    const tilePhoto = getPhoto(entry);
    if (tilePhoto) {
      tile.innerHTML = `<img src="${tilePhoto}" alt="${entry.date}" /><div class="photo-tile-date">${dateLabel}</div>`;
    } else {
      tile.innerHTML = `<div class="photo-tile-placeholder">🙂</div><div class="photo-tile-date">${dateLabel}</div>`;
    }
    tile.addEventListener('click', () => openDetail(entry, entries));
    grid.appendChild(tile);
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
    const dateToDelete = modal.dataset.entryDate;
    saveEntries(loadEntries().filter(e => e.date !== dateToDelete));
    close();
    renderHistory();
    sbDelete(dateToDelete);
  });

  // モーダル内スワイプで前日/翌日ナビゲーション
  const card = modal.querySelector('.modal-card');
  let mTx = 0, mTy = 0, mIsH = null;

  card.addEventListener('touchstart', e => {
    mTx = e.touches[0].clientX;
    mTy = e.touches[0].clientY;
    mIsH = null;
  }, { passive: true });

  card.addEventListener('touchmove', e => {
    if (mIsH === false) return;
    const dx = e.touches[0].clientX - mTx;
    const dy = e.touches[0].clientY - mTy;
    if (mIsH === null && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
      mIsH = Math.abs(dx) > Math.abs(dy);
    }
    if (mIsH) e.preventDefault();
  }, { passive: false });

  card.addEventListener('touchend', e => {
    if (!mIsH) return;
    const dx = e.changedTouches[0].clientX - mTx;
    if (dx > 60 && detailIndex < detailEntries.length - 1) {
      openDetail(detailEntries[detailIndex + 1]); // 右スワイプ → 前日
    } else if (dx < -60 && detailIndex > 0) {
      openDetail(detailEntries[detailIndex - 1]); // 左スワイプ → 翌日
    }
  });
}

function openDetail(entry, entries) {
  if (entries) detailEntries = entries;
  detailIndex = detailEntries.findIndex(e => e.date === entry.date);
  const modal = document.getElementById('detail-modal');
  modal.dataset.entryDate = entry.date;
  document.getElementById('modal-date').textContent = formatDateFull(entry.date);

  const photo    = document.getElementById('modal-photo');
  const noPhoto  = document.getElementById('modal-no-photo');
  const photoSrc = getPhoto(entry);
  if (photoSrc) {
    photo.src = photoSrc;
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

/* ── エクスポート ── */
function exportData() {
  const entries = loadEntries();
  if (entries.length === 0) { showToast('記録がありません'); return; }
  const blob = new Blob([JSON.stringify(entries, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `dailyjournal_${todayKey()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast(`${entries.length}件をエクスポートしました`);
}

/* ── インポート ── */
function importData(file) {
  const reader = new FileReader();
  reader.onload = e => {
    let imported;
    try { imported = JSON.parse(e.target.result); }
    catch { alert('ファイルの読み込みに失敗しました'); return; }
    if (!Array.isArray(imported) || !imported.every(x => x.date)) {
      alert('正しいバックアップファイルではありません'); return;
    }
    if (!confirm(`${imported.length}件の記録が見つかりました。\n現在のデータに追加しますか？\n（同じ日の記録は読み込んだ方で上書きされます）`)) return;
    const map = new Map(loadEntries().map(e => [e.date, e]));
    imported.forEach(e => map.set(e.date, e));
    const merged = [...map.values()].sort((a, b) => b.date.localeCompare(a.date));
    // localStorage には写真なしで保存
    saveEntries(merged.map(e => ({ ...e, photo: null })));
    showToast(`${imported.length}件をインポートしました`);
    renderHistory();
    // 写真をキャッシュに入れて Supabase に同期
    (async () => {
      for (const entry of imported) {
        if (entry.photo) sbPhotoCache.set(entry.date, entry.photo);
        await sbPush(entry);
      }
      renderHistory();
    })();
  };
  reader.readAsText(file);
}

/* ── バックアップバー初期化 ── */
function initBackup() {
  document.getElementById('btn-export').addEventListener('click', exportData);
  const fileInput = document.getElementById('import-file');
  document.getElementById('btn-import').addEventListener('click', () => {
    fileInput.value = '';
    fileInput.click();
  });
  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) importData(fileInput.files[0]);
  });
}

/* ── 表示切替 ── */
function initViewToggle() {
  const btn = document.getElementById('btn-view-toggle');
  btn.addEventListener('click', () => {
    viewMode = viewMode === 'list' ? 'grid' : 'list';
    btn.textContent = viewMode === 'grid' ? '☰' : '⊞';
    renderHistory();
  });
}

/* ── 初期化 ── */
document.addEventListener('DOMContentLoaded', () => {
  initHeader();
  initNav();
  initCamera();
  initWeightControls();
  initSave();
  initModal();
  initBackup();
  initViewToggle();
  initSupabase();
  initAuth();
  checkAuth();
});
