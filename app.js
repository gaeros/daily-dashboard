// ===== Daily Dashboard =====
// Tutti i dati restano in localStorage sul dispositivo.

const $ = (sel) => document.querySelector(sel);

const store = {
  get(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
    catch { return fallback; }
  },
  set(key, value) { localStorage.setItem(key, JSON.stringify(value)); },
};

// ---------- Data di oggi ----------
const today = new Date();
$('#today-date').textContent = today.toLocaleDateString('it-IT', {
  weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
});

// ---------- Meteo (Open-Meteo) ----------
// Per ogni codice meteo: classe Font Awesome (con classe colore wi-*) e descrizione.
const WEATHER_CODES = {
  0: ['fa-sun wi-sun', 'Sereno'], 1: ['fa-cloud-sun wi-sun', 'Quasi sereno'],
  2: ['fa-cloud-sun wi-cloud', 'Parz. nuvoloso'], 3: ['fa-cloud wi-cloud', 'Coperto'],
  45: ['fa-smog wi-cloud', 'Nebbia'], 48: ['fa-smog wi-cloud', 'Nebbia gelata'],
  51: ['fa-cloud-rain wi-rain', 'Pioviggine'], 53: ['fa-cloud-rain wi-rain', 'Pioviggine'],
  55: ['fa-cloud-rain wi-rain', 'Pioviggine intensa'],
  61: ['fa-cloud-rain wi-rain', 'Pioggia debole'], 63: ['fa-cloud-rain wi-rain', 'Pioggia'],
  65: ['fa-cloud-showers-heavy wi-rain', 'Pioggia forte'],
  66: ['fa-cloud-rain wi-rain', 'Pioggia gelata'], 67: ['fa-cloud-rain wi-rain', 'Pioggia gelata'],
  71: ['fa-snowflake wi-snow', 'Neve debole'], 73: ['fa-snowflake wi-snow', 'Neve'],
  75: ['fa-snowflake wi-snow', 'Neve forte'], 77: ['fa-snowflake wi-snow', 'Nevischio'],
  80: ['fa-cloud-rain wi-rain', 'Rovesci deboli'], 81: ['fa-cloud-showers-heavy wi-rain', 'Rovesci'],
  82: ['fa-cloud-showers-heavy wi-rain', 'Rovesci forti'],
  85: ['fa-snowflake wi-snow', 'Rovesci di neve'], 86: ['fa-snowflake wi-snow', 'Rovesci di neve'],
  95: ['fa-cloud-bolt wi-bolt', 'Temporale'], 96: ['fa-cloud-bolt wi-bolt', 'Temporale con grandine'],
  99: ['fa-cloud-bolt wi-bolt', 'Temporale con grandine'],
};
const wc = (code) => {
  const [cls, label] = WEATHER_CODES[code] || ['fa-temperature-half wi-cloud', '—'];
  return [`<i class="fa-solid ${cls}" aria-hidden="true"></i>`, label];
};
const fa = (name) => `<i class="fa-solid ${name}" aria-hidden="true"></i>`;

const DEFAULT_CITY = { name: 'Roma', latitude: 41.894, longitude: 12.483 };
let city = store.get('city', DEFAULT_CITY);
let todayRainProb = null;
let weatherData = null;
let selectedDay = null;

async function loadWeather() {
  $('#weather-city').textContent = city.name;
  const url = 'https://api.open-meteo.com/v1/forecast' +
    `?latitude=${city.latitude}&longitude=${city.longitude}` +
    '&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code' +
    '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,' +
    'sunrise,sunset,uv_index_max,precipitation_sum,wind_speed_10m_max' +
    '&hourly=temperature_2m,weather_code,precipitation_probability,wind_speed_10m' +
    '&timezone=auto&forecast_days=7';
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    renderWeather(data);
  } catch (err) {
    $('#weather-current').innerHTML =
      '<p class="muted"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i> Meteo non disponibile (sei offline?). Riprova più tardi.</p>';
    console.error('Meteo:', err);
  }
}

