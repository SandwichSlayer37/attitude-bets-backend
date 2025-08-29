// FINAL VERSION v4 - Robust Stats Parsing
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const Snoowrap = require('snoowrap');
const { MongoClient } = require('mongodb');

const app = express();
app.use(cors({ origin: 'https://attitude-sports-bets.web.app' }));
app.use(express.json());

// --- API & DATA CONFIG ---
const ODDS_API_KEY = process.env.ODDS_API_KEY;
const DATABASE_URL = process.env.DATABASE_URL;

const r = new Snoowrap({
    userAgent: process.env.REDDIT_USER_AGENT,
    clientId: process.env.REDDIT_CLIENT_ID,
    clientSecret: process.env.REDDIT_CLIENT_SECRET,
    username: process.env.REDDIT_USERNAME,
    password: process.env.REDDIT_PASSWORD
});

let db;
let recordsCollection;
async function connectToDb() {
    try {
        if (db) return db;
        const client = new MongoClient(DATABASE_URL);
        await client.connect();
        db = client.db('attitudebets');
        recordsCollection = db.collection('records');
        console.log('Connected to MongoDB');
        return db;
    } catch (e) {
        console.error("Failed to connect to MongoDB", e);
        process.exit(1);
    }
}

const teamLocationMap = {
    'Arizona Diamondbacks': { lat: 33.44, lon: -112.06 }, 'Atlanta Braves': { lat: 33.89, lon: -84.46 }, 'Baltimore Orioles': { lat: 39.28, lon: -76.62 }, 'Boston Red Sox': { lat: 42.34, lon: -71.09 }, 'Chicago Cubs': { lat: 41.94, lon: -87.65 }, 'Chicago White Sox': { lat: 41.83, lon: -87.63 }, 'Cincinnati Reds': { lat: 39.09, lon: -84.50 }, 'Cleveland Guardians': { lat: 41.49, lon: -81.68 }, 'Colorado Rockies': { lat: 39.75, lon: -104.99 }, 'Detroit Tigers': { lat: 42.33, lon: -83.05 }, 'Houston Astros': { lat: 29.75, lon: -95.35 }, 'Kansas City Royals': { lat: 39.05, lon: -94.48 }, 'Los Angeles Angels': { lat: 33.80, lon: -117.88 }, 'Los Angeles Dodgers': { lat: 34.07, lon: -118.24 }, 'Miami Marlins': { lat: 25.77, lon: -80.22 }, 'Milwaukee Brewers': { lat: 43.02, lon: -87.97 }, 'Minnesota Twins': { lat: 44.98, lon: -93.27 }, 'New York Mets': { lat: 40.75, lon: -73.84 }, 'New York Yankees': { lat: 40.82, lon: -73.92 }, 'Oakland Athletics': { lat: 37.75, lon: -122.20 }, 'Philadelphia Phillies': { lat: 39.90, lon: -75.16 }, 'Pittsburgh Pirates': { lat: 40.44, lon: -80.00 }, 'San Diego Padres': { lat: 32.70, lon: -117.15 }, 'San Francisco Giants': { lat: 37.77, lon: -122.38 }, 'Seattle Mariners': { lat: 47.59, lon: -122.33 }, 'St. Louis Cardinals': { lat: 38.62, lon: -90.19 }, 'Tampa Bay Rays': { lat: 27.76, lon: -82.65 }, 'Texas Rangers': { lat: 32.75, lon: -97.08 }, 'Toronto Blue Jays': { lat: 43.64, lon: -79.38 }, 'Washington Nationals': { lat: 38.87, lon: -77.00 },
    'Washington Commanders': { lat: 38.90, lon: -76.86 }
};
const teamAliasMap = {
    'Arizona Diamondbacks': ['D-backs', 'Diamondbacks'], 'Atlanta Braves': ['Braves'], 'Baltimore Orioles': ['Orioles'], 'Boston Red Sox': ['Red Sox'], 'Chicago Cubs': ['Cubs'], 'Chicago White Sox': ['White Sox', 'ChiSox'], 'Cincinnati Reds': ['Reds'], 'Cleveland Guardians': ['Guardians'], 'Colorado Rockies': ['Rockies'], 'Detroit Tigers': ['Tigers'], 'Houston Astros': ['Astros'], 'Kansas City Royals': ['Royals'], 'Los Angeles Angels': ['Angels'], 'Los Angeles Dodgers': ['Dodgers'], 'Miami Marlins': ['Marlins'], 'Milwaukee Brewers': ['Brewers'], 'Minnesota Twins': ['Twins'], 'New York Mets': ['Mets'], 'New York Yankees': ['Yankees'], 'Oakland Athletics': ["A's", 'Athletics'], 'Philadelphia Phillies': ['Phillies'], 'Pittsburgh Pirates': ['Pirates'], 'San Diego Padres': ['Padres', 'Friars'], 'San Francisco Giants': ['Giants'], 'Seattle Mariners': ['Mariners', "M's"], 'St. Louis Cardinals': ['Cardinals', 'Cards'], 'Tampa Bay Rays': ['Rays'], 'Texas Rangers': ['Rangers'], 'Toronto Blue Jays': ['Blue Jays', 'Jays'], 'Washington Nationals': ['Nationals'],
    'Washington Commanders': ['Commanders']
};
const flairMap = {
    'baseball_mlb': 'MLB Bets and Picks',
    'icehockey_nhl': 'NHL Bets and Picks',
    'americanfootball_nfl': 'NFL Bets and Picks'
};
const espnTeamAbbreviations = {
    'Arizona Diamondbacks': 'ARI', 'Atlanta Braves': 'ATL', 'Baltimore Orioles': 'BAL', 'Boston Red Sox': 'BOS', 'Chicago Cubs': 'CHC', 'Chicago White Sox': 'CHW', 'Cincinnati Reds': 'CIN', 'Cleveland Guardians': 'CLE', 'Colorado Rockies': 'COL', 'Detroit Tigers': 'DET', 'Houston Astros': 'HOU', 'Kansas City Royals': 'KC', 'Los Angeles Angels': 'LAA', 'Los Angeles Dodgers': 'LAD', 'Miami Marlins': 'MIA', 'Milwaukee Brewers': 'MIL', 'Minnesota Twins': 'MIN', 'New York Mets': 'NYM', 'New York Yankees': 'NYY', 'Oakland Athletics': 'OAK', 'Philadelphia Phillies': 'PHI', 'Pittsburgh Pirates': 'PIT', 'San Diego Padres': 'SD', 'San Francisco Giants': 'SF', 'Seattle Mariners': 'SEA', 'St. Louis Cardinals': 'STL', 'Tampa Bay Rays': 'TB', 'Texas Rangers': 'TEX', 'Toronto Blue Jays': 'TOR', 'Washington Nationals': 'WSH',
    'Washington Commanders': 'WSH'
};
const FUTURES_PICKS_DB = {
    'baseball_mlb': { championship: 'Los Angeles Dodgers', hotPick: 'Houston Astros' },
    'icehockey_nhl': { championship: 'Colorado Avalanche', hotPick: 'New York Rangers' },
    'americanfootball_nfl': { championship: 'Kansas City Chiefs', hotPick: 'Detroit Lions' }
};
const dataCache = new Map();

