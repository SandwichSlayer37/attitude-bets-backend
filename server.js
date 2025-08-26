const express = require('express');
const cors =require('cors');
const axios = require('axios');
const cheerio = require('cheerio');

// It's recommended to secure your app in a production environment
// For now, this allows your frontend to connect.
app.use(cors()); 

// --- DATABASE & CONSTANTS ---
// Data moved from the original HTML file to the server
const FUTURES_PICKS_DB = {
    'baseball_mlb': { championship: 'Los Angeles Dodgers', hotPick: 'Houston Astros' },
    'icehockey_nhl': { championship: 'Colorado Avalanche', hotPick: 'New York Rangers' },
    'americanfootball_nfl': { championship: 'Kansas City Chiefs', hotPick: 'Detroit Lions' }
};

// The prediction engine's weighting system, now living on the server
function getDynamicWeights(sportKey) {
    if (sportKey === 'baseball_mlb') return { record: 6, fatigue: 8, momentum: 3, matchup: 12, value: 5, newsSentiment: 10, injuryImpact: 12, offensiveForm: 8, defensiveForm: 8, h2h: 12, weather: 8 };
    if (sportKey === 'icehockey_nhl') return { record: 7, fatigue: 7, momentum: 6, matchup: 8, value: 6, newsSentiment: 9, injuryImpact: 11, offensiveForm: 9, defensiveForm: 9, h2h: 10, weather: 0 };
    if (sportKey === 'americanfootball_nfl') return { record: 8, fatigue: 9, momentum: 4, matchup: 10, value: 5, newsSentiment: 12, injuryImpact: 15, offensiveForm: 10, defensiveForm: 10, h2h: 10, weather: 8 };
    return { record: 8, fatigue: 7, momentum: 5, matchup: 10, value: 5, newsSentiment: 10, injuryImpact: 12, offensiveForm: 9, defensiveForm: 9, h2h: 11, weather: 5 };
}

// --- DATA SCRAPING & FETCHING ---
const scrapeCache = new Map();

async function getOdds(sportKey) {
    // Basic caching to avoid re-fetching odds on every call during development
    if (scrapeCache.has(sportKey)) return scrapeCache.get(sportKey);
    
    try {
        const { data } = await axios.get(`https://api.the-odds-api.com/v4/sports/${sportKey}/odds/?regions=us&markets=h2h,spreads,totals&oddsFormat=decimal&apiKey=${process.env.ODDS_API_KEY}`);
        scrapeCache.set(sportKey, data);
        return data;
    } catch (error) {
        console.error(`Error fetching odds for ${sportKey}:`, error.message);
        return []; // Return empty on error so the app doesn't crash
    }
}

async function getTeamStats(sportKey) {
    const statsCacheKey = `${sportKey}_stats`;
    if (scrapeCache.has(statsCacheKey)) return scrapeCache.get(statsCacheKey);

    if (sportKey === 'icehockey_nhl') {
        try {
            const currentYear = new Date().getFullYear() + 1;
            const { data } = await axios.get(`https://www.hockey-reference.com/leagues/NHL_${currentYear}_standings.html`);
            const $ = cheerio.load(data);
            const standings = {};
            $('#all_standings tbody tr.full_table').each((i, el) => {
                const row = $(el);
                const teamName = row.find('th[data-stat="team_name"] a').text();
                if (teamName) {
                    standings[teamName] = {
                        record: `${row.find('td[data-stat="wins"]').text()}-${row.find('td[data-stat="losses"]').text()}`,
                        // Placeholder for more detailed stats you could scrape
                    };
                }
            });
            scrapeCache.set(statsCacheKey, standings);
            return standings;
        } catch (error) {
            console.error("Error scraping NHL standings:", error.message);
            return {};
        }
    }
    // Add scrapers for other sports here...
    return {}; // Return empty for unhandled sports
}


