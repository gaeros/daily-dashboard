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
  loadAirQuality(); // indipendente: se fallisce non tocca il meteo
  const url = 'https://api.open-meteo.com/v1/forecast' +
    `?latitude=${city.latitude}&longitude=${city.longitude}` +
    '&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code' +
    '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,' +
    'sunrise,sunset,uv_index_max,precipitation_sum,wind_speed_10m_max' +
    '&hourly=temperature_2m,weather_code,precipitation_probability,wind_speed_10m' +
    '&timezone=auto&forecast_days=7';
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    renderWeather(data);
  } catch (err) {
    $('#weather-current').innerHTML =
      '<p class="muted"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i> Meteo non disponibile (sei offline?). Riprova più tardi.</p>';
    console.error('Meteo:', err);
  }
}

// ---------- Qualità dell'aria e pollini (Open-Meteo Air Quality) ----------
// Soglie dell'indice europeo (european_aqi): 0–20 buona … >100 pessima.
const AQI_LEVELS = [
  [20, 'Buona', 'aqi-good'],
  [40, 'Discreta', 'aqi-fair'],
  [60, 'Moderata', 'aqi-moderate'],
  [80, 'Scarsa', 'aqi-poor'],
  [100, 'Molto scarsa', 'aqi-vpoor'],
  [Infinity, 'Pessima', 'aqi-extreme'],
];
const POLLEN_LABELS = {
  grass_pollen: 'graminacee', birch_pollen: 'betulla', olive_pollen: 'olivo',
  ragweed_pollen: 'ambrosia', alder_pollen: 'ontano', mugwort_pollen: 'artemisia',
};
// grani/m³ → livello (soglie indicative comuni per i pollini).
function pollenLevel(v) {
  if (v >= 50) return 'alto';
  if (v >= 20) return 'medio';
  if (v >= 1) return 'basso';
  return null;
}

let airData = null;

async function loadAirQuality() {
  // forecast_days=7 per allinearsi al meteo; i pollini sono previsti solo per
  // i primi ~4 giorni (oltre, i valori sono null e li ignoriamo).
  const url = 'https://air-quality-api.open-meteo.com/v1/air-quality' +
    `?latitude=${city.latitude}&longitude=${city.longitude}` +
    '&current=european_aqi' +
    '&hourly=grass_pollen,birch_pollen,olive_pollen,ragweed_pollen,alder_pollen,mugwort_pollen' +
    '&timezone=auto&forecast_days=7';
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    airData = await res.json();
    renderAirQuality(airData);
    if (selectedDay !== null) renderWeatherDetail(selectedDay); // aggiorna il dettaglio aperto
  } catch (err) {
    airData = null;
    $('#air-quality').classList.add('hidden');
    applyTodayAirColor(); // niente dati aria: togli l'eventuale colore da "Oggi"
    console.error('Aria:', err);
  }
}

// Pollini previsti per una data (YYYY-MM-DD): picco giornaliero per tipo,
// solo quelli con livello apprezzabile, ordinati dal più alto.
function dayPollens(dateISO) {
  const h = airData && airData.hourly;
  if (!h || !h.time) return [];
  const idxs = [];
  h.time.forEach((t, i) => { if (t.startsWith(dateISO)) idxs.push(i); });
  if (!idxs.length) return [];
  const out = [];
  Object.keys(POLLEN_LABELS).forEach((k) => {
    if (!h[k]) return;
    let peak = -1;
    idxs.forEach((i) => { const v = h[k][i]; if (v != null && v > peak) peak = v; });
    const lvl = pollenLevel(peak);
    if (lvl) out.push({ name: POLLEN_LABELS[k], peak, level: lvl });
  });
  return out.sort((a, b) => b.peak - a.peak);
}

function renderAirQuality(data) {
  const aqi = data.current?.european_aqi;
  if (aqi == null) { $('#air-quality').classList.add('hidden'); return; }
  const [, label, cls] = AQI_LEVELS.find(([max]) => aqi <= max);

  // Polline più alto all'ora corrente (hourly parte da mezzanotte locale).
  const h = data.hourly;
  let top = null;
  if (h && h.time) {
    const i = Math.min(new Date().getHours(), h.time.length - 1);
    Object.keys(POLLEN_LABELS).forEach((k) => {
      const v = h[k] ? h[k][i] : null;
      if (v != null && (!top || v > top.v)) top = { k, v };
    });
  }
  const lvl = top ? pollenLevel(top.v) : null;

  const box = $('#air-quality');
  box.className = `air-quality ${cls}`;
  box.innerHTML = `${fa('fa-wind')} Aria: <strong>${label}</strong> <span class="muted">(indice ${Math.round(aqi)})</span>`
    + (lvl ? ` · ${fa('fa-seedling')} Pollini ${POLLEN_LABELS[top.k]}: <strong>${lvl}</strong>` : '');
  applyTodayAirColor();
}

// Colora il lato della casella "Oggi" col livello di qualità dell'aria corrente,
// così segue gli stessi colori della striscia aria (verde…rosso). Senza dati
// aria, nessuna classe: la casella usa il fallback muted definito nel CSS.
const AQI_CLASSES = AQI_LEVELS.map(([, , cls]) => cls);
function applyTodayAirColor() {
  const today = document.querySelector('.forecast .day.today');
  if (!today) return;
  today.classList.remove(...AQI_CLASSES);
  const aqi = airData && airData.current ? airData.current.european_aqi : null;
  if (aqi == null) return;
  today.classList.add(AQI_LEVELS.find(([max]) => aqi <= max)[2]);
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
    return `<button type="button" class="day${i === 0 ? ' today' : ''}" data-i="${i}" aria-expanded="false"
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

  applyTodayAirColor(); // se i dati aria sono già pronti, colora subito "Oggi"
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

  // Pollini previsti per questo giorno (se nella finestra di previsione ~4 giorni).
  const pollens = dayPollens(d.time[i]);
  const pollenRow = pollens.length
    ? `<div class="detail-pollens">${fa('fa-seedling')} Pollini: ${pollens
        .map((p) => `${p.name} <strong>${p.level}</strong>`).join(' · ')}</div>`
    : '';

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
    ${pollenRow}
    <div class="hours">${hours.join('')}</div>`;
  $('#weather-detail').classList.remove('hidden');
}

// ---------- Tema (auto / chiaro / scuro) ----------
// Allinea il colore della barra del browser (e dell'area di sistema della PWA)
// allo sfondo del tema effettivo, leggendo --bg dopo l'applicazione del tema.
function updateThemeColor() {
  const meta = $('#theme-color-meta');
  if (meta) meta.content = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
}

