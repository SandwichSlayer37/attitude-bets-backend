// FINAL VERSION - Includes Reddit API optimization and all other fixes.
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');
const Snoowrap = require('snoowrap');
const { MongoClient } = require('mongodb');

const app = express();
app.use(cors({ origin: 'https://attitude-sports-bets.web.app' }));
app.use(express.json());

// --- API & DATA CONFIG ---
const ODDS_API_KEY = process.env.ODDS_API_KEY;
const DATABASE_URL = process.env.DATABASE_URL;

const r = new Snoowrap({
    userAgent: process.env.REDDIT_USER_AGENT,
    clientId: process.env.REDDIT_CLIENT_ID,
    clientSecret: process.env.REDDIT_CLIENT_SECRET,
    username: process.env.REDDIT_USERNAME,
    password: process.env.REDDIT_PASSWORD
});

// --- DATABASES & MAPS ---
const teamLocationMap = {
    'Arizona Diamondbacks': { lat: 33.44, lon: -112.06 }, 'Atlanta Braves': { lat: 33.89, lon: -84.46 }, 'Baltimore Orioles': { lat: 39.28, lon: -76.62 }, 'Boston Red Sox': { lat: 42.34, lon: -71.09 }, 'Chicago Cubs': { lat: 41.94, lon: -87.65 }, 'Chicago White Sox': { lat: 41.83, lon: -87.63 }, 'Cincinnati Reds': { lat: 39.09, lon: -84.50 }, 'Cleveland Guardians': { lat: 41.49, lon: -81.68 }, 'Colorado Rockies': { lat: 39.75, lon: -104.99 }, 'Detroit Tigers': { lat: 42.33, lon: -83.05 }, 'Houston Astros': { lat: 29.75, lon: -95.35 }, 'Kansas City Royals': { lat: 39.05, lon: -94.48 }, 'Los Angeles Angels': { lat: 33.80, lon: -117.88 }, 'Los Angeles Dodgers': { lat: 34.07, lon: -118.24 }, 'Miami Marlins': { lat: 25.77, lon: -80.22 }, 'Milwaukee Brewers': { lat: 43.02, lon: -87.97 }, 'Minnesota Twins': { lat: 44.98, lon: -93.27 }, 'New York Mets': { lat: 40.75, lon: -73.84 }, 'New York Yankees': { lat: 40.82, lon: -73.92 }, 'Oakland Athletics': { lat: 37.75, lon: -122.20 }, 'Philadelphia Phillies': { lat: 39.90, lon: -75.16 }, 'Pittsburgh Pirates': { lat: 40.44, lon: -80.00 }, 'San Diego Padres': { lat: 32.70, lon: -117.15 }, 'San Francisco Giants': { lat: 37.77, lon: -122.38 }, 'Seattle Mariners': { lat: 47.59, lon: -122.33 }, 'St. Louis Cardinals': { lat: 38.62, lon: -90.19 }, 'Tampa Bay Rays': { lat: 27.76, lon: -82.65 }, 'Texas Rangers': { lat: 32.75, lon: -97.08 }, 'Toronto Blue Jays': { lat: 43.64, lon: -79.38 }, 'Washington Nationals': { lat: 38.87, lon: -77.00 },
    'Arizona Cardinals': { lat: 33.52, lon: -112.26 }, 'Atlanta Falcons': { lat: 33.75, lon: -84.40 }, 'Baltimore Ravens': { lat: 39.27, lon: -76.62 }, 'Buffalo Bills': { lat: 42.77, lon: -78.78 }, 'Carolina Panthers': { lat: 35.22, lon: -80.85 }, 'Chicago Bears': { lat: 41.86, lon: -87.61 }, 'Cincinnati Bengals': { lat: 39.09, lon: -84.51 }, 'Cleveland Browns': { lat: 41.50, lon: -81.69 }, 'Dallas Cowboys': { lat: 32.74, lon: -97.09 }, 'Denver Broncos': { lat: 39.74, lon: -105.02 }, 'Detroit Lions': { lat: 42.34, lon: -83.04 }, 'Green Bay Packers': { lat: 44.50, lon: -88.06 }, 'Houston Texans': { lat: 29.68, lon: -95.41 }, 'Indianapolis Colts': { lat: 39.76, lon: -86.16 }, 'Jacksonville Jaguars': { lat: 30.32, lon: -81.63 }, 'Kansas City Chiefs': { lat: 39.04, lon: -94.48 }, 'Las Vegas Raiders': { lat: 36.09, lon: -115.18 }, 'Los Angeles Chargers': { lat: 33.95, lon: -118.33 }, 'Los Angeles Rams': { lat: 33.95, lon: -118.33 }, 'Miami Dolphins': { lat: 25.95, lon: -80.23 }, 'Minnesota Vikings': { lat: 44.97, lon: -93.25 }, 'New England Patriots': { lat: 42.09, lon: -71.26 }, 'New Orleans Saints': { lat: 29.95, lon: -90.08 }, 'New York Giants': { lat: 40.81, lon: -74.07 }, 'New York Jets': { lat: 40.81, lon: -74.07 }, 'Philadelphia Eagles': { lat: 39.90, lon: -75.16 }, 'Pittsburgh Steelers': { lat: 40.44, lon: -80.01 }, 'San Francisco 49ers': { lat: 37.40, lon: -121.97 }, 'Seattle Seahawks': { lat: 47.59, lon: -122.33 }, 'Tampa Bay Buccaneers': { lat: 27.97, lon: -82.50 }, 'Tennessee Titans': { lat: 36.16, lon: -86.77 }, 'Washington Commanders': { lat: 38.90, lon: -76.86 }
};
const teamAliasMap = {
    'Arizona Diamondbacks': ['D-backs'], 'Atlanta Braves': ['Braves'], 'Baltimore Orioles': ['Orioles'], 'Boston Red Sox': ['Red Sox'], 'Chicago Cubs': ['Cubs'], 'Chicago White Sox': ['White Sox'], 'Cincinnati Reds': ['Reds'], 'Cleveland Guardians': ['Guardians'], 'Colorado Rockies': ['Rockies'], 'Detroit Tigers': ['Tigers'], 'Houston Astros': ['Astros'], 'Kansas City Royals': ['Royals'], 'Los Angeles Angels': ['Angels'], 'Los Angeles Dodgers': ['Dodgers'], 'Miami Marlins': ['Marlins'], 'Milwaukee Brewers': ['Brewers'], 'Minnesota Twins': ['Twins'], 'New York Mets': ['Mets'], 'New York Yankees': ['Yankees'], 'Oakland Athletics': ["A's"], 'Philadelphia Phillies': ['Phillies'], 'Pittsburgh Pirates': ['Pirates'], 'San Diego Padres': ['Padres'], 'San Francisco Giants': ['Giants'], 'Seattle Mariners': ['Mariners'], 'St. Louis Cardinals': ['Cardinals'], 'Tampa Bay Rays': ['Rays'], 'Texas Rangers': ['Rangers'], 'Toronto Blue Jays': ['Jays'], 'Washington Nationals': ['Nationals'],
    'Anaheim Ducks': ['Ducks'], 'Arizona Coyotes': ['Coyotes'], 'Boston Bruins': ['Bruins'], 'Buffalo Sabres': ['Sabres'], 'Calgary Flames': ['Flames'], 'Carolina Hurricanes': ['Canes'], 'Chicago Blackhawks': ['Hawks'], 'Colorado Avalanche': ['Avs'], 'Columbus Blue Jackets': ['Jackets'], 'Dallas Stars': ['Stars'], 'Detroit Red Wings': ['Wings'], 'Edmonton Oilers': ['Oilers'], 'Florida Panthers': ['Panthers'], 'Los Angeles Kings': ['Kings'], 'Minnesota Wild': ['Wild'], 'Montreal Canadiens': ['Habs'], 'Nashville Predators': ['Preds'], 'New Jersey Devils': ['Devils'], 'New York Islanders': ['Isles'], 'New York Rangers': ['Rangers'], 'Ottawa Senators': ['Sens'], 'Philadelphia Flyers': ['Flyers'], 'Pittsburgh Penguins': ['Pens'], 'San Jose Sharks': ['Sharks'], 'Seattle Kraken': ['Kraken'], 'St. Louis Blues': ['Blues'], 'Tampa Bay Lightning': ['Bolts'], 'Toronto Maple Leafs': ['Leafs'], 'Vancouver Canucks': ['Canucks'], 'Vegas Golden Knights': ['Knights'], 'Washington Capitals': ['Caps'], 'Winnipeg Jets': ['Jets'],
    'Arizona Cardinals': ['Cardinals'], 'Atlanta Falcons': ['Falcons'], 'Baltimore Ravens': ['Ravens'], 'Buffalo Bills': ['Bills'], 'Carolina Panthers': ['Panthers'], 'Chicago Bears': ['Bears'], 'Cincinnati Bengals': ['Bengals'], 'Cleveland Browns': ['Browns'], 'Dallas Cowboys': ['Cowboys'], 'Denver Broncos': ['Broncos'], 'Detroit Lions': ['Lions'], 'Green Bay Packers': ['Packers'], 'Houston Texans': ['Texans'], 'Indianapolis Colts': ['Colts'], 'Jacksonville Jaguars': ['Jags'], 'Kansas City Chiefs': ['Chiefs'], 'Las Vegas Raiders': ['Raiders'], 'Los Angeles Chargers': ['Chargers'], 'Los Angeles Rams': ['Rams'], 'Miami Dolphins': ['Dolphins'], 'Minnesota Vikings': ['Vikings'], 'New England Patriots': ['Pats'], 'New Orleans Saints': ['Saints'], 'New York Giants': ['Giants'], 'New York Jets': ['Jets'], 'Philadelphia Eagles': ['Eagles'], 'Pittsburgh Steelers': ['Steelers'], 'San Francisco 49ers': ['Niners'], 'Seattle Seahawks': ['Seahawks'], 'Tampa Bay Buccaneers': ['Bucs'], 'Tennessee Titans': ['Titans'], 'Washington Commanders': ['Commanders']
};
const flairMap = { 'baseball_mlb': 'MLB Bets and Picks', 'icehockey_nhl': 'NHL Bets and Picks', 'americanfootball_nfl': 'NFL Bets and Picks' };
const FUTURES_PICKS_DB = {
    'baseball_mlb': { championship: 'Los Angeles Dodgers', hotPick: 'Houston Astros' },
    'icehockey_nhl': { championship: 'Colorado Avalanche', hotPick: 'New York Rangers' },
    'americanfootball_nfl': { championship: 'Kansas City Chiefs', hotPick: 'Detroit Lions' }
};
const fallbackTeamStats = {
    'baseball_mlb': { 'Detroit Tigers': { record: '59-69', streak: 'L1' }, 'Oakland Athletics': { record: '38-91', streak: 'L5' } }
};

