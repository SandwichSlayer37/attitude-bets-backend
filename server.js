// FINAL UPGRADED VERSION - Switched to a reliable stats API
require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const axios = require('axios');
const Snoowrap = require('snoowrap');
const { MongoClient } = require('mongodb');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const cheerio = require('cheerio');

const app = express();
app.use(cors());
app.use(express.json());

app.use(express.static(path.join(__dirname, '..', 'public')));

// --- API & DATA CONFIG ---
const ODDS_API_KEY = process.env.ODDS_API_KEY;
const DATABASE_URL = process.env.DATABASE_URL;
const RECONCILE_PASSWORD = process.env.RECONCILE_PASSWORD || "your_secret_password";
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const r = new Snoowrap({
    userAgent: process.env.REDDIT_USER_AGENT,
    clientId: process.env.REDDIT_CLIENT_ID,
    clientSecret: process.env.REDDIT_CLIENT_SECRET,
    username: process.env.REDDIT_USERNAME,
    password: process.env.REDDIT_PASSWORD
});

let db;
let recordsCollection;
let predictionsCollection;
async function connectToDb() {
    try {
        if (db) return db;
        const client = new MongoClient(DATABASE_URL);
        await client.connect();
        db = client.db('attitudebets');
        recordsCollection = db.collection('records');
        predictionsCollection = db.collection('predictions');
        console.log('Connected to MongoDB');
        return db;
    } catch (e) {
        console.error("Failed to connect to MongoDB", e);
        process.exit(1);
    }
}

// --- DATA MAPS ---
const SPORTS_DB = [ 
    { key: 'baseball_mlb', name: 'MLB', gameCountThreshold: 5 }, 
    { key: 'icehockey_nhl', name: 'NHL', gameCountThreshold: 5 }, 
    { key: 'americanfootball_nfl', name: 'NFL', gameCountThreshold: 4 } 
];

const teamLocationMap = {
    // MLB
    'Arizona Diamondbacks': { lat: 33.4453, lon: -112.0667 }, 'Atlanta Braves': { lat: 33.8907, lon: -84.4677 }, 'Baltimore Orioles': { lat: 39.2838, lon: -76.6217 }, 'Boston Red Sox': { lat: 42.3467, lon: -71.0972 }, 'Chicago Cubs': { lat: 41.9484, lon: -87.6553 }, 'Chicago White Sox': { lat: 41.8300, lon: -87.6337 }, 'Cincinnati Reds': { lat: 39.0975, lon: -84.5069 }, 'Cleveland Guardians': { lat: 41.4962, lon: -81.6852 }, 'Colorado Rockies': { lat: 39.7562, lon: -104.9942 }, 'Detroit Tigers': { lat: 42.3390, lon: -83.0552 }, 'Houston Astros': { lat: 29.7570, lon: -95.3555 }, 'Kansas City Royals': { lat: 39.0517, lon: -94.4803 }, 'Los Angeles Angels': { lat: 33.8003, lon: -117.8827 }, 'Los Angeles Dodgers': { lat: 34.0739, lon: -118.2398 }, 'Miami Marlins': { lat: 25.7781, lon: -80.2196 }, 'Milwaukee Brewers': { lat: 43.0280, lon: -87.9712 }, 'Minnesota Twins': { lat: 44.9817, lon: -93.2775 }, 'New York Mets': { lat: 40.7571, lon: -73.8458 }, 'New York Yankees': { lat: 40.8296, lon: -73.9262 }, 'Oakland Athletics': { lat: 37.7516, lon: -122.2005 }, 'Philadelphia Phillies': { lat: 39.9061, lon: -75.1665 }, 'Pittsburgh Pirates': { lat: 40.4469, lon: -80.0057 }, 'San Diego Padres': { lat: 32.7073, lon: -117.1570 }, 'San Francisco Giants': { lat: 37.7786, lon: -122.3893 }, 'Seattle Mariners': { lat: 47.5914, lon: -122.3325 }, 'St. Louis Cardinals': { lat: 38.6226, lon: -90.1928 }, 'Tampa Bay Rays': { lat: 27.7682, lon: -82.6534 }, 'Texas Rangers': { lat: 32.7513, lon: -97.0829 }, 'Toronto Blue Jays': { lat: 43.6414, lon: -79.3894 }, 'Washington Nationals': { lat: 38.8729, lon: -77.0074 },
    // NFL
    'Arizona Cardinals': { lat: 33.5276, lon: -112.2625 }, 'Atlanta Falcons': { lat: 33.7554, lon: -84.4009 }, 'Baltimore Ravens': { lat: 39.2780, lon: -76.6227 }, 'Buffalo Bills': { lat: 42.7738, lon: -78.7870 }, 'Carolina Panthers': { lat: 35.2259, lon: -80.8529 }, 'Chicago Bears': { lat: 41.8623, lon: -87.6167 }, 'Cincinnati Bengals': { lat: 39.0954, lon: -84.5160 }, 'Cleveland Browns': { lat: 41.5061, lon: -81.6995 }, 'Dallas Cowboys': { lat: 32.7478, lon: -97.0929 }, 'Denver Broncos': { lat: 39.7439, lon: -105.0201 }, 'Detroit Lions': { lat: 42.3400, lon: -83.0456 }, 'Green Bay Packers': { lat: 44.5013, lon: -88.0622 }, 'Houston Texans': { lat: 29.6847, lon: -95.4109 }, 'Indianapolis Colts': { lat: 39.7601, lon: -86.1639 }, 'Jacksonville Jaguars': { lat: 30.3239, lon: -81.6375 }, 'Kansas City Chiefs': { lat: 39.0489, lon: -94.4839 }, 'Las Vegas Raiders': { lat: 36.0907, lon: -115.1838 }, 'Los Angeles Chargers': { lat: 33.9535, lon: -118.3392 }, 'Los Angeles Rams': { lat: 33.9535, lon: -118.3392 }, 'Miami Dolphins': { lat: 25.9580, lon: -80.2389 }, 'Minnesota Vikings': { lat: 44.9736, lon: -93.2579 }, 'New England Patriots': { lat: 42.0909, lon: -71.2643 }, 'New Orleans Saints': { lat: 29.9509, lon: -90.0821 }, 'New York Giants': { lat: 40.8136, lon: -74.0744 }, 'New York Jets': { lat: 40.8136, lon: -74.0744 }, 'Philadelphia Eagles': { lat: 39.9008, lon: -75.1675 }, 'Pittsburgh Steelers': { lat: 40.4467, lon: -80.0158 }, 'San Francisco 49ers': { lat: 37.4031, lon: -121.9697 }, 'Seattle Seahawks': { lat: 47.5952, lon: -122.3316 }, 'Tampa Bay Buccaneers': { lat: 27.9759, lon: -82.5033 }, 'Tennessee Titans': { lat: 36.1665, lon: -86.7713 }, 'Washington Commanders': { lat: 38.9077, lon: -76.8645 },
    // NHL
    'Anaheim Ducks': { lat: 33.8078, lon: -117.8766 }, 'Arizona Coyotes': { lat: 33.5319, lon: -112.2611 }, 'Boston Bruins': { lat: 42.3662, lon: -71.0621 }, 'Buffalo Sabres': { lat: 42.8751, lon: -78.8765 }, 'Calgary Flames': { lat: 51.0375, lon: -114.0519 }, 'Carolina Hurricanes': { lat: 35.8033, lon: -78.7219 }, 'Chicago Blackhawks': { lat: 41.8807, lon: -87.6742 }, 'Colorado Avalanche': { lat: 39.7486, lon: -105.0076 }, 'Columbus Blue Jackets': { lat: 39.9695, lon: -83.0060 }, 'Dallas Stars': { lat: 29.4270, lon: -98.4385 }, 'Detroit Red Wings': { lat: 42.3411, lon: -83.0553 }, 'Edmonton Oilers': { lat: 53.5469, lon: -113.4973 }, 'Florida Panthers': { lat: 26.1585, lon: -80.3255 }, 'Los Angeles Kings': { lat: 34.0430, lon: -118.2673 }, 'Minnesota Wild': { lat: 44.9447, lon: -93.1008 }, 'Montreal Canadiens': { lat: 45.4965, lon: -73.5694 }, 'Nashville Predators': { lat: 36.1593, lon: -86.7785 }, 'New Jersey Devils': { lat: 40.7336, lon: -74.1711 }, 'New York Islanders': { lat: 40.7230, lon: -73.5925 }, 'New York Rangers': { lat: 40.7505, lon: -73.9934 }, 'Ottawa Senators': { lat: 45.2969, lon: -75.9281 }, 'Philadelphia Flyers': { lat: 39.9012, lon: -75.1720 }, 'Pittsburgh Penguins': { lat: 40.4395, lon: -79.9896 }, 'San Jose Sharks': { lat: 37.3328, lon: -121.9012 }, 'Seattle Kraken': { lat: 47.6221, lon: -122.3539 }, 'St. Louis Blues': { lat: 38.6268, lon: -90.2027 }, 'Tampa Bay Lightning': { lat: 27.9427, lon: -82.4518 }, 'Toronto Maple Leafs': { lat: 43.6435, lon: -79.3791 }, 'Vancouver Canucks': { lat: 49.2778, lon: -123.1089 }, 'Vegas Golden Knights': { lat: 36.0967, lon: -115.1783 }, 'Washington Capitals': { lat: 38.8982, lon: -77.0209 }, 'Winnipeg Jets': { lat: 49.8927, lon: -97.1435 }
};

