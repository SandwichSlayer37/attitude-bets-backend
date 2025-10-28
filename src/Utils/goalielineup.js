// goalieAliasMap.js
export const goalieAliasMap = {
  "Igor Shesterkin": { playerId: "8477361", aliases: ["Shesterkin, Igor"] },
  "Jake Oettinger": { playerId: "8480947", aliases: ["Oettinger, Jake"] },
  "Alex Nedeljkovic": { playerId: "8478483", aliases: ["Nedeljkovic, Alex"] },
  "Connor Hellebuyck": { playerId: "8476945", aliases: ["Hellebuyck, Connor"] },
  "Juuse Saros": { playerId: "8477424", aliases: ["Saros, Juuse"] },
  "Andrei Vasilevskiy": { playerId: "8476883", aliases: ["Vasilevskiy, Andrei"] },
  // Add common mismatches here as they appear in logs
};

export function translateGoalieKey(nameOrId) {
  if (!nameOrId) return null;
  const str = String(nameOrId).trim();
  for (const [canonicalName, data] of Object.entries(goalieAliasMap)) {
    if (data.playerId === str) return canonicalName;
    if (data.aliases.map(a => a.toLowerCase()).includes(str.toLowerCase()))
      return canonicalName;
  }
  return str;
}


const axios = require("axios");
const { getCache, setCache } = require("./simpleCache");
const { normalizeGoalieName, normalizeTeamAbbrev } = require("./hockeyNormalize");

async function resolveStartingGoalies(officialGame, goalieIdx) {
  const { homeTeam, awayTeam } = officialGame || {};
  const starters = { home: null, away: null };

  if (!homeTeam || !awayTeam) return starters;

  // --- A. NHL probable starters ---
  const probableHome = homeTeam.probableStarterName || homeTeam.probableStarter;
  const probableAway = awayTeam.probableStarterName || awayTeam.probableStarter;

  if (probableHome)
    starters.home = goalieIdx.byName.get(probableHome.toLowerCase()) || null;
  if (probableAway)
    starters.away = goalieIdx.byName.get(probableAway.toLowerCase()) || null;

  // --- B. Fallback: last known starter by most games played ---
  const mostPlayedGoalie = (teamAbbr) => {
    const goalies = goalieIdx.byTeam.get(teamAbbr);
    if (!goalies?.length) return null;
    return goalies.sort((a, b) => (b.games_played || 0) - (a.games_played || 0))[0];
  };

  const homeAbbr = normalizeTeamAbbrev(homeTeam.abbrev);
  const awayAbbr = normalizeTeamAbbrev(awayTeam.abbrev);

  if (!starters.home) starters.home = mostPlayedGoalie(homeAbbr);
  if (!starters.away) starters.away = mostPlayedGoalie(awayAbbr);

  // --- C. ESPN fallback (with caching) ---
  if ((!starters.home || !starters.away)) {
    let espnCache = getCache("espn_lineups");
    if (!espnCache) {
      try {
        const espnRes = await axios.get("https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard");
        espnCache = espnRes.data;
        setCache("espn_lineups", espnCache, 900); // cache for 15 min
      } catch (err) {
        console.warn("[ESPN Fallback] Failed to fetch ESPN lineups:", err.message);
      }
    }

    if (espnCache?.events?.length) {
      for (const ev of espnCache.events) {
        const comp = ev.competitions?.[0];
        if (!comp) continue;

        for (const team of comp.competitors || []) {
          const abbr = normalizeTeamAbbrev(team.team?.abbreviation);
          const goalieProbable = team.probables?.find(
            (p) => p.position?.abbreviation === "G"
          );
          const goalieName = goalieProbable?.athlete?.displayName;

          if (!goalieName) continue;

          if (abbr === homeAbbr)
            starters.home = goalieIdx.byName.get(goalieName.toLowerCase()) || starters.home;
          if (abbr === awayAbbr)
            starters.away = goalieIdx.byName.get(goalieName.toLowerCase()) || starters.away;
        }
      }
    }
  }

  return starters;
}

module.exports = { resolveStartingGoalies };