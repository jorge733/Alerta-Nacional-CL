const crypto = require('crypto');
const { safeEqual } = require('../_lib');
// Admin-only: /api/gmail/connect?key=ADMIN_SECRET. Without the gate anyone could
// authorize their own Gmail account and replace the platform's sender.
module.exports = (req,res) => {
  if (!process.env.ADMIN_SECRET || !safeEqual(req.query.key, process.env.ADMIN_SECRET)) return res.status(403).send('No autorizado.');
  const nonce = crypto.randomBytes(24).toString('hex');
  const p = new URLSearchParams({client_id:process.env.GMAIL_CLIENT_ID,redirect_uri:process.env.GMAIL_REDIRECT_URI,response_type:'code',scope:'openid email https://www.googleapis.com/auth/gmail.send',access_type:'offline',prompt:'consent',state:nonce,login_hint:process.env.GMAIL_SENDER_EMAIL||''});
  res.writeHead(302,{Location:`https://accounts.google.com/o/oauth2/v2/auth?${p}`, 'Set-Cookie':`oauth_state=${nonce}; HttpOnly; Secure; SameSite=Lax; Path=/api/gmail; Max-Age=600`});
  res.end();
};