const teamAliasMap = {
    // MLB
    'Arizona Diamondbacks': ['D-backs', 'Diamondbacks'], 'Atlanta Braves': ['Braves'], 'Baltimore Orioles': ['Orioles'], 'Boston Red Sox': ['Red Sox'], 'Chicago Cubs': ['Cubs'], 'Chicago White Sox': ['White Sox', 'ChiSox'], 'Cincinnati Reds': ['Reds'], 'Cleveland Guardians': ['Guardians'], 'Colorado Rockies': ['Rockies'], 'Detroit Tigers': ['Tigers'], 'Houston Astros': ['Astros'], 'Kansas City Royals': ['Royals'], 'Los Angeles Angels': ['Angels'], 'Los Angeles Dodgers': ['Dodgers'], 'Miami Marlins': ['Marlins'], 'Milwaukee Brewers': ['Brewers'], 'Minnesota Twins': ['Twins'], 'New York Mets': ['Mets'], 'New York Yankees': ['Yankees'], 'Oakland Athletics': ["A's", 'Athletics', "Oakland A's"], 'Philadelphia Phillies': ['Phillies'], 'Pittsburgh Pirates': ['Pirates'], 'San Diego Padres': ['Padres', 'Friars'], 'San Francisco Giants': ['Giants'], 'Seattle Mariners': ['Mariners', "M's"], 'St. Louis Cardinals': ['Cardinals', 'Cards', 'St Louis Cardinals'], 'Tampa Bay Rays': ['Rays'], 'Texas Rangers': ['Rangers'], 'Toronto Blue Jays': ['Blue Jays', 'Jays'], 'Washington Nationals': ['Nationals'],
    // NFL
    'Arizona Cardinals': ['Cardinals'], 'Atlanta Falcons': ['Falcons'], 'Baltimore Ravens': ['Ravens'], 'Buffalo Bills': ['Bills'], 'Carolina Panthers': ['Panthers'], 'Chicago Bears': ['Bears'], 'Cincinnati Bengals': ['Bengals'], 'Cleveland Browns': ['Browns'], 'Dallas Cowboys': ['Cowboys'], 'Denver Broncos': ['Broncos'], 'Detroit Lions': ['Lions'], 'Green Bay Packers': ['Packers'], 'Houston Texans': ['Texans'], 'Indianapolis Colts': ['Colts'], 'Jacksonville Jaguars': ['Jaguars'], 'Kansas City Chiefs': ['Chiefs'], 'Las Vegas Raiders': ['Raiders'], 'Los Angeles Chargers': ['Chargers'], 'Los Angeles Rams': ['Rams'], 'Miami Dolphins': ['Dolphins'], 'Minnesota Vikings': ['Vikings'], 'New England Patriots': ['Patriots'], 'New Orleans Saints': ['Saints'], 'New York Giants': ['Giants'], 'New York Jets': ['Jets'], 'Philadelphia Eagles': ['Eagles'], 'Pittsburgh Steelers': ['Steelers'], 'San Francisco 49ers': ['49ers'], 'Seattle Seahawks': ['Seahawks'], 'Tampa Bay Buccaneers': ['Buccaneers'], 'Tennessee Titans': ['Titans'], 'Washington Commanders': ['Commanders', 'Football Team'],
    // NHL
    'Anaheim Ducks': ['Ducks'], 'Arizona Coyotes': ['Coyotes'], 'Boston Bruins': ['Bruins'], 'Buffalo Sabres': ['Sabres'], 'Calgary Flames': ['Flames'], 'Carolina Hurricanes': ['Hurricanes'], 'Chicago Blackhawks': ['Blackhawks'], 'Colorado Avalanche': ['Avalanche'], 'Columbus Blue Jackets': ['Blue Jackets'], 'Dallas Stars': ['Stars'], 'Detroit Red Wings': ['Red Wings'], 'Edmonton Oilers': ['Oilers'], 'Florida Panthers': ['Panthers'], 'Los Angeles Kings': ['Kings'], 'Minnesota Wild': ['Wild'], 'Montreal Canadiens': ['Canadiens', 'Habs'], 'Nashville Predators': ['Predators'], 'New Jersey Devils': ['Devils'], 'New York Islanders': ['Islanders'], 'New York Rangers': ['Rangers'], 'Ottawa Senators': ['Senators'], 'Philadelphia Flyers': ['Flyers'], 'Pittsburgh Penguins': ['Penguins'], 'San Jose Sharks': ['Sharks'], 'Seattle Kraken': ['Kraken'], 'St. Louis Blues': ['Blues'], 'Tampa Bay Lightning': ['Lightning'], 'Toronto Maple Leafs': ['Maple Leafs', 'Leafs'], 'Vancouver Canucks': ['Canucks'], 'Vegas Golden Knights': ['Golden Knights'], 'Washington Capitals': ['Capitals'], 'Winnipeg Jets': ['Jets']
};