function renderWeather(data) {
  weatherData = data;
  selectedDay = null;
  $('#weather-detail').classList.add('hidden');
  const c = data.current;
  const [icon, label] = wc(c.weather_code);
  $('#weather-current').innerHTML = `
    <span class="icon">${icon}</span>
    <div>
      <span class="temp">${Math.round(c.temperature_2m)}°C</span>
      <div class="details">${label} · Percepiti ${Math.round(c.apparent_temperature)}°C ·
        ${fa('fa-droplet wi-rain')} ${c.relative_humidity_2m}% · ${fa('fa-wind wi-cloud')} ${Math.round(c.wind_speed_10m)} km/h</div>
    </div>`;

  const d = data.daily;
  todayRainProb = d.precipitation_probability_max[0];
  $('#weather-forecast').innerHTML = d.time.map((iso, i) => {
    const day = new Date(iso + 'T12:00');
    const name = i === 0 ? 'Oggi' : day.toLocaleDateString('it-IT', { weekday: 'short' });
    const [dIcon, dLabel] = wc(d.weather_code[i]);
    const rain = d.precipitation_probability_max[i];
    const longName = day.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
    return `<button type="button" class="day" data-i="${i}" aria-expanded="false"
      aria-label="Dettaglio meteo di ${i === 0 ? 'oggi' : longName}: ${dLabel}">
      <span class="d-name">${name}</span>
      <span class="d-icon" aria-hidden="true">${dIcon}</span>
      <span>${Math.round(d.temperature_2m_max[i])}° / ${Math.round(d.temperature_2m_min[i])}°</span>
      ${rain >= 20 ? `<span class="d-rain">${fa('fa-umbrella')} ${rain}%</span>` : ''}
    </button>`;
  }).join('');

  $('#weather-forecast').querySelectorAll('.day').forEach((btn) => {
    btn.addEventListener('click', () => toggleWeatherDetail(+btn.dataset.i));
  });

  renderSummary();
}

function toggleWeatherDetail(i) {
  selectedDay = selectedDay === i ? null : i;
  $('#weather-forecast').querySelectorAll('.day').forEach((btn) => {
    const active = +btn.dataset.i === selectedDay;
    btn.classList.toggle('selected', active);
    btn.setAttribute('aria-expanded', active);
  });
  if (selectedDay === null) {
    $('#weather-detail').classList.add('hidden');
    return;
  }
  renderWeatherDetail(selectedDay);
}

function renderWeatherDetail(i) {
  const d = weatherData.daily;
  const h = weatherData.hourly;
  const [icon, label] = wc(d.weather_code[i]);
  const day = new Date(d.time[i] + 'T12:00');
  const title = i === 0 ? 'Oggi' : day.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
  const hhmm = (iso) => iso.slice(11, 16);

  // Le ore del giorno selezionato: 24 valori a partire da i*24, una colonna ogni 3 ore.
  const hours = [];
  for (let k = i * 24; k < (i + 1) * 24 && k < h.time.length; k += 3) {
    const [hIcon] = wc(h.weather_code[k]);
    const rain = h.precipitation_probability[k];
    hours.push(`<div class="hour">
      <span class="muted">${hhmm(h.time[k])}</span>
      <span class="h-icon" aria-hidden="true">${hIcon}</span>
      <span>${Math.round(h.temperature_2m[k])}°</span>
      <span class="d-rain">${rain >= 10 ? `${fa('fa-umbrella')} ${rain}%` : '&nbsp;'}</span>
    </div>`);
  }

  $('#weather-detail').innerHTML = `
    <div class="detail-header">
      <strong>${icon} ${title}</strong> · ${label}
    </div>
    <div class="detail-stats">
      <span>${fa('fa-temperature-half')} ${Math.round(d.temperature_2m_max[i])}° / ${Math.round(d.temperature_2m_min[i])}°</span>
      <span>${fa('fa-umbrella wi-rain')} pioggia ${d.precipitation_probability_max[i] ?? 0}%${d.precipitation_sum[i] > 0 ? ` (${d.precipitation_sum[i].toFixed(1)} mm)` : ''}</span>
      <span>${fa('fa-wind wi-cloud')} fino a ${Math.round(d.wind_speed_10m_max[i])} km/h</span>
      <span>${fa('fa-sun wi-sun')} UV max ${Math.round(d.uv_index_max[i])}</span>
      <span>${fa('fa-arrow-up wi-sun')} alba ${hhmm(d.sunrise[i])}</span>
      <span>${fa('fa-arrow-down wi-bolt')} tramonto ${hhmm(d.sunset[i])}</span>
    </div>
    <div class="hours">${hours.join('')}</div>`;
  $('#weather-detail').classList.remove('hidden');
}

// ---------- Ricerca città / geolocalizzazione ----------
const settingsDialog = $('#settings-dialog');
$('#btn-settings').addEventListener('click', () => settingsDialog.showModal());
$('#btn-close-settings').addEventListener('click', () => settingsDialog.close());

let searchTimer;
$('#city-input').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  const q = e.target.value.trim();
  if (q.length < 2) { $('#city-results').innerHTML = ''; return; }
  searchTimer = setTimeout(() => searchCity(q), 350);
});

