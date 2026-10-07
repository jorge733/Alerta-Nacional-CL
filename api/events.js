const { collect } = require('./_sources');
const TSUNAMI_WINDOW_H = 72; // SNAM keeps a month of bulletins; the panel only shows recent ones.

// Official sources don't allow cross-origin reads, so the panel reads them through here.
// The CDN cache keeps upstream traffic to about one request per source per minute.
module.exports = async (req, res) => {
  const { status, quakes, weather, tsunami } = await collect();
  res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=240');
  res.json({
    generated: Date.now(), sources: status,
    events: [...quakes, ...weather, ...tsunami.filter(e => Date.now() - e.time < TSUNAMI_WINDOW_H * 36e5)],
  });
};
