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

  // Normalizes a USGS GeoJSON feature into the event shape used across the app.
  function fromUsgs(feature) {
    const [lon, lat, depth] = feature.geometry.coordinates;
    const place = feature.properties.place || 'Ubicación por determinar';
    return { id: feature.id, mag: feature.properties.mag || 0, place, lat, lon, region: regionAt(lat, lon), foreign: FOREIGN.test(place), type: 'Sismo', time: feature.properties.time, depth: depth || 0, url: feature.properties.url };
  }

  const api = { REGIONS, TYPES, CHILE, regionAt, inChileBox, fromUsgs };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AlertaRegions = api;
})(typeof self !== 'undefined' ? self : this);