async function searchCity(q) {
  try {
    const res = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=5&language=it`);
    const data = await res.json();
    const results = data.results || [];
    $('#city-results').innerHTML = results.map((r, i) =>
      `<li><button type="button" class="result" data-i="${i}">${fa('fa-location-dot')} ${escapeHtml(r.name)}${r.admin1 ? ', ' + escapeHtml(r.admin1) : ''} (${escapeHtml(r.country_code || '')})</button></li>`).join('')
      || '<li class="muted">Nessun risultato</li>';
    $('#city-results').querySelectorAll('button[data-i]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const r = results[btn.dataset.i];
        setCity({ name: r.name, latitude: r.latitude, longitude: r.longitude });
      });
    });
  } catch (err) { console.error('Geocoding:', err); }
}

$('#btn-geolocate').addEventListener('click', () => {
  if (!navigator.geolocation) return alert('Geolocalizzazione non supportata.');
  navigator.geolocation.getCurrentPosition(
    (pos) => setCity({
      name: 'La mia posizione',
      latitude: +pos.coords.latitude.toFixed(3),
      longitude: +pos.coords.longitude.toFixed(3),
    }),
    () => alert('Impossibile ottenere la posizione.'),
  );
});

function setCity(newCity) {
  city = newCity;
  store.set('city', city);
  $('#city-results').innerHTML = '';
  $('#city-input').value = '';
  settingsDialog.close();
  loadWeather();
}

// ---------- Agenda ----------
let todos = store.get('todos', []);

$('#todo-form').addEventListener('submit', (e) => {
  e.preventDefault();
  todos.push({
    id: Date.now(),
    text: $('#todo-text').value.trim(),
    due: $('#todo-date').value || null,
    time: $('#todo-time').value || null,
    priority: $('#todo-priority').value,
    done: false,
  });
  store.set('todos', todos);
  e.target.reset();
  renderTodos();
});

// Una scadenza è passata se la data è prima di oggi, oppure è oggi e l'ora è già trascorsa.
function isOverdue(t, todayISO) {
  if (!t.due || t.done) return false;
  if (t.due < todayISO) return true;
  if (t.due > todayISO) return false;
  return !!t.time && t.time < new Date().toTimeString().slice(0, 5);
}

function renderTodos() {
  const order = { alta: 0, normale: 1, bassa: 2 };
  const dueKey = (t) => (t.due || '9999') + 'T' + (t.time || '99:99');
  const sorted = [...todos].sort((a, b) =>
    (a.done - b.done) || (order[a.priority] - order[b.priority]) ||
    dueKey(a).localeCompare(dueKey(b)));

  const todayISO = toISO(today);
  $('#todo-list').innerHTML = sorted.map((t) => {
    const overdue = isOverdue(t, todayISO);
    let dueLabel = t.due
      ? (t.due === todayISO ? 'Oggi' : new Date(t.due + 'T12:00').toLocaleDateString('it-IT', { day: 'numeric', month: 'short' }))
      : '';
    if (t.time) dueLabel += `${dueLabel ? ' · ' : ''}ore ${t.time}`;
    const prio = t.priority === 'alta' ? `<i class="fa-solid fa-flag prio-alta" aria-hidden="true" title="Priorità alta"></i>`
      : t.priority === 'bassa' ? `<i class="fa-solid fa-flag prio-bassa" aria-hidden="true" title="Priorità bassa"></i>` : '';
    return `<li class="${t.done ? 'done' : ''} ${overdue ? 'overdue' : ''}" data-id="${t.id}">
      <input type="checkbox" ${t.done ? 'checked' : ''} aria-label="Segna come completata: ${escapeHtml(t.text)}">
      <div class="grow">${prio} ${escapeHtml(t.text)}
        ${dueLabel ? `<div class="meta">${fa('fa-calendar-days')} ${dueLabel}${overdue ? ' · in ritardo!' : ''}</div>` : ''}
      </div>
      <button class="del" aria-label="Elimina: ${escapeHtml(t.text)}"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>
    </li>`;
  }).join('');

  const open = todos.filter((t) => !t.done).length;
  $('#todo-counter').textContent = todos.length ? `${open} da fare` : '';
  $('#todo-empty').classList.toggle('hidden', todos.length > 0);
  renderSummary();
}

$('#todo-list').addEventListener('click', (e) => {
  const li = e.target.closest('li');
  if (!li) return;
  const id = +li.dataset.id;
  if (e.target.matches('input[type="checkbox"]')) {
    const t = todos.find((t) => t.id === id);
    t.done = e.target.checked;
  } else if (e.target.matches('.del')) {
    todos = todos.filter((t) => t.id !== id);
  } else return;
  store.set('todos', todos);
  renderTodos();
});

// ---------- Lista della spesa ----------
let shopping = store.get('shopping', []);
// Storico degli acquisti per i suggerimenti: { "latte": { name: "Latte", count: 3, last: ts } }
let shoppingHistory = store.get('shoppingHistory', {});

function recordPurchase(text, delta) {
  const key = text.trim().toLowerCase();
  if (!key) return;
  const entry = shoppingHistory[key] || { name: text.trim(), count: 0, last: 0 };
  entry.count = Math.max(0, entry.count + delta);
  entry.last = Date.now();
  if (entry.count === 0) delete shoppingHistory[key];
  else shoppingHistory[key] = entry;
  store.set('shoppingHistory', shoppingHistory);
}

function renderSuggestions() {
  const inList = new Set(shopping.map((s) => s.text.trim().toLowerCase()));
  const top = Object.values(shoppingHistory)
    .filter((h) => !inList.has(h.name.toLowerCase()))
    .sort((a, b) => (b.count - a.count) || (b.last - a.last))
    .slice(0, 6);

  const box = $('#shopping-suggestions');
  box.classList.toggle('hidden', top.length === 0);
  box.querySelectorAll('.chip').forEach((c) => c.remove());
  top.forEach((h) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chip';
    btn.textContent = `+ ${h.name}`;
    btn.setAttribute('aria-label', `Aggiungi alla lista: ${h.name}`);
    btn.addEventListener('click', () => {
      shopping.push({ id: Date.now(), text: h.name, taken: false });
      store.set('shopping', shopping);
      renderShopping();
    });
    box.appendChild(btn);
  });
}

$('#shopping-form').addEventListener('submit', (e) => {
  e.preventDefault();
  shopping.push({ id: Date.now(), text: $('#shopping-text').value.trim(), taken: false });
  store.set('shopping', shopping);
  e.target.reset();
  renderShopping();
});

function renderShopping() {
  // Gli articoli già presi scendono in fondo alla lista; l'ordine manuale
  // (trascinamento o frecce) è l'ordine dell'array, che il sort stabile conserva.
  const sorted = [...shopping].sort((a, b) => a.taken - b.taken);
  $('#shopping-list').innerHTML = sorted.map((s) => `
    <li class="${s.taken ? 'done' : ''}" data-id="${s.id}">
      ${s.taken ? '' : `<button type="button" class="handle" aria-label="Riordina: ${escapeHtml(s.text)}. Trascina, o usa le frecce su e giù"><i class="fa-solid fa-grip-vertical" aria-hidden="true"></i></button>`}
      <input type="checkbox" ${s.taken ? 'checked' : ''} aria-label="Segna come preso: ${escapeHtml(s.text)}">
      <div class="grow">${escapeHtml(s.text)}</div>
      <button class="del" aria-label="Elimina: ${escapeHtml(s.text)}"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>
    </li>`).join('');

  const toBuy = shopping.filter((s) => !s.taken).length;
  $('#shopping-counter').textContent = shopping.length
    ? (toBuy ? `${toBuy} da comprare` : 'Tutto preso!') : '';
  $('#shopping-empty').classList.toggle('hidden', shopping.length > 0);
  $('#shopping-clear').classList.toggle('hidden', !shopping.some((s) => s.taken));
  renderSuggestions();
}

$('#shopping-list').addEventListener('click', (e) => {
  const li = e.target.closest('li');
  if (!li) return;
  const id = +li.dataset.id;
  if (e.target.matches('input[type="checkbox"]')) {
    const item = shopping.find((s) => s.id === id);
    item.taken = e.target.checked;
    // Lo storico conta ogni articolo una sola volta, e si corregge se togli la spunta.
    if (item.taken && !item.counted) { recordPurchase(item.text, +1); item.counted = true; }
    else if (!item.taken && item.counted) { recordPurchase(item.text, -1); item.counted = false; }
  } else if (e.target.matches('.del')) {
    shopping = shopping.filter((s) => s.id !== id);
  } else return;
  store.set('shopping', shopping);
  renderShopping();
});

$('#shopping-clear').addEventListener('click', () => {
  shopping = shopping.filter((s) => !s.taken);
  store.set('shopping', shopping);
  renderShopping();
});

// --- Riordino della lista della spesa ---
// Dal "manico" si trascina (Pointer Events: funziona anche su touch) oppure,
// da tastiera, si sposta l'articolo con le frecce su e giù.

// Salva l'ordine visivo corrente come ordine dell'array.
function applyShoppingOrder() {
  const order = [...$('#shopping-list').querySelectorAll('li')].map((li) => +li.dataset.id);
  shopping.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  store.set('shopping', shopping);
  renderShopping();
}

let dragging = null;

$('#shopping-list').addEventListener('pointerdown', (e) => {
  const handle = e.target.closest('.handle');
  if (!handle) return;
  e.preventDefault();
  dragging = handle.closest('li');
  dragging.classList.add('dragging');
  handle.setPointerCapture(e.pointerId);
});

$('#shopping-list').addEventListener('pointermove', (e) => {
  if (!dragging) return;
  // L'elemento trascinato si inserisce prima del primo articolo non preso
  // il cui centro è sotto il puntatore.
  const list = $('#shopping-list');
  const target = [...list.querySelectorAll('li:not(.dragging):not(.done)')]
    .find((li) => e.clientY < li.getBoundingClientRect().top + li.offsetHeight / 2);
  if (target) list.insertBefore(dragging, target);
  else {
    const firstDone = list.querySelector('li.done');
    firstDone ? list.insertBefore(dragging, firstDone) : list.appendChild(dragging);
  }
});

const endDrag = () => {
  if (!dragging) return;
  dragging.classList.remove('dragging');
  dragging = null;
  applyShoppingOrder();
};
$('#shopping-list').addEventListener('pointerup', endDrag);
$('#shopping-list').addEventListener('pointercancel', endDrag);

$('#shopping-list').addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
  const handle = e.target.closest('.handle');
  if (!handle) return;
  e.preventDefault();
  const li = handle.closest('li');
  const sibling = e.key === 'ArrowUp' ? li.previousElementSibling : li.nextElementSibling;
  if (!sibling || sibling.classList.contains('done')) return;
  li.parentNode.insertBefore(li, e.key === 'ArrowUp' ? sibling : sibling.nextElementSibling);
  applyShoppingOrder();
  // Il render ricrea gli elementi: il focus torna sul manico dell'articolo spostato.
  $(`#shopping-list li[data-id="${li.dataset.id}"] .handle`)?.focus();
});