// --- HELPER FUNCTIONS ---
const parseRecord = (rec) => {
    if (!rec || typeof rec !== 'string') return { w: 0, l: 0 };
    const parts = rec.split('-');
    if (parts.length < 2) return { w: 0, l: 0 };
    const wins = parseInt(parts[0], 10);
    const losses = parseInt(parts[1], 10);
    if (isNaN(wins) || isNaN(losses)) return { w: 0, l: 0 };
    return { w: wins, l: losses };
};
const getWinPct = (rec) => (rec.w + rec.l) > 0 ? rec.w / (rec.w + rec.l) : 0;

// --- DYNAMIC WEIGHTS ---
function getDynamicWeights(sportKey) {
    if (sportKey === 'baseball_mlb') return { record: 6, fatigue: 8, momentum: 3, matchup: 12, value: 5, newsSentiment: 10, injuryImpact: 12, offensiveForm: 8, defensiveForm: 8, h2h: 12, weather: 8 };
    // Other sports...
    return { record: 8, fatigue: 7, momentum: 5, matchup: 10, value: 5, newsSentiment: 10, injuryImpact: 12, offensiveForm: 9, defensiveForm: 9, h2h: 11, weather: 5 };
}

// --- DATA FETCHING MODULES ---
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
            const { data } = await axios.get(`https://api.the-odds-api.com/v4/sports/${sportKey}/odds/?regions=us&markets=h2h&oddsFormat=decimal&apiKey=${ODDS_API_KEY}`);
            return data;
        } catch (error) {
            console.error("ERROR IN getOdds function:", error.message);
            return [];
        }
    }, 900000);
}

