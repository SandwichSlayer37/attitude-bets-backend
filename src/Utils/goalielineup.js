const axios = require('axios');
const { setCache, getCache } = require('./simpleCache.js');
const { toEspnAbbr } = require("./teamMap.js");

const ESPN_BASE = "https://site.web.api.espn.com/apis/site/v2/sports/hockey/nhl";
const NHL_BASE = "https://api-web.nhle.com/v1";

/**
 * Fetch probable or confirmed goalies for a given matchup.
 * Falls back to NHL roster inference if ESPN doesn't provide data.
 */
async function getGoalieLineup(homeAbbr, awayAbbr) {
  const espnHome = toEspnAbbr(homeAbbr);
  const espnAway = toEspnAbbr(awayAbbr);
  const cacheKey = `goalie-lineup-${espnHome}-${espnAway}`;
  const cached = getCache(cacheKey);
  if (cached) return cached;

  try {
    // 🧠 STEP 1: Find ESPN event for this matchup
    const { data: scoreboard } = await axios.get(`${ESPN_BASE}/scoreboard`);
    const event = scoreboard?.events?.find(ev => {
      const teams = ev?.competitions?.[0]?.competitors?.map(c => c.team.abbreviation);
      return teams?.includes(espnHome) && teams?.includes(espnAway);
    });
    if (!event) {
      console.warn(`⚠️ [GoalieLineup] No ESPN event found for ${espnHome} vs ${espnAway}`);
      return await inferFromNhlRoster(homeAbbr, awayAbbr);
    }

    const gameId = event.id;
    const { data: summary } = await axios.get(`${ESPN_BASE}/summary?event=${gameId}`);

    const parseGoalie = (sideAbbr) => {
      const competitors = summary?.boxscore?.players || [];
      const teamBlock = competitors.find(t => t.team?.abbreviation === sideAbbr);
      const goalieBlock = teamBlock?.statistics?.find(s => s.name === "goalie");
      const goalies = goalieBlock?.athletes || [];

      const confirmed = goalies.find(g => g?.starter === true);
      const probable = goalies.find(g => g?.status?.type?.name === "probable");
      const picked = confirmed || probable || goalies[0];

      return picked ? { name: picked.athlete.displayName, confirmed: !!confirmed } : { name: null, confirmed: false };
    };

    const home = parseGoalie(espnHome);
    const away = parseGoalie(espnAway);

    const result = { homeGoalie: home.name, awayGoalie: away.name, confirmed: home.confirmed && away.confirmed, source: "ESPN" };

    console.log(`🧤 [GoalieLineup] ESPN result:`, result);
    setCache(cacheKey, result, 600000); // Cache 10 min
    return result;

  } catch (err) {
    console.error("❌ [GoalieLineup] ESPN fetch failed:", err.message);
    return await inferFromNhlRoster(homeAbbr, awayAbbr);
  }
}

async function inferFromNhlRoster(homeAbbr, awayAbbr) {
  const getLikelyGoalie = async (abbr) => {
    try {
      const { data: roster } = await axios.get(`${NHL_BASE}/roster/${abbr}/current`);
      const goalies = roster?.goalies || [];
      if (!goalies.length) return null;
      goalies.sort((a, b) => (b.gamesPlayed || 0) - (a.gamesPlayed || 0));
      return goalies[0].firstName.default + " " + goalies[0].lastName.default;
    } catch { return null; }
  };

  const result = { homeGoalie: await getLikelyGoalie(homeAbbr), awayGoalie: await getLikelyGoalie(awayAbbr), confirmed: false, source: "NHL-Fallback" };
  console.log(`🧤 [GoalieLineup] Fallback result:`, result);
  return result;
}

module.exports = { getGoalieLineup };