// ---------- Treni in tempo reale (ViaggiaTreno via proxy locale) ----------
let stations = store.get('stations', []);
let board = { station: null, type: 'partenze' };

$('#station-form').addEventListener('submit', (e) => e.preventDefault());

let stationTimer;
$('#station-input').addEventListener('input', (e) => {
  clearTimeout(stationTimer);
  const q = e.target.value.trim();
  if (q.length < 2) { $('#station-results').innerHTML = ''; return; }
  stationTimer = setTimeout(() => searchStation(q), 350);
});

async function searchStation(q) {
  try {
    const res = await fetch(`/api/stations?q=${encodeURIComponent(q)}`);
    const results = await res.json();
    $('#station-results').innerHTML = results.map((s, i) =>
      `<li><button type="button" class="result" data-i="${i}">${fa('fa-train')} ${escapeHtml(s.name)}</button></li>`).join('')
      || '<li class="muted">Nessuna stazione trovata</li>';
    $('#station-results').querySelectorAll('button[data-i]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const s = results[btn.dataset.i];
        if (!stations.some((x) => x.code === s.code)) {
          stations.push(s);
          store.set('stations', stations);
        }
        $('#station-input').value = '';
        $('#station-results').innerHTML = '';
        renderStations();
        openBoard(s);
      });
    });
  } catch (err) { console.error('Stazioni:', err); }
}

