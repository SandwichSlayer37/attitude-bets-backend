// server.js - Final Version
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');

const ODDS_API_KEY = process.env.ODDS_API_KEY;

const app = express();
const PORT = process.env.PORT || 3000;

// This is the definitive CORS fix. It allows requests from your app and handles preflight checks.
app.use(cors({ origin: 'https://attitude-sports-bets.web.app' }));

const WEIGHTS = {
    OFFENSE: 0.35,
    DEFENSE: 0.35,
    PITCHER: 0.25,
    MOMENTUM: 0.05,
};

const teamNameMap = {
    "Arizona D'Backs": "Arizona Diamondbacks",
    "Los Angeles Angels of Anaheim": "Los Angeles Angels",
};

const pitcherStatsCache = {
    data: {},
    timestamp: null,
};


// --- Data Fetching & Scraping Functions ---
async function scrapeMLBStandings() {
    try {
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
        $('.ScoreboardScoreCell__Competitors').each((i, elem) => {
            const competitorElements = $(elem).find('.ScoreCell__TeamName');
            const awayTeamName = $(competitorElements[0]).text();
            const homeTeamName = $(competitorElements[1]).text();
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
    const now = new Date();
    if (pitcherStatsCache.timestamp && (now - pitcherStatsCache.timestamp < 3600000) && pitcherStatsCache.data[pitcherName]) {
        return pitcherStatsCache.data[pitcherName];
    }
    try {
        const searchUrl = `https://www.baseball-reference.com/search/search.fcgi?search=${encodeURIComponent(pitcherName)}`;
        let { data: searchHtml } = await axios.get(searchUrl);
        let $ = cheerio.load(searchHtml);
        const playerUrl = $('.search-item-url').first().text();
        if (!playerUrl) { throw new Error('Player page not found'); }
        const { data: playerHtml } = await axios.get(`https://www.baseball-reference.com${playerUrl}`);
        $ = cheerio.load(playerHtml);
        const careerRow = $('#pitching_standard tfoot tr').first();
        const era = parseFloat(careerRow.find('td[data-stat="earned_run_avg"]').text());
        const whip = parseFloat(careerRow.find('td[data-stat="whip"]').text());
        if (isNaN(era) || isNaN(whip)) { throw new Error('Could not parse stats'); }
        const stats = { era, whip };
        pitcherStatsCache.data[pitcherName] = stats;
        pitcherStatsCache.timestamp = now;
        return stats;
    } catch (error) {
        console.error(`Failed to get stats for ${pitcherName}:`, error.message);
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
            scrapeMLBStandings(), getMLBOdds(), scrapeProbablePitchers()
        ]);

        if (!games || games.length === 0) return res.json({ message: "No upcoming MLB games found." });

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

        const predictions = await Promise.all(games.map(async (game) => {
            const homeTeam = game.home_team, awayTeam = game.away_team;
            const mappedHomeTeam = teamNameMap[homeTeam] || homeTeam;
            const mappedAwayTeam = teamNameMap[awayTeam] || awayTeam;
            const homeStats = standingsData[mappedHomeTeam];
            const awayStats = standingsData[mappedAwayTeam];

            if (!homeStats || !awayStats) return { game: `${awayTeam} @ ${homeTeam}`, error: "Could not find team stats." };

            const homePitcherName = probablePitchers[mappedHomeTeam] || 'N/A';
            const awayPitcherName = probablePitchers[mappedAwayTeam] || 'N/A';
            const [homePitcherStats, awayPitcherStats] = await Promise.all([getPitcherStats(homePitcherName), getPitcherStats(awayPitcherName)]);

            const homeGames = homeStats.wins + homeStats.losses;
            const awayGames = awayStats.wins + awayStats.losses;

            const homeOffenseRating = (homeStats.runsScored / homeGames / leagueAvgRunsScored) * 100;
            const awayOffenseRating = (awayStats.runsScored / awayGames / leagueAvgRunsScored) * 100;

            const homeDefenseRating = (leagueAvgRunsAllowed / (homeStats.runsAllowed / homeGames)) * 100;
            const awayDefenseRating = (leagueAvgRunsAllowed / (awayStats.runsAllowed / awayGames)) * 100;

            const parseStreak = (s) => (s.startsWith('W') ? parseInt(s.substring(1)) : -parseInt(s.substring(1))) || 0;
            const homeMomentum = parseStreak(homeStats.streak);
            const awayMomentum = parseStreak(awayStats.streak);

            const pitcherScoreH = (50 / homePitcherStats.era) + (50 / homePitcherStats.whip);
            const pitcherScoreA = (50 / awayPitcherStats.era) + (50 / awayPitcherStats.whip);

            const finalScoreH = (homeOffenseRating * WEIGHTS.OFFENSE) + (homeDefenseRating * WEIGHTS.DEFENSE) + (pitcherScoreH * WEIGHTS.PITCHER) + (homeMomentum * WEIGHTS.MOMENTUM);
            const finalScoreA = (awayOffenseRating * WEIGHTS.OFFENSE) + (awayDefenseRating * WEIGHTS.DEFENSE) + (pitcherScoreA * WEIGHTS.PITCHER) + (awayMomentum * WEIGHTS.MOMENTUM);

            return {
                game: `${awayTeam} @ ${homeTeam}`,
                commence_time: game.commence_time,
                prediction: {
                    winner: finalScoreH > finalScoreA ? homeTeam : awayTeam,
                    home_final_score: finalScoreH.toFixed(2),
                    away_final_score: finalScoreA.toFixed(2),
                },
                details: {
                    home: { name: homeTeam, offense: homeOffenseRating.toFixed(1), defense: homeDefenseRating.toFixed(1), momentum: homeMomentum, pitcher: { name: homePitcherName, ...homePitcherStats }},
                    away: { name: awayTeam, offense: awayOffenseRating.toFixed(1), defense: awayDefenseRating.toFixed(1), momentum: awayMomentum, pitcher: { name: awayPitcherName, ...awayPitcherStats }},
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
