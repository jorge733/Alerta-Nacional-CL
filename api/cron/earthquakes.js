const { sql, init, baseUrl, esc, safeEqual, sendMail } = require('../_lib');
const { inChileBox, fromUsgs } = require('../../dist/regions.js');

const FEED_URL = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.geojson';
const MIN_MAGNITUDE = 4.5;       // Lowest threshold a subscriber can choose.
const FOREIGN_MIN_MAGNITUDE = 6; // Border events (Argentina, Bolivia, Perú) only when strong enough to be felt in Chile.
const MAX_EVENT_AGE_H = 3;       // Never alert about old events (e.g. on the first run).
const TIME_BUDGET_MS = 8000;
const BATCH = 5;

const when = time => new Date(time).toLocaleString('es-CL', { timeZone: 'America/Santiago', dateStyle: 'full', timeStyle: 'short' });

function alertMail(alert, unsubscribeUrl) {
  const d = alert.details;
  const strong = Number(alert.magnitude) >= 6.5;
  return `<div style="font-family:Arial,sans-serif;max-width:560px;color:#1a1a1a">
<p style="font-size:12px;letter-spacing:1px;color:#b42318;margin:0">ALERTA NACIONAL CL · SISMO</p>
<h1 style="font-size:22px;margin:8px 0">Magnitud ${Number(alert.magnitude).toFixed(1)} · ${esc(alert.region)}</h1>
<p style="margin:0 0 12px">${esc(d.place)}</p>
<table style="font-size:14px;border-collapse:collapse">
<tr><td style="padding:2px 12px 2px 0;color:#666">Hora (Chile)</td><td>${esc(when(d.time))}</td></tr>
<tr><td style="padding:2px 12px 2px 0;color:#666">Profundidad</td><td>${Number(d.depth).toFixed(0)} km</td></tr>
<tr><td style="padding:2px 12px 2px 0;color:#666">Región estimada</td><td>${esc(alert.region)}</td></tr>
</table>
${strong ? '<p style="background:#fef3f2;border-left:4px solid #b42318;padding:10px;margin:16px 0"><b>Si estás en la costa y el sismo te impidió mantenerte en pie, evacúa a zona segura sin esperar una alerta oficial.</b></p>' : ''}
<p><a href="${esc(d.url)}">Ver detalle en USGS</a> · <a href="${baseUrl()}">Ver panel en vivo</a></p>
<p style="font-size:12px;color:#666">Información preliminar del Servicio Geológico de EE.UU. (USGS); magnitud y ubicación pueden ser revisadas. Alerta Nacional CL es un servicio informativo y no reemplaza las alertas oficiales de SENAPRED, SHOA ni el Centro Sismológico Nacional.</p>
<p style="font-size:12px;color:#666"><a href="${unsubscribeUrl}">Cancelar suscripción</a></p>
</div>`;
}

async function candidates() {
  const response = await fetch(FEED_URL, { cache: 'no-store' });
  if (!response.ok) throw new Error(`USGS respondió ${response.status}`);
  const feed = await response.json();
  return feed.features.filter(f => inChileBox(f.geometry.coordinates[1], f.geometry.coordinates[0])).map(fromUsgs)
    .filter(e => e.mag >= MIN_MAGNITUDE && Date.now() - e.time < MAX_EVENT_AGE_H * 36e5 && (!e.foreign || e.mag >= FOREIGN_MIN_MAGNITUDE));
}

module.exports = async (req, res) => {
  const auth = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!process.env.CRON_SECRET || !safeEqual(auth, process.env.CRON_SECRET)) return res.status(401).json({ error: 'No autorizado' });
  const started = Date.now();
  const events = await candidates();
  if (req.query.dry) return res.json({ dryRun: true, candidates: events });

  await init();
  const db = sql();
  let created = 0;
  for (const e of events) {
    const rows = await db`INSERT INTO alerts (event_id, type, region, magnitude, title, details, occurred_at)
      VALUES (${e.id}, 'Sismo', ${e.region}, ${e.mag}, ${`Sismo M${e.mag.toFixed(1)} · ${e.region}`}, ${JSON.stringify(e)}, ${new Date(e.time).toISOString()})
      ON CONFLICT (event_id) DO NOTHING RETURNING event_id`;
    created += rows.length;
  }

  const pending = await db`SELECT * FROM alerts WHERE completed_at IS NULL AND occurred_at > NOW() - make_interval(hours => ${MAX_EVENT_AGE_H * 2}) ORDER BY occurred_at`;
  let sent = 0, failed = null;
  for (const alert of pending) {
    while (!failed && Date.now() - started < TIME_BUDGET_MS) {
      const recipients = await db`SELECT s.email, s.unsubscribe_token FROM subscribers s
        WHERE s.status = 'active' AND s.min_magnitude <= ${alert.magnitude}
          AND (cardinality(s.regions) = 0 OR ${alert.region} = ANY(s.regions))
          AND (cardinality(s.types) = 0 OR ${alert.type} = ANY(s.types))
          AND NOT EXISTS (SELECT 1 FROM alert_deliveries d WHERE d.event_id = ${alert.event_id} AND d.email = s.email)
        LIMIT ${BATCH}`;
      if (!recipients.length) { await db`UPDATE alerts SET completed_at = NOW() WHERE event_id = ${alert.event_id}`; break; }
      const results = await Promise.allSettled(recipients.map(async r => {
        const unsubscribeUrl = `${baseUrl()}/api/unsubscribe?token=${r.unsubscribe_token}`;
        await sendMail(r.email, `Sismo M${Number(alert.magnitude).toFixed(1)} · ${alert.region}`, alertMail(alert, unsubscribeUrl), { unsubscribeUrl });
        await db`INSERT INTO alert_deliveries (event_id, email) VALUES (${alert.event_id}, ${r.email}) ON CONFLICT DO NOTHING`;
      }));
      sent += results.filter(r => r.status === 'fulfilled').length;
      // Stop on any failure (usually a Gmail quota or auth problem); the next run resumes where this one left off.
      const rejected = results.find(r => r.status === 'rejected');
      if (rejected) failed = rejected.reason.message;
    }
    if (failed || Date.now() - started >= TIME_BUDGET_MS) break;
  }
  res.status(failed ? 502 : 200).json({ candidates: events.length, newAlerts: created, pendingAlerts: pending.length, sent, error: failed });
};
