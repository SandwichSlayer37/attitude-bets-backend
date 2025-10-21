// src/utils/goalieIndex.js
const { getGoalieLineup } = require("./goalielineup.js");
const { slugifyName } = require('./hockeyNormalize.js');

const GSAX_FIELDS = ['gsax', 'gsaX', 'goals_saved_above_expected', 'goalsSavedAboveExpected', 'gsaxTotal'];
const GAA_FIELDS  = ['gaa', 'GAA', 'goalsAgainstAverage'];
const ID_FIELDS   = ['playerId', 'player_id', 'nhlId', 'nhl_id', 'id'];

function pickFirstNumber(obj, fields) {
  for (const f of fields) {
    if (obj && obj[f] != null && obj[f] !== '' && !Number.isNaN(Number(obj[f]))) {
      return Number(obj[f]);
    }
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
  for (const f of ID_FIELDS) {
    if (obj && (obj[f] || obj[f] === 0)) return String(obj[f]);
  }
  return null;
}

function extractName(obj) {
  const name = obj?.name || `${obj?.firstName || obj?.first_name || ''} ${obj?.lastName || obj?.last_name || ''}`.trim();
  return name || null;
}

function computeGaa(goalsAgainst, minutes) {
  const ga = Number(goalsAgainst || 0);
  const min = Number(minutes || 0);
  if (min <= 0) return null;
  return (ga / min) * 60;
}

/**
 * Compute last-N games GAA from live split/summary.
 * Expect either:
 *  - summary.last5: { goalsAgainst, minutes }
 *  - games array: [{ga, toiMinutes}] (fallback)
 */
function computeLastNGAA(liveGoalie, N = 5) {
  if (!liveGoalie) return null;

  if (liveGoalie.last5 && (liveGoalie.last5.goalsAgainst != null) && (liveGoalie.last5.minutes != null)) {
    return computeGaa(liveGoalie.last5.goalsAgainst, liveGoalie.last5.minutes);
  }

  if (Array.isArray(liveGoalie.games) && liveGoalie.games.length) {
    const recent = liveGoalie.games.slice(0, N);
    const totalGA = recent.reduce((s, g) => s + Number(g.goalsAgainst || g.ga || 0), 0);
    const totalMin = recent.reduce((s, g) => s + Number(g.minutes || g.toiMinutes || 0), 0);
    return computeGaa(totalGA, totalMin);
  }

  return null;
}

/**
 * Build a composite index from multiple sources:
 * - liveGoalies: array of current season goalie objects
 * - historicalGoalies: array (Mongo) — include GSAX/GAA fields in various shapes
 * - historicalCsv: array from CSV (optional)
 */
function buildGoalieIndex({ liveGoalies = [], historicalGoalies = [], historicalCsv = [] }) {
  const byId = new Map();
  const bySlug = new Map();

  const ingest = (src, sourceTag) => {
    for (const g of src || []) {
      const id = getId(g);
      const name = extractName(g);
      const slug = slugifyName(name);
      const gsax = pickFirstNumber(g, GSAX_FIELDS);
      const gaa = pickFirstNumber(g, GAA_FIELDS);
      const gaaLast5 = computeLastNGAA(g);
      const entry = { id, name, slug, source: sourceTag, gsax: gsax ?? null, gaa: gaa ?? null, gaaLast5: gaaLast5 ?? null, raw: g };
      if (id) { const prev = byId.get(id); byId.set(id, mergeGoalie(prev, entry)); }
      if (slug) { const prev = bySlug.get(slug); bySlug.set(slug, mergeGoalie(prev, entry)); }
    }
  };

  ingest(liveGoalies, 'live');
  ingest(historicalGoalies, 'historical');
  ingest(historicalCsv, 'csv');

  return { byId, bySlug };
}

function mergeGoalie(a, b) {
  if (!a) return b;
  const pick = (x, y) => (x != null ? x : y);
  return {
    id: pick(a.id, b.id), name: pick(a.name, b.name), slug: pick(a.slug, b.slug),
    source: a.source === 'live' || b.source === 'live' ? 'live' : (a.source || b.source),
    gsax: pick(a.gsax, b.gsax), gaa: pick(a.gaa, b.gaa), gaaLast5: pick(a.gaaLast5, b.gaaLast5),
    raw: pick(a.raw, b.raw),
  };
}

function findGoalie({ id, name }, idx) {
  if (!idx) return null;
  if (id && idx.byId.has(String(id))) return idx.byId.get(String(id));
  const slug = slugifyName(name);
  if (slug && idx.bySlug.has(slug)) return idx.bySlug.get(slug);
  return null;
}

async function getHistoricalGoalieData(goaliesHistCollection, season, fetchData) {
    const cacheKey = `historical_goalie_data_${season}_v3`;
    return fetchData(cacheKey, async () => {
        try {
            if (!goaliesHistCollection) {
                console.error("[ERROR] goaliesHistCollection is not initialized.");
                return {};
            }
            const pipeline = [
                { $match: { season: season } },
                {
                    $group: {
                        _id: "$playerId",
                        name: { $first: "$name" },
                        gsax: { $sum: { $subtract: ["$xGoals", "$goals"] } }
                    }
                }
            ];
            const results = await goaliesHistCollection.aggregate(pipeline).toArray();
            const goalieDataMap = results.reduce((acc, goalie) => {
                acc[goalie._id] = { name: goalie.name, gsax: goalie.gsax };
                return acc;
            }, {});
            console.log(`✅ Successfully processed historical data for ${Object.keys(goalieDataMap).length} goalies.`);
            return goalieDataMap;
        } catch (error) {
            console.error(`Error fetching historical goalie data for season ${season}:`, error);
            return {};
        }
    }, 86400000);
}

async function getGoalieData(matchup, mongoGoalieStats) {
  const { homeAbbr, awayAbbr } = matchup;
  let lineup = await getGoalieLineup(homeAbbr, awayAbbr);

  if (!lineup.homeGoalie && !lineup.awayGoalie) {
    console.warn(`⚠️ [GoalieIndex] No goalie lineup found for ${homeAbbr} vs ${awayAbbr}`);
  }

  // Pull Moneypuck data from Mongo
  const homeStats = lineup.homeGoalie && mongoGoalieStats
    ? await mongoGoalieStats.findOne({ name: lineup.homeGoalie })
    : null;
  const awayStats = lineup.awayGoalie && mongoGoalieStats
    ? await mongoGoalieStats.findOne({ name: lineup.awayGoalie })
    : null;

  return {
    homeGoalie: lineup.homeGoalie, awayGoalie: lineup.awayGoalie,
    source: lineup.source, confirmed: lineup.confirmed,
    homeGSAx: homeStats?.gsaX || 0, awayGSAx: awayStats?.gsaX || 0,
    homeForm: homeStats?.recentForm3 || 0, awayForm: awayStats?.recentForm3 || 0
  };
}

module.exports = { buildGoalieIndex, findGoalie, computeLastNGAA, computeGaa, pickFirstNumber, pickFirstString, getHistoricalGoalieData, getGoalieData };