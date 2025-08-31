// FINAL UPGRADED VERSION - Better AI prompt and smarter prediction engine
require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const axios = require('axios');
const Snoowrap = require('snoowrap');
const { MongoClient } = require('mongodb');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
app.use(cors());
app.use(express.json());

app.use(express.static(path.join(__dirname, 'public')));

// --- API & DATA CONFIG ---
const ODDS_API_KEY = process.env.ODDS_API_KEY;
const DATABASE_URL = process.env.DATABASE_URL;
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const r = new Snoowrap({
    userAgent: process.env.REDDIT_USER_AGENT,
    clientId: process.env.REDDIT_CLIENT_ID,
    clientSecret: process.env.REDDIT_CLIENT_SECRET,
    username: process.env.REDDIT_USERNAME,
    password: process.env.REDDIT_PASSWORD
});

let db;
let recordsCollection;
let predictionsCollection;
async function connectToDb() {
    try {
        if (db) return db;
        const client = new MongoClient(DATABASE_URL);
        await client.connect();
        db = client.db('attitudebets');
        recordsCollection = db.collection('records');
        predictionsCollection = db.collection('predictions');
        console.log('Connected to MongoDB');
        return db;
    } catch (e) {
        console.error("Failed to connect to MongoDB", e);
        process.exit(1);
    }
}

// --- DATA MAPS ---
const SPORTS_DB = [ 
    { key: 'baseball_mlb', name: 'MLB', gameCountThreshold: 5 }, 
    { key: 'icehockey_nhl', name: 'NHL', gameCountThreshold: 5 }, 
    { key: 'americanfootball_nfl', name: 'NFL', gameCountThreshold: 4 } 
];
const teamLocationMap = {
    'Arizona Diamondbacks': { lat: 33.44, lon: -112.06 }, 'Atlanta Braves': { lat: 33.89, lon: -84.46 }, 'Baltimore Orioles': { lat: 39.28, lon: -76.62 }, 'Boston Red Sox': { lat: 42.34, lon: -71.09 }, 'Chicago Cubs': { lat: 41.94, lon: -87.65 }, 'Chicago White Sox': { lat: 41.83, lon: -87.63 }, 'Cincinnati Reds': { lat: 39.09, lon: -84.50 }, 'Cleveland Guardians': { lat: 41.49, lon: -81.68 }, 'Colorado Rockies': { lat: 39.75, lon: -104.99 }, 'Detroit Tigers': { lat: 42.33, lon: -83.05 }, 'Houston Astros': { lat: 29.75, lon: -95.35 }, 'Kansas City Royals': { lat: 39.05, lon: -94.48 }, 'Los Angeles Angels': { lat: 33.80, lon: -117.88 }, 'Los Angeles Dodgers': { lat: 34.07, lon: -118.24 }, 'Miami Marlins': { lat: 25.77, lon: -80.22 }, 'Milwaukee Brewers': { lat: 43.02, lon: -87.97 }, 'Minnesota Twins': { lat: 44.98, lon: -93.27 }, 'New York Mets': { lat: 40.75, lon: -73.84 }, 'New York Yankees': { lat: 40.82, lon: -73.92 }, 'Oakland Athletics': { lat: 37.75, lon: -122.20 }, 'Philadelphia Phillies': { lat: 39.90, lon: -75.16 }, 'Pittsburgh Pirates': { lat: 40.44, lon: -80.00 }, 'San Diego Padres': { lat: 32.70, lon: -117.15 }, 'San Francisco Giants': { lat: 37.77, lon: -122.38 }, 'Seattle Mariners': { lat: 47.59, lon: -122.33 }, 'St. Louis Cardinals': { lat: 38.62, lon: -90.19 }, 'Tampa Bay Rays': { lat: 27.76, lon: -82.65 }, 'Texas Rangers': { lat: 32.75, lon: -97.08 }, 'Toronto Blue Jays': { lat: 43.64, lon: -79.38 }, 'Washington Nationals': { lat: 38.87, lon: -77.00 },
    'Washington Commanders': { lat: 38.90, lon: -76.86 }
};
const teamAliasMap = {
    'Arizona Diamondbacks': ['D-backs', 'Diamondbacks'], 'Atlanta Braves': ['Braves'], 'Baltimore Orioles': ['Orioles'], 'Boston Red Sox': ['Red Sox'], 'Chicago Cubs': ['Cubs'], 'Chicago White Sox': ['White Sox', 'ChiSox'], 'Cincinnati Reds': ['Reds'], 'Cleveland Guardians': ['Guardians'], 'Colorado Rockies': ['Rockies'], 'Detroit Tigers': ['Tigers'], 'Houston Astros': ['Astros'], 'Kansas City Royals': ['Royals'], 'Los Angeles Angels': ['Angels'], 'Los Angeles Dodgers': ['Dodgers'], 'Miami Marlins': ['Marlins'], 'Milwaukee Brewers': ['Brewers'], 'Minnesota Twins': ['Twins'], 'New York Mets': ['Mets'], 'New York Yankees': ['Yankees'], 'Oakland Athletics': ["A's", 'Athletics', "Oakland A's"], 'Philadelphia Phillies': ['Phillies'], 'Pittsburgh Pirates': ['Pirates'], 'San Diego Padres': ['Padres', 'Friars'], 'San Francisco Giants': ['Giants'], 'Seattle Mariners': ['Mariners', "M's"], 'St. Louis Cardinals': ['Cardinals', 'Cards'], 'Tampa Bay Rays': ['Rays'], 'Texas Rangers': ['Rangers'], 'Toronto Blue Jays': ['Blue Jays', 'Jays'], 'Washington Nationals': ['Nationals'],
    'Washington Commanders': ['Commanders']
};

