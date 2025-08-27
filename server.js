require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');
const Snoowrap = require('snoowrap');

// Initialize the Express app
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

// --- FIX #1: EXPANDED TEAM LOCATION MAP FOR WEATHER ---
const teamLocationMap = {
    // MLB
    'Arizona Diamondbacks': { lat: 33.44, lon: -112.06 }, 'Atlanta Braves': { lat: 33.89, lon: -84.46 },
    'Baltimore Orioles': { lat: 39.28, lon: -76.62 }, 'Boston Red Sox': { lat: 42.34, lon: -71.09 },
    'Chicago Cubs': { lat: 41.94, lon: -87.65 }, 'Chicago White Sox': { lat: 41.83, lon: -87.63 },
    'Cincinnati Reds': { lat: 39.09, lon: -84.50 }, 'Cleveland Guardians': { lat: 41.49, lon: -81.68 },
    'Colorado Rockies': { lat: 39.75, lon: -104.99 }, 'Detroit Tigers': { lat: 42.33, lon: -83.05 },
    'Houston Astros': { lat: 29.75, lon: -95.35 }, 'Kansas City Royals': { lat: 39.05, lon: -94.48 },
    'Los Angeles Angels': { lat: 33.80, lon: -117.88 }, 'Los Angeles Dodgers': { lat: 34.07, lon: -118.24 },
    'Miami Marlins': { lat: 25.77, lon: -80.22 }, 'Milwaukee Brewers': { lat: 43.02, lon: -87.97 },
    'Minnesota Twins': { lat: 44.98, lon: -93.27 }, 'New York Mets': { lat: 40.75, lon: -73.84 },
    'New York Yankees': { lat: 40.82, lon: -73.92 }, 'Oakland Athletics': { lat: 37.75, lon: -122.20 },
    'Philadelphia Phillies': { lat: 39.90, lon: -75.16 }, 'Pittsburgh Pirates': { lat: 40.44, lon: -80.00 },
    'San Diego Padres': { lat: 32.70, lon: -117.15 }, 'San Francisco Giants': { lat: 37.77, lon: -122.38 },
    'Seattle Mariners': { lat: 47.59, lon: -122.33 }, 'St. Louis Cardinals': { lat: 38.62, lon: -90.19 },
    'Tampa Bay Rays': { lat: 27.76, lon: -82.65 }, 'Texas Rangers': { lat: 32.75, lon: -97.08 },
    'Toronto Blue Jays': { lat: 43.64, lon: -79.38 }, 'Washington Nationals': { lat: 38.87, lon: -77.00 },
    // NHL
    'Vancouver Canucks': { lat: 49.27, lon: -123.12 }, 'Edmonton Oilers': { lat: 53.54, lon: -113.49 },
    // NFL
    'Kansas City Chiefs': { lat: 39.04, lon: -94.48 }, 'Buffalo Bills': { lat: 42.77, lon: -78.78 },
};