const canonicalTeamNameMap = {};
Object.keys(teamAliasMap).forEach(canonicalName => {
    const lowerCanonical = canonicalName.toLowerCase();
    if (!canonicalTeamNameMap[lowerCanonical]) canonicalTeamNameMap[lowerCanonical] = canonicalName;
    teamAliasMap[canonicalName].forEach(alias => {
        const lowerAlias = alias.toLowerCase();
        if (!canonicalTeamNameMap[lowerAlias]) canonicalTeamNameMap[lowerAlias] = canonicalName;
    });
});
Object.keys(teamLocationMap).forEach(canonicalName => {
    const lowerCanonical = canonicalName.toLowerCase();
    if (!canonicalTeamNameMap[lowerCanonical]) canonicalTeamNameMap[lowerCanonical] = canonicalName;
});


const flairMap = {
    'baseball_mlb': 'MLB Bets and Picks',
    'icehockey_nhl': 'NHL Bets and Picks',
    'americanfootball_nfl': 'NFL Bets and Picks'
};
const espnTeamAbbreviations = {
    'Arizona Diamondbacks': 'ARI', 'Atlanta Braves': 'ATL', 'Baltimore Orioles': 'BAL', 'Boston Red Sox': 'BOS', 'Chicago Cubs': 'CHC', 'Chicago White Sox': 'CHW', 'Cincinnati Reds': 'CIN', 'Cleveland Guardians': 'CLE', 'Colorado Rockies': 'COL', 'Detroit Tigers': 'DET', 'Houston Astros': 'HOU', 'Kansas City Royals': 'KC', 'Los Angeles Angels': 'LAA', 'Los Angeles Dodgers': 'LAD', 'Miami Marlins': 'MIA', 'Milwaukee Brewers': 'MIL', 'Minnesota Twins': 'MIN', 'New York Mets': 'NYM', 'New York Yankees': 'NYY', 'Oakland Athletics': 'OAK', 'Philadelphia Phillies': 'PHI', 'Pittsburgh Pirates': 'PIT', 'San Diego Padres': 'SD', 'San Francisco Giants': 'SF', 'Seattle Mariners': 'SEA', 'St. Louis Cardinals': 'STL', 'Tampa Bay Rays': 'TB', 'Texas Rangers': 'TEX', 'Toronto Blue Jays': 'TOR', 'Washington Nationals': 'WSH',
    'Arizona Cardinals': 'ARI', 'Atlanta Falcons': 'ATL', 'Baltimore Ravens': 'BAL', 'Buffalo Bills': 'BUF', 'Carolina Panthers': 'CAR', 'Chicago Bears': 'CHI', 'Cincinnati Bengals': 'CIN', 'Cleveland Browns': 'CLE', 'Dallas Cowboys': 'DAL', 'Denver Broncos': 'DEN', 'Detroit Lions': 'DET', 'Green Bay Packers': 'GB', 'Houston Texans': 'HOU', 'Indianapolis Colts': 'IND', 'Jacksonville Jaguars': 'JAX', 'Kansas City Chiefs': 'KC', 'Las Vegas Raiders': 'LV', 'Los Angeles Chargers': 'LAC', 'Los Angeles Rams': 'LAR', 'Miami Dolphins': 'MIA', 'Minnesota Vikings': 'MIN', 'New England Patriots': 'NE', 'New Orleans Saints': 'NO', 'New York Giants': 'NYG', 'New York Jets': 'NYJ', 'Philadelphia Eagles': 'PHI', 'Pittsburgh Steelers': 'PIT', 'San Francisco 49ers': 'SF', 'Seattle Seahawks': 'SEA', 'Tampa Bay Buccaneers': 'TB', 'Tennessee Titans': 'TEN', 'Washington Commanders': 'WSH'
};
const FUTURES_PICKS_DB = {
    'baseball_mlb': { championship: 'Los Angeles Dodgers', hotPick: 'Houston Astros' },
    'icehockey_nhl': { championship: 'Colorado Avalanche', hotPick: 'New York Rangers' },
    'americanfootball_nfl': { championship: 'Kansas City Chiefs', hotPick: 'Detroit Lions' }
};
const dataCache = new Map();

// --- HELPER FUNCTIONS ---
const parseRecord = (rec) => {
    if (!rec || typeof rec !== 'string') return { w: 0, l: 0 };
    const parts = rec.split('-');
    if (parts.length < 2) return { w: 0, l: 0 };
    const wins = parseInt(parts[0], 10);
    const losses = parseInt(parts[1], 10);
    if (isNaN(wins) || isNaN(losses)) return { w: 0, l: 0 };
    return { w: wins, l: losses };
};
const getWinPct = (rec) => (rec.w + rec.l) > 0 ? rec.w / (rec.w + rec.l) : 0;

// --- DYNAMIC WEIGHTS ---
function getDynamicWeights(sportKey) {
    if (sportKey === 'baseball_mlb') return { record: 6, fatigue: 8, momentum: 3, matchup: 12, value: 5, newsSentiment: 10, injuryImpact: 12, offensiveForm: 8, defensiveForm: 8, h2h: 12, weather: 8 };
    return { record: 8, fatigue: 7, momentum: 5, matchup: 10, value: 5, newsSentiment: 10, injuryImpact: 12, offensiveForm: 9, defensiveForm: 9, h2h: 11, weather: 5 };
}

// --- DATA FETCHING MODULES ---
async function fetchData(key, fetcherFn, ttl = 3600000) {
    if (dataCache.has(key) && (Date.now() - dataCache.get(key).timestamp < ttl)) {
        return dataCache.get(key).data;
    }
    const data = await fetcherFn();
    dataCache.set(key, { data, timestamp: Date.now() });
    return data;
}

async function getOdds(sportKey) {
    const key = `odds_${sportKey}_final_window_fix`; // New key to bust the cache
    return fetchData(key, async () => {
        try {
            const allGames = [];
            const gameIds = new Set();
            const datesToFetch = [];

            // --- DEFINITIVE FIX: Fetch a window of -1 to +2 days from the server's UTC date ---
            // This captures all relevant games regardless of user's timezone.
            const today = new Date();
            for (let i = -1; i < 3; i++) { // EXPANDED DATE WINDOW
                const targetDate = new Date(today);
                targetDate.setUTCDate(today.getUTCDate() + i);
                datesToFetch.push(targetDate.toISOString().split('T')[0]);
            }

            const requests = datesToFetch.map(date =>
                axios.get(`https://api.the-odds-api.com/v4/sports/${sportKey}/odds/?regions=us&markets=h2h&oddsFormat=decimal&date=${date}&apiKey=${ODDS_API_KEY}`)
            );

            const responses = await Promise.all(requests);

            for (const response of responses) {
                for (const game of response.data) {
                    if (!gameIds.has(game.id)) {
                        allGames.push(game);
                        gameIds.add(game.id);
                    }
                }
            }

            return allGames;
        } catch (error) {
            console.error("ERROR IN getOdds function:", error.message);
            return [];
        }
    }, 900000); // Cache for 15 minutes
}

