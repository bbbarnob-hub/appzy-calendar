/* ============================================================
   APPZY Calendar — application logic
   Offline-first: events live in localStorage, no server needed.
   ============================================================ */
'use strict';

/* ---------------- constants ---------------- */
const STORE_KEY = 'appzy.calendar.events.v1';
const SET_KEY = 'appzy.calendar.settings.v1';
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const MONTHS_S = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const DAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const DAYS_S = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const COLORS = ['blue','violet','green','amber','rose','cyan'];
const COLOR_HEX = { blue:'#5b8cff', violet:'#9b5bff', green:'#2fd27a', amber:'#ffb43a', rose:'#ff5b7f', cyan:'#2fd8e0' };

/* ---------------- state ---------------- */
const state = {
  events: [],
  settings: { notifications: false, weekStartMonday: true, showWeekends: true },
  view: 'month',
  cursor: new Date(),          // month/week anchor
  selected: new Date(),        // selected day
  editingId: null,
  editColor: 'blue',
  editDate: null,
  firedReminders: new Set(),
};

/* ---------------- storage ---------------- */
function loadState() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) state.events = parsed.filter(e => e && e.id && e.date);
    }
  } catch (err) { console.warn('load events failed', err); }

  try {
    const raw = localStorage.getItem(SET_KEY);
    if (raw) Object.assign(state.settings, JSON.parse(raw));
  } catch (err) { console.warn('load settings failed', err); }
}

function saveEvents() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state.events)); }
  catch (err) { toast('Storage full — could not save'); }
}

function saveSettings() {
  try { localStorage.setItem(SET_KEY, JSON.stringify(state.settings)); } catch (err) {}
}

/* ---------------- date helpers ---------------- */
const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseISO = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const todayISO = () => iso(new Date());
const addDays = (d, n) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() + n); return x; };
const startOfWeek = d => {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const wd = x.getDay();
  const shift = state.settings.weekStartMonday ? (wd === 0 ? -6 : 1 - wd) : -wd;
  return addDays(x, shift);
};
const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

