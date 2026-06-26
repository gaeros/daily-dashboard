// Server della Daily Dashboard: serve i file statici e fa da proxy
// verso le API ViaggiaTreno (che non espongono header CORS).
// Nessuna dipendenza: solo Node >= 18.
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8741;
const ROOT = __dirname;
const VT_BASE = 'http://www.viaggiatreno.it/infomobilita/resteasy/viaggiatreno';

// Feed RSS consentiti: whitelist chiusa per fonte e categoria. Il client
// sceglie solo le chiavi (source + feed), mai un URL arbitrario.
const NEWS_SOURCES = {
  ansa: {
    label: 'ANSA',
    feeds: {
      top: 'https://www.ansa.it/sito/notizie/topnews/topnews_rss.xml',
      mondo: 'https://www.ansa.it/sito/notizie/mondo/mondo_rss.xml',
      economia: 'https://www.ansa.it/sito/notizie/economia/economia_rss.xml',
      sport: 'https://www.ansa.it/sito/notizie/sport/sport_rss.xml',
      tecnologia: 'https://www.ansa.it/sito/notizie/tecnologia/tecnologia_rss.xml',
    },
  },
  repubblica: {
    label: 'la Repubblica',
    feeds: {
      top: 'https://www.repubblica.it/rss/homepage/rss2.0.xml',
      mondo: 'https://www.repubblica.it/rss/esteri/rss2.0.xml',
      economia: 'https://www.repubblica.it/rss/economia/rss2.0.xml',
      sport: 'https://www.repubblica.it/rss/sport/calcio/rss2.0.xml',
      tecnologia: 'https://www.repubblica.it/rss/tecnologia/rss2.0.xml',
    },
  },
  corriere: {
    label: 'Corriere della Sera',
    feeds: {
      top: 'https://xml2.corriereobjects.it/rss/homepage.xml',
      mondo: 'https://xml2.corriereobjects.it/rss/esteri.xml',
      economia: 'https://xml2.corriereobjects.it/rss/economia.xml',
      sport: 'https://xml2.corriereobjects.it/rss/sport.xml',
      tecnologia: 'https://xml2.corriereobjects.it/rss/tecnologia.xml',
    },
  },
};

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.md': 'text/markdown; charset=utf-8',
};

// ViaggiaTreno vuole la data nel formato di Date.prototype.toString()
const vtDate = (d = new Date()) => encodeURIComponent(d.toString());

// Versione della cache del service worker: calcolata dalle mtime dei file statici
// chiave, così si aggiorna automaticamente a ogni deploy senza toccare sw.js.
function computeCacheVersion() {
  const files = ['index.html', 'style.css', 'app.js', 'manifest.json', 'icon.svg', 'sw.js'];
  let stamp = 0;
  for (const f of files) {
    try { stamp += fs.statSync(path.join(ROOT, f)).mtimeMs; } catch {}
  }
  return stamp.toString(36);
}
const CACHE_VERSION = computeCacheVersion();

// ---- Cache breve delle risposte API ----
// Se più dispositivi guardano la stessa stazione o le stesse notizie,
// una sola richiesta raggiunge il servizio a monte.
const CACHE_TTL = {
  '/api/stations': 3600_000, // l'elenco stazioni non cambia
  '/api/board': 30_000,
  '/api/train': 30_000,
  '/api/train-status': 30_000,
  '/api/route': 120_000, // costosa: tabellone + percorso di ogni treno candidato
  '/api/news': 300_000,
};
const apiCache = new Map(); // chiave: pathname?query → { body, expires }

function cacheGet(key) {
  const hit = apiCache.get(key);
  if (hit && hit.expires > Date.now()) return hit.body;
  apiCache.delete(key);
  return null;
}

function cacheSet(key, ttl, body) {
  if (apiCache.size > 500) { // niente crescita illimitata
    for (const [k, v] of apiCache) if (v.expires <= Date.now()) apiCache.delete(k);
    if (apiCache.size > 500) apiCache.clear();
  }
  apiCache.set(key, { body, expires: Date.now() + ttl });
}

