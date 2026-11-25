import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseOcr, buildRecords, coordinatesFromMapUrl, addressFromMapUrl, placeNameFromMapUrl, recoverPlusCode } from '../scripts/import-mcgm.mjs';

test('recovers a short Plus Code relative to Mumbai', () => {
  const c = recoverPlusCode('XR6Q+643');
  assert.ok(Math.abs(c.lat - 18.9605) < 0.001 && Math.abs(c.lng - 72.8378) < 0.001);
  assert.equal(recoverPlusCode('not-a-code'), null);
});

test('reads coordinates from each map-link format and prefers the place pin', () => {
  assert.deepEqual(coordinatesFromMapUrl('https://www.google.com/maps/place/X/@18.92,72.83,18z/data=!3d18.922012!4d72.834567'), { lat: 18.922012, lng: 72.834567, method: 'place-pin' });
  assert.equal(coordinatesFromMapUrl('https://www.google.com/maps/search/18.919785,+72.825539?entry=tts').method, 'search-coordinates');
  assert.equal(coordinatesFromMapUrl('https://www.google.com/maps/place/XR6Q%2B643+Veer+Sambhaji+Maidan,+Mumbai/data=!4m2').method, 'plus-code');
  assert.equal(coordinatesFromMapUrl('https://www.google.com/maps/place/Durgadevi+Udyan,+Mumbai/data=!4m2'), null);
});

test('extracts an address and name from a map label without the Plus Code', () => {
  const url = 'https://www.google.com/maps/place/XR6Q%2B643+Veer+Sambhaji+Maidan,+Dongri,+Mumbai/data=!4m2';
  assert.equal(addressFromMapUrl(url), 'Veer Sambhaji Maidan, Dongri, Mumbai');
  assert.equal(placeNameFromMapUrl(url), 'Veer Sambhaji Maidan');
  assert.equal(addressFromMapUrl("https://www.google.com/maps/place/18%C2%B055'19.2%22N/@18.9,72.8"), null);
});

test('joins split short links, fixes Cyrillic lookalikes and drops unreadable names', () => {
  const ocr = ['=== PAGE 1 ===', '1 | Gateway of India | https://maps.app.goo.gl/qfTEuzxhV', 'ВLmubХB9', '2 | y4t Hlut uich, arue R5, a1a8 | https://maps.app.goo.gl/nZy5kUQX6rs7kTSy5'].join('\n');
  const candidates = parseOcr(ocr);
  assert.equal(candidates[0].shortId, 'qfTEuzxhVBLmubXB9');
  assert.equal(candidates[0].ocrName, 'Gateway of India');
  assert.equal(candidates[1].ocrName, null);
});

test('records keep provenance, stay pending review and never invent missing values', () => {
  const candidates = parseOcr(['=== PAGE 1 ===', '1 | Gateway of India | https://maps.app.goo.gl/qfTEuzxhVBLmubXB9', '2 | Badhwar Park | https://maps.app.goo.gl/nZy5kUQX6rs7kTSy5', '3 | Gateway of India | https://maps.app.goo.gl/qfTEuzxhVBLmubXB9'].join('\n'));
  const records = buildRecords(candidates, { qfTEuzxhVBLmubXB9: { status: 302, location: 'https://www.google.com/maps/place/X/data=!3d18.922012!4d72.834567' }, nZy5kUQX6rs7kTSy5: { status: 404, location: null } }, '2026-11-25T00:00:00Z');
  assert.equal(records.length, 2, 'repeated short link is merged, not duplicated');
  assert.equal(records[0].quality.duplicateMentions, 1);
  assert.equal(records[0].coordinates.kind, 'official-link');
  assert.equal(records[0].provenance.verificationStatus, 'PENDING_REVIEW');
  assert.equal(records[0].provenance.festivalYear, 2025);
  assert.equal(records[1].coordinates, null);
  assert.equal(records[1].quality.linkResolved, false);
  assert.equal(records[1].address, null);
});
