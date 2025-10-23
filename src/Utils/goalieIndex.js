// Index of goalie metrics from Mongo (Moneypuck historical).
// Expect a collection 'goalies' with docs like: { name, teamAbbr, season, gsax, rollingForm (0..5) ... }

const { normalizeGoalieName, normalizeTeamAbbrev } = require('./hockeyNormalize');

/**
 * Build a Goalie Index from MongoDB historical data.
 * Uses the collection 'nhl_goalie_stats_historical'
 */
async function buildGoalieIndex(db) {
  if (!db) throw new Error('Database instance missing in buildGoalieIndex');

  console.log('[GOALIE INDEX] Starting hydration from nhl_goalie_stats_historical...');
  const coll = db.collection('nhl_goalie_stats_historical');

  const cursor = coll.find({}, { projection: { _id: 0 } });
  const all = await cursor.toArray();

  if (!all.length) {
    console.warn('[GOALIE INDEX] ⚠️ No goalie documents found — check MongoDB connection or collection name.');
    return { byName: new Map(), byTeam: new Map() };
  }

  const byName = new Map();
  const byTeam = new Map();
  const byId = new Map(); // Create a new map for lookups by ID

  for (const g of all) {
    const name = normalizeGoalieName(g.name);
    const team = normalizeTeamAbbrev(g.team);
    if (!name || !team) continue;

    const cur = byName.get(name) || {};
    // Standardize GSAx calculation from multiple possible field names
    const gsax = g.gsax ?? (g.xGoals - g.goals) ?? (g.expectedGoalsAgainst - g.actualGoalsAgainst) ?? 0;
    const merged = { ...cur, ...g, teamAbbr: team, gsax };

    byName.set(name, merged);
    
    // Populate the byId map
    if (g.playerId) {
      byId.set(String(g.playerId), merged);
    }

    if (!byTeam.has(team)) byTeam.set(team, []);
    byTeam.get(team).push(merged);
  }

  // Sort each team’s goalies by most recent season
  for (const arr of byTeam.values()) {
    arr.sort((a, b) => (b.season || 0) - (a.season || 0));
  }

  console.log(`[GOALIE INDEX] ✅ Hydrated ${byName.size} goalies from nhl_goalie_stats_historical`);

  // Diagnostic mode: log a few samples with GSAx for verification
  const sample = Array.from(byName.values()).slice(0, 3);
  console.log('[GOALIE INDEX] Sample data preview:', sample.map(g =>
    `${g.name} (${g.team}) - GSAx: ${g.gsax.toFixed(2)}`
  ));

  return { byName, byTeam, byId };
}

function neutralGoalieMetrics() {
  return { gsax: 0.0, rollingForm: 2.5, explain: "Neutral goalie fallback" };
}

module.exports = {
    buildGoalieIndex,
    neutralGoalieMetrics,
    // FIX: Add the missing findByPlayerId function to the exports
    findByPlayerId: (playerId) => {
        if (!playerId) return null;
        // Correctly look up from the 'byId' map using the stringified player ID.
        return ctx.goalieIdx.byId.get(String(playerId));
    }
};