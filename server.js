// Server della Daily Dashboard: serve i file statici e fa da proxy
// verso le API ViaggiaTreno (che non espongono header CORS).
// Nessuna dipendenza: solo Node >= 18.
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8741;
const ROOT = __dirname;
const VT_BASE = 'http://www.viaggiatreno.it/infomobilita/resteasy/viaggiatreno';

// Feed RSS ANSA consentiti: whitelist chiusa, il client sceglie solo la chiave.
const NEWS_FEEDS = {
  top: 'https://www.ansa.it/sito/notizie/topnews/topnews_rss.xml',
  mondo: 'https://www.ansa.it/sito/notizie/mondo/mondo_rss.xml',
  economia: 'https://www.ansa.it/sito/notizie/economia/economia_rss.xml',
  sport: 'https://www.ansa.it/sito/notizie/sport/sport_rss.xml',
  tecnologia: 'https://www.ansa.it/sito/notizie/tecnologia/tecnologia_rss.xml',
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
const vtDate = () => encodeURIComponent(new Date().toString());

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
  return [...xml.matchAll(/<item[\s>]([\s\S]*?)<\/item>/gi)]
    .map((m) => ({
      title: tag(m[1], 'title'),
      link: tag(m[1], 'link'),
      date: tag(m[1], 'pubDate'),
      desc: strip(tag(m[1], 'description')).slice(0, 220),
    }))
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
  "connect-src 'self' https://api.open-meteo.com https://geocoding-api.open-meteo.com; " +
  "img-src 'self' data:; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";

function sendJson(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    ...SECURITY_HEADERS,
  });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

async function handleApi(req, res, url) {
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
      return sendJson(res, 200, stations);
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
      return sendJson(res, 200, trains);
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
      return sendJson(res, 200, matches);
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
      return sendJson(res, 200, {
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

    // GET /api/news?feed=top → [{title, link, date}, …] dal feed RSS ANSA
    if (url.pathname === '/api/news') {
      const feed = NEWS_FEEDS[url.searchParams.get('feed')] || NEWS_FEEDS.top;
      try {
        const xml = await vtFetch(feed);
        return sendJson(res, 200, rssItems(xml));
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

  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    const ext = path.extname(filePath);
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      ...SECURITY_HEADERS,
      ...(ext === '.html' ? { 'Content-Security-Policy': CSP } : {}),
    });
    res.end(data);
  });
}

http.createServer((req, res) => {
  // Una richiesta malformata (es. percent-encoding non valido) non deve abbattere il server.
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    if (url.pathname.startsWith('/api/')) return handleApi(req, res, url);
    serveStatic(req, res, url);
  } catch {
    res.writeHead(400, SECURITY_HEADERS);
    res.end('Bad request');
  }
}).listen(PORT, () => {
  console.log(`Daily Dashboard su http://localhost:${PORT}`);
});
