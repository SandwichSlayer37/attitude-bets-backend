// FINAL, STABLE & FEATURE-COMPLETE VERSION
require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const axios = require('axios');
const Snoowrap = require('snoowrap');
const { MongoClient } = require('mongodb');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
app.use(cors());
app.use(express.json());

// Corrected static file pathing to work on Render
app.use(express.static(path.join(__dirname, '..', 'Public')));


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
    'Arizona Diamondbacks': { lat: 33.4453, lon: -112.0667 }, 'Atlanta Braves': { lat: 33.8907, lon: -84.4677 }, 'Baltimore Orioles': { lat: 39.2838, lon: -76.6217 }, 'Boston Red Sox': { lat: 42.3467, lon: -71.0972 }, 'Chicago Cubs': { lat: 41.9484, lon: -87.6553 }, 'Chicago White Sox': { lat: 41.8300, lon: -87.6337 }, 'Cincinnati Reds': { lat: 39.0975, lon: -84.5069 }, 'Cleveland Guardians': { lat: 41.4962, lon: -81.6852 }, 'Colorado Rockies': { lat: 39.7562, lon: -104.9942 }, 'Detroit Tigers': { lat: 42.3390, lon: -83.0552 }, 'Houston Astros': { lat: 29.7570, lon: -95.3555 }, 'Kansas City Royals': { lat: 39.0517, lon: -94.4803 }, 'Los Angeles Angels': { lat: 33.8003, lon: -117.8827 }, 'Los Angeles Dodgers': { lat: 34.0739, lon: -118.2398 }, 'Miami Marlins': { lat: 25.7781, lon: -80.2196 }, 'Milwaukee Brewers': { lat: 43.0280, lon: -87.9712 }, 'Minnesota Twins': { lat: 44.9817, lon: -93.2775 }, 'New York Mets': { lat: 40.7571, lon: -73.8458 }, 'New York Yankees': { lat: 40.8296, lon: -73.9262 }, 'Oakland Athletics': { lat: 37.7516, lon: -122.2005 }, 'Philadelphia Phillies': { lat: 39.9061, lon: -75.1665 }, 'Pittsburgh Pirates': { lat: 40.4469, lon: -80.0057 }, 'San Diego Padres': { lat: 32.7073, lon: -117.1570 }, 'San Francisco Giants': { lat: 37.7786, lon: -122.3893 }, 'Seattle Mariners': { lat: 47.5914, lon: -122.3325 }, 'St. Louis Cardinals': { lat: 38.6226, lon: -90.1928 }, 'Tampa Bay Rays': { lat: 27.7682, lon: -82.6534 }, 'Texas Rangers': { lat: 32.7513, lon: -97.0829 }, 'Toronto Blue Jays': { lat: 43.6414, lon: -79.3894 }, 'Washington Nationals': { lat: 38.8729, lon: -77.0074 },
    'Arizona Cardinals': { lat: 33.5276, lon: -112.2625 }, 'Atlanta Falcons': { lat: 33.7554, lon: -84.4009 }, 'Baltimore Ravens': { lat: 39.2780, lon: -76.6227 }, 'Buffalo Bills': { lat: 42.7738, lon: -78.7870 }, 'Carolina Panthers': { lat: 35.2259, lon: -80.8529 }, 'Chicago Bears': { lat: 41.8623, lon: -87.6167 }, 'Cincinnati Bengals': { lat: 39.0954, lon: -84.5160 }, 'Cleveland Browns': { lat: 41.5061, lon: -81.6995 }, 'Dallas Cowboys': { lat: 32.7478, lon: -97.0929 }, 'Denver Broncos': { lat: 39.7439, lon: -105.0201 }, 'Detroit Lions': { lat: 42.3400, lon: -83.0456 }, 'Green Bay Packers': { lat: 44.5013, lon: -88.0622 }, 'Houston Texans': { lat: 29.6847, lon: -95.4109 }, 'Indianapolis Colts': { lat: 39.7601, lon: -86.1639 }, 'Jacksonville Jaguars': { lat: 30.3239, lon: -81.6375 }, 'Kansas City Chiefs': { lat: 39.0489, lon: -94.4839 }, 'Las Vegas Raiders': { lat: 36.0907, lon: -115.1838 }, 'Los Angeles Chargers': { lat: 33.9535, lon: -118.3392 }, 'Los Angeles Rams': { lat: 33.9535, lon: -118.3392 }, 'Miami Dolphins': { lat: 25.9580, lon: -80.2389 }, 'Minnesota Vikings': { lat: 44.9736, lon: -93.2579 }, 'New England Patriots': { lat: 42.0909, lon: -71.2643 }, 'New Orleans Saints': { lat: 29.9509, lon: -90.0821 }, 'New York Giants': { lat: 40.8136, lon: -74.0744 }, 'New York Jets': { lat: 40.8136, lon: -74.0744 }, 'Philadelphia Eagles': { lat: 39.9008, lon: -75.1675 }, 'Pittsburgh Steelers': { lat: 40.4467, lon: -80.0158 }, 'San Francisco 49ers': { lat: 37.4031, lon: -121.9697 }, 'Seattle Seahawks': { lat: 47.5952, lon: -122.3316 }, 'Tampa Bay Buccaneers': { lat: 27.9759, lon: -82.5033 }, 'Tennessee Titans': { lat: 36.1665, lon: -86.7713 }, 'Washington Commanders': { lat: 38.9077, lon: -76.8645 },
    'Anaheim Ducks': { lat: 33.8078, lon: -117.8766 }, 'Arizona Coyotes': { lat: 33.5319, lon: -112.2611 }, 'Boston Bruins': { lat: 42.3662, lon: -71.0621 }, 'Buffalo Sabres': { lat: 42.8751, lon: -78.8765 }, 'Calgary Flames': { lat: 51.0375, lon: -114.0519 }, 'Carolina Hurricanes': { lat: 35.8033, lon: -78.7219 }, 'Chicago Blackhawks': { lat: 41.8807, lon: -87.6742 }, 'Colorado Avalanche': { lat: 39.7486, lon: -105.0076 }, 'Columbus Blue Jackets': { lat: 39.9695, lon: -83.0060 }, 'Dallas Stars': { lat: 32.7905, lon: -96.8103 }, 'Detroit Red Wings': { lat: 42.3411, lon: -83.0553 }, 'Edmonton Oilers': { lat: 53.5469, lon: -113.4973 }, 'Florida Panthers': { lat: 26.1585, lon: -80.3255 }, 'Los Angeles Kings': { lat: 34.0430, lon: -118.2673 }, 'Minnesota Wild': { lat: 44.9447, lon: -93.1008 }, 'Montreal Canadiens': { lat: 45.4965, lon: -73.5694 }, 'Nashville Predators': { lat: 36.1593, lon: -86.7785 }, 'New Jersey Devils': { lat: 40.7336, lon: -74.1711 }, 'New York Islanders': { lat: 40.7230, lon: -73.5925 }, 'New York Rangers': { lat: 40.7505, lon: -73.9934 }, 'Ottawa Senators': { lat: 45.2969, lon: -75.9281 }, 'Philadelphia Flyers': { lat: 39.9012, lon: -75.1720 }, 'Pittsburgh Penguins': { lat: 40.4395, lon: -79.9896 }, 'San Jose Sharks': { lat: 37.3328, lon: -121.9012 }, 'Seattle Kraken': { lat: 47.6221, lon: -122.3539 }, 'St. Louis Blues': { lat: 38.6268, lon: -90.2027 }, 'Tampa Bay Lightning': { lat: 27.9427, lon: -82.4518 }, 'Toronto Maple Leafs': { lat: 43.6435, lon: -79.3791 }, 'Vancouver Canucks': { lat: 49.2778, lon: -123.1089 }, 'Vegas Golden Knights': { lat: 36.0967, lon: -115.1783 }, 'Washington Capitals': { lat: 38.8982, lon: -77.0209 }, 'Winnipeg Jets': { lat: 49.8927, lon: -97.1435 }
};

