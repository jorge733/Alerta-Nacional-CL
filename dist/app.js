const EVENTS_URL = '/api/events';
const USGS_URL = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson';
let deferredInstallPrompt;
const { REGIONS, inChileBox, fromUsgs } = window.AlertaRegions;
let liveEvents = [];
const events = document.querySelector('#events');
const $ = selector => document.querySelector(selector);
const esc = value => String(value).replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' })[char]);
const hhmm = time => new Date(time).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
function age(time) { const min = Math.max(0, Math.round((Date.now() - time) / 60000)); if (min < 1) return 'Ahora'; if (min < 60) return `Hace ${min} min`; if (min < 2880) return `Hace ${Math.round(min / 60)} h`; return `Hace ${Math.round(min / 1440)} d`; }
// Warnings that need attention now, as opposed to informative events.
const isAlert = event => event.type === 'Sismo' ? event.mag >= 5.5 : event.type === 'Tsunami' ? event.threat : event.level !== 'Aviso';
const SOURCE_LINKS = { CSN: 'https://www.sismologia.cl/', USGS: 'https://earthquake.usgs.gov/earthquakes/feed/', DMC: 'https://archivos.meteochile.gob.cl/portaldmc/AAA/aaa_mapa.php', SHOA: 'https://www.snamchile.cl/' };
const sourceBadge = event => `<span class="source">Fuente: ${event.sources.map(esc).join(' + ')}</span>`;

function eventHtml(event) {
  if (event.type === 'Meteorológico') return `<article class="event"><time>${age(event.time)}</time><div><h3>${esc(event.level)} por ${esc(event.phenomenon.toLowerCase())} · ${esc(event.regions.join(', ') || event.region)}</h3><p>${esc(event.validity)}${event.note ? ` · ${esc(event.note)}` : ''} · Emitido ${hhmm(event.time)} ${sourceBadge(event)}</p></div><a class="tag meteo${isAlert(event) ? ' grave' : ''}" href="${esc(event.url)}" target="_blank" rel="noreferrer">${esc(event.level.toUpperCase())} ↗</a></article>`;
  if (event.type === 'Tsunami') return `<article class="event"><time>${age(event.time)}</time><div><h3>${esc(event.level)}</h3><p>Sismo ${event.mag ? `M ${Number(event.mag).toFixed(1)} · ` : ''}${esc(event.place)} · ${hhmm(event.time)} ${sourceBadge(event)}</p></div><a class="tag tsunami${event.threat ? ' grave' : ''}" href="${esc(event.url)}" target="_blank" rel="noreferrer">TSUNAMI ↗</a></article>`;
  return `<article class="event"><time>${age(event.time)}</time><div><h3>Magnitud ${event.mag.toFixed(1)} · ${esc(event.place)}</h3><p>${esc(event.foreign ? `Zona fronteriza · cerca de ${event.region}` : event.region)} · Profundidad ${event.depth.toFixed(1)} km · ${hhmm(event.time)} ${sourceBadge(event)}</p></div><a class="tag sismo" href="${esc(event.url)}" target="_blank" rel="noreferrer">SISMO ↗</a></article>`;
}

function render() {
  const region = $('#region').value, type = $('#type').value;
  // Events without regions (tsunami bulletins) concern the whole coast.
  const list = liveEvents.filter(event => (region === 'Todas' || (!event.regions.length && event.type !== 'Sismo') || (event.regions.includes(region) && !event.foreign)) && (type === 'Todos' || event.type === type));
  $('#count').textContent = `${list.length} ${list.length === 1 ? 'evento' : 'eventos'}`;
  events.innerHTML = list.length ? list.slice(0, 12).map(eventHtml).join('') : '<p class="disclaimer">No hay eventos recientes que coincidan con estos filtros.</p>';
}

async function loadFromApi() {
  // The minute-based key lets the CDN cache serve everyone while still refreshing each minute.
  const response = await fetch(`${EVENTS_URL}?_=${Math.floor(Date.now() / 60000)}`);
  if (!response.ok) throw new Error('Fuente no disponible');
  return response.json();
}
// If our API is down, keep the panel alive with USGS, which allows cross-origin reads.
async function loadFromUsgs() {
  const response = await fetch(`${USGS_URL}?_=${Date.now()}`, { cache: 'no-store', headers: { 'Cache-Control': 'no-cache' } });
  if (!response.ok) throw new Error('Fuente no disponible');
  const feed = await response.json();
  return { generated: feed.metadata.generated, sources: { USGS: 'ok' }, events: feed.features.filter(item => inChileBox(item.geometry.coordinates[1], item.geometry.coordinates[0])).map(fromUsgs) };
}

