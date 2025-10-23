// Takes a raw matchup prediction and enriches with Key Factors.
const { normalizeTeamAbbrev, normalizeGoalieName } = require("./hockeyNormalize"); // Removed buildKey as it's not used here
const { resolveStartingGoalies } = require("./goalielineup");

async function addGoalieEdge(ctx, keyFactors) {
  const { officialGame, goalieIdx, homeAbbr, awayAbbr } = ctx;
  const { home: homeGoalie, away: awayGoalie } = await resolveStartingGoalies(officialGame, goalieIdx);

  let goalieEdge = 0;
  let explain = "No goalie data available.";

  if (homeGoalie && awayGoalie) {
    const gsaxHome = homeGoalie.gsax ?? 0;
    const gsaxAway = awayGoalie.gsax ?? 0;
    goalieEdge = gsaxHome - gsaxAway;
    explain = `${homeGoalie.name} (${homeAbbr}) vs ${awayGoalie.name} (${awayAbbr})`;
    console.log(`[GOALIE EDGE] ${explain} → ΔGSAx: ${goalieEdge.toFixed(2)}`);
  }

  keyFactors.push({
    name: "Historical Goalie Edge (GSAx)",
    value: goalieEdge.toFixed(2),
    explain,
  });
}

function explain(reason, ctx = {}) {
  console.warn(`[KF-EXPLAIN] ${reason}`, ctx);
}

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
async function enrichPrediction(ctx, game, base, keyFactors) {
  try {
  const H = normalizeTeamAbbrev(game.homeAbbr);
  const A = normalizeTeamAbbrev(game.awayAbbr);

  const advHome = ctx.advByTeam?.get(H);
  const advAway = ctx.advByTeam?.get(A);
  const liveHome = ctx.liveByTeam?.get(H);
  const liveAway = ctx.liveByTeam?.get(A);

  if (!advHome || !advAway) {
    explain('missing_adv_stats', { matchup: `${A}@${H}`, haveHome: !!advHome, haveAway: !!advAway });
  }
  if (!liveHome || !liveAway) {
    explain('missing_live_stats', { matchup: `${A}@${H}`, haveHome: !!liveHome, haveAway: !!liveAway });
  }

  const advHomeSafe = advHome || {};
  const advAwaySafe = advAway || {};
  const liveHomeSafe = liveHome || {};
  const liveAwaySafe = liveAway || {};

  // Key factors—always produce numbers, never “N/A”
  const allKeyFactors = [
    {
      label: "Hybrid Data (Live + Historical Player Ratings)",
      home: nonNullNum(advHomeSafe.hybridRating, 50),
      away: nonNullNum(advAwaySafe.hybridRating, 50),
      units: "rating/100",
      sample: {
        homePlayers: nonNullNum(advHomeSafe.playerCount, 0),
        awayPlayers: nonNullNum(advAwaySafe.playerCount, 0)
      },
      explanation: (advHomeSafe.playerCount || advAwaySafe.playerCount)
        ? "Combined current + historical player strength."
        : "Used neutral blend due to limited player hydration."
    },
    {
      label: "Injury Impact",
      home: nonNullNum(advHomeSafe.injuryImpact, 0),
      away: nonNullNum(advAwaySafe.injuryImpact, 0),
      units: "players",
      explanation: "Number of materially impactful absences (est.)."
    },
    {
      label: "5-on-5 xG%",
      home: asPct(advHomeSafe.xgPct, 50),
      away: asPct(advAwaySafe.xgPct, 50),
      units: "%",
      explanation: "Even-strength expected goal share."
    },
    {
      label: "High-Danger Battle",
      home: asPct(advHomeSafe.hdPct, 50),
      away: asPct(advAwaySafe.hdPct, 50),
      units: "%",
      explanation: "High-danger chances share."
    },
    {
      label: "Special Teams Duel",
      home: nonNullNum(advHomeSafe.specialTeamsDelta, 0),
      away: nonNullNum(advAwaySafe.specialTeamsDelta, 0),
      units: "net% pts",
      explanation: "PP - PK net effectiveness."
    },
    {
      label: "PDO (Luck Factor)",
      home: nonNullNum(liveHomeSafe.pdo, 1000),
      away: nonNullNum(liveAwaySafe.pdo, 1000),
      units: "x1000",
      explanation: "SV% + SH% scaled."
    },
    {
      label: "Faceoff Advantage",
      home: asPct(liveHomeSafe.foPct, 50),
      away: asPct(liveAwaySafe.foPct, 50),
      units: "%",
      explanation: "Team faceoff win%."
    }
  ];

  // Add goalie edge to the list
  await addGoalieEdge(ctx, allKeyFactors);

  return { ...base, keyFactors: allKeyFactors };
  } catch (e) {
    console.warn('[KF-EXPLAIN] Enrichment failure:', e.message);
    return { ...base, keyFactors: [], goalieStats: {}, hybridRating: 0 };
  }
}

module.exports = { enrichPrediction };