function applyTheme(theme) {
  if (theme === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', theme);
  document.querySelectorAll('.theme-btn').forEach((btn) => {
    const active = btn.dataset.theme === theme;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', active);
  });
  updateThemeColor();
}

const savedTheme = store.get('theme', 'auto');
applyTheme(savedTheme);

document.querySelectorAll('.theme-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const theme = btn.dataset.theme;
    store.set('theme', theme);
    applyTheme(theme);
  });
});

// In modalità auto il tema segue il sistema: se cambia mentre l'app è aperta,
// riapplichiamo per aggiornare anche il theme-color.
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (store.get('theme', 'auto') === 'auto') applyTheme('auto');
});

// ---------- Accessibilità: dimensione testo e alto contrasto ----------
function applyTextSize(size) {
  if (size === 'normal') document.documentElement.removeAttribute('data-textsize');
  else document.documentElement.setAttribute('data-textsize', size);
  document.querySelectorAll('.textsize-btn').forEach((btn) => {
    const active = btn.dataset.size === size;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', active);
  });
}
let textSize = store.get('textSize', 'normal');
applyTextSize(textSize);
document.querySelectorAll('.textsize-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    textSize = btn.dataset.size;
    store.set('textSize', textSize);
    applyTextSize(textSize);
  });
});

let highContrast = store.get('highContrast', false);
function applyContrast() {
  if (highContrast) document.documentElement.setAttribute('data-contrast', 'high');
  else document.documentElement.removeAttribute('data-contrast');
  const btn = $('#btn-contrast');
  btn.setAttribute('aria-pressed', highContrast);
  btn.innerHTML = `<i class="fa-solid fa-circle-half-stroke" aria-hidden="true"></i> ${highContrast ? 'Disattiva' : 'Attiva'} alto contrasto`;
}
applyContrast();
$('#btn-contrast').addEventListener('click', () => {
  highContrast = !highContrast;
  store.set('highContrast', highContrast);
  applyContrast();
});

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
  const geoError = $('#geo-error');
  if (!navigator.geolocation) {
    geoError.textContent = 'Geolocalizzazione non supportata da questo browser.';
    return;
  }
  geoError.textContent = '';
  navigator.geolocation.getCurrentPosition(
    (pos) => setCity({
      name: 'La mia posizione',
      latitude: +pos.coords.latitude.toFixed(3),
      longitude: +pos.coords.longitude.toFixed(3),
    }),
    () => { geoError.textContent = 'Impossibile ottenere la posizione. Verifica i permessi del browser.'; },
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

const REPEAT_LABELS = {
  daily: 'ogni giorno', weekdays: 'Lun–Ven', weekly: 'ogni settimana', monthly: 'ogni mese',
};

$('#todo-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const repeat = $('#todo-repeat').value;
  // Una ricorrenza ha bisogno di un giorno di partenza: se manca, parte da oggi.
  const due = $('#todo-date').value || (repeat !== 'none' ? toISO(today) : null);
  todos.push({
    id: Date.now(),
    text: $('#todo-text').value.trim(),
    due,
    time: $('#todo-time').value || null,
    priority: $('#todo-priority').value,
    repeat,
    done: false,
  });
  store.set('todos', todos);
  e.target.reset();
  renderTodos();
});

// Prossima data utile per un'attività ricorrente, mai nel passato.
function nextOccurrence(dateISO, repeat) {
  const d = new Date((dateISO || toISO(today)) + 'T12:00');
  const step = () => {
    if (repeat === 'weekly') d.setDate(d.getDate() + 7);
    else if (repeat === 'monthly') d.setMonth(d.getMonth() + 1);
    else if (repeat === 'weekdays') { do { d.setDate(d.getDate() + 1); } while (d.getDay() === 0 || d.getDay() === 6); }
    else d.setDate(d.getDate() + 1); // daily
  };
  step();
  let guard = 0;
  while (toISO(d) < toISO(today) && guard++ < 500) step();
  return toISO(d);
}

// Una scadenza è passata se la data è prima di oggi, oppure è oggi e l'ora è già trascorsa.
function isOverdue(t, todayISO) {
  if (!t.due || t.done) return false;
  if (t.due < todayISO) return true;
  if (t.due > todayISO) return false;
  return !!t.time && t.time < new Date().toTimeString().slice(0, 5);
}

// Filtro agenda: non persistito, si azzera al ricaricamento.
let todoFilterQ = '';
let todoFilterPrio = '';

$('#todo-search').addEventListener('input', (e) => {
  todoFilterQ = e.target.value.trim().toLowerCase();
  renderTodos();
});

document.querySelectorAll('.prio-filter').forEach((btn) => {
  btn.addEventListener('click', () => {
    todoFilterPrio = btn.dataset.prio;
    document.querySelectorAll('.prio-filter').forEach((b) => {
      const active = b.dataset.prio === todoFilterPrio;
      b.classList.toggle('active', active);
      b.setAttribute('aria-pressed', active);
    });
    renderTodos();
  });
});