async function loadEvents() {
  try {
    const data = await loadFromApi().catch(loadFromUsgs);
    // Warnings first (weather and tsunami, then strong earthquakes), each group newest first.
    liveEvents = data.events.sort((a, b) => (b.type !== 'Sismo') - (a.type !== 'Sismo') || isAlert(b) - isAlert(a) || b.time - a.time);
    const quakes = liveEvents.filter(event => event.type === 'Sismo');
    const tsunami = liveEvents.find(event => event.type === 'Tsunami' && event.threat);
    const weather = liveEvents.filter(event => event.type === 'Meteorológico' && isAlert(event));
    $('#today-count').textContent = liveEvents.length;
    $('#alert-count').textContent = liveEvents.filter(isAlert).length;
    const latest = quakes[0];
    const latestAgeHours = latest ? (Date.now() - latest.time) / 36e5 : Infinity;
    if (tsunami) {
      $('#national-status').innerHTML = 'Boletín de tsunami<br>vigente';
      $('#national-detail').textContent = `${tsunami.level} (SHOA). Sigue las instrucciones de SENAPRED.`;
    } else {
      $('#national-status').innerHTML = latest && latestAgeHours < 6 ? 'Actividad sísmica<br>reciente' : 'Sin eventos<br>recientes';
      $('#national-detail').textContent = (latest ? `Último sismo: M ${latest.mag.toFixed(1)} · ${latest.place} (${age(latest.time).toLowerCase()}).` : 'No se registran sismos dentro del área de monitoreo.')
        + (weather.length ? ` ${weather.length} ${weather.length === 1 ? 'alerta meteorológica vigente' : 'alertas meteorológicas vigentes'} (DMC).` : '');
    }
    $('#updated').textContent = `Actualizado ${hhmm(data.generated)}`;
    $('#sources').innerHTML = Object.entries(data.sources).map(([name, status]) => `<a href="${SOURCE_LINKS[name]}" target="_blank" rel="noreferrer" class="${status === 'ok' ? 'up' : 'down'}" title="${esc(status === 'ok' ? 'En línea' : status)}">${esc(name)}</a>`).join(' · ');
    render();
  } catch (error) {
    $('#national-status').innerHTML = 'Fuente temporalmente<br>no disponible'; $('#national-detail').textContent = 'Reintentaremos la conexión automáticamente.'; $('#count').textContent = 'Sin conexión'; events.innerHTML = '<p class="disclaimer">No fue posible cargar datos en vivo. Revisa los canales oficiales mientras se restablece la conexión.</p>';
  }
}
$('#sub-region').insertAdjacentHTML('beforeend', REGIONS.map(name => `<option>${esc(name)}</option>`).join(''));
$('#filter').addEventListener('click', render);
window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); deferredInstallPrompt = event; const button = $('#install-app'); button.hidden = false; });
$('#install-app').addEventListener('click', async () => { if (!deferredInstallPrompt) return; deferredInstallPrompt.prompt(); await deferredInstallPrompt.userChoice; deferredInstallPrompt = null; $('#install-app').hidden = true; });
window.addEventListener('appinstalled', () => { $('#install-app').hidden = true; });
$('#subscription-form').addEventListener('submit', async event => { event.preventDefault(); const form = event.target; const message = $('#form-message'); message.textContent = 'Enviando confirmación…'; try { const response = await fetch('/api/subscribe', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:$('#email').value,consent:form.querySelector('input[type="checkbox"]').checked,regions:$('#sub-region').value ? [$('#sub-region').value] : [],types:$('#sub-type').value ? [$('#sub-type').value] : [],minMagnitude:Number($('#sub-mag').value)})}); const result = await response.json(); if (!response.ok) throw new Error(result.error); message.textContent = result.message; form.reset(); } catch (error) { message.textContent = error.message || 'No fue posible procesar tu solicitud.'; } });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js');
loadEvents(); setInterval(loadEvents, 60000);