// --- NEW, RELIABLE STATS API FUNCTION FOR MLB ---
async function getTeamStatsFromAPI(sportKey) {
    return fetchData(`stats_api_${sportKey}_v3`, async () => {
        // This new function only supports MLB for now.
        if (sportKey !== 'baseball_mlb') {
            return {};
        }

        const currentYear = new Date().getFullYear();
        const stats = {};

        try {
            // Step 1: Initialize all MLB teams from a reliable source and get standings
            const standingsUrl = `https://statsapi.mlb.com/api/v1/standings?leagueId=103,104&season=${currentYear}`;
            const { data: standingsData } = await axios.get(standingsUrl);
            if (standingsData.records) {
                for (const record of standingsData.records) {
                    for (const teamRecord of record.teamRecords) {
                        const teamName = teamRecord.team.name;
                        const lastTenRecord = teamRecord.records.splitRecords.find(r => r.type === 'lastTen');

                        stats[teamName] = {
                            record: `${teamRecord.wins}-${teamRecord.losses}`,
                            streak: teamRecord.streak?.streakCode || 'N/A',
                            lastTen: lastTenRecord ? `${lastTenRecord.wins}-${lastTenRecord.losses}` : '0-0',
                            runsPerGame: 0, // Default value
                            teamERA: 99.99   // Default value
                        };
                    }
                }
            }

            // Step 2: Get Detailed League-Wide Hitting and Pitching Stats
            const leagueStatsUrl = `https://statsapi.mlb.com/api/v1/stats?stats=season&group=hitting,pitching&season=${currentYear}&sportId=1`;
            const { data: leagueStatsData } = await axios.get(leagueStatsUrl);

            if (leagueStatsData.stats) {
                leagueStatsData.stats.forEach(statGroup => {
                    statGroup.splits.forEach(split => {
                        const teamName = split.team.name;
                        if (stats[teamName]) {
                            if (statGroup.group.displayName === 'hitting') {
                                const runs = split.stat.runs;
                                const games = split.stat.gamesPlayed;
                                if (games > 0) {
                                    stats[teamName].runsPerGame = parseFloat((runs / games).toFixed(2));
                                }
                            } else if (statGroup.group.displayName === 'pitching') {
                                stats[teamName].teamERA = parseFloat(split.stat.era);
                            }
                        }
                    });
                });
            }

            return stats;

        } catch (e) {
            console.error(`Could not fetch stats from MLB-StatsAPI for ${sportKey}: ${e.message}`);
            return stats; // Return whatever was successfully fetched
        }
    }, 3600000); // Cache for 1 hour
}

async function getWeatherData(teamName) {
    if (!teamName) {
        return null;
    }
    const canonicalName = canonicalTeamNameMap[teamName.toLowerCase()] || teamName;
    const location = teamLocationMap[canonicalName];

    if (!location) {
        return null;
    }

    return fetchData(`weather_${location.lat}_${location.lon}`, async () => {
        try {
            const url = `https://api.open-meteo.com/v1/forecast?latitude=${location.lat}&longitude=${location.lon}&current=temperature_2m,precipitation,wind_speed_10m&wind_speed_unit=kmh`;
            const { data } = await axios.get(url);
            return { temp: data.current.temperature_2m, wind: data.current.wind_speed_10m, precip: data.current.precipitation };
        } catch (e) {
            console.error(`Could not fetch weather for ${teamName}: ${e.message}`);
            return null;
        }
    });
}

async function fetchEspnData(sportKey) {
    return fetchData(`espn_scoreboard_${sportKey}`, async () => {
        const map = { 'baseball_mlb': { sport: 'baseball', league: 'mlb' }, 'icehockey_nhl': { sport: 'hockey', league: 'nhl' }, 'americanfootball_nfl': { sport: 'football', league: 'nfl' } }[sportKey];
        if (!map) return null;
        try {
            const url = `https://site.api.espn.com/apis/site/v2/sports/${map.sport}/${map.league}/scoreboard`;
            const { data } = await axios.get(url);
            return data;
        } catch (error) {
            console.error(`Could not fetch ESPN scoreboard for ${sportKey}. Error:`, error.message);
            return null;
        }
    }, 60000);
}

async function getRedditSentiment(homeTeam, awayTeam, homeStats, awayStats, sportKey) {
    const key = `reddit_${[homeTeam, awayTeam].sort().join('_')}_${sportKey}`;
    return fetchData(key, async () => {
        try {
            const createSearchQuery = (teamName) => `(${ (teamAliasMap[teamName] || [teamName.split(' ').pop()]).map(a => `"${a}"`).join(' OR ')})`;
            const baseQuery = `${createSearchQuery(homeTeam)} OR ${createSearchQuery(awayTeam)}`;
            const flair = flairMap[sportKey];
            let results = await r.getSubreddit('sportsbook').search({ query: `flair:"${flair}" ${baseQuery}`, sort: 'new', time: 'month' });
            if (results.length === 0) {
                results = await r.getSubreddit('sportsbook').search({ query: baseQuery, sort: 'new', time: 'month' });
            }
            if (results.length === 0) {
                return { home: 1 + (getWinPct(parseRecord(homeStats.record)) * 9), away: 1 + (getWinPct(parseRecord(awayStats.record)) * 9) };
            }
            let homeScore = 0, awayScore = 0;
            const homeAliases = [homeTeam, ...(teamAliasMap[homeTeam] || [])].map(a => a.toLowerCase());
            const awayAliases = [awayTeam, ...(teamAliasMap[awayTeam] || [])].map(a => a.toLowerCase());
            results.forEach(post => {
                const title = post.title.toLowerCase();
                if (homeAliases.some(alias => title.includes(alias))) homeScore++;
                if (awayAliases.some(alias => title.includes(alias))) awayScore++;
            });
            const totalScore = homeScore + awayScore;
            if (totalScore === 0) {
                 return { home: 1 + (getWinPct(parseRecord(homeStats.record)) * 9), away: 1 + (getWinPct(parseRecord(awayStats.record)) * 9) };
            }
            return { home: 1 + (homeScore / totalScore) * 9, away: 1 + (awayScore / totalScore) * 9 };
        } catch (e) {
            console.error(`Reddit API error for ${awayTeam} @ ${homeTeam}:`, e.message);
            return { home: 5, away: 5 };
        }
    }, 1800000);
}

// --- NEW WEB SCRAPING FUNCTION ---
async function scrapeFanGraphsHittingStats() {
    // We will cache these results for 6 hours (21600000 ms) to avoid scraping too often.
    return fetchData('fangraphs_hitting_v1', async () => {
        try {
            console.log("Scraping FanGraphs for new hitting stats...");
            const currentYear = new Date().getFullYear();
            const url = `https://www.fangraphs.com/leaders.aspx?pos=all&stats=bat&lg=all&qual=0&type=8&season=${currentYear}&month=0&season1=${currentYear}&ind=0&team=0,ts&rost=0&age=0&filter=&players=0&startdate=&enddate=`;

            // 1. Fetch the HTML from the FanGraphs leaderboard page
            const response = await axios.get(url);
            const html = response.data;

            // 2. Load the HTML into cheerio to parse it
            const $ = cheerio.load(html);

            const hittingStats = {};
            // 3. Select the main data table and loop through each row
            // The selector targets the specific table grid on the FanGraphs page
            $('.rgMasterTable > tbody > tr').each((index, element) => {
                const columns = $(element).find('td');

                // 4. Extract the raw text from the columns we need
                const teamNameRaw = $(columns[1]).text().trim(); // Team Name is in the 2nd column
                const wrcPlusRaw = $(columns[8]).text().trim();  // wRC+ is in the 9th column

                // 5. Clean up the data
                const wrcPlus = parseInt(wrcPlusRaw, 10);
                // Use our existing map to standardize the team name
                const canonicalName = canonicalTeamNameMap[teamNameRaw.toLowerCase()];
                
                if (canonicalName && !isNaN(wrcPlus)) {
                    // 6. Store the cleaned data
                    hittingStats[canonicalName] = { wrcPlus };
                }
            });

            console.log(`Successfully scraped ${Object.keys(hittingStats).length} teams.`);
            return hittingStats;

        } catch (error) {
            console.error("Error scraping FanGraphs:", error.message);
            return {}; // Return an empty object on failure
        }
    }, 21600000);
}

