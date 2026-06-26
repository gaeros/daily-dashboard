'use strict';
// Test del parser RSS/Atom: usa il runner nativo node:test, nessuna dipendenza.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { rssItems, NEWS_SOURCES } = require('../server.js');

const RSS = `<?xml version="1.0"?>
<rss version="2.0"><channel>
  <item>
    <title><![CDATA[Titolo &amp; prova]]></title>
    <link>https://esempio.it/a</link>
    <pubDate>Mon, 01 Jan 2026 10:00:00 +0100</pubDate>
    <description><![CDATA[<p>Sommario <b>con</b> markup &amp; entit&agrave;</p>]]></description>
  </item>
  <item>
    <title>Senza link valido</title>
    <link>http://insicuro.it/x</link>
    <description>desc</description>
  </item>
  <item>
    <title>Secondo valido</title>
    <link>https://esempio.it/b</link>
    <description>testo</description>
  </item>
</channel></rss>`;

const ATOM = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <title>Notizia Atom</title>
    <link rel="self" href="https://esempio.it/self"/>
    <link rel="alternate" href="https://esempio.it/atom-1"/>
    <updated>2026-01-02T08:00:00Z</updated>
    <summary>Riassunto atom</summary>
  </entry>
  <entry>
    <title>Atom con content</title>
    <link href="https://esempio.it/atom-2"/>
    <published>2026-01-03T08:00:00Z</published>
    <content type="html">&lt;p&gt;Corpo&lt;/p&gt;</content>
  </entry>
</feed>`;

test('RSS: estrae title, link e data, decodifica entity e CDATA', () => {
  const items = rssItems(RSS);
  assert.equal(items.length, 2); // il link http:// non https viene scartato
  assert.equal(items[0].title, 'Titolo & prova');
  assert.equal(items[0].link, 'https://esempio.it/a');
  assert.equal(items[0].date, 'Mon, 01 Jan 2026 10:00:00 +0100');
  assert.equal(items[1].title, 'Secondo valido');
});

test('RSS: la descrizione perde il markup ed è troncata', () => {
  const [first] = rssItems(RSS);
  assert.ok(!first.desc.includes('<'));
  assert.ok(first.desc.length <= 220);
  assert.ok(first.desc.startsWith('Sommario con markup'));
});

test('RSS: rispetta il limite max', () => {
  assert.equal(rssItems(RSS, 1).length, 1);
});

test('Atom: estrae entry, preferisce rel="alternate" per il link', () => {
  const items = rssItems(ATOM);
  assert.equal(items.length, 2);
  assert.equal(items[0].title, 'Notizia Atom');
  assert.equal(items[0].link, 'https://esempio.it/atom-1'); // non il rel="self"
  assert.equal(items[0].date, '2026-01-02T08:00:00Z');
  assert.equal(items[0].desc, 'Riassunto atom');
});

test('Atom: link senza rel e data da <published>, content come descrizione', () => {
  const [, second] = rssItems(ATOM);
  assert.equal(second.link, 'https://esempio.it/atom-2');
  assert.equal(second.date, '2026-01-03T08:00:00Z');
  assert.equal(second.desc, 'Corpo');
});

test('Input vuoto o non valido restituisce lista vuota', () => {
  assert.deepEqual(rssItems(''), []);
  assert.deepEqual(rssItems('<html>niente feed</html>'), []);
});

test('Le fonti notizie sono coerenti: ogni fonte ha label e feed top', () => {
  for (const [, src] of Object.entries(NEWS_SOURCES)) {
    assert.equal(typeof src.label, 'string');
    assert.ok(src.feeds && /^https:\/\//.test(src.feeds.top));
  }
});
