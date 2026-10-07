const { sql, init, token, baseUrl, sendMail } = require('./_lib');
const { REGIONS, TYPES } = require('../dist/regions.js');
const MAGNITUDES = [4.5, 5.0, 5.5, 6.0, 7.0];
const pick = (value, allowed) => [...new Set((Array.isArray(value) ? value : []).filter(item => allowed.includes(item)))];
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({error:'Método no permitido'});
  const { email, consent, regions, types, minMagnitude } = req.body || {};
  const normalized = String(email || '').trim().toLowerCase();
  if (!consent || normalized.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) return res.status(400).json({error:'Ingresa un correo válido y acepta recibir alertas.'});
  const prefs = { regions: pick(regions, REGIONS), types: pick(types, TYPES), minMagnitude: MAGNITUDES.includes(Number(minMagnitude)) ? Number(minMagnitude) : 5.0 };
  await init();
  // Throttle repeat requests so the form can't be used to flood a mailbox.
  const recent = await sql()`SELECT 1 FROM subscribers WHERE email = ${normalized} AND verify_token IS NOT NULL AND requested_at > NOW() - INTERVAL '2 minutes'`;
  if (recent[0]) return res.status(429).json({error:'Ya enviamos un correo hace poco. Revisa tu bandeja (y spam) antes de intentarlo de nuevo.'});
  const verify = token();
  // Active subscribers stay active; new preferences apply only after confirming by email.
  await sql()`INSERT INTO subscribers (email, status, verify_token, pending_prefs, unsubscribe_token) VALUES (${normalized}, 'pending', ${verify}, ${JSON.stringify(prefs)}, ${token()})
    ON CONFLICT (email) DO UPDATE SET status = CASE WHEN subscribers.status = 'active' THEN 'active' ELSE 'pending' END, verify_token = EXCLUDED.verify_token, pending_prefs = EXCLUDED.pending_prefs, requested_at = NOW()`;
  await sendMail(normalized, 'Confirma tus alertas de Alerta Nacional CL', `<p>Confirma tu correo para activar alertas verificadas de Chile.</p><p><a href="${baseUrl()}/api/verify?token=${verify}">Confirmar suscripción</a></p><p style="color:#666;font-size:13px">Si no solicitaste esto, ignora este mensaje.</p>`);
  res.status(202).json({message:'Revisa tu correo para confirmar la suscripción.'});
};