const canonicalTeamNameMap = {};
Object.keys(teamAliasMap).forEach(canonicalName => {
    const lowerCanonical = canonicalName.toLowerCase();
    if (!canonicalTeamNameMap[lowerCanonical]) canonicalTeamNameMap[lowerCanonical] = canonicalName;
    teamAliasMap[canonicalName].forEach(alias => {
        const lowerAlias = alias.toLowerCase();
        if (!canonicalTeamNameMap[lowerAlias]) canonicalTeamNameMap[lowerAlias] = canonicalName;
    });
});
Object.keys(teamLocationMap).forEach(canonicalName => {
    const lowerCanonical = canonicalName.toLowerCase();
    if (!canonicalTeamNameMap[lowerCanonical]) canonicalTeamNameMap[lowerCanonical] = canonicalName;
});


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

function extractStandings(node, stats) {
    if (node.standings && node.standings.entries) {
        for (const team of node.standings.entries) {
            const teamName = team.team.displayName;
            const wins = team.stats.find(s => s.name === 'wins')?.displayValue || '0';
            const losses = team.stats.find(s => s.name === 'losses')?.displayValue || '0';
            const streak = team.stats.find(s => s.name === 'streak')?.displayValue || 'N/A';
            const lastTen = team.stats.find(s => s.name === 'vsLast10')?.displayValue || '0-0';
            stats[teamName] = { record: `${wins}-${losses}`, streak, lastTen };
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
    }, 3600000);
}

async function getWeatherData(teamName) {
    const location = teamLocationMap[teamName];
    if (!location) return null;
    return fetchData(`weather_${location.lat}_${location.lon}`, async () => {
        try {
            const url = `https://api.open-meteo.com/v1/forecast?latitude=${location.lat}&longitude=${location.lon}&current=temperature_2m,precipitation,wind_speed_10m&wind_speed_unit=kmh`;
            const { data } = await axios.get(url);
            return { temp: data.current.temperature_2m, wind: data.current.wind_speed_10m, precip: data.current.precipitation };
        } catch (e) {
            console.error(`Could not fetch weather for ${teamName}: ${e.message}`);
            return null;
        }
    });
}

async function fetchEspnData(sportKey) {
    return fetchData(`espn_scoreboard_${sportKey}`, async () => {
        const map = { 'baseball_mlb': { sport: 'baseball', league: 'mlb' }, 'icehockey_nhl': { sport: 'hockey', league: 'nhl' }, 'americanfootball_nfl': { sport: 'football', league: 'nfl' } }[sportKey];
        if (!map) return null;
        try {
            const url = `https://site.api.espn.com/apis/site/v2/sports/${map.sport}/${map.league}/scoreboard`;
            const { data } = await axios.get(url);
            return data;
        } catch (error) {
            console.error(`Could not fetch ESPN scoreboard for ${sportKey}. Error:`, error.message);
            return null;
        }
    }, 60000);
}

