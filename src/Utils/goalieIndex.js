// Index of goalie metrics from Mongo (Moneypuck historical).
// Expect a collection 'goalies' with docs like: { name, teamAbbr, season, gsax, rollingForm (0..5) ... }

const { normalizeGoalieName, normalizeTeamAbbrev } = require('./hockeyNormalize');

/**
 * Build a Goalie Index from MongoDB historical data.
 * Uses the collection 'nhl_goalie_stats_historical'
 */
async function buildGoalieIndex(db) {
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

  for (const g of all) {
    const name = normalizeGoalieName(g.name);
    const team = normalizeTeamAbbrev(g.team);
    if (!name || !team) continue;

    const gsax = (g.xGoals ?? 0) - (g.goals ?? 0);
    const rollingForm = g.games_played > 0 ? Math.min(5, (g.games_played / 82) * 5) : 2.5;

    const merged = { ...g, name, teamAbbr: team, gsax, rollingForm };
    byName.set(name, merged);

    if (!byTeam.has(team)) byTeam.set(team, []);
    byTeam.get(team).push(merged);
  }

  // Sort each team’s goalies by most recent season
  for (const arr of byTeam.values()) {
    arr.sort((a, b) => (b.season || 0) - (a.season || 0));
  }

  console.log(`[GOALIE INDEX] ✅ Hydrated ${byName.size} goalies from nhl_goalie_stats_historical`);
  console.log("[GOALIE INDEX] Sample data preview:", Array.from(byName.values()).slice(0, 3).map(g =>
    `${g.name} (${g.teamAbbr}) - GSAx: ${g.gsax.toFixed(2)}`
  ));

  return { byName, byTeam };
}

module.exports = {
    buildGoalieIndex,
    // FIX: Add the missing findByPlayerId function to the exports
    findByPlayerId: (playerId) => {
        if (!playerId) return null;
        // This assumes goalieIndex is a Map populated by buildGoalieIndex
        return goalieIndex.get(String(playerId)); // Ensure we look up by string
    }
};