import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';

const dir = process.env.DATA_DIR ? resolve(process.env.DATA_DIR) : join(process.cwd(), 'data');
const file = join(dir, 'demo.json');
const SCHEMA_VERSION = 3;

// Official site lists produced by scripts/import-*.mjs. Records keep their source, festival year and review status.
const OFFICIAL_SOURCES = ['mcgm-ganeshotsav-2025.json'].map(name => JSON.parse(readFileSync(new URL(`./sources/${name}`, import.meta.url), 'utf8')));
// Fictional demo fixtures are tracked separately from the mutable runtime store.
const demoSites = JSON.parse(readFileSync(new URL('./seeds/demo-sites.json', import.meta.url), 'utf8'));
const demoSlotTemplate = JSON.parse(readFileSync(new URL('./seeds/demo-slot-template.json', import.meta.url), 'utf8'));
const demoSeedHash = createHash('sha256').update(JSON.stringify({ demoSites, demoSlotTemplate })).digest('hex').slice(0, 12);
// Fictional, bookable demo sites (Pune and Bengaluru) are shown by default and clearly labelled; DEMO_SITES=false hides them.
const includeDemo = () => process.env.DEMO_SITES !== 'false';

const demoProvenance = { kind: 'demo', label: 'Fictional demo site', authority: null, sourceUrl: null, festivalYear: null, verifiedAt: null };
// Synthetic coordinates are for demo distance sorting only, never verified real facilities.
const seededSlots = site => demoSlotTemplate.times.map((time, i) => ({
  siteId: site.id,
  time,
  capacity: demoSlotTemplate.capacityPerSlot,
  booked: demoSlotTemplate.bookedBySite?.[site.id]?.[i] ?? demoSlotTemplate.defaultBookedByIndex[i] ?? 0,
}));
const withDemoMetadata = (site, observedAt) => ({ ...site, provenance: demoProvenance, statusSource: { kind: 'demo', source: 'VisarjanOps sample simulation', observedAt } });
// Official records carry no status of their own; status only comes from authenticated staff updates or a future authorised feed.
const officialSite = r => ({ id: r.id, name: r.name, nameSource: r.nameSource, city: r.city, area: r.area, address: r.address || null, siteType: r.siteType, coordinates: r.coordinates, sourceLink: r.sourceLink, provenance: r.provenance, quality: r.quality, facilities: r.facilities || [], icon: '◉', description: null, hours: null });
const catalogue = observedAt => [...OFFICIAL_SOURCES.flatMap(s => s.records.map(officialSite)), ...(includeDemo() ? demoSites.map(s => withDemoMetadata(s, observedAt)) : [])];
const catalogueVersion = () => OFFICIAL_SOURCES.map(s => `${s.source.id}@${s.source.extractedAt}`).join(',') + (includeDemo() ? `+demo:${demoSeedHash}` : '');
const STAFF_FIELDS = ['status', 'waiting', 'wait', 'statusSource'];

async function save(db) {
  await mkdir(dir, { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(db, null, 2));
  await rename(temporary, file);
}

export async function seed(reset = false) {
  await mkdir(dir, { recursive: true });
  if (!reset) { try { await readFile(file); return; } catch {} }
  const list = catalogue(new Date().toISOString());
  await save({ schemaVersion: SCHEMA_VERSION, catalogueVersion: catalogueVersion(), sites: list, slots: list.filter(s => s.provenance?.kind === 'demo').flatMap(seededSlots), bookings: [], feedback: [], apifyImports: [] });
}

// Re-syncs the stored site list with the source files. Keeps bookings, slot counts, staff status updates
// and any operator verification decision; never overwrites a site an operator has verified or rejected.
function sync(db) {
  if (db.schemaVersion === SCHEMA_VERSION && db.catalogueVersion === catalogueVersion()) return false;
  const previous = new Map((db.sites || []).map(s => [s.id, s]));
  db.sites = catalogue(new Date().toISOString()).map(next => {
    const old = previous.get(next.id);
    if (!old) return next;
    if (['VERIFIED', 'REJECTED'].includes(old.provenance?.verificationStatus)) return old;
    const kept = Object.fromEntries(STAFF_FIELDS.filter(k => k in old && old.statusSource?.kind !== 'demo').map(k => [k, old[k]]));
    return { ...next, ...kept };
  });
  db.slots ||= [];
  for (const s of db.sites.filter(s => s.provenance?.kind === 'demo' && !db.slots.some(x => x.siteId === s.id))) db.slots.push(...seededSlots(s));
  db.bookings ||= []; db.feedback ||= [];
  db.schemaVersion = SCHEMA_VERSION;
  db.catalogueVersion = catalogueVersion();
  return true;
}

export const officialSources = () => OFFICIAL_SOURCES.map(s => ({ ...s.source, stats: s.stats }));

export async function read() {
  const db = JSON.parse(await readFile(file, 'utf8'));
  if (!Array.isArray(db.apifyImports)) db.apifyImports = [];
  if (sync(db)) await save(db);
  return db;
}
export async function write(db) { await save(db); }
