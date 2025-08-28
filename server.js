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

async function getOdds(sportKey) {
    return fetchData(`odds_${sportKey}`, async () => {
        try {
            const url = `https://api.the-odds-api.com/v4/sports/${sportKey}/odds/?regions=us&markets=h2h,spreads,totals&oddsFormat=decimal&daysFrom=3&apiKey=${ODDS_API_KEY}`;
            
            // --- THIS IS THE NEW DIAGNOSTIC LINE ---
            console.log("Fetching odds from URL:", url); 
            
            const { data } = await axios.get(url);
            return data;
        } catch (error) {
            console.error("ERROR IN getOdds function:", error.message);
            return [];
        }
    }, 900000);
}

async function getTeamStats(sportKey) { /* ... (no changes) ... */ }
async function getWeatherData(teamName) { /* ... (no changes) ... */ }
async function fetchEspnData(sportKey) { /* ... (no changes) ... */ }
async function getBulkRedditSentiment(allGames) { /* ... (no changes) ... */ }
async function runPredictionEngine(game, sportKey, context) { /* ... (no changes) ... */ }

// --- API ENDPOINTS ---
app.get('/predictions', async (req, res) => { /* ... (no changes) ... */ });
app.get('/special-picks', async (req, res) => { /* ... (no changes) ... */ });
app.post('/ai-analysis', (req, res) => { /* ... (no changes) ... */ });
app.get('/futures', (req, res) => res.json(FUTURES_PICKS_DB));
app.get('/records', async (req, res) => { /* ... (no changes) ... */ });
app.post('/update-record', async (req, res) => { /* ... (no changes) ... */ });
app.get('/', (req, res) => res.send('Attitude Sports Bets API is online.'));

const PORT = process.env.PORT || 3000;
connectToDb().then(() => {
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
});