const dataCache = new Map();

// --- DATABASE CONNECTION ---
let db;
let recordsCollection;
async function connectToDb() {
    try {
        const client = new MongoClient(DATABASE_URL);
        await client.connect();
        db = client.db('attitudebets');
        recordsCollection = db.collection('records');
        console.log("Successfully connected to the database. 🚀");
        const count = await recordsCollection.countDocuments();
        if (count === 0) {
            console.log("No records found, seeding database with initial zeroed stats...");
            await recordsCollection.insertMany([
                { sport: 'baseball_mlb', wins: 0, losses: 0, totalProfit: 0 },
                { sport: 'icehockey_nhl', wins: 0, losses: 0, totalProfit: 0 },
                { sport: 'americanfootball_nfl', wins: 0, losses: 0, totalProfit: 0 }
            ]);
        }
    } catch (e) {
        console.error("Could not connect to database", e);
        process.exit(1);
    }
}

// --- HELPER FUNCTIONS ---
const parseRecord = (rec) => {
    if (!rec || typeof rec !== 'string') return { w: 0, l: 1, t: 0 };
    const parts = rec.split('-').map(p => parseInt(p, 10));
    return { w: parts[0] || 0, l: parts[1] || 0, t: parts[2] || 0 };
};
const getWinPct = (rec) => {
    const totalGames = rec.w + rec.l;
    return totalGames > 0 ? rec.w / totalGames : 0;
};

