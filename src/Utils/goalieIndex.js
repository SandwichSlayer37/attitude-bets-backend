// src/utils/goalieIndex.js
const { slugifyName } = require('./hockeyNormalize');

const GSAX_FIELDS = ['gsax', 'gsaX', 'goals_saved_above_expected', 'goalsSavedAboveExpected', 'gsaxTotal'];
const GAA_FIELDS = ['gaa', 'GAA', 'goalsAgainstAverage'];
const ID_FIELDS = ['playerId', 'player_id', 'nhlId', 'nhl_id', 'id'];

function pickFirstNumber(obj, fields) {
  for (const f of fields) {
    if (obj && obj[f] != null && !isNaN(Number(obj[f]))) return Number(obj[f]);
  }
  return null;
}

function pickFirstString(obj, fields) {
  for (const f of fields) {
    if (obj && typeof obj[f] === 'string' && obj[f].trim()) return obj[f].trim();
  }
  return null;
}

function getId(obj) {
  for (const f of ID_FIELDS) if (obj && obj[f] != null) return String(obj[f]);
  return null;
}

function extractName(obj) {
  const name = obj?.name || `${obj?.firstName || ''} ${obj?.lastName || ''}`.trim();
  return name || null;
}

function computeGaa(goalsAgainst, minutes) {
  const ga = Number(goalsAgainst || 0);
  const min = Number(minutes || 0);
  if (min <= 0) return null;
  return (ga / min) * 60;
}

function computeLastNGAA(liveGoalie, N = 5) {
  if (!liveGoalie) return null;
  if (liveGoalie.last5) {
    return computeGaa(liveGoalie.last5.goalsAgainst, liveGoalie.last5.minutes);
  }
  if (Array.isArray(liveGoalie.games)) {
    const recent = liveGoalie.games.slice(0, N);
    const totalGA = recent.reduce((s, g) => s + Number(g.goalsAgainst || g.ga || 0), 0);
    const totalMin = recent.reduce((s, g) => s + Number(g.minutes || g.toiMinutes || 0), 0);
    return computeGaa(totalGA, totalMin);
  }
  return null;
}

function mergeGoalie(a, b) {
  if (!a) return b;
  return {
    id: a.id || b.id,
    name: a.name || b.name,
    slug: a.slug || b.slug,
    source: a.source === 'live' ? 'live' : (b.source || a.source),
    gsax: a.gsax ?? b.gsax,
    gaa: a.gaa ?? b.gaa,
    gaaLast5: a.gaaLast5 ?? b.gaaLast5,
  };
}

function buildGoalieIndex({ liveGoalies = [], historicalGoalies = [], historicalCsv = [] }) {
  const byId = new Map();
  const bySlug = new Map();

  const ingest = (src, tag) => {
    for (const g of src) {
      const id = getId(g);
      const name = extractName(g);
      const slug = slugifyName(name);
      const gsax = pickFirstNumber(g, GSAX_FIELDS);
      const gaa = pickFirstNumber(g, GAA_FIELDS);
      const gaaLast5 = computeLastNGAA(g);
      const entry = { id, name, slug, gsax, gaa, gaaLast5, source: tag };

      if (id) byId.set(id, mergeGoalie(byId.get(id), entry));
      if (slug) bySlug.set(slug, mergeGoalie(bySlug.get(slug), entry));
    }
  };

  ingest(liveGoalies, 'live');
  ingest(historicalGoalies, 'historical');
  ingest(historicalCsv, 'csv');

  return { byId, bySlug };
}

function findGoalie({ id, name }, idx) {
  if (!idx) return null;
  if (id && idx.byId.has(String(id))) return idx.byId.get(String(id));
  const slug = slugifyName(name);
  if (slug && idx.bySlug.has(slug)) return idx.bySlug.get(slug);
  return null;
}

module.exports = { buildGoalieIndex, findGoalie, computeGaa, computeLastNGAA };
