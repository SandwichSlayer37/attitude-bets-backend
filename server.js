// Import necessary libraries
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');

// Initialize the express app
const app = express();
app.use(cors()); // Use CORS to allow your frontend to talk to this server

// Define the port. Render will set process.env.PORT
const PORT = process.env.PORT || 3000;

/**
 * THIS IS A PLACEHOLDER FUNCTION.
 * We will replace this with a real web scraper later.
 * For now, it just returns fake data to prove the server is working.
 */
async function getPredictionData(sport) {
    console.log(`Fetching placeholder data for: ${sport}`);
    
    // In the future, this function will:
    // 1. Visit a site like Baseball-Reference.com using axios.
    // 2. Load the HTML into cheerio to parse it.
    // 3. Extract team records, player stats, etc.
    // 4. Run our advanced formulas.
    
    // For now, return mock data:
    return [
        {
            id: 'mockgame123',
            sport_key: sport,
            home_team: 'New York Yankees',
            away_team: 'Boston Red Sox',
            prediction: {
                winner: 'New York Yankees',
                confidence: 0.65,
                analysis: 'This prediction is from our new backend server!'
            }
        }
    ];
}


// Define our main API endpoint
app.get('/predictions', async (req, res) => {
    // Get the 'sport' from the query parameter, e.g., /predictions?sport=baseball_mlb
    const { sport } = req.query;

    if (!sport) {
        return res.status(400).json({ error: 'Sport query parameter is required.' });
    }

    try {
        const data = await getPredictionData(sport);
        res.json(data); // Send the data back as a JSON response
    } catch (error) {
        console.error('Error fetching prediction data:', error);
        res.status(500).json({ error: 'Failed to fetch prediction data.' });
    }
});

// Add this new route for the root URL
app.get('/', (req, res) => {
    res.json({
        status: 'online',
        message: 'Attitude Bets API is running!'
    });
});

// Start the server
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