function renderTodos() {
  // L'ordine è manuale (trascinamento o frecce): il sort stabile tiene
  // l'ordine dell'array e porta solo le completate in fondo.
  let sorted = [...todos].sort((a, b) => a.done - b.done);

  // Applica filtro testo e priorità (solo in vista lista).
  if (todoFilterQ) sorted = sorted.filter((t) => t.text.toLowerCase().includes(todoFilterQ));
  if (todoFilterPrio) sorted = sorted.filter((t) => (t.priority || 'normale') === todoFilterPrio);

  const isFiltered = todoFilterQ || todoFilterPrio;
  const todayISO = toISO(today);
  $('#todo-list').innerHTML = sorted.map((t) => {
    const overdue = isOverdue(t, todayISO);
    let dueLabel = t.due
      ? (t.due === todayISO ? 'Oggi' : new Date(t.due + 'T12:00').toLocaleDateString('it-IT', { day: 'numeric', month: 'short' }))
      : '';
    if (t.time) dueLabel += `${dueLabel ? ' · ' : ''}ore ${t.time}`;
    const rep = t.repeat && t.repeat !== 'none'
      ? ` · ${fa('fa-repeat')} ${REPEAT_LABELS[t.repeat] || ''}` : '';
    const prio = t.priority === 'alta' ? `<i class="fa-solid fa-flag prio-alta" aria-hidden="true" title="Priorità alta"></i>`
      : t.priority === 'bassa' ? `<i class="fa-solid fa-flag prio-bassa" aria-hidden="true" title="Priorità bassa"></i>` : '';
    return `<li class="${t.done ? 'done' : ''} ${overdue ? 'overdue' : ''}" data-id="${t.id}">
      ${t.done ? '' : `<button type="button" class="handle" aria-label="Riordina: ${escapeHtml(t.text)}. Trascina, o usa le frecce su e giù"><i class="fa-solid fa-grip-vertical" aria-hidden="true"></i></button>`}
      <input type="checkbox" ${t.done ? 'checked' : ''} aria-label="${t.repeat && t.repeat !== 'none' ? 'Completa questa occorrenza di' : 'Segna come completata'}: ${escapeHtml(t.text)}">
      <div class="grow">${prio} ${escapeHtml(t.text)}
        ${dueLabel || rep ? `<div class="meta">${fa('fa-calendar-days')} ${dueLabel}${rep}${overdue ? ' · in ritardo!' : ''}</div>` : ''}
      </div>
      <button class="del" aria-label="Elimina: ${escapeHtml(t.text)}"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>
    </li>`;
  }).join('');

  const open = todos.filter((t) => !t.done).length;
  $('#todo-counter').textContent = todos.length ? `${open} da fare` : '';
  // Messaggio "nessun risultato" quando il filtro è attivo ma non trova nulla.
  $('#todo-no-results').classList.toggle('hidden', !(isFiltered && !sorted.length));
  renderWeek();
  applyTodoView();
  renderSummary();
}

function setTodoDone(id, checked) {
  const t = todos.find((t) => t.id === id);
  if (!t) return;
  if (checked && t.repeat && t.repeat !== 'none') {
    // Completare un'attività ricorrente non la archivia: la sposta al ciclo dopo.
    t.due = nextOccurrence(t.due, t.repeat);
    t.done = false;
    delete notified[`${t.id}-pre`];
    delete notified[`${t.id}-due`];
    store.set('notified', notified);
  } else {
    t.done = checked;
  }
  store.set('todos', todos);
  renderTodos();
}

function deleteTodo(id) {
  todos = todos.filter((t) => t.id !== id);
  store.set('todos', todos);
  renderTodos();
}

// Click su lista e su calendario condividono la stessa logica.
function todoListClick(e) {
  const li = e.target.closest('li');
  if (!li) return;
  const id = +li.dataset.id;
  if (e.target.matches('input[type="checkbox"]')) setTodoDone(id, e.target.checked);
  else if (e.target.closest('.del')) deleteTodo(id);
  else if (e.target.closest('.edit-trigger')) openEditTodo(id);
}
$('#todo-list').addEventListener('click', todoListClick);
$('#todo-week').addEventListener('click', todoListClick);

// --- Modifica di un'attività (dalla vista settimana) ---
const editDialog = $('#edit-dialog');
let editingId = null;

function openEditTodo(id) {
  const t = todos.find((t) => t.id === id);
  if (!t) return;
  editingId = id;
  $('#edit-text').value = t.text;
  $('#edit-date').value = t.due || '';
  $('#edit-time').value = t.time || '';
  $('#edit-priority').value = t.priority || 'normale';
  $('#edit-repeat').value = t.repeat || 'none';
  editDialog.showModal();
}

$('#edit-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const t = todos.find((t) => t.id === editingId);
  if (!t) { editDialog.close(); return; }
  const repeat = $('#edit-repeat').value;
  t.text = $('#edit-text').value.trim();
  // Una ricorrenza ha bisogno di un giorno di partenza: se manca, parte da oggi.
  t.due = $('#edit-date').value || (repeat !== 'none' ? toISO(today) : null);
  t.time = $('#edit-time').value || null;
  t.priority = $('#edit-priority').value;
  t.repeat = repeat;
  store.set('todos', todos);
  editDialog.close();
  renderTodos();
});

$('#edit-cancel').addEventListener('click', () => editDialog.close());

// --- Riordino dell'agenda (solo vista lista): manico per trascinare, frecce su/giù ---
function applyTodoOrder() {
  const order = [...$('#todo-list').querySelectorAll('li')].map((li) => +li.dataset.id);
  todos.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  store.set('todos', todos);
  renderTodos();
}

let draggingTodo = null;

$('#todo-list').addEventListener('pointerdown', (e) => {
  const handle = e.target.closest('.handle');
  if (!handle) return;
  e.preventDefault();
  draggingTodo = handle.closest('li');
  draggingTodo.classList.add('dragging');
  handle.setPointerCapture(e.pointerId);
});

$('#todo-list').addEventListener('pointermove', (e) => {
  if (!draggingTodo) return;
  const list = $('#todo-list');
  const target = [...list.querySelectorAll('li:not(.dragging):not(.done)')]
    .find((li) => e.clientY < li.getBoundingClientRect().top + li.offsetHeight / 2);
  if (target) list.insertBefore(draggingTodo, target);
  else {
    const firstDone = list.querySelector('li.done');
    firstDone ? list.insertBefore(draggingTodo, firstDone) : list.appendChild(draggingTodo);
  }
});

const endDragTodo = () => {
  if (!draggingTodo) return;
  draggingTodo.classList.remove('dragging');
  draggingTodo = null;
  applyTodoOrder();
};
$('#todo-list').addEventListener('pointerup', endDragTodo);
$('#todo-list').addEventListener('pointercancel', endDragTodo);

$('#todo-list').addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
  const handle = e.target.closest('.handle');
  if (!handle) return;
  e.preventDefault();
  const li = handle.closest('li');
  const sibling = e.key === 'ArrowUp' ? li.previousElementSibling : li.nextElementSibling;
  if (!sibling || sibling.classList.contains('done')) return;
  li.parentNode.insertBefore(li, e.key === 'ArrowUp' ? sibling : sibling.nextElementSibling);
  applyTodoOrder();
  $(`#todo-list li[data-id="${li.dataset.id}"] .handle`)?.focus();
});

// ---------- Vista agenda: lista o calendario settimanale ----------
let todoView = store.get('todoView', 'list');

// Riapplica l'ordinamento automatico (scadenza + priorità) come ordine manuale.
$('#todo-sort').addEventListener('click', () => {
  const prioRank = { alta: 0, normale: 1, bassa: 2 };
  const dueKey = (t) => (t.due || '9999') + 'T' + (t.time || '99:99');
  todos.sort((a, b) =>
    (a.done - b.done) || (prioRank[a.priority] - prioRank[b.priority]) ||
    dueKey(a).localeCompare(dueKey(b)));
  store.set('todos', todos);
  renderTodos();
});

