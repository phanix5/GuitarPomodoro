(function() {
  'use strict';

  // ---------- Constants ----------
  const STORAGE_KEY = 'gp:data:v1';
  const SETTINGS_KEY = 'gp:settings:v1';
  const AUTO_BACKUP_KEY = 'gp:autoBackup:lastTs';
  const COMPLETION_THRESHOLD_MS = 25 * 60 * 1000; // 25 mins
  const TARGET_MS = 30 * 60 * 1000; // 30 mins
  const AUTO_BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // once per day

  // ---------- DOM ----------
  const monthLabel = document.getElementById('monthLabel');
  const prevMonthBtn = document.getElementById('prevMonth');
  const nextMonthBtn = document.getElementById('nextMonth');
  const jumpTodayBtn = document.getElementById('jumpToday');
  const calendarGrid = document.getElementById('calendarGrid');
  const weekdayRow = document.getElementById('weekdayRow');
  const selectedDateLabel = document.getElementById('selectedDateLabel');

  const startBtn = document.getElementById('startBtn');
  const pauseBtn = document.getElementById('pauseBtn');
  const resumeBtn = document.getElementById('resumeBtn');
  const finishBtn = document.getElementById('finishBtn');
  const quickCompleteBtn = document.getElementById('quickCompleteBtn');
  const manualMinutes = document.getElementById('manualMinutes');
  const applyMinutesBtn = document.getElementById('applyMinutesBtn');
  const timerDisplay = document.getElementById('timerDisplay');
  const dayStatusRow = document.getElementById('dayStatusRow');

  const addNoteBtn = document.getElementById('addNoteBtn');
  const noteForm = document.getElementById('noteForm');
  const noteTextarea = document.getElementById('noteTextarea');
  const cancelNoteBtn = document.getElementById('cancelNoteBtn');
  const notesList = document.getElementById('notesList');

  const currentStreakEl = document.getElementById('currentStreak');
  const longestStreakEl = document.getElementById('longestStreak');
  const daysCompletedMonthEl = document.getElementById('daysCompletedMonth');
  const minutesMonthEl = document.getElementById('minutesMonth');
  const completionRateEl = document.getElementById('completionRate');

  const themeToggle = document.getElementById('themeToggle');
  const exportBtn = document.getElementById('exportBtn');
  const importInput = document.getElementById('importInput');
  const saveStatus = document.getElementById('saveStatus');
  const linkBackupBtn = document.getElementById('linkBackupBtn');
  const backupStatus = document.getElementById('backupStatus');

  const chartWeekly = document.getElementById('chartWeekly');
  const chartMonthly = document.getElementById('chartMonthly');
  const chartYearly = document.getElementById('chartYearly');
  const chartTabButtons = Array.from(document.querySelectorAll('.tab-btn'));

  // ---------- State ----------
  let data = loadData(); // { days: { 'YYYY-MM-DD': { durationMs, completed, notes: [], session?: {status, startTs, accumulatedMs} } } }
  let settings = loadSettings(); // { theme, weekStartsOn:1, oneRestDay:true }
  let selectedYearMonth = getYearMonth(new Date());
  let selectedDateKey = dateKey(new Date());
  let timerInterval = null;

  // ---------- Init ----------
  initTheme();
  initWeekdays();
  attachEvents();
  renderAll();
  maybeResumeOngoingSession();
  requestNotificationPermission();
  initPersistentStorage();
  initFileSystemAccess();

  // ---------- Functions: Storage ----------
  function loadData() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { days: {} };
      const parsed = JSON.parse(raw);
      if (!parsed.days) parsed.days = {};
      return parsed;
    } catch (e) { return { days: {} }; }
  }
  function saveData() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    bumpSaveStatus();
    fsAutoBackup().catch(()=>{});
    scheduleAutoBackup();
  }
  function loadSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return { theme: prefersDark() ? 'dark' : 'light', weekStartsOn: 1, oneRestDay: true };
      const parsed = JSON.parse(raw);
      if (parsed.weekStartsOn !== 0 && parsed.weekStartsOn !== 1) parsed.weekStartsOn = 1;
      if (typeof parsed.oneRestDay !== 'boolean') parsed.oneRestDay = true;
      if (!parsed.theme) parsed.theme = prefersDark() ? 'dark' : 'light';
      return parsed;
    } catch (e) { return { theme: prefersDark() ? 'dark' : 'light', weekStartsOn: 1, oneRestDay: true }; }
  }
  function saveSettings() {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }
  function scheduleAutoBackup() {
    try {
      const last = parseInt(localStorage.getItem(AUTO_BACKUP_KEY) || '0', 10);
      const now = Date.now();
      if (!last || now - last > AUTO_BACKUP_INTERVAL_MS) {
        fsAutoBackup().finally(() => {
          localStorage.setItem(AUTO_BACKUP_KEY, String(now));
        });
      }
    } catch (e) { /* noop */ }
  }

  // ---------- Functions: Date helpers ----------
  function dateKey(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  function keyToDate(key) { return new Date(key + 'T00:00:00'); }
  function zeroTime(d) { const x = new Date(d); x.setHours(0,0,0,0); return x; }
  function getYearMonth(d) { return { year: d.getFullYear(), month: d.getMonth() }; }
  function formatMonthLabel(year, month) {
    const d = new Date(year, month, 1);
    return d.toLocaleString(undefined, { month: 'long', year: 'numeric' });
  }
  function clamp(val, min, max) { return Math.max(min, Math.min(max, val)); }

  // ---------- Theme ----------
  function prefersDark() { return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches; }
  function initTheme() {
    setTheme(settings.theme);
    themeToggle.addEventListener('click', () => {
      settings.theme = (settings.theme === 'dark') ? 'light' : 'dark';
      setTheme(settings.theme);
      saveSettings();
    });
  }
  function setTheme(theme) {
    if (theme === 'light') {
      document.documentElement.setAttribute('data-theme', 'light');
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
  }

  // ---------- Weekdays row ----------
  function initWeekdays() {
    const names = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
    const row = document.createDocumentFragment();
    for (let i = 0; i < 7; i++) {
      const div = document.createElement('div');
      div.textContent = names[i];
      row.appendChild(div);
    }
    weekdayRow.innerHTML = '';
    weekdayRow.appendChild(row);
  }

  // ---------- Event bindings ----------
  function attachEvents() {
    prevMonthBtn.addEventListener('click', () => { shiftMonth(-1); });
    nextMonthBtn.addEventListener('click', () => { shiftMonth(1); });
    jumpTodayBtn.addEventListener('click', () => { jumpToToday(); });

    startBtn.addEventListener('click', startTimer);
    pauseBtn.addEventListener('click', pauseTimer);
    resumeBtn.addEventListener('click', resumeTimer);
    finishBtn.addEventListener('click', finishTimer);
    quickCompleteBtn.addEventListener('click', markSelectedDayComplete);
    applyMinutesBtn.addEventListener('click', applyManualMinutes);

    addNoteBtn.addEventListener('click', () => { noteForm.hidden = false; noteTextarea.focus(); });
    cancelNoteBtn.addEventListener('click', () => { noteForm.hidden = true; noteTextarea.value=''; });
    noteForm.addEventListener('submit', (e) => { e.preventDefault(); addNote(); });

    exportBtn.addEventListener('click', () => exportData(false));
    importInput.addEventListener('change', importData);
    if (linkBackupBtn) linkBackupBtn.addEventListener('click', linkBackupFolder);

    chartTabButtons.forEach(btn => btn.addEventListener('click', onChartTabClick));

    document.addEventListener('keydown', (e) => {
      const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : '';
      if (tag === 'input' || tag === 'textarea') return; // don't hijack typing
      if (e.key === 's' || e.key === 'S') { e.preventDefault(); startTimer(); }
      if (e.key === ' ' ) { e.preventDefault(); togglePauseResume(); }
      if (e.key === 'f' || e.key === 'F') { e.preventDefault(); finishTimer(); }
      if (e.key === 't' || e.key === 'T') { e.preventDefault(); jumpToToday(); }
      if (e.key === 'n' || e.key === 'N') { e.preventDefault(); addNoteBtn.click(); }
    });
  }

  function onChartTabClick(e) {
    const tab = e.currentTarget.getAttribute('data-tab');
    chartTabButtons.forEach(b => b.classList.toggle('active', b === e.currentTarget));
    chartWeekly.hidden = tab !== 'weekly';
    chartMonthly.hidden = tab !== 'monthly';
    chartYearly.hidden = tab !== 'yearly';
    renderCharts();
  }

  // ---------- Rendering ----------
  function renderAll() {
    renderMonthLabel();
    renderCalendar();
    renderSidePanel();
    renderStats();
    renderCharts();
  }

  function renderMonthLabel() {
    monthLabel.textContent = formatMonthLabel(selectedYearMonth.year, selectedYearMonth.month);
  }

  function renderCalendar() {
    const { year, month } = selectedYearMonth;
    const first = new Date(year, month, 1);
    const last = new Date(year, month + 1, 0);
    const firstWeekday = (first.getDay() + 6) % 7; // Monday=0
    const leading = firstWeekday; // number of preceding blanks
    const total = leading + last.getDate();
    const rows = Math.ceil(total / 7);
    const cells = rows * 7;

    calendarGrid.innerHTML = '';

    for (let i=0; i<cells; i++) {
      const cell = document.createElement('div');
      cell.className = 'day-cell';
      const dayNum = i - leading + 1;
      let key = null;
      if (dayNum >= 1 && dayNum <= last.getDate()) {
        const d = new Date(year, month, dayNum);
        key = dateKey(d);
        const isToday = dateKey(new Date()) === key;
        if (isToday) cell.classList.add('today');
        if (key === selectedDateKey) cell.classList.add('selected');

        const info = data.days[key];
        const duration = info ? (info.durationMs || 0) : 0;
        const completed = info ? !!info.completed : false;

        const number = document.createElement('div');
        number.className = 'day-number';
        number.textContent = String(dayNum);

        const badges = document.createElement('div');
        badges.className = 'badges';
        const badge = document.createElement('div');
        if (completed) {
          badge.className = 'badge complete';
          badge.textContent = 'Done';
          cell.classList.add('completed');
        } else if (duration > 0) {
          badge.className = 'badge partial';
          badge.textContent = Math.round(duration/60000) + 'm';
        } else {
          badge.className = 'badge none';
          badge.textContent = '—';
        }
        badges.appendChild(badge);

        cell.appendChild(number);

        // Notes preview
        const notes = (info && Array.isArray(info.notes)) ? info.notes : [];
        if (notes.length) {
          const preview = document.createElement('div');
          preview.className = 'notes-preview';
          const maxLines = 2;
          for (let n=0; n<Math.min(maxLines, notes.length); n++) {
            const line = document.createElement('div');
            line.className = 'note-line';
            line.textContent = notes[notes.length - 1 - n].text; // show most recent first
            preview.appendChild(line);
          }
          if (notes.length > maxLines) {
            const more = document.createElement('div');
            more.className = 'note-line';
            more.textContent = `+${notes.length - maxLines} more…`;
            preview.appendChild(more);
          }
          cell.appendChild(preview);
        }

        cell.appendChild(badges);
        cell.addEventListener('click', () => { onSelectDate(key); });
      } else {
        cell.classList.add('empty');
      }

      calendarGrid.appendChild(cell);
    }
  }

  function onSelectDate(key) {
    selectedDateKey = key;
    selectedYearMonth = getYearMonth(keyToDate(key));
    renderAll();
  }

  function renderSidePanel() {
    const key = selectedDateKey;
    const d = keyToDate(key);
    const todayKey = dateKey(new Date());
    const info = data.days[key] || {};

    selectedDateLabel.textContent = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });

    // Timer state and buttons
    const session = info.session || null;
    const isToday = key === todayKey;

    if (!session) {
      setTimerDisplay(info.durationMs || 0);
      setTimerButtons({ start: isToday, pause: false, resume: false, finish: isToday && (info.durationMs || 0) > 0 });
    } else {
      const elapsed = computeElapsed(session);
      setTimerDisplay(elapsed);
      setTimerButtons({
        start: false,
        pause: session.status === 'running',
        resume: session.status === 'paused',
        finish: true,
      });
    }

    // Status row
    const isCompleted = !!info.completed;
    const durationMin = Math.round((info.durationMs || 0)/60000);
    dayStatusRow.textContent = isCompleted
      ? `Completed ✓ • ${durationMin} min`
      : (info.durationMs ? `Partial • ${durationMin} min` : 'Not started');

    // Notes
    renderNotesList(info.notes || []);

    // Manual minutes default
    manualMinutes.value = String(clamp(Math.round((info.durationMs || 30*60000)/60000), 0, 180));
  }

  function setTimerDisplay(ms) {
    const clamped = Math.max(0, Math.min(ms, TARGET_MS));
    const totalSec = Math.floor(clamped / 1000);
    const mm = Math.floor(totalSec / 60);
    const ss = totalSec % 60;
    timerDisplay.textContent = `${String(mm).padStart(2,'0')}:${String(ss).padStart(2,'0')}`;
  }
  function setTimerButtons({ start, pause, resume, finish }) {
    startBtn.disabled = !start;
    pauseBtn.disabled = !pause;
    resumeBtn.disabled = !resume;
    finishBtn.disabled = !finish;
  }

  // ---------- Timer logic ----------
  function ensureDay(key) { if (!data.days[key]) data.days[key] = { durationMs: 0, completed: false, notes: [] }; return data.days[key]; }
  function startTimer() {
    const key = selectedDateKey;
    const today = dateKey(new Date());
    if (key !== today) { alert('You can only start the timer for today. Use manual minutes or quick complete for other days.'); return; }
    const info = ensureDay(key);
    if (info.session) { alert('A session is already in progress today. Pause/Resume or Finish it.'); return; }
    info.session = { status: 'running', startTs: Date.now(), accumulatedMs: info.durationMs || 0 };
    saveData();
    beginTick();
    renderSidePanel();
  }
  function pauseTimer() {
    const info = data.days[selectedDateKey];
    if (!info || !info.session || info.session.status !== 'running') return;
    info.session.accumulatedMs = computeElapsed(info.session);
    info.session.status = 'paused';
    info.durationMs = info.session.accumulatedMs;
    saveData();
    clearTick();
    renderSidePanel();
  }
  function resumeTimer() {
    const info = data.days[selectedDateKey];
    if (!info || !info.session || info.session.status !== 'paused') return;
    info.session.status = 'running';
    info.session.startTs = Date.now() - info.session.accumulatedMs;
    saveData();
    beginTick();
    renderSidePanel();
  }
  function togglePauseResume() {
    const info = data.days[selectedDateKey];
    if (!info || !info.session) return;
    if (info.session.status === 'running') pauseTimer(); else resumeTimer();
  }
  function finishTimer() {
    const key = selectedDateKey;
    const info = data.days[key];
    if (!info) return;
    const elapsed = info.session ? computeElapsed(info.session) : (info.durationMs || 0);
    info.durationMs = Math.min(elapsed, TARGET_MS);
    info.completed = info.durationMs >= COMPLETION_THRESHOLD_MS;
    delete info.session;
    saveData();
    clearTick();
    if (info.completed) {
      chime();
      tryShowNotification('Guitar Pomodoro', 'Nice! Practice completed for today.');
    }
    renderAll();
  }
  function beginTick() {
    clearTick();
    timerInterval = setInterval(() => {
      const info = data.days[selectedDateKey];
      if (!info || !info.session) return clearTick();
      const elapsed = computeElapsed(info.session);
      setTimerDisplay(elapsed);
      // Auto-complete at target? keep running to 30:00 display but cap
      if (elapsed >= TARGET_MS) {
        finishTimer();
      }
    }, 250);
  }
  function clearTick() { if (timerInterval) { clearInterval(timerInterval); timerInterval = null; } }
  function computeElapsed(session) { return Math.min(TARGET_MS, Math.max(0, (session.status === 'running' ? Date.now() - session.startTs : session.accumulatedMs))); }
  function maybeResumeOngoingSession() {
    // On page load, if a session is running for today, resume ticking
    const today = dateKey(new Date());
    const info = data.days[today];
    if (info && info.session && info.session.status === 'running') beginTick();
    setTimerDisplay(info ? (info.session ? computeElapsed(info.session) : (info.durationMs||0)) : 0);
  }

  // ---------- Quick actions ----------
  function markSelectedDayComplete() {
    const info = ensureDay(selectedDateKey);
    info.durationMs = TARGET_MS; // treat as 30
    info.completed = true;
    delete info.session;
    saveData();
    renderAll();
  }
  function applyManualMinutes() {
    const minutes = clamp(parseInt(manualMinutes.value || '0', 10), 0, 180);
    const info = ensureDay(selectedDateKey);
    info.durationMs = minutes * 60000;
    info.completed = info.durationMs >= COMPLETION_THRESHOLD_MS;
    delete info.session;
    saveData();
    renderAll();
  }

  // ---------- Notes ----------
  function addNote() {
    const text = (noteTextarea.value || '').trim();
    if (!text) return;
    const info = ensureDay(selectedDateKey);
    if (!info.notes) info.notes = [];
    info.notes.push({ id: cryptoRandomId(), text, createdAt: Date.now() });
    noteTextarea.value = '';
    noteForm.hidden = true;
    saveData();
    renderSidePanel();
  }
  function deleteNote(dayKey, id) {
    const info = data.days[dayKey];
    if (!info || !info.notes) return;
    info.notes = info.notes.filter(n => n.id !== id);
    saveData();
    renderSidePanel();
  }
  function renderNotesList(notes) {
    notesList.innerHTML = '';
    if (!notes || notes.length === 0) {
      const li = document.createElement('li');
      li.className = 'note-item';
      li.textContent = 'No notes yet.';
      notesList.appendChild(li);
      return;
    }
    const frag = document.createDocumentFragment();
    notes.slice().reverse().forEach(note => {
      const li = document.createElement('li');
      li.className = 'note-item';
      const meta = document.createElement('div');
      meta.className = 'meta';
      const when = new Date(note.createdAt).toLocaleString();
      meta.innerHTML = `<span>${when}</span>`;
      const actions = document.createElement('div');
      actions.className = 'actions';
      const delBtn = document.createElement('button');
      delBtn.className = 'secondary-btn';
      delBtn.textContent = 'Delete';
      delBtn.addEventListener('click', () => deleteNote(selectedDateKey, note.id));
      actions.appendChild(delBtn);
      meta.appendChild(actions);

      const text = document.createElement('div');
      text.textContent = note.text;

      li.appendChild(meta);
      li.appendChild(text);
      frag.appendChild(li);
    });
    notesList.appendChild(frag);
  }

  // ---------- Navigation ----------
  function shiftMonth(delta) {
    const ym = selectedYearMonth;
    const d = new Date(ym.year, ym.month + delta, 1);
    selectedYearMonth = getYearMonth(d);
    // maintain selection: if selected date not in month, keep day number but clamp
    const sel = keyToDate(selectedDateKey);
    const clampedDay = clamp(sel.getDate(), 1, new Date(d.getFullYear(), d.getMonth()+1, 0).getDate());
    selectedDateKey = dateKey(new Date(d.getFullYear(), d.getMonth(), clampedDay));
    renderAll();
  }
  function jumpToToday() {
    const today = new Date();
    selectedYearMonth = getYearMonth(today);
    selectedDateKey = dateKey(today);
    renderAll();
  }

  // ---------- Stats & Streaks ----------
  function renderStats() {
    const today = zeroTime(new Date());
    const current = computeCurrentStreak(today, /*allowOneRest*/ settings.oneRestDay);
    const longest = computeLongestStreak(/*allowOneRest*/ settings.oneRestDay);
    currentStreakEl.textContent = String(current);
    longestStreakEl.textContent = String(longest);

    const { year, month } = selectedYearMonth;
    const lastDay = new Date(year, month + 1, 0).getDate();

    let completedDays = 0;
    let totalMinutes = 0;
    for (let d=1; d<=lastDay; d++) {
      const key = dateKey(new Date(year, month, d));
      const info = data.days[key];
      if (!info) continue;
      if (info.completed) completedDays++;
      totalMinutes += Math.round((info.durationMs || 0)/60000);
    }
    daysCompletedMonthEl.textContent = String(completedDays);
    minutesMonthEl.textContent = String(totalMinutes);
    const completionRate = Math.round((completedDays / lastDay) * 100);
    completionRateEl.textContent = `${completionRate}%`;
  }

  function isCompletedDay(key) { const info = data.days[key]; return !!(info && info.completed); }
  function computeCurrentStreak(fromDate, allowOneRest) {
    let streak = 0;
    let usedRest = false;
    let cursor = new Date(fromDate);
    for (;;) {
      const key = dateKey(cursor);
      if (isCompletedDay(key)) {
        streak++;
      } else if (!usedRest && allowOneRest) {
        usedRest = true;
        // rest day does not increment streak, but allows one gap
      } else {
        break;
      }
      cursor.setDate(cursor.getDate() - 1);
    }
    return streak;
  }
  function computeLongestStreak(allowOneRest) {
    // Iterate across all recorded days
    const keys = Object.keys(data.days).sort();
    if (keys.length === 0) return 0;
    let longest = 0;
    let start = keyToDate(keys[0]);
    let end = zeroTime(new Date());
    // sliding window
    let current = 0;
    let usedRest = false;
    let cursor = new Date(end);
    // Move backwards day by day
    while (cursor >= start) {
      const key = dateKey(cursor);
      if (isCompletedDay(key)) {
        current++;
      } else if (!usedRest && allowOneRest) {
        usedRest = true;
      } else {
        if (current > longest) longest = current;
        current = 0;
        usedRest = false;
      }
      cursor.setDate(cursor.getDate() - 1);
    }
    if (current > longest) longest = current;
    return longest;
  }

  // ---------- Charts (simple canvas bars) ----------
  function renderCharts() {
    renderWeeklyChart(chartWeekly.getContext('2d'));
    renderMonthlyChart(chartMonthly.getContext('2d'));
    renderYearlyChart(chartYearly.getContext('2d'));
  }
  function drawBars(ctx, values, labels, options) {
    const { color = '#60a5fa', baselineColor = '#263041', maxValue = Math.max(1, ...values), padding = 24 } = options || {};
    const { width, height } = ctx.canvas;
    ctx.clearRect(0,0,width,height);
    ctx.fillStyle = baselineColor;
    ctx.fillRect(0, height-1, width, 1);
    const barW = Math.max(6, Math.floor((width - padding*2) / values.length) - 8);
    const gap = Math.max(6, Math.floor((width - padding*2 - barW*values.length) / Math.max(1, values.length-1)));
    let x = padding;
    values.forEach((v, i) => {
      const h = Math.round(((v / maxValue) || 0) * (height - padding*1.6));
      ctx.fillStyle = color;
      ctx.fillRect(x, height - h - 2, barW, h);
      // label
      ctx.fillStyle = 'rgba(148,163,184,0.9)';
      ctx.font = '12px system-ui, -apple-system, Segoe UI, Roboto';
      const lbl = labels[i];
      const tw = ctx.measureText(lbl).width;
      ctx.fillText(lbl, Math.max(padding, Math.min(width - padding - tw, x + barW/2 - tw/2)), height - 6);
      x += barW + gap;
    });
  }
  function renderWeeklyChart(ctx) {
    const today = zeroTime(new Date());
    const days = [];
    const labels = [];
    for (let i=6; i>=0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const key = dateKey(d);
      const info = data.days[key];
      days.push(info ? Math.round((info.durationMs||0)/60000) : 0);
      labels.push(d.toLocaleDateString(undefined, { weekday: 'short' }).slice(0,1));
    }
    drawBars(ctx, days, labels, { color: '#6ee7b7' });
  }
  function renderMonthlyChart(ctx) {
    const { year, month } = selectedYearMonth;
    const lastDay = new Date(year, month + 1, 0).getDate();
    const values = [];
    const labels = [];
    for (let d=1; d<=lastDay; d++) {
      const key = dateKey(new Date(year, month, d));
      const info = data.days[key];
      values.push(info ? (info.completed ? 1 : 0) : 0);
      labels.push(String(d));
    }
    drawBars(ctx, values, labels, { color: '#60a5fa', maxValue: 1 });
  }
  function renderYearlyChart(ctx) {
    const now = new Date();
    const year = now.getFullYear();
    const values = [];
    const labels = [];
    for (let m=0; m<12; m++) {
      const daysInMonth = new Date(year, m+1, 0).getDate();
      let count = 0;
      for (let d=1; d<=daysInMonth; d++) {
        const key = dateKey(new Date(year, m, d));
        const info = data.days[key];
        if (info && info.completed) count++;
      }
      values.push(count);
      labels.push(new Date(year, m, 1).toLocaleString(undefined, { month: 'short' }));
    }
    drawBars(ctx, values, labels, { color: '#a78bfa' });
  }

  // ---------- Notes & Notifications helpers ----------
  function cryptoRandomId() { try { return crypto.randomUUID(); } catch { return 'id-' + Math.random().toString(36).slice(2); } }
  function chime() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = 880;
      o.connect(g);
      g.connect(ctx.destination);
      g.gain.setValueAtTime(0, ctx.currentTime);
      g.gain.linearRampToValueAtTime(0.2, ctx.currentTime + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.8);
      o.start();
      o.stop(ctx.currentTime + 0.85);
    } catch (e) { /* ignore */ }
  }
  function requestNotificationPermission() {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'default') {
      // request non-blocking after short delay
      setTimeout(() => { try { Notification.requestPermission(); } catch(e){} }, 1000);
    }
  }
  function tryShowNotification(title, body) {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'granted') {
      try { new Notification(title, { body }); } catch (e) {}
    }
  }

  // ---------- Import/Export ----------
  function exportData(isAuto) {
    const payload = { data, settings, exportedAt: new Date().toISOString(), version: 1 };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const ts = new Date();
    const stamp = `${ts.getFullYear()}${String(ts.getMonth()+1).padStart(2,'0')}${String(ts.getDate()).padStart(2,'0')}-${String(ts.getHours()).padStart(2,'0')}${String(ts.getMinutes()).padStart(2,'0')}${String(ts.getSeconds()).padStart(2,'0')}`;
    a.href = url;
    a.download = `guitar-pomodoro-backup-${stamp}.json`;
    if (isAuto) { a.style.display = 'none'; document.body.appendChild(a); }
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); if (isAuto && a.parentNode) a.parentNode.removeChild(a); }, 1000);
  }
  async function importData(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      if (!payload || !payload.data || !payload.data.days) throw new Error('Invalid file');
      // Merge days (favor imported)
      data.days = Object.assign({}, data.days, payload.data.days);
      // Merge settings (favor imported but ensure expected keys)
      settings = Object.assign({}, settings, payload.settings || {});
      saveSettings();
      saveData();
      renderAll();
      alert('Import complete.');
    } catch (err) {
      alert('Failed to import: ' + (err && err.message ? err.message : String(err)));
    } finally {
      e.target.value = '';
    }
  }

  // ---------- Save indicator ----------
  let saveStatusTimer = null;
  function bumpSaveStatus() {
    saveStatus.textContent = 'Saved ✔';
    clearTimeout(saveStatusTimer);
    saveStatusTimer = setTimeout(() => { saveStatus.textContent = 'All changes saved locally'; }, 1500);
  }

  // ---------- Persistent storage & File System Access ----------
  let directoryHandle = null; // user-linked backup folder
  async function initPersistentStorage() {
    try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch (e) {}
  }
  async function initFileSystemAccess() {
    try {
      // Restore previously saved handle from IndexedDB (Chromium only)
      const saved = await idbGet('gp-handles', 'handles', 'backupDir');
      if (saved && typeof saved === 'object') {
        directoryHandle = saved; // structured clone of FileSystemDirectoryHandle
        const ok = await verifyWritable(directoryHandle);
        if (ok) setBackupStatus('Folder linked'); else setBackupStatus('Local only');
      } else {
        setBackupStatus('Local only');
      }
      if (!window.showDirectoryPicker && linkBackupBtn) linkBackupBtn.style.display = 'none';
    } catch (e) { setBackupStatus('Local only'); }
  }
  async function linkBackupFolder() {
    if (!window.showDirectoryPicker) { alert('Linking a backup folder requires a Chromium-based browser over http(s).'); return; }
    try {
      const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
      const ok = await verifyWritable(handle);
      if (!ok) { alert('Cannot write to this folder.'); return; }
      directoryHandle = handle;
      await idbSet('gp-handles', 'handles', 'backupDir', handle);
      setBackupStatus('Folder linked');
      await fsAutoBackup();
      alert('Backup folder linked. We will auto-save backups here.');
    } catch (e) { /* user cancelled */ }
  }
  async function verifyWritable(dirHandle) {
    try {
      const fileHandle = await dirHandle.getFileHandle('._gp_write_test', { create: true });
      const w = await fileHandle.createWritable();
      await w.write('ok');
      await w.close();
      await dirHandle.removeEntry('._gp_write_test');
      return true;
    } catch (e) { return false; }
  }
  async function fsAutoBackup() {
    try {
      if (!directoryHandle) return false;
      const fileHandle = await directoryHandle.getFileHandle('guitar-pomodoro-backup.json', { create: true });
      const w = await fileHandle.createWritable();
      const payload = { data, settings, exportedAt: new Date().toISOString(), version: 1 };
      await w.write(JSON.stringify(payload, null, 2));
      await w.close();
      setBackupStatus('Auto backup ✓');
      return true;
    } catch (e) {
      setBackupStatus('Local only');
      return false;
    }
  }
  function setBackupStatus(text) { if (backupStatus) backupStatus.textContent = text; }

  // Minimal IndexedDB helpers for storing FileSystemDirectoryHandle
  function idbOpen(dbName, storeName) {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(dbName, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(storeName)) db.createObjectStore(storeName);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function idbGet(dbName, storeName, key) {
    try {
      const db = await idbOpen(dbName, storeName);
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readonly');
        const store = tx.objectStore(storeName);
        const req = store.get(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    } catch (e) { return null; }
  }
  async function idbSet(dbName, storeName, key, value) {
    try {
      const db = await idbOpen(dbName, storeName);
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        const req = store.put(value, key);
        req.onsuccess = () => resolve(true);
        req.onerror = () => reject(req.error);
      });
    } catch (e) { return false; }
  }

})();
