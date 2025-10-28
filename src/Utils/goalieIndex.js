// Index of goalie metrics from Mongo (Moneypuck historical).
// Expect a collection 'goalies' with docs like: { name, teamAbbr, season, gsax, rollingForm (0..5) ... }

function safeNum(val) {
  const n = Number(val);
  return isNaN(n) ? 0 : n;
}

async function getGoalieIndex(db) {
  console.log("[GOALIE INDEX] Starting hydration from nhl_goalie_stats_historical...");
  const data = await db.collection("nhl_goalie_stats_historical")
    .find({ season: { $in: ["2023", "2024"] } })
    .toArray();

  const index = new Map();
  const byTeam = new Map();

  for (const g of data) {
    const gsax = safeNum(g.xGoals) - safeNum(g.goals);
    const goalie = {
      playerId: String(g.playerId),
      name: g.name,
      team: g.team,
      gsax,
      season: g.season,
    };

    index.set(goalie.playerId, goalie);
    if (!byTeam.has(goalie.team)) byTeam.set(goalie.team, []);
    byTeam.get(goalie.team).push(goalie);
  }

  console.log(`[GOALIE INDEX] ✅ Hydrated ${data.length} goalies from recent seasons (2023–2024)`);
  console.log("[GOALIE INDEX] Sample data preview:",
    data.slice(0, 3).map(g => `${g.name} (${g.team}) - GSAx: ${safeNum(g.xGoals) - safeNum(g.goals)}`)
  );

  return { index, byTeam };
}

module.exports = {
    getGoalieIndex
};