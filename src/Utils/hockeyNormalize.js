const { normalizeTeamAbbrev } = require("./teamMap");

// Normalize human names: remove accents/punct, collapse spaces, upper
function normalizePersonName(name) {
  if (!name) return null;
  return name
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z\s'-]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

// Some common goalie aliases mapping (expand when you find misses)
const GOALIE_ALIASES = new Map([
  ["ALEX LYON", "ALEX LYGON"], // example of bad feeds—edit as discovered
]);

function normalizeGoalieName(name) {
  const n = normalizePersonName(name);
  if (!n) return null;
  return GOALIE_ALIASES.get(n) || n;
}

function buildKey(gameObj, homeAbbr, awayAbbr) {
  return `${normalizeTeamAbbrev(awayAbbr)}@${normalizeTeamAbbrev(homeAbbr)}`;
}

module.exports = {
  normalizeTeamAbbrev,
  normalizeGoalieName,
  normalizePersonName,
  buildKey
};