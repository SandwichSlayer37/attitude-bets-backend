// src/Utils/goalieResolver.js
const { translateGoalieKey } = require("./goalieAliasMap");
const { normalizeTeamAbbrev } = require("./teamMap");

/**
 * Resolves starting goalie IDs using a priority system:
 * 1. Official NHL API (probableStarterId)
 * 2. ESPN API (probables list)
 * 3. Historical #1 Goalie (fallback)
 * @param {object} officialGame - The game object from the NHL schedule API.
 * @param {object} espnData - The full scoreboard data from the ESPN API.
 * @param {object} goalieIdx - The hydrated goalie index (with byName and byTeam maps).
 * @returns {{homeId: string|null, awayId: string|null, source: string}}
 */
function resolveGoalies(officialGame, espnData, goalieIdx) {
    const homeAbbr = normalizeTeamAbbrev(officialGame.homeTeam?.abbrev);
    const awayAbbr = normalizeTeamAbbrev(officialGame.awayTeam?.abbrev);

    let homeId = officialGame.homeTeam?.probableStarterId || null;
    let awayId = officialGame.awayTeam?.probableStarterId || null;
    let source = "Official NHL API";

    // --- PRIORITY 2: ESPN API FALLBACK ---
    if (!homeId || !awayId) {
        const espnGame = (espnData.events || []).find(e => {
            const home = e.competitions[0]?.competitors?.find(c => c.homeAway === 'home');
            const away = e.competitions[0]?.competitors?.find(c => c.homeAway === 'away');
            return normalizeTeamAbbrev(home?.team?.abbreviation) === homeAbbr && normalizeTeamAbbrev(away?.team?.abbreviation) === awayAbbr;
        });

        if (espnGame) {
            const competitors = espnGame.competitions[0]?.competitors || [];
            for (const team of competitors) {
                const isHome = team.homeAway === 'home';
                const goalieProbable = team.probables?.find(p => p.position?.abbreviation === 'G');
                const goalieName = goalieProbable?.athlete?.displayName;

                if (goalieName) {
                    const canonicalName = translateGoalieKey(goalieName);
                    const goalie = goalieIdx.byName.get(canonicalName);
                    if (goalie) {
                        if (isHome && !homeId) {
                            homeId = goalie.playerId;
                            source = "ESPN API";
                        } else if (!isHome && !awayId) {
                            awayId = goalie.playerId;
                            source = "ESPN API";
                        }
                    }
                }
            }
        }
    }
    
    // --- PRIORITY 3: HISTORICAL #1 GOALIE FALLBACK ---
    if (!homeId && goalieIdx.byTeam.has(homeAbbr)) {
        homeId = goalieIdx.byTeam.get(homeAbbr)[0]?.playerId || null;
        if (homeId) source = "Historical #1 Fallback";
    }
    if (!awayId && goalieIdx.byTeam.has(awayAbbr)) {
        awayId = goalieIdx.byTeam.get(awayAbbr)[0]?.playerId || null;
        if (awayId && source !== "ESPN API") source = "Historical #1 Fallback";
    }

    return { homeId, awayId, source };
}

module.exports = { resolveGoalies };