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

// ADDED FOR DEBUGGING: Check if credentials are being loaded
console.log('Attempting to initialize Snoowrap...');
console.log(`- REDDIT_CLIENT_ID loaded: ${!!process.env.REDDIT_CLIENT_ID}`);
console.log(`- REDDIT_USERNAME loaded: ${!!process.env.REDDIT_USERNAME}`);

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
function getDynamicWeights(sportKey) { /* ... Unchanged ... */ }

// --- DATA FETCHING & SCRAPING MODULES ---
async function fetchData(key, fetcherFn, ttl = 3600000) { /* ... Unchanged ... */ }
async function getOdds(sportKey) { /* ... Unchanged ... */ }
async function getTeamStats(sportKey) { /* ... Unchanged ... */ }
async function getWeatherData(teamName) { /* ... Unchanged ... */ }

async function getRedditSentiment(homeTeam, awayTeam) {
    const key = `reddit_${homeTeam}_${awayTeam}`;
    return fetchData(key, async () => {
        try {
            const searchQuery = `"${homeTeam}" AND "${awayTeam}"`;
            // ADDED FOR DEBUGGING: Log the search query
            console.log(`Searching Reddit for: ${searchQuery}`);

            const searchResults = await r.getSubreddit('sportsbook').search({ query: searchQuery, sort: 'hot', time: 'day', limit: 25 });
            
            // ADDED FOR DEBUGGING: Log the number of results found
            console.log(`-> Reddit search found ${searchResults.length} results.`);

            let homeScore = 5, awayScore = 5;
            if (searchResults.length > 0) {
                 searchResults.forEach(post => {
                    const title = post.title.toLowerCase();
                    const body = post.selftext.toLowerCase();
                    if (title.includes(homeTeam.toLowerCase()) || body.includes(homeTeam.toLowerCase())) homeScore++;
                    if (title.includes(awayTeam.toLowerCase()) || body.includes(awayTeam.toLowerCase())) awayScore++;
                });
            }
           
            const total = homeScore + awayScore;
            return { home: (homeScore / total) * 10, away: (awayScore / total) * 10 };
        } catch (e) {
            // ADDED FOR DEBUGGING: Log the full error
            console.error("DETAILED REDDIT ERROR:", e);
            return { home: 5, away: 5 };
        }
    }, 1800000);
}

// --- THE UPGRADED PREDICTION ENGINE ---
function runPredictionEngine(game, sportKey, context) { /* ... Unchanged ... */ }

// --- API ENDPOINTS ---
app.get('/predictions', async (req, res) => {
    // ... code ...
    try {
        // ... code ...
        const predictions = await Promise.all(games.map(async (game) => {
            const [weather, redditSentiment] = await Promise.all([
                getWeatherData(game.home_team),
                getRedditSentiment(game.home_team, game.away_team)
            ]);
            // ADDED FOR DEBUGGING: Log the fetched sentiment for each game
            console.log(`Sentiment for ${game.home_team}:`, redditSentiment);

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