// Pulizia periodica: rimuove gli entry scaduti ogni ora anche se la mappa
// non supera la soglia dei 500 elementi (server che gira a lungo).
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of apiCache) if (v.expires <= now) apiCache.delete(k);
}, 3_600_000).unref();

// ---- Rate limit elementare per IP ----
// Protegge i servizi a monte se l'URL diventa raggiungibile da Internet.
const RATE_LIMIT = 60; // richieste /api/ al minuto per IP
const rateHits = new Map(); // ip → { count, windowStart }

function rateLimited(ip) {
  const now = Date.now();
  if (rateHits.size > 1000) {
    for (const [k, v] of rateHits) if (now - v.windowStart > 60_000) rateHits.delete(k);
  }
  const h = rateHits.get(ip);
  if (!h || now - h.windowStart > 60_000) {
    rateHits.set(ip, { count: 1, windowStart: now });
    return false;
  }
  return ++h.count > RATE_LIMIT;
}

async function vtFetch(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`ViaggiaTreno HTTP ${res.status}`);
  return res.text();
}

// Estrae le voci da un feed RSS senza dipendenze: bastano title, link e data.
function rssItems(xml, max = 10) {
  const decode = (s) => s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&') // per ultimo, per non decodificare due volte
    .trim();
  const tag = (item, name) => {
    const m = item.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i'));
    return m ? decode(m[1]) : '';
  };
  // La descrizione può contenere markup: via i tag, e tronca a misura di sommario.
  const strip = (s) => s.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  // In Atom il link è un attributo href: si preferisce rel="alternate".
  const atomLink = (entry) => {
    const links = [...entry.matchAll(/<link\b[^>]*>/gi)].map((m) => m[0]);
    const chosen = links.find((l) => /rel=["']alternate["']/i.test(l))
      || links.find((l) => !/\brel=/i.test(l)) || links[0] || '';
    const m = chosen.match(/href=["']([^"']+)["']/i);
    return m ? decode(m[1]) : '';
  };
  // RSS 2.0 usa <item>; Atom usa <entry> con tag e link diversi.
  const isAtom = /<entry[\s>]/i.test(xml) && !/<item[\s>]/i.test(xml);
  const items = isAtom
    ? [...xml.matchAll(/<entry[\s>]([\s\S]*?)<\/entry>/gi)].map((m) => ({
        title: tag(m[1], 'title'),
        link: atomLink(m[1]),
        date: tag(m[1], 'updated') || tag(m[1], 'published'),
        desc: strip(tag(m[1], 'summary') || tag(m[1], 'content')).slice(0, 220),
      }))
    : [...xml.matchAll(/<item[\s>]([\s\S]*?)<\/item>/gi)].map((m) => ({
        title: tag(m[1], 'title'),
        link: tag(m[1], 'link'),
        date: tag(m[1], 'pubDate'),
        desc: strip(tag(m[1], 'description')).slice(0, 220),
      }));
  return items
    .filter((i) => i.title && /^https:\/\//.test(i.link))
    .slice(0, max);
}

// Header di sicurezza su ogni risposta; la CSP rende inerte un eventuale
// XSS sfuggito e vale solo per le pagine HTML.
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};
const CSP = "default-src 'self'; " +
  "connect-src 'self' https://api.open-meteo.com https://geocoding-api.open-meteo.com https://air-quality-api.open-meteo.com; " +
  "img-src 'self' data:; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";

function sendJson(res, status, body, extra = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    ...SECURITY_HEADERS,
    ...extra,
  });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

// Risposta riuscita di un endpoint con cache: salva e spedisci.
function sendCachedJson(res, key, ttl, body) {
  cacheSet(key, ttl, JSON.stringify(body));
  sendJson(res, 200, body, { 'X-Cache': 'miss' });
}

async function handleApi(req, res, url) {
  const ttl = CACHE_TTL[url.pathname];
  const key = `${url.pathname}?${url.searchParams}`;
  if (ttl) {
    const cached = cacheGet(key);
    if (cached) return sendJson(res, 200, cached, { 'X-Cache': 'hit' });
  }
  try {
    // GET /api/stations?q=milano → [{name, code}, …]
    if (url.pathname === '/api/stations') {
      const q = (url.searchParams.get('q') || '').trim().toUpperCase();
      if (q.length < 2) return sendJson(res, 200, []);
      const text = await vtFetch(`${VT_BASE}/autocompletaStazione/${encodeURIComponent(q)}`);
      const stations = text.trim().split('\n').filter(Boolean).slice(0, 8).map((line) => {
        const [name, code] = line.split('|');
        return { name, code };
      });
      return sendCachedJson(res, key, ttl, stations);
    }

    // GET /api/board?station=S01700&type=partenze|arrivi → tabellone live
    if (url.pathname === '/api/board') {
      const station = url.searchParams.get('station') || '';
      const type = url.searchParams.get('type') === 'arrivi' ? 'arrivi' : 'partenze';
      if (!/^[A-Z]\d{3,6}$/.test(station)) return sendJson(res, 400, { error: 'Codice stazione non valido' });
      const text = await vtFetch(`${VT_BASE}/${type}/${station}/${vtDate()}`);
      const trains = JSON.parse(text).slice(0, 15).map((t) => ({
        treno: t.compNumeroTreno || `${t.categoriaDescrizione || ''} ${t.numeroTreno}`.trim(),
        destinazione: type === 'partenze' ? t.destinazione : t.origine,
        orario: type === 'partenze' ? t.compOrarioPartenza : t.compOrarioArrivo,
        ritardo: t.ritardo,
        binarioProgrammato: type === 'partenze'
          ? t.binarioProgrammatoPartenzaDescrizione : t.binarioProgrammatoArrivoDescrizione,
        binarioEffettivo: type === 'partenze'
          ? t.binarioEffettivoPartenzaDescrizione : t.binarioEffettivoArrivoDescrizione,
        circolante: t.circolante,
      }));
      return sendCachedJson(res, key, ttl, trains);
    }

    // GET /api/train?q=9662 → possibili treni con quel numero
    if (url.pathname === '/api/train') {
      const q = (url.searchParams.get('q') || '').trim();
      if (!/^\d{1,6}$/.test(q)) return sendJson(res, 400, { error: 'Numero treno non valido' });
      const text = await vtFetch(`${VT_BASE}/cercaNumeroTrenoTrenoAutocomplete/${q}`);
      const matches = text.trim().split('\n').filter(Boolean).map((line) => {
        const [label, payload] = line.split('|');
        const [number, originCode, departureMs] = (payload || '').split('-');
        return { label: (label || '').trim(), number, originCode, departureMs: +departureMs };
      }).filter((m) => m.originCode);
      return sendCachedJson(res, key, ttl, matches);
    }

    // GET /api/train-status?origin=S09218&number=9662&date=1781042400000 → percorso fermata per fermata
    if (url.pathname === '/api/train-status') {
      const origin = url.searchParams.get('origin') || '';
      const number = url.searchParams.get('number') || '';
      const date = url.searchParams.get('date') || '';
      if (!/^[A-Z]\d{3,6}$/.test(origin) || !/^\d{1,6}$/.test(number) || !/^\d{10,16}$/.test(date)) {
        return sendJson(res, 400, { error: 'Parametri non validi' });
      }
      const j = JSON.parse(await vtFetch(`${VT_BASE}/andamentoTreno/${origin}/${number}/${date}`));
      const fmt = (ms) => ms
        ? new Date(ms).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome' })
        : null;
      return sendCachedJson(res, key, ttl, {
        treno: (j.compNumeroTreno || '').trim() || `Treno ${number}`,
        origine: j.origine,
        destinazione: j.destinazione,
        ritardo: j.ritardo,
        ultimoRilevamento: j.stazioneUltimoRilevamento
          ? `${j.stazioneUltimoRilevamento} alle ${j.compOraUltimoRilevamento}` : null,
        fermate: (j.fermate || []).map((f) => ({
          stazione: f.stazione,
          arrivoProgrammato: fmt(f.arrivo_teorico),
          arrivoEffettivo: fmt(f.arrivoReale),
          partenzaProgrammata: fmt(f.partenza_teorica),
          partenzaEffettiva: fmt(f.partenzaReale),
          ritardo: f.ritardo,
          passata: f.actualFermataType === 1,
          soppressa: f.actualFermataType === 3,
        })),
      });
    }

    // GET /api/route?from=S01700&to=S08409 → prossimi treni diretti con ritardo live.
    // L'endpoint "soluzioni di viaggio" di ViaggiaTreno non esiste più: la tratta
    // si ricava dal tabellone partenze, controllando nel percorso di ogni treno
    // che la stazione di arrivo compaia dopo quella di partenza.
    if (url.pathname === '/api/route') {
      const from = url.searchParams.get('from') || '';
      const to = url.searchParams.get('to') || '';
      const dateParam = url.searchParams.get('date') || '';
      if (!/^[A-Z]\d{3,6}$/.test(from) || !/^[A-Z]\d{3,6}$/.test(to) || from === to
        || (dateParam && !/^\d{10,16}$/.test(dateParam))) {
        return sendJson(res, 400, { error: 'Parametri non validi' });
      }
      // Senza date la ricerca parte da adesso.
      const when = dateParam ? new Date(+dateParam) : new Date();
      // Nome della stazione di arrivo: serve come ripiego per i treni di un
      // altro giorno operativo, di cui ViaggiaTreno non espone ancora il
      // percorso — se il capolinea coincide, basta l'orario programmato.
      const toName = (url.searchParams.get('toName') || '').trim().toUpperCase().slice(0, 60);
      const fmt = (ms) => ms
        ? new Date(ms).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome' })
        : null;
      const board = JSON.parse(await vtFetch(`${VT_BASE}/partenze/${from}/${vtDate(when)}`));
      const trainLabel = (t) => t.compNumeroTreno || `${t.categoriaDescrizione || ''} ${t.numeroTreno}`.trim();
      const terminusMatch = (t) => toName && (t.destinazione || '').trim().toUpperCase() === toName;
      const todayMid = new Date(); todayMid.setHours(0, 0, 0, 0);
      const isToday = (ms) => {
        const d = new Date(ms); d.setHours(0, 0, 0, 0);
        return d.getTime() === todayMid.getTime();
      };
      // 1° passaggio: raccogli i treni di oggi che richiedono un lookup (max 10).
      const todayCandidates = [];
      for (const t of board) {
        if (!t.numeroTreno || !t.codOrigine || !t.dataPartenzaTreno) continue;
        if (isToday(t.dataPartenzaTreno)) {
          todayCandidates.push(t);
          if (todayCandidates.length >= 10) break;
        }
      }

      // 2° passaggio: fetch parallelo in batch da 4 per ridurre la latenza totale.
      const BATCH = 4;
      const fetched = new Map(); // chiave: "numero-data" → dati andamento (o null se fallito)
      for (let i = 0; i < todayCandidates.length; i += BATCH) {
        const slice = todayCandidates.slice(i, i + BATCH);
        const results = await Promise.allSettled(
          slice.map((t) => vtFetch(
            `${VT_BASE}/andamentoTreno/${t.codOrigine}/${t.numeroTreno}/${t.dataPartenzaTreno}`)
            .then((text) => JSON.parse(text))));
        slice.forEach((t, idx) => {
          fetched.set(`${t.numeroTreno}-${t.dataPartenzaTreno}`,
            results[idx].status === 'fulfilled' ? results[idx].value : null);
        });
      }

      // 3° passaggio: scorri il tabellone in ordine e componi le soluzioni usando
      // i dati già in memoria — nessuna ulteriore chiamata di rete.
      const sols = [];
      let todayCount = 0;
      for (const t of board) {
        if (sols.length >= 3) break;
        if (!t.numeroTreno || !t.codOrigine || !t.dataPartenzaTreno) continue;
        // Treno di un altro giorno: niente percorso consultabile, solo capolinea.
        if (!isToday(t.dataPartenzaTreno)) {
          if (terminusMatch(t)) {
            sols.push({
              treno: trainLabel(t), partenza: t.compOrarioPartenza || null, arrivo: null,
              ritardo: null, binario: t.binarioProgrammatoPartenzaDescrizione || null,
              circolante: false, programmato: true,
            });
          }
          continue;
        }
        if (todayCount++ >= 10) break;
        const a = fetched.get(`${t.numeroTreno}-${t.dataPartenzaTreno}`);
        if (!a) continue; // fetch fallito: salta il treno senza interrompere
        const stops = a.fermate || [];
        if (!stops.length) { // attivazione non ancora avvenuta: vale il capolinea
          if (terminusMatch(t)) {
            sols.push({
              treno: trainLabel(t), partenza: t.compOrarioPartenza || null, arrivo: null,
              ritardo: null, binario: t.binarioProgrammatoPartenzaDescrizione || null,
              circolante: false, programmato: true,
            });
          }
          continue;
        }
        const iFrom = stops.findIndex((f) => f.id === from);
        const iTo = stops.findIndex((f) => f.id === to);
        if (iFrom === -1 || iTo === -1 || iTo <= iFrom) continue;
        if (stops[iFrom].actualFermataType === 3 || stops[iTo].actualFermataType === 3) continue;
        sols.push({
          treno: trainLabel(t),
          partenza: fmt(stops[iFrom].partenza_teorica),
          arrivo: fmt(stops[iTo].arrivo_teorico),
          ritardo: a.ritardo,
          binario: t.binarioEffettivoPartenzaDescrizione || t.binarioProgrammatoPartenzaDescrizione || null,
          circolante: t.circolante,
        });
      }
      return sendCachedJson(res, key, ttl, sols);
    }

    // GET /api/news?source=ansa&feed=top → [{title, link, date}, …] dal feed RSS
    if (url.pathname === '/api/news') {
      const source = NEWS_SOURCES[url.searchParams.get('source')] || NEWS_SOURCES.ansa;
      const feed = source.feeds[url.searchParams.get('feed')] || source.feeds.top;
      try {
        const xml = await vtFetch(feed);
        return sendCachedJson(res, key, ttl, rssItems(xml));
      } catch (err) {
        console.error('[api] /api/news:', err.message);
        return sendJson(res, 502, { error: 'Notizie non disponibili' });
      }
    }

    sendJson(res, 404, { error: 'Endpoint non trovato' });
  } catch (err) {
    // Il dettaglio resta solo nel log del server: al client basta sapere che il servizio non risponde.
    console.error(`[api] ${url.pathname}:`, err.message);
    sendJson(res, 502, { error: 'ViaggiaTreno non raggiungibile' });
  }
}

function serveStatic(req, res, url) {
  let filePath = path.normalize(path.join(ROOT, decodeURIComponent(url.pathname)));
  // Il separatore finale evita che passi una cartella sorella con lo stesso prefisso.
  if (!filePath.startsWith(ROOT + path.sep) && filePath !== ROOT) { res.writeHead(403); return res.end(); }
  if (url.pathname === '/' || !path.extname(filePath)) filePath = path.join(ROOT, 'index.html');

  fs.readFile(filePath, url.pathname === '/sw.js' ? 'utf8' : null, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    const ext = path.extname(filePath);
    // Inietta la versione calcolata all'avvio nel placeholder del service worker.
    if (url.pathname === '/sw.js') data = data.replace('__CACHE_VERSION__', CACHE_VERSION);
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      ...SECURITY_HEADERS,
      ...(ext === '.html' ? { 'Content-Security-Policy': CSP } : {}),
    });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  // Una richiesta malformata (es. percent-encoding non valido) non deve abbattere il server.
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    if (url.pathname.startsWith('/api/')) {
      // Dietro un reverse proxy (es. Render) l'IP vero è in X-Forwarded-For.
      const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
        || req.socket.remoteAddress || '';
      if (rateLimited(ip)) return sendJson(res, 429, { error: 'Troppe richieste, riprova tra un minuto' });
      return handleApi(req, res, url);
    }
    serveStatic(req, res, url);
  } catch {
    res.writeHead(400, SECURITY_HEADERS);
    res.end('Bad request');
  }
});

// Avvia il server solo se eseguito direttamente: così i test possono
// importare le funzioni pure senza aprire una porta.
if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`Daily Dashboard su http://localhost:${PORT}`);
  });
}

module.exports = { rssItems, computeCacheVersion, NEWS_SOURCES };
