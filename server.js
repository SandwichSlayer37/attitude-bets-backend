const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');

const ODDS_API_KEY = process.env.ODDS_API_KEY;

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: 'https://attitude-sports-bets.web.app' }));

const teamNameMap = { "Arizona D'Backs": "Arizona Diamondbacks", "Los Angeles Angels of Anaheim": "Los Angeles Angels" };

// --- Scraping Functions ---
async function scrapeData(url) {
    return await axios.get(url, { timeout: 30000 });
}

async function getOdds(sportKey) {
    if (!ODDS_API_KEY) throw new Error("Odds API key is missing.");
    try {
        // THIS IS THE FIX: daysFrom=3 fetches games for the next 3 days.
        const { data } = await scrapeData(`https://api.the-odds-api.com/v4/sports/${sportKey}/odds/?regions=us&markets=h2h&daysFrom=3&apiKey=${ODDS_API_KEY}`);
        return data;
    } catch (error) {
        // If the API returns 422, it means no games are available (off-season).
        if (error.response && error.response.status === 422) {
            console.log(`No upcoming games found for ${sportKey} (likely off-season).`);
            return [];
        }
        console.error(`Error fetching odds for ${sportKey}:`, error.message);
        throw new Error(`Failed to fetch odds for ${sportKey}.`);
    }
}

// --- API Endpoints ---
app.get('/', (req, res) => res.json({ status: 'online', message: 'Attitude Bets API is running!' }));

app.get('/predictions', async (req, res) => {
    const { sport } = req.query;

    if (!sport) {
        return res.status(400).json({ error: "Sport parameter is missing." });
    }

    try {
        const games = await getOdds(sport);

        if (!games || games.length === 0) {
            return res.json({ message: `No upcoming games found for ${sport}. The season may be over.` });
        }
        
        // For now, we will return the raw game data from the API.
        // This confirms the connection and data fetching is working for all sports.
        // We will add the detailed prediction logic for NHL/NFL next.
        const simplifiedPredictions = games.map(game => ({
            game: `${game.away_team} @ ${game.home_team}`,
            commence_time: game.commence_time,
            prediction: {
                winner: "Prediction logic coming soon...",
                home_final_score: "N/A",
                away_final_score: "N/A",
            },
            details: {
                home: { name: game.home_team },
                away: { name: game.away_team },
            }
        }));

        res.json(simplifiedPredictions);

    } catch (error) {
        console.error(`Prediction endpoint error for ${sport}:`, error);
        res.status(500).json({ error: error.message });
    }
});

app.listen(PORT, () => console.log(`Server is running on port ${PORT}`));