async function getRedditSentiment(homeTeam, awayTeam, homeStats, awayStats, sportKey) {
    const key = `reddit_${homeTeam}_${awayTeam}_${sportKey}`;
    return fetchData(key, async () => {
        try {
            const createSearchQuery = (teamName) => `(${ (teamAliasMap[teamName] || [teamName.split(' ').pop()]).map(a => `"${a}"`).join(' OR ')})`;
            const baseQuery = `${createSearchQuery(homeTeam)} OR ${createSearchQuery(awayTeam)}`;
            const flair = flairMap[sportKey];
            let results = await r.getSubreddit('sportsbook').search({ query: `flair:"${flair}" ${baseQuery}`, sort: 'new', time: 'month' });
            if (results.length === 0) {
                results = await r.getSubreddit('sportsbook').search({ query: baseQuery, sort: 'new', time: 'month' });
            }
            if (results.length === 0) {
                return { home: 1 + (getWinPct(parseRecord(homeStats.record)) * 9), away: 1 + (getWinPct(parseRecord(awayStats.record)) * 9) };
            }
            let homeScore = 0, awayScore = 0;
            const homeAliases = [homeTeam, ...(teamAliasMap[homeTeam] || [])].map(a => a.toLowerCase());
            const awayAliases = [awayTeam, ...(teamAliasMap[awayTeam] || [])].map(a => a.toLowerCase());
            results.forEach(post => {
                const title = post.title.toLowerCase();
                if (homeAliases.some(alias => title.includes(alias))) homeScore++;
                if (awayAliases.some(alias => title.includes(alias))) awayScore++;
            });
            const totalScore = homeScore + awayScore;
            if (totalScore === 0) {
                 return { home: 1 + (getWinPct(parseRecord(homeStats.record)) * 9), away: 1 + (getWinPct(parseRecord(awayStats.record)) * 9) };
            }
            return { home: 1 + (homeScore / totalScore) * 9, away: 1 + (awayScore / totalScore) * 9 };
        } catch (e) {
            console.error(`Reddit API error for ${awayTeam} @ ${homeTeam}:`, e.message);
            return { home: 1 + (getWinPct(parseRecord(homeStats.record)) * 9), away: 1 + (getWinPct(parseRecord(awayStats.record)) * 9) };
        }
    }, 1800000);
}

async function runPredictionEngine(game, sportKey, context) {
    const { teamStats, weather, injuries, h2h } = context;
    const weights = getDynamicWeights(sportKey);
    const { home_team, away_team } = game;
    
    const homeCanonicalName = canonicalTeamNameMap[home_team.toLowerCase()] || home_team;
    const awayCanonicalName = canonicalTeamNameMap[away_team.toLowerCase()] || away_team;
    
    const homeStats = teamStats[homeCanonicalName] || { record: 'N/A', streak: 'N/A', lastTen: 'N/A' };
    const awayStats = teamStats[awayCanonicalName] || { record: 'N/A', streak: 'N/A', lastTen: 'N/A' };

    const redditSentiment = await getRedditSentiment(home_team, away_team, homeStats, awayStats, sportKey);
    let homeScore = 50, awayScore = 50;
    const factors = {};
    factors['Record'] = { value: (getWinPct(parseRecord(homeStats.record)) - getWinPct(parseRecord(awayStats.record))) * weights.record, homeStat: homeStats.record, awayStat: awayStats.record };
    factors['Recent Form (L10)'] = { value: (getWinPct(parseRecord(homeStats.lastTen)) - getWinPct(parseRecord(awayStats.lastTen))) * weights.momentum, homeStat: homeStats.lastTen, awayStat: awayStats.lastTen };
    factors['H2H (Season)'] = { value: (getWinPct(parseRecord(h2h.home)) - getWinPct(parseRecord(h2h.away))) * weights.h2h, homeStat: h2h.home, awayStat: h2h.away };
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
    return { winner, strengthText, confidence, factors, weather, homeValue, awayValue };
}

