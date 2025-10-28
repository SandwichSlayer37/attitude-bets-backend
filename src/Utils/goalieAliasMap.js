// goalieAliasMap.js
const { getGoalieIndex } = require("./goalieIndex.js");

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

async function buildGoalieAliasMap(mongo) {
  if (!mongo) {
    throw new Error("[GOALIE ALIAS MAP] ❌ Mongo client not provided.");
  }

  const { index } = await getGoalieIndex(mongo);
  goalieAliasMap = new Map();

  for (const [id, goalie] of index.entries()) {
    const canonicalName = goalie.name.replace(",", "").trim();
    const aliases = manualAliases[canonicalName] || [];

    goalieAliasMap.set(canonicalName, {
      playerId: id,
      aliases: [goalie.name, canonicalName, ...aliases],
    });
  }

  console.log(`[GOALIE ALIAS MAP] ✅ Built ${goalieAliasMap.size} goalie aliases`);
  return goalieAliasMap;
}

function translateGoalieKey(nameOrId) {
  if (!nameOrId) return null;
  const str = String(nameOrId).trim().toLowerCase();

  for (const [canonical, data] of goalieAliasMap.entries()) {
    if (data.playerId === str) return canonical;
    if (data.aliases.map(a => a.toLowerCase()).includes(str)) return canonical;
  }
  return str;
}

module.exports = { buildGoalieAliasMap, translateGoalieKey };