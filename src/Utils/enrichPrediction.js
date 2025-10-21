// Takes a raw matchup prediction and enriches with Key Factors.
const { normalizeTeamAbbrev, normalizeGoalieName, buildKey } = require("./hockeyNormalize");
const { neutralGoalieMetrics } = require("./goalieIndex");

function asPct(v, fallback = 50.0) {
  if (v === null || v === undefined || Number.isNaN(v)) return fallback;
  return Math.max(0, Math.min(100, Number(v)));
}

function nonNullNum(v, fb = 0) {
  return (v === null || v === undefined || Number.isNaN(v)) ? fb : Number(v);
}

/**
 * Merge live + historical + goalie metrics into keyFactors.
 * Inputs:
 *  - ctx: { goalieIdx, advByTeam, liveByTeam }
 *  - game: { dateStr, homeAbbr, awayAbbr, homeGoalie, awayGoalie }
 *  - base: { modelProb, odds, ... }
 */
function enrichPrediction(ctx, game, base) {
  const H = normalizeTeamAbbrev(game.homeAbbr);
  const A = normalizeTeamAbbrev(game.awayAbbr);

  const advHome = ctx.advByTeam?.get(H) || {};
  const advAway = ctx.advByTeam?.get(A) || {};
  const liveHome = ctx.liveByTeam?.get(H) || {};
  const liveAway = ctx.liveByTeam?.get(A) || {};

  // Goalie block
  const homeGoalieName = normalizeGoalieName(game.homeGoalie);
  const awayGoalieName = normalizeGoalieName(game.awayGoalie);

  const homeG = homeGoalieName ? ctx.goalieIdx.byName.get(homeGoalieName) :
                (ctx.goalieIdx.byTeam.get(H)?.[0] || null);
  const awayG = awayGoalieName ? ctx.goalieIdx.byName.get(awayGoalieName) :
                (ctx.goalieIdx.byTeam.get(A)?.[0] || null);

  const homeGm = homeG || neutralGoalieMetrics();
  const awayGm = awayG || neutralGoalieMetrics();

  // Key factors—always produce numbers, never “N/A”
  const keyFactors = [
    {
      label: "Hybrid Data (Live + Historical Player Ratings)",
      home: nonNullNum(advHome.hybridRating, 50),
      away: nonNullNum(advAway.hybridRating, 50),
      units: "rating/100",
      sample: {
        homePlayers: nonNullNum(advHome.playerCount, 0),
        awayPlayers: nonNullNum(advAway.playerCount, 0)
      },
      explanation: (advHome.playerCount || advAway.playerCount)
        ? "Combined current + historical player strength."
        : "Used neutral blend due to limited player hydration."
    },
    {
      label: "Injury Impact",
      home: nonNullNum(advHome.injuryImpact, 0),
      away: nonNullNum(advAway.injuryImpact, 0),
      units: "players",
      explanation: "Number of materially impactful absences (est.)."
    },
    {
      label: "Current Goalie Form",
      home: nonNullNum(homeGm.rollingForm, 2.5),
      away: nonNullNum(awayGm.rollingForm, 2.5),
      units: "0..5",
      explanation: homeG ? `Starter identified: ${homeG.name}` : "Starter unknown—neutral form applied."
    },
    {
      label: "Historical Goalie Edge (GSAx)",
      home: nonNullNum(homeGm.gsax, 0.0),
      away: nonNullNum(awayGm.gsax, 0.0),
      units: "goals saved above expected",
      explanation: (homeG && awayG) ? "Pulled from Moneypuck historical." : "Fallback due to missing goalie match."
    },
    {
      label: "5-on-5 xG%",
      home: asPct(advHome.xgPct, 50),
      away: asPct(advAway.xgPct, 50),
      units: "%",
      explanation: "Even-strength expected goal share."
    },
    {
      label: "High-Danger Battle",
      home: asPct(advHome.hdPct, 50),
      away: asPct(advAway.hdPct, 50),
      units: "%",
      explanation: "High-danger chances share."
    },
    {
      label: "Special Teams Duel",
      home: nonNullNum(advHome.specialTeamsDelta, 0),
      away: nonNullNum(advAway.specialTeamsDelta, 0),
      units: "net% pts",
      explanation: "PP - PK net effectiveness."
    },
    {
      label: "PDO (Luck Factor)",
      home: nonNullNum(liveHome.pdo, 1000),
      away: nonNullNum(liveAway.pdo, 1000),
      units: "x1000",
      explanation: "SV% + SH% scaled."
    },
    {
      label: "Faceoff Advantage",
      home: asPct(liveHome.foPct, 50),
      away: asPct(liveAway.foPct, 50),
      units: "%",
      explanation: "Team faceoff win%."
    }
  ];

  return { ...base, keyFactors };
}

module.exports = { enrichPrediction };