async function runPredictionEngine(game, sportKey, context) {
    const { teamStats, weather, injuries, h2h, homeRoster, awayRoster } = context;
    const weights = getDynamicWeights(sportKey);
    const { home_team, away_team } = game;

    const homeCanonicalName = canonicalTeamNameMap[home_team.toLowerCase()] || home_team;
    const awayCanonicalName = canonicalTeamNameMap[away_team.toLowerCase()] || away_team;

    const homeStats = teamStats[homeCanonicalName] || { record: 'N/A', streak: 'N/A', lastTen: 'N/A', runsPerGame: 0, teamERA: 99 };
    const awayStats = teamStats[awayCanonicalName] || { record: 'N/A', streak: 'N/A', lastTen: 'N/A', runsPerGame: 0, teamERA: 99 };

    const redditSentiment = await getRedditSentiment(home_team, away_team, homeStats, awayStats, sportKey);
    let homeScore = 50, awayScore = 50;
    const factors = {};

    let homeInjuryImpact = 0;
    const homeInjuries = injuries[homeCanonicalName] || [];
    homeInjuries.forEach(player => {
        homeInjuryImpact += 1;
    });

    let awayInjuryImpact = 0;
    const awayInjuries = injuries[awayCanonicalName] || [];
    awayInjuries.forEach(player => {
        awayInjuryImpact += 1;
    });

    factors['Record'] = { value: (getWinPct(parseRecord(homeStats.record)) - getWinPct(parseRecord(awayStats.record))) * weights.record, homeStat: homeStats.record, awayStat: awayStats.record };
    factors['Recent Form (L10)'] = { value: (getWinPct(parseRecord(homeStats.lastTen)) - getWinPct(parseRecord(awayStats.lastTen))) * weights.momentum, homeStat: homeStats.lastTen, awayStat: awayStats.lastTen };
    factors['H2H (Season)'] = { value: (getWinPct(parseRecord(h2h.home)) - getWinPct(parseRecord(h2h.away))) * weights.h2h, homeStat: h2h.home, awayStat: h2h.away };

    if (sportKey === 'baseball_mlb') {
        // UPGRADED: Using wRC+ from scraped data
        const homeHitting = context.hittingStats[homeCanonicalName] || { wrcPlus: 100 }; // Default to average (100) if missing
        const awayHitting = context.hittingStats[awayCanonicalName] || { wrcPlus: 100 };
        factors['Offensive Rating'] = { 
            value: (homeHitting.wrcPlus - awayHitting.wrcPlus) * 0.5, // Adjust weight as needed
            homeStat: `${homeHitting.wrcPlus} wRC+`, 
            awayStat: `${awayHitting.wrcPlus} wRC+` 
        };
        
        // UPGRADED: Only calculate Defensive Rating if BOTH teams have valid ERA data
        if (homeStats.teamERA < 99 && awayStats.teamERA < 99) {
            factors['Defensive Rating'] = { value: (awayStats.teamERA - homeStats.teamERA) * (weights.defensiveForm || 5), homeStat: `${(homeStats.teamERA).toFixed(2)} ERA`, awayStat: `${(awayStats.teamERA).toFixed(2)} ERA` };
        }
    }

    factors['Social Sentiment'] = { value: (redditSentiment.home - redditSentiment.away) * weights.newsSentiment, homeStat: `${redditSentiment.home.toFixed(1)}/10`, awayStat: `${redditSentiment.away.toFixed(1)}/10` };
    const injuryValue = (awayInjuryImpact - homeInjuryImpact) * (weights.injuryImpact / 5);
    factors['Injury Impact'] = { value: injuryValue, homeStat: `${homeInjuries.length} players`, awayStat: `${awayInjuries.length} players`, injuries: { home: homeInjuries, away: awayInjuries } };

    for (const factor in factors) {
        if (factors[factor].value && !isNaN(factors[factor].value)) {
            homeScore += factors[factor].value;
            awayScore -= factors[factor].value;
        }
    }

    const homeOdds = game.bookmakers?.[0]?.markets?.find(m => m.key === 'h2h')?.outcomes?.find(o => o.name === home_team)?.price;
    const awayOdds = game.bookmakers?.[0]?.markets?.find(m => m.key === 'h2h')?.outcomes?.find(o => o.name === away_team)?.price;
    let homeValue = 'N/A', awayValue = 'N/A';
    if (homeOdds && awayOdds) {
        const homeImpliedProb = (1 / homeOdds) * 100;
        const homePower = (homeScore / (homeScore + awayScore)) * 100;
        homeValue = homePower - homeImpliedProb;
        awayValue = ((100-homePower) - (1/awayOdds) * 100);
        factors['Betting Value'] = { value: homeValue * (weights.value / 5), homeStat: `${homeValue.toFixed(1)}%`, awayStat: `${awayValue.toFixed(1)}%` };
        if (!isNaN(factors['Betting Value'].value)) {
            homeScore += factors['Betting Value'].value;
        }
    } else {
         factors['Betting Value'] = { value: 0, homeStat: `N/A`, awayStat: `N/A` };
    }
    const winner = homeScore > awayScore ? home_team : away_team;
    const confidence = Math.abs(50 - (homeScore / (homeScore + awayScore)) * 100);
    let strengthText = confidence > 15 ? "Strong Advantage" : confidence > 7.5 ? "Good Chance" : "Slight Edge";
    return { winner, strengthText, confidence, factors, weather, homeValue, awayValue };
}