function renderStations() {
  $('#station-list').innerHTML = stations.map((s) => `
    <li data-code="${s.code}" class="${board.station?.code === s.code ? 'active-station' : ''}">
      <button type="button" class="grow station-name result">${fa('fa-train')} ${escapeHtml(s.name)}</button>
      <button class="del" aria-label="Rimuovi stazione: ${escapeHtml(s.name)}"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>
    </li>`).join('');
  $('#station-empty').classList.toggle('hidden', stations.length > 0);
}

$('#station-list').addEventListener('click', (e) => {
  const li = e.target.closest('li');
  if (!li) return;
  const code = li.dataset.code;
  if (e.target.matches('.del')) {
    stations = stations.filter((s) => s.code !== code);
    store.set('stations', stations);
    if (board.station?.code === code) {
      board.station = null;
      $('#board').classList.add('hidden');
    }
    renderStations();
  } else {
    openBoard(stations.find((s) => s.code === code));
  }
});

function openBoard(station) {
  board.station = station;
  renderStations();
  loadBoard();
}

$('#tab-partenze').addEventListener('click', () => { board.type = 'partenze'; loadBoard(); });
$('#tab-arrivi').addEventListener('click', () => { board.type = 'arrivi'; loadBoard(); });
$('#board-refresh').addEventListener('click', () => loadBoard());

// silent = aggiornamento automatico: niente "Caricamento…" e, se la rete
// fallisce, il tabellone precedente resta visibile.
async function loadBoard(silent = false) {
  if (!board.station) return;
  $('#board').classList.remove('hidden');
  $('#board-title').textContent = board.station.name;
  $('#tab-partenze').classList.toggle('active', board.type === 'partenze');
  $('#tab-arrivi').classList.toggle('active', board.type === 'arrivi');
  $('#tab-partenze').setAttribute('aria-pressed', board.type === 'partenze');
  $('#tab-arrivi').setAttribute('aria-pressed', board.type === 'arrivi');
  if (!silent) $('#board-content').innerHTML = '<p class="muted">Caricamento tabellone…</p>';
  try {
    const res = await fetch(`/api/board?station=${board.station.code}&type=${board.type}`);
    if (!res.ok) throw new Error((await res.json()).error || `HTTP ${res.status}`);
    const trains = await res.json();
    renderBoard(trains);
  } catch (err) {
    if (silent) return;
    $('#board-content').innerHTML =
      `<p class="muted"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i> Tabellone non disponibile: ${escapeHtml(err.message)}</p>`;
  }
}

