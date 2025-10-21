// src/utils/enrichPrediction.js
const { getGoalieData } = require("./goalieIndex.js");

function safeNum(n, fallback = null) {
  const v = Number(n);
  return Number.isFinite(v) ? v : fallback;
}

async function enrichNhlPrediction(matchup) {
  const goalieData = await getGoalieData(matchup, matchup.mongoGoalieStats);

  // Ensure keyFactors exists on the matchup object
  if (!matchup.keyFactors) {
    matchup.keyFactors = {};
  }
  
  matchup.keyFactors["Goalie Matchup"] = {
    homeGoalie: goalieData.homeGoalie || "N/A",
    awayGoalie: goalieData.awayGoalie || "N/A",
    source: goalieData.source
  };

  matchup.keyFactors["Current Goalie Form"] = {
    home: goalieData.homeForm.toFixed(2),
    away: goalieData.awayForm.toFixed(2),
    source: goalieData.source
  };

  matchup.keyFactors["Historical Goalie Edge (GSAx)"] = {
    home: goalieData.homeGSAx.toFixed(2),
    away: goalieData.awayGSAx.toFixed(2),
    diff: (goalieData.homeGSAx - goalieData.awayGSAx).toFixed(2)
  };

  matchup.keyFactors["Goalie Matchup Rating"] = (
    goalieData.homeForm * 0.6 + goalieData.homeGSAx * 0.4
  ) - (
    goalieData.awayForm * 0.6 + goalieData.awayGSAx * 0.4
  );

  return matchup;
}

module.exports = { enrichNhlPrediction };