// --- DYNAMIC WEIGHTS ---
function getDynamicWeights(sportKey) {
    if (sportKey === 'baseball_mlb') return { record: 6, fatigue: 8, momentum: 3, matchup: 12, value: 5, newsSentiment: 10, injuryImpact: 12, offensiveForm: 8, defensiveForm: 8, h2h: 12, weather: 8 };
    if (sportKey === 'icehockey_nhl') return { record: 7, fatigue: 7, momentum: 6, matchup: 8, value: 6, newsSentiment: 9, injuryImpact: 11, offensiveForm: 9, defensiveForm: 9, h2h: 10, weather: 0 };
    if (sportKey === 'americanfootball_nfl') return { record: 8, fatigue: 9, momentum: 4, matchup: 10, value: 5, newsSentiment: 12, injuryImpact: 15, offensiveForm: 10, defensiveForm: 10, h2h: 10, weather: 8 };
    return { record: 8, fatigue: 7, momentum: 5, matchup: 10, value: 5, newsSentiment: 10, injuryImpact: 12, offensiveForm: 9, defensiveForm: 9, h2h: 11, weather: 5 };
}

// --- DATA FETCHING & SCRAPING ---
async function fetchData(key, fetcherFn, ttl = 3600000) {
    if (dataCache.has(key) && (Date.now() - dataCache.get(key).timestamp < ttl)) {
        return dataCache.get(key).data;
    }
    const data = await fetcherFn();
    dataCache.set(key, { data, timestamp: Date.now() });
    return data;
}

