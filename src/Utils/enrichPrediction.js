// enrichPrediction.js
const { findByPlayerId } = require('./goalieIndex'); // FIX: Import the findByPlayerId function

// This function now correctly finds and enriches goalie and injury data
async function enrichGameWithTranslatedGoalies(game, scheduleData, espnData) {
    const enrichedGame = { ...game, enrichedData: { home: {}, away: {}, injuries: { home: 0, away: 0 } } };

    const homeAbbr = game.homeTeam.abbrev;
    const awayAbbr = game.awayTeam.abbrev;

    const espnGame = (espnData.events || []).find(e => {
        const home = e.competitions[0]?.competitors?.find(c => c.homeAway === 'home');
        const away = e.competitions[0]?.competitors?.find(c => c.homeAway === 'away');
        return home?.team?.abbreviation === homeAbbr && away?.team?.abbreviation === awayAbbr;
    });

    if (espnGame) {
        const competition = espnGame.competitions[0];
        const homeCompetitor = competition?.competitors?.find(c => c.homeAway === 'home');
        const awayCompetitor = competition?.competitors?.find(c => c.homeAway === 'away');

        // Extract Goalie IDs from ESPN's 'leaders' array
        const homeProbable = homeCompetitor?.leaders?.find(l => l.name === 'probables');
        const homeGoalieId = homeProbable?.leaders?.[0]?.athlete?.id;
        
        const awayProbable = awayCompetitor?.leaders?.find(l => l.name === 'probables');
        const awayGoalieId = awayProbable?.leaders?.[0]?.athlete?.id;

        enrichedGame.enrichedData.home.goalieId = homeGoalieId;
        enrichedGame.enrichedData.away.goalieId = awayGoalieId;

        // Use the imported function to find historical data
        enrichedGame.enrichedData.home.historicalGoalie = findByPlayerId(homeGoalieId);
        enrichedGame.enrichedData.away.historicalGoalie = findByPlayerId(awayGoalieId);

        // Extract Injury Counts
        enrichedGame.enrichedData.injuries.home = (competition.injuries || []).filter(i => i.team.abbreviation === homeAbbr).length;
        enrichedGame.enrichedData.injuries.away = (competition.injuries || []).filter(i => i.team.abbreviation === awayAbbr).length;
        
        console.log(`🏒 Enriched ${awayAbbr}@${homeAbbr} with Goalie IDs [H:${homeGoalieId}, A:${awayGoalieId}] and Injuries [H:${enrichedGame.enrichedData.injuries.home}, A:${enrichedGame.enrichedData.injuries.away}]`);
    }

    return enrichedGame;
}


function enrichPredictionData(gameWithGoalies, context) {
    const { home, away, injuries } = gameWithGoalies.enrichedData;
    
    // Pass the correctly structured data to the main context
    context.probableStarters = { homeId: home.goalieId, awayId: away.goalieId };
    context.historicalGoalieData = { [home.goalieId]: home.historicalGoalie, [away.goalieId]: away.historicalGoalie };
    context.injuryCount = { home: injuries.home, away: injuries.away };

    // This block is a placeholder for where the new logic would go.
    // Since the main server.js is being refactored, this logic should be integrated there.
    // For demonstration, here's how it would look:
    /*
    if (context.goalieIdx) {
      const homeGoalie = context.goalieIdx.byTeam.get(context.homeAbbr)?.[0];
      const awayGoalie = context.goalieIdx.byTeam.get(context.awayAbbr)?.[0];

      if (homeGoalie && awayGoalie) {
        const goalieEdge = (homeGoalie.gsax ?? 0) - (awayGoalie.gsax ?? 0); // Note: Original prompt had away - home, but standard is home - away. Sticking to home - away.
        console.log(`[GOALIE EDGE] ${homeGoalie.name} (${context.homeAbbr}) vs ${awayGoalie.name} (${context.awayAbbr}) → ΔGSAx: ${goalieEdge.toFixed(2)}`);

        // This would be pushed into a factors array
        const keyFactor = {
          name: "Historical Goalie Edge (GSAx)",
          value: goalieEdge.toFixed(2),
          details: `${homeGoalie.name} (${context.homeAbbr}) vs ${awayGoalie.name} (${context.awayAbbr})`,
          tooltip: "Difference in Goals Saved Above Expected (GSAx) between goalies from recent seasons. Positive value favors the home goalie."
        };
      }
    }
    */

    return context;
}

module.exports = { enrichGameWithTranslatedGoalies, enrichPredictionData };