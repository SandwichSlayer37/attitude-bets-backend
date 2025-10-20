// src/utils/enrichPrediction.js
const { findGoalie } = require('./goalieIndex.js');

function safeNum(n, fallback = null) {
  const v = Number(n);
  return Number.isFinite(v) ? v : fallback;
}

function enrichPrediction(basePrediction, ctx) {
  const {
    homeAbbr, awayAbbr,
    homeGoalieMeta, awayGoalieMeta,     // { id, name } if your scheduler provides it
    liveGoaliesByTeam,                  // optional mapping teamAbbr -> goalie list or starter
    goalieIdx,                          // from buildGoalieIndex()
    specialTeamsByTeam,                 // { teamAbbr: { pp, pk } }
    injuriesByTeam,                     // { teamAbbr: [...] }
    hybridCountsByTeam,                 // { teamAbbr: count }
    historicalAdvancedByTeam            // { teamAbbr: { xg5v5, hdc%, etc } }
  } = ctx;

  const homeMeta = homeGoalieMeta || {};
  const awayMeta = awayGoalieMeta || {};

  // resolve goalies using id or name against the index + live fallback
  function resolveGoalie(meta, teamAbbr) {
    // 1) Try explicit meta (id/name) via index
    let found = findGoalie({ id: meta.id, name: meta.name }, goalieIdx);
    // 2) If missing, try live starter list if provided
    if (!found && liveGoaliesByTeam?.[teamAbbr]?.starter) {
      const starter = liveGoaliesByTeam[teamAbbr].starter;
      found = findGoalie({ id: starter.playerId || starter.id, name: starter.name }, goalieIdx) ||
              { name: starter.name, gaaLast5: starter.gaaLast5 || null, gsax: starter.gsax || null, source: 'live' };
    }
    return found || null;
  }

  const homeGoalie = resolveGoalie(homeMeta, homeAbbr);
  const awayGoalie = resolveGoalie(awayMeta, awayAbbr);

  const homeGAA = safeNum(homeGoalie?.gaaLast5 ?? homeGoalie?.gaa, null);
  const awayGAA = safeNum(awayGoalie?.gaaLast5 ?? awayGoalie?.gaa, null);

  const homeGSAX = safeNum(homeGoalie?.gsax, null);
  const awayGSAX = safeNum(awayGoalie?.gsax, null);

  // special teams/injuries/hybrid
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
      homePP: safeNum(stHome.pp, null), homePK: safeNum(stHome.pk, null),
      awayPP: safeNum(stAway.pp, null), awayPK: safeNum(stAway.pk, null),
      edge: (safeNum(stHome.pp, null) != null && safeNum(stAway.pp, null) != null) ? Number(((stHome.pp - stAway.pp) + (stHome.pk - stAway.pk)).toFixed(2)) : null,
    },
    injuries: { totalAffected: (injHome.length || 0) + (injAway.length || 0) },
    hybridData: { totalPlayers: Number(hybridHome || 0) + Number(hybridAway || 0) },
    historicalAdvanced: { home: advHome, away: advAway }
  };

  return { ...basePrediction, keyFactors, factors: basePrediction.factors || keyFactors };
}

module.exports = { enrichPrediction };