function fmtTime(hhmm) {
  if (!hhmm) return '';
  const [h, m] = hhmm.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${pad(m)} ${ampm}`;
}

function minutesOf(hhmm) {
  if (!hhmm) return 0;
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/* ---------------- recurrence ---------------- */
function occursOn(ev, date) {
  const start = parseISO(ev.date);
  if (date < new Date(start.getFullYear(), start.getMonth(), start.getDate())) return false;
  const rep = ev.repeat || 'none';
  if (rep === 'none') return sameDay(start, date);
  if (rep === 'daily') return true;
  if (rep === 'weekly') return start.getDay() === date.getDay();
  if (rep === 'monthly') return start.getDate() === date.getDate();
  if (rep === 'yearly') return start.getMonth() === date.getMonth() && start.getDate() === date.getDate();
  return sameDay(start, date);
}

function eventsOn(date) {
  const list = state.events.filter(ev => occursOn(ev, date));
  return list.sort((a, b) => {
    if (a.allDay && !b.allDay) return -1;
    if (!a.allDay && b.allDay) return 1;
    return minutesOf(a.start) - minutesOf(b.start);
  });
}

function eventsInRange(from, to) {
  const out = [];
  let d = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const end = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  let guard = 0;
  while (d <= end && guard++ < 400) {
    eventsOn(d).forEach(ev => out.push({ ev, date: new Date(d) }));
    d = addDays(d, 1);
  }
  return out;
}

/* ---------------- toast ---------------- */
let toastTimer = null;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

function vibrate(ms) { if (navigator.vibrate) navigator.vibrate(ms); }

/* ============================================================
   RENDER — HEADER
   ============================================================ */
function renderHeader() {
  const c = state.cursor;
  const now = new Date();
  document.getElementById('monthLabel').textContent = `${MONTHS[c.getMonth()]} ${c.getFullYear()}`;
  const sel = state.selected;
  const isToday = sameDay(sel, now);
  document.getElementById('subLabel').textContent =
    `${isToday ? 'Today · ' : ''}${DAYS[sel.getDay()]}, ${sel.getDate()} ${MONTHS_S[sel.getMonth()]}`;
}

/* ============================================================
   RENDER — MONTH
   ============================================================ */
function renderMonth() {
  const grid = document.getElementById('monthGrid');
  grid.innerHTML = '';

  const first = new Date(state.cursor.getFullYear(), state.cursor.getMonth(), 1);
  const start = startOfWeek(first);
  const cells = 42;
  const tISO = todayISO();

  for (let i = 0; i < cells; i++) {
    const date = addDays(start, i);
    const dISO = iso(date);
    const inMonth = date.getMonth() === state.cursor.getMonth();
    const isToday = dISO === tISO;
    const isSel = sameDay(date, state.selected);
    const wd = date.getDay();
    const isWeekend = wd === 0 || wd === 6;

    const cell = document.createElement('div');
    cell.className = 'cell';
    if (!inMonth) cell.classList.add('out');
    if (isToday) cell.classList.add('today');
    if (isSel) cell.classList.add('selected');
    if (isWeekend && state.settings.showWeekends) cell.classList.add('weekend');
    cell.dataset.date = dISO;

    const num = document.createElement('div');
    num.className = 'day-num';
    num.textContent = date.getDate();
    cell.appendChild(num);

    const evs = eventsOn(date);
    if (evs.length) {
      if (evs.length <= 2 && inMonth) {
        evs.slice(0, 2).forEach(ev => {
          const chip = document.createElement('div');
          chip.className = 'mini-ev';
          chip.textContent = ev.title || 'Event';
          chip.style.background = COLOR_HEX[ev.color] || COLOR_HEX.blue;
          cell.appendChild(chip);
        });
        if (evs.length > 2) {
          const more = document.createElement('div');
          more.className = 'mini-ev';
          more.textContent = `+${evs.length - 2} more`;
          more.style.background = 'rgba(255,255,255,.14)';
          cell.appendChild(more);
        }
      } else {
        const dots = document.createElement('div');
        dots.className = 'dots';
        evs.slice(0, 4).forEach(ev => {
          const d = document.createElement('i');
          d.className = 'dot ' + (ev.color || 'blue');
          dots.appendChild(d);
        });
        cell.appendChild(dots);
      }
    }

    cell.addEventListener('click', () => {
      state.selected = date;
      if (!inMonth) state.cursor = new Date(date.getFullYear(), date.getMonth(), 1);
      renderAll();
      openDaySheet(date);
    });

    grid.appendChild(cell);
  }
}

/* ============================================================
   RENDER — WEEK
   ============================================================ */
function renderWeek() {
  const start = startOfWeek(state.cursor);
  const end = addDays(start, 6);
  document.getElementById('weekLabel').textContent =
    `${start.getDate()} ${MONTHS_S[start.getMonth()]} – ${end.getDate()} ${MONTHS_S[end.getMonth()]} ${end.getFullYear()}`;

  const strip = document.getElementById('weekStrip');
  strip.innerHTML = '';
  const tISO = todayISO();

  for (let i = 0; i < 7; i++) {
    const date = addDays(start, i);
    const el = document.createElement('div');
    el.className = 'wd';
    if (iso(date) === tISO) el.classList.add('today');
    if (sameDay(date, state.selected)) el.classList.add('sel');
    el.innerHTML = `<span>${DAYS_S[date.getDay()].slice(0, 2)}</span><b>${date.getDate()}</b>`;
    el.addEventListener('click', () => { state.selected = date; renderAll(); });
    strip.appendChild(el);
  }

  const wrap = document.getElementById('weekAgenda');
  wrap.innerHTML = '';
  const items = eventsInRange(start, end);
  if (!items.length) {
    wrap.innerHTML = `<div class="empty"><b>◷</b>No events this week.<br>Tap + to add one.</div>`;
    return;
  }
  let lastDay = '';
  items.forEach(({ ev, date }) => {
    const dISO = iso(date);
    if (dISO !== lastDay) {
      lastDay = dISO;
      wrap.appendChild(dayHeaderEl(date, eventsOn(date).length));
    }
    wrap.appendChild(eventCardEl(ev, date));
  });
}

/* ============================================================
   RENDER — AGENDA
   ============================================================ */
function renderAgenda() {
  const wrap = document.getElementById('agendaList');
  wrap.innerHTML = '';
  const from = new Date();
  const to = addDays(from, 120);
  const items = eventsInRange(from, to);

  if (!items.length) {
    wrap.innerHTML = `<div class="empty"><b>◆</b>Nothing scheduled yet.<br>Tap + to create your first event.</div>`;
    return;
  }
  let lastDay = '';
  items.forEach(({ ev, date }) => {
    const dISO = iso(date);
    if (dISO !== lastDay) {
      lastDay = dISO;
      wrap.appendChild(dayHeaderEl(date, eventsOn(date).length));
    }
    wrap.appendChild(eventCardEl(ev, date));
  });
}

function dayHeaderEl(date, count) {
  const el = document.createElement('div');
  el.className = 'agenda-day';
  if (sameDay(date, new Date())) el.classList.add('is-today');
  const label = sameDay(date, new Date())
    ? 'Today'
    : sameDay(date, addDays(new Date(), 1))
      ? 'Tomorrow'
      : `${DAYS_S[date.getDay()]} ${date.getDate()} ${MONTHS_S[date.getMonth()]}`;
  el.innerHTML = `<h3>${label}</h3><i class="line"></i><span class="cnt">${count} event${count === 1 ? '' : 's'}</span>`;
  return el;
}

function eventCardEl(ev, date) {
  const card = document.createElement('div');
  card.className = 'ev-card';

  const bar = document.createElement('i');
  bar.className = 'ev-bar ' + (ev.color || 'blue');
  card.appendChild(bar);

  const main = document.createElement('div');
  main.className = 'ev-main';

  const title = document.createElement('div');
  title.className = 'ev-title';
  title.textContent = ev.title || 'Untitled event';
  main.appendChild(title);

  const meta = document.createElement('div');
  meta.className = 'ev-meta';
  const time = ev.allDay ? 'All day' : `${fmtTime(ev.start)}${ev.end ? ' – ' + fmtTime(ev.end) : ''}`;
  meta.innerHTML = `<span>${time}</span>`;
  if (ev.repeat && ev.repeat !== 'none') {
    const b = document.createElement('span');
    b.className = 'ev-badge';
    b.textContent = ev.repeat;
    meta.appendChild(b);
  }
  main.appendChild(meta);

  if (ev.notes) {
    const n = document.createElement('div');
    n.className = 'ev-notes';
    n.textContent = ev.notes;
    main.appendChild(n);
  }

  card.appendChild(main);
  card.addEventListener('click', () => openEditor(ev.id, date));
  return card;
}

/* ============================================================
   SHEETS
   ============================================================ */
function openSheet(id) {
  document.getElementById(id).classList.add('open');
}
function closeSheet(id) {
  document.getElementById(id).classList.remove('open');
}
function closeAllSheets() {
  document.querySelectorAll('.sheet-wrap.open').forEach(el => el.classList.remove('open'));
}

function openDaySheet(date) {
  const sheet = document.getElementById('daySheet');
  document.getElementById('sheetDate').textContent = `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
  document.getElementById('sheetDay').textContent = DAYS[date.getDay()];

  const list = document.getElementById('dayEvents');
  list.innerHTML = '';
  const evs = eventsOn(date);
  if (!evs.length) {
    list.innerHTML = `<div class="empty"><b>◷</b>No events on this day.</div>`;
  } else {
    evs.forEach(ev => {
      const card = eventCardEl(ev, date);
      list.appendChild(card);
    });
  }
  sheet.dataset.date = iso(date);
  openSheet('daySheet');
}