async function getAllDailyPredictions() {
    const allPredictions = [];
    const gameCounts = {};

    for (const sport of SPORTS_DB) {
        const sportKey = sport.key;
        const [games, espnDataResponse, teamStats, hittingStats] = await Promise.all([
            getOdds(sportKey),
            fetchEspnData(sportKey),
            getTeamStatsFromAPI(sportKey),
            scrapeFanGraphsHittingStats() // Added scraping here
        ]);

        gameCounts[sportKey] = games.length;
        if (!games || games.length === 0) continue;

        const injuries = {};
        const h2hRecords = {};
        if (espnDataResponse?.events) {
            for (const event of espnDataResponse.events) {
                const competition = event.competitions?.[0];
                if (!competition) continue;
                for (const competitor of competition.competitors) {
                    const canonicalName = canonicalTeamNameMap[competitor.team.displayName.toLowerCase()] || competitor.team.displayName;
                    const fullInjuries = (competitor.injuries || []).map(inj => ({ name: inj.athlete.displayName, status: inj.status.name }));
                    injuries[canonicalName] = fullInjuries;
                }
                const homeTeam = competition.competitors.find(c => c.homeAway === 'home');
                const awayTeam = competition.competitors.find(c => c.homeAway === 'away');
                if (competition.series && homeTeam && awayTeam) {
                    const gameId = `${awayTeam.team.displayName}@${homeTeam.team.displayName}`;
                    const homeWins = competition.series.competitors.find(c => c.id === homeTeam.id)?.wins || 0;
                    const awayWins = competition.series.competitors.find(c => c.id === awayTeam.id)?.wins || 0;
                    h2hRecords[gameId] = { home: `${homeWins}-${awayWins}`, away: `${awayWins}-${homeWins}` };
                }
            }
        }

        for (const game of games) {
            const gameHomeCanonical = canonicalTeamNameMap[game.home_team.toLowerCase()] || game.home_team;
            const gameAwayCanonical = canonicalTeamNameMap[game.away_team.toLowerCase()] || game.away_team;

            const espnEvent = espnDataResponse?.events?.find(e => {
                const oddsApiGameDate = new Date(game.commence_time);
                const espnEventDate = new Date(e.date);

                const isSameDay = oddsApiGameDate.getFullYear() === espnEventDate.getFullYear() &&
                                  oddsApiGameDate.getMonth() === espnEventDate.getMonth() &&
                                  oddsApiGameDate.getDate() === espnEventDate.getDate();

                if (!isSameDay) return false;

                const competitors = e.competitions?.[0]?.competitors;
                if (!competitors || competitors.length < 2) return false;

                const eventHomeCompetitor = competitors.find(c => c.homeAway === 'home');
                const eventAwayCompetitor = competitors.find(c => c.homeAway === 'away');
                if (!eventHomeCompetitor || !eventAwayCompetitor) return false;

                const eventHomeCanonical = canonicalTeamNameMap[eventHomeCompetitor.team.displayName.toLowerCase()];
                const eventAwayCanonical = canonicalTeamNameMap[eventAwayCompetitor.team.displayName.toLowerCase()];

                return (eventHomeCanonical === gameHomeCanonical && eventAwayCanonical === gameAwayCanonical);
            });

            const weather = await getWeatherData(game.home_team);
            const gameId = `${game.away_team}@${game.home_team}`;
            const h2h = h2hRecords[gameId] || { home: '0-0', away: '0-0' };
            const homeRoster = {}, awayRoster = {};
            const context = { teamStats, weather, injuries, h2h, homeRoster, awayRoster, hittingStats }; // Added hittingStats
            const predictionData = await runPredictionEngine(game, sportKey, context);

            if (predictionData && predictionData.winner) {
                if (predictionsCollection) {
                    try {
                        const winnerOdds = game.bookmakers?.[0]?.markets?.find(m => m.key === 'h2h')?.outcomes?.find(o => o.name === predictionData.winner)?.price;

                        const updateOperations = {
                            $setOnInsert: {
                                gameId: game.id,
                                sportKey: sportKey,
                                homeTeam: game.home_team,
                                awayTeam: game.away_team,
                                gameDate: game.commence_time,
                                odds: winnerOdds || null,
                                status: 'pending',
                                createdAt: new Date()
                            },
                            $set: {
                                predictedWinner: predictionData.winner,
                            }
                        };

                        await predictionsCollection.updateOne(
                            { gameId: game.id },
                            updateOperations,
                            { upsert: true }
                        );

                    } catch (dbError) {
                        console.error("Failed to save prediction from getAllDailyPredictions to DB:", dbError);
                    }
                }

                allPredictions.push({
                    game: { ...game, espnData: espnEvent || null, sportKey: sportKey },
                    prediction: predictionData
                });
            }
        }
    }
    return { allPredictions, gameCounts };
}

// --- API ENDPOINTS ---

app.get('/api/predictions', async (req, res) => {
    const { sport } = req.query;
    if (!sport) return res.status(400).json({ error: "Sport parameter is required." });
    try {
        const [games, espnDataResponse, teamStats, hittingStats] = await Promise.all([
            getOdds(sport),
            fetchEspnData(sport),
            getTeamStatsFromAPI(sport),
            scrapeFanGraphsHittingStats() // Added scraping here
        ]);
        if (!games || games.length === 0) { return res.json({ message: `No upcoming games for ${sport}. The season may be over.` }); }

        const injuries = {};
        const h2hRecords = {};
        if (espnDataResponse?.events) {
             for (const event of espnDataResponse.events) {
                const competition = event.competitions?.[0];
                if (!competition) continue;
                for (const competitor of competition.competitors) {
                    const canonicalName = canonicalTeamNameMap[competitor.team.displayName.toLowerCase()] || competitor.team.displayName;
                    const fullInjuries = (competitor.injuries || []).map(inj => ({ name: inj.athlete.displayName, status: inj.status.name }));
                    injuries[canonicalName] = fullInjuries;
                }
                const homeTeam = competition.competitors.find(c => c.homeAway === 'home');
                const awayTeam = competition.competitors.find(c => c.homeAway === 'away');
                if (competition.series && homeTeam && awayTeam) {
                    const gameId = `${awayTeam.team.displayName}@${homeTeam.team.displayName}`;
                    const homeWins = competition.series.competitors.find(c => c.id === homeTeam.id)?.wins || 0;
                    const awayWins = competition.series.competitors.find(c => c.id === awayTeam.id)?.wins || 0;
                    h2hRecords[gameId] = { home: `${homeWins}-${awayWins}`, away: `${awayWins}-${homeWins}` };
                }
            }
        }

        const predictions = [];
        for (const game of games) {
            const homeRoster = {}, awayRoster = {};
            const weather = await getWeatherData(game.home_team);
            const gameId = `${game.away_team}@${game.home_team}`;
            const h2h = h2hRecords[gameId] || { home: '0-0', away: '0-0' };
            const context = { teamStats, weather, injuries, h2h, homeRoster, awayRoster, hittingStats }; // Added hittingStats
            const predictionData = await runPredictionEngine(game, sport, context);

            if (predictionData && predictionData.winner && predictionsCollection) {
                try {
                    const winnerOdds = game.bookmakers?.[0]?.markets?.find(m => m.key === 'h2h')?.outcomes?.find(o => o.name === predictionData.winner)?.price;
                    const updateOperations = {
                        $setOnInsert: {
                            gameId: game.id,
                            sportKey: sport,
                            homeTeam: game.home_team,
                            awayTeam: game.away_team,
                            gameDate: game.commence_time,
                            odds: winnerOdds || null,
                            status: 'pending',
                            createdAt: new Date()
                        },
                        $set: {
                            predictedWinner: predictionData.winner,
                        }
                    };
                    await predictionsCollection.updateOne({ gameId: game.id }, updateOperations, { upsert: true });
                } catch (dbError) {
                    console.error("Failed to save prediction to DB:", dbError);
                }
            }

            const gameHomeCanonical = canonicalTeamNameMap[game.home_team.toLowerCase()] || game.home_team;
            const gameAwayCanonical = canonicalTeamNameMap[game.away_team.toLowerCase()] || game.away_team;

            const espnEvent = espnDataResponse?.events?.find(e => {
                const oddsApiGameDate = new Date(game.commence_time);
                const espnEventDate = new Date(e.date);

                const isSameDay = oddsApiGameDate.getFullYear() === espnEventDate.getFullYear() &&
                                  oddsApiGameDate.getMonth() === espnEventDate.getMonth() &&
                                  oddsApiGameDate.getDate() === espnEventDate.getDate();

                if (!isSameDay) return false;

                const competitors = e.competitions?.[0]?.competitors;
                if (!competitors || competitors.length < 2) return false;

                const eventHomeCompetitor = competitors.find(c => c.homeAway === 'home');
                const eventAwayCompetitor = competitors.find(c => c.homeAway === 'away');

                if (!eventHomeCompetitor || !eventAwayCompetitor) return false;

                const eventHomeCanonical = canonicalTeamNameMap[eventHomeCompetitor.team.displayName.toLowerCase()];
                const eventAwayCanonical = canonicalTeamNameMap[eventAwayCompetitor.team.displayName.toLowerCase()];

                return (eventHomeCanonical === gameHomeCanonical && eventAwayCanonical === gameAwayCanonical);
            });

            predictions.push({ game: { ...game, espnData: espnEvent || null }, prediction: predictionData });
        }
        res.json(predictions.filter(p => p && p.prediction));
    } catch (error) {
        console.error("Prediction Error:", error);
        res.status(500).json({ error: "Failed to process predictions.", details: error.message });
    }
});

