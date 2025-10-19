// src/utils/enrichPrediction.js
const { findGoalie } = require('./goalieIndex');

function safeNum(n, fallback = null) {
  const v = Number(n);
  return Number.isFinite(v) ? v : fallback;
}

function enrichPrediction(basePrediction, ctx) {
  const {
    homeAbbr, awayAbbr,
    homeGoalieMeta, awayGoalieMeta,
    liveGoaliesByTeam, goalieIdx,
    specialTeamsByTeam, injuriesByTeam,
    hybridCountsByTeam, historicalAdvancedByTeam
  } = ctx;

  const homeGoalie = findGoalie(homeGoalieMeta || {}, goalieIdx);
  const awayGoalie = findGoalie(awayGoalieMeta || {}, goalieIdx);

  const homeGAA = safeNum(homeGoalie?.gaaLast5 ?? homeGoalie?.gaa, null);
  const awayGAA = safeNum(awayGoalie?.gaaLast5 ?? awayGoalie?.gaa, null);
  const homeGSAX = safeNum(homeGoalie?.gsax, null);
  const awayGSAX = safeNum(awayGoalie?.gsax, null);

  const stHome = specialTeamsByTeam?.[homeAbbr] || {};
  const stAway = specialTeamsByTeam?.[awayAbbr] || {};
  const injHome = injuriesByTeam?.[homeAbbr] || [];
  const injAway = injuriesByTeam?.[awayAbbr] || [];
  const hybridHome = hybridCountsByTeam?.[homeAbbr] ?? 0;
  const hybridAway = hybridCountsByTeam?.[awayAbbr] ?? 0;
  const advHome = historicalAdvancedByTeam?.[homeAbbr] || {};
  const advAway = historicalAdvancedByTeam?.[awayAbbr] || {};

  const keyFactors = {
    goalieForm: {
      home: { name: homeGoalie?.name || 'N/A', gaaLast5: homeGAA, source: homeGoalie?.source || 'none' },
      away: { name: awayGoalie?.name || 'N/A', gaaLast5: awayGAA, source: awayGoalie?.source || 'none' },
      edge: (awayGAA != null && homeGAA != null) ? Number((awayGAA - homeGAA).toFixed(2)) : null,
    },
    historicalGoalieEdge: {
      home: { name: homeGoalie?.name || 'N/A', gsax: homeGSAX, source: homeGoalie?.source || 'none' },
      away: { name: awayGoalie?.name || 'N/A', gsax: awayGSAX, source: awayGoalie?.source || 'none' },
      edge: (homeGSAX != null && awayGSAX != null) ? Number((homeGSAX - awayGSAX).toFixed(2)) : null,
    },
    specialTeams: {
      homePP: safeNum(stHome.pp, null),
      homePK: safeNum(stHome.pk, null),
      awayPP: safeNum(stAway.pp, null),
      awayPK: safeNum(stAway.pk, null),
    },
    injuries: { totalAffected: (injHome.length || 0) + (injAway.length || 0) },
    hybridData: { totalPlayers: Number(hybridHome || 0) + Number(hybridAway || 0) },
    historicalAdvanced: { home: advHome, away: advAway },
  };

  return { ...basePrediction, keyFactors, factors: keyFactors };
}

module.exports = { enrichPrediction };