/* ---------------- editor ---------------- */
function openEditor(id, date) {
  state.editingId = id || null;
  const ev = id ? state.events.find(e => e.id === id) : null;
  const target = ev ? parseISO(ev.date) : (date || state.selected || new Date());

  document.getElementById('editTitle').textContent = ev ? 'Edit event' : 'New event';
  document.getElementById('evTitle').value = ev ? ev.title : '';
  document.getElementById('evDate').value = iso(target);
  document.getElementById('evAllDay').checked = ev ? !!ev.allDay : false;
  document.getElementById('evStart').value = ev && ev.start ? ev.start : '09:00';
  document.getElementById('evEnd').value = ev && ev.end ? ev.end : '10:00';
  document.getElementById('evRepeat').value = ev ? (ev.repeat || 'none') : 'none';
  document.getElementById('evRemind').value = ev && ev.remind !== undefined ? String(ev.remind) : '15';
  document.getElementById('evNotes').value = ev ? (ev.notes || '') : '';
  document.getElementById('deleteEv').style.display = ev ? 'block' : 'none';

  state.editColor = ev ? (ev.color || 'blue') : 'blue';
  paintSwatches();
  toggleTimeRow();

  closeAllSheets();
  openSheet('editSheet');
  setTimeout(() => document.getElementById('evTitle').focus(), 320);
}

function paintSwatches() {
  document.querySelectorAll('.swatch').forEach(sw => {
    sw.classList.toggle('sel', sw.dataset.c === state.editColor);
  });
}

function toggleTimeRow() {
  const allDay = document.getElementById('evAllDay').checked;
  document.getElementById('timeRow').style.display = allDay ? 'none' : 'grid';
}

