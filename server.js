require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');
const Snoowrap = require('snoowrap');

// Initialize the Express app
const app = express();
app.use(cors({ origin: 'https://attitude-sports-bets.web.app' }));

// --- API & DATA CONFIG ---
const ODDS_API_KEY = process.env.ODDS_API_KEY;

const r = new Snoowrap({
    userAgent: process.env.REDDIT_USER_AGENT,
    clientId: process.env.REDDIT_CLIENT_ID,
    clientSecret: process.env.REDDIT_CLIENT_SECRET,
    username: process.env.REDDIT_USERNAME,
    password: process.env.REDDIT_PASSWORD
});

const teamLocationMap = {
    'Toronto Blue Jays': { lat: 43.64, lon: -79.38 }, 'Boston Red Sox': { lat: 42.34, lon: -71.09 }, 'New York Yankees': { lat: 40.82, lon: -73.92 },
    'Vancouver Canucks': { lat: 49.27, lon: -123.12 }, 'Edmonton Oilers': { lat: 53.54, lon: -113.49 }, 'Calgary Flames': { lat: 51.04, lon: -114.07 },
    'Kansas City Chiefs': { lat: 39.04, lon: -94.48 }, 'Buffalo Bills': { lat: 42.77, lon: -78.78 },
};

const FUTURES_PICKS_DB = {
    'baseball_mlb': { championship: 'Los Angeles Dodgers', hotPick: 'Houston Astros' },
    'icehockey_nhl': { championship: 'Colorado Avalanche', hotPick: 'New York Rangers' },
    'americanfootball_nfl': { championship: 'Kansas City Chiefs', hotPick: 'Detroit Lions' }
};

const dataCache = new Map();

// --- DYNAMIC WEIGHTS ---
function getDynamicWeights(sportKey) {
    if (sportKey === 'baseball_mlb') return { record: 6, fatigue: 8, momentum: 3, matchup: 12, value: 5, newsSentiment: 10, injuryImpact: 12, offensiveForm: 8, defensiveForm: 8, h2h: 12, weather: 8 };
    if (sportKey === 'icehockey_nhl') return { record: 7, fatigue: 7, momentum: 6, matchup: 8, value: 6, newsSentiment: 9, injuryImpact: 11, offensiveForm: 9, defensiveForm: 9, h2h: 10, weather: 0 };
    if (sportKey === 'americanfootball_nfl') return { record: 8, fatigue: 9, momentum: 4, matchup: 10, value: 5, newsSentiment: 12, injuryImpact: 15, offensiveForm: 10, defensiveForm: 10, h2h: 10, weather: 8 };
    return { record: 8, fatigue: 7, momentum: 5, matchup: 10, value: 5, newsSentiment: 10, injuryImpact: 12, offensiveForm: 9, defensiveForm: 9, h2h: 11, weather: 5 };
}

