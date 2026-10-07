// Shared by the browser (window.AlertaRegions) and the API (require('../dist/regions.js')).
(function (root) {
  const REGIONS = ['Arica y Parinacota', 'Tarapacá', 'Antofagasta', 'Atacama', 'Coquimbo', 'Valparaíso', 'Metropolitana', "O'Higgins", 'Maule', 'Ñuble', 'Biobío', 'La Araucanía', 'Los Ríos', 'Los Lagos', 'Aysén', 'Magallanes'];
  const TYPES = ['Sismo', 'Incendio forestal', 'Aluvión', 'Inundación', 'Meteorológico', 'Volcánico', 'Tsunami'];
  const CHILE = { minLat: -57, maxLat: -17, minLon: -82, maxLon: -65 };
  const FOREIGN = /argentina|bolivia|peru|perú/i;

  // Approximate region by latitude band (Chile is mostly north-south), with
  // longitude splits where regions sit side by side. Offshore events take the
  // region of the nearest coast, which is where they are felt.
  function regionAt(lat, lon) {
    if (lat > -19.2) return 'Arica y Parinacota';
    if (lat > -21.0) return 'Tarapacá';
    if (lat > -21.4) return lon < -69.0 ? 'Tarapacá' : 'Antofagasta';
    if (lat > -26.0) return 'Antofagasta';
    if (lat > -29.2) return 'Atacama';
    if (lat > -32.2) return 'Coquimbo';
    if (lat > -32.9) return 'Valparaíso';
    if (lat > -33.45) return lon < -71.2 ? 'Valparaíso' : 'Metropolitana';
    if (lat > -33.95) return lon < -71.45 ? 'Valparaíso' : 'Metropolitana';
    if (lat > -34.95) return "O'Higgins";
    if (lat > -36.0) return 'Maule';
    if (lat > -36.55) return 'Ñuble';
    if (lat > -37.2) return lon < -72.4 ? 'Biobío' : 'Ñuble';
    if (lat > -37.75) return 'Biobío';
    if (lat > -38.4) return lon < -73.15 ? 'Biobío' : 'La Araucanía';
    if (lat > -39.4) return 'La Araucanía';
    if (lat > -40.6) return 'Los Ríos';
    if (lat > -43.8) return 'Los Lagos';
    if (lat > -49.0) return 'Aysén';
    return 'Magallanes';
  }

  const inChileBox = (lat, lon) => lat >= CHILE.minLat && lat <= CHILE.maxLat && lon >= CHILE.minLon && lon <= CHILE.maxLon;

  // Approximate eastern border (lat, lon), north to south. CSN place names only
  // reference Chilean towns, so events in Argentina or Bolivia are told apart by
  // position. Coarse on purpose: a few km of error only matters right at the border.
  const BORDER = [[-17.5, -69.5], [-18.5, -69.0], [-19.5, -68.6], [-20.5, -68.5], [-21.3, -68.2], [-22.0, -68.1], [-22.83, -67.9], [-22.9, -67.2], [-23.8, -67.1], [-24.4, -68.25], [-25.5, -68.5], [-27.1, -68.6], [-28.0, -69.0], [-29.0, -69.7], [-30.2, -69.9], [-31.0, -70.3], [-32.0, -70.3], [-33.0, -70.0], [-34.0, -70.0], [-35.0, -70.4], [-36.0, -70.6], [-37.0, -71.1], [-38.0, -71.1], [-39.0, -71.4], [-40.0, -71.8], [-41.0, -71.9], [-42.0, -71.8], [-43.0, -71.8], [-44.0, -71.7], [-45.0, -71.6], [-46.0, -71.8], [-47.0, -72.1], [-48.0, -72.5], [-49.0, -73.3], [-50.0, -73.4], [-50.7, -72.3], [-52.0, -71.9], [-52.1, -68.5], [-57.0, -68.5]];
  function borderLon(lat) {
    if (lat >= BORDER[0][0]) return BORDER[0][1];
    for (let i = 1; i < BORDER.length; i++) {
      const [lat1, lon1] = BORDER[i - 1], [lat2, lon2] = BORDER[i];
      if (lat >= lat2) return lon1 + (lon2 - lon1) * (lat - lat1) / (lat2 - lat1);
    }
    return BORDER[BORDER.length - 1][1];
  }
  // Perú: north of the line from the coast (-18.35, -70.37) to the tripoint (-17.5, -69.5).
  const inPeru = (lat, lon) => lat > -18.35 + Math.max(0, lon + 70.37) * (0.85 / 0.87);
  const foreignAt = (lat, lon) => lon > borderLon(lat) + 0.2 || inPeru(lat, lon);

  // Matches region names as other sources write them ("Isla de Pascua", "Libertador General Bernardo O'Higgins").
  const fold = text => String(text).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const ALIASES = { 'isla de pascua': 'Valparaíso', 'juan fernandez': 'Valparaíso', 'antartica': 'Magallanes', 'region metropolitana': 'Metropolitana', 'libertador general bernardo o\'higgins': "O'Higgins", 'araucania': 'La Araucanía', 'aysen del general carlos ibanez del campo': 'Aysén', 'magallanes y la antartica chilena': 'Magallanes' };
  const regionByName = name => ALIASES[fold(name)] || REGIONS.find(region => fold(region) === fold(name)) || null;

  // Normalizes a USGS GeoJSON feature into the event shape used across the app.
  function fromUsgs(feature) {
    const [lon, lat, depth] = feature.geometry.coordinates;
    const place = feature.properties.place || 'Ubicación por determinar';
    const region = regionAt(lat, lon);
    return { id: feature.id, type: 'Sismo', sources: ['USGS'], mag: feature.properties.mag || 0, place, lat, lon, region, regions: [region], foreign: FOREIGN.test(place) || foreignAt(lat, lon), time: feature.properties.time, depth: depth || 0, url: feature.properties.url };
  }

  const api = { REGIONS, TYPES, CHILE, regionAt, inChileBox, foreignAt, regionByName, fromUsgs };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AlertaRegions = api;
})(typeof self !== 'undefined' ? self : this);