/* ---------------- save / delete ---------------- */
function saveEvent(e) {
  e.preventDefault();
  const title = document.getElementById('evTitle').value.trim();
  if (!title) { toast('Give the event a title'); return; }

  const dateVal = document.getElementById('evDate').value;
  if (!dateVal) { toast('Pick a date'); return; }

  const allDay = document.getElementById('evAllDay').checked;
  let start = document.getElementById('evStart').value || '09:00';
  let end = document.getElementById('evEnd').value || '';
  if (!allDay && end && minutesOf(end) < minutesOf(start)) {
    toast('End time is before start time');
    return;
  }

  const payload = {
    title,
    date: dateVal,
    allDay,
    start: allDay ? '' : start,
    end: allDay ? '' : end,
    color: state.editColor,
    repeat: document.getElementById('evRepeat').value,
    remind: Number(document.getElementById('evRemind').value),
    notes: document.getElementById('evNotes').value.trim(),
    updated: Date.now(),
  };

  if (state.editingId) {
    const idx = state.events.findIndex(x => x.id === state.editingId);
    if (idx >= 0) state.events[idx] = Object.assign({}, state.events[idx], payload);
    toast('Event updated');
  } else {
    payload.id = 'ev_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    payload.created = Date.now();
    state.events.push(payload);
    toast('Event added');
  }

  saveEvents();
  vibrate(18);
  closeAllSheets();
  state.cursor = parseISO(dateVal);
  state.selected = parseISO(dateVal);
  renderAll();
}

function deleteEvent() {
  if (!state.editingId) return;
  const ev = state.events.find(e => e.id === state.editingId);
  if (!ev) return;
  if (!confirm(`Delete "${ev.title}"?`)) return;
  state.events = state.events.filter(e => e.id !== state.editingId);
  saveEvents();
  closeAllSheets();
  renderAll();
  toast('Event deleted');
}

/* ============================================================
   SEARCH
   ============================================================ */
function runSearch() {
  const q = document.getElementById('searchInput').value.trim().toLowerCase();
  const wrap = document.getElementById('searchResults');
  wrap.innerHTML = '';
  if (!q) return;

  const from = addDays(new Date(), -180);
  const to = addDays(new Date(), 365);
  const items = eventsInRange(from, to).filter(({ ev }) =>
    (ev.title || '').toLowerCase().includes(q) || (ev.notes || '').toLowerCase().includes(q)
  );

  if (!items.length) {
    wrap.innerHTML = `<div class="empty"><b>⌕</b>No events match "${q}".</div>`;
    return;
  }
  let lastDay = '';
  items.slice(0, 60).forEach(({ ev, date }) => {
    const dISO = iso(date);
    if (dISO !== lastDay) { lastDay = dISO; wrap.appendChild(dayHeaderEl(date, eventsOn(date).length)); }
    wrap.appendChild(eventCardEl(ev, date));
  });
}

/* ============================================================
   REMINDERS
   ============================================================ */
function checkReminders() {
  if (!state.settings.notifications) return;
  const now = new Date();
  const today = iso(now);
  const nowMin = now.getHours() * 60 + now.getMinutes();

  eventsOn(now).forEach(ev => {
    if (ev.allDay || !ev.start || ev.remind === -1) return;
    const startMin = minutesOf(ev.start);
    const remindAt = startMin - (Number(ev.remind) || 0);
    const key = `${ev.id}|${today}|${ev.start}`;
    if (state.firedReminders.has(key)) return;

    if (nowMin >= remindAt && nowMin <= startMin && nowMin >= remindAt) {
      state.firedReminders.add(key);
      notify(ev);
    }
  });
}

function notify(ev) {
  const when = ev.allDay ? 'All day' : fmtTime(ev.start);
  toast(`⏰ ${ev.title} · ${when}`);
  vibrate([40, 60, 40]);
  if ('Notification' in window && Notification.permission === 'granted') {
    try { new Notification('APPZY Calendar', { body: `${ev.title} · ${when}` }); } catch (e) {}
  }
}

function requestNotificationPermission() {
  if ('Notification' in window && Notification.permission === 'default') {
    try {
      const p = Notification.requestPermission();
      if (p && p.then) p.catch(() => {});
    } catch (e) {}
  }
}

/* ============================================================
   EXPORT / IMPORT
   ============================================================ */
