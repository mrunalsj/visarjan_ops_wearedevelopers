#!/usr/bin/env node
// Imports MCGM's "Arrangement of Ganeshotsav 2025" artificial-pond list from OCR text into a reviewable source file.
//
//   swift scripts/ocr-pdf.swift "<downloaded MCGM PDF>" > /tmp/mcgm-ocr.txt
//   node scripts/import-mcgm.mjs /tmp/mcgm-ocr.txt --resolve
//
// --resolve fetches each MCGM-published maps.app.goo.gl short link once (no redirect following, rate-limited,
// cached in .cache/) to read the coordinates it points to. Missing values stay null; nothing is invented.
// Every record starts as PENDING_REVIEW: an authorised operator must verify it before it is called verified.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SOURCE = {
  id: 'mcgm-ganeshotsav-2025',
  authority: 'Brihanmumbai Municipal Corporation (MCGM)',
  city: 'Mumbai',
  sourceUrl: 'https://portal.mcgm.gov.in/irj/portal/anonymous/qlGanpatiDeQR',
  sourceDocument: 'Arrangement of Ganeshostav 2025 updated as on 25.08.2025 (PDF downloaded from the MCGM portal)',
  publishedAt: '2025-08-25',
  festival: 'Ganeshotsav',
  festivalYear: 2025,
  listedPondTotal: 288
};
const OUT = fileURLToPath(new URL('../server/sources/mcgm-ganeshotsav-2025.json', import.meta.url));
const CACHE = fileURLToPath(new URL('../.cache/mcgm-short-links.json', import.meta.url));
const USER_AGENT = 'VisarjanOps-importer/0.1 (+https://github.com/mrunalsj/visarjanops_wearedevelopers)';
const MUMBAI = { minLat: 18.85, maxLat: 19.35, minLng: 72.75, maxLng: 73.05 };

// OCR sometimes reads Latin letters as Cyrillic lookalikes inside short-link IDs.
const LOOKALIKE = { 'А': 'A', 'В': 'B', 'Е': 'E', 'К': 'K', 'М': 'M', 'Н': 'H', 'О': 'O', 'Р': 'P', 'С': 'C', 'Т': 'T', 'Х': 'X', 'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c', 'у': 'y', 'х': 'x' };
const normalize = s => [...s].map(c => LOOKALIKE[c] ?? c).join('');
const ID = 'A-Za-z0-9АВЕКМНОРСТХаеорсух';
const LINK = new RegExp(`maps\\.app\\.goo\\.g[l/]{1,2}/*([${ID}]+)`, 'g');
const CONTINUATION = new RegExp(`^([${ID}]{1,12})(?:\\??[gq][ _]?st=a[wc])?$`);
const SHORT_ID_LENGTH = 17;
const LOCALITIES = ['Colaba', 'Cuffe Parade', 'Fort', 'Marine Lines', 'Girgaon', 'Chowpatty', 'Malabar Hill', 'Grant Road', 'Tardeo', 'Mumbai Central', 'Byculla', 'Mazgaon', 'Dongri', 'Umerkhadi', 'Kalbadevi', 'Bhuleshwar', 'Charni Road', 'Nagpada', 'Agripada', 'Mahalaxmi', 'Lalbaug', 'Sewri', 'Naigaon', 'Lower Parel', 'Parel', 'Worli', 'Prabhadevi', 'Dadar', 'Mahim', 'Matunga', 'Sion', 'Antop Hill', 'Wadala', 'Dharavi', 'Bandra', 'Khar', 'Kalina', 'Santacruz', 'Vile Parle', 'Juhu', 'Andheri', 'Jogeshwari', 'Goregaon', 'Malad', 'Kandivali', 'Charkop', 'Borivali', 'Dahisar', 'Gorai', 'Kurla', 'Chembur', 'Ghatkopar', 'Vikhroli', 'Kanjurmarg', 'Powai', 'Bhandup', 'Mulund', 'Govandi', 'Mankhurd', 'Deonar', 'Trombay', 'Chandivali', 'Saki Naka', 'Versova', 'Oshiwara'];