// --- PREDICTION ENGINE (Ported from original HTML) ---
function runPredictionEngine(game, sportKey, allTeamStats) {
    const weights = getDynamicWeights(sportKey);
    const { home_team, away_team } = game;
    
    // Use scraped stats instead of the old hardcoded DB
    const homeStats = allTeamStats[home_team] || { record: '0-0' };
    const awayStats = allTeamStats[away_team] || { record: '0-0' };
    
    // **IMPROVEMENT**: Replace this simulated data with real data sources
    // e.g., A weather API, an injury report scraper, etc.
    const dynamicData = {
        home: { news: Math.random() * 5 + 4, injury: Math.random() * 5, fatigue: Math.random() * 3 },
        away: { news: Math.random() * 5 + 4, injury: Math.random() * 5, fatigue: Math.random() * 5 + 2 },
        weather: { temp: Math.floor(Math.random() * 25) + 5, wind: Math.floor(Math.random() * 30), precip: Math.floor(Math.random() * 50) }
    };

    let homeScore = 50, awayScore = 50;
    const factors = {};
    const parseRecord = (rec) => rec ? { w: parseInt(rec.split('-')[0]), l: parseInt(rec.split('-')[1]) } : { w: 0, l: 1 };
    const getWinPct = (rec) => (rec.w + rec.l) > 0 ? rec.w / (rec.w + rec.l) : 0;
    
    // Calculate factors just like in the original file
    factors['Record'] = { value: (getWinPct(parseRecord(homeStats.record)) - getWinPct(parseRecord(awayStats.record))) * weights.record, homeStat: homeStats.record, awayStat: awayStats.record };
    factors['Fatigue'] = { value: (dynamicData.away.fatigue - dynamicData.home.fatigue) * weights.fatigue, homeStat: `${dynamicData.home.fatigue.toFixed(1)}/10`, awayStat: `${dynamicData.away.fatigue.toFixed(1)}/10` };
    factors['News Sentiment'] = { value: (dynamicData.home.news - dynamicData.away.news) * weights.newsSentiment, homeStat: `${dynamicData.home.news.toFixed(1)}/10`, awayStat: `${dynamicData.away.news.toFixed(1)}/10` };
    factors['Injury Impact'] = { value: (dynamicData.away.injury - dynamicData.home.injury) * weights.injuryImpact, homeStat: `${dynamicData.home.injury.toFixed(1)}/10`, awayStat: `${dynamicData.away.injury.toFixed(1)}/10` };

    for (const factor in factors) {
        homeScore += factors[factor].value;
        awayScore -= factors[factor].value;
    }
    
    // Final power calculation
    const finalHomePower = (homeScore / (homeScore + awayScore)) * 100;
    const finalAwayPower = 100 - finalHomePower;
    const winner = finalHomePower > finalAwayPower ? home_team : away_team;
    const confidence = Math.abs(finalHomePower - finalAwayPower) / 100;
    let strengthText;
    if (confidence > 0.3) strengthText = "Strong Advantage";
    else if (confidence > 0.15) strengthText = "Good Chance";
    else strengthText = "Slight Edge";
    
    // Return a rich object for the frontend to use
    return { winner, strengthText, factors, weather: dynamicData.weather };
}

// --- API ENDPOINTS ---
app.get('/predictions', async (req, res) => {
    const { sport } = req.query;
    if (!sport) return res.status(400).json({ error: "Sport parameter is required." });

    try {
        const [games, teamStats] = await Promise.all([
            getOdds(sport),
            getTeamStats(sport)
        ]);

        if (!games || games.length === 0) {
            return res.json({ message: `No upcoming games for ${sport}. The season may be over.` });
        }
        
        const predictions = games.map(game => {
            const predictionData = runPredictionEngine(game, sport, teamStats);
            return { game, prediction: predictionData };
        }).filter(p => p && p.prediction); // Filter out any games that failed prediction

        res.json(predictions);
    } catch (error) {
        res.status(500).json({ error: "Failed to process predictions.", details: error.message });
    }
});

app.get('/futures', (req, res) => {
    res.json(FUTURES_PICKS_DB);
});

app.get('/', (req, res) => {
    res.send('Attitude Sports Bets API is online.');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