$('#todo-view-list').addEventListener('click', () => { todoView = 'list'; store.set('todoView', todoView); applyTodoView(); });
$('#todo-view-week').addEventListener('click', () => { todoView = 'week'; store.set('todoView', todoView); applyTodoView(); });

function applyTodoView() {
  const week = todoView === 'week';
  $('#todo-list').classList.toggle('hidden', week);
  $('#todo-week').classList.toggle('hidden', !week);
  $('#todo-view-list').classList.toggle('active', !week);
  $('#todo-view-week').classList.toggle('active', week);
  $('#todo-view-list').setAttribute('aria-pressed', !week);
  $('#todo-view-week').setAttribute('aria-pressed', week);
  // Il messaggio "nessuna attività" e il filtro hanno senso solo nella lista.
  $('#todo-empty').classList.toggle('hidden', week || todos.length > 0);
  $('#todo-sort').classList.toggle('hidden', week);
  // Mostra la barra filtro solo in vista lista e solo se ci sono attività.
  $('#todo-filter').classList.toggle('hidden', week || todos.length === 0);
}

function renderWeek() {
  const start = new Date(today); start.setHours(0, 0, 0, 0);
  const todayISO = toISO(today);
  const days = [];
  let lastISO = todayISO;
  for (let i = 0; i < 7; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    const iso = toISO(d);
    lastISO = iso;
    const items = todos.filter((t) => t.due === iso)
      .sort((a, b) => (a.done - b.done) || (a.time || '99:99').localeCompare(b.time || '99:99'));
    const name = i === 0 ? 'Oggi'
      : d.toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short' });
    days.push(`<div class="week-day ${i === 0 ? 'today' : ''}">
      <div class="week-day-head">${name}</div>
      ${items.length
        ? `<ul>${items.map((t) => {
            const overdue = isOverdue(t, todayISO);
            return `<li class="${t.done ? 'done' : ''} ${overdue ? 'overdue' : ''}" data-id="${t.id}">
              <input type="checkbox" ${t.done ? 'checked' : ''} aria-label="Completa: ${escapeHtml(t.text)}">
              <button type="button" class="grow edit-trigger" aria-label="Modifica: ${escapeHtml(t.text)}">${t.time ? `<strong>${t.time}</strong> ` : ''}${escapeHtml(t.text)}</button>
              <button class="del" aria-label="Elimina: ${escapeHtml(t.text)}"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>
            </li>`;
          }).join('')}</ul>`
        : '<p class="muted week-empty">—</p>'}
    </div>`);
  }
  const undated = todos.filter((t) => !t.done && !t.due).length;
  const beyond = todos.filter((t) => !t.done && t.due && t.due > lastISO).length;
  const notes = [];
  if (undated) notes.push(`${undated} senza data`);
  if (beyond) notes.push(`${beyond} oltre la settimana`);
  $('#todo-week').innerHTML = days.join('')
    + (notes.length ? `<p class="muted week-note">${fa('fa-circle-info')} ${notes.join(' · ')} (visibili nella lista)</p>` : '');
}

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
  } else if (e.target.closest('.del')) {
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

// ---------- Note rapide ----------
// Blocco appunti libero: si salva da solo in locale poco dopo che smetti di
// scrivere (non a ogni tasto). Rientra nel backup come le altre sezioni.
const notesEl = $('#notes-text');
notesEl.value = store.get('notes', '');

let notesTimer;
notesEl.addEventListener('input', () => {
  $('#notes-status').textContent = 'Sto salvando…';
  clearTimeout(notesTimer);
  notesTimer = setTimeout(() => {
    store.set('notes', notesEl.value);
    $('#notes-status').textContent = 'Salvato';
    setTimeout(() => { $('#notes-status').textContent = ''; }, 1500);
  }, 500);
});

// ---------- Treni in tempo reale (ViaggiaTreno via proxy locale) ----------
let stations = store.get('stations', []);
// Tabellone aperto: persistito così al reload si riapre da solo.
let board = store.get('board', { station: null, type: 'partenze' });
const saveBoard = () => store.set('board', board);

// --- Comprimi/espandi l'intero widget treni, come per le notizie ---
let trainsCollapsed = store.get('trainsCollapsed', false);

function applyTrainsCollapsed() {
  $('#trains-body').classList.toggle('hidden', trainsCollapsed);
  const btn = $('#trains-toggle');
  btn.setAttribute('aria-expanded', !trainsCollapsed);
  btn.setAttribute('aria-label', trainsCollapsed ? 'Espandi i treni' : 'Comprimi i treni');
  btn.innerHTML = `<i class="fa-solid fa-chevron-${trainsCollapsed ? 'down' : 'up'}" aria-hidden="true"></i>`;
}

$('#trains-toggle').addEventListener('click', () => {
  trainsCollapsed = !trainsCollapsed;
  store.set('trainsCollapsed', trainsCollapsed);
  applyTrainsCollapsed();
  if (!trainsCollapsed) refreshTrains(); // riaprendo, aggiorna subito i dati
});

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
  if (e.target.closest('.del')) {
    stations = stations.filter((s) => s.code !== code);
    store.set('stations', stations);
    if (board.station?.code === code) {
      board.station = null;
      saveBoard();
      $('#board').classList.add('hidden');
    }
    renderStations();
  } else {
    openBoard(stations.find((s) => s.code === code));
  }
});

function openBoard(station) {
  board.station = station;
  saveBoard();
  renderStations();
  loadBoard();
}

$('#tab-partenze').addEventListener('click', () => { board.type = 'partenze'; saveBoard(); loadBoard(); });
$('#tab-arrivi').addEventListener('click', () => { board.type = 'arrivi'; saveBoard(); loadBoard(); });
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
// Persistito così al reload il treno seguito si riapre da solo.
let currentTrain = store.get('currentTrain', null);
// Ultimo stato noto del treno seguito, per l'avviso ritardo nel riepilogo.
let trainStatus = null;
// Ritardo (min) per cui ho già notificato il treno seguito: evita di ripetere.
let trainDelayNotified = 0;

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
  store.set('currentTrain', currentTrain);
  trainDelayNotified = 0;
  $('#train-number').value = '';
  loadTrain();
}