function exportICS() {
  if (!state.events.length) { toast('No events to export'); return; }
  const stamp = d => d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//APPZY//Calendar//EN', 'CALSCALE:GREGORIAN'];

  state.events.forEach(ev => {
    const d = parseISO(ev.date);
    const dStr = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${ev.id}@appzy`);
    lines.push(`DTSTAMP:${stamp(new Date())}`);
    if (ev.allDay) {
      lines.push(`DTSTART;VALUE=DATE:${dStr}`);
      lines.push(`DTEND;VALUE=DATE:${dStr}`);
    } else {
      const s = (ev.start || '09:00').replace(':', '') + '00';
      const e = (ev.end || ev.start || '10:00').replace(':', '') + '00';
      lines.push(`DTSTART:${dStr}T${s}`);
      lines.push(`DTEND:${dStr}T${e}`);
    }
    lines.push(`SUMMARY:${(ev.title || '').replace(/[,;]/g, '\\$&')}`);
    if (ev.notes) lines.push(`DESCRIPTION:${ev.notes.replace(/\n/g, '\\n').replace(/[,;]/g, '\\$&')}`);
    if (ev.repeat && ev.repeat !== 'none') {
      const freq = { daily: 'DAILY', weekly: 'WEEKLY', monthly: 'MONTHLY', yearly: 'YEARLY' }[ev.repeat];
      if (freq) lines.push(`RRULE:FREQ=${freq}`);
    }
    lines.push('END:VEVENT');
  });
  lines.push('END:VCALENDAR');

  const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'appzy-calendar.ics';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1500);
  toast('Exported ' + state.events.length + ' events as .ics');
}

function copyBackup() {
  const json = JSON.stringify({ app: 'APPZY Calendar', version: 1, exported: new Date().toISOString(), events: state.events }, null, 1);
  document.getElementById('backupBox').value = json;
  const done = () => toast('Backup copied — paste it somewhere safe');
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(json).then(done).catch(done);
  } else { done(); }
}

function importBackup() {
  const raw = document.getElementById('backupBox').value.trim();
  if (!raw) { toast('Paste a backup first'); return; }
  try {
    const parsed = JSON.parse(raw);
    const incoming = Array.isArray(parsed) ? parsed : parsed.events;
    if (!Array.isArray(incoming)) throw new Error('bad shape');
    const clean = incoming.filter(e => e && e.id && e.date && e.title);
    if (!clean.length) throw new Error('no events');
    const existing = new Set(state.events.map(e => e.id));
    let added = 0;
    clean.forEach(e => { if (!existing.has(e.id)) { state.events.push(e); added++; } });
    saveEvents();
    renderAll();
    toast(`Restored ${added} event${added === 1 ? '' : 's'}`);
  } catch (err) {
    toast('That backup could not be read');
  }
}

function clearAll() {
  if (!state.events.length) { toast('Nothing to delete'); return; }
  if (!confirm(`Delete all ${state.events.length} events? This cannot be undone.`)) return;
  state.events = [];
  saveEvents();
  renderAll();
  toast('All events deleted');
}

/* ============================================================
   MASTER RENDER
   ============================================================ */
function renderAll() {
  renderHeader();
  if (state.view === 'month') renderMonth();
  else if (state.view === 'week') renderWeek();
  else renderAgenda();
}

function setView(v) {
  state.view = v;
  document.querySelectorAll('.seg').forEach(b => b.classList.toggle('active', b.dataset.view === v));
  document.querySelectorAll('.view').forEach(el => el.classList.remove('active'));
  document.getElementById('view-' + v).classList.add('active');
  renderAll();
}

/* ============================================================
   INIT
   ============================================================ */
function init() {
  loadState();

  // segmented control
  document.querySelectorAll('.seg').forEach(btn => {
    btn.addEventListener('click', () => setView(btn.dataset.view));
  });

  // month swipe / navigation
  const monthView = document.getElementById('view-month');
  let touchX = 0, touchY = 0, touching = false;
  monthView.addEventListener('touchstart', e => {
    touchX = e.touches[0].clientX; touchY = e.touches[0].clientY; touching = true;
  }, { passive: true });
  monthView.addEventListener('touchend', e => {
    if (!touching) return;
    touching = false;
    const dx = e.changedTouches[0].clientX - touchX;
    const dy = e.changedTouches[0].clientY - touchY;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.6) {
      shiftMonth(dx < 0 ? 1 : -1);
    }
  }, { passive: true });

  // week nav
  document.getElementById('prevWeek').addEventListener('click', () => {
    state.cursor = addDays(state.cursor, -7); renderAll();
  });
  document.getElementById('nextWeek').addEventListener('click', () => {
    state.cursor = addDays(state.cursor, 7); renderAll();
  });

  // today
  document.getElementById('todayBtn').addEventListener('click', () => {
    const n = new Date();
    state.cursor = new Date(n.getFullYear(), n.getMonth(), 1);
    state.selected = n;
    renderAll();
    vibrate(12);
    toast('Jumped to today');
  });

  // fab + sheet add
  document.getElementById('addBtn').addEventListener('click', () => openEditor(null, state.selected));
  document.getElementById('sheetAdd').addEventListener('click', () => {
    const d = document.getElementById('daySheet').dataset.date;
    openEditor(null, d ? parseISO(d) : state.selected);
  });

  // sheets close
  document.getElementById('closeSheet').addEventListener('click', () => closeSheet('daySheet'));
  document.getElementById('closeEdit').addEventListener('click', () => closeSheet('editSheet'));
  document.getElementById('closeSearch').addEventListener('click', () => closeSheet('searchSheet'));
  document.getElementById('closeSettings').addEventListener('click', () => closeSheet('settingsSheet'));
  document.querySelectorAll('.sheet-wrap').forEach(w => {
    w.addEventListener('click', e => { if (e.target === w) w.classList.remove('open'); });
  });

  // editor controls
  document.getElementById('eventForm').addEventListener('submit', saveEvent);
  document.getElementById('deleteEv').addEventListener('click', deleteEvent);
  document.getElementById('evAllDay').addEventListener('change', toggleTimeRow);
  document.getElementById('colorPick').addEventListener('click', e => {
    const sw = e.target.closest('.swatch');
    if (!sw) return;
    state.editColor = sw.dataset.c;
    paintSwatches();
    vibrate(10);
  });

  // search
  document.getElementById('searchBtn').addEventListener('click', () => {
    openSheet('searchSheet');
    setTimeout(() => document.getElementById('searchInput').focus(), 300);
  });
  document.getElementById('searchInput').addEventListener('input', runSearch);

  // settings
  document.getElementById('menuBtn').addEventListener('click', () => {
    document.getElementById('notifToggle').checked = state.settings.notifications;
    document.getElementById('weekStartToggle').checked = state.settings.weekStartMonday;
    document.getElementById('weekendToggle').checked = state.settings.showWeekends;
    openSheet('settingsSheet');
  });

  document.getElementById('notifToggle').addEventListener('change', e => {
    state.settings.notifications = e.target.checked;
    if (e.target.checked) requestNotificationPermission();
    saveSettings();
    toast(e.target.checked ? 'Reminders on' : 'Reminders off');
  });

  document.getElementById('weekStartToggle').addEventListener('change', e => {
    state.settings.weekStartMonday = e.target.checked;
    saveSettings();
    renderAll();
    toast(e.target.checked ? 'Week starts Monday' : 'Week starts Sunday');
  });

  document.getElementById('weekendToggle').addEventListener('change', e => {
    state.settings.showWeekends = e.target.checked;
    saveSettings();
    renderAll();
  });

  document.getElementById('exportBtn').addEventListener('click', exportICS);
  document.getElementById('copyBtn').addEventListener('click', copyBackup);
  document.getElementById('importBtn').addEventListener('click', importBackup);
  document.getElementById('clearAll').addEventListener('click', clearAll);

  // back button / escape closes top sheet
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeAllSheets();
  });

  // seed a friendly first-run event
  if (!state.events.length && !localStorage.getItem('appzy.seeded')) {
    const t = new Date();
    state.events.push({
      id: 'ev_welcome', title: 'Welcome to APPZY Calendar', date: iso(t),
      allDay: false, start: '18:00', end: '18:30', color: 'violet', repeat: 'none',
      remind: 15, notes: 'Tap any day to see it, tap + to add your own events.', created: Date.now(), updated: Date.now(),
    });
    saveEvents();
    localStorage.setItem('appzy.seeded', '1');
  }

  renderAll();
  setInterval(checkReminders, 30000);
  setTimeout(checkReminders, 3000);
}

function shiftMonth(dir) {
  const c = state.cursor;
  state.cursor = new Date(c.getFullYear(), c.getMonth() + dir, 1);
  renderAll();
  vibrate(10);
}

document.addEventListener('DOMContentLoaded', init);

/* expose for tests */
window.__appzy = { state, occursOn, eventsOn, iso, parseISO, addDays, fmtTime, minutesOf, saveEvent, renderAll };
