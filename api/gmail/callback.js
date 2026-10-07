const { sql, init } = require('../_lib');
module.exports = async (req,res) => {
  const state = (req.headers.cookie || '').match(/(?:^|; )oauth_state=([^;]+)/)?.[1];
  if (!req.query.code || !state || state !== req.query.state) return res.status(400).send('Autorización no válida.');
  const data = await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({code:req.query.code,client_id:process.env.GMAIL_CLIENT_ID,client_secret:process.env.GMAIL_CLIENT_SECRET,redirect_uri:process.env.GMAIL_REDIRECT_URI,grant_type:'authorization_code'})}).then(r=>r.json());
  if (!data.refresh_token) return res.status(400).send('No se recibió autorización de Gmail.');
  // The id_token comes straight from Google's token endpoint over TLS, so its claims can be read without re-verifying the signature.
  let claims = {};
  try { claims = JSON.parse(Buffer.from(String(data.id_token || '').split('.')[1] || '', 'base64url').toString()); } catch {}
  const expected = String(process.env.GMAIL_SENDER_EMAIL || '').toLowerCase();
  if (!expected || !claims.email_verified || String(claims.email).toLowerCase() !== expected) return res.status(403).send('La cuenta autorizada no corresponde al remitente configurado.');
  await init();
  await sql()`INSERT INTO oauth_tokens (provider,refresh_token) VALUES ('gmail',${data.refresh_token}) ON CONFLICT (provider) DO UPDATE SET refresh_token=EXCLUDED.refresh_token, updated_at=NOW()`;
  res.setHeader('Set-Cookie','oauth_state=; HttpOnly; Secure; SameSite=Lax; Path=/api/gmail; Max-Age=0');
  res.send('<h1>Gmail conectado</h1><p>Alerta Nacional CL ya puede enviar confirmaciones y alertas.</p>');
};
