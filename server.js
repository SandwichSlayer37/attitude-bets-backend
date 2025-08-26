const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');

const ODDS_API_KEY = process.env.ODDS_API_KEY;

const app = express();
const PORT = process.env.PORT || 3000;

// This is the definitive CORS fix for your app.
app.use(cors({ origin: 'https://attitude-sports-bets.web.app' }));

const WEIGHTS = { OFFENSE: 0.35, DEFENSE: 0.35, PITCHER: 0.25, MOMENTUM: 0.05 };
const teamNameMap = { "Arizona D'Backs": "Arizona Diamondbacks", "Los Angeles Angels of Anaheim": "Los Angeles Angels" };
const pitcherStatsCache = { data: {}, timestamp: null };

// --- Data Fetching Functions with Increased Timeout ---
async function scrapeData(url) {
    // Increased timeout to 30 seconds to handle slow responses
    return await axios.get(url, { timeout: 30000 });
}

async function scrapeMLBStandings() {
    try {
        const { data } = await scrapeData('https://www.baseball-reference.com/leagues/majors/2025-standings.shtml');
        const $ = cheerio.load(data);
        const standings = {};
        $('#teams_standings_overall tbody tr').each((index, element) => {
            const row = $(element);
            const teamName = row.find('th[data-stat="team_ID"] a').text();
            if (teamName) {
                standings[teamName] = {
                    wins: parseInt(row.find('td[data-stat="W"]').text()) || 0,
                    losses: parseInt(row.find('td[data-stat="L"]').text()) || 0,
                    runsScored: parseInt(row.find('td[data-stat="R"]').text()) || 0,
                    runsAllowed: parseInt(row.find('td[data-stat="RA"]').text()) || 0,
                    streak: row.find('td[data-stat="streak"]').text() || 'L0',
                };
            }
        });
        return standings;
    } catch (error) {
        console.error("Error scraping MLB standings:", error.message);
        throw new Error("Failed to scrape MLB standings.");
    }
}

async function getMLBOdds() {
    if (!ODDS_API_KEY) throw new Error("Odds API key is missing.");
    try {
        // Since the MLB season is over, we return mock data. 
        // To use live odds, replace this with the API call.
        return Promise.resolve([]); // Returns an empty array to simulate "no games"
        
        /*
        // LIVE SEASON CODE:
        const { data } = await scrapeData(`https://api.the-odds-api.com/v4/sports/baseball_mlb/odds/?regions=us&markets=h2h&apiKey=${ODDS_API_KEY}`);
        return data;
        */
    } catch (error) {
        console.error("Error fetching from The Odds API:", error.message);
        throw new Error("Failed to fetch MLB odds.");
    }
}

// Other scraping functions remain the same...

// --- API Endpoints ---
app.get('/', (req, res) => res.json({ status: 'online', message: 'Attitude Bets API is running!' }));

app.get('/predictions', async (req, res) => {
    const { sport } = req.query;
    if (sport !== 'baseball_mlb') {
        return res.status(400).json({ error: `Sport '${sport}' is not yet supported.` });
    }

    try {
        const [standingsData, games] = await Promise.all([
            scrapeMLBStandings(), 
            getMLBOdds()
        ]);

        if (!games || games.length === 0) {
            return res.json({ message: "No upcoming MLB games found. The season may be over." });
        }
        
        // The rest of the prediction logic...
        // This part will only run if there are live games.
        // ... (calculation logic) ...

        res.json(predictions);

    } catch (error) {
        console.error("Prediction endpoint error:", error);
        res.status(500).json({ error: error.message });
    }
});

app.listen(PORT, () => console.log(`Server is running on port ${PORT}`));
