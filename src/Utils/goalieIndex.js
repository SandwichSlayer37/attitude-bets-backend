// Index of goalie metrics from Mongo (Moneypuck historical).
// Expect a collection 'goalies' with docs like: { name, teamAbbr, season, gsax, rollingForm (0..5) ... }

const { normalizeGoalieName, normalizeTeamAbbrev } = require("./hockeyNormalize");

async function buildGoalieIndex(db) {
  const coll = db.collection("goalies");
  // Pull last 3 seasons for resiliency
  const cursor = coll.find({}, { projection: { _id: 0 } });
  const all = await cursor.toArray();

  const byName = new Map(); // NAME -> merged metrics
  const byTeam = new Map(); // TEAM -> array of goalies (latest season first)

  for (const g of all) {
    const name = normalizeGoalieName(g.name);
    const team = normalizeTeamAbbrev(g.teamAbbr);
    if (!name || !team) continue;

    // Merge: prefer latest season stats
    const cur = byName.get(name) || {};
    const merged = { ...cur, ...g, teamAbbr: team };
    byName.set(name, merged);

    if (!byTeam.has(team)) byTeam.set(team, []);
    byTeam.get(team).push(merged);
  }

  // Sort team lists by most recent (if season present)
  for (const [t, arr] of byTeam.entries()) {
    arr.sort((a, b) => (b.season || 0) - (a.season || 0));
  }

  return { byName, byTeam };
}

function neutralGoalieMetrics() {
  return {
    gsax: 0.0,                // neutral historical edge
    rollingForm: 2.5,         // neutral “current form” (0..5 scale)
    explain: "Neutral goalie fallback"
  };
}

module.exports = { buildGoalieIndex, neutralGoalieMetrics };