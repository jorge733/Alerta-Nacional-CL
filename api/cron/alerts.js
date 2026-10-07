const { sql, init, baseUrl, esc, safeEqual, sendMail } = require('../_lib');
const { collect, sameQuake } = require('../_sources');

const MIN_MAGNITUDE = 4.5;       // Lowest threshold a subscriber can choose.
const FOREIGN_MIN_MAGNITUDE = 6; // Border events (Argentina, Bolivia, Perú) only when strong enough to be felt in Chile.
const MAX_EVENT_AGE_H = 3;       // Never alert about old earthquakes or bulletins (e.g. on the first run).
const MAX_WEATHER_AGE_H = 24;    // DMC alerts stay valid for days; only mail recently issued ones.
const TIME_BUDGET_MS = 8000;
const BATCH = 5;

const when = time => new Date(time).toLocaleString('es-CL', { timeZone: 'America/Santiago', dateStyle: 'full', timeStyle: 'short' });
const SOURCE_NAMES = { CSN: 'Centro Sismológico Nacional (Universidad de Chile)', USGS: 'Servicio Geológico de EE.UU. (USGS)', DMC: 'Dirección Meteorológica de Chile (DMC)', SHOA: 'Servicio Hidrográfico y Oceanográfico de la Armada (SHOA)' };
const credit = sources => sources.map(source => SOURCE_NAMES[source] || source).join(' y ');
const row = (label, value) => `<tr><td style="padding:2px 12px 2px 0;color:#666;vertical-align:top">${label}</td><td>${esc(value)}</td></tr>`;

// Each type decides which of its events deserve an email and how the email reads.
const TYPES = {
  Sismo: {
    candidates: ({ quakes }) => quakes.filter(e => e.mag >= MIN_MAGNITUDE && Date.now() - e.time < MAX_EVENT_AGE_H * 36e5 && (!e.foreign || e.mag >= FOREIGN_MIN_MAGNITUDE)),
    subject: a => `Sismo M${Number(a.magnitude).toFixed(1)} · ${a.region}`,
    body: (a, d) => `<h1 style="font-size:22px;margin:8px 0">Magnitud ${Number(a.magnitude).toFixed(1)} · ${esc(a.region)}</h1>
<p style="margin:0 0 12px">${esc(d.place)}</p>
<table style="font-size:14px;border-collapse:collapse">${row('Hora (Chile)', when(d.time))}${row('Profundidad', `${Number(d.depth).toFixed(0)} km`)}${row('Región estimada', a.region)}${row('Fuente', d.sources.join(' + '))}</table>
${Number(a.magnitude) >= 6.5 ? '<p style="background:#fef3f2;border-left:4px solid #b42318;padding:10px;margin:16px 0"><b>Si estás en la costa y el sismo te impidió mantenerte en pie, evacúa a zona segura sin esperar una alerta oficial.</b></p>' : ''}`,
    disclaimer: d => `Información preliminar de ${credit(d.sources)}; magnitud y ubicación pueden ser revisadas.`,
  },
  // Avisos are frequent and low severity: they appear on the panel but aren't mailed.
  'Meteorológico': {
    candidates: ({ weather }) => weather.filter(e => e.level !== 'Aviso' && Date.now() - e.time < MAX_WEATHER_AGE_H * 36e5),
    subject: ({ details: d }) => `${d.level} meteorológica por ${d.phenomenon.toLowerCase()} · ${d.regions.length <= 3 ? d.regions.join(', ') : 'Varias regiones'}`,
    body: (a, d) => `<h1 style="font-size:22px;margin:8px 0">${esc(d.level)} por ${esc(d.phenomenon.toLowerCase())}</h1>
<p style="margin:0 0 12px">${esc(d.place)}</p>
<table style="font-size:14px;border-collapse:collapse">${row('Vigencia', d.validity)}${row('Regiones', d.regions.join(', '))}${d.note ? row('Observación', d.note) : ''}${row('Emitida', when(d.time))}${row('Código', d.code)}</table>`,
    disclaimer: d => `Información de la ${credit(d.sources)}.`,
  },
  Tsunami: {
    candidates: ({ tsunami }) => tsunami.filter(e => e.threat && Date.now() - e.time < MAX_EVENT_AGE_H * 36e5),
    subject: a => `Tsunami: ${a.title}`,
    body: (a, d) => `<h1 style="font-size:22px;margin:8px 0">${esc(d.level)}</h1>
<p style="margin:0 0 12px">Sismo ${d.mag ? `M${Number(d.mag).toFixed(1)} ` : ''}${esc(d.place)}</p>
<table style="font-size:14px;border-collapse:collapse">${row('Hora del sismo (Chile)', when(d.time))}</table>
<p style="background:#fef3f2;border-left:4px solid #b42318;padding:10px;margin:16px 0"><b>Sigue las instrucciones de SENAPRED y de la autoridad marítima. Si te ordenan evacuar, hazlo de inmediato hacia zonas seguras.</b></p>`,
    disclaimer: d => `Boletín del ${credit(d.sources)}.`,
  },
};