async function getAllDailyPredictions() {
    const allPredictions = [];
    const gameCounts = {};

    for (const sport of SPORTS_DB) {
        const sportKey = sport.key;
        const [games, espnDataResponse, teamStats] = await Promise.all([ 
            getOdds(sportKey), 
            fetchEspnData(sportKey),
            getTeamStatsFromAPI(sportKey)
        ]);

        gameCounts[sportKey] = games.length;
        if (!games || games.length === 0) continue;
        
        const injuries = {};
        const h2hRecords = {};
        if (espnDataResponse?.events) {
            for (const event of espnDataResponse.events) {
                const competition = event.competitions?.[0];
                if (!competition) continue;
                for (const competitor of competition.competitors) {
                    const canonicalName = canonicalTeamNameMap[competitor.team.displayName.toLowerCase()] || competitor.team.displayName;
                    injuries[canonicalName] = competitor.team.injuries || [];
                }
                const homeTeam = competition.competitors.find(c => c.homeAway === 'home');
                const awayTeam = competition.competitors.find(c => c.homeAway === 'away');
                if (competition.series && homeTeam && awayTeam) {
                    const gameId = `${awayTeam.team.displayName}@${homeTeam.team.displayName}`;
                    const homeWins = competition.series.competitors.find(c => c.id === homeTeam.id)?.wins || 0;
                    const awayWins = competition.series.competitors.find(c => c.id === awayTeam.id)?.wins || 0;
                    h2hRecords[gameId] = { home: `${homeWins}-${awayWins}`, away: `${awayWins}-${homeWins}` };
                }
            }
        }
        
        for (const game of games) {
            const espnEvent = espnDataResponse?.events?.find(e => {
                if (!e.name) return false;
                const homeAbbr = espnTeamAbbreviations[game.home_team];
                const awayAbbr = espnTeamAbbreviations[game.away_team];
                return homeAbbr && awayAbbr && e.name.includes(homeAbbr) && e.name.includes(awayAbbr);
            });
            const weather = await getWeatherData(game.home_team);
            const gameId = `${game.away_team}@${game.home_team}`;
            const h2h = h2hRecords[gameId] || { home: '0-0', away: '0-0' };
            const context = { teamStats, weather, injuries, h2h };
            const predictionData = await runPredictionEngine(game, sportKey, context);
            
            if (predictionData && predictionData.winner) {
                 // Also save predictions generated here to the database
                if (predictionsCollection) {
                    try {
                        const winnerOdds = game.bookmakers?.[0]?.markets?.find(m => m.key === 'h2h')?.outcomes?.find(o => o.name === predictionData.winner)?.price;
                        const predictionRecord = {
                            gameId: game.id,
                            sportKey: sportKey, // --- FIX: Use the correct variable 'sportKey' ---
                            predictedWinner: predictionData.winner,
                            homeTeam: game.home_team,
                            awayTeam: game.away_team,
                            gameDate: game.commence_time,
                            odds: winnerOdds || null,
                            status: 'pending',
                            createdAt: new Date()
                        };
                        await predictionsCollection.updateOne({ gameId: game.id }, { $set: predictionRecord }, { upsert: true });
                    } catch (dbError) {
                        console.error("Failed to save prediction from getAllDailyPredictions to DB:", dbError);
                    }
                }

                allPredictions.push({ 
                    game: { ...game, espnData: espnEvent || null, sportKey: sportKey }, 
                    prediction: predictionData 
                });
            }
        }
    }
    return { allPredictions, gameCounts };
}

