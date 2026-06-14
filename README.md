# Daily Dashboard 🌤️📝🚆

PWA personale con meteo, agenda delle cose da fare e tratte ferroviarie preferite, tutto in un'unica schermata. I dati restano sul dispositivo (localStorage), nessun account richiesto.

> **Progetto didattico, senza scopo di lucro.** Questa app esiste solo per imparare e sperimentare (PWA, API, accessibilità): non è un prodotto commerciale, non viene venduta e non genera alcun guadagno.

## Dati di terze parti

I dati mostrati dall'app provengono da servizi esterni e **restano di proprietà esclusiva dei rispettivi titolari**:

- **Meteo e geocoding** — [Open-Meteo](https://open-meteo.com): i dati appartengono a Open-Meteo e ai suoi fornitori, usati secondo i termini del servizio (gratuito per uso non commerciale).
- **Treni in tempo reale** — API ViaggiaTreno di **Trenitalia / Gruppo FS Italiane**: orari, ritardi e binari appartengono a Trenitalia. Le API non sono documentate ufficialmente; il server incluso si limita a inoltrarle per la consultazione personale, senza memorizzarle né redistribuirle.
- **Notizie** — feed RSS pubblici dell'**ANSA**: titoli e contenuti appartengono ad ANSA; l'app mostra solo titolo, data e link che rimanda all'articolo originale su ansa.it.

Questo progetto non è affiliato, sponsorizzato o approvato da Trenitalia, Gruppo FS Italiane, Open-Meteo o ANSA. L'uso delle API e dei feed è limitato a scopo personale e di studio.

## Avvio in locale

Serve solo Node.js (>= 18, nessuna dipendenza da installare). Il server incluso serve l'app **e** fa da proxy verso le API ViaggiaTreno, che non sono chiamabili direttamente dal browser per il CORS:

```
node server.js
```

Poi apri http://localhost:8741 (porta configurabile con la variabile `PORT`).

## Installazione come app sul telefono

1. Pubblica il progetto su un hosting che esegua Node (Render, Railway, Fly.io hanno piani gratuiti) — serve HTTPS per la PWA. GitHub Pages **non** basta: i treni in tempo reale richiedono il server proxy. Il repo include `package.json` con lo script `start`, quindi su Render basta collegare il repository: rileva Node da solo e avvia `npm start`.
2. Apri il sito dal telefono.
3. Menu del browser → **"Aggiungi a schermata Home"** / **"Installa app"**.

In alternativa, se ti basta usarla in casa: avvia `node server.js` sul PC e apri `http://<ip-del-pc>:8741` dal telefono sulla stessa rete Wi-Fi.

## Funzionalità

- **Meteo** (Open-Meteo, gratuito, senza API key): condizioni attuali + previsioni a 7 giorni, con probabilità di pioggia. Città configurabile da ⚙️ (ricerca o geolocalizzazione). Tocca un giorno per il dettaglio: andamento ora per ora, pioggia attesa (probabilità e mm), vento massimo, indice UV, alba e tramonto.
- **Qualità dell'aria e pollini** (Open-Meteo Air Quality): indice europeo (AQI) con etichetta e colore per livello, più il polline più alto del momento (graminacee, betulla, olivo, ambrosia, ontano, artemisia) con livello basso/medio/alto.
- **Agenda**: attività con priorità, giorno **e orario** di scadenza, ordinate automaticamente; le attività in ritardo (anche solo d'orario) sono evidenziate. Le attività possono essere **ricorrenti** (ogni giorno, Lun–Ven, ogni settimana o ogni mese): spuntandole non spariscono, ma slittano da sole all'occorrenza successiva. Due viste: **lista** o **calendario settimanale** (i prossimi 7 giorni con le attività distribuite per giorno). Nella lista le attività si **riordinano** trascinandole dal manico (anche su touch) o con le frecce su/giù da tastiera; un pulsante riapplica al volo l'ordinamento automatico per scadenza e priorità.
- **Promemoria con notifiche**: attivabili da ⚙️, una notifica 15 minuti prima e una all'ora della scadenza, più un avviso quando il **treno seguito accumula ritardo** (Notification API). Limite onesto: funzionano solo ad app aperta, anche installata come PWA — senza un server push non è possibile l'invio da remoto.
- **Treni in tempo reale** (ViaggiaTreno): cerca una stazione, salvala tra le preferite e consulta il tabellone partenze/arrivi live con ritardi e binari effettivi.
- **Segui un treno per numero**: percorso completo fermata per fermata, con orario programmato vs effettivo, ritardo a ogni fermata e indicazione dell'ultima posizione rilevata.
- **Tratte preferite** (es. casa–lavoro): salvi **più tratte**, ognuna mostra subito i prossimi treni **diretti** con orari, ritardo live e binario; un tap inverte la direzione per il ritorno, e un selettore giorno/ora (comune a tutte) sposta la ricerca in avanti. (ViaggiaTreno non espone più le "soluzioni di viaggio", quindi la tratta è ricostruita dal tabellone: niente soluzioni con cambio. Per i giorni futuri ViaggiaTreno non pubblica ancora i percorsi: compaiono solo i treni con capolinea nella stazione di arrivo, con orario programmato.)
- **Riepilogo mattutino**: aprendo l'app tra le 6 e le 10 compare il "Buongiorno" con meteo di oggi, primo impegno in agenda e primo treno della tratta preferita; si può chiudere per il resto della giornata.
- **Aggiornamento automatico**: tabellone e treno seguito si rinfrescano da soli ogni minuto (solo a scheda visibile, per non sprecare richieste); se il treno seguito accumula ritardo, compare un avviso nel riepilogo intelligente.
- **Lista della spesa**: spunta gli articoli man mano che li prendi (scendono in fondo), rimuovili tutti insieme con un tap quando hai finito, riordinali trascinandoli dal manico (anche su touch) o con le frecce su/giù da tastiera. L'app impara cosa compri più spesso e te lo ripropone come suggerimento con un tap ("Compri spesso: + Latte").
- **Interfaccia compatta**: meteo, agenda e form occupano poco spazio verticale; tutti i pulsanti hanno la stessa dimensione e i campi di partenza/arrivo della tratta restano sempre visibili per cambiarla al volo.
- **Accessibilità**: etichette visibili o per screen reader su tutti i controlli, navigazione completa da tastiera (risultati di ricerca come pulsanti), `aria-live` sugli aggiornamenti dinamici, contrasti conformi WCAG AA e controlli nativi (date/time picker) leggibili anche in tema scuro grazie a `color-scheme`.
- **Ultime notizie** (feed RSS ANSA, via proxy): titoli con categoria a scelta (top, mondo, economia, sport, tecnologia), link all'articolo originale, aggiornamento automatico ogni 10 minuti. Il widget è **richiudibile** (chiuso di default) e ricorda lo stato: da chiuso non scarica nulla.
- **Riepilogo intelligente**: avvisi automatici (pioggia in arrivo, scadenze di oggi, attività in ritardo).
- **Backup dei dati**: da ⚙️ esporti agenda, spesa, stazioni, tratta e città in un file JSON e li reimporti (anche su un altro dispositivo). È l'unico ponte fuori dal localStorage del singolo browser.
- **Offline**: il service worker mantiene l'app utilizzabile senza rete, con l'ultimo meteo in cache.

## File

- `index.html` / `style.css` / `app.js` — l'app (vanilla JS, nessuna dipendenza npm)
- `vendor/fontawesome/` — Font Awesome 6 Free self-hosted (icone), compatibile con la CSP e l'uso offline
- `vendor/fonts/` — font Plus Jakarta Sans (variable, pesi 200–800) self-hosted da Google Fonts
- `server.js` — server statico + proxy ViaggiaTreno e notizie (`/api/stations`, `/api/board`, `/api/train`, `/api/train-status`, `/api/route`, `/api/news`)
- `manifest.json` + `icon.svg` — installabilità PWA
- `sw.js` — service worker per cache e offline (le chiamate `/api/` non vengono mai messe in cache)

## Sicurezza

- Tutto l'HTML generato da dati esterni o utente passa per l'escape; una **Content-Security-Policy** rigida (`default-src 'self'`, connessioni consentite solo verso le API Open-Meteo; treni e notizie passano dal proxy locale) fa da seconda linea di difesa.
- Il server valida con regex strette tutti i parametri verso ViaggiaTreno (niente SSRF), i feed notizie sono una whitelist chiusa, blocca i path traversal, resiste alle richieste malformate e non espone dettagli d'errore interni al client.
- **Rate limit** di 60 richieste API al minuto per IP e **cache breve** delle risposte (30 s per i treni, 2 min per la tratta, 5 min per le notizie): se l'app è esposta su Internet, i servizi a monte non vengono mai martellati.
- Header `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer` e `frame-ancestors 'none'` su tutte le risposte.
- Nota: il server ascolta su tutta la rete locale (serve per usare l'app dal telefono in Wi-Fi); i dati personali restano comunque solo nel localStorage del browser.

## Idee per il prossimo passo

- Sincronizzazione tra dispositivi (richiederebbe un backend con account)
- Previsione dei pollini nei prossimi giorni, non solo del momento
