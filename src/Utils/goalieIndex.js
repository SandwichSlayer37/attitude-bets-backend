// src/Utils/goalieIndex.js
const { translateGoalieKey } = require("./goalieAliasMap");

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
  if (!db) throw new Error("[GOALIE INDEX] ❌ No Mongo client provided or registered.");
  console.log("[GOALIE INDEX] Starting hydration from nhl_goalie_stats_historical...");

  const seasonFilter = { $in: ["2023", "2024", 2023, 2024, "2023-24", "2024-25"] };
  const data = await db.collection("nhl_goalie_stats_historical").find({ season: seasonFilter }).toArray();

  if (!data.length) {
    console.warn("[GOALIE INDEX] ⚠️ No goalie data found in Mongo collection.");
    return { index: new Map(), byTeam: new Map(), byName: new Map() };
  }

  const index = new Map(); // By Player ID
  const byTeam = new Map(); // By Team Abbreviation
  const byName = new Map(); // By Canonical Name

  for (const g of data) {
    const gsax = safeNum(g.xGoals) - safeNum(g.goals);
    const goalie = {
      playerId: String(g.playerId),
      name: g.name,
      team: g.team,
      gsax,
      season: g.season,
      // FIX: Add the missing games_played property
      games_played: safeNum(g.games_played), 
    };

    index.set(goalie.playerId, goalie);

    if (!byTeam.has(goalie.team)) byTeam.set(goalie.team, []);
    byTeam.get(goalie.team).push(goalie);

    const canonicalName = translateGoalieKey(goalie.name);
    if (canonicalName && !byName.has(canonicalName)) {
        byName.set(canonicalName, goalie);
    }
  }

  // FIX: Add the pre-sorting logic for the fallback system
  for (const [team, goalies] of byTeam.entries()) {
    goalies.sort((a, b) => b.games_played - a.games_played);
  }

  console.log(`[GOALIE INDEX] ✅ Hydrated ${index.size} goalies by ID, ${byName.size} by name.`);
  return { index, byTeam, byName };
}

function findByPlayerId(playerId, goalieData) {
    if (!playerId || !goalieData || !goalieData.index) return null;
    return goalieData.index.get(String(playerId)) || null;
}

module.exports = {
    getGoalieIndex,
    registerMongoClient,
    findByPlayerId
};