function alertMail(alert, unsubscribeUrl) {
  const d = alert.details, type = TYPES[alert.type];
  return `<div style="font-family:Arial,sans-serif;max-width:560px;color:#1a1a1a">
<p style="font-size:12px;letter-spacing:1px;color:#b42318;margin:0">ALERTA NACIONAL CL · ${esc(alert.type.toUpperCase())}</p>
${type.body(alert, d)}
<p><a href="${esc(d.url)}">Ver detalle en la fuente oficial</a> · <a href="${baseUrl()}">Ver panel en vivo</a></p>
<p style="font-size:12px;color:#666">${esc(type.disclaimer(d))} Alerta Nacional CL es un servicio informativo y no reemplaza las alertas oficiales de SENAPRED, SHOA, DMC ni el Centro Sismológico Nacional.</p>
<p style="font-size:12px;color:#666"><a href="${unsubscribeUrl}">Cancelar suscripción</a></p>
</div>`;
}

async function candidates() {
  const data = await collect();
  const events = Object.values(TYPES).flatMap(type => type.candidates(data));
  return { status: data.status, events };
}

module.exports = async (req, res) => {
  const auth = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!process.env.CRON_SECRET || !safeEqual(auth, process.env.CRON_SECRET)) return res.status(401).json({ error: 'No autorizado' });
  const started = Date.now();
  const { status, events } = await candidates();
  if (req.query.dry) return res.json({ dryRun: true, sources: status, candidates: events });

  await init();
  const db = sql();
  // An earthquake first seen by USGS and later by CSN arrives under another id; match it against recent alerts.
  const recentQuakes = (await db`SELECT details FROM alerts WHERE type = 'Sismo' AND occurred_at > NOW() - INTERVAL '12 hours'`).map(r => r.details);
  let created = 0;
  for (const e of events) {
    if (e.type === 'Sismo' && recentQuakes.some(q => q.id !== e.id && Number.isFinite(q.lat) && sameQuake(q, e))) continue;
    const title = e.type === 'Sismo' ? `Sismo M${e.mag.toFixed(1)} · ${e.region}` : e.title;
    const rows = await db`INSERT INTO alerts (event_id, type, region, regions, magnitude, title, details, occurred_at)
      VALUES (${e.id}, ${e.type}, ${e.region}, ${e.regions}, ${e.type === 'Sismo' ? e.mag : null}, ${title}, ${JSON.stringify(e)}, ${new Date(e.time).toISOString()})
      ON CONFLICT (event_id) DO NOTHING RETURNING event_id`;
    created += rows.length;
    if (rows.length && e.type === 'Sismo') recentQuakes.push(e);
  }

  const pending = await db`SELECT * FROM alerts WHERE completed_at IS NULL AND created_at > NOW() - make_interval(hours => ${MAX_EVENT_AGE_H * 2}) ORDER BY occurred_at`;
  let sent = 0, failed = null;
  for (const alert of pending) {
    if (!TYPES[alert.type]) { await db`UPDATE alerts SET completed_at = NOW() WHERE event_id = ${alert.event_id}`; continue; }
    // NULL regions (rows from before this column existed) fall back to the single region.
    const regions = alert.regions || (alert.region ? [alert.region] : []);
    while (!failed && Date.now() - started < TIME_BUDGET_MS) {
      // Magnitude preferences only apply to earthquakes; alerts without regions (tsunami) go to everyone.
      const recipients = await db`SELECT s.email, s.unsubscribe_token FROM subscribers s
        WHERE s.status = 'active'
          AND (${alert.type} <> 'Sismo' OR s.min_magnitude <= ${alert.magnitude})
          AND (cardinality(s.regions) = 0 OR cardinality(${regions}::text[]) = 0 OR s.regions && ${regions}::text[])
          AND (cardinality(s.types) = 0 OR ${alert.type} = ANY(s.types))
          AND NOT EXISTS (SELECT 1 FROM alert_deliveries d WHERE d.event_id = ${alert.event_id} AND d.email = s.email)
        LIMIT ${BATCH}`;
      if (!recipients.length) { await db`UPDATE alerts SET completed_at = NOW() WHERE event_id = ${alert.event_id}`; break; }
      const results = await Promise.allSettled(recipients.map(async r => {
        const unsubscribeUrl = `${baseUrl()}/api/unsubscribe?token=${r.unsubscribe_token}`;
        await sendMail(r.email, TYPES[alert.type].subject(alert), alertMail(alert, unsubscribeUrl), { unsubscribeUrl });
        await db`INSERT INTO alert_deliveries (event_id, email) VALUES (${alert.event_id}, ${r.email}) ON CONFLICT DO NOTHING`;
      }));
      sent += results.filter(r => r.status === 'fulfilled').length;
      // Stop on any failure (usually a Gmail quota or auth problem); the next run resumes where this one left off.
      const rejected = results.find(r => r.status === 'rejected');
      if (rejected) failed = rejected.reason.message;
    }
    if (failed || Date.now() - started >= TIME_BUDGET_MS) break;
  }
  res.status(failed ? 502 : 200).json({ sources: status, candidates: events.length, newAlerts: created, pendingAlerts: pending.length, sent, error: failed });
};

// Exposed for local tests.
module.exports.alertMail = alertMail;
module.exports.TYPES = TYPES;