app.get('/api/predictions', async (req, res) => {
    const { sport } = req.query;
    if (!sport) return res.status(400).json({ error: "Sport parameter is required." });
    try {
        const [games, espnDataResponse, teamStats] = await Promise.all([ 
            getOdds(sport), 
            fetchEspnData(sport),
            getTeamStatsFromAPI(sport)
        ]);
        if (!games || games.length === 0) { return res.json({ message: `No upcoming games for ${sport}. The season may be over.` }); }
        
        const injuries = {};
        const h2hRecords = {};
        if (espnDataResponse?.events) {
             for (const event of espnDataResponse.events) {
                const competition = event.competitions?.[0];
                if (!competition) continue;
                for (const competitor of competition.competitors) {
                    const canonicalName = canonicalTeamNameMap[competitor.team.displayName.toLowerCase()] || competitor.team.displayName;
                    injuries[canonicalName] = competitor.team.injuries || [];
                }
                const homeTeam = competition.competitors.find(c => c.homeAway === 'home');
                const awayTeam = competition.competitors.find(c => c.homeAway === 'away');
                if (competition.series && homeTeam && awayTeam) {
                    const gameId = `${awayTeam.team.displayName}@${homeTeam.team.displayName}`;
                    const homeWins = competition.series.competitors.find(c => c.id === homeTeam.id)?.wins || 0;
                    const awayWins = competition.series.competitors.find(c => c.id === awayTeam.id)?.wins || 0;
                    h2hRecords[gameId] = { home: `${homeWins}-${awayWins}`, away: `${awayWins}-${homeWins}` };
                }
            }
        }
        
        const predictions = [];
        for (const game of games) {
            const weather = await getWeatherData(game.home_team);
            const gameId = `${game.away_team}@${game.home_team}`;
            const h2h = h2hRecords[gameId] || { home: '0-0', away: '0-0' };
            const context = { teamStats, weather, injuries, h2h };
            const predictionData = await runPredictionEngine(game, sport, context);

            if (predictionData && predictionData.winner && predictionsCollection) {
                try {
                    const winnerOdds = game.bookmakers?.[0]?.markets?.find(m => m.key === 'h2h')?.outcomes?.find(o => o.name === predictionData.winner)?.price;
                    const predictionRecord = {
                        gameId: game.id, sportKey: sport, predictedWinner: predictionData.winner,
                        homeTeam: game.home_team, awayTeam: game.away_team, gameDate: game.commence_time,
                        odds: winnerOdds || null, status: 'pending', createdAt: new Date()
                    };
                    await predictionsCollection.updateOne({ gameId: game.id }, { $set: predictionRecord }, { upsert: true });
                } catch (dbError) {
                    console.error("Failed to save prediction to DB:", dbError);
                }
            }

            // --- FIX: Upgraded ESPN event matching logic for better accuracy ---
            const gameHomeCanonical = canonicalTeamNameMap[game.home_team.toLowerCase()] || game.home_team;
            const gameAwayCanonical = canonicalTeamNameMap[game.away_team.toLowerCase()] || game.away_team;

            const espnEvent = espnDataResponse?.events?.find(e => {
                const competitors = e.competitions?.[0]?.competitors;
                if (!competitors || competitors.length < 2) return false;
                
                const eventHomeCanonical = canonicalTeamNameMap[competitors.find(c=>c.homeAway === 'home').team.displayName.toLowerCase()];
                const eventAwayCanonical = canonicalTeamNameMap[competitors.find(c=>c.homeAway === 'away').team.displayName.toLowerCase()];

                return (eventHomeCanonical === gameHomeCanonical && eventAwayCanonical === gameAwayCanonical);
            });
            // --- End of fix ---

            predictions.push({ game: { ...game, espnData: espnEvent || null }, prediction: predictionData });
        }
        res.json(predictions.filter(p => p && p.prediction));
    } catch (error) {
        console.error("Prediction Error:", error);
        res.status(500).json({ error: "Failed to process predictions.", details: error.message });
    }
});
        
        const predictions = [];
        for (const game of games) {
            const weather = await getWeatherData(game.home_team);
            const gameId = `${game.away_team}@${game.home_team}`;
            const h2h = h2hRecords[gameId] || { home: '0-0', away: '0-0' };
            const context = { teamStats, weather, injuries, h2h };
            const predictionData = await runPredictionEngine(game, sport, context);

            if (predictionData && predictionData.winner && predictionsCollection) {
                try {
                    const winnerOdds = game.bookmakers?.[0]?.markets?.find(m => m.key === 'h2h')?.outcomes?.find(o => o.name === predictionData.winner)?.price;
                    const predictionRecord = {
                        gameId: game.id, sportKey: sport, predictedWinner: predictionData.winner,
                        homeTeam: game.home_team, awayTeam: game.away_team, gameDate: game.commence_time,
                        odds: winnerOdds || null, status: 'pending', createdAt: new Date()
                    };
                    await predictionsCollection.updateOne({ gameId: game.id }, { $set: predictionRecord }, { upsert: true });
                } catch (dbError) {
                    console.error("Failed to save prediction to DB:", dbError);
                }
            }

            const espnEvent = espnDataResponse?.events?.find(e => e.name && e.name.includes(espnTeamAbbreviations[game.home_team]) && e.name.includes(espnTeamAbbreviations[game.away_team]));
            predictions.push({ game: { ...game, espnData: espnEvent || null }, prediction: predictionData });
        }
        res.json(predictions.filter(p => p && p.prediction));
    } catch (error) {
        console.error("Prediction Error:", error);
        res.status(500).json({ error: "Failed to process predictions.", details: error.message });
    }
});

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