app.get('/api/special-picks', async (req, res) => {
    try {
        const { allPredictions, gameCounts } = await getAllDailyPredictions();

        let sportsInSeason = 0;
        for(const sport of SPORTS_DB) {
            if(gameCounts[sport.key] >= sport.gameCountThreshold) {
                sportsInSeason++;
            }
        }
        const isPeakSeason = sportsInSeason >= 2;

        const potdConfidenceThreshold = isPeakSeason ? 15 : 10;
        const potdValueThreshold = isPeakSeason ? 5 : 2.5;
        const parlayConfidenceThreshold = 7.5;

        const now = new Date();
        const cutoff = new Date(now.getTime() + 24 * 60 * 60 * 1000);
        const upcomingTodayPredictions = allPredictions.filter(p => {
            const gameDate = new Date(p.game.commence_time);
            return gameDate > now && gameDate < cutoff;
        });

        let pickOfTheDay = null;
        let parlay = null;

        const highValuePicks = upcomingTodayPredictions.filter(p => {
            const value = p.prediction.winner === p.game.home_team ? p.prediction.homeValue : p.prediction.awayValue;
            return p.prediction.confidence > potdConfidenceThreshold && typeof value === 'number' && value > potdValueThreshold;
        });

        if (highValuePicks.length > 0) {
            pickOfTheDay = highValuePicks.reduce((best, current) => {
                const bestValue = best.prediction.winner === best.game.home_team ? best.prediction.homeValue : best.prediction.awayValue;
                const currentValue = current.prediction.winner === current.game.home_team ? current.prediction.homeValue : current.prediction.awayValue;
                const bestScore = best.prediction.confidence + bestValue;
                const currentScore = current.prediction.confidence + currentValue;
                return currentScore > bestScore ? current : best;
            });
        }

        const goodPicks = upcomingTodayPredictions.filter(p => p.prediction.confidence > parlayConfidenceThreshold)
            .sort((a, b) => (b.prediction.confidence + (b.prediction.winner === b.game.home_team ? b.prediction.homeValue : b.prediction.awayValue)) -
                             (a.prediction.confidence + (a.prediction.winner === a.game.home_team ? a.prediction.homeValue : a.prediction.awayValue)));

        if (goodPicks.length >= 2) {
            const leg1 = goodPicks[0];
            const leg2 = goodPicks[1];

            const odds1 = leg1.game.bookmakers?.[0]?.markets?.find(m=>m.key==='h2h')?.outcomes?.find(o=>o.name===leg1.prediction.winner)?.price || 0;
            const odds2 = leg2.game.bookmakers?.[0]?.markets?.find(m=>m.key==='h2h')?.outcomes?.find(o=>o.name===leg2.prediction.winner)?.price || 0;

            if (odds1 && odds2) {
                parlay = {
                    legs: [leg1, leg2],
                    totalOdds: (odds1 * odds2).toFixed(2)
                };
            }
        }

        res.json({ pickOfTheDay, parlay });
    } catch (error) {
        console.error("Special Picks Error:", error);
        res.status(500).json({ error: 'Failed to generate special picks.' });
    }
});