function renderBoard(trains) {
  if (!trains.length) {
    $('#board-content').innerHTML =
      `<p class="muted">Nessun treno in ${board.type === 'partenze' ? 'partenza' : 'arrivo'} a breve.</p>`;
    return;
  }
  const dirLabel = board.type === 'partenze' ? 'Per' : 'Da';
  $('#board-content').innerHTML = `<table class="board-table">
    <thead><tr><th>Orario</th><th>Treno</th><th>${dirLabel}</th><th>Ritardo</th><th>Bin.</th></tr></thead>
    <tbody>${trains.map((t) => {
      const delay = t.ritardo > 0
        ? `<span class="late">+${t.ritardo} min</span>`
        : (t.circolante ? '<span class="ontime">In orario</span>' : '<span class="muted">—</span>');
      const bin = t.binarioEffettivo
        ? `<strong>${escapeHtml(t.binarioEffettivo)}</strong>`
        : escapeHtml(t.binarioProgrammato || '—');
      return `<tr>
        <td>${escapeHtml(t.orario || '—')}</td>
        <td>${escapeHtml(t.treno)}</td>
        <td>${escapeHtml(t.destinazione || '—')}</td>
        <td>${delay}</td>
        <td>${bin}</td>
      </tr>`;
    }).join('')}</tbody>
  </table>
  <p class="muted board-updated">Aggiornato alle ${new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}</p>`;
}

// ---------- Segui un treno per numero ----------
let currentTrain = null;
// Ultimo stato noto del treno seguito, per l'avviso ritardo nel riepilogo.
let trainStatus = null;

$('#train-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const q = $('#train-number').value.trim();
  if (!/^\d{1,6}$/.test(q)) {
    $('#train-results').innerHTML = '<li class="muted">Inserisci il numero del treno (solo cifre).</li>';
    return;
  }
  $('#train-results').innerHTML = '<li class="muted">Ricerca in corso…</li>';
  try {
    const res = await fetch(`/api/train?q=${q}`);
    const matches = await res.json();
    if (!matches.length) {
      $('#train-results').innerHTML = '<li class="muted">Nessun treno trovato con questo numero oggi.</li>';
      return;
    }
    if (matches.length === 1) {
      $('#train-results').innerHTML = '';
      openTrain(matches[0]);
      return;
    }
    // Più treni con lo stesso numero (origini diverse): fai scegliere.
    $('#train-results').innerHTML = matches.map((m, i) =>
      `<li><button type="button" class="result" data-i="${i}">${fa('fa-train')} ${escapeHtml(m.label)}</button></li>`).join('');
    $('#train-results').querySelectorAll('button[data-i]').forEach((btn) => {
      btn.addEventListener('click', () => {
        $('#train-results').innerHTML = '';
        openTrain(matches[btn.dataset.i]);
      });
    });
  } catch (err) {
    $('#train-results').innerHTML = '<li class="muted"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i> Ricerca non disponibile. Riprova.</li>';
    console.error('Treno:', err);
  }
});

function openTrain(match) {
  currentTrain = match;
  $('#train-number').value = '';
  loadTrain();
}

$('#train-refresh').addEventListener('click', () => loadTrain());
$('#train-close').addEventListener('click', () => {
  currentTrain = null;
  trainStatus = null;
  $('#train-panel').classList.add('hidden');
  renderSummary();
});

// silent = aggiornamento automatico: niente "Caricamento…" e, se la rete
// fallisce, il percorso precedente resta visibile.
async function loadTrain(silent = false) {
  if (!currentTrain) return;
  $('#train-panel').classList.remove('hidden');
  if (!silent) {
    $('#train-title').textContent = currentTrain.label;
    $('#train-subtitle').textContent = '';
    $('#train-content').innerHTML = '<p class="muted">Caricamento percorso…</p>';
  }
  try {
    const res = await fetch(`/api/train-status?origin=${currentTrain.originCode}` +
      `&number=${currentTrain.number}&date=${currentTrain.departureMs}`);
    if (!res.ok) throw new Error((await res.json()).error || `HTTP ${res.status}`);
    renderTrain(await res.json());
  } catch (err) {
    if (silent) return;
    $('#train-content').innerHTML =
      `<p class="muted"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i> Stato del treno non disponibile: ${escapeHtml(err.message)}</p>`;
  }
}

