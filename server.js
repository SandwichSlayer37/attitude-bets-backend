// Import necessary libraries
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');

// SECURELY get the API key from environment variables
const ODDS_API_KEY = process.env.ODDS_API_KEY;

const app = express();
app.use(cors());
const PORT = process.env.PORT || 3000;

// --- Data Fetching Functions ---

async function scrapeMLBStandings() {
    try {
        const url = 'https://www.baseball-reference.com/leagues/majors/2025-standings.shtml';
        const { data } = await axios.get(url);
        const $ = cheerio.load(data);
        const standings = {};
        $('#teams_standings_overall tbody tr').each((index, element) => {
            const row = $(element);
            const teamName = row.find('th[data-stat="team_ID"] a').text();
            const wins = row.find('td[data-stat="W"]').text();
            const losses = row.find('td[data-stat="L"]').text();
            
            if (teamName) {
                standings[teamName] = {
                    wins: parseInt(wins),
                    losses: parseInt(losses),
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
    if (!ODDS_API_KEY) {
        throw new Error("Odds API key is missing.");
    }
    try {
        const url = `https://api.the-odds-api.com/v4/sports/baseball_mlb/odds/?regions=us&markets=h2h&oddsFormat=decimal&apiKey=${ODDS_API_KEY}`;
        const response = await axios.get(url);
        return response.data; // This is the array of upcoming games
    } catch (error) {
        console.error("Error fetching from The Odds API:", error.response ? error.response.data : error.message);
        throw new Error("Failed to fetch MLB odds.");
    }
}


// --- API Endpoints ---

app.get('/', (req, res) => {
    res.json({
        status: 'online',
        message: 'Attitude Bets API is running!'
    });
});

app.get('/predictions', async (req, res) => {
    const { sport } = req.query;

    if (sport !== 'baseball_mlb') {
        return res.status(400).json({ error: `Sport '${sport}' is not yet supported.` });
    }

    try {
        // 1. Fetch both sets of data at the same time for efficiency
        const [standingsData, games] = await Promise.all([
            scrapeMLBStandings(),
            getMLBOdds()
        ]);

        if (!games || games.length === 0) {
            return res.json({ message: "No upcoming MLB games found on The Odds API." });
        }

        // 2. Process the data to create predictions
        const predictions = games.map(game => {
            const homeTeam = game.home_team;
            const awayTeam = game.away_team;

            const homeStats = standingsData[homeTeam];
            const awayStats = standingsData[awayTeam];

            // Handle cases where a team name might not match perfectly
            if (!homeStats || !awayStats) {
                return {
                    game: `${awayTeam} @ ${homeTeam}`,
                    error: "Could not find team stats for this matchup."
                };
            }

            // 3. Apply our Power Score formula
            const homePowerScore = (homeStats.wins / (homeStats.wins + homeStats.losses)) * 100;
            const awayPowerScore = (awayStats.wins / (awayStats.wins + awayStats.losses)) * 100;

            const predictedWinner = homePowerScore > awayPowerScore ? homeTeam : awayTeam;
            const confidence = (Math.abs(homePowerScore - awayPowerScore) / 100).toFixed(2);

            return {
                game: `${awayTeam} @ ${homeTeam}`,
                commence_time: game.commence_time,
                home_power_score: homePowerScore.toFixed(2),
                away_power_score: awayPowerScore.toFixed(2),
                prediction: {
                    winner: predictedWinner,
                    confidence: parseFloat(confidence),
                }
            };
        });

        res.json(predictions);

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});


app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
