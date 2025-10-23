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
    return { byName: new Map(), byTeam: new Map(), byId: new Map() };
  }

  const byName = new Map();
  const byTeam = new Map();

  for (const g of all) {
    const name = normalizeGoalieName(g.goalie_name || g.name);
    const team = normalizeTeamAbbrev(g.team);
    const gsax = g.gsax ?? g.goals_saved_above_expected ?? (g.xGoals - g.goals) ?? 0;

    if (!name || !team) continue;

    const goalie = { ...g, name, teamAbbr: team, gsax };
    byName.set(name.toLowerCase(), goalie);

    if (!byTeam.has(team)) byTeam.set(team, []);
    byTeam.get(team).push(goalie);
  }

  // Sort each team’s goalies by most recent season
  for (const arr of byTeam.values()) {
    arr.sort((a, b) => (b.season || 0) - (a.season || 0));
  }

  console.log(`[GOALIE INDEX] ✅ Hydrated ${byName.size} goalies from nhl_goalie_stats_historical`);
  const sample = Array.from(byName.values()).slice(0, 3)
    .map(g => `${g.name} (${g.teamAbbr}) - GSAx: ${g.gsax.toFixed(2)}`);
  console.log("[GOALIE INDEX] Sample data preview:", sample);

  return { byName, byTeam };
}

module.exports = { buildGoalieIndex };