function renderTrain(t) {
  trainStatus = { treno: t.treno, destinazione: t.destinazione, ritardo: t.ritardo };
  $('#train-title').textContent = `${t.treno} · ${t.origine} → ${t.destinazione}`;
  const delayBadge = t.ritardo > 0
    ? `<span class="late">in ritardo di ${t.ritardo} min</span>`
    : '<span class="ontime">in orario</span>';
  $('#train-subtitle').innerHTML =
    `${delayBadge}${t.ultimoRilevamento ? ` · ultimo rilevamento: ${escapeHtml(t.ultimoRilevamento)}` : ''}`;

  // L'ultima fermata "passata" è quella raggiunta più di recente.
  const lastDone = t.fermate.map((f) => f.passata).lastIndexOf(true);
  $('#train-content').innerHTML = `<ol class="stops">${t.fermate.map((f, i) => {
    const state = f.soppressa ? 'skipped' : f.passata ? 'done' : 'todo';
    const current = i === lastDone;
    const sched = f.partenzaProgrammata || f.arrivoProgrammato;
    const real = f.partenzaEffettiva || f.arrivoEffettivo;
    const time = real && sched && real !== sched
      ? `<s class="muted">${sched}</s> <strong>${real}</strong>`
      : `${real || sched || '—'}`;
    const delay = f.passata && f.ritardo > 0 ? ` <span class="late">+${f.ritardo}'</span>` : '';
    return `<li class="stop ${state} ${current ? 'current' : ''}">
      <span class="dot" aria-hidden="true"></span>
      <span class="grow">${escapeHtml(f.stazione)}${f.soppressa ? ' <span class="late">(soppressa)</span>' : ''}</span>
      <span class="stop-time">${time}${delay}</span>
    </li>`;
  }).join('')}</ol>
  <p class="muted board-updated">Aggiornato alle ${new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}</p>`;
  renderSummary();
}

// ---------- Riepilogo intelligente ----------
function renderSummary() {
  const lines = [];
  const todayISO = toISO(today);

  if (todayRainProb !== null && todayRainProb >= 50) {
    lines.push(`<i class="fa-solid fa-umbrella wi-rain" aria-hidden="true"></i> Probabilità di pioggia al ${todayRainProb}% oggi: prendi l'ombrello!`);
  }
  const dueToday = todos.filter((t) => !t.done && t.due === todayISO && !isOverdue(t, todayISO));
  if (dueToday.length) {
    const first = dueToday[0];
    lines.push(`<i class="fa-solid fa-clock" aria-hidden="true"></i> ${dueToday.length === 1
      ? `Scade oggi${first.time ? ` alle ${first.time}` : ''}: «${escapeHtml(first.text)}»`
      : `Hai ${dueToday.length} attività in scadenza oggi`}`);
  }
  const overdue = todos.filter((t) => isOverdue(t, todayISO)).length;
  if (overdue) lines.push(`<i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i> ${overdue} attività in ritardo`);

  // Stato del treno seguito, sempre visibile finché il pannello è aperto.
  if (trainStatus) {
    const r = trainStatus.ritardo;
    const state = r > 0 ? `<span class="late">viaggia con ${r} min di ritardo</span>`
      : r < 0 ? `<span class="ontime">viaggia in anticipo di ${-r} min</span>`
      : '<span class="ontime">è in orario</span>';
    lines.push(`${fa('fa-train')} Il treno ${escapeHtml(trainStatus.treno)} per ${escapeHtml(trainStatus.destinazione)} ${state}`);
  }

  $('#smart-summary').classList.toggle('hidden', lines.length === 0);
  $('#summary-content').innerHTML = lines.map((l) => `<span>${l}</span>`).join('');
}

// ---------- Utility ----------
function toISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

// ---------- Notizie (feed RSS ANSA via proxy locale) ----------
let newsFeed = store.get('newsFeed', 'top');

document.querySelectorAll('.news-tabs [data-feed]').forEach((btn) => {
  btn.addEventListener('click', () => {
    newsFeed = btn.dataset.feed;
    store.set('newsFeed', newsFeed);
    loadNews();
  });
});
$('#news-refresh').addEventListener('click', () => loadNews());

