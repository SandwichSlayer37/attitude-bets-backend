const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');

const ODDS_API_KEY = process.env.ODDS_API_KEY;

const app = express();
app.use(cors());
const PORT = process.env.PORT || 3000;

// Simple in-memory cache to store pitcher stats for 1 hour to avoid re-scraping
const pitcherStatsCache = {
    data: {},
    timestamp: null,
};

// --- Data Fetching & Scraping Functions ---

async function scrapeMLBStandings() {
    // ... (This function remains the same as before)
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
    // ... (This function remains the same as before)
    if (!ODDS_API_KEY) {
        throw new Error("Odds API key is missing.");
    }
    try {
        const url = `https://api.the-odds-api.com/v4/sports/baseball_mlb/odds/?regions=us&markets=h2h&oddsFormat=decimal&apiKey=${ODDS_API_KEY}`;
        const response = await axios.get(url);
        return response.data;
    } catch (error) {
        console.error("Error fetching from The Odds API:", error.response ? error.response.data : error.message);
        throw new Error("Failed to fetch MLB odds.");
    }
}

async function scrapeProbablePitchers() {
    try {
        const url = 'https://www.espn.com/mlb/scoreboard';
        const { data } = await axios.get(url);
        const $ = cheerio.load(data);
        const pitchers = {};

        // Find each game on the scoreboard
        $('.ScoreboardScoreCell__Competitors').each((i, elem) => {
            const competitorElements = $(elem).find('.ScoreCell__TeamName');
            const awayTeamName = $(competitorElements[0]).text();
            const homeTeamName = $(competitorElements[1]).text();

            // Find the probable pitcher info for this game
            const probablePitchersSection = $(elem).closest('section').find('.ProbablePitchers__Pitcher');
            
            if (probablePitchersSection.length >= 2) {
                const awayPitcherName = $(probablePitchersSection[0]).find('.ProbablePitchers__Name > a').text();
                const homePitcherName = $(probablePitchersSection[1]).find('.ProbablePitchers__Name > a').text();

                if (awayTeamName && awayPitcherName) pitchers[awayTeamName] = awayPitcherName;
                if (homeTeamName && homePitcherName) pitchers[homeTeamName] = homePitcherName;
            }
        });
        return pitchers;
    } catch (error) {
        console.error("Error scraping probable pitchers:", error.message);
        throw new Error("Failed to scrape probable pitchers from ESPN.");
    }
}

async function getPitcherStats(pitcherName) {
    // Check cache first
    const now = new Date();
    if (pitcherStatsCache.timestamp && (now - pitcherStatsCache.timestamp < 3600000) && pitcherStatsCache.data[pitcherName]) {
        return pitcherStatsCache.data[pitcherName];
    }
    
    try {
        // Search for the pitcher on Baseball-Reference to find their page URL
        const searchUrl = `https://www.baseball-reference.com/search/search.fcgi?search=${encodeURIComponent(pitcherName)}`;
        let { data: searchHtml } = await axios.get(searchUrl);
        let $ = cheerio.load(searchHtml);
        
        // Find the first link in the search results for players
        const playerUrl = $('.search-item-url').first().text();
        if (!playerUrl) { throw new Error('Player page not found'); }

        // Scrape the player's main page for career stats
        const { data: playerHtml } = await axios.get(`https://www.baseball-reference.com${playerUrl}`);
        $ = cheerio.load(playerHtml);
        
        // Find the career totals row in the standard pitching table
        const careerRow = $('#pitching_standard tfoot tr').first();
        const era = parseFloat(careerRow.find('td[data-stat="earned_run_avg"]').text());
        const whip = parseFloat(careerRow.find('td[data-stat="whip"]').text());

        if (isNaN(era) || isNaN(whip)) { throw new Error('Could not parse stats'); }

        const stats = { era, whip };

        // Save to cache
        pitcherStatsCache.data[pitcherName] = stats;
        pitcherStatsCache.timestamp = now;

        return stats;

    } catch (error) {
        console.error(`Failed to get stats for ${pitcherName}:`, error.message);
        // Return default/poor stats on failure to avoid crashing
        return { era: 5.00, whip: 1.50 };
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
        const [standingsData, games, probablePitchers] = await Promise.all([
            scrapeMLBStandings(),
            getMLBOdds(),
            scrapeProbablePitchers()
        ]);

        if (!games || games.length === 0) {
            return res.json({ message: "No upcoming MLB games found." });
        }

        const predictions = await Promise.all(games.map(async (game) => {
            const homeTeam = game.home_team;
            const awayTeam = game.away_team;
            const homeStats = standingsData[homeTeam];
            const awayStats = standingsData[awayTeam];

            if (!homeStats || !awayStats) {
                return { game: `${awayTeam} @ ${homeTeam}`, error: "Could not find team stats." };
            }

            const homePitcherName = probablePitchers[homeTeam] || 'N/A';
            const awayPitcherName = probablePitchers[awayTeam] || 'N/A';

            const [homePitcherStats, awayPitcherStats] = await Promise.all([
                getPitcherStats(homePitcherName),
                getPitcherStats(awayPitcherName)
            ]);

            const teamPowerScoreH = (homeStats.wins / (homeStats.wins + homeStats.losses)) * 100;
            const teamPowerScoreA = (awayStats.wins / (awayStats.wins + awayStats.losses)) * 100;
            
            const pitcherScoreH = (50 / homePitcherStats.era) + (50 / homePitcherStats.whip);
            const pitcherScoreA = (50 / awayPitcherStats.era) + (50 / awayPitcherStats.whip);

            const finalScoreH = (teamPowerScoreH * 0.6) + (pitcherScoreH * 0.4);
            const finalScoreA = (teamPowerScoreA * 0.6) + (pitcherScoreA * 0.4);

            return {
                game: `${awayTeam} @ ${homeTeam}`,
                commence_time: game.commence_time,
                prediction: {
                    winner: finalScoreH > finalScoreA ? homeTeam : awayTeam,
                    home_final_score: finalScoreH.toFixed(2),
                    away_final_score: finalScoreA.toFixed(2),
                },
                details: {
                    home_pitcher: { name: homePitcherName, ...homePitcherStats },
                    away_pitcher: { name: awayPitcherName, ...awayPitcherStats },
                }
            };
        }));

        res.json(predictions);

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
