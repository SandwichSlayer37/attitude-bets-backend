// Index of goalie metrics from Mongo (Moneypuck historical).
// Expect a collection 'goalies' with docs like: { name, teamAbbr, season, gsax, rollingForm (0..5) ... }

const { getCache, setCache } = require('./simpleCache');
const axios = require('axios');

async function buildGoalieIndex() {
  console.log('[GOALIE INDEX] Starting goalie index build...');
  const goalieIndex = {};

  try {
    const response = await axios.get('https://api.nhle.com/stats/rest/en/goalie/summary');
    const data = response.data;
    if (data && data.data) {
      data.data.forEach((goalie) => {
        goalieIndex[goalie.playerFullName.toLowerCase()] = {
          teamAbbrev: goalie.teamAbbrevs,
          gamesPlayed: goalie.gamesPlayed,
          savePct: goalie.savePct,
          gaa: goalie.gaa,
          wins: goalie.wins,
          losses: goalie.losses,
          shotsAgainst: goalie.shotsAgainst,
        };
      });
    }
    setCache('goalieIndex', goalieIndex);
    console.log(`[GOALIE INDEX] Hydrated ${Object.keys(goalieIndex).length} goalies.`);
  } catch (err) {
    console.error('[GOALIE INDEX] Failed to build index:', err);
  }

  return goalieIndex;
}

module.exports = { buildGoalieIndex };