// --- FIX #2: ALIAS MAP FOR BETTER REDDIT SEARCHES ---
const teamAliasMap = {
    'Arizona Diamondbacks': ['D-backs', 'Diamondbacks'], 'Atlanta Braves': ['Braves'], 'Baltimore Orioles': ['Orioles'],
    'Boston Red Sox': ['Red Sox'], 'Chicago Cubs': ['Cubs'], 'Chicago White Sox': ['White Sox', 'ChiSox'], 'Cincinnati Reds': ['Reds'],
    'Cleveland Guardians': ['Guardians'], 'Colorado Rockies': ['Rockies'], 'Detroit Tigers': ['Tigers'], 'Houston Astros': ['Astros'],
    'Kansas City Royals': ['Royals'], 'Los Angeles Angels': ['Angels'], 'Los Angeles Dodgers': ['Dodgers'], 'Miami Marlins': ['Marlins'],
    'Milwaukee Brewers': ['Brewers'], 'Minnesota Twins': ['Twins'], 'New York Mets': ['Mets'], 'New York Yankees': ['Yankees'],
    'Oakland Athletics': ["A's", 'Athletics'], 'Philadelphia Phillies': ['Phillies'], 'Pittsburgh Pirates': ['Pirates'],
    'San Diego Padres': ['Padres'], 'San Francisco Giants': ['Giants'], 'Seattle Mariners': ['Mariners'],
    'St. Louis Cardinals': ['Cardinals'], 'Tampa Bay Rays': ['Rays'], 'Texas Rangers': ['Rangers'],
    'Toronto Blue Jays': ['Blue Jays', 'Jays'], 'Washington Nationals': ['Nationals']
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
async function fetchData(key, fetcherFn, ttl = 3600000) {
    if (dataCache.has(key) && (Date.now() - dataCache.get(key).timestamp < ttl)) {
        return dataCache.get(key).data;
    }
    const data = await fetcherFn();
    dataCache.set(key, { data, timestamp: Date.now() });
    return data;
}

async function getOdds(sportKey) {
    return fetchData(`odds_${sportKey}`, async () => {
        try {
            const { data } = await axios.get(`https://api.the-odds-api.com/v4/sports/${sportKey}/odds/?regions=us&markets=h2h,spreads,totals&oddsFormat=decimal&apiKey=${ODDS_API_KEY}`);
            return data;
        } catch (error) {
            console.error("ERROR IN getOdds function:", error.message);
            return [];
        }
    }, 900000);
}

async function getTeamStats(sportKey) {
    return fetchData(`stats_${sportKey}`, async () => {
        const stats = {};
        const currentYear = new Date().getFullYear();
        if (sportKey === 'baseball_mlb') {
            try {
                const { data } = await axios.get(`https://www.baseball-reference.com/leagues/majors/${currentYear}-standdings.shtml`);
                const $ = cheerio.load(data);
                $('#teams_standings_overall tbody tr').each((i, el) => {
                    const row = $(el);
                    if (row.find('th[data-stat="team_ID"] a').length > 0) {
                        const teamName = row.find('th[data-stat="team_ID"] a').text();
                        if (teamName) {
                            stats[teamName] = {
                                record: `${row.find('td[data-stat="W"]').text()}-${row.find('td[data-stat="L"]').text()}`,
                                streak: row.find('td[data-stat="streak"]').text() || 'N/A'
                            };
                        }
                    }
                });
            } catch (e) { console.error("Could not scrape MLB stats."); }
        }
        return stats;
    });
}

async function getWeatherData(teamName) {
    const location = teamLocationMap[teamName];
    if (!location) return null;
    const { lat, lon } = location;
    return fetchData(`weather_${lat}_${lon}`, async () => {
        try {
            const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,precipitation,wind_speed_10m&wind_speed_unit=kmh`;
            const { data } = await axios.get(url);
            return { temp: data.current.temperature_2m, wind: data.current.wind_speed_10m, precip: data.current.precipitation };
        } catch (e) {
            console.error(`Could not fetch weather for ${teamName}: ${e.message}`);
            return null;
        }
    });
}

// --- UPDATED getRedditSentiment function ---
async function getRedditSentiment(homeTeam, awayTeam) {
    const key = `reddit_${homeTeam}_${awayTeam}`;
    return fetchData(key, async () => {
        try {
            const createSearchQuery = (teamName) => {
                const aliases = teamAliasMap[teamName] || [teamName.split(' ').pop()];
                const quotedAliases = aliases.map(alias => `"${alias}"`);
                return `"${teamName}" OR ${quotedAliases.join(' OR ')}`;
            };

            const homeSearchQuery = createSearchQuery(homeTeam);
            const awaySearchQuery = createSearchQuery(awayTeam);

            const [homeResults, awayResults] = await Promise.all([
                r.getSubreddit('sportsbook').search({ query: homeSearchQuery, sort: 'new', time: 'week' }),
                r.getSubreddit('sportsbook').search({ query: awaySearchQuery, sort: 'new', time: 'week' })
            ]);

            const homeScore = homeResults.length;
            const awayScore = awayResults.length;
            const totalScore = homeScore + awayScore;

            if (totalScore === 0) {
                return { home: 5.0, away: 5.0 };
            }

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
    const confidence = Math.abs(50 - (homeScore / (homeScore + awayScore)) * 100);
    if (confidence > 7.5) { const spreadMarket = game.bookmakers?.[0]?.markets?.find(m => m.key === 'spreads'); const winnerSpread = spreadMarket?.outcomes.find(o => o.name === winner); if (winnerSpread) { propBet = { team: winner, line: winnerSpread.point, price: winnerSpread.price, type: sportKey === 'baseball_mlb' ? 'Run Line' : sportKey === 'icehockey_nhl' ? 'Puck Line' : 'Spread' }; } }
    let rawPower = homeScore + awayScore;
    if (weather && sportKey !== 'icehockey_nhl') { const weatherImpact = (50 - weather.wind) * 0.1 + (50 - Math.abs(21 - weather.temp)) * 0.05; rawPower += (weatherImpact - 50) * (weights.weather / 10); factors['Weather'] = { value: (weatherImpact - 50) * (weights.weather / 10), homeStat: `${weather.temp}°C`, awayStat: `${weather.wind.toFixed(1)} km/h` }; }
    const totalsMarket = game.bookmakers?.[0]?.markets?.find(m => m.key === 'totals');
    if (totalsMarket) { let prediction = null; if (rawPower > 105) prediction = 'Over'; if (rawPower < 95) prediction = 'Under'; if (prediction) { const outcome = totalsMarket.outcomes.find(o => o.name === prediction); if (outcome) totalBet = { prediction, line: outcome.point, price: outcome.price }; } }
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