$('#train-refresh').addEventListener('click', () => loadTrain());
$('#train-close').addEventListener('click', () => {
  currentTrain = null;
  store.set('currentTrain', null);
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
  maybeNotifyTrainDelay(t);
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

// Notifica quando il treno seguito accumula ritardo: la prima volta che supera
// i 5 minuti, poi di nuovo solo se cresce di altri 5 (niente raffica a ogni refresh).
function maybeNotifyTrainDelay(t) {
  if (!notifyEnabled || !('Notification' in window) || Notification.permission !== 'granted') return;
  const r = t.ritardo || 0;
  if (r >= 5 && r >= trainDelayNotified + 5) {
    trainDelayNotified = r;
    showAppNotification(`${t.treno} in ritardo`,
      `${r} min · ${t.origine} → ${t.destinazione}`, 'train-delay');
  } else if (r < 5) {
    trainDelayNotified = 0; // rientrato: pronto a riavvisare se torna in ritardo
  }
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
  renderMorning();
}

// ---------- Utility ----------
// Annuncia un messaggio agli screen reader tramite la live-region nascosta.
// Si azzera prima di riscrivere: alcuni lettori non ri-annunciano testo uguale.
function announce(msg) {
  const el = $('#sr-announce');
  if (!el) return;
  el.textContent = '';
  setTimeout(() => { el.textContent = msg; }, 30);
}

function toISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

// ---------- Tratte preferite (es. casa–lavoro) ----------
// Più tratte salvabili: ognuna mostra i suoi prossimi treni diretti.
let routes = store.get('routes', null);
if (!routes) {
  // Migrazione dalla singola tratta delle versioni precedenti.
  const old = store.get('route', null);
  routes = old ? [{ id: Date.now(), from: old.from, to: old.to }] : [];
  store.set('routes', routes);
  localStorage.removeItem('route');
}
let routeSolutions = {}; // { [routeId]: soluzioni }
let routeDraft = {};
// Momento da cui cercare i treni: null = adesso (e si aggiorna da solo). Vale per tutte.
let routeWhen = null;

// Autocomplete stazione riusabile: input → risultati → callback con la scelta.
function stationPicker(inputSel, resultsSel, onPick) {
  let timer;
  $(inputSel).addEventListener('input', (e) => {
    clearTimeout(timer);
    const q = e.target.value.trim();
    if (q.length < 2) { $(resultsSel).innerHTML = ''; return; }
    timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/stations?q=${encodeURIComponent(q)}`);
        const results = await res.json();
        $(resultsSel).innerHTML = results.map((s, i) =>
          `<li><button type="button" class="result" data-i="${i}">${fa('fa-train')} ${escapeHtml(s.name)}</button></li>`).join('')
          || '<li class="muted">Nessuna stazione trovata</li>';
        $(resultsSel).querySelectorAll('button[data-i]').forEach((btn) => {
          btn.addEventListener('click', () => {
            $(resultsSel).innerHTML = '';
            onPick(results[btn.dataset.i]);
          });
        });
      } catch (err) { console.error('Stazioni:', err); }
    }, 350);
  });
}

stationPicker('#route-from', '#route-from-results', (s) => { routeDraft.from = s; $('#route-from').value = s.name; });
stationPicker('#route-to', '#route-to-results', (s) => { routeDraft.to = s; $('#route-to').value = s.name; });

// "Aggiungi": registra una nuova tratta dalla coppia selezionata.
$('#route-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const { from, to } = routeDraft;
  if (!from || !to) {
    $('#route-hint').textContent = 'Scegli partenza e arrivo dai suggerimenti.';
    return;
  }
  if (from.code === to.code) {
    $('#route-hint').textContent = 'Le due stazioni devono essere diverse.';
    return;
  }
  if (routes.some((r) => r.from.code === from.code && r.to.code === to.code)) {
    $('#route-hint').textContent = 'Questa tratta è già salvata.';
    return;
  }
  const r = { id: Date.now(), from, to };
  routes.push(r);
  store.set('routes', routes);
  routeDraft = {};
  $('#route-from').value = '';
  $('#route-to').value = '';
  renderRoutes();
  loadRouteOne(r);
});

$('#route-when').addEventListener('submit', (e) => {
  e.preventDefault();
  const d = $('#route-date').value;
  const t = $('#route-time').value;
  if (!d && !t) { routeWhen = null; loadAllRoutes(); return; }
  const dt = new Date(`${d || toISO(new Date())}T${t || '00:00'}`);
  if (Number.isNaN(dt.getTime())) return;
  routeWhen = dt.getTime();
  loadAllRoutes();
});

$('#route-now').addEventListener('click', () => {
  routeWhen = null;
  $('#route-date').value = '';
  $('#route-time').value = '';
  loadAllRoutes();
});

// Azioni per-tratta (inverti / aggiorna / rimuovi), delegate sulla lista.
$('#route-list').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const id = +btn.closest('.route-item').dataset.id;
  const r = routes.find((x) => x.id === id);
  if (!r) return;
  if (btn.dataset.act === 'swap') {
    [r.from, r.to] = [r.to, r.from];
    store.set('routes', routes);
    renderRoutes();
    loadRouteOne(r);
  } else if (btn.dataset.act === 'refresh') {
    loadRouteOne(r);
  } else if (btn.dataset.act === 'remove') {
    routes = routes.filter((x) => x.id !== id);
    delete routeSolutions[id];
    store.set('routes', routes);
    renderRoutes();
    renderMorning();
  }
});

// --- Riordino delle tratte preferite: stesso schema di agenda e spesa ---
// Si trascina dal manico (Pointer Events: funziona anche su touch) oppure, da
// tastiera, si sposta la tratta con le frecce su e giù. Qui basta riordinare i
// blocchi (che contengono già i treni caricati) e salvare il nuovo ordine,
// senza un nuovo render che farebbe ripartire le richieste.
function applyRouteOrder() {
  const order = [...$('#route-list').querySelectorAll('.route-item')].map((el) => +el.dataset.id);
  routes.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  store.set('routes', routes);
}

let draggingRoute = null;

$('#route-list').addEventListener('pointerdown', (e) => {
  const handle = e.target.closest('.handle');
  if (!handle) return;
  e.preventDefault();
  draggingRoute = handle.closest('.route-item');
  draggingRoute.classList.add('dragging');
  handle.setPointerCapture(e.pointerId);
});

$('#route-list').addEventListener('pointermove', (e) => {
  if (!draggingRoute) return;
  const list = $('#route-list');
  const target = [...list.querySelectorAll('.route-item:not(.dragging)')]
    .find((el) => e.clientY < el.getBoundingClientRect().top + el.offsetHeight / 2);
  if (target) list.insertBefore(draggingRoute, target);
  else list.appendChild(draggingRoute);
});

const endDragRoute = () => {
  if (!draggingRoute) return;
  const moved = draggingRoute;
  moved.classList.remove('dragging');
  draggingRoute = null;
  applyRouteOrder();
  announceRouteMove(moved);
};
$('#route-list').addEventListener('pointerup', endDragRoute);
$('#route-list').addEventListener('pointercancel', endDragRoute);

// Annuncia agli screen reader la nuova posizione della tratta spostata.
function announceRouteMove(item) {
  const items = [...$('#route-list').querySelectorAll('.route-item')];
  const pos = items.indexOf(item) + 1;
  const title = item.querySelector('.route-title')?.textContent.trim() || 'Tratta';
  announce(`Tratta ${title} spostata in posizione ${pos} di ${items.length}`);
}

$('#route-list').addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
  const handle = e.target.closest('.handle');
  if (!handle) return;
  e.preventDefault();
  const item = handle.closest('.route-item');
  const sibling = e.key === 'ArrowUp' ? item.previousElementSibling : item.nextElementSibling;
  if (!sibling) return;
  item.parentNode.insertBefore(item, e.key === 'ArrowUp' ? sibling : sibling.nextElementSibling);
  applyRouteOrder();
  // Il focus segue la tratta spostata sul suo manico.
  $(`#route-list .route-item[data-id="${item.dataset.id}"] .handle`)?.focus();
  announceRouteMove(item);
});

// Costruisce i blocchi-tratta (vuoti), poi avvia il caricamento di ciascuno.
function renderRoutes() {
  $('#route-hint').classList.toggle('hidden', routes.length > 0);
  $('#route-when').classList.toggle('hidden', routes.length === 0);
  // Il manico di riordino compare solo se c'è più di una tratta da ordinare.
  const showHandle = routes.length > 1;
  $('#route-list').innerHTML = routes.map((r) => `
    <div class="route-item" data-id="${r.id}">
      <div class="board-header">
        <strong class="route-title">${showHandle
          ? `<button type="button" class="handle" aria-label="Riordina la tratta ${escapeHtml(r.from.name)} ${escapeHtml(r.to.name)}. Trascina, o usa le frecce su e giù"><i class="fa-solid fa-grip-vertical" aria-hidden="true"></i></button>`
          : ''}${escapeHtml(r.from.name)} → ${escapeHtml(r.to.name)}</strong>
        <div class="board-tabs">
          <button type="button" class="tab" data-act="swap" aria-label="Inverti la direzione"><i class="fa-solid fa-right-left" aria-hidden="true"></i></button>
          <button type="button" class="tab" data-act="refresh" aria-label="Aggiorna la tratta"><i class="fa-solid fa-rotate" aria-hidden="true"></i></button>
          <button type="button" class="tab" data-act="remove" aria-label="Rimuovi la tratta ${escapeHtml(r.from.name)} ${escapeHtml(r.to.name)}"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>
        </div>
      </div>
      <div class="route-item-content" id="route-content-${r.id}"><p class="muted">Cerco i prossimi treni diretti…</p></div>
    </div>`).join('');
}

function loadAllRoutes(silent = false) {
  routes.forEach((r) => loadRouteOne(r, silent));
}

// silent = aggiornamento automatico, come per tabellone e treno seguito.
async function loadRouteOne(r, silent = false) {
  const box = $(`#route-content-${r.id}`);
  if (!box) return;
  try {
    const res = await fetch(`/api/route?from=${r.from.code}&to=${r.to.code}`
      + `&toName=${encodeURIComponent(r.to.name)}`
      + (routeWhen ? `&date=${routeWhen}` : ''));
    if (!res.ok) throw new Error((await res.json()).error || `HTTP ${res.status}`);
    routeSolutions[r.id] = await res.json();
    renderRouteOne(r);
    renderMorning();
  } catch (err) {
    if (silent) return;
    box.innerHTML =
      `<p class="muted"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i> Tratta non disponibile: ${escapeHtml(err.message)}</p>`;
  }
}

function renderRouteOne(r) {
  const box = $(`#route-content-${r.id}`);
  if (!box) return;
  const sols = routeSolutions[r.id] || [];
  if (!sols.length) {
    const otherDay = routeWhen && toISO(new Date(routeWhen)) !== toISO(new Date());
    box.innerHTML = `<p class="muted">Nessun treno diretto trovato`
      + `${routeWhen ? ' nel periodo scelto' : ' in partenza a breve'} su questa tratta.`
      + `${otherDay ? '<br>Nota: per i giorni futuri ViaggiaTreno mostra solo i treni con capolinea nella stazione di arrivo; le fermate intermedie diventano consultabili il giorno stesso.' : ''}</p>`;
    return;
  }
  box.innerHTML = `<table class="board-table">
    <thead><tr><th>Parte</th><th>Arriva</th><th>Treno</th><th>Ritardo</th><th>Bin.</th></tr></thead>
    <tbody>${sols.map((s) => {
      const delay = s.programmato
        ? '<span class="muted">da orario</span>'
        : s.ritardo > 0
          ? `<span class="late">+${s.ritardo} min</span>`
          : (s.circolante ? '<span class="ontime">In orario</span>' : '<span class="muted">—</span>');
      return `<tr>
        <td><strong>${escapeHtml(s.partenza || '—')}</strong></td>
        <td>${escapeHtml(s.arrivo || '—')}</td>
        <td>${escapeHtml(s.treno)}</td>
        <td>${delay}</td>
        <td>${escapeHtml(s.binario || '—')}</td>
      </tr>`;
    }).join('')}</tbody>
  </table>
  <p class="muted board-updated">Solo treni diretti${routeWhen
    ? ` dalle ${new Date(routeWhen).toLocaleString('it-IT', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`
    : ''} · Aggiornato alle ${new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}</p>`;
}

// Un consiglio pratico in base al meteo di oggi: si sceglie la cosa più
// rilevante (prima la pioggia, poi il freddo/caldo percepito, poi UV e vento)
// così resta una riga sola. Usa i dati meteo già scaricati.
function weatherAdvice() {
  if (!weatherData) return null;
  const d = weatherData.daily;
  const c = weatherData.current;
  const rain = d.precipitation_probability_max[0] ?? 0;
  const tMax = d.temperature_2m_max[0];
  const uv = d.uv_index_max[0];
  const wind = d.wind_speed_10m_max[0];
  const feels = c ? c.apparent_temperature : null;

  if (rain >= 50) return `${fa('fa-umbrella wi-rain')} Pioggia probabile (${rain}%): porta l'ombrello.`;
  if (feels != null && feels <= 3) return `${fa('fa-temperature-low wi-snow')} Fa freddo, percepiti ${Math.round(feels)}°: copriti bene.`;
  if (tMax >= 30) return `${fa('fa-temperature-high wi-bolt')} Caldo intenso (fino a ${Math.round(tMax)}°): bevi spesso e cerca l'ombra.`;
  if (uv >= 6) return `${fa('fa-sun wi-sun')} UV alto (indice ${Math.round(uv)}): metti la crema solare.`;
  if (wind >= 40) return `${fa('fa-wind wi-cloud')} Vento forte (fino a ${Math.round(wind)} km/h): attenzione fuori.`;
  if (rain >= 30) return `${fa('fa-cloud-rain wi-rain')} Possibili rovesci (${rain}%): tieni l'ombrello a portata.`;
  return null;
}

// ---------- Riepilogo mattutino ----------
// Tra le 6 e le 10 l'app dà il buongiorno: meteo di oggi, primo impegno,
// primo treno della tratta preferita. Chiudibile per il resto della giornata.
function renderMorning(force = false) {
  const now = new Date();
  const inWindow = now.getHours() >= 6 && now.getHours() < 10;
  const dismissed = store.get('morningDismissed', '') === toISO(now);
  // Riaperto a mano dalle impostazioni: ignora finestra oraria e flag di chiusura.
  const show = force || (inWindow && !dismissed);
  $('#morning').classList.toggle('hidden', !show);
  if (!show) return;

  const lines = [];
  if (weatherData) {
    const d = weatherData.daily;
    const [icon, label] = wc(d.weather_code[0]);
    const rain = d.precipitation_probability_max[0];
    lines.push(`${icon} Oggi ${label.toLowerCase()}, ${Math.round(d.temperature_2m_min[0])}°–${Math.round(d.temperature_2m_max[0])}°`
      + (rain >= 20 ? ` · ${fa('fa-umbrella wi-rain')} pioggia ${rain}%` : ''));
  }
  const advice = weatherAdvice();
  if (advice) lines.push(advice);
  const todayISO = toISO(now);
  const first = todos
    .filter((t) => !t.done && t.due === todayISO)
    .sort((a, b) => (a.time || '99:99').localeCompare(b.time || '99:99'))[0];
  lines.push(first
    ? `${fa('fa-clock')} Primo impegno: «${escapeHtml(first.text)}»${first.time ? ` alle ${first.time}` : ''}`
    : `${fa('fa-circle-check')} Nessuna scadenza oggi, goditi la giornata!`);
  // Prima tratta preferita con un treno utile.
  const firstRoute = routes.find((r) => routeSolutions[r.id]?.length);
  if (firstRoute) {
    const s = routeSolutions[firstRoute.id][0];
    const delay = s.ritardo > 0 ? ` <span class="late">(+${s.ritardo} min)</span>` : '';
    lines.push(`${fa('fa-train')} Prossimo treno per ${escapeHtml(firstRoute.to.name)}: ${s.partenza}${delay}`);
  }
  $('#morning-content').innerHTML = lines.map((l) => `<span>${l}</span>`).join('');
}

$('#morning-close').addEventListener('click', () => {
  store.set('morningDismissed', toISO(new Date()));
  $('#morning').classList.add('hidden');
});

// Riapri a mano il riepilogo dalle impostazioni, a qualsiasi ora.
$('#btn-show-morning').addEventListener('click', () => {
  store.set('morningDismissed', '');
  renderMorning(true);
  settingsDialog.close();
  $('#morning').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
});

// ---------- Notizie (feed RSS via proxy locale) ----------
let newsFeed = store.get('newsFeed', 'top');
let newsSource = store.get('newsSource', 'ansa');
let newsCollapsed = store.get('newsCollapsed', true);
$('#news-source').value = newsSource;

function applyNewsCollapsed() {
  $('#news-body').classList.toggle('hidden', newsCollapsed);
  const btn = $('#news-toggle');
  btn.setAttribute('aria-expanded', !newsCollapsed);
  btn.setAttribute('aria-label', newsCollapsed ? 'Espandi le notizie' : 'Comprimi le notizie');
  btn.innerHTML = `<i class="fa-solid fa-chevron-${newsCollapsed ? 'down' : 'up'}" aria-hidden="true"></i>`;
}

$('#news-toggle').addEventListener('click', () => {
  newsCollapsed = !newsCollapsed;
  store.set('newsCollapsed', newsCollapsed);
  applyNewsCollapsed();
  // Riaprendo, carica se ancora vuoto o rinfresca in silenzio.
  if (!newsCollapsed) loadNews(!!$('#news-content .news-list'));
});

document.querySelectorAll('.news-tabs [data-feed]').forEach((btn) => {
  btn.addEventListener('click', () => {
    newsFeed = btn.dataset.feed;
    store.set('newsFeed', newsFeed);
    loadNews();
  });
});
$('#news-source').addEventListener('change', (e) => {
  newsSource = e.target.value;
  store.set('newsSource', newsSource);
  loadNews();
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
    const res = await fetch(`/api/news?source=${newsSource}&feed=${newsFeed}`);
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

// Le notizie si rinfrescano da sole ogni 10 minuti, solo a scheda visibile
// e con il widget aperto.
setInterval(() => { if (!document.hidden && !newsCollapsed) loadNews(true); }, 600_000);

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
    ? 'Riceverai un promemoria prima delle scadenze e se il treno seguito è in ritardo, ad app aperta.'
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

async function showAppNotification(title, body, tag) {
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
      showAppNotification(`Scadenza tra ${diff} min`, `${t.text} (ore ${t.time})`, `todo-${t.id}-pre`);
    } else if (diff <= 0 && diff > -60 && !notified[`${t.id}-due`]) {
      // Oltre un'ora dopo la scadenza la notifica non parte più: a quel punto
      // ci pensa già il riepilogo "in ritardo".
      notified[`${t.id}-due`] = Date.now();
      showAppNotification('Scade ora', `${t.text} (ore ${t.time})`, `todo-${t.id}-due`);
    }
  });
  store.set('notified', notified);
}

setInterval(checkDeadlines, 30_000);

// ---------- Backup: export / import dei dati ----------
// Tutto vive nel localStorage: questo è l'unico modo per non perderlo cambiando
// dispositivo o pulendo il browser. Si esportano i dati, non lo stato volatile.
const EXPORT_KEYS = ['todos', 'shopping', 'shoppingHistory', 'stations', 'routes', 'board', 'currentTrain', 'city', 'newsFeed', 'newsSource', 'newsCollapsed', 'trainsCollapsed', 'notifyEnabled', 'todoView', 'theme', 'textSize', 'highContrast', 'notes', 'widgetOrder'];

$('#btn-export').addEventListener('click', () => {
  const data = { app: 'daily-dashboard', version: 1, exported: new Date().toISOString() };
  EXPORT_KEYS.forEach((k) => {
    const v = localStorage.getItem(k);
    if (v !== null) { try { data[k] = JSON.parse(v); } catch { /* salta valori corrotti */ } }
  });
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `daily-dashboard-${toISO(new Date())}.json`;
  a.click();
  URL.revokeObjectURL(url);
  $('#backup-status').textContent = 'Dati esportati nel file scaricato.';
});

$('#btn-import').addEventListener('click', () => $('#import-file').click());

$('#import-file').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    let data;
    try { data = JSON.parse(reader.result); } catch { data = null; }
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      $('#backup-status').textContent = 'File non valido: non è un backup della dashboard.';
      e.target.value = '';
      return;
    }
    const keys = EXPORT_KEYS.filter((k) => k in data);
    if (!keys.length) {
      $('#backup-status').textContent = 'Nessun dato riconosciuto in questo file.';
      e.target.value = '';
      return;
    }
    if (!confirm(`Importare ${keys.length} sezioni? I dati attuali verranno sostituiti.`)) {
      e.target.value = '';
      return;
    }
    keys.forEach((k) => localStorage.setItem(k, JSON.stringify(data[k])));
    $('#backup-status').textContent = 'Importato! Ricarico l’app…';
    setTimeout(() => location.reload(), 700);
  };
  reader.readAsText(file);
});

