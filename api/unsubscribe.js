const { sql, init, esc } = require('./_lib');
// GET shows a confirmation button (mail scanners prefetch links); POST unsubscribes,
// which also covers one-click List-Unsubscribe from Gmail and other clients.
module.exports = async (req, res) => {
  const value = String(req.query.token || '');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (req.method === 'POST') {
    await init();
    await sql()`UPDATE subscribers SET status = 'unsubscribed', verify_token = NULL, pending_prefs = NULL WHERE unsubscribe_token = ${value}`;
    return res.end('<h1>Suscripción cancelada</h1><p>Ya no recibirás alertas de Alerta Nacional CL.</p>');
  }
  if (req.method !== 'GET') return res.status(405).end();
  res.end(`<h1>Cancelar alertas</h1><p>¿Quieres dejar de recibir alertas de Alerta Nacional CL?</p><form method="post" action="/api/unsubscribe?token=${esc(encodeURIComponent(value))}"><button type="submit">Cancelar suscripción</button></form>`);
};
