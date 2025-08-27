// FINAL VERSION - Includes robust fallback stats and all previous fixes.
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

// NEW: Robust fallback data in case scraper is blocked
const fallbackTeamStats = {
    'baseball_mlb': {
        'Baltimore Orioles': { record: '83-50', streak: 'W2' },
        'Tampa Bay Rays': { record: '82-53', streak: 'W1' },
        'Toronto Blue Jays': { record: '74-61', streak: 'W3' },
        'Boston Red Sox': { record: '69-65', streak: 'L1' },
        'New York Yankees': { record: '65-69', streak: 'L2' },
        'Minnesota Twins': { record: '70-65', streak: 'W1' },
        'Cleveland Guardians': { record: '64-71', streak: 'L2' },
        'Detroit Tigers': { record: '60-74', streak: 'L1' },
        'Chicago White Sox': { record: '53-81', streak: 'W1' },
        'Kansas City Royals': { record: '42-94', streak: 'W1' },
        'Houston Astros': { record: '77-58', streak: 'L1' },
        'Texas Rangers': { record: '75-59', streak: 'L2' },
        'Seattle Mariners': { record: '76-57', streak: 'W2' },
        'Los Angeles Angels': { record: '64-70', streak: 'W1' },
        'Oakland Athletics': { record: '39-95', streak: 'L1' },
        'Atlanta Braves': { record: '88-45', streak: 'W4' },
        'Philadelphia Phillies': { record: '74-59', streak: 'W2' },
        'Miami Marlins': { record: '67-67', streak: 'W1' },
        'Washington Nationals': { record: '62-72', streak: 'L3' },
        'New York Mets': { record: '61-73', streak: 'W1' },
        'Milwaukee Brewers': { record: '75-59', streak: 'W1' },
        'Chicago Cubs': { record: '71-62', streak: 'L1' },
        'Cincinnati Reds': { record: '69-66', streak: 'W1' },
        'Pittsburgh Pirates': { record: '61-73', streak: 'L2' },
        'St. Louis Cardinals': { record: '58-76', streak: 'W2' },
        'Los Angeles Dodgers': { record: '82-50', streak: 'L1' },
        'San Francisco Giants': { record: '69-64', streak: 'W3' },
        'Arizona Diamondbacks': { record: '69-65', streak: 'L1' },
        'San Diego Padres': { record: '62-72', streak: 'L3' },
        'Colorado Rockies': { record: '50-83', streak: 'L1' }
    }
};

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
    return fetchData(`stats_${sportKey}`, async () => {
        if (sportKey === 'baseball_mlb') {
            try {
                const stats = {};
                const currentYear = new Date().getFullYear();
                const { data } = await axios.get(`https://www.baseball-reference.com/leagues/majors/${currentYear}-standings.shtml`);
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
                if (Object.keys(stats).length < 25) { // Check for incomplete scrape
                    console.warn("MLB scraper returned incomplete data. Using fallback stats.");
                    return fallbackTeamStats[sportKey] || {};
                }
                return stats;
            } catch (e) {
                console.error(`Could not scrape MLB stats, using fallback. Error: ${e.message}`);
                return fallbackTeamStats[sportKey] || {};
            }
        }
        return {};
    });
}

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