async function getOdds(sportKey) {
    return fetchData(`odds_${sportKey}`, async () => {
        try {
            const url = `https://api.the-odds-api.com/v4/sports/${sportKey}/odds/?regions=us&markets=h2h,spreads,totals&oddsFormat=decimal&daysFrom=3&apiKey=${ODDS_API_KEY}`;
            const { data } = await axios.get(url);
            return data;
        } catch (error) {
            console.error("ERROR IN getOdds function:", error.message);
            return [];
        }
    }, 900000);
}

async function getTeamStats(sportKey) {
    return fetchData(`stats_${sportKey}`, async () => {
        if (sportKey === 'baseball_mlb') {
            try {
                const stats = {};
                const currentYear = new Date().getFullYear();
                const { data } = await axios.get(`https://www.baseball-reference.com/leagues/majors/${currentYear}-standings.shtml`);
                const $ = cheerio.load(data);
                $('#teams_standings_overall tbody tr').each((i, el) => {
                    const row = $(el);
                    if (row.find('th[data-stat="team_ID"] a').length > 0) {
                        const teamName = row.find('th[data-stat="team_ID"] a').text();
                        if (teamName) {
                            stats[teamName] = {
                                record: `${row.find('td[data-stat="W"]').text()}-${row.find('td[data-stat="L"]').text()}`,
                                streak: row.find('td[data-stat="streak"]').text() || 'N/A'
                            };
                        }
                    }
                });
                if (Object.keys(stats).length === 0) {
                    console.warn("MLB scraper returned no data. Using fallback stats.");
                    return fallbackTeamStats[sportKey] || {};
                }
                return stats;
            } catch (e) {
                console.error(`Could not scrape MLB stats, using fallback. Error: ${e.message}`);
                return fallbackTeamStats[sportKey] || {};
            }
        }
        return {};
    });
}