// Rejects OCR noise from Devanagari text read as Latin (e.g. "y4t Hlut a1a8"): mixed letter/digit words or vowel-less words.
const looksLikeWords = text => {
  const words = text.split(/[\s,.()/:-]+/).filter(w => w.length >= 2);
  const noisy = words.filter(w => /[a-z]\d|\d[a-z]/i.test(w) || (/^[a-z]{3,}$/i.test(w) && !/[aeiouy]/i.test(w)));
  return words.length > 0 && noisy.length / words.length < 0.15;
};
const isClean = text => /^[A-Za-z0-9]/.test(text) && /^[A-Za-z0-9 .,'&()\/:-]+$/.test(text) && (text.match(/[A-Za-z]/g) || []).length >= 6 && /[A-Za-z]{3,}/.test(text) && !/goo\.g|https?:|google/i.test(text) && looksLikeWords(text);
const cleanName = text => text.replace(/^\d+\s*[.)]?\s*/, '').replace(/\s+/g, ' ').trim();
const localityOf = text => LOCALITIES.find(l => new RegExp(`\\b${l}\\b`, 'i').test(text || '')) || null;
const inMumbai = c => c && c.lat >= MUMBAI.minLat && c.lat <= MUMBAI.maxLat && c.lng >= MUMBAI.minLng && c.lng <= MUMBAI.maxLng;

// Open Location Code (Plus Code) decoding, per the open specification (github.com/google/open-location-code).
const OLC = '23456789CFGHJMPQRVWX';
function olcEncode(lat, lng) {
  let la = Math.min(Math.max(lat, -90), 89.999999) + 90, ln = ((lng + 180) % 360 + 360) % 360, pv = 20, code = '';
  for (let i = 0; i < 5; i++) { const a = Math.floor(la / pv), b = Math.floor(ln / pv); la -= a * pv; ln -= b * pv; code += OLC[a] + OLC[b]; pv /= 20; }
  return code;
}
function olcDecode(code) {
  const s = code.replace('+', '').toUpperCase();
  let lat = -90, lng = -180, pv = 20, latRes = 20, lngRes = 20;
  for (let i = 0; i < Math.min(10, s.length); i += 2) { lat += OLC.indexOf(s[i]) * pv; lng += OLC.indexOf(s[i + 1]) * pv; latRes = lngRes = pv; pv /= 20; }
  for (let i = 10; i < s.length; i++) { const d = OLC.indexOf(s[i]); latRes /= 5; lngRes /= 4; lat += Math.floor(d / 4) * latRes; lng += (d % 4) * lngRes; }
  return { lat: lat + latRes / 2, lng: lng + lngRes / 2 };
}
// Recovers a short Plus Code (e.g. "XR6Q+643") relative to a reference point, per the OLC "recover nearest" rule.
export function recoverPlusCode(short, ref = { lat: 19.076, lng: 72.8777 }) {
  const code = short.toUpperCase();
  if (!/^[23456789CFGHJMPQRVWX]{2,8}\+[23456789CFGHJMPQRVWX]{2,}$/.test(code)) return null;
  const missing = 8 - code.indexOf('+');
  if (missing <= 0) return olcDecode(code);
  const resolution = 20 ** (2 - missing / 2), half = resolution / 2;
  const area = olcDecode(olcEncode(ref.lat, ref.lng).slice(0, missing) + code);
  if (ref.lat + half < area.lat) area.lat -= resolution; else if (ref.lat - half > area.lat) area.lat += resolution;
  if (ref.lng + half < area.lng) area.lng -= resolution; else if (ref.lng - half > area.lng) area.lng += resolution;
  return area;
}
const PLUS_CODE = /^([23456789CFGHJMPQRVWX]{2,8}\+[23456789CFGHJMPQRVWX]{2,})\s+/i;

