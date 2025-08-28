// FINAL VERSION - Includes diagnostic logging
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');
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

// --- DATABASES & MAPS ---
const teamLocationMap = { /* ... (no changes) ... */ };
const teamAliasMap = { /* ... (no changes) ... */ };
const flairMap = { /* ... (no changes) ... */ };
const FUTURES_PICKS_DB = { /* ... (no changes) ... */ };
const fallbackTeamStats = { /* ... (no changes) ... */ };
const dataCache = new Map();

// --- DATABASE CONNECTION ---
let db;
let recordsCollection;
async function connectToDb() { /* ... (no changes) ... */ }

// --- HELPER FUNCTIONS ---
const parseRecord = (rec) => { /* ... (no changes) ... */ };
const getWinPct = (rec) => { /* ... (no changes) ... */ };

// --- DYNAMIC WEIGHTS ---
function getDynamicWeights(sportKey) { /* ... (no changes) ... */ }

// --- DATA FETCHING & SCRAPING ---
async function fetchData(key, fetcherFn, ttl = 3600000) { /* ... (no changes) ... */ }
async function getOdds(sportKey) { /* ... (no changes) ... */ }
async function getTeamStats(sportKey) { /* ... (no changes) ... */ }
async function getWeatherData(teamName) { /* ... (no changes) ... */ }
async function fetchEspnData(sportKey) { /* ... (no changes) ... */ }
async function getBulkRedditSentiment(allGames) { /* ... (no changes) ... */ }
async function runPredictionEngine(game, sportKey, context) { /* ... (no changes) ... */ }

// --- API ENDPOINTS ---
app.get('/predictions', async (req, res) => {
    console.log(`--> GET /predictions for sport: ${req.query.sport}`); // DIAGNOSTIC LOG
    const { sport } = req.query;
    if (!sport) return res.status(400).json({ error: "Sport parameter is required." });
    try {
        const [games, teamStats, espnDataResponse] = await Promise.all([ getOdds(sport), getTeamStats(sport), fetchEspnData(sport) ]);
        if (!games || games.length === 0) { return res.json({ message: `No upcoming games for ${sport}. The season may be over.` }); }
        const bulkSentiment = await getBulkRedditSentiment(games);
        const espnGamesMap = new Map();
        if (espnDataResponse?.events) {
            espnDataResponse.events.forEach(event => { const competition = event.competitions?.[0]; if (!competition) return; const home = competition.competitors.find(t => t.homeAway === 'home')?.team; const away = competition.competitors.find(c => c.homeAway === 'away')?.team; if (home && away) { espnGamesMap.set(`${away.name} @ ${home.name}`, event); } });
        }
        const predictions = await Promise.all(games.map(async (game) => {
            const espnData = espnGamesMap.get(`${game.away_team.split(' ').pop()} @ ${game.home_team.split(' ').pop()}`) || null;
            const weather = await getWeatherData(game.home_team);
            const context = { teamStats, weather, bulkSentiment };
            const predictionData = await runPredictionEngine(game, sport, context);
            return { game: { ...game, espnData }, prediction: predictionData };
        }));
        res.json(predictions.filter(p => p && p.prediction));
    } catch (error) {
        console.error("Prediction Error:", error);
        res.status(500).json({ error: "Failed to process predictions.", details: error.message });
    }
});

app.get('/special-picks', async (req, res) => {
    console.log("--> GET /special-picks hit!"); // DIAGNOSTIC LOG
    try {
        const sports = ['baseball_mlb', 'americanfootball_nfl', 'icehockey_nhl'];
        let allGames = [];
        let teamStatsBySport = {};
        for (const sport of sports) {
            const games = await getOdds(sport);
            if (games?.length > 0) {
                allGames.push(...games.map(g => ({ ...g, sportKey: sport })));
                teamStatsBySport[sport] = await getTeamStats(sport);
            }
        }
        const bulkSentiment = await getBulkRedditSentiment(allGames);
        let allUpcomingGames = [];
        for (const game of allGames) {
            const context = { teamStats: teamStatsBySport[game.sportKey], bulkSentiment };
            const prediction = await runPredictionEngine(game, game.sportKey, context);
            const winner = prediction.winner;
            const winnerValue = winner === game.home_team ? prediction.homeValue : prediction.awayValue;
            const winnerPower = winner === game.home_team ? prediction.homePower : prediction.awayPower;
            const odds = game.bookmakers?.[0]?.markets?.find(m => m.key === 'h2h')?.outcomes?.find(o => o.name === winner)?.price;
            if (winnerValue && odds) {
                allUpcomingGames.push({ game, prediction, winnerValue, winnerPower, odds, sportKey: game.sportKey });
            }
        }
        const potd = allUpcomingGames.filter(p => p.winnerValue > 5).sort((a, b) => b.winnerValue - a.winnerValue)[0] || null;
        const parlayCandidates = allUpcomingGames.filter(p => p.odds > 1.4 && p.winnerPower > 55).sort((a, b) => b.winnerPower - a.winnerPower);
        const parlay = parlayCandidates.length >= 2 ? [parlayCandidates[0], parlayCandidates[1]] : null;
        res.json({ pickOfTheDay: potd, parlay: parlay });
    } catch (error) {
        console.error("Special Picks Error:", error);
        res.status(500).json({ error: 'Failed to generate special picks.' });
    }
});

app.post('/ai-analysis', (req, res) => { /* ... (no changes) ... */ });
app.get('/futures', (req, res) => res.json(FUTURES_PICKS_DB));

app.get('/records', async (req, res) => {
    console.log("--> GET /records hit!"); // DIAGNOSTIC LOG
    try {
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

app.post('/update-record', async (req, res) => { /* ... (no changes) ... */ });
app.get('/', (req, res) => res.send('Attitude Sports Bets API is online.'));

const PORT = process.env.PORT || 3000;
connectToDb().then(() => {
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
});
