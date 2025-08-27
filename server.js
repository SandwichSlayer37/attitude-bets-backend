// FINAL VERSION - Optimized Special Picks for free tier performance.
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

// --- DATABASES & MAPS ---
const teamLocationMap = { /* ... (no changes) ... */ };
const teamAliasMap = { /* ... (no changes) ... */ };
const flairMap = { /* ... (no changes) ... */ };
const FUTURES_PICKS_DB = { /* ... (no changes) ... */ };
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

// --- DATA FETCHING ---
async function fetchData(key, fetcherFn, ttl = 3600000) { /* ... (no changes) ... */ }

async function getOdds(sportKey) {
    return fetchData(`odds_${sportKey}`, async () => {
        try {
            const url = `https://api.the-odds-api.com/v4/sports/${sportKey}/odds/?regions=us&markets=h2h,spreads,totals&oddsFormat=decimal&daysFrom=3&apiKey=${ODDS_API_KEY}`;
            console.log("Fetching odds from URL:", url);
            const { data } = await axios.get(url);
            return data;
        } catch (error) {
            console.error("ERROR IN getOdds function:", error.message);
            return [];
        }
    }, 900000);
}

async function getTeamStats(sportKey) {
    if (sportKey !== 'baseball_mlb') return {};
    return fetchData(`stats_${sportKey}`, async () => {
        try {
            console.log("Fetching live MLB stats from statsapi.mlb.com...");
            const stats = {};
            const url = 'https://statsapi.mlb.com/api/v1/standings?leagueId=103,104';
            const { data } = await axios.get(url);
            for (const record of data.records) {
                for (const team of record.teamRecords) {
                    stats[team.team.name] = {
                        record: `${team.wins}-${team.losses}`,
                        streak: team.streak.streakCode
                    };
                }
            }
            if (Object.keys(stats).length < 25) {
                throw new Error("MLB API returned incomplete data.");
            }
            console.log("Successfully fetched MLB stats.");
            return stats;
        } catch (e) {
            console.error(`Could not fetch from MLB API. Error: ${e.message}`);
            return {};
        }
    }, 3600000);
}

async function getWeatherData(teamName) { /* ... (no changes) ... */ }
async function fetchEspnData(sportKey) { /* ... (no changes) ... */ }
async function getBulkRedditSentiment(allGames) { /* ... (no changes) ... */ }
async function runPredictionEngine(game, sportKey, context) { /* ... (no changes) ... */ }

// --- API ENDPOINTS ---
app.get('/predictions', async (req, res) => { /* ... (no changes) ... */ });

app.get('/special-picks', async (req, res) => {
    try {
        // --- THIS IS THE ONLY CHANGE ---
        // OPTIMIZED: Only check the most active sport (MLB) to reduce server load on the free tier.
        const sports = ['baseball_mlb']; 

        let allGames = [];
        let teamStatsBySport = {};

        for (const sport of sports) {
            const games = await getOdds(sport);
            if (games?.length > 0) {
                allGames.push(...games.map(g => ({ ...g, sportKey: sport })));
                teamStatsBySport[sport] = await getTeamStats(sport);
            }
        }
        
        if (allGames.length === 0) {
            return res.json({ pickOfTheDay: null, parlay: null });
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
app.get('/records', async (req, res) => { /* ... (no changes) ... */ });
app.post('/update-record', async (req, res) => { /* ... (no changes) ... */ });
app.get('/', (req, res) => res.send('Attitude Sports Bets API is online.'));

const PORT = process.env.PORT || 3000;
connectToDb().then(() => {
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
});