const teamAliasMap = {
    'Arizona Diamondbacks': ['D-backs', 'Diamondbacks'], 'Atlanta Braves': ['Braves'], 'Baltimore Orioles': ['Orioles'], 'Boston Red Sox': ['Red Sox'], 'Chicago Cubs': ['Cubs'], 'Chicago White Sox': ['White Sox', 'ChiSox'], 'Cincinnati Reds': ['Reds'], 'Cleveland Guardians': ['Guardians'], 'Colorado Rockies': ['Rockies'], 'Detroit Tigers': ['Tigers'], 'Houston Astros': ['Astros'], 'Kansas City Royals': ['Royals'], 'Los Angeles Angels': ['Angels'], 'Los Angeles Dodgers': ['Dodgers'], 'Miami Marlins': ['Marlins'], 'Milwaukee Brewers': ['Brewers'], 'Minnesota Twins': ['Twins'], 'New York Mets': ['Mets'], 'New York Yankees': ['Yankees'], 'Oakland Athletics': ["A's", 'Athletics', "Oakland A's"], 'Philadelphia Phillies': ['Phillies'], 'Pittsburgh Pirates': ['Pirates'], 'San Diego Padres': ['Padres', 'Friars'], 'San Francisco Giants': ['Giants'], 'Seattle Mariners': ['Mariners', "M's"], 'St. Louis Cardinals': ['Cardinals', 'Cards', 'St Louis Cardinals'], 'Tampa Bay Rays': ['Rays'], 'Texas Rangers': ['Rangers'], 'Toronto Blue Jays': ['Blue Jays', 'Jays'], 'Washington Nationals': ['Nationals'],
    'Arizona Cardinals': ['Cardinals'], 'Atlanta Falcons': ['Falcons'], 'Baltimore Ravens': ['Ravens'], 'Buffalo Bills': ['Bills'], 'Carolina Panthers': ['Panthers'], 'Chicago Bears': ['Bears'], 'Cincinnati Bengals': ['Bengals'], 'Cleveland Browns': ['Browns'], 'Dallas Cowboys': ['Cowboys'], 'Denver Broncos': ['Broncos'], 'Detroit Lions': ['Lions'], 'Green Bay Packers': ['Packers'], 'Houston Texans': ['Texans'], 'Indianapolis Colts': ['Colts'], 'Jacksonville Jaguars': ['Jaguars'], 'Kansas City Chiefs': ['Chiefs'], 'Las Vegas Raiders': ['Raiders'], 'Los Angeles Chargers': ['Chargers'], 'Los Angeles Rams': ['Rams'], 'Miami Dolphins': ['Dolphins'], 'Minnesota Vikings': ['Vikings'], 'New England Patriots': ['Patriots'], 'New Orleans Saints': ['Saints'], 'New York Giants': ['Giants'], 'New York Jets': ['Jets'], 'Philadelphia Eagles': ['Eagles'], 'Pittsburgh Steelers': ['Steelers'], 'San Francisco 49ers': ['49ers'], 'Seattle Seahawks': ['Seahawks'], 'Tampa Bay Buccaneers': ['Buccaneers'], 'Tennessee Titans': ['Titans'], 'Washington Commanders': ['Commanders', 'Football Team'],
    'Anaheim Ducks': ['Ducks'], 'Arizona Coyotes': ['Coyotes'], 'Boston Bruins': ['Bruins'], 'Buffalo Sabres': ['Sabres'], 'Calgary Flames': ['Flames'], 'Carolina Hurricanes': ['Hurricanes', 'Canes'], 'Chicago Blackhawks': ['Blackhawks'], 'Colorado Avalanche': ['Avalanche', 'Avs'], 'Columbus Blue Jackets': ['Blue Jackets', 'CBJ'], 'Dallas Stars': ['Stars'], 'Detroit Red Wings': ['Red Wings'], 'Edmonton Oilers': ['Oilers'], 'Florida Panthers': ['Panthers'], 'Los Angeles Kings': ['Kings'], 'Minnesota Wild': ['Wild'], 'Montreal Canadiens': ['Canadiens', 'Habs'], 'Nashville Predators': ['Predators', 'Preds'], 'New Jersey Devils': ['Devils'], 'New York Islanders': ['Islanders', 'Isles'], 'New York Rangers': ['Rangers'], 'Ottawa Senators': ['Senators', 'Sens'], 'Philadelphia Flyers': ['Flyers'], 'Pittsburgh Penguins': ['Penguins', 'Pens'], 'San Jose Sharks': ['Sharks'], 'Seattle Kraken': ['Kraken'], 'St. Louis Blues': ['Blues'], 'Tampa Bay Lightning': ['Lightning', 'Bolts'], 'Toronto Maple Leafs': ['Maple Leafs', 'Leafs'], 'Vancouver Canucks': ['Canucks', 'Nucks'], 'Vegas Golden Knights': ['Golden Knights', 'Knights'], 'Washington Capitals': ['Capitals', 'Caps'], 'Winnipeg Jets': ['Jets']
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

const FUTURES_PICKS_DB = {
    'baseball_mlb': { championship: 'Los Angeles Dodgers', hotPick: 'Houston Astros' },
    'icehockey_nhl': { championship: 'Colorado Avalanche', hotPick: 'New York Rangers' },
    'americanfootball_nfl': { championship: 'Kansas City Chiefs', hotPick: 'Detroit Lions' }
};
const dataCache = new Map();

// --- HELPER FUNCTIONS ---
const parseRecord = (rec) => {
    if (!rec || typeof rec !== 'string') return { w: 0, l: 0, otl: 0 };
    const parts = rec.split('-');
    if (parts.length < 2) return { w: 0, l: 0, otl: 0 };
    const wins = parseInt(parts[0], 10);
    const losses = parseInt(parts[1], 10);
    const otl = parts.length > 2 ? parseInt(parts[2], 10) : 0;
    if (isNaN(wins) || isNaN(losses)) return { w: 0, l: 0, otl: 0 };
    return { w: wins, l: losses, otl: otl };
};
const getWinPct = (rec) => {
    const totalGames = rec.w + rec.l + (rec.otl || 0);
    return totalGames > 0 ? rec.w / totalGames : 0;
}

// --- DYNAMIC WEIGHTS ---
function getDynamicWeights(sportKey) {
    if (sportKey === 'baseball_mlb') {
        return { record: 6, momentum: 5, value: 5, newsSentiment: 10, injuryImpact: 12, offensiveForm: 12, defensiveForm: 12, h2h: 10, weather: 8 };
    }
    if (sportKey === 'icehockey_nhl') {
        return { record: 6, hotStreak: 7, h2h: 8, newsSentiment: 8, injuryImpact: 12, offensiveForm: 9, defensiveForm: 9, specialTeams: 11, value: 5, goalieMatchup: 14, fatigue: 10, faceoffAdvantage: 6 };
    }
    return { record: 8, fatigue: 7, momentum: 5, matchup: 10, value: 5, newsSentiment: 10, injuryImpact: 12, offensiveForm: 9, defensiveForm: 9, h2h: 11, weather: 5 };
}

// Add this new function in your server.js, near the other data fetchers

async function getPropBets(sportKey, gameId) {
    // Note: The Odds API uses the game ID to find events.
    const key = `props_${gameId}`;
    // Fetch fresh every 30 mins, as prop lines can change.
    return fetchData(key, async () => {
        try {
            // We specify the markets we are interested in.
            const markets = 'player_points,player_rebounds,player_assists,player_pass_tds,player_pass_yds,player_strikeouts';
            const url = `https://api.the-odds-api.com/v4/sports/${sportKey}/events/${gameId}/odds?apiKey=${ODDS_API_KEY}&regions=us&markets=${markets}&oddsFormat=decimal`;
            
            const { data } = await axios.get(url);
            // The API returns the full game object, we just want the bookmaker info.
            return data.bookmakers || [];
        } catch (error) {
            console.error(`Could not fetch prop bets for game ${gameId}:`, error.message);
            return []; // Return empty array on failure
        }
    }, 1800000); // 30-minute cache
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
    const key = `odds_${sportKey}`;
    return fetchData(key, async () => {
        try {
            const allGames = [];
            const gameIds = new Set();
            const datesToFetch = [];
            
            const today = new Date();
            for (let i = -1; i < 3; i++) {
                const targetDate = new Date(today);
                targetDate.setUTCDate(today.getUTCDate() + i);
                datesToFetch.push(targetDate.toISOString().split('T')[0]);
            }

            const requests = datesToFetch.map(date =>
                axios.get(`https://api.the-odds-api.com/v4/sports/${sportKey}/odds/?regions=us&markets=h2h&oddsFormat=decimal&date=${date}&apiKey=${ODDS_API_KEY}`)
            );
            const responses = await Promise.all(requests);
            for (const response of responses) {
                if(response.data) {
                    for (const game of response.data) {
                        if (!gameIds.has(game.id)) {
                            allGames.push(game);
                            gameIds.add(game.id);
                        }
                    }
                }
            }
            return allGames;
        } catch (error) {
            console.error("ERROR IN getOdds function:", error.message);
            return [];
        }
    }, 900000);
}

async function getGoalieStats() {
    const cacheKey = `nhl_goalie_stats_v2`;
    return fetchData(cacheKey, async () => {
        try {
            const url = `https://api-web.nhle.com/v1/goalie-stats/current?isAggregate=true&isGame=false&sort=savePct&limit=100`;
            const { data } = await axios.get(url);
            const goalieStats = {};
            if (data && data.data) {
                data.data.forEach(goalie => {
                    goalieStats[goalie.player.name.default] = {
                        gaa: goalie.gaa,
                        svPct: goalie.savePct,
                        wins: goalie.wins
                    };
                });
            }
            return goalieStats;
        } catch (e) {
            if (e.response && e.response.status === 404) {
                console.log(`[NHL] Goalie Stats API returned 404, likely offseason. Proceeding gracefully.`);
                return {};
            }
            console.error("Could not fetch goalie stats:", e.message);
            return {};
        }
    }, 86400000);
}

async function getTeamStatsFromAPI(sportKey) {
    const cacheKey = `stats_api_${sportKey}_v_final_robust`;
    return fetchData(cacheKey, async () => {
        const stats = {};
        if (sportKey === 'baseball_mlb') {
            const currentYear = new Date().getFullYear();
            try {
                const standingsUrl = `https://statsapi.mlb.com/api/v1/standings?leagueId=103,104&season=${currentYear}`;
                const { data: standingsData } = await axios.get(standingsUrl);
                if (standingsData.records) {
                    for (const record of standingsData.records) {
                        for (const teamRecord of record.teamRecords) {
                            const teamName = teamRecord.team.name;
                            const canonicalName = canonicalTeamNameMap[teamName.toLowerCase()];
                            if(canonicalName) {
                                const lastTenRecord = teamRecord.records.splitRecords.find(r => r.type === 'lastTen');
                                stats[canonicalName] = {
                                    record: `${teamRecord.wins}-${teamRecord.losses}`,
                                    streak: teamRecord.streak?.streakCode || 'N/A',
                                    lastTen: lastTenRecord ? `${lastTenRecord.wins}-${lastTenRecord.losses}` : '0-0',
                                    ops: 0.700,
                                    teamERA: 99.99
                                };
                            }
                        }
                    }
                }

                const leagueStatsUrl = `https://statsapi.mlb.com/api/v1/stats?stats=season&group=hitting,pitching&season=${currentYear}&sportId=1`;
                const { data: leagueStatsData } = await axios.get(leagueStatsUrl);
                 if (leagueStatsData.stats) {
                    leagueStatsData.stats.forEach(statGroup => {
                        statGroup.splits.forEach(split => {
                            const teamName = split.team.name;
                            const canonicalName = canonicalTeamNameMap[teamName.toLowerCase()];
                            if (stats[canonicalName]) {
                                if (statGroup.group.displayName === 'hitting' && split.stat) {
                                    stats[canonicalName].ops = parseFloat(split.stat.ops);
                                } else if (statGroup.group.displayName === 'pitching' && split.stat) {
                                    stats[canonicalName].teamERA = parseFloat(split.stat.era);
                                }
                            }
                        });
                    });
                }
                return stats;
            } catch (e) {
                if (e.response && e.response.status === 404) {
                    console.log(`[MLB] API returned 404 for ${sportKey}, likely an off-day. Proceeding gracefully.`);
                    return {};
                }
                console.error(`Could not fetch stats from MLB-StatsAPI: ${e.message}`);
                return stats;
            }
        } else if (sportKey === 'icehockey_nhl') {
            try {
                const today = new Date().toISOString().slice(0, 10);
                const [standingsResponse, teamStatsResponse] = await Promise.all([
                    axios.get(`https://api-web.nhle.com/v1/standings/${today}`),
                    axios.get('https://api-web.nhle.com/v1/club-stats/team/summary')
                ]);

                if (standingsResponse.data && standingsResponse.data.standings) {
                    standingsResponse.data.standings.forEach(s => {
                        const canonicalName = canonicalTeamNameMap[s.teamName.default.toLowerCase()];
                        if (canonicalName) {
                            stats[canonicalName] = { record: `${s.wins}-${s.losses}-${s.otLosses}`, streak: s.streakCode || 'N/A' };
                        }
                    });
                }
                if (teamStatsResponse.data && teamStatsResponse.data.data) {
                    teamStatsResponse.data.data.forEach(team => {
                        const canonicalName = canonicalTeamNameMap[team.teamFullName.toLowerCase()];
                        if (stats[canonicalName]) {
                            stats[canonicalName].goalsForPerGame = team.goalsForPerGame;
                            stats[canonicalName].goalsAgainstPerGame = team.goalsAgainstPerGame;
                            stats[canonicalName].powerPlayPct = team.powerPlayPct;
                            stats[canonicalName].penaltyKillPct = team.penaltyKillPct;
                            stats[canonicalName].faceoffWinPct = team.faceoffWinPct;
                        }
                    });
                }
                return stats;
            } catch (e) {
                if (e.response && e.response.status === 404) {
                    console.log(`[NHL] API returned 404 for ${sportKey}, likely offseason. Proceeding gracefully.`);
                    return {};
                }
                console.error(`Could not fetch stats from NHL API: ${e.message}`);
                return {};
            }
        }
        return {};
    }, 3600000);
}

function calculateFatigue(teamName, allGames, currentGameDate) {
    const oneDay = 1000 * 60 * 60 * 24;
    const fourDays = oneDay * 4;
    const recentGames = allGames.filter(g => {
        const gameDate = new Date(g.commence_time);
        return (g.home_team === teamName || g.away_team === teamName) && gameDate < currentGameDate;
    }).sort((a, b) => new Date(b.commence_time) - new Date(a.commence_time));
    let fatigueScore = 0;
    if (recentGames.length === 0) return fatigueScore;
    const lastGame = recentGames[0];
    if ((currentGameDate - new Date(lastGame.commence_time)) / (1000 * 60 * 60) <= 30) {
        fatigueScore += 5;
    }
    const gamesInLast4Days = recentGames.filter(g => (currentGameDate - new Date(g.commence_time)) <= fourDays).length;
    if (gamesInLast4Days >= 2) { 
        fatigueScore += 3;
    }
    let roadTripLength = 0;
    for (const game of recentGames) {
        if (game.away_team === teamName) {
            roadTripLength++;
        } else {
            break;
        }
    }
    if (roadTripLength >= 3) {
        fatigueScore += roadTripLength;
    }
    return fatigueScore;
}

async function getWeatherData(teamName) {
    if (!teamName) return null;
    const canonicalName = canonicalTeamNameMap[teamName.toLowerCase()] || teamName;
    const location = teamLocationMap[canonicalName];
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
    return fetchData(`espn_scoreboard_${sportKey}`, async () => {
        const map = { 'baseball_mlb': 'baseball/mlb', 'icehockey_nhl': 'hockey/nhl', 'americanfootball_nfl': 'football/nfl' }[sportKey];
        if (!map) return null;
        try {
            const { data } = await axios.get(`https://site.api.espn.com/apis/site/v2/sports/${map.sport}/${map.league}/scoreboard`);
            return data;
        } catch (error) {
            console.error(`Could not fetch ESPN scoreboard for ${sportKey}:`, error.message);
            return null;
        }
    }, 60000);
}

async function runPredictionEngine(game, sportKey, context) {
    const { teamStats, injuries, h2h, allGames, goalieStats, probableStarters, weather } = context;
    const weights = getDynamicWeights(sportKey);
    const { home_team, away_team } = game;
    const homeCanonicalName = canonicalTeamNameMap[home_team.toLowerCase()] || home_team;
    const awayCanonicalName = canonicalTeamNameMap[away_team.toLowerCase()] || away_team;
    const homeStats = teamStats[homeCanonicalName] || {};
    const awayStats = teamStats[awayCanonicalName] || {};
    let homeScore = 50, awayScore = 50;
    const factors = {};
    let homeInjuryImpact = (injuries[homeCanonicalName] || []).length;
    let awayInjuryImpact = (injuries[awayCanonicalName] || []).length;
    factors['Record'] = { value: (getWinPct(parseRecord(homeStats.record)) - getWinPct(parseRecord(awayStats.record))) * weights.record, homeStat: homeStats.record, awayStat: awayStats.record };
    factors['H2H (Season)'] = { value: (getWinPct(parseRecord(h2h.home)) - getWinPct(parseRecord(h2h.away))) * weights.h2h, homeStat: h2h.home, awayStat: h2h.away };
    if (sportKey === 'icehockey_nhl') {
        const homeStreakVal = (homeStats.streak?.startsWith('W') ? 1 : -1) * parseInt(homeStats.streak?.substring(1) || 0, 10);
        const awayStreakVal = (awayStats.streak?.startsWith('W') ? 1 : -1) * parseInt(awayStats.streak?.substring(1) || 0, 10);
        factors['Hot Streak'] = { value: (homeStreakVal - awayStreakVal) * weights.hotStreak, homeStat: homeStats.streak, awayStat: awayStats.streak };
        factors['Offensive Form'] = { value: (homeStats.goalsForPerGame - awayStats.goalsForPerGame) * weights.offensiveForm, homeStat: `${homeStats.goalsForPerGame?.toFixed(2)} G/GP`, awayStat: `${awayStats.goalsForPerGame?.toFixed(2)} G/GP` };
        factors['Defensive Form'] = { value: (awayStats.goalsAgainstPerGame - homeStats.goalsAgainstPerGame) * weights.defensiveForm, homeStat: `${homeStats.goalsAgainstPerGame?.toFixed(2)} GA/GP`, awayStat: `${awayStats.goalsAgainstPerGame?.toFixed(2)} GA/GP` };
        const homeSpecialTeams = (homeStats.powerPlayPct || 0) - (awayStats.penaltyKillPct || 0);
        const awaySpecialTeams = (awayStats.powerPlayPct || 0) - (homeStats.penaltyKillPct || 0);
        factors['Special Teams'] = { value: (homeSpecialTeams - awaySpecialTeams) * weights.specialTeams, homeStat: `PP ${homeStats.powerPlayPct?.toFixed(1)}%`, awayStat: `PP ${awayStats.powerPlayPct?.toFixed(1)}%` };
        factors['Faceoff Advantage'] = { value: ((homeStats.faceoffWinPct || 50) - (awayStats.faceoffWinPct || 50)) * weights.faceoffAdvantage, homeStat: `${homeStats.faceoffWinPct?.toFixed(1)}%`, awayStat: `${awayStats.faceoffWinPct?.toFixed(1)}%` };
        const homeFatigue = calculateFatigue(home_team, allGames, new Date(game.commence_time));
        const awayFatigue = calculateFatigue(away_team, allGames, new Date(game.commence_time));
        factors['Fatigue'] = { value: (awayFatigue - homeFatigue) * weights.fatigue, homeStat: `${homeFatigue} pts`, awayStat: `${awayFatigue} pts` };
        const homeGoalieName = probableStarters[homeCanonicalName];
        const awayGoalieName = probableStarters[awayCanonicalName];
        const homeGoalieStats = homeGoalieName ? goalieStats[homeGoalieName] : null;
        const awayGoalieStats = awayGoalieName ? goalieStats[awayGoalieName] : null;
        let goalieValue = 0;
        let homeGoalieDisplay = "N/A", awayGoalieDisplay = "N/A";
        if(homeGoalieStats && awayGoalieStats) {
            const gaaDiff = awayGoalieStats.gaa - homeGoalieStats.gaa;
            const svPctDiff = homeGoalieStats.svPct - awayGoalieStats.svPct;
            goalieValue = (gaaDiff * 5) + (svPctDiff * 100);
            homeGoalieDisplay = `${homeGoalieName.split(' ')[1]} ${homeGoalieStats.svPct.toFixed(3)}`;
            awayGoalieDisplay = `${awayGoalieName.split(' ')[1]} ${awayGoalieStats.svPct.toFixed(3)}`;
        }
        factors['Goalie Matchup'] = { value: goalieValue * (weights.goalieMatchup / 10), homeStat: homeGoalieDisplay, awayStat: awayGoalieDisplay };
    } else if (sportKey === 'baseball_mlb') {
        factors['Recent Form (L10)'] = { value: (getWinPct(parseRecord(homeStats.lastTen)) - getWinPct(parseRecord(awayStats.lastTen))) * weights.momentum, homeStat: homeStats.lastTen, awayStat: awayStats.lastTen };
        const homeOps = homeStats.ops || 0.700;
        const awayOps = awayStats.ops || 0.700;
        factors['Offensive Form'] = { 
            value: (homeOps - awayOps) * 100,
            homeStat: `${homeOps.toFixed(3)} OPS`, 
            awayStat: `${awayOps.toFixed(3)} OPS` 
        };
        if (homeStats.teamERA < 99 && awayStats.teamERA < 99) {
            factors['Defensive Form'] = { value: (awayStats.teamERA - homeStats.teamERA) * weights.defensiveForm, homeStat: `${homeStats.teamERA.toFixed(2)} ERA`, awayStat: `${awayStats.teamERA.toFixed(2)} ERA` };
        }
    }
    factors['Injury Impact'] = { value: (awayInjuryImpact - homeInjuryImpact) * (weights.injuryImpact / 5), homeStat: `${homeInjuryImpact} players`, awayStat: `${awayInjuryImpact} players`, injuries: { home: injuries[homeCanonicalName] || [], away: injuries[awayCanonicalName] || [] } };
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
        if (!isNaN(factors['Betting Value'].value)) homeScore += factors['Betting Value'].value;
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
        const [games, espnDataResponse, teamStats] = await Promise.all([
            getOdds(sportKey),
            fetchEspnData(sportKey),
            getTeamStatsFromAPI(sportKey)
        ]);

        gameCounts[sportKey] = games.length;
        if (!games || games.length === 0) continue;
        
        const goalieStats = sportKey === 'icehockey_nhl' ? await getGoalieStats() : {};
        const injuries = {};
        const h2hRecords = {};
        const probableStarters = {};

        if (espnDataResponse?.events) {
            espnDataResponse.events.forEach(event => {
                const competition = event.competitions?.[0];
                if (!competition) return;
                competition.competitors.forEach(competitor => {
                    const canonicalName = canonicalTeamNameMap[competitor.team.displayName.toLowerCase()] || competitor.team.displayName;
                    injuries[canonicalName] = (competitor.injuries || []).map(inj => ({ name: inj.athlete.displayName, status: inj.status.name }));
                    if (sportKey === 'icehockey_nhl' && competitor.probablePitcher) { 
                        probableStarters[canonicalName] = competitor.probablePitcher.athlete.displayName;
                    }
                });
                const homeTeam = competition.competitors.find(c => c.homeAway === 'home');
                const awayTeam = competition.competitors.find(c => c.homeAway === 'away');
                if (competition.series && homeTeam && awayTeam) {
                    const gameId = `${awayTeam.team.displayName}@${homeTeam.team.displayName}`;
                    const homeWins = competition.series.competitors.find(c => c.id === homeTeam.id)?.wins || 0;
                    const awayWins = competition.series.competitors.find(c => c.id === awayTeam.id)?.wins || 0;
                    h2hRecords[gameId] = { home: `${homeWins}-${awayWins}`, away: `${awayWins}-${homeWins}` };
                }
            });
        }
        
        for (const game of games) {
            const weather = await getWeatherData(game.home_team);
            const h2h = h2hRecords[`${game.away_team}@${game.home_team}`] || { home: '0-0', away: '0-0' };
            const gameHomeCanonical = canonicalTeamNameMap[game.home_team.toLowerCase()] || game.home_team;
            const gameAwayCanonical = canonicalTeamNameMap[game.away_team.toLowerCase()] || game.away_team;
            const context = { 
                teamStats, weather, injuries, h2h, allGames: games, goalieStats,
                probableStarters: {
                    [gameHomeCanonical]: probableStarters[gameHomeCanonical],
                    [gameAwayCanonical]: probableStarters[gameAwayCanonical]
                }
            };
            const predictionData = await runPredictionEngine(game, sportKey, context);
            
            if (predictionData && predictionData.winner) {
                allPredictions.push({ 
                    game: { ...game, sportKey: sportKey }, 
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
        const [games, espnDataResponse, teamStats] = await Promise.all([
            getOdds(sport),
            fetchEspnData(sport),
            getTeamStatsFromAPI(sport)
        ]);

        const goalieStats = sport === 'icehockey_nhl' ? await getGoalieStats() : {};
        if (!games || games.length === 0) { return res.json({ message: `No upcoming games for ${sport}.` }); }

        const injuries = {};
        const h2hRecords = {};
        const probableStarters = {}; 
        if (espnDataResponse?.events) {
             espnDataResponse.events.forEach(event => {
                const competition = event.competitions?.[0];
                if (!competition) return;
                competition.competitors.forEach(competitor => {
                    const canonicalName = canonicalTeamNameMap[competitor.team.displayName.toLowerCase()] || competitor.team.displayName;
                    injuries[canonicalName] = (competitor.injuries || []).map(inj => ({ name: inj.athlete.displayName, status: inj.status.name }));
                    if (sport === 'icehockey_nhl' && competitor.probablePitcher) { 
                        probableStarters[canonicalName] = competitor.probablePitcher.athlete.displayName;
                    }
                });
                const homeTeam = competition.competitors.find(c => c.homeAway === 'home');
                const awayTeam = competition.competitors.find(c => c.homeAway === 'away');
                if (competition.series && homeTeam && awayTeam) {
                    const gameId = `${awayTeam.team.displayName}@${homeTeam.team.displayName}`;
                    const homeWins = competition.series.competitors.find(c => c.id === homeTeam.id)?.wins || 0;
                    const awayWins = competition.series.competitors.find(c => c.id === awayTeam.id)?.wins || 0;
                    h2hRecords[gameId] = { home: `${homeWins}-${awayWins}`, away: `${awayWins}-${homeWins}` };
                }
            });
        }

        const predictions = [];
        for (const game of games) {
            const weather = await getWeatherData(game.home_team);
            const h2h = h2hRecords[`${game.away_team}@${game.home_team}`] || { home: '0-0', away: '0-0' };
            const gameHomeCanonical = canonicalTeamNameMap[game.home_team.toLowerCase()] || game.home_team;
            const gameAwayCanonical = canonicalTeamNameMap[game.away_team.toLowerCase()] || game.away_team;
            const context = { 
                teamStats, weather, injuries, h2h, allGames: games, goalieStats, 
                probableStarters: {
                    [gameHomeCanonical]: probableStarters[gameHomeCanonical],
                    [gameAwayCanonical]: probableStarters[gameAwayCanonical]
                } 
            };
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

            const espnEvent = espnDataResponse?.events?.find(e => {
                const competitors = e.competitions?.[0]?.competitors;
                if (!competitors) return false;
                const home = competitors.find(c => c.homeAway === 'home');
                const away = competitors.find(c => c.homeAway === 'away');
                if (!home || !away) return false;
                return (canonicalTeamNameMap[home.team.displayName.toLowerCase()] === gameHomeCanonical && canonicalTeamNameMap[away.team.displayName.toLowerCase()] === gameAwayCanonical);
            });

            // ... inside the for loop in /api/predictions
predictions.push({ game: { ...game, sportKey: sport, espnData: espnEvent || null }, prediction: predictionData });
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
            let leg2 = goodPicks.find(p => p.game.id !== leg1.game.id);
            if (leg2) {
                const odds1 = leg1.game.bookmakers?.[0]?.markets?.find(m=>m.key==='h2h')?.outcomes?.find(o=>o.name===leg1.prediction.winner)?.price || 0;
                const odds2 = leg2.game.bookmakers?.[0]?.markets?.find(m=>m.key==='h2h')?.outcomes?.find(o=>o.name===leg2.prediction.winner)?.price || 0;

                if (odds1 && odds2) {
                    parlay = {
                        legs: [leg1, leg2],
                        totalOdds: (odds1 * odds2).toFixed(2)
                    };
                }
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

// Replace the entire '/api/ai-analysis' endpoint in server.js with this
app.post('/api/ai-analysis', async (req, res) => {
    try {
        if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not set.");
        
        const { game, prediction } = req.body;

        // --- UPGRADED SYSTEM PROMPT ---
        const systemPrompt = `You are a professional sports betting analyst. Your task is to write a detailed HTML analysis for our user based on the data provided.
- Your response MUST be ONLY the HTML content. 
- Do not include markdown like \`\`\`html or any other conversational text.
- The analysis should include a "Bull Case" (reasons to bet on the predicted winner) and a "Bear Case" (risks involved).
- **Crucially, you must incorporate the specific weather conditions and key player injuries into your narrative.** Explain HOW these factors could impact the game's outcome (e.g., high winds affecting passing, a star player's absence weakening the defense).
- Use <h4> tags with Tailwind CSS classes for headers and <p> tags for text.`;

        // --- UPGRADED DATA SUMMARY ---
        let dataSummary = `Matchup: ${game.away_team} at ${game.home_team}\nOur Algorithm's Prediction: ${prediction.winner}\n`;

        if (prediction.weather) {
            dataSummary += `\n--- Weather Forecast ---\n- Temperature: ${prediction.weather.temp}°C\n- Wind: ${prediction.weather.wind} km/h\n- Precipitation: ${prediction.weather.precip} mm\n`;
        }

        const homeInjuries = prediction.factors['Injury Impact']?.injuries?.home;
        const awayInjuries = prediction.factors['Injury Impact']?.injuries?.away;
        if ((homeInjuries && homeInjuries.length > 0) || (awayInjuries && awayInjuries.length > 0)) {
            dataSummary += `\n--- Key Injuries ---\n`;
            if (homeInjuries && homeInjuries.length > 0) {
                dataSummary += `- ${game.home_team}: ${homeInjuries.map(p => `${p.name} (${p.status})`).join(', ')}\n`;
            }
            if (awayInjuries && awayInjuries.length > 0) {
                dataSummary += `- ${game.away_team}: ${awayInjuries.map(p => `${p.name} (${p.status})`).join(', ')}\n`;
            }
        }

        dataSummary += `\n--- Key Statistical Factors ---\n`;
        for(const factor in prediction.factors) {
            if (factor !== 'Injury Impact') {
                 dataSummary += `- ${factor}: Home (${prediction.factors[factor].homeStat}), Away (${prediction.factors[factor].awayStat})\n`;
            }
        }
        
        const model = genAI.getGenerativeModel({
            model: "gemini-1.5-flash",
            systemInstruction: systemPrompt,
        });

        const result = await model.generateContent(dataSummary);
        const analysisHtml = result.response.text();

        const finalResponse = {
            finalPick: { winner: prediction.winner },
            analysisHtml: analysisHtml
        };
        
        return res.json(finalResponse);

    } catch (error) {
        console.error("AI Analysis Error:", error.message);
        res.status(500).json({ error: "Failed to generate AI analysis." });
    }
});

app.post('/api/parlay-ai-analysis', async (req, res) => {
    try {
        if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not set.");
        const { parlay } = req.body;
        const leg1 = parlay.legs[0];
        const leg2 = parlay.legs[1];

        const prompt = `Act as a professional sports betting analyst...`;
        
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" });
        const result = await model.generateContent(prompt);
        let responseText = result.response.text();
        let analysisHtml = responseText.replace(/```html/g, '').replace(/```html/g, '').trim();
        res.json({ analysisHtml });

    } catch (error) {
        console.error("Parlay AI Analysis Error:", error);
        res.status(500).json({ error: "Failed to generate Parlay AI analysis." });
    }
});

// Add this new endpoint in server.js, before your final app.get('*', ...) route

app.post('/api/ai-prop-analysis', async (req, res) => {
    try {
        const { game, prediction } = req.body;
        if (!game || !prediction) {
            return res.status(400).json({ error: 'Game and prediction data are required.' });
        }

        // 1. Fetch the available prop bets for this specific game
        const bookmakers = await getPropBets(game.sportKey, game.id);
        if (bookmakers.length === 0) {
            return res.json({ 
                analysisHtml: `<h4 class='text-lg font-bold text-yellow-400 mb-2'>No Prop Bets Found</h4><p>We couldn't find any player prop bet markets for this game at the moment. This is common for games that are further out or less popular.</p>`
            });
        }
        
        // Let's format the available props for the AI
        let availableProps = '';
        bookmakers[0].markets.forEach(market => {
            availableProps += `\nMarket: ${market.key}\n`;
            market.outcomes.forEach(outcome => {
                availableProps += `- ${outcome.description} (${outcome.name}): ${outcome.price}\n`;
            });
        });

        // 2. Create a specialized prompt for prop bet analysis
        const systemPrompt = `You are a specialist in sports player-prop betting. Based on the provided game analysis and a list of available prop bets, your task is to identify the SINGLE best prop bet.
- Analyze the main prediction (winner, key factors) to inform your prop decision. For example, if the predicted winner has a strong offense, their QB's "Over" on passing yards might be a good bet.
- Your response must be ONLY HTML content. Do not use markdown.
- Your final output should clearly state the recommended bet (Player, Stat, Over/Under) and provide a concise "Bull Case" (2-3 sentences) explaining your reasoning.
- Structure your response with an <h4> for the pick and a <p> for the rationale.`;

        const userPrompt = `Main Game Analysis:\nThe algorithm predicts ${prediction.winner} will win. The key factors are ${Object.keys(prediction.factors).join(', ')}.

Available Prop Bets from Bookmaker: ${availableProps}

Based on all this information, what is the single best prop bet to make?`;

        // 3. Call the AI model
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash", systemInstruction: systemPrompt });
        const result = await model.generateContent(userPrompt);
        const analysisHtml = result.response.text();

        res.json({ analysisHtml });

    } catch (error) {
        console.error("AI Prop Analysis Error:", error);
        res.status(500).json({ error: "Failed to generate AI prop analysis." });
    }
});

// This must be the last GET route to serve the frontend
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'Public', 'index.html'));
});

const PORT = process.env.PORT || 10000;
connectToDb().then(() => {
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
});