app.get('/api/records', async (req, res) => {
    try {
        if (!recordsCollection) { await connectToDb(); }
        const records = await recordsCollection.find({}).toArray();
        const recordsObj = records.reduce((obj, item) => {
            obj[item.sport] = { wins: item.wins, losses: item.losses, totalProfit: item.totalProfit };
            return obj;
        }, {});
        res.json(recordsObj);
    } catch (e) {
        console.error("Failed to fetch records:", e);
        res.status(500).json({ error: "Could not retrieve records from database." });
    }
});

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
        const parlayConfidenceThreshold = isPeakSeason ? 7.5 : 5;
        
        // --- NEW: Filter for UPCOMING games scheduled for TODAY only ---
        const todayString = new Date().toDateString();
        const upcomingTodayPredictions = allPredictions.filter(p => {
            const gameDate = new Date(p.game.commence_time);
            return gameDate.toDateString() === todayString && gameDate > new Date();
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

app.post('/api/parlay-ai-analysis', async (req, res) => {
    try {
        if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not set.");
        const { parlay } = req.body;
        const leg1 = parlay.legs[0];
        const leg2 = parlay.legs[1];

        const prompt = `
            Act as a professional sports betting analyst. Create a sophisticated HTML analysis for the following 2-leg parlay.
            Use Tailwind CSS classes for styling. Use only the following tags: <div>, <h4>, <p>, <ul>, <li>, and <strong>.

            Parlay Details:
            - Leg 1: Pick ${leg1.prediction.winner} in the ${leg1.game.away_team} @ ${leg1.game.home_team} game.
            - Leg 2: Pick ${leg2.prediction.winner} in the ${leg2.game.away_team} @ ${leg2.game.home_team} game.
            - Total Odds: ${parlay.totalOdds}

            Generate the following HTML structure:
            1. A <h4> with class "text-xl font-bold text-cyan-400 mb-2" titled "Parlay Rationale". Follow it with a <p> with class="text-gray-300 mb-4" that explains what a parlay is (higher risk for a higher reward) and the overall strategy for this specific combination.
            2. An <hr> with class="border-gray-700 my-4".
            3. A <h4> with class "text-xl font-bold text-teal-400 mb-2" titled "Leg 1 Breakdown: ${leg1.prediction.winner}". Follow it with a <p> briefly justifying this pick.
            4. A <h4> with class "text-xl font-bold text-teal-400 mb-2 mt-3" titled "Leg 2 Breakdown: ${leg2.prediction.winner}". Follow it with a <p> briefly justifying this second pick.
            5. An <hr> with class="border-gray-700 my-4".
            6. A <h4> with class "text-xl font-bold text-red-400 mb-2" titled "Associated Risks". Follow it with a <p> explaining the primary risks. Mention that both bets must win, and discuss the single biggest risk for each leg that could cause the parlay to fail.
            7. An <hr> with class="border-gray-700 my-4".
            8. A <h4> with class "text-xl font-bold text-yellow-400 mb-2" titled "Final Verdict". Follow it with a confident <p> with class="text-gray-200" that summarizes the recommendation, weighing the potential payout against the risk.
        `;
        
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" });
        const result = await model.generateContent(prompt);
        const response = await result.response;
        let analysisHtml = response.text().replace(/```html/g, '').replace(/```/g, '');
        res.json({ analysisHtml });

    } catch (error) {
        console.error("Parlay AI Analysis Error:", error);
        res.status(500).json({ error: "Failed to generate Parlay AI analysis." });
    }
});


// This must be the last GET route to serve the frontend
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
connectToDb().then(() => {
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
});
