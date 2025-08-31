app.get('/api/special-picks', async (req, res) => {
    try {
        const { allPredictions, gameCounts } = await getAllDailyPredictions();
        
        // --- DYNAMIC THRESHOLD LOGIC ---
        let sportsInSeason = 0;
        for(const sport of SPORTS_DB) {
            if(gameCounts[sport.key] >= sport.gameCountThreshold) {
                sportsInSeason++;
            }
        }
        const isPeakSeason = sportsInSeason >= 2;
        
        const potdConfidenceThreshold = isPeakSeason ? 15 : 10;
        const potdValueThreshold = isPeakSeason ? 5 : 2.5;
        // --- FIX: Raised parlay threshold to ensure higher quality picks ---
        const parlayConfidenceThreshold = 7.5; // Always require "Good Chance" or better for a parlay leg
        
        // --- FIX: Filter for games in the next 24 hours for better timezone handling ---
        const now = new Date();
        const cutoff = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24 hours from now
        const upcomingTodayPredictions = allPredictions.filter(p => {
            const gameDate = new Date(p.game.commence_time);
            return gameDate > now && gameDate < cutoff;
        });

        let pickOfTheDay = null;
        let parlay = null;

        // --- Pick of the Day Logic ---
        const highValuePicks = upcomingTodayPredictions.filter(p => {
            const value = p.prediction.winner === p.game.home_team ? p.prediction.homeValue : p.prediction.awayValue;
            return p.prediction.confidence > potdConfidenceThreshold && typeof value === 'number' && value > potdValueThreshold;
        });

        if (highValuePicks.length > 0) {
            pickOfTheDay = highValuePicks.reduce((best, current) => {
                const bestValue = best.prediction.winner === best.game.home_team ? best.prediction.homeValue : best.prediction.awayValue;
                const currentValue = current.prediction.winner === current.game.home_team ? current.prediction.homeValue : current.prediction.awayValue;
                const bestScore = best.prediction.confidence + bestValue;
                const currentScore = current.prediction.confidence + currentValue;
                return currentScore > bestScore ? current : best;
            });
        }
        
        // --- Parlay of the Day Logic ---
        const goodPicks = upcomingTodayPredictions.filter(p => p.prediction.confidence > parlayConfidenceThreshold)
            .sort((a, b) => (b.prediction.confidence + (b.prediction.winner === b.game.home_team ? b.prediction.homeValue : b.prediction.awayValue)) - 
                             (a.prediction.confidence + (a.prediction.winner === a.game.home_team ? a.prediction.homeValue : a.prediction.awayValue)));
        
        if (goodPicks.length >= 2) {
            const leg1 = goodPicks[0];
            const leg2 = goodPicks[1];
            
            const odds1 = leg1.game.bookmakers?.[0]?.markets?.find(m=>m.key==='h2h')?.outcomes?.find(o=>o.name===leg1.prediction.winner)?.price || 0;
            const odds2 = leg2.game.bookmakers?.[0]?.markets?.find(m=>m.key==='h2h')?.outcomes?.find(o=>o.name===leg2.prediction.winner)?.price || 0;

            if (odds1 && odds2) {
                parlay = {
                    legs: [leg1, leg2],
                    totalOdds: (odds1 * odds2).toFixed(2)
                };
            }
        }

        res.json({ pickOfTheDay, parlay });
    } catch (error) {
        console.error("Special Picks Error:", error);
        res.status(500).json({ error: 'Failed to generate special picks.' });
    }
});