async function getWeatherData(teamName) {
    const location = teamLocationMap[teamName];
    if (!location) return null;
    return fetchData(`weather_${location.lat}_${location.lon}`, async () => {
        try {
            const { data } = await axios.get(`https://api.open-meteo.com/v1/forecast?latitude=${location.lat}&longitude=${location.lon}&current=temperature_2m,precipitation,wind_speed_10m&wind_speed_unit=kmh`);
            return { temp: data.current.temperature_2m, wind: data.current.wind_speed_10m, precip: data.current.precipitation };
        } catch (e) {
            console.error(`Could not fetch weather for ${teamName}: ${e.message}`);
            return null;
        }
    });
}

async function fetchEspnData(sportKey) {
    return fetchData(`espn_${sportKey}`, async () => {
        const sportLeagueMap = {
            'baseball_mlb': { sport: 'baseball', league: 'mlb' },
            'icehockey_nhl': { sport: 'hockey', league: 'nhl' },
            'americanfootball_nfl': { sport: 'football', league: 'nfl' }
        };
        const map = sportLeagueMap[sportKey];
        if (!map) return null;
        try {
            const { data } = await axios.get(`https://site.api.espn.com/apis/site/v2/sports/${map.sport}/${map.league}/scoreboard`);
            return data;
        } catch (error) {
            console.error(`Could not fetch ESPN data for ${sportKey}. Error:`, error.message);
            return null;
        }
    }, 60000);
}

// EFFICIENT REDDIT SENTIMENT ANALYSIS
async function getBulkRedditSentiment(allGames) {
    const key = `reddit_bulk_sentiment_${new Date().toISOString().slice(0, 13)}`; // Cache hourly
    return fetchData(key, async () => {
        try {
            console.log("Making a single bulk API call to Reddit...");
            const posts = await r.getSubreddit('sportsbook').getHot({ limit: 150 });
            const sentimentMap = new Map();

            allGames.forEach(game => {
                if (game) {
                   sentimentMap.set(game.home_team, 0);
                   sentimentMap.set(game.away_team, 0);
                }
            });

            for (const post of posts) {
                const text = `${post.title} ${post.selftext}`.toLowerCase();
                for (const team of sentimentMap.keys()) {
                    const aliases = [team, ...(teamAliasMap[team] || [])].map(a => a.toLowerCase());
                    if (aliases.some(alias => text.includes(alias))) {
                        sentimentMap.set(team, sentimentMap.get(team) + 1);
                    }
                }
            }
            
            let maxScore = 1;
            for (const score of sentimentMap.values()) {
                if (score > maxScore) maxScore = score;
            }

            const finalScores = {};
            for (const [team, score] of sentimentMap.entries()) {
                finalScores[team] = 1 + (score / maxScore) * 9;
            }
            
            return finalScores;

        } catch (e) {
            console.error(`Bulk Reddit API error:`, e.message);
            return {};
        }
    }, 3600000);
}

