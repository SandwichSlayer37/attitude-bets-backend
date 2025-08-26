const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');

const ODDS_API_KEY = process.env.ODDS_API_KEY;

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: 'https://attitude-sports-bets.web.app' }));

// This cache will hold our scraped data.
let cache = {
    mlb: null,
    lastUpdated: null
};

const WEIGHTS = { OFFENSE: 0.35, DEFENSE: 0.35, PITCHER: 0.25, MOMENTUM: 0.05 };
const teamNameMap = { "Arizona D'Backs": "Arizona Diamondbacks", "Los Angeles Angels of Anaheim": "Los Angeles Angels" };

// --- Scraping functions (remain the same) ---
async function scrapeMLBStandings() {
    const url = 'https://www.baseball-reference.com/leagues/majors/2025-standings.shtml';
    const { data } = await axios.get(url);
    const $ = cheerio.load(data);
    const standings = {};
    $('#teams_standings_overall tbody tr').each((index, element) => {
        const row = $(element);
        const teamName = row.find('th[data-stat="team_ID"] a').text();
        if (teamName) {
            standings[teamName] = {
                wins: parseInt(row.find('td[data-stat="W"]').text()),
                losses: parseInt(row.find('td[data-stat="L"]').text()),
                runsScored: parseInt(row.find('td[data-stat="R"]').text()),
                runsAllowed: parseInt(row.find('td[data-stat="RA"]').text()),
                streak: row.find('td[data-stat="streak"]').text(),
            };
        }
    });
    return standings;
}
// (Other scraping functions like getMLBOdds, etc. would go here, but are omitted for this example as they are unchanged)


// --- NEW "Worker" Function ---
async function updateMlbCache() {
    console.log("Starting to update MLB cache...");
    try {
        // This is the slow part: all scraping happens here.
        const [standingsData, games] = await Promise.all([
            scrapeMLBStandings(),
            // For now, we will use mock games since the season is over.
            // In a live season, you would call getMLBOdds() here.
            Promise.resolve([ 
                { home_team: 'New York Yankees', away_team: 'Boston Red Sox', commence_time: new Date().toISOString() },
                { home_team: 'Los Angeles Dodgers', away_team: 'San Francisco Giants', commence_time: new Date().toISOString() }
            ])
        ]);

        if (!games || games.length === 0) {
            cache.mlb = { message: "No upcoming MLB games found." };
            cache.lastUpdated = new Date();
            console.log("Cache updated: No games found.");
            return;
        }

        // --- All the formula logic is now here ---
        let totalRunsScored = 0, totalRunsAllowed = 0, totalGamesPlayed = 0;
        const teams = Object.values(standingsData);
        teams.forEach(team => {
            const gamesPlayed = team.wins + team.losses;
            if (gamesPlayed > 0) {
                totalRunsScored += team.runsScored;
                totalRunsAllowed += team.runsAllowed;
                totalGamesPlayed += gamesPlayed;
            }
        });
        const leagueAvgRunsScored = totalRunsScored / totalGamesPlayed;
        const leagueAvgRunsAllowed = totalRunsAllowed / totalGamesPlayed;

        const predictions = games.map(game => {
            const homeTeam = game.home_team, awayTeam = game.away_team;
            const mappedHomeTeam = teamNameMap[homeTeam] || homeTeam;
            const mappedAwayTeam = teamNameMap[awayTeam] || awayTeam;
            const homeStats = standingsData[mappedHomeTeam];
            const awayStats = standingsData[mappedAwayTeam];

            if (!homeStats || !awayStats) return { game: `${awayTeam} @ ${homeTeam}`, error: "Could not find team stats." };
            
            // Simplified pitcher logic for this example
            const homePitcher = { name: "Ace Pitcher", era: 3.2, whip: 1.1 };
            const awayPitcher = { name: "Good Pitcher", era: 3.8, whip: 1.25 };

            const homeGames = homeStats.wins + homeStats.losses;
            const awayGames = awayStats.wins + awayStats.losses;
            const homeOffenseRating = (homeStats.runsScored / homeGames / leagueAvgRunsScored) * 100;
            const awayOffenseRating = (awayStats.runsScored / awayGames / leagueAvgRunsScored) * 100;
            const homeDefenseRating = (leagueAvgRunsAllowed / (homeStats.runsAllowed / homeGames)) * 100;
            const awayDefenseRating = (leagueAvgRunsAllowed / (awayStats.runsAllowed / awayGames)) * 100;
            const parseStreak = (s) => (s.startsWith('W') ? parseInt(s.substring(1)) : -parseInt(s.substring(1))) || 0;
            const homeMomentum = parseStreak(homeStats.streak);
            const awayMomentum = parseStreak(awayStats.streak);
            const pitcherScoreH = (50 / homePitcher.era) + (50 / homePitcher.whip);
            const pitcherScoreA = (50 / awayPitcher.era) + (50 / awayPitcher.whip);

            const finalScoreH = (homeOffenseRating * WEIGHTS.OFFENSE) + (homeDefenseRating * WEIGHTS.DEFENSE) + (pitcherScoreH * WEIGHTS.PITCHER) + (homeMomentum * WEIGHTS.MOMENTUM);
            const finalScoreA = (awayOffenseRating * WEIGHTS.OFFENSE) + (awayDefenseRating * WEIGHTS.DEFENSE) + (pitcherScoreA * WEIGHTS.PITCHER) + (awayMomentum * WEIGHTS.MOMENTUM);

            return {
                game: `${awayTeam} @ ${homeTeam}`,
                commence_time: game.commence_time,
                prediction: { winner: finalScoreH > finalScoreA ? homeTeam : awayTeam, home_final_score: finalScoreH.toFixed(2), away_final_score: finalScoreA.toFixed(2) },
                details: {
                    home: { name: homeTeam, offense: homeOffenseRating.toFixed(1), defense: homeDefenseRating.toFixed(1), momentum: homeMomentum, pitcher: homePitcher },
                    away: { name: awayTeam, offense: awayOffenseRating.toFixed(1), defense: awayDefenseRating.toFixed(1), momentum: awayMomentum, pitcher: awayPitcher },
                }
            };
        });
        
        cache.mlb = predictions;
        cache.lastUpdated = new Date();
        console.log("MLB cache updated successfully.");

    } catch (error) {
        console.error("Failed to update MLB cache:", error);
        cache.mlb = { error: "Failed to update cache." };
    }
}


// --- API Endpoints ---

app.get('/', (req, res) => {
    res.json({ status: 'online', message: 'Attitude Bets API is running!' });
});

// NEW "Worker" Endpoint
app.get('/update-cache', async (req, res) => {
    res.send("Cache update process started. This will take about 30-60 seconds. You can close this window.");
    // We send a response immediately so the user isn't waiting.
    // The actual work happens in the background.
    updateMlbCache();
});

// FAST "API" Endpoint
app.get('/predictions', async (req, res) => {
    if (cache.mlb) {
        // If cache exists, return it instantly.
        res.json(cache.mlb);
    } else {
        // If cache is empty, tell the user how to fill it.
        res.status(404).json({ message: "Cache is empty. Please visit the /update-cache endpoint first to populate the data." });
    }
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
