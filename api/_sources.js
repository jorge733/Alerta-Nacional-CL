// Official data sources, normalized to the event shape used across the app:
// { id, type, sources, title?, mag?, place, lat?, lon?, region, regions, foreign?, time, url, level? }
const { inChileBox, regionAt, foreignAt, regionByName, fromUsgs } = require('../dist/regions.js');

const USGS_URL = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson';
const CSN_BASE = 'https://www.sismologia.cl';
const DMC_URL = 'https://archivos.meteochile.gob.cl/portaldmc/AAA/datos_AAA.json';
const DMC_PAGE = 'https://archivos.meteochile.gob.cl/portaldmc/AAA/aaa_mapa.php';
const SHOA_URL = 'https://www.snamchile.cl/';
// SHOA's firewall rejects clients that don't present a Mozilla-style user agent.
const USER_AGENT = 'Mozilla/5.0 (compatible; AlertaNacionalCL/1.0; +https://alertanacional-cl.vercel.app)';
const TIMEOUT_MS = 6000;

async function get(url, as = 'text') {
  const response = await fetch(url, { cache: 'no-store', headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) throw new Error(`${new URL(url).hostname} respondió ${response.status}`);
  return response[as]();
}

const ENTITIES = { aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú', ntilde: 'ñ', Ntilde: 'Ñ', uuml: 'ü', amp: '&', quot: '"', lt: '<', gt: '>', nbsp: ' ', deg: '°' };
const text = html => String(html ?? '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '')
  .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(code)).replace(/&(\w+);/g, (all, name) => ENTITIES[name] ?? all)
  .replace(/[ \t]+/g, ' ').trim();
const cells = row => [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(match => match[1]);

// Wall-clock time in Chile (continental) to epoch ms, honoring daylight saving.
const chileParts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Santiago', hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' });
function chileTime(year, month, day, hour, minute) {
  const wanted = Date.UTC(year, month - 1, day, hour, minute);
  let time = wanted;
  for (let i = 0; i < 2; i++) {
    const p = Object.fromEntries(chileParts.formatToParts(time).map(part => [part.type, Number(part.value)]));
    time += wanted - Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  }
  return time;
}

// ---------- Earthquakes: CSN preferred, USGS as backup ----------

// CSN publishes one static HTML catalog per UTC day; there is no JSON API.
// Use: free for dissemination citing "Centro Sismológico Nacional, Universidad de Chile".
function parseCsnCatalog(html) {
  return [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map(match => {
    const td = cells(match[1]);
    const link = /href="([^"]*\/informes\/[^"]*?(\d+)\.html)"/.exec(td[0] || '');
    if (!link || td.length < 5) return null;
    const utc = /(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(td[1]);
    const [lat, lon] = text(td[2]).split(/\s+/).map(Number);
    const mag = parseFloat(text(td[4]));
    if (!utc || !Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(mag)) return null;
    const region = regionAt(lat, lon);
    return {
      id: `csn-${link[2]}`, type: 'Sismo', sources: ['CSN'], mag, magType: text(td[4]).split(' ')[1] || '',
      place: text(td[0]).split('\n').slice(1).join(' ') || 'Ubicación por determinar', lat, lon, region, regions: [region], foreign: foreignAt(lat, lon),
      time: Date.UTC(utc[1], utc[2] - 1, utc[3], utc[4], utc[5], utc[6]), depth: parseFloat(text(td[3])) || 0,
      felt: /percibido/.test(match[0].slice(0, 40)), url: new URL(link[1], CSN_BASE).href,
    };
  }).filter(Boolean);
}

async function csn(now = Date.now()) {
  const day = time => { const d = new Date(time).toISOString(); return `${CSN_BASE}/sismicidad/catalogo/${d.slice(0, 4)}/${d.slice(5, 7)}/${d.slice(0, 10).replace(/-/g, '')}.html`; };
  // Today's page may not exist yet right after 00:00 UTC; yesterday's covers the last 24 h.
  const pages = await Promise.allSettled([get(day(now)), get(day(now - 864e5))]);
  if (pages.every(page => page.status === 'rejected')) throw pages[0].reason;
  return pages.filter(page => page.status === 'fulfilled').flatMap(page => parseCsnCatalog(page.value))
    .filter(event => now - event.time < 864e5);
}

async function usgs() {
  const feed = await get(USGS_URL, 'json');
  return feed.features.filter(f => inChileBox(f.geometry.coordinates[1], f.geometry.coordinates[0])).map(fromUsgs);
}

const distanceKm = (a, b) => {
  const rad = Math.PI / 180, dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
};
// Two agencies' solutions for one earthquake differ by seconds and tens of km.
const sameQuake = (a, b) => Math.abs(a.time - b.time) <= 60e3 && distanceKm(a, b) <= 120;

// CSN data wins; USGS fills in events CSN hasn't published (or all of them if CSN is down).
function mergeQuakes(primary, backup) {
  const merged = primary.map(event => ({ ...event }));
  for (const other of backup) {
    const match = merged.find(event => event.sources[0] === 'CSN' && sameQuake(event, other));
    if (match) { match.sources = [...match.sources, ...other.sources]; match.foreign = match.foreign || other.foreign; match.altUrl = other.url; }
    else merged.push(other);
  }
  return merged.sort((a, b) => b.time - a.time);
}

// ---------- Weather: DMC avisos, alertas y alarmas ----------

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
function dmcIssued(value) {
  const m = /(\d{1,2}) de (\w+) del? (\d{4}) a las (\d{1,2}):(\d{2})/i.exec(text(value));
  const month = m && MONTHS.indexOf(m[2].toLowerCase()) + 1;
  return month ? chileTime(+m[3], month, +m[1], +m[4], +m[5]) : null;
}

// Only currently valid products are listed. Undocumented but stable JSON behind DMC's own map.
async function dmc() {
  const data = await get(DMC_URL, 'json');
  return (data.AAA || []).map(item => {
    const regions = [...new Set(text(item.textoZonaAfecta).split('\n').map(line => regionByName(line.replace(/\s*\(.*$/, ''))).filter(Boolean))];
    const level = text(item.tipo); // Aviso | Alerta | Alarma
    const code = text(item.codigoMeteo);
    return {
      // Updates ("A531-3/2026") keep the base code, so one warning is one event.
      id: `dmc-${code.replace(/-\d+(?=\/)/, '').replace('/', '-')}`, type: 'Meteorológico', sources: ['DMC'], level, code,
      title: `${level} ${code}: ${text(item.titulo)}`, phenomenon: text(item.fenomeno), place: text(item.titulo),
      validity: `Desde ${text(item.desde)} hasta ${text(item.hasta)}`, note: text(item.observacion),
      region: regions.length === 1 ? regions[0] : 'Varias regiones', regions, time: dmcIssued(item.emision) || Date.parse(data.fecha_actualizacion) || Date.now(),
      url: `https://archivos.meteochile.gob.cl/portaldmc/AAA/doc/evento_${code.replace('/', '_')}.php`,
    };
  });
}

// ---------- Tsunami: SHOA / SNAM bulletins ----------

// The SNAM home page lists the latest bulletins in an HTML table; there is no feed or CAP.
function parseShoa(html) {
  return [...html.matchAll(/<tr>(<td[\s\S]*?)<\/tr>/gi)].map(match => {
    const td = cells(match[1]);
    const ids = [...match[1].matchAll(/modalBol\((\d+)/g)].map(m => Number(m[1]));
    const map = /modalMapa\((-?[\d.]+),\s*(-?[\d.]+),\s*'[^']*',\s*([\d.]+),\s*'[^']*',\s*'([^']*)'/.exec(match[1]);
    const local = /(\d{2})-(\d{2})-(\d{4}) (\d{2}):(\d{2})/.exec(text(td[0]));
    if (td.length < 5 || !ids.length || !local) return null;
    const status = text(td[3]).split('\n').filter(Boolean).pop() || '';
    const lat = map ? Number(map[1]) : null, lon = map ? Number(map[2]) : null;
    return {
      id: `shoa-${Math.max(...ids)}`, type: 'Tsunami', sources: ['SHOA'], level: status,
      threat: !/INFORMATIVO|SIN AMENAZA|NO RE[UÚ]NE/i.test(status),
      title: `${status} · ${text(td[1])}`, place: text(td[1]), lat, lon, mag: map ? Number(map[3]) : null, origin: map ? map[4] : '',
      // A tsunami threat applies to the whole coast, so it isn't tied to a region.
      region: 'Costa de Chile', regions: [], time: chileTime(+local[3], +local[2], +local[1], +local[4], +local[5]), url: SHOA_URL,
    };
  }).filter(Boolean);
}
const shoa = async () => parseShoa(await get(SHOA_URL));

// ---------- All sources ----------

// Never throws: each source reports its own status so one outage doesn't hide the rest.
async function collect() {
  const names = ['CSN', 'USGS', 'DMC', 'SHOA'];
  const results = await Promise.allSettled([csn(), usgs(), dmc(), shoa()]);
  const status = {}, data = {};
  results.forEach((result, i) => {
    status[names[i]] = result.status === 'fulfilled' ? 'ok' : String(result.reason && result.reason.message || result.reason);
    data[names[i]] = result.status === 'fulfilled' ? result.value : [];
  });
  return { status, quakes: mergeQuakes(data.CSN, data.USGS), weather: data.DMC, tsunami: data.SHOA };
}

module.exports = { collect, csn, usgs, dmc, shoa, mergeQuakes, sameQuake, parseCsnCatalog, parseShoa, chileTime, DMC_PAGE };
