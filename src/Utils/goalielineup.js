const axios = require("axios");
const { getCache, setCache } = require("./simpleCache");

async function resolveStartingGoalies(officialGame, goalieIdx) {
  const { homeTeam, awayTeam } = officialGame;
  const starters = { home: null, away: null };

  // --- A: NHL API probable starters ---
  const probableHomeName = homeTeam?.probableStarterName;
  const probableAwayName = awayTeam?.probableStarterName;

  if (probableHomeName) starters.home = goalieIdx.byName.get(probableHomeName.toLowerCase());
  if (probableAwayName) starters.away = goalieIdx.byName.get(probableAwayName.toLowerCase());

  // --- B: Fallback – most recent starter by games_played ---
  const getLikelyStarter = (teamAbbr) => {
    const goalies = goalieIdx.byTeam.get(teamAbbr);
    if (!goalies?.length) return null;
    return goalies.sort((a, b) => (b.games_played || 0) - (a.games_played || 0))[0];
  };

  if (!starters.home) starters.home = getLikelyStarter(homeTeam?.abbrev);
  if (!starters.away) starters.away = getLikelyStarter(awayTeam?.abbrev);

  // --- C: ESPN fallback, with 15-min cache ---
  if ((!starters.home || !starters.away)) {
    let espnData = getCache("espn_scoreboard");
    if (!espnData) {
      try {
        const res = await axios.get("https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard");
        espnData = res.data;
        setCache("espn_scoreboard", espnData, 900); // cache 15 min
        console.log("[ESPN Fallback] Cached new scoreboard data.");
      } catch (err) {
        console.warn("[ESPN Fallback] Failed to fetch ESPN data:", err.message);
      }
    }

    if (espnData?.events?.length) {
      const espnGame = espnData.events.find(e =>
        e.competitions?.[0]?.competitors?.some(c => c.team?.abbreviation === homeTeam?.abbrev)
      );

      if (espnGame) {
        for (const c of espnGame.competitions[0].competitors) {
          const goalieName = c.probables?.find(p => p.position?.abbreviation === "G")?.athlete?.displayName;
          if (goalieName) {
            const normalized = goalieName.toLowerCase();
            if (c.homeAway === "home") starters.home = goalieIdx.byName.get(normalized) || starters.home;
            else starters.away = goalieIdx.byName.get(normalized) || starters.away;
          }
        }
      }
    }
  }

  // Final fallback if both failed
  if (!starters.home) starters.home = getLikelyStarter(homeTeam?.abbrev);
  if (!starters.away) starters.away = getLikelyStarter(awayTeam?.abbrev);

  return starters;
}

module.exports = { resolveStartingGoalies };