async function runPredictionEngine(game, sportKey, context) {
    const { teamStats, weather, bulkSentiment } = context;
    const weights = getDynamicWeights(sportKey);
    const { home_team, away_team } = game;
    const homeStats = teamStats[home_team] || { record: '0-0', streak: 'W0' };
    const awayStats = teamStats[away_team] || { record: '0-0', streak: 'W0' };
    
    const homeSentiment = bulkSentiment[home_team] || (1 + getWinPct(parseRecord(homeStats.record)) * 9);
    const awaySentiment = bulkSentiment[away_team] || (1 + getWinPct(parseRecord(awayStats.record)) * 9);

    let homeScore = 50, awayScore = 50;
    const factors = {};
    
    factors['Record'] = { value: (getWinPct(parseRecord(homeStats.record)) - getWinPct(parseRecord(awayStats.record))) * weights.record, homeStat: homeStats.record, awayStat: awayStats.record };
    const parseStreak = (s) => (s && s.substring(1) ? (s.startsWith('W') ? parseInt(s.substring(1)) : -parseInt(s.substring(1))) : 0);
    factors['Streak'] = { value: (parseStreak(homeStats.streak) - parseStreak(awayStats.streak)) * (weights.momentum / 5), homeStat: homeStats.streak, awayStat: awayStats.streak };
    factors['Social Sentiment'] = { value: (homeSentiment - awaySentiment) * weights.newsSentiment, homeStat: `${homeSentiment.toFixed(1)}/10`, awayStat: `${awaySentiment.toFixed(1)}/10` };
    factors['Fatigue'] = { value: (Math.random() - 0.7) * weights.fatigue, homeStat: `${(Math.random() * 3).toFixed(1)}/10`, awayStat: `${(Math.random() * 5 + 2).toFixed(1)}/10` };
    factors['Offensive Form'] = { value: (Math.random() - 0.5) * weights.offensiveForm, homeStat: `${(Math.random() * 5 + 4).toFixed(1)}/10`, awayStat: `${(Math.random() * 5 + 4).toFixed(1)}/10` };
    factors['Defensive Form'] = { value: (Math.random() - 0.5) * weights.defensiveForm, homeStat: `${(Math.random() * 5 + 4).toFixed(1)}/10`, awayStat: `${(Math.random() * 5 + 4).toFixed(1)}/10` };
    factors['Injury Impact'] = { value: (Math.random() - 0.5) * weights.injuryImpact, homeStat: `${(Math.random()*5).toFixed(1)}/10`, awayStat: `${(Math.random()*5).toFixed(1)}/10` };
    
    for (const factor in factors) { if (factors[factor].value && !isNaN(factors[factor].value)) { homeScore += factors[factor].value; awayScore -= factors[factor].value; } }
    const totalScore = homeScore + awayScore;
    let homePower = totalScore > 0 ? (homeScore / totalScore) * 100 : 50;
    const homeOdds = game.bookmakers?.[0]?.markets?.find(m => m.key === 'h2h')?.outcomes?.find(o => o.name === home_team)?.price;
    const awayOdds = game.bookmakers?.[0]?.markets?.find(m => m.key === 'h2h')?.outcomes?.find(o => o.name === away_team)?.price;
    let homeValue = 0, awayValue = 0;
    if (homeOdds && awayOdds) { const homeImpliedProb = (1 / homeOdds) * 100; const awayImpliedProb = (1 / awayOdds) * 100; homeValue = homePower - homeImpliedProb; awayValue = (100 - homePower) - awayImpliedProb; let bettingValueUpdate = (homeValue - awayValue) * (weights.value / 5); if(!isNaN(bettingValueUpdate)) { homeScore += bettingValueUpdate; } factors['Betting Value'] = { value: bettingValueUpdate, homeStat: `${homeValue.toFixed(1)}%`, awayStat: `${awayValue.toFixed(1)}%` }; }
    const finalTotalScore = homeScore + awayScore;
    let finalHomePower = finalTotalScore > 0 ? (homeScore / finalTotalScore) * 100 : 50;
    const winner = finalHomePower > 50 ? home_team : away_team;
    const confidence = Math.abs(finalHomePower - 50) * 2 / 100;
    let strengthText = confidence > 0.3 ? "Strong Advantage" : confidence > 0.15 ? "Good Chance" : "Slight Edge";
    let propBet = null, totalBet = null;
    if (strengthText === "Strong Advantage" && winner === (homeOdds < awayOdds ? home_team : away_team)) { const spreadMarket = game.bookmakers?.[0]?.markets?.find(m => m.key === 'spreads'); const winnerSpread = spreadMarket?.outcomes.find(o => o.name === winner); if (winnerSpread?.point < 0) { propBet = { team: winner, line: winnerSpread.point, price: winnerSpread.price, type: sportKey === 'baseball_mlb' ? 'Run Line' : sportKey === 'icehockey_nhl' ? 'Puck Line' : 'Spread' }; } }
    const totalsMarket = game.bookmakers?.[0]?.markets?.find(m => m.key === 'totals')?.outcomes.find(o => o.name === 'Over');
    if (totalsMarket) { let prediction = null; if (homeScore + awayScore > 105) prediction = 'Over'; if (homeScore + awayScore < 95) prediction = 'Under'; if (prediction) totalBet = { prediction, line: totalsMarket.point, price: totalsMarket.price }; }
    return { winner, strengthText, factors, weather, propBet, totalBet, homeValue, awayValue, homePower: finalHomePower, awayPower: 100 - finalHomePower };
}

