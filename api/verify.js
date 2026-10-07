const { sql, init } = require('./_lib');
module.exports = async (req, res) => {
  await init();
  const rows = await sql()`UPDATE subscribers SET status = 'active', verified_at = NOW(), verify_token = NULL,
      regions = CASE WHEN pending_prefs IS NULL THEN regions ELSE ARRAY(SELECT jsonb_array_elements_text(pending_prefs->'regions')) END,
      types = CASE WHEN pending_prefs IS NULL THEN types ELSE ARRAY(SELECT jsonb_array_elements_text(pending_prefs->'types')) END,
      min_magnitude = COALESCE((pending_prefs->>'minMagnitude')::numeric, min_magnitude),
      pending_prefs = NULL
    WHERE verify_token = ${String(req.query.token || '')} RETURNING email`;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(rows[0] ? '<h1>Alertas activadas</h1><p>Tu correo fue verificado. Ya puedes cerrar esta página.</p>' : '<h1>Enlace no válido</h1><p>Solicita una nueva confirmación desde la plataforma.</p>');
};
