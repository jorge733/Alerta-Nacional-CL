const FEED_URL = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson';
let deferredInstallPrompt;
const { REGIONS, inChileBox, fromUsgs } = window.AlertaRegions;
let liveEvents = [];
const events = document.querySelector('#events');
const $ = selector => document.querySelector(selector);
const esc = value => String(value).replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' })[char]);
function age(time) { const min = Math.max(0, Math.round((Date.now() - time) / 60000)); if (min < 1) return 'Ahora'; if (min < 60) return `Hace ${min} min`; return `Hace ${Math.round(min / 60)} h`; }
function render() {
  const region = $('#region').value, type = $('#type').value;
  const list = liveEvents.filter(event => (region === 'Todas' || (event.region === region && !event.foreign)) && (type === 'Todos' || event.type === type));
  $('#count').textContent = `${list.length} ${list.length === 1 ? 'evento' : 'eventos'}`;
  events.innerHTML = list.length ? list.slice(0, 8).map(event => `<article class="event"><time>${age(event.time)}</time><div><h3>Magnitud ${event.mag.toFixed(1)} · ${esc(event.place)}</h3><p>${esc(event.foreign ? `Zona fronteriza · cerca de ${event.region}` : event.region)} · Profundidad ${event.depth.toFixed(1)} km · ${new Date(event.time).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}</p></div><a class="tag sismo" href="${esc(event.url)}" target="_blank" rel="noreferrer">SISMO ↗</a></article>`).join('') : '<p class="disclaimer">No hay eventos sísmicos recientes que coincidan con estos filtros.</p>';
}
async function loadEarthquakes() {
  try {
    const response = await fetch(`${FEED_URL}?_=${Date.now()}`, { cache: 'no-store', headers: { 'Cache-Control': 'no-cache' } });
    if (!response.ok) throw new Error('Fuente no disponible');
    const feed = await response.json();
    liveEvents = feed.features.filter(item => inChileBox(item.geometry.coordinates[1], item.geometry.coordinates[0])).map(fromUsgs).sort((a, b) => b.time - a.time);
    $('#today-count').textContent = liveEvents.length;
    $('#alert-count').textContent = liveEvents.filter(event => event.mag >= 5.5).length;
    const latest = liveEvents[0];
    const latestAgeHours = latest ? (Date.now() - latest.time) / 36e5 : Infinity;
    $('#national-status').innerHTML = latest && latestAgeHours < 6 ? 'Actividad sísmica<br>reciente' : 'Sin eventos<br>recientes';
    $('#national-detail').textContent = latest ? `Último registro: M ${latest.mag.toFixed(1)} · ${latest.place} (${age(latest.time).toLowerCase()}).` : 'No se registran eventos dentro del área de monitoreo.';
    const generated = new Date(feed.metadata.generated);
    $('#updated').textContent = `Actualizado ${generated.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}`;
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
$('#subscription-form').addEventListener('submit', async event => { event.preventDefault(); const form = event.target; const message = $('#form-message'); message.textContent = 'Enviando confirmación…'; try { const response = await fetch('/api/subscribe', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:$('#email').value,consent:form.querySelector('input[type="checkbox"]').checked,regions:$('#sub-region').value ? [$('#sub-region').value] : [],minMagnitude:Number($('#sub-mag').value)})}); const result = await response.json(); if (!response.ok) throw new Error(result.error); message.textContent = result.message; form.reset(); } catch (error) { message.textContent = error.message || 'No fue posible procesar tu solicitud.'; } });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js');
loadEarthquakes(); setInterval(loadEarthquakes, 60000);
