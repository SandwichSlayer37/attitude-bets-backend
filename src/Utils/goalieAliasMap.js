// goalieAliasMap.js

// Known spelling or format conflicts
const manualAliases = {
  "Andrei Vasilevskiy": ["Vasilevskiy, Andrei", "Vasilievskiy, Andrei"],
  "Igor Shesterkin": ["Shesterkin, Igor"],
  "Juuse Saros": ["Saros, Juuse"],
  "Connor Hellebuyck": ["Hellebuyck, Connor"],
  "Jake Oettinger": ["Oettinger, Jake"],
  "Alex Nedeljkovic": ["Nedeljkovic, Alex"],
};

let goalieAliasMap = new Map();

// This function now accepts the goalie index directly as a parameter.
async function buildGoalieAliasMap(goalieData) {
  console.log("[GOALIE ALIAS MAP] Building alias map...");
  if (!goalieData || !goalieData.index) {
      console.warn("[GOALIE ALIAS MAP] ⚠️ No goalie data provided to build map.");
      return new Map();
  }
  goalieAliasMap = new Map();

  for (const [id, goalie] of goalieData.index.entries()) {
    const canonicalName = goalie.name.replace(",", "").trim();
    const aliases = manualAliases[canonicalName] || [];

    goalieAliasMap.set(canonicalName, {
      playerId: id,
      aliases: [goalie.name, canonicalName, ...aliases],
    });
  }

  console.log(`[GOALIE ALIAS MAP] ✅ Built ${goalieAliasMap.size} aliases.`);
  return goalieAliasMap;
}

function translateGoalieKey(nameOrId) {
  if (!nameOrId) return null;
  const str = String(nameOrId).trim().toLowerCase();

  for (const [canonical, data] of goalieAliasMap.entries()) {
    if (String(data.playerId).toLowerCase() === str) return canonical;
    if (data.aliases.map(a => a.toLowerCase()).includes(str)) return canonical;
  }
  return String(nameOrId).replace(",", "").trim();
}

module.exports = { buildGoalieAliasMap, translateGoalieKey };