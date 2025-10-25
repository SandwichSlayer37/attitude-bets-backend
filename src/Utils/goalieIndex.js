// Index of goalie metrics from Mongo (Moneypuck historical).
// Expect a collection 'goalies' with docs like: { name, teamAbbr, season, gsax, rollingForm (0..5) ... }

// FIX: Import the new normalizeGoalieName and normalizeTeamAbbrev functions
const { normalizeGoalieName, normalizeTeamAbbrev } = require('./hockeyNormalize'); 

let goalieIndex = new Map();

async function buildGoalieIndex(db) {
  console.log("[GOALIE INDEX] Starting hydration from nhl_goalie_stats_historical...");

  // ✅ Limit to the two most recent seasons
  const currentSeason = 2024;
  const minSeason = 2023;

  const coll = db.collection("nhl_goalie_stats_historical");
  const cursor = coll.find(
    { season: { $gte: minSeason, $lte: currentSeason } },
    { projection: { _id: 0 } }
  );
  const all = await cursor.toArray();

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

  for (const arr of byTeam.values()) {
    arr.sort((a, b) => (b.season || 0) - (a.season || 0));
  }

  console.log(`[GOALIE INDEX] ✅ Hydrated ${byName.size} goalies from recent seasons (${minSeason}-${currentSeason})`);
  console.log("[GOALIE INDEX] Sample data preview:", Array.from(byName.values()).slice(0, 3).map(g =>
    `${g.name} (${g.teamAbbr}) - Season: ${g.season}, GSAx: ${g.gsax.toFixed(2)}`
  ));

  return { byName, byTeam };
}

async function hydrateGoalieIndex(db) {
    console.log('[GOALIE INDEX] Starting hydration from nhl_goalie_stats_historical...');
    try {
        await buildGoalieIndex(db); // Pass the db object down
    } catch (error) {
        console.error('[GOALIE INDEX] 🚨 Failed to build goalie index:', error);
    }
}

module.exports = {
    hydrateGoalieIndex,
    buildGoalieIndex,
    getGoalieIndex: () => goalieIndex,
    findByPlayerId: (playerId) => {
        if (!playerId) return null;
        // The goalieIndex is now a Map where keys are player IDs.
        // This function provides a clean way to access it.
        const goalieData = goalieIndex.get(String(playerId));
        return goalieData || null;
    },
};