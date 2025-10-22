const axios = require("axios");
const { normalizeTeamAbbrev, normalizeGoalieName } = require("./hockeyNormalize");

// Caches in-memory per process. In prod you already have a simpleCache; this keeps service self-contained.
const cache = new Map();
const TTL_MS = 5 * 60 * 1000;

function setCache(k, v) { cache.set(k, { v, exp: Date.now() + TTL_MS }); }
function getCache(k) {
  const hit = cache.get(k);
  if (!hit) return null;
  if (Date.now() > hit.exp) { cache.delete(k); return null; }
  return hit.v;
}

/**
 * Fetch NHL schedule for yyyy-mm-dd, then locate gamePk -> fetch boxscore for probable/starting goalies.
 * Fallback: ESPN scoreboard parsing (limited), then return nulls if unknown.
 */
async function fetchProbableGoalies(dateStr, homeAbbr, awayAbbr) {
  const key = `probGoalies:${dateStr}:${homeAbbr}:${awayAbbr}`;
  const cached = getCache(key);
  if (cached) return cached;

  const H = normalizeTeamAbbrev(homeAbbr);
  const A = normalizeTeamAbbrev(awayAbbr);

  // NHL schedule v1
  const schedUrl = `https://api-web.nhle.com/v1/schedule/${dateStr}`;
  let gamePk = null;
  try {
    const { data } = await axios.get(schedUrl, { timeout: 8000 });
    // Find matching game by team abbrevs
    for (const g of data.games || []) {
      const ha = normalizeTeamAbbrev(g.awayTeam?.abbrev);
      const hh = normalizeTeamAbbrev(g.homeTeam?.abbrev);
      if (ha === A && hh === H) { gamePk = g.id; break; } // Found game
    }
  } catch (e) {
    console.warn(`[GOALIE] NHL schedule fetch failed for ${dateStr}:`, e.message);
  }

  let home = null, away = null;

  if (gamePk) {
    try {
      // Gamecenter boxscore has current lineup close to game time
      const boxUrl = `https://api-web.nhle.com/v1/gamecenter/${gamePk}/boxscore`;
      const { data: box } = await axios.get(boxUrl, { timeout: 8000 });

      const findStarter = (teamObj) => {
        const goalies = (teamObj.goalies || []).map(g => g.firstName?.default + " " + g.lastName?.default);
        // Heuristic: first in list is expected starter when "starters" not explicitly flagged
        return (goalies[0] && normalizeGoalieName(goalies[0])) || null;
      };

      home = findStarter(box.homeTeam);
      away = findStarter(box.awayTeam);
    } catch (e) {
      console.warn(`[GOALIE] NHL boxscore fetch failed for gamePk ${gamePk}:`, e.message);
    }
  }

  // ESPN fallback (light): if still missing, attempt to pull roster/last starter
  if ((!home || !away)) {
    try {
      const yyyymmdd = dateStr.replace(/-/g, "");
      const espnUrl = `https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard?dates=${yyyymmdd}`;
      const { data } = await axios.get(espnUrl, { timeout: 8000 });
      for (const ev of data.events || []) {
        const comp = ev.competitions?.[0];
        if (!comp) continue;
        const tHome = normalizeTeamAbbrev(comp.competitors?.find(c=>c.homeAway==="home")?.team?.abbreviation);
        const tAway = normalizeTeamAbbrev(comp.competitors?.find(c=>c.homeAway==="away")?.team?.abbreviation);
        if (tHome === H && tAway === A) {
          // ESPN rarely tags probables—best-effort parse from notes
          // Left as future enhancement; we keep the NHL boxscore as primary.
        }
      }
    } catch (e) {
      console.warn(`[GOALIE] ESPN fallback fetch failed for ${dateStr}:`, e.message);
    }
  }

  const result = { homeGoalie: home, awayGoalie: away, source: home || away ? "nhl" : "unknown" };
  setCache(key, result);
  return result;
}

module.exports = { fetchProbableGoalies };