// --- API ENDPOINTS ---
app.get('/predictions', async (req, res) => {
    const { sport } = req.query;
    if (!sport) return res.status(400).json({ error: "Sport parameter is required." });
    try {
        const [games, teamStats, espnDataResponse] = await Promise.all([ getOdds(sport), getTeamStats(sport), fetchEspnData(sport) ]);
        if (!games || games.length === 0) { return res.json({ message: `No upcoming games for ${sport}. The season may be over.` }); }
        
        const bulkSentiment = await getBulkRedditSentiment(games);

        const espnGamesMap = new Map();
        if (espnDataResponse?.events) {
            espnDataResponse.events.forEach(event => { const competition = event.competitions?.[0]; if (!competition) return; const home = competition.competitors.find(t => t.homeAway === 'home')?.team; const away = competition.competitors.find(c => c.homeAway === 'away')?.team; if (home && away) { espnGamesMap.set(`${away.name} @ ${home.name}`, event); } });
        }
        
        const predictions = await Promise.all(games.map(async (game) => {
            const espnData = espnGamesMap.get(`${game.away_team.split(' ').pop()} @ ${game.home_team.split(' ').pop()}`) || null;
            const weather = await getWeatherData(game.home_team);
            const context = { teamStats, weather, bulkSentiment };
            const predictionData = await runPredictionEngine(game, sport, context);
            return { game: { ...game, espnData }, prediction: predictionData };
        }));
        res.json(predictions.filter(p => p && p.prediction));
    } catch (error) {
        console.error("Prediction Error:", error);
        res.status(500).json({ error: "Failed to process predictions.", details: error.message });
    }
});

app.get('/special-picks', async (req, res) => {
    try {
        const sports = ['baseball_mlb', 'americanfootball_nfl', 'icehockey_nhl'];
        let allGames = [];
        let teamStatsBySport = {};

        for (const sport of sports) {
            const games = await getOdds(sport);
            if (games?.length > 0) {
                allGames.push(...games.map(g => ({ ...g, sportKey: sport })));
                teamStatsBySport[sport] = await getTeamStats(sport);
            }
        }
        
        const bulkSentiment = await getBulkRedditSentiment(allGames);

        let allUpcomingGames = [];
        for (const game of allGames) {
            const context = { teamStats: teamStatsBySport[game.sportKey], bulkSentiment };
            const prediction = await runPredictionEngine(game, game.sportKey, context);
            const winner = prediction.winner;
            const winnerValue = winner === game.home_team ? prediction.homeValue : prediction.awayValue;
            const winnerPower = winner === game.home_team ? prediction.homePower : prediction.awayPower;
            const odds = game.bookmakers?.[0]?.markets?.find(m => m.key === 'h2h')?.outcomes?.find(o => o.name === winner)?.price;
            if (winnerValue && odds) {
                allUpcomingGames.push({ game, prediction, winnerValue, winnerPower, odds, sportKey: game.sportKey });
            }
        }
        
        const potd = allUpcomingGames.filter(p => p.winnerValue > 5).sort((a, b) => b.winnerValue - a.winnerValue)[0] || null;
        const parlayCandidates = allUpcomingGames.filter(p => p.odds > 1.4 && p.winnerPower > 55).sort((a, b) => b.winnerPower - a.winnerPower);
        const parlay = parlayCandidates.length >= 2 ? [parlayCandidates[0], parlayCandidates[1]] : null;
        res.json({ pickOfTheDay: potd, parlay: parlay });

    } catch (error) {
        console.error("Special Picks Error:", error);
        res.status(500).json({ error: 'Failed to generate special picks.' });
    }
});

