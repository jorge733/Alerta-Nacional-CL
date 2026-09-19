const { neon } = require('@neondatabase/serverless');
const crypto = require('crypto');

const sql = () => neon(process.env.DATABASE_URL);
const init = async () => {
  await sql()(`CREATE TABLE IF NOT EXISTS subscribers (email TEXT PRIMARY KEY, status TEXT NOT NULL, verify_token TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), verified_at TIMESTAMPTZ)`);
  await sql()(`CREATE TABLE IF NOT EXISTS oauth_tokens (provider TEXT PRIMARY KEY, refresh_token TEXT NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
};
const token = () => crypto.randomBytes(32).toString('hex');
const baseUrl = () => process.env.APP_URL || 'https://alertanacional-cl.vercel.app';
async function sendMail(to, subject, html) {
  const rows = await sql()`SELECT refresh_token FROM oauth_tokens WHERE provider = 'gmail' LIMIT 1`;
  if (!rows[0]) throw new Error('Gmail todavía no está autorizado.');
  const body = Buffer.from(`From: Alerta Nacional CL <${process.env.GMAIL_SENDER_EMAIL}>\r\nTo: ${to}\r\nSubject: ${subject}\r\nMIME-Version: 1.0\r\nContent-Type: text/html; charset=UTF-8\r\n\r\n${html}`).toString('base64url');
  const access = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: {'Content-Type':'application/x-www-form-urlencoded'}, body: new URLSearchParams({client_id:process.env.GMAIL_CLIENT_ID, client_secret:process.env.GMAIL_CLIENT_SECRET, refresh_token:rows[0].refresh_token, grant_type:'refresh_token'}) }).then(r => r.json());
  if (!access.access_token) throw new Error('No fue posible acceder a Gmail.');
  const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {method:'POST', headers:{Authorization:`Bearer ${access.access_token}`, 'Content-Type':'application/json'}, body:JSON.stringify({raw:body})});
  if (!response.ok) throw new Error('Gmail no aceptó el mensaje.');
}
module.exports = { sql, init, token, baseUrl, sendMail };