export function coordinatesFromMapUrl(url) {
  let m = url.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
  if (m) return { lat: +m[1], lng: +m[2], method: 'place-pin' };
  m = url.match(/\/maps\/search\/(-?\d+\.\d+),(?:\+|%20|\s)*(-?\d+\.\d+)/);
  if (m) return { lat: +m[1], lng: +m[2], method: 'search-coordinates' };
  m = url.match(/[?&](?:q|query|ll|destination)=(-?\d+\.\d+)(?:,|%2C)\s*(-?\d+\.\d+)/);
  if (m) return { lat: +m[1], lng: +m[2], method: 'query' };
  const label = rawPlaceLabel(url);
  const plus = label?.match(PLUS_CODE);
  if (plus) { const c = recoverPlusCode(plus[1]); if (c) return { lat: c.lat, lng: c.lng, method: 'plus-code' }; }
  m = url.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (m) return { lat: +m[1], lng: +m[2], method: 'viewport-centre' };
  return null;
}
function rawPlaceLabel(url) {
  const m = url.match(/\/maps\/place\/([^/@?]+)/);
  if (!m) return null;
  try { return decodeURIComponent(m[1].replace(/\+/g, ' ')).replace(/\s+/g, ' ').trim(); } catch { return null; }
}
// Full address label from a map link, without any leading Plus Code; null for coordinate-only labels.
export function addressFromMapUrl(url) {
  const label = rawPlaceLabel(url);
  if (!label || /\d+°|^-?\d+\.\d+/.test(label)) return null;
  return label.replace(PLUS_CODE, '').trim() || null;
}
export function placeNameFromMapUrl(url) {
  const address = addressFromMapUrl(url);
  return address ? address.split(',')[0].trim() || null : null;
}

export function parseOcr(text) {
  const lines = text.split('\n');
  const usedNameLines = new Set();
  const candidates = [];
  let page = 0;
  const partsOf = i => (lines[i] || '').split(' | ').map(p => p.trim()).filter(Boolean);
  const nameFrom = (i, skip) => {
    if (i < 0 || i >= lines.length || usedNameLines.has(i) || /goo\.g|google/i.test(lines[i]) && i !== skip) return null;
    const best = partsOf(i).filter(p => !/goo\.g|google/i.test(p)).map(cleanName).filter(isClean).sort((a, b) => b.length - a.length)[0];
    if (best) usedNameLines.add(i);
    return best || null;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const pageMatch = line.match(/^=== PAGE (\d+) ===/);
    if (pageMatch) { page = +pageMatch[1]; continue; }
    for (const match of line.matchAll(LINK)) {
      let id = normalize(match[1]);
      if (id.length < SHORT_ID_LENGTH) {
        const need = SHORT_ID_LENGTH - id.length;
        for (let j = i + 1; j <= i + 2 && j < lines.length; j++) {
          const piece = partsOf(j).map(p => p.match(CONTINUATION)?.[1]).filter(Boolean).find(p => p.length === need);
          if (piece) { id += normalize(piece); break; }
        }
      }
      const name = nameFrom(i, i) || nameFrom(i - 1) || nameFrom(i + 1);
      candidates.push({ page, line: i + 1, shortId: id, shortLink: `https://maps.app.goo.gl/${id}`, ocrName: name, rawText: [lines[i - 1], line, lines[i + 1]].filter(Boolean).join(' / ') });
    }
    if (/google\.co[^ ]*\/maps/.test(line)) {
      let url = line.slice(line.indexOf('https://www.google'));
      for (let j = i + 1; j < Math.min(i + 10, lines.length); j++) {
        const piece = partsOf(j).find(p => /^[^\s]+$/.test(p) && !/goo\.g/.test(p) && p.length > 6) || '';
        if (/^https?:/.test(piece) || !piece) break;
        url += piece;
      }
      const coordinates = coordinatesFromMapUrl(url);
      if (coordinates) candidates.push({ page, line: i + 1, shortId: null, shortLink: null, fullUrlCoordinates: coordinates, mapLabel: placeNameFromMapUrl(url), ocrName: nameFrom(i - 1) || nameFrom(i + 1), rawText: url.slice(0, 300) });
    }
  }
  return candidates;
}

async function resolveShortLink(id) {
  const response = await fetch(`https://maps.app.goo.gl/${id}`, { redirect: 'manual', headers: { 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(10_000) });
  const location = response.headers.get('location');
  return { status: response.status, location: response.status >= 300 && response.status < 400 ? location : null, checkedAt: new Date().toISOString() };
}

const distanceM = (a, b) => {
  const r = d => d * Math.PI / 180, x = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(x));
};