// --- REWRITTEN AND ROBUST FUNCTION FOR STATS ---
function extractStandings(node, stats) {
    if (node.standings && node.standings.entries) {
        for (const team of node.standings.entries) {
            const teamName = team.team.displayName;
            // Find wins, losses, and streak more reliably
            const wins = team.stats.find(s => s.name === 'wins')?.displayValue || '0';
            const losses = team.stats.find(s => s.name === 'losses')?.displayValue || '0';
            const streak = team.stats.find(s => s.name === 'streak')?.displayValue || 'N/A';
            stats[teamName] = { record: `${wins}-${losses}`, streak };
        }
    }
    if (node.children) {
        for (const child of node.children) {
            extractStandings(child, stats);
        }
    }
}

async function getTeamStatsFromAPI(sportKey) {
    return fetchData(`stats_api_${sportKey}`, async () => {
        const sportLeagueMap = {
            'baseball_mlb': { sport: 'baseball', league: 'mlb' },
            'icehockey_nhl': { sport: 'hockey', league: 'nhl' },
            'americanfootball_nfl': { sport: 'football', league: 'nfl' }
        };
        const map = sportLeagueMap[sportKey];
        if (!map) return {};

        try {
            const url = `http://site.api.espn.com/apis/v2/sports/${map.sport}/${map.league}/standings`;
            const { data } = await axios.get(url);
            const stats = {};
            if (data.children) {
                for (const child of data.children) {
                    extractStandings(child, stats);
                }
            }
            return stats;
        } catch (e) {
            console.error(`Could not fetch stats from API for ${sportKey}: ${e.message}`);
            return {};
        }
    }, 3600000); // Cache for 1 hour
}

// --- Other data fetching functions ---
async function getWeatherData(teamName) { /* (no change) */ }
async function fetchEspnData(sportKey) { /* (no change) */ }
async function getRedditSentiment(homeTeam, awayTeam, homeStats, awayStats, sportKey) { /* (no change) */ }

