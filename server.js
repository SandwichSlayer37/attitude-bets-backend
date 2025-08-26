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
 * Scrapes the MLB standings from Baseball-Reference.com.
 * This is our first real data-gathering function.
 */
async function scrapeMLBStandings() {
    try {
        // 1. AXIOS: Fetch the HTML of the page
        const url = 'https://www.baseball-reference.com/leagues/majors/2025-standings.shtml';
        const { data } = await axios.get(url);
        
        // 2. CHEERIO: Load the HTML so we can parse it
        const $ = cheerio.load(data);
        
        const standings = {};
        
        // 3. Find the table and loop through each team's row
        //    The selector '#teams_standings_overall tbody tr' targets each row in the main standings table
        $('#teams_standings_overall tbody tr').each((index, element) => {
            const row = $(element);
            
            // Extract the data from each cell (td) in the row
            const teamName = row.find('th[data-stat="team_ID"] a').text();
            const wins = row.find('td[data-stat="W"]').text();
            const losses = row.find('td[data-stat="L"]').text();
            const streak = row.find('td[data-stat="streak"]').text();
            
            // Cheerio might pick up empty rows, so we check if we have a team name
            if (teamName) {
                standings[teamName] = {
                    wins: parseInt(wins),
                    losses: parseInt(losses),
                    record: `${wins}-${losses}`,
                    streak: streak,
                };
            }
        });
        
        return standings;

    } catch (error) {
        console.error("Error scraping MLB standings:", error);
        // If scraping fails, we return null so the API can handle the error
        return null;
    }
}


// --- API Endpoints ---

// Root URL endpoint for a status check
app.get('/', (req, res) => {
    res.json({
        status: 'online',
        message: 'Attitude Bets API is running!'
    });
});

// Main predictions endpoint
app.get('/predictions', async (req, res) => {
    const { sport } = req.query;

    if (!sport) {
        return res.status(400).json({ error: 'Sport query parameter is required.' });
    }

    if (sport === 'baseball_mlb') {
        try {
            // Call our new scraper function
            const standingsData = await scrapeMLBStandings();
            
            if (!standingsData) {
                 return res.status(500).json({ error: 'Failed to scrape MLB data.' });
            }

            // For now, we just return the raw scraped data
            // In the future, this is where we'll feed this data into our formulas
            res.json({
                source: 'Live Scraped Data',
                data: standingsData
            });

        } catch (error) {
            res.status(500).json({ error: 'An error occurred on the server.' });
        }
    } else {
        // Placeholder for other sports we'll add later
        res.status(400).json({ error: `Sport '${sport}' is not yet supported.` });
    }
});


// Start the server
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
