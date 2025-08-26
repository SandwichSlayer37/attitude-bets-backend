const express = require('express');
const cors = require('cors');
// We don't need axios or cheerio for this test
// const axios = require('axios');
// const cheerio = require('cheerio');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors()); // Use default CORS for simplicity

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

    console.log("Received request for MLB. Returning mock data to test connection.");

    // --- MOCK DATA ---
    // We are returning hardcoded data to ensure an instant response.
    const mockPredictions = [
        {
            game: "Boston Red Sox @ New York Yankees",
            commence_time: new Date().toISOString(),
            prediction: {
                winner: "New York Yankees",
                home_final_score: "110.50",
                away_final_score: "105.25",
            },
            details: {
                home: { name: "New York Yankees", offense: "105.1", defense: "102.3", momentum: 2, pitcher: { name: "Gerrit Cole", era: 3.50, whip: 1.02 }},
                away: { name: "Boston Red Sox", offense: "98.7", defense: "99.5", momentum: -1, pitcher: { name: "Chris Sale", era: 4.30, whip: 1.15 }},
            }
        },
        {
            game: "Los Angeles Dodgers @ San Francisco Giants",
            commence_time: new Date().toISOString(),
            prediction: {
                winner: "Los Angeles Dodgers",
                home_final_score: "108.70",
                away_final_score: "115.90",
            },
            details: {
                home: { name: "San Francisco Giants", offense: "95.2", defense: "101.1", momentum: 1, pitcher: { name: "Logan Webb", era: 2.90, whip: 1.07 }},
                away: { name: "Los Angeles Dodgers", offense: "112.4", defense: "108.9", momentum: 4, pitcher: { name: "Clayton Kershaw", era: 2.46, whip: 1.00 }},
            }
        }
    ];
    // --- END OF MOCK DATA ---

    res.json(mockPredictions);
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
