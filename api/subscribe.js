const { sql, init, token, baseUrl, sendMail } = require('./_lib');
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({error:'Método no permitido'});
  const { email, consent } = req.body || {};
  const normalized = String(email || '').trim().toLowerCase();
  if (!consent || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) return res.status(400).json({error:'Ingresa un correo válido y acepta recibir alertas.'});
  const verify = token(); await init();
  await sql()`INSERT INTO subscribers (email,status,verify_token) VALUES (${normalized},'pending',${verify}) ON CONFLICT (email) DO UPDATE SET status='pending', verify_token=EXCLUDED.verify_token`;
  await sendMail(normalized, 'Confirma tus alertas de Alerta Nacional CL', `<p>Confirma tu correo para activar alertas verificadas de Chile.</p><p><a href="${baseUrl()}/api/verify?token=${verify}">Confirmar suscripción</a></p>`);
  res.status(202).json({message:'Revisa tu correo para confirmar la suscripción.'});
};