app.get('/api/records', async (req, res) => {
    try {
        if (!recordsCollection) { await connectToDb(); }
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

app.get('/api/reconcile-results', async (req, res) => {
    const { password } = req.query;
    if (password !== RECONCILE_PASSWORD) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    try {
        if (!predictionsCollection || !recordsCollection) await connectToDb();

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const pendingPredictions = await predictionsCollection.find({
            status: 'pending',
            gameDate: { $lt: today.toISOString() }
        }).toArray();

        if (pendingPredictions.length === 0) {
            return res.json({ message: "No pending predictions from previous days to reconcile." });
        }

        let reconciledCount = 0;
        const sportKeys = [...new Set(pendingPredictions.map(p => p.sportKey))];

        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const formattedDate = `${yesterday.getFullYear()}${(yesterday.getMonth() + 1).toString().padStart(2, '0')}${yesterday.getDate().toString().padStart(2, '0')}`;

        for (const sportKey of sportKeys) {
            const map = { 'baseball_mlb': { sport: 'baseball', league: 'mlb' }, 'icehockey_nhl': { sport: 'hockey', league: 'nhl' }, 'americanfootball_nfl': { sport: 'football', league: 'nfl' } }[sportKey];
            if (!map) continue;

            const url = `https://site.api.espn.com/apis/site/v2/sports/${map.sport}/${map.league}/scoreboard?dates=${formattedDate}`;
            const { data: espnData } = await axios.get(url);

            if (!espnData.events) continue;

            for (const prediction of pendingPredictions.filter(p => p.sportKey === sportKey)) {
                const gameEvent = espnData.events.find(e => {
                    const homeCanonical = canonicalTeamNameMap[prediction.homeTeam.toLowerCase()] || prediction.homeTeam;
                    const awayCanonical = canonicalTeamNameMap[prediction.awayTeam.toLowerCase()] || prediction.awayTeam;
                    const eventHome = e.competitions[0].competitors.find(c => c.homeAway === 'home');
                    const eventAway = e.competitions[0].competitors.find(c => c.homeAway === 'away');
                    if (!eventHome || !eventAway) return false;

                    const eventHomeCanonical = canonicalTeamNameMap[eventHome.team.displayName.toLowerCase()];
                    const eventAwayCanonical = canonicalTeamNameMap[eventAway.team.displayName.toLowerCase()];
                    return homeCanonical === eventHomeCanonical && awayCanonical === eventAwayCanonical;
                });

                if (gameEvent && gameEvent.status.type.completed) {
                    const competition = gameEvent.competitions[0];
                    const winnerData = competition.competitors.find(c => c.winner === true);
                    if (!winnerData) continue;

                    const actualWinner = canonicalTeamNameMap[winnerData.team.displayName.toLowerCase()];
                    const predictedWinnerCanonical = canonicalTeamNameMap[prediction.predictedWinner.toLowerCase()];

                    const result = actualWinner === predictedWinnerCanonical ? 'win' : 'loss';

                    let profit = 0;
                    if (result === 'win') {
                        profit = prediction.odds ? (10 * prediction.odds) - 10 : 9.10;
                    } else {
                        profit = -10;
                    }

                    await predictionsCollection.updateOne({ _id: prediction._id }, { $set: { status: result, profit: profit } });

                    const updateField = result === 'win'
                        ? { $inc: { wins: 1, totalProfit: profit } }
                        : { $inc: { losses: 1, totalProfit: profit } };

                    await recordsCollection.updateOne(
                        { sport: sportKey },
                        updateField,
                        { upsert: true }
                    );
                    reconciledCount++;
                }
            }
        }
        res.json({ message: `Reconciliation complete. Processed ${reconciledCount} predictions.` });
    } catch (error) {
        console.error("Reconciliation Error:", error);
        res.status(500).json({ error: "Failed to reconcile results.", details: error.message });
    }
});

app.get('/api/recent-bets', async (req, res) => {
    const { sport } = req.query;
    if (!sport) {
        return res.status(400).json({ error: "Sport parameter is required." });
    }

    try {
        if (!predictionsCollection) await connectToDb();

        const recentBets = await predictionsCollection.find({
            sportKey: sport,
            status: { $in: ['win', 'loss'] }
        })
        .sort({ gameDate: -1 })
        .limit(20)
        .toArray();

        for (const bet of recentBets) {
            if (bet.game && bet.game.espnData && bet.game.espnData.competitions) {
                const competition = bet.game.espnData.competitions[0];
                if (competition && competition.competitors) {
                    const winnerData = competition.competitors.find(c => c.winner === true);
                    if(winnerData && winnerData.team) {
                        bet.actualWinner = winnerData.team.displayName;
                    }
                }
            }
        }

        res.json(recentBets);
    } catch (error) {
        console.error("Recent Bets Error:", error);
        res.status(500).json({ error: "Failed to fetch recent bets." });
    }
});


app.get('/api/futures', (req, res) => res.json(FUTURES_PICKS_DB));

app.post('/api/ai-analysis', async (req, res) => {
    try {
        if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not set.");
        const { game, prediction } = req.body;
        const { home_team, away_team } = game;
        const { winner, factors } = prediction;
        const homeRecord = factors['Record']?.homeStat || 'N/A';
        const awayRecord = factors['Record']?.awayStat || 'N/A';
        const homeL10 = factors['Recent Form (L10)']?.homeStat || 'N/A';
        const awayL10 = factors['Recent Form (L10)']?.awayStat || 'N/A';
        const homeSentiment = factors['Social Sentiment']?.homeStat || 'N/A';
        const awaySentiment = factors['Social Sentiment']?.awayStat || 'N/A';

        const prompt = `
            Act as a professional sports betting analyst. Create a sophisticated HTML analysis for the following game.
            Use Tailwind CSS classes for styling. Use only the following tags: <div>, <h4>, <p>, <ul>, <li>, and <strong>.

            Game: ${away_team} (${awayRecord}, ${awayL10} L10) @ ${home_team} (${homeRecord}, ${homeL10} L10)
            Our Algorithm's Prediction: ${winner}

            Generate the following HTML structure:
            1. A <h4> with class "text-xl font-bold text-cyan-400 mb-2" titled "Key Narrative". Follow it with a <p> with class "text-gray-300 mb-4" summarizing the matchup.
            2. An <hr> with class "border-gray-700 my-4".
            3. A <h4> with class "text-xl font-bold text-indigo-400 mb-2" titled "Social Sentiment Analysis". Follow it with a <p> with class "text-gray-300 mb-4". In this paragraph, explain that this score (Home: ${homeSentiment}, Away: ${awaySentiment}) is derived from recent discussions on sports betting forums like Reddit's r/sportsbook. Briefly interpret the scores - for example, does the higher score suggest the public is heavily favoring that team, or are the scores close, indicating a divided opinion?
            4. An <hr> with class "border-gray-700 my-4".
            5. A <h4> with class "text-xl font-bold text-teal-400 mb-2" titled "Bull Case for ${winner}". Follow it with a <ul class="list-disc list-inside space-y-2 mb-4 text-gray-300"> with two or three <li> bullet points explaining why our prediction is solid. Make key stats bold with <strong>.
            6. An <hr> with class "border-gray-700 my-4".
            7. A <h4> with class "text-xl font-bold text-red-400 mb-2" titled "Bear Case for ${winner}". Follow it with a <ul class="list-disc list-inside space-y-2 mb-4 text-gray-300"> with two or three <li> bullet points explaining the risks. Make key stats bold with <strong>.
            8. An <hr> with class "border-gray-700 my-4".
            9. A <h4> with class "text-xl font-bold text-yellow-400 mb-2" titled "Final Verdict". Follow it with a single, confident <p> with class "text-gray-200" summarizing your recommendation.
        `;

        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" });
        const result = await model.generateContent(prompt);
        const response = await result.response;
        let analysisHtml = response.text().split('```html').join('').split('```').join('');
        res.json({ analysisHtml });
    } catch (error) {
        console.error("AI Analysis Error:", error);
        res.status(500).json({ error: "Failed to generate AI analysis." });
    }
});

app.post('/api/parlay-ai-analysis', async (req, res) => {
    try {
        if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not set.");
        const { parlay } = req.body;
        const leg1 = parlay.legs[0];
        const leg2 = parlay.legs[1];

        const prompt = `
            Act as a professional sports betting analyst. Create a sophisticated HTML analysis for the following 2-leg parlay.
            Use Tailwind CSS classes for styling. Use only the following tags: <div>, <h4>, <p>, <ul>, <li>, and <strong>.

            Parlay Details:
            - Leg 1: Pick ${leg1.prediction.winner} in the ${leg1.game.away_team} @ ${leg1.game.home_team} game.
            - Leg 2: Pick ${leg2.prediction.winner} in the ${leg2.game.away_team} @ ${leg2.game.home_team} game.
            - Total Odds: ${parlay.totalOdds}

            Generate the following HTML structure:
            1. A <h4> with class "text-xl font-bold text-cyan-400 mb-2" titled "Parlay Rationale". Follow it with a <p> with class="text-gray-300 mb-4" that explains what a parlay is (higher risk for a higher reward) and the overall strategy for this specific combination.
            2. An <hr> with class="border-gray-700 my-4".
            3. A <h4> with class "text-xl font-bold text-teal-400 mb-2" titled "Leg 1 Breakdown: ${leg1.prediction.winner}". Follow it with a <p> briefly justifying this pick.
            4. A <h4> with class "text-xl font-bold text-teal-400 mb-2 mt-3" titled "Leg 2 Breakdown: ${leg2.prediction.winner}". Follow it with a <p> briefly justifying this second pick.
            5. An <hr> with class="border-gray-700 my-4".
            6. A <h4> with class "text-xl font-bold text-red-400 mb-2" titled "Associated Risks". Follow it with a <p> explaining the primary risks. Mention that both bets must win, and discuss the single biggest risk for each leg that could cause the parlay to fail.
            7. An <hr> with class="border-gray-700 my-4".
            8. A <h4> with class "text-xl font-bold text-yellow-400 mb-2" titled "Final Verdict". Follow it with a confident <p> with class="text-gray-200" that summarizes the recommendation, weighing the potential payout against the risk.
        `;

        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" });
        const result = await model.generateContent(prompt);
        const response = await result.response;
        let analysisHtml = response.text().split('```html').join('').split('```').join('');
        res.json({ analysisHtml });

    } catch (error) {
        console.error("Parlay AI Analysis Error:", error);
        res.status(500).json({ error: "Failed to generate Parlay AI analysis." });
    }
});


// This must be the last GET route to serve the frontend
app.get('*', (req, res) => {
    // --- FIX: Serve index.html from the correct parent 'public' directory ---
    res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

const PORT = process.env.PORT || 10000;
connectToDb().then(() => {
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
});
