const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');

const ODDS_API_KEY = process.env.ODDS_API_KEY;

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: 'https://attitude-sports-bets.web.app' }));

const teamNameMap = { "St Louis Blues": "St. Louis Blues" }; // For NHL name mismatches

// --- Utility Functions ---
async function scrapeData(url) {
    // Increased timeout to handle potentially slow sports statistics sites
    return await axios.get(url, { timeout: 30000 });
}

async function getOdds(sportKey) {
    if (!ODDS_API_KEY) throw new Error("Odds API key is missing.");
    try {
        const { data } = await scrapeData(`https://api.the-odds-api.com/v4/sports/${sportKey}/odds/?regions=us&markets=h2h&daysFrom=3&apiKey=${ODDS_API_KEY}`);
        return data;
    } catch (error) {
        if (error.response && error.response.status === 422) return []; // 422 means no games available, which is normal for off-season
        console.error(`Error fetching odds for ${sportKey}:`, error.message);
        throw new Error(`Failed to fetch odds for ${sportKey}.`);
    }
}

// --- Sport-Specific Scrapers ---

async function scrapeNHLStandings() {
    try {
        // Using a dynamic year to ensure it works season to season.
        const currentYear = new Date().getFullYear() + 1;
        const { data } = await scrapeData(`https://www.hockey-reference.com/leagues/NHL_${currentYear}_standings.html`);
        const $ = cheerio.load(data);
        const standings = {};
        
        $('#all_standings tbody tr.full_table').each((index, element) => {
            const row = $(element);
            const teamName = row.find('th[data-stat="team_name"] a').text();
            if (teamName) {
                standings[teamName] = {
                    wins: parseInt(row.find('td[data-stat="wins"]').text()) || 0,
                    losses: parseInt(row.find('td[data-stat="losses"]').text()) || 0,
                    goalsFor: parseInt(row.find('td[data-stat="goals"]').text()) || 0,
                    goalsAgainst: parseInt(row.find('td[data-stat="goals_against"]').text()) || 0,
                };
            }
        });
        return standings;
    } catch (error) {
        console.error("Error scraping NHL standings:", error.message);
        return {}; // Return empty object on failure so the app can report it
    }
}

// MLB scraper is kept but will likely fail gracefully in the off-season
async function scrapeMLBStandings() {
    try {
        const currentYear = new Date().getFullYear() + 1;
        const { data } = await scrapeData(`https://www.baseball-reference.com/leagues/majors/${currentYear}-standings.shtml`);
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
        return {};
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
        
        let predictions;

        if (sport === 'icehockey_nhl') {
            const standingsData = await scrapeNHLStandings();
            if (Object.keys(standingsData).length === 0) {
                return res.json({ message: `Could not load standings for NHL. The source may be unavailable.` });
            }

            let totalGoalsFor = 0, totalGoalsAgainst = 0, totalGamesPlayed = 0;
            Object.values(standingsData).forEach(team => {
                const gamesPlayed = team.wins + team.losses;
                if (gamesPlayed > 0) {
                    totalGoalsFor += team.goalsFor;
                    totalGoalsAgainst += team.goalsAgainst;
                    totalGamesPlayed += gamesPlayed;
                }
            });
            const leagueAvgGoalsFor = totalGoalsFor / totalGamesPlayed;
            const leagueAvgGoalsAgainst = totalGoalsAgainst / totalGamesPlayed;

            predictions = games.map(game => {
                const homeTeam = game.home_team, awayTeam = game.away_team;
                const mappedHomeTeam = teamNameMap[homeTeam] || homeTeam;
                const mappedAwayTeam = teamNameMap[awayTeam] || awayTeam;
                const homeStats = standingsData[mappedHomeTeam];
                const awayStats = standingsData[mappedAwayTeam];

                if (!homeStats || !awayStats) return { game, error: "Could not find team stats." };

                const homeGames = homeStats.wins + homeStats.losses;
                const awayGames = awayStats.wins + awayStats.losses;
                const homeOffenseRating = (homeStats.goalsFor / homeGames / leagueAvgGoalsFor) * 100;
                const awayOffenseRating = (awayStats.goalsFor / awayGames / leagueAvgGoalsFor) * 100;
                const homeDefenseRating = (leagueAvgGoalsAgainst / (homeStats.goalsAgainst / homeGames)) * 100;
                const awayDefenseRating = (leagueAvgGoalsAgainst / (awayStats.goalsAgainst / awayGames)) * 100;
                const homeMomentum = (homeStats.wins / homeGames) * 100;
                const awayMomentum = (awayStats.wins / awayGames) * 100;

                const finalScoreH = (homeOffenseRating * 0.45) + (homeDefenseRating * 0.45) + (homeMomentum * 0.1);
                const finalScoreA = (awayOffenseRating * 0.45) + (awayDefenseRating * 0.45) + (awayMomentum * 0.1);

                return {
                    game,
                    prediction: { winner: finalScoreH > finalScoreA ? homeTeam : awayTeam, home_final_score: finalScoreH.toFixed(2), away_final_score: finalScoreA.toFixed(2) },
                    details: {
                        home: { name: homeTeam, offense: homeOffenseRating.toFixed(1), defense: homeDefenseRating.toFixed(1) },
                        away: { name: awayTeam, offense: awayOffenseRating.toFixed(1), defense: awayDefenseRating.toFixed(1) },
                    }
                };
            }).filter(p => p && !p.error);

        } else { // Fallback for MLB, NFL
            predictions = games.map(game => ({
                game,
                prediction: { winner: "Prediction Engine Coming Soon", home_final_score: "N/A", away_final_score: "N/A" },
                details: { home: { name: game.home_team }, away: { name: game.away_team } }
            }));
        }
        
        res.json(predictions);

    } catch (error) {
        console.error(`Prediction endpoint error for ${sport}:`, error);
        res.status(500).json({ error: error.message });
    }
});

app.listen(PORT, () => console.log(`Server is running on port ${PORT}`));
