/**
 * Zone definitions – each zone has a center, default zoom, and display name.
 * To add a new zone (e.g. Kochi), just add an entry here + seed data.
 */
const ZONES = {
  trivandrum: {
    key: 'trivandrum',
    name: 'Trivandrum',
    name_ml: 'തിരുവനന്തപുരം',
    state: 'Kerala',
    center: [8.5241, 76.9366],
    zoom: 13,
  },
  kannur: {
    key: 'kannur',
    name: 'Kannur',
    name_ml: 'കണ്ണൂർ',
    state: 'Kerala',
    center: [11.8745, 75.3704],
    zoom: 13,
  },
  kozhikode: {
    key: 'kozhikode',
    name: 'Kozhikode',
    name_ml: 'കോഴിക്കോട്',
    state: 'Kerala',
    center: [11.2588, 75.7804],
    zoom: 13,
  },
  pathanamthitta: {
    key: 'pathanamthitta',
    name: 'Pathanamthitta',
    name_ml: 'പത്തനംതിട്ട',
    state: 'Kerala',
    center: [9.2648, 76.7870],
    zoom: 13,
  },
};

const ZONE_KEYS = Object.keys(ZONES);

module.exports = { ZONES, ZONE_KEYS };