// ---------- Auto-refresh treni ----------
// Tabellone e treno seguito si aggiornano da soli ogni minuto, ma solo con la
// scheda in primo piano; al ritorno dal background l'aggiornamento è immediato.
const REFRESH_MS = 60_000;

function refreshTrains() {
  if (document.hidden || trainsCollapsed) return; // niente richieste a widget chiuso
  if (board.station) loadBoard(true);
  if (currentTrain) loadTrain(true);
  if (routes.length) loadAllRoutes(true);
}

setInterval(refreshTrains, REFRESH_MS);
document.addEventListener('visibilitychange', refreshTrains);

// ---------- Service worker ----------
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch((err) => console.warn('SW:', err));
}

// ---------- Riordino dei widget ----------
// Le sezioni principali si riordinano trascinandole dal manico ⋮⋮
// nell'intestazione (Pointer Events: funziona anche su touch) oppure con le
// frecce su/giù da tastiera. L'ordine è salvato e rientra nel backup. I banner
// in cima (Buongiorno, riepilogo) non hanno data-widget e restano fissi.
const mainEl = document.querySelector('main');

// Salva l'ordine visivo corrente come elenco di chiavi widget.
function applyWidgetOrder() {
  const order = [...mainEl.querySelectorAll('section[data-widget]')].map((s) => s.dataset.widget);
  store.set('widgetOrder', order);
}