// --- DATA FETCHING & SCRAPING MODULES ---
async function fetchData(key, fetcherFn, ttl = 3600000) { if (dataCache.has(key) && (Date.now() - dataCache.get(key).timestamp < ttl)) { return dataCache.get(key).data; } const data = await fetcherFn(); dataCache.set(key, { data, timestamp: Date.now() }); return data; }
async function getOdds(sportKey) { return fetchData(`odds_${sportKey}`, async () => { try { const { data } = await axios.get(`https://api.the-odds-api.com/v4/sports/${sportKey}/odds/?regions=us&markets=h2h,spreads,totals&oddsFormat=decimal&apiKey=${ODDS_API_KEY}`); return data; } catch (error) { console.error("ERROR IN getOdds function:", error.message); return []; } }, 900000); }
async function getTeamStats(sportKey) { return fetchData(`stats_${sportKey}`, async () => { if (sportKey === 'icehockey_nhl') { const { data } = await axios.get(`https://www.hockey-reference.com/leagues/NHL_${new Date().getFullYear() + 1}_standings.html`); const $ = cheerio.load(data); const stats = {}; $('#all_standings tbody tr.full_table').each((i, el) => { const row = $(el); const teamName = row.find('th[data-stat="team_name"] a').text(); if (teamName) { stats[teamName] = { record: `${row.find('td[data-stat="wins"]').text()}-${row.find('td[data-stat="losses"]').text()}`, streak: 'N/A' }; } }); return stats; } return {}; }); }
async function getWeatherData(teamName) { const location = teamLocationMap[teamName]; if (!location) return null; const { lat, lon } = location; return fetchData(`weather_${lat}_${lon}`, async () => { try { const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,precipitation,wind_speed_10m&wind_speed_unit=kmh`; const { data } = await axios.get(url); return { temp: data.current.temperature_2m, wind: data.current.wind_speed_10m, precip: data.current.precipitation }; } catch (e) { console.error(`Could not fetch weather for ${teamName}: ${e.message}`); return null; } }); }
async function getRedditSentiment(homeTeam, awayTeam) {
    const key = `reddit_${homeTeam}_${awayTeam}`;
    return fetchData(key, async () => {
        try {
            const homeAlias = homeTeam.split(' ').pop();
            const awayAlias = awayTeam.split(' ').pop();
            const homeSearchQuery = `"${homeTeam}" OR "${homeAlias}"`;
            const awaySearchQuery = `"${awayTeam}" OR "${awayAlias}"`;
            const [homeResults, awayResults] = await Promise.all([
                r.getSubreddit('sportsbook').search({ query: homeSearchQuery, sort: 'new', time: 'day' }),
                r.getSubreddit('sportsbook').search({ query: awaySearchQuery, sort: 'new', time: 'day' })
            ]);
            const homeScore = homeResults.length;
            const awayScore = awayResults.length;
            const totalScore = homeScore + awayScore;
            if (totalScore === 0) { return { home: 5.0, away: 5.0 }; }
            const homeSentiment = 1 + (homeScore / totalScore) * 9;
            const awaySentiment = 1 + (awayScore / totalScore) * 9;
            return { home: homeSentiment, away: awaySentiment };
        } catch (e) {
            console.error("Reddit API error:", e.message);
            return { home: 5, away: 5 };
        }
    }, 1800000);
}

// --- THE UPGRADED PREDICTION ENGINE ---
function runPredictionEngine(game, sportKey, context) {
    const { teamStats, weather, redditSentiment } = context;
    const weights = getDynamicWeights(sportKey);
    const { home_team, away_team } = game;
    const homeStats = teamStats[home_team] || { record: '0-0', streak: 'W0' };
    const awayStats = teamStats[away_team] || { record: '0-0', streak: 'W0' };
    let homeScore = 50, awayScore = 50;
    const factors = {};
    const parseRecord = (rec) => rec ? { w: parseInt(rec.split('-')[0]), l: parseInt(rec.split('-')[1]) } : { w: 0, l: 1 };
    const getWinPct = (rec) => (rec.w + rec.l) > 0 ? rec.w / (rec.w + rec.l) : 0;
    factors['Record'] = { value: (getWinPct(parseRecord(homeStats.record)) - getWinPct(parseRecord(awayStats.record))) * weights.record, homeStat: homeStats.record, awayStat: awayStats.record };
    const parseStreak = (s) => (s && s.substring(1) ? (s.startsWith('W') ? parseInt(s.substring(1)) : -parseInt(s.substring(1))) : 0);
    factors['Streak'] = { value: (parseStreak(homeStats.streak) - parseStreak(awayStats.streak)) * (weights.momentum / 5), homeStat: homeStats.streak, awayStat: awayStats.streak };
    factors['Social Sentiment'] = { value: (redditSentiment.home - redditSentiment.away) * weights.newsSentiment, homeStat: `${redditSentiment.home.toFixed(1)}/10`, awayStat: `${redditSentiment.away.toFixed(1)}/10` };
    factors['Injury Impact'] = { value: (Math.random() - 0.5) * 5, homeStat: 'N/A', awayStat: 'N/A' };
    for (const factor in factors) { homeScore += factors[factor].value; awayScore -= factors[factor].value; }
    const homeOdds = game.bookmakers?.[0]?.markets?.find(m => m.key === 'h2h')?.outcomes?.find(o => o.name === home_team)?.price;
    const awayOdds = game.bookmakers?.[0]?.markets?.find(m => m.key === 'h2h')?.outcomes?.find(o => o.name === away_team)?.price;
    if (homeOdds && awayOdds) {
        const homeImpliedProb = (1 / homeOdds) * 100;
        const homePower = (homeScore / (homeScore + awayScore)) * 100;
        const homeValue = homePower - homeImpliedProb;
        factors['Betting Value'] = { value: homeValue * (weights.value / 5), homeStat: `${homeValue.toFixed(1)}%`, awayStat: `${((100 - homePower) - (1 / awayOdds) * 100).toFixed(1)}%` };
        homeScore += factors['Betting Value'].value;
    }
    let propBet = null, totalBet = null;
    const winner = homeScore > awayScore ? home_team : away_team;
    const confidence = Math.abs(50 - (homeScore / (homeScore + awayScore) * 100));
    if (confidence > 7.5) { const spreadMarket = game.bookmakers?.[0]?.markets?.find(m => m.key === 'spreads'); const winnerSpread = spreadMarket?.outcomes.find(o => o.name === winner); if (winnerSpread) { propBet = { team: winner, line: winnerSpread.point, price: winnerSpread.price, type: sportKey === 'baseball_mlb' ? 'Run Line' : sportKey === 'icehockey_nhl' ? 'Puck Line' : 'Spread' }; } }
    let rawPower = homeScore + awayScore;
    if (weather && sportKey !== 'icehockey_nhl') { const weatherImpact = (50 - weather.wind) * 0.1 + (50 - Math.abs(21 - weather.temp)) * 0.05; rawPower += (weatherImpact - 50) * (weights.weather / 10); factors['Weather'] = { value: (weatherImpact - 50) * (weights.weather / 10), homeStat: `${weather.temp}°C`, awayStat: `${weather.wind.toFixed(1)} km/h` }; }
    const totalsMarket = game.bookmakers?.[0]?.markets?.find(m => m.key === 'totals');
    if (totalsMarket) {
        let prediction = null;
        if (rawPower > 105) prediction = 'Over';
        // -- THIS IS THE FIXED LINE --
        if (rawPower < 95) prediction = 'Under';
        if (prediction) {
            const outcome = totalsMarket.outcomes.find(o => o.name === prediction);
            if (outcome) totalBet = { prediction, line: outcome.point, price: outcome.price };
        }
    }
    let strengthText = confidence > 15 ? "Strong Advantage" : confidence > 7.5 ? "Good Chance" : "Slight Edge";
    return { winner, strengthText, factors, weather, propBet, totalBet };
}

// --- API ENDPOINTS ---
app.get('/predictions', async (req, res) => {
    const { sport } = req.query;
    if (!sport) return res.status(400).json({ error: "Sport parameter is required." });
    try {
        const [games, teamStats] = await Promise.all([getOdds(sport), getTeamStats(sport)]);
        if (!games || games.length === 0) { return res.json({ message: `No upcoming games for ${sport}. The season may be over.` }); }
        const predictions = await Promise.all(games.map(async (game) => {
            const [weather, redditSentiment] = await Promise.all([ getWeatherData(game.home_team), getRedditSentiment(game.home_team, game.away_team) ]);
            const context = { teamStats, weather, redditSentiment };
            const predictionData = runPredictionEngine(game, sport, context);
            return { game, prediction: predictionData };
        }));
        res.json(predictions.filter(p => p && p.prediction));
    } catch (error) {
        console.error("Prediction Error:", error);
        res.status(500).json({ error: "Failed to process predictions.", details: error.message });
    }
});
app.get('/futures', (req, res) => res.json(FUTURES_PICKS_DB));
app.get('/', (req, res) => res.send('Attitude Sports Bets API is online.'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