// --- Main Prediction Logic ---
async function runPredictionEngine(game, sportKey, context) {
    const { teamStats, weather, injuries } = context;
    const weights = getDynamicWeights(sportKey);
    const { home_team, away_team } = game;

    const homeStats = teamStats[home_team] || { record: 'N/A', streak: 'N/A' };
    const awayStats = teamStats[away_team] || { record: 'N/A', streak: 'N/A' };
    
    const redditSentiment = await getRedditSentiment(home_team, away_team, homeStats, awayStats, sportKey);

    let homeScore = 50, awayScore = 50;
    const factors = {};
    
    factors['Record'] = { value: (getWinPct(parseRecord(homeStats.record)) - getWinPct(parseRecord(awayStats.record))) * weights.record, homeStat: homeStats.record, awayStat: awayStats.record };
    const parseStreak = (s) => (s && s.substring(1) && !isNaN(s.substring(1)) ? (s.startsWith('W') ? parseInt(s.substring(1)) : -parseInt(s.substring(1))) : 0);
    factors['Streak'] = { value: (parseStreak(homeStats.streak) - parseStreak(awayStats.streak)) * (weights.momentum / 5), homeStat: homeStats.streak, awayStat: awayStats.streak };
    factors['Social Sentiment'] = { value: (redditSentiment.home - redditSentiment.away) * weights.newsSentiment, homeStat: `${redditSentiment.home.toFixed(1)}/10`, awayStat: `${redditSentiment.away.toFixed(1)}/10` };
    
    const homeInjuries = injuries[home_team]?.length || 0;
    const awayInjuries = injuries[away_team]?.length || 0;
    const injuryValue = (awayInjuries - homeInjuries) * (weights.injuryImpact / 5);
    factors['Injury Impact'] = { value: injuryValue, homeStat: `${homeInjuries} players`, awayStat: `${awayInjuries} players` };

    for (const factor in factors) { 
        if (factors[factor].value && !isNaN(factors[factor].value)) {
            homeScore += factors[factor].value; 
            awayScore -= factors[factor].value;
        }
    }
    
    const homeOdds = game.bookmakers?.[0]?.markets?.find(m => m.key === 'h2h')?.outcomes?.find(o => o.name === home_team)?.price;
    const awayOdds = game.bookmakers?.[0]?.markets?.find(m => m.key === 'h2h')?.outcomes?.find(o => o.name === away_team)?.price;
    
    let homeValue = 'N/A', awayValue = 'N/A';
    
    if (homeOdds && awayOdds) {
        const homeImpliedProb = (1 / homeOdds) * 100;
        const homePower = (homeScore / (homeScore + awayScore)) * 100;
        homeValue = homePower - homeImpliedProb;
        awayValue = ((100-homePower) - (1/awayOdds) * 100);
        factors['Betting Value'] = { value: homeValue * (weights.value / 5), homeStat: `${homeValue.toFixed(1)}%`, awayStat: `${awayValue.toFixed(1)}%` };
        if (!isNaN(factors['Betting Value'].value)) {
            homeScore += factors['Betting Value'].value;
        }
    } else {
         factors['Betting Value'] = { value: 0, homeStat: `N/A`, awayStat: `N/A` };
    }
    
    const winner = homeScore > awayScore ? home_team : away_team;
    const confidence = Math.abs(50 - (homeScore / (homeScore + awayScore)) * 100);
    let strengthText = confidence > 15 ? "Strong Advantage" : confidence > 7.5 ? "Good Chance" : "Slight Edge";
    
    return { winner, strengthText, factors, weather, homeValue, awayValue };
}

// --- API ENDPOINTS ---
app.get('/predictions', async (req, res) => {
    const { sport } = req.query;
    if (!sport) return res.status(400).json({ error: "Sport parameter is required." });
    try {
        const [games, espnDataResponse, teamStats] = await Promise.all([ 
            getOdds(sport), 
            fetchEspnData(sport),
            getTeamStatsFromAPI(sport) // Using the new reliable function
        ]);
        if (!games || games.length === 0) { return res.json({ message: `No upcoming games for ${sport}. The season may be over.` }); }
        
        const injuries = {};
        if (espnDataResponse?.events) {
            for (const event of espnDataResponse.events) {
                for (const competitor of event.competitions[0].competitors) {
                    injuries[competitor.team.displayName] = competitor.team.injuries || [];
                }
            }
        }
        
        const predictions = [];
        for (const game of games) {
            const weather = await getWeatherData(game.home_team);
            const context = { teamStats, weather, injuries };
            const predictionData = await runPredictionEngine(game, sport, context);
            
            const espnEvent = espnDataResponse?.events?.find(e => 
                e.name.includes(espnTeamAbbreviations[game.home_team]) && e.name.includes(espnTeamAbbreviations[game.away_team])
            );

            predictions.push({ game: { ...game, espnData: espnEvent || null }, prediction: predictionData });
        }

        res.json(predictions.filter(p => p && p.prediction));
    } catch (error) {
        console.error("Prediction Error:", error);
        res.status(500).json({ error: "Failed to process predictions.", details: error.message });
    }
});

app.get('/special-picks', async (req, res) => { /* (no change) */ });
app.get('/records', async (req, res) => { /* (no change) */ });
app.get('/futures', (req, res) => res.json(FUTURES_PICKS_DB));
app.get('/', (req, res) => res.send('Attitude Sports Bets API is online.'));

const PORT = process.env.PORT || 3000;
connectToDb().then(() => {
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
});