// All'avvio rimette i widget nell'ordine salvato, lasciando i banner dove sono.
function restoreWidgetOrder() {
  const order = store.get('widgetOrder', null);
  if (!Array.isArray(order)) return;
  order.forEach((key) => {
    const el = mainEl.querySelector(`section[data-widget="${key}"]`);
    if (el) mainEl.appendChild(el); // li riaccoda nell'ordine salvato
  });
}

let draggingWidget = null;

mainEl.addEventListener('pointerdown', (e) => {
  const handle = e.target.closest('.widget-handle');
  if (!handle) return;
  e.preventDefault();
  draggingWidget = handle.closest('section[data-widget]');
  draggingWidget.classList.add('dragging');
  handle.setPointerCapture(e.pointerId);
});

mainEl.addEventListener('pointermove', (e) => {
  if (!draggingWidget) return;
  // Si inserisce prima del primo widget il cui centro è sotto il puntatore.
  const target = [...mainEl.querySelectorAll('section[data-widget]:not(.dragging)')]
    .find((s) => e.clientY < s.getBoundingClientRect().top + s.offsetHeight / 2);
  if (target) mainEl.insertBefore(draggingWidget, target);
  else mainEl.appendChild(draggingWidget);
});

const endDragWidget = () => {
  if (!draggingWidget) return;
  const moved = draggingWidget;
  moved.classList.remove('dragging');
  draggingWidget = null;
  applyWidgetOrder();
  announceWidgetMove(moved);
};
mainEl.addEventListener('pointerup', endDragWidget);
mainEl.addEventListener('pointercancel', endDragWidget);