export function buildRecords(candidates, resolutions, extractedAt) {
  const records = [];
  const seenIds = new Map();
  for (const c of candidates) {
    if (c.shortId && seenIds.has(c.shortId)) { seenIds.get(c.shortId).quality.duplicateMentions++; continue; }
    const resolution = c.shortId ? resolutions[c.shortId] : null;
    const resolvedUrl = resolution?.location || null;
    const raw = c.fullUrlCoordinates || (resolvedUrl ? coordinatesFromMapUrl(resolvedUrl) : null);
    const mapLabel = c.mapLabel || (resolvedUrl ? placeNameFromMapUrl(resolvedUrl) : null);
    const address = resolvedUrl ? addressFromMapUrl(resolvedUrl) : null;
    const coordinates = raw && inMumbai(raw)
      ? { lat: +raw.lat.toFixed(6), lng: +raw.lng.toFixed(6), kind: 'official-link', method: raw.method, note: 'From the map link MCGM published; not independently verified' }
      : null;
    const name = c.ocrName || mapLabel || null;
    const n = String(records.length + 1).padStart(3, '0');
    const record = {
      id: `mcgm-2025-${n}`,
      name: name || `MCGM artificial pond ${n}`,
      nameSource: c.ocrName ? 'ocr' : mapLabel ? 'map-label' : 'placeholder',
      city: 'Mumbai',
      area: localityOf(`${c.ocrName || ''} ${address || mapLabel || ''}`) ? `${localityOf(`${c.ocrName || ''} ${address || mapLabel || ''}`)}, Mumbai` : 'Mumbai',
      address,
      addressSource: address ? 'map-link-label' : null,
      siteType: 'Artificial pond',
      facilities: [],
      coordinates,
      sourceLink: c.shortLink,
      provenance: { kind: 'official-source', label: 'MCGM official list', ...SOURCE, extractedAt, seasonStatus: 'past-season', verificationStatus: 'PENDING_REVIEW', verifiedAt: null, verifiedBy: null },
      quality: {
        page: c.page,
        ocrLine: c.line,
        nameReadable: Boolean(c.ocrName),
        linkResolved: c.shortId ? Boolean(resolvedUrl) : null,
        linkStatus: resolution?.status ?? null,
        coordinatesOutsideMumbai: Boolean(raw && !inMumbai(raw)),
        duplicateMentions: 0,
        possibleDuplicateOf: null
      },
      rawText: c.rawText
    };
    for (const other of records) {
      if (record.coordinates && other.coordinates && distanceM(record.coordinates, other.coordinates) < 30) { record.quality.possibleDuplicateOf = other.id; break; }
    }
    records.push(record);
    if (c.shortId) seenIds.set(c.shortId, record);
  }
  return records;
}

async function main() {
  const [input, ...flags] = process.argv.slice(2);
  if (!input) { console.error('Usage: node scripts/import-mcgm.mjs <ocr.txt> [--resolve]'); process.exit(1); }
  const candidates = parseOcr(readFileSync(input, 'utf8'));
  const cache = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, 'utf8')) : {};
  if (flags.includes('--resolve')) {
    const pending = [...new Set(candidates.map(c => c.shortId).filter(id => id && !cache[id]))];
    console.error(`Resolving ${pending.length} short links (cached: ${Object.keys(cache).length})…`);
    for (const id of pending) {
      try { cache[id] = await resolveShortLink(id); } catch (error) { cache[id] = { status: null, location: null, error: error.name, checkedAt: new Date().toISOString() }; }
      await new Promise(r => setTimeout(r, 400));
    }
    mkdirSync(new URL('../.cache/', import.meta.url), { recursive: true });
    writeFileSync(CACHE, JSON.stringify(cache, null, 2));
  }
  const extractedAt = new Date().toISOString();
  const records = buildRecords(candidates, cache, extractedAt);
  const stats = {
    candidateMentions: candidates.length,
    records: records.length,
    withCoordinates: records.filter(r => r.coordinates).length,
    linksUnresolved: records.filter(r => r.quality.linkResolved === false).length,
    namesFromOcr: records.filter(r => r.nameSource === 'ocr').length,
    namesFromMapLabel: records.filter(r => r.nameSource === 'map-label').length,
    namesMissing: records.filter(r => r.nameSource === 'placeholder').length,
    duplicateMentions: records.reduce((n, r) => n + r.quality.duplicateMentions, 0),
    possibleDuplicates: records.filter(r => r.quality.possibleDuplicateOf).length,
    listedPondTotal: SOURCE.listedPondTotal
  };
  writeFileSync(OUT, JSON.stringify({ source: { ...SOURCE, extractedAt, extractionMethod: 'On-device OCR (macOS Vision) of the scanned PDF, plus one request per MCGM-published short link to read its coordinates' }, stats, records }, null, 2) + '\n');
  console.error(JSON.stringify(stats, null, 2));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
