const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');

const ODDS_API_KEY = process.env.ODDS_API_KEY;

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: 'https://attitude-sports-bets.web.app' }));

const WEIGHTS = { OFFENSE: 0.35, DEFENSE: 0.35, PITCHER: 0.25, MOMENTUM: 0.05 };
const teamNameMap = { "Arizona D'Backs": "Arizona Diamondbacks", "Los Angeles Angels of Anaheim": "Los Angeles Angels" };
const pitcherStatsCache = { data: {}, timestamp: null };

// --- Utility Functions ---
async function scrapeData(url) {
    return await axios.get(url, { timeout: 30000 });
}

async function getOdds(sportKey) {
    if (!ODDS_API_KEY) throw new Error("Odds API key is missing.");
    try {
        const { data } = await scrapeData(`https://api.the-odds-api.com/v4/sports/${sportKey}/odds/?regions=us&markets=h2h&daysFrom=3&apiKey=${ODDS_API_KEY}`);
        return data;
    } catch (error) {
        if (error.response && error.response.status === 422) {
            console.log(`No upcoming games found for ${sportKey} (likely off-season).`);
            return [];
        }
        console.error(`Error fetching odds for ${sportKey}:`, error.message);
        throw new Error(`Failed to fetch odds for ${sportKey}.`);
    }
}

// --- MLB Specific Functions ---
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
        return {}; // Return empty object on failure
    }
}

// --- API Endpoints ---
app.get('/', (req, res) => res.json({ status: 'online', message: 'Attitude Bets API is running!' }));

app.get('/predictions', async (req, res) => {
    const { sport } = req.query;
    if (!sport) return res.status(400).json({ error: "Sport parameter is missing." });

    try {
        const games = await getOdds(sport);

        if (!games || games.length === 0) {
            return res.json({ message: `No upcoming games found for ${sport}. The season may be over.` });
        }
        
        // --- MLB Logic ---
        if (sport === 'baseball_mlb') {
            const standingsData = await scrapeMLBStandings();
            
            if(Object.keys(standingsData).length === 0){
                 return res.json({ message: `Could not load standings for MLB. The source may be unavailable.` });
            }

            let totalRunsScored = 0, totalRunsAllowed = 0, totalGamesPlayed = 0;
            Object.values(standingsData).forEach(team => {
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
                
                const homePitcher = { name: "TBD", era: 4.5, whip: 1.4 }; // Placeholder
                const awayPitcher = { name: "TBD", era: 4.5, whip: 1.4 }; // Placeholder

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
                    game, // Send the full game object
                    prediction: { winner: finalScoreH > finalScoreA ? homeTeam : awayTeam, home_final_score: finalScoreH.toFixed(2), away_final_score: finalScoreA.toFixed(2) },
                    details: {
                        home: { name: homeTeam, offense: homeOffenseRating.toFixed(1), defense: homeDefenseRating.toFixed(1), momentum: homeMomentum, pitcher: homePitcher },
                        away: { name: awayTeam, offense: awayOffenseRating.toFixed(1), defense: awayDefenseRating.toFixed(1), momentum: awayMomentum, pitcher: awayPitcher },
                    }
                };
            });
            return res.json(predictions.filter(p => p && !p.error));
        }

        // --- Placeholder for other sports ---
        const simplifiedPredictions = games.map(game => ({
            game,
            prediction: { winner: "Coming Soon", home_final_score: "N/A", away_final_score: "N/A" },
            details: { home: { name: game.home_team }, away: { name: game.away_team } }
        }));
        res.json(simplifiedPredictions);

    } catch (error) {
        console.error(`Prediction endpoint error for ${sport}:`, error);
        res.status(500).json({ error: error.message });
    }
});

app.listen(PORT, () => console.log(`Server is running on port ${PORT}`));