// Annuncia agli screen reader la nuova posizione del widget spostato.
function announceWidgetMove(section) {
  const items = [...mainEl.querySelectorAll('section[data-widget]')];
  const pos = items.indexOf(section) + 1;
  const title = section.querySelector('h2')?.textContent.trim() || 'Widget';
  announce(`${title} spostato in posizione ${pos} di ${items.length}`);
}

mainEl.addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
  const handle = e.target.closest('.widget-handle');
  if (!handle) return;
  e.preventDefault();
  const section = handle.closest('section[data-widget]');
  // Cerca il fratello precedente/successivo che sia anch'esso un widget
  // (così non si scavalca mai i banner in cima).
  let sib = e.key === 'ArrowUp' ? section.previousElementSibling : section.nextElementSibling;
  while (sib && !sib.matches('section[data-widget]')) {
    sib = e.key === 'ArrowUp' ? sib.previousElementSibling : sib.nextElementSibling;
  }
  if (!sib) return;
  mainEl.insertBefore(section, e.key === 'ArrowUp' ? sib : sib.nextElementSibling);
  applyWidgetOrder();
  // Il render non ricrea i widget: il focus resta sul manico spostato.
  section.querySelector('.widget-handle')?.focus();
  announceWidgetMove(section);
});

// ---------- Avvio ----------
restoreWidgetOrder();
renderTodos();
renderShopping();
renderStations();
renderRoutes();
applyTrainsCollapsed();
// A widget treni aperto, ripristina tratte, tabellone e treno seguito salvati.
// Se è chiuso, ci penserà refreshTrains() alla riapertura.
if (!trainsCollapsed) {
  loadAllRoutes();
  if (board.station) loadBoard();
  if (currentTrain) loadTrain();
}
updateNotifUI();
checkDeadlines();
loadWeather();
applyNewsCollapsed();
if (!newsCollapsed) loadNews();