// "2 h fa", "35 min fa", oppure la data se è roba di ieri o prima.
function timeAgo(d) {
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (!Number.isFinite(mins) || mins < 0) return '';
  if (mins < 1) return 'adesso';
  if (mins < 60) return `${mins} min fa`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h} h fa`;
  return d.toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });
}

// silent = aggiornamento automatico, come per i treni.
async function loadNews(silent = false) {
  document.querySelectorAll('.news-tabs [data-feed]').forEach((btn) => {
    const active = btn.dataset.feed === newsFeed;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', active);
  });
  if (!silent) $('#news-content').innerHTML = '<p class="muted">Caricamento notizie…</p>';
  try {
    const res = await fetch(`/api/news?feed=${newsFeed}`);
    if (!res.ok) throw new Error((await res.json()).error || `HTTP ${res.status}`);
    renderNews(await res.json());
  } catch (err) {
    if (silent) return;
    $('#news-content').innerHTML =
      '<p class="muted"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i> Notizie non disponibili (sei offline?). Riprova più tardi.</p>';
    console.error('Notizie:', err);
  }
}

function renderNews(items) {
  if (!items.length) {
    $('#news-content').innerHTML = '<p class="muted">Nessuna notizia nel feed.</p>';
    return;
  }
  $('#news-content').innerHTML = `<ul class="news-list">${items.map((n) => {
    const when = n.date ? timeAgo(new Date(n.date)) : '';
    return `<li>
      <a href="${escapeHtml(n.link)}" target="_blank" rel="noopener">
        <span class="news-title">${escapeHtml(n.title)}</span>
        ${n.desc ? `<span class="news-desc">${escapeHtml(n.desc)}</span>` : ''}
        ${when ? `<span class="news-meta">${fa('fa-clock')} ${when}</span>` : ''}
      </a>
    </li>`;
  }).join('')}</ul>
  <p class="muted board-updated">Aggiornato alle ${new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}</p>`;
}

// Le notizie si rinfrescano da sole ogni 10 minuti, solo a scheda visibile.
setInterval(() => { if (!document.hidden) loadNews(true); }, 600_000);

// ---------- Notifiche per le scadenze ----------
// Promemoria locali con la Notification API: 15 minuti prima e all'ora della
// scadenza. Funzionano finché l'app è aperta (anche installata come PWA);
// senza un server push non è possibile l'invio da remoto.
let notifyEnabled = store.get('notifyEnabled', false);
// Notifiche già mostrate, per non ripeterle: { "<id>-pre"|"<id>-due": timestamp }
let notified = store.get('notified', {});

function updateNotifUI() {
  const btn = $('#btn-notifications');
  const status = $('#notif-status');
  if (!('Notification' in window)) {
    btn.disabled = true;
    status.textContent = 'Notifiche non supportate da questo browser.';
    return;
  }
  if (Notification.permission === 'denied') {
    btn.disabled = true;
    status.textContent = 'Notifiche bloccate: riattivale dalle impostazioni del browser.';
    return;
  }
  const active = notifyEnabled && Notification.permission === 'granted';
  btn.textContent = active ? 'Disattiva notifiche' : 'Attiva notifiche';
  btn.setAttribute('aria-pressed', active);
  status.textContent = active
    ? "Riceverai un promemoria 15 minuti prima e all'ora della scadenza, ad app aperta."
    : 'Promemoria disattivati.';
}

$('#btn-notifications').addEventListener('click', async () => {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'default') {
    notifyEnabled = (await Notification.requestPermission()) === 'granted';
  } else if (Notification.permission === 'granted') {
    notifyEnabled = !notifyEnabled;
  }
  store.set('notifyEnabled', notifyEnabled);
  updateNotifUI();
  if (notifyEnabled) checkDeadlines();
});

async function showDeadlineNotification(title, body, tag) {
  try {
    const reg = await navigator.serviceWorker.ready;
    await reg.showNotification(title, { body, tag, icon: 'icon.svg' });
  } catch (err) { console.warn('Notifica:', err); }
}

function checkDeadlines() {
  if (!notifyEnabled || !('Notification' in window) || Notification.permission !== 'granted') return;
  const now = new Date();
  const todayISO = toISO(now);
  const nowMins = now.getHours() * 60 + now.getMinutes();

  // Dimentica le notifiche di attività eliminate o completate.
  const activeIds = new Set(todos.filter((t) => !t.done).map((t) => t.id));
  Object.keys(notified).forEach((k) => {
    if (!activeIds.has(+k.split('-')[0])) delete notified[k];
  });

  todos.filter((t) => !t.done && t.due === todayISO && t.time).forEach((t) => {
    const [h, m] = t.time.split(':').map(Number);
    const diff = h * 60 + m - nowMins;
    if (diff > 0 && diff <= 15 && !notified[`${t.id}-pre`]) {
      notified[`${t.id}-pre`] = Date.now();
      showDeadlineNotification(`Scadenza tra ${diff} min`, `${t.text} (ore ${t.time})`, `todo-${t.id}-pre`);
    } else if (diff <= 0 && diff > -60 && !notified[`${t.id}-due`]) {
      // Oltre un'ora dopo la scadenza la notifica non parte più: a quel punto
      // ci pensa già il riepilogo "in ritardo".
      notified[`${t.id}-due`] = Date.now();
      showDeadlineNotification('Scade ora', `${t.text} (ore ${t.time})`, `todo-${t.id}-due`);
    }
  });
  store.set('notified', notified);
}

setInterval(checkDeadlines, 30_000);

// ---------- Auto-refresh treni ----------
// Tabellone e treno seguito si aggiornano da soli ogni minuto, ma solo con la
// scheda in primo piano; al ritorno dal background l'aggiornamento è immediato.
const REFRESH_MS = 60_000;

function refreshTrains() {
  if (document.hidden) return;
  if (board.station) loadBoard(true);
  if (currentTrain) loadTrain(true);
}

setInterval(refreshTrains, REFRESH_MS);
document.addEventListener('visibilitychange', refreshTrains);

// ---------- Service worker ----------
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch((err) => console.warn('SW:', err));
}

// ---------- Avvio ----------
renderTodos();
renderShopping();
renderStations();
updateNotifUI();
checkDeadlines();
loadWeather();
loadNews();
