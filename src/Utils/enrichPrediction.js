// src/Utils/enrichPrediction.js
const { findByPlayerId } = require('./goalieIndex');

/**
 * Enriches the final prediction object with detailed goalie matchup analysis.
 * @param {object} predictionData The prediction object to be modified.
 * @param {object} context The context object containing all necessary data.
 * @param {string} homeAbbr The home team's abbreviation.
 * @param {string} awayAbbr The away team's abbreviation.
 */
function enrichGoalieData(predictionData, context, homeAbbr, awayAbbr) {
    if (!context || !context.goalieIdx || !context.probableStarters) {
        console.warn("[Enrich] Missing goalie context, cannot enrich prediction.");
        return;
    }

    const { goalieIdx, probableStarters } = context;

    // Use the findByPlayerId function to look up goalies from the hydrated index
    const homeGoalie = findByPlayerId(probableStarters.homeId, goalieIdx);
    const awayGoalie = findByPlayerId(probableStarters.awayId, goalieIdx);

    const homeGSAx = homeGoalie?.gsax ?? 0;
    const awayGSAx = awayGoalie?.gsax ?? 0;

    // Add or update the 'Historical Goalie Edge' factor in the prediction
    predictionData.factors['Historical Goalie Edge (GSAx)'] = {
        value: homeGSAx - awayGSAx,
        homeStat: homeGSAx.toFixed(2),
        awayStat: awayGSAx.toFixed(2),
        explain: homeGoalie && awayGoalie
            ? `${homeGoalie.name.split(' ')[1]} vs ${awayGoalie.name.split(' ')[1]}`
            : "Probable starter not confirmed."
    };
    
    // Placeholder for live goalie form - can be expanded later
    predictionData.factors['Current Goalie Form'] = {
        value: 0,
        homeStat: 'N/A',
        awayStat: 'N/A',
        explain: "Live goalie form data is not yet integrated."
    };
}

module.exports = {
    enrichGoalieData
};