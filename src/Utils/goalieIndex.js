// Index of goalie metrics from Mongo (Moneypuck historical).
// Expect a collection 'goalies' with docs like: { name, teamAbbr, season, gsax, rollingForm (0..5) ... }

let cachedMongo = null;

function registerMongoClient(mongo) {
  cachedMongo = mongo;
  console.log("[GOALIE INDEX] ✅ Mongo client registered for reuse.");
}

function safeNum(val) {
  const n = Number(val);
  return isNaN(n) ? 0 : n;
}

async function getGoalieIndex(mongo) {
  const db = mongo || cachedMongo;
  if (!db) {
    throw new Error("[GOALIE INDEX] ❌ No Mongo client provided or registered.");
  }

  console.log("[GOALIE INDEX] Starting hydration from nhl_goalie_stats_historical...");

  // More flexible query for both string and numeric season values
  const seasonFilter = { $in: ["2023", "2024", 2023, 2024, "2023-24", "2024-25"] };
  const data = await db.collection("nhl_goalie_stats_historical").find({ season: seasonFilter }).toArray();

  if (!data.length) {
    console.warn("[GOALIE INDEX] ⚠️ No goalie data found in Mongo collection.");
    return { index: new Map(), byTeam: new Map() };
  }

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

  console.log(`[GOALIE INDEX] ✅ Hydrated ${data.length} goalies from recent seasons`);
  console.log("[GOALIE INDEX] Sample data preview:",
    data.slice(0, 3).map(g => `${g.name} (${g.team}) - GSAx: ${safeNum(g.xGoals) - safeNum(g.goals)}`)
  );

  return { index, byTeam };
}

module.exports = {
    getGoalieIndex,
    registerMongoClient
};