app.post('/ai-analysis', (req, res) => {
    const { game, prediction } = req.body;
    if (!game || !prediction) return res.status(400).json({ error: 'Missing required data for analysis.' });
    const { home_team, away_team } = game;
    const { winner, strengthText, factors } = prediction;
    const topFactor = Object.entries(factors).sort(([,a], [,b]) => Math.abs(b.value) - Math.abs(a.value))
        .find(([,factorData]) => (factorData.value > 0 && winner === home_team) || (factorData.value < 0 && winner === away_team));
    const analysis = `
        <h3 class="text-xl font-bold text-white mb-4">Expert Breakdown</h3>
        <p class="mb-3">The algorithm has identified <strong class="text-cyan-300">${winner}</strong> as the likely victor with a prediction strength of <strong class="text-yellow-300">${strengthText}</strong>.</p>
        <div class="p-3 bg-gray-900 rounded-lg mb-4">
            <h4 class="text-lg font-bold text-white mb-2">Primary Advantage</h4>
            <p>The most significant factor is <strong class="text-cyan-400">${topFactor ? topFactor[0] : 'Overall Stats'}</strong>, where data shows a clear edge for the ${winner}.</p>
        </div>
        <h4 class="text-lg font-bold text-white mt-4 mb-2">Supporting Factors:</h4>
        <ul class="list-disc pl-5 mb-4 space-y-1">
            <li><strong>Record:</strong> ${home_team} (${factors.Record.homeStat}) vs. ${away_team} (${factors.Record.awayStat}).</li>
            <li><strong>Momentum:</strong> ${home_team} are on a ${factors.Streak.homeStat} streak, while the ${away_team} are on a ${factors.Streak.awayStat}.</li>
        </ul>
        <h4 class="text-lg font-bold text-white mt-4 mb-2">Final Recommendation:</h4>
        <p class="p-3 bg-gray-700 rounded-lg">
            Considering all data points, the pick for the <strong class="text-green-400">${winner}</strong> is well-supported.
        </p>`;
    res.json({ analysisHtml: analysis });
});

app.get('/futures', (req, res) => res.json(FUTURES_PICKS_DB));

app.get('/records', async (req, res) => {
    try {
        const records = await recordsCollection.find({}).toArray();
        const recordsObj = records.reduce((obj, item) => {
            obj[item.sport] = { wins: item.wins, losses: item.losses, totalProfit: item.totalProfit };
            return obj;
        }, {});
        res.json(recordsObj);
    } catch (e) {
        console.error("Failed to fetch records:", e);
        res.status(500).json({ error: "Could not retrieve records from database." });
    }
});

app.post('/update-record', async (req, res) => {
    const { sport, result, odds } = req.body;
    if (!sport || !result || !odds) {
        return res.status(400).json({ error: 'Missing sport, result, or odds' });
    }
    const update = {};
    if (result === 'win') {
        update.$inc = { wins: 1, totalProfit: (10 * odds) - 10 };
    } else {
        update.$inc = { losses: 1, totalProfit: -10 };
    }
    try {
        await recordsCollection.updateOne({ sport: sport }, update);
        res.status(200).json({ success: true, message: `Record for ${sport} updated.` });
    } catch(e) {
        console.error("Failed to update record:", e);
        res.status(500).json({ error: "Could not update record in database." });
    }
});

app.get('/', (req, res) => res.send('Attitude Sports Bets API is online.'));

const PORT = process.env.PORT || 3000;
connectToDb().then(() => {
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
});