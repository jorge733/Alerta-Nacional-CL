const { neon } = require('@neondatabase/serverless');
const crypto = require('crypto');

const sql = () => neon(process.env.DATABASE_URL);
const migrate = async () => {
  const db = sql();
  await db`CREATE TABLE IF NOT EXISTS subscribers (email TEXT PRIMARY KEY, status TEXT NOT NULL, verify_token TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), verified_at TIMESTAMPTZ)`;
  await db`CREATE TABLE IF NOT EXISTS oauth_tokens (provider TEXT PRIMARY KEY, refresh_token TEXT NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
  // Alert preferences. Empty regions/types arrays mean "all".
  await db`ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS regions TEXT[] NOT NULL DEFAULT '{}'`;
  await db`ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS types TEXT[] NOT NULL DEFAULT '{}'`;
  await db`ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS min_magnitude NUMERIC NOT NULL DEFAULT 5.0`;
  await db`ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS pending_prefs JSONB`;
  await db`ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS unsubscribe_token TEXT`;
  await db`ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`;
  await db`UPDATE subscribers SET unsubscribe_token = md5(random()::text || email || clock_timestamp()::text) || md5(random()::text) WHERE unsubscribe_token IS NULL`;
  // One row per emergency event; deliveries make retries idempotent per subscriber.
  await db`CREATE TABLE IF NOT EXISTS alerts (event_id TEXT PRIMARY KEY, type TEXT NOT NULL, region TEXT, magnitude NUMERIC, title TEXT NOT NULL, details JSONB NOT NULL, occurred_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), completed_at TIMESTAMPTZ)`;
  // Every region an alert applies to; empty means nationwide (e.g. tsunami).
  await db`ALTER TABLE alerts ADD COLUMN IF NOT EXISTS regions TEXT[]`;
  await db`CREATE TABLE IF NOT EXISTS alert_deliveries (event_id TEXT NOT NULL REFERENCES alerts(event_id), email TEXT NOT NULL, sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY (event_id, email))`;
};
// Run migrations once per warm function instance.
let ready = null;
const init = () => ready || (ready = migrate().catch(error => { ready = null; throw error; }));
const token = () => crypto.randomBytes(32).toString('hex');
const baseUrl = () => process.env.APP_URL || 'https://alertanacional-cl.vercel.app';
const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' })[char]);
const safeEqual = (a, b) => { const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || '')); return x.length > 0 && x.length === y.length && crypto.timingSafeEqual(x, y); };
// RFC 2047 so subjects with tildes and "·" render correctly.
const mimeHeader = text => /^[\x20-\x7e]*$/.test(text) ? text : `=?UTF-8?B?${Buffer.from(text).toString('base64')}?=`;

let cachedAccess = null;
async function accessToken() {
  if (cachedAccess && cachedAccess.expires > Date.now() + 60000) return cachedAccess.token;
  const rows = await sql()`SELECT refresh_token FROM oauth_tokens WHERE provider = 'gmail' LIMIT 1`;
  if (!rows[0]) throw new Error('Gmail todavía no está autorizado.');
  const access = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: {'Content-Type':'application/x-www-form-urlencoded'}, body: new URLSearchParams({client_id:process.env.GMAIL_CLIENT_ID, client_secret:process.env.GMAIL_CLIENT_SECRET, refresh_token:rows[0].refresh_token, grant_type:'refresh_token'}) }).then(r => r.json());
  if (!access.access_token) throw new Error('No fue posible acceder a Gmail.');
  cachedAccess = { token: access.access_token, expires: Date.now() + (access.expires_in || 3600) * 1000 };
  return cachedAccess.token;
}

async function sendMail(to, subject, html, { unsubscribeUrl } = {}) {
  const headers = [`From: Alerta Nacional CL <${process.env.GMAIL_SENDER_EMAIL}>`, `To: ${to}`, `Subject: ${mimeHeader(subject)}`, 'MIME-Version: 1.0', 'Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: base64'];
  if (unsubscribeUrl) headers.push(`List-Unsubscribe: <${unsubscribeUrl}>`, 'List-Unsubscribe-Post: List-Unsubscribe=One-Click');
  const raw = Buffer.from(`${headers.join('\r\n')}\r\n\r\n${Buffer.from(html).toString('base64')}`).toString('base64url');
  const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {method:'POST', headers:{Authorization:`Bearer ${await accessToken()}`, 'Content-Type':'application/json'}, body:JSON.stringify({raw})});
  if (!response.ok) throw new Error(`Gmail no aceptó el mensaje (${response.status}).`);
}
module.exports = { sql, init, token, baseUrl, esc, safeEqual, sendMail };
