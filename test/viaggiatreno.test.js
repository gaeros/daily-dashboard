'use strict';
// Test dei parser ViaggiaTreno e di computeCacheVersion: runner nativo node:test.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  fmtRomeTime, parseStations, parseBoard, parseTrainMatches, parseTrainStatus, computeCacheVersion,
} = require('../server.js');

test('parseStations: estrae nome e codice dalle righe "Nome|CODICE"', () => {
  const out = parseStations('Roma Termini|S08409\nMilano Centrale|S01700\n');
  assert.equal(out.length, 2);
  assert.deepEqual(out[0], { name: 'Roma Termini', code: 'S08409' });
  assert.equal(out[1].code, 'S01700');
});

test('parseBoard: partenze e arrivi leggono i campi giusti', () => {
  const text = JSON.stringify([{
    compNumeroTreno: 'FR 9662', destinazione: 'MILANO CENTRALE', origine: 'NAPOLI CENTRALE',
    compOrarioPartenza: '10:00', compOrarioArrivo: '13:00', ritardo: 5,
    binarioProgrammatoPartenzaDescrizione: '12', binarioEffettivoPartenzaDescrizione: '13',
    binarioProgrammatoArrivoDescrizione: '5', binarioEffettivoArrivoDescrizione: '',
    circolante: true,
  }]);
  const dep = parseBoard(text, 'partenze')[0];
  assert.equal(dep.treno, 'FR 9662');
  assert.equal(dep.destinazione, 'MILANO CENTRALE');
  assert.equal(dep.orario, '10:00');
  assert.equal(dep.ritardo, 5);
  assert.equal(dep.binarioProgrammato, '12');
  assert.equal(dep.binarioEffettivo, '13');
  assert.equal(dep.circolante, true);

  const arr = parseBoard(text, 'arrivi')[0];
  assert.equal(arr.destinazione, 'NAPOLI CENTRALE'); // in arrivo si mostra l'origine
  assert.equal(arr.orario, '13:00');
  assert.equal(arr.binarioProgrammato, '5');
});

test('parseBoard: senza compNumeroTreno usa categoria + numero e limita a 15', () => {
  const many = Array.from({ length: 16 }, (_, i) => ({ categoriaDescrizione: 'REG', numeroTreno: 1000 + i }));
  const out = parseBoard(JSON.stringify(many), 'partenze');
  assert.equal(out.length, 15);
  assert.equal(out[0].treno, 'REG 1000');
});

test('parseTrainMatches: estrae numero/origine/ms e scarta righe senza payload', () => {
  const text = 'FR 9662 - NAPOLI C.LE|9662-S09218-1781042400000\nRiga senza payload\n';
  const out = parseTrainMatches(text);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0], {
    label: 'FR 9662 - NAPOLI C.LE', number: '9662', originCode: 'S09218', departureMs: 1781042400000,
  });
});

test('fmtRomeTime: null resta null, un istante noto dà l\'ora di Roma', () => {
  assert.equal(fmtRomeTime(null), null);
  // 2026-01-15 09:00 UTC = 10:00 a Roma (CET, senza ora legale)
  assert.equal(fmtRomeTime(Date.UTC(2026, 0, 15, 9, 0, 0)), '10:00');
});

test('parseTrainStatus: mappa stato, ultimo rilevamento e flag delle fermate', () => {
  const j = {
    compNumeroTreno: 'FR 9662', origine: 'NAPOLI CENTRALE', destinazione: 'MILANO CENTRALE',
    ritardo: 3, stazioneUltimoRilevamento: 'BOLOGNA C.LE', compOraUltimoRilevamento: '11:30',
    fermate: [
      { stazione: 'NAPOLI CENTRALE', partenza_teorica: Date.UTC(2026, 0, 15, 9, 0, 0), arrivo_teorico: null, ritardo: 0, actualFermataType: 1 },
      { stazione: 'ROMA TERMINI', arrivo_teorico: Date.UTC(2026, 0, 15, 10, 0, 0), ritardo: 2, actualFermataType: 0 },
      { stazione: 'FIRENZE SMN', actualFermataType: 3 },
    ],
  };
  const s = parseTrainStatus(j, '9662');
  assert.equal(s.treno, 'FR 9662');
  assert.equal(s.ritardo, 3);
  assert.equal(s.ultimoRilevamento, 'BOLOGNA C.LE alle 11:30');
  assert.equal(s.fermate.length, 3);
  assert.equal(s.fermate[0].passata, true);
  assert.equal(s.fermate[0].partenzaProgrammata, '10:00');
  assert.equal(s.fermate[0].arrivoProgrammato, null);
  assert.equal(s.fermate[2].soppressa, true);
  assert.equal(s.fermate[2].passata, false);
});

test('parseTrainStatus: senza compNumeroTreno usa "Treno N"', () => {
  assert.equal(parseTrainStatus({}, '9999').treno, 'Treno 9999');
});

test('computeCacheVersion: stabile a parità di file, cambia se cambia una mtime', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-cache-'));
  try {
    fs.writeFileSync(path.join(dir, 'a.txt'), 'x');
    const v1 = computeCacheVersion(['a.txt'], dir);
    assert.equal(typeof v1, 'string');
    assert.equal(computeCacheVersion(['a.txt'], dir), v1); // stabile a parità di mtime
    const future = new Date(Date.now() + 60_000);
    fs.utimesSync(path.join(dir, 'a.txt'), future, future);
    assert.notEqual(computeCacheVersion(['a.txt'], dir), v1); // cambia con la mtime
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
