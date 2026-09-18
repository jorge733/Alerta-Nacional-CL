const data = [
  { time: '12:42', type: 'Sismo', region: 'Valparaíso', title: 'Sismo percibido en la zona central', detail: 'Magnitud referencial 4.2 · Sin afectación reportada.' },
  { time: '09:18', type: 'Meteorológico', region: 'Los Lagos', title: 'Aviso de precipitaciones intensas', detail: 'Revisa condiciones locales y recomendaciones oficiales.' },
  { time: 'Ayer', type: 'Incendio', region: 'Biobío', title: 'Monitoreo preventivo de condiciones de riesgo', detail: 'Información general de prevención y autocuidado.' }
];
const events = document.querySelector('#events');
function render() {
  const region = document.querySelector('#region').value;
  const type = document.querySelector('#type').value;
  const list = data.filter(e => (region === 'Todas' || e.region === region) && (type === 'Todos' || e.type === type));
  document.querySelector('#count').textContent = `${list.length} ${list.length === 1 ? 'evento' : 'eventos'}`;
  events.innerHTML = list.length ? list.map(e => `<article class="event"><time>${e.time}</time><div><h3>${e.title}</h3><p>${e.region} · ${e.detail}</p></div><span class="tag ${e.type.toLowerCase()}">${e.type.toUpperCase()}</span></article>`).join('') : '<p class="disclaimer">No hay eventos que coincidan con estos filtros.</p>';
}
document.querySelector('#filter').addEventListener('click', render);
document.querySelector('#subscription-form').addEventListener('submit', e => { e.preventDefault(); document.querySelector('#form-message').textContent = 'Solicitud recibida. Conecta un proveedor de correo para activar los envíos.'; e.target.reset(); });
render();
