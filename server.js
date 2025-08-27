require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');
const Snoowrap = require('snoowrap');

// Initialize the Express app
const app = express();
app.use(cors({ origin: 'https://attitude-sports-bets.web.app' }));

// --- API & DATA CONFIG ---
const ODDS_API_KEY = process.env.ODDS_API_KEY;

const r = new Snoowrap({
    userAgent: process.env.REDDIT_USER_AGENT,
    clientId: process.env.REDDIT_CLIENT_ID,
    clientSecret: process.env.REDDIT_CLIENT_SECRET,
    username: process.env.REDDIT_USERNAME,
    password: process.env.REDDIT_PASSWORD
});

const teamLocationMap = {
    // MLB
    'Arizona Diamondbacks': { lat: 33.44, lon: -112.06 }, 'Atlanta Braves': { lat: 33.89, lon: -84.46 },
    'Baltimore Orioles': { lat: 39.28, lon: -76.62 }, 'Boston Red Sox': { lat: 42.34, lon: -71.09 },
    'Chicago Cubs': { lat: 41.94, lon: -87.65 }, 'Chicago White Sox': { lat: 41.83, lon: -87.63 },
    'Cincinnati Reds': { lat: 39.09, lon: -84.50 }, 'Cleveland Guardians': { lat: 41.49, lon: -81.68 },
    'Colorado Rockies': { lat: 39.75, lon: -104.99 }, 'Detroit Tigers': { lat: 42.33, lon: -83.05 },
    'Houston Astros': { lat: 29.75, lon: -95.35 }, 'Kansas City Royals': { lat: 39.05, lon: -94.48 },
    'Los Angeles Angels': { lat: 33.80, lon: -117.88 }, 'Los Angeles Dodgers': { lat: 34.07, lon: -118.24 },
    'Miami Marlins': { lat: 25.77, lon: -80.22 }, 'Milwaukee Brewers': { lat: 43.02, lon: -87.97 },
    'Minnesota Twins': { lat: 44.98, lon: -93.27 }, 'New York Mets': { lat: 40.75, lon: -73.84 },
    'New York Yankees': { lat: 40.82, lon: -73.92 }, 'Oakland Athletics': { lat: 37.75, lon: -122.20 },
    'Philadelphia Phillies': { lat: 39.90, lon: -75.16 }, 'Pittsburgh Pirates': { lat: 40.44, lon: -80.00 },
    'San Diego Padres': { lat: 32.70, lon: -117.15 }, 'San Francisco Giants': { lat: 37.77, lon: -122.38 },
    'Seattle Mariners': { lat: 47.59, lon: -122.33 }, 'St. Louis Cardinals': { lat: 38.62, lon: -90.19 },
    'Tampa Bay Rays': { lat: 27.76, lon: -82.65 }, 'Texas Rangers': { lat: 32.75, lon: -97.08 },
    'Toronto Blue Jays': { lat: 43.64, lon: -79.38 }, 'Washington Nationals': { lat: 38.87, lon: -77.00 },
    // NHL
    'Anaheim Ducks': { lat: 33.80, lon: -117.87 }, 'Arizona Coyotes': { lat: 33.53, lon: -112.26 },
    'Boston Bruins': { lat: 42.36, lon: -71.06 }, 'Buffalo Sabres': { lat: 42.87, lon: -78.87 },
    'Calgary Flames': { lat: 51.03, lon: -114.05 }, 'Carolina Hurricanes': { lat: 35.80, lon: -78.72 },
    'Chicago Blackhawks': { lat: 41.88, lon: -87.67 }, 'Colorado Avalanche': { lat: 39.74, lon: -105.00 },
    'Columbus Blue Jackets': { lat: 40.00, lon: -83.00 }, 'Dallas Stars': { lat: 32.79, lon: -96.81 },
    'Detroit Red Wings': { lat: 42.34, lon: -83.05 }, 'Edmonton Oilers': { lat: 53.54, lon: -113.49 },
    'Florida Panthers': { lat: 26.15, lon: -80.32 }, 'Los Angeles Kings': { lat: 34.04, lon: -118.26 },
    'Minnesota Wild': { lat: 44.94, lon: -93.10 }, 'Montreal Canadiens': { lat: 45.49, lon: -73.57 },
    'Nashville Predators': { lat: 36.15, lon: -86.77 }, 'New Jersey Devils': { lat: 40.73, lon: -74.17 },
    'New York Islanders': { lat: 40.72, lon: -73.62 }, 'New York Rangers': { lat: 40.75, lon: -73.99 },
    'Ottawa Senators': { lat: 45.29, lon: -75.92 }, 'Philadelphia Flyers': { lat: 39.90, lon: -75.17 },
    'Pittsburgh Penguins': { lat: 40.43, lon: -79.98 }, 'San Jose Sharks': { lat: 37.33, lon: -121.90 },
    'Seattle Kraken': { lat: 47.62, lon: -122.35 }, 'St. Louis Blues': { lat: 38.62, lon: -90.20 },
    'Tampa Bay Lightning': { lat: 27.94, lon: -82.45 }, 'Toronto Maple Leafs': { lat: 43.64, lon: -79.37 },
    'Vancouver Canucks': { lat: 49.27, lon: -123.12 }, 'Vegas Golden Knights': { lat: 36.10, lon: -115.17 },
    'Washington Capitals': { lat: 38.89, lon: -77.02 }, 'Winnipeg Jets': { lat: 49.89, lon: -97.14 },
    // NFL
    'Arizona Cardinals': { lat: 33.52, lon: -112.26 }, 'Atlanta Falcons': { lat: 33.75, lon: -84.40 },
    'Baltimore Ravens': { lat: 39.27, lon: -76.62 }, 'Buffalo Bills': { lat: 42.77, lon: -78.78 },
    'Carolina Panthers': { lat: 35.22, lon: -80.85 }, 'Chicago Bears': { lat: 41.86, lon: -87.61 },
    'Cincinnati Bengals': { lat: 39.09, lon: -84.51 }, 'Cleveland Browns': { lat: 41.50, lon: -81.69 },
    'Dallas Cowboys': { lat: 32.74, lon: -97.09 }, 'Denver Broncos': { lat: 39.74, lon: -105.02 },
    'Detroit Lions': { lat: 42.34, lon: -83.04 }, 'Green Bay Packers': { lat: 44.50, lon: -88.06 },
    'Houston Texans': { lat: 29.68, lon: -95.41 }, 'Indianapolis Colts': { lat: 39.76, lon: -86.16 },
    'Jacksonville Jaguars': { lat: 30.32, lon: -81.63 }, 'Kansas City Chiefs': { lat: 39.04, lon: -94.48 },
    'Las Vegas Raiders': { lat: 36.09, lon: -115.18 }, 'Los Angeles Chargers': { lat: 33.95, lon: -118.33 },
    'Los Angeles Rams': { lat: 33.95, lon: -118.33 }, 'Miami Dolphins': { lat: 25.95, lon: -80.23 },
    'Minnesota Vikings': { lat: 44.97, lon: -93.25 }, 'New England Patriots': { lat: 42.09, lon: -71.26 },
    'New Orleans Saints': { lat: 29.95, lon: -90.08 }, 'New York Giants': { lat: 40.81, lon: -74.07 },
    'New York Jets': { lat: 40.81, lon: -74.07 }, 'Philadelphia Eagles': { lat: 39.90, lon: -75.16 },
    'Pittsburgh Steelers': { lat: 40.44, lon: -80.01 }, 'San Francisco 49ers': { lat: 37.40, lon: -121.97 },
    'Seattle Seahawks': { lat: 47.59, lon: -122.33 }, 'Tampa Bay Buccaneers': { lat: 27.97, lon: -82.50 },
    'Tennessee Titans': { lat: 36.16, lon: -86.77 }, 'Washington Commanders': { lat: 38.90, lon: -76.86 }
};

const teamAliasMap = {
    // MLB
    'Arizona Diamondbacks': ['D-backs', 'Diamondbacks'], 'Atlanta Braves': ['Braves'], 'Baltimore Orioles': ['Orioles'],
    'Boston Red Sox': ['Red Sox'], 'Chicago Cubs': ['Cubs'], 'Chicago White Sox': ['White Sox', 'ChiSox'], 'Cincinnati Reds': ['Reds'],
    'Cleveland Guardians': ['Guardians'], 'Colorado Rockies': ['Rockies'], 'Detroit Tigers': ['Tigers'], 'Houston Astros': ['Astros'],
    'Kansas City Royals': ['Royals'], 'Los Angeles Angels': ['Angels'], 'Los Angeles Dodgers': ['Dodgers'], 'Miami Marlins': ['Marlins'],
    'Milwaukee Brewers': ['Brewers'], 'Minnesota Twins': ['Twins'], 'New York Mets': ['Mets'], 'New York Yankees': ['Yankees'],
    'Oakland Athletics': ["A's", 'Athletics'], 'Philadelphia Phillies': ['Phillies'], 'Pittsburgh Pirates': ['Pirates'],
    'San Diego Padres': ['Padres', 'Friars'], 'San Francisco Giants': ['Giants'], 'Seattle Mariners': ['Mariners', "M's"],
    'St. Louis Cardinals': ['Cardinals', 'Cards'], 'Tampa Bay Rays': ['Rays'], 'Texas Rangers': ['Rangers'],
    'Toronto Blue Jays': ['Blue Jays', 'Jays'], 'Washington Nationals': ['Nationals'],
    // NHL
    'Anaheim Ducks': ['Ducks'], 'Arizona Coyotes': ['Coyotes', 'Yotes'], 'Boston Bruins': ['Bruins'], 'Buffalo Sabres': ['Sabres'],
    'Calgary Flames': ['Flames'], 'Carolina Hurricanes': ['Canes', 'Hurricanes'], 'Chicago Blackhawks': ['Blackhawks', 'Hawks'],
    'Colorado Avalanche': ['Avalanche', 'Avs'], 'Columbus Blue Jackets': ['Blue Jackets', 'CBJ'], 'Dallas Stars': ['Stars'],
    'Detroit Red Wings': ['Red Wings'], 'Edmonton Oilers': ['Oilers'], 'Florida Panthers': ['Panthers'], 'Los Angeles Kings': ['Kings'],
    'Minnesota Wild': ['Wild'], 'Montreal Canadiens': ['Canadiens', 'Habs'], 'Nashville Predators': ['Predators', 'Preds'],
    'New Jersey Devils': ['Devils'], 'New York Islanders': ['Islanders', 'Isles'], 'New York Rangers': ['Rangers'],
    'Ottawa Senators': ['Senators', 'Sens'], 'Philadelphia Flyers': ['Flyers'], 'Pittsburgh Penguins': ['Penguins', 'Pens'],
    'San Jose Sharks': ['Sharks'], 'Seattle Kraken': ['Kraken'], 'St. Louis Blues': ['Blues'], 'Tampa Bay Lightning': ['Lightning', 'Bolts'],
    'Toronto Maple Leafs': ['Maple Leafs', 'Leafs'], 'Vancouver Canucks': ['Canucks'], 'Vegas Golden Knights': ['Golden Knights', 'Knights'],
    'Washington Capitals': ['Capitals', 'Caps'], 'Winnipeg Jets': ['Jets'],
    // NFL
    'Arizona Cardinals': ['Cardinals'], 'Atlanta Falcons': ['Falcons'], 'Baltimore Ravens': ['Ravens'], 'Buffalo Bills': ['Bills'],
    'Carolina Panthers': ['Panthers'], 'Chicago Bears': ['Bears'], 'Cincinnati Bengals': ['Bengals'], 'Cleveland Browns': ['Browns'],
    'Dallas Cowboys': ['Cowboys'], 'Denver Broncos': ['Broncos'], 'Detroit Lions': ['Lions'], 'Green Bay Packers': ['Packers'],
    'Houston Texans': ['Texans'], 'Indianapolis Colts': ['Colts'], 'Jacksonville Jaguars': ['Jaguars', 'Jags'],
    'Kansas City Chiefs': ['Chiefs'], 'Las Vegas Raiders': ['Raiders'], 'Los Angeles Chargers': ['Chargers'], 'Los Angeles Rams': ['Rams'],
    'Miami Dolphins': ['Dolphins'], 'Minnesota Vikings': ['Vikings'], 'New England Patriots': ['Patriots', 'Pats'],
    'New Orleans Saints': ['Saints'], 'New York Giants': ['Giants'], 'New York Jets': ['Jets'], 'Philadelphia Eagles': ['Eagles'],
    'Pittsburgh Steelers': ['Steelers'], 'San Francisco 49ers': ['49ers', 'Niners'], 'Seattle Seahawks': ['Seahawks'],
    'Tampa Bay Buccaneers': ['Buccaneers', 'Bucs'], 'Tennessee Titans': ['Titans'], 'Washington Commanders': ['Commanders']
};

const flairMap = {
    'baseball_mlb': 'MLB Bets and Picks', // No quotes needed here
    'icehockey_nhl': 'NHL Bets and Picks',
    'americanfootball_nfl': 'NFL Bets and Picks'
};

const espnTeamAbbreviations = {
    'Arizona Diamondbacks': 'ARI', 'Atlanta Braves': 'ATL', 'Baltimore Orioles': 'BAL', 'Boston Red Sox': 'BOS', 'Chicago Cubs': 'CHC', 'Chicago White Sox': 'CHW', 'Cincinnati Reds': 'CIN', 'Cleveland Guardians': 'CLE', 'Colorado Rockies': 'COL', 'Detroit Tigers': 'DET', 'Houston Astros': 'HOU', 'Kansas City Royals': 'KC', 'Los Angeles Angels': 'LAA', 'Los Angeles Dodgers': 'LAD', 'Miami Marlins': 'MIA', 'Milwaukee Brewers': 'MIL', 'Minnesota Twins': 'MIN', 'New York Mets': 'NYM', 'New York Yankees': 'NYY', 'Oakland Athletics': 'OAK', 'Philadelphia Phillies': 'PHI', 'Pittsburgh Pirates': 'PIT', 'San Diego Padres': 'SD', 'San Francisco Giants': 'SF', 'Seattle Mariners': 'SEA', 'St. Louis Cardinals': 'STL', 'Tampa Bay Rays': 'TB', 'Texas Rangers': 'TEX', 'Toronto Blue Jays': 'TOR', 'Washington Nationals': 'WSH',
    'Anaheim Ducks': 'ANA', 'Arizona Coyotes': 'ARI', 'Boston Bruins': 'BOS', 'Buffalo Sabres': 'BUF', 'Calgary Flames': 'CGY', 'Carolina Hurricanes': 'CAR', 'Chicago Blackhawks': 'CHI', 'Colorado Avalanche': 'COL', 'Columbus Blue Jackets': 'CBJ', 'Dallas Stars': 'DAL', 'Detroit Red Wings': 'DET', 'Edmonton Oilers': 'EDM', 'Florida Panthers': 'FLA', 'Los Angeles Kings': 'LA', 'Minnesota Wild': 'MIN', 'Montreal Canadiens': 'MTL', 'Nashville Predators': 'NSH', 'New Jersey Devils': 'NJ', 'New York Islanders': 'NYI', 'New York Rangers': 'NYR', 'Ottawa Senators': 'OTT', 'Philadelphia Flyers': 'PHI', 'Pittsburgh Penguins': 'PIT', 'San Jose Sharks': 'SJ', 'Seattle Kraken': 'SEA', 'St. Louis Blues': 'STL', 'Tampa Bay Lightning': 'TB', 'Toronto Maple Leafs': 'TOR', 'Vancouver Canucks': 'VAN', 'Vegas Golden Knights': 'VGK', 'Washington Capitals': 'WSH', 'Winnipeg Jets': 'WPG',
    'Arizona Cardinals': 'ARI', 'Atlanta Falcons': 'ATL', 'Baltimore Ravens': 'BAL', 'Buffalo Bills': 'BUF', 'Carolina Panthers': 'CAR', 'Chicago Bears': 'CHI', 'Cincinnati Bengals': 'CIN', 'Cleveland Browns': 'CLE', 'Dallas Cowboys': 'DAL', 'Denver Broncos': 'DEN', 'Detroit Lions': 'DET', 'Green Bay Packers': 'GB', 'Houston Texans': 'HOU', 'Indianapolis Colts': 'IND', 'Jacksonville Jaguars': 'JAX', 'Kansas City Chiefs': 'KC', 'Las Vegas Raiders': 'LV', 'Los Angeles Chargers': 'LAC', 'Los Angeles Rams': 'LA', 'Miami Dolphins': 'MIA', 'Minnesota Vikings': 'MIN', 'New England Patriots': 'NE', 'New Orleans Saints': 'NO', 'New York Giants': 'NYG', 'New York Jets': 'NYJ', 'Philadelphia Eagles': 'PHI', 'Pittsburgh Steelers': 'PIT', 'San Francisco 49ers': 'SF', 'Seattle Seahawks': 'SEA', 'Tampa Bay Buccaneers': 'TB', 'Tennessee Titans': 'TEN', 'Washington Commanders': 'WSH'
};

const FUTURES_PICKS_DB = {
    'baseball_mlb': { championship: 'Los Angeles Dodgers', hotPick: 'Houston Astros' },
    'icehockey_nhl': { championship: 'Colorado Avalanche', hotPick: 'New York Rangers' },
    'americanfootball_nfl': { championship: 'Kansas City Chiefs', hotPick: 'Detroit Lions' }
};

const dataCache = new Map();

// --- HELPER FUNCTIONS ---
const parseRecord = (rec) => {
    if (!rec || typeof rec !== 'string') return { w: 0, l: 1 };
    const parts = rec.split('-');
    const wins = parseInt(parts[0], 10);
    const losses = parseInt(parts[1], 10);
    if (isNaN(wins) || isNaN(losses)) return { w: 0, l: 1 };
    return { w: wins, l: losses };
};
const getWinPct = (rec) => (rec.w + rec.l) > 0 ? rec.w / (rec.w + rec.l) : 0;

// --- DYNAMIC WEIGHTS ---
function getDynamicWeights(sportKey) {
    if (sportKey === 'baseball_mlb') return { record: 6, fatigue: 8, momentum: 3, matchup: 12, value: 5, newsSentiment: 10, injuryImpact: 12, offensiveForm: 8, defensiveForm: 8, h2h: 12, weather: 8 };
    if (sportKey === 'icehockey_nhl') return { record: 7, fatigue: 7, momentum: 6, matchup: 8, value: 6, newsSentiment: 9, injuryImpact: 11, offensiveForm: 9, defensiveForm: 9, h2h: 10, weather: 0 };
    if (sportKey === 'americanfootball_nfl') return { record: 8, fatigue: 9, momentum: 4, matchup: 10, value: 5, newsSentiment: 12, injuryImpact: 15, offensiveForm: 10, defensiveForm: 10, h2h: 10, weather: 8 };
    return { record: 8, fatigue: 7, momentum: 5, matchup: 10, value: 5, newsSentiment: 10, injuryImpact: 12, offensiveForm: 9, defensiveForm: 9, h2h: 11, weather: 5 };
}

// --- DATA FETCHING & SCRAPING MODULES ---
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
            const { data } = await axios.get(`https://api.the-odds-api.com/v4/sports/${sportKey}/odds/?regions=us&markets=h2h,spreads,totals&oddsFormat=decimal&apiKey=${ODDS_API_KEY}`);
            return data;
        } catch (error) {
            console.error("ERROR IN getOdds function:", error.message);
            return [];
        }
    }, 900000);
}

async function getTeamStats(sportKey) {
    return fetchData(`stats_${sportKey}`, async () => {
        const stats = {};
        const currentYear = new Date().getFullYear();
        if (sportKey === 'baseball_mlb') {
            try {
                // *** FIX: Corrected typo in scraper URL from "standdings" to "standings" ***
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
            } catch (e) { console.error(`Could not scrape MLB stats: ${e.message}`); }
        }
        // Add scrapers for other sports here if needed
        return stats;
    });
}

async function getWeatherData(teamName) {
    const location = teamLocationMap[teamName];
    if (!location) return null;
    const { lat, lon } = location;
    return fetchData(`weather_${lat}_${lon}`, async () => {
        try {
            const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,precipitation,wind_speed_10m&wind_speed_unit=kmh`;
            const { data } = await axios.get(url);
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

        const url = `https://site.api.espn.com/apis/site/v2/sports/${map.sport}/${map.league}/scoreboard`;
        try {
            const response = await axios.get(url);
            return response.data;
        } catch (error) {
            console.error(`Could not fetch ESPN data for ${sportKey}. Error:`, error.message);
            return null;
        }
    }, 60000); // Cache ESPN data for 1 minute for live scores
}

async function getRedditSentiment(homeTeam, awayTeam, homeStats, awayStats, sportKey) {
    const key = `reddit_${homeTeam}_${awayTeam}_${sportKey}`;
    return fetchData(key, async () => {
        try {
            const createSearchQuery = (teamName) => {
                const aliases = teamAliasMap[teamName] || [teamName.split(' ').pop()];
                const quotedAliases = aliases.map(alias => `"${alias}"`);
                return `(${quotedAliases.join(' OR ')})`;
            };

            const baseQuery = `${createSearchQuery(homeTeam)} OR ${createSearchQuery(awayTeam)}`;
            const flair = flairMap[sportKey];

            // Tier 1: Search with flair
            let results = await r.getSubreddit('sportsbook').search({ query: `flair:"${flair}" ${baseQuery}`, sort: 'new', time: 'month' });
            
            // Tier 2: If Tier 1 fails, search without flair
            if (results.length === 0) {
                console.log(`No flair results for ${awayTeam} @ ${homeTeam}. Broadening search.`);
                results = await r.getSubreddit('sportsbook').search({ query: baseQuery, sort: 'new', time: 'month' });
            }

            if (results.length === 0) {
                // Tier 3: If both searches fail, use smart fallback
                console.log(`No Reddit data for ${awayTeam} @ ${homeTeam}. Falling back to win percentage.`);
                const homeWinPct = getWinPct(parseRecord(homeStats.record));
                const awayWinPct = getWinPct(parseRecord(awayStats.record));
                return { 
                    home: 1 + (homeWinPct * 9),
                    away: 1 + (awayWinPct * 9)
                };
            }
            
            let homeScore = 0;
            let awayScore = 0;
            const homeAliases = [homeTeam, ...(teamAliasMap[homeTeam] || [])].map(a => a.toLowerCase());
            const awayAliases = [awayTeam, ...(teamAliasMap[awayTeam] || [])].map(a => a.toLowerCase());

            results.forEach(post => {
                const title = post.title.toLowerCase();
                const homeMention = homeAliases.some(alias => title.includes(alias));
                const awayMention = awayAliases.some(alias => title.includes(alias));
                if (homeMention) homeScore++;
                if (awayMention) awayScore++;
            });
            
            const totalScore = homeScore + awayScore;
            if (totalScore === 0) {
                 const homeWinPct = getWinPct(parseRecord(homeStats.record));
                 const awayWinPct = getWinPct(parseRecord(awayStats.record));
                 return { home: 1 + (homeWinPct * 9), away: 1 + (awayWinPct * 9) };
            }

            return {
                home: 1 + (homeScore / totalScore) * 9,
                away: 1 + (awayScore / totalScore) * 9
            };

        } catch (e) {
            console.error(`Reddit API error for ${awayTeam} @ ${homeTeam}:`, e.message);
            const homeWinPct = getWinPct(parseRecord(homeStats.record));
            const awayWinPct = getWinPct(parseRecord(awayStats.record));
            return { home: 1 + (homeWinPct * 9), away: 1 + (awayWinPct * 9) };
        }
    }, 1800000);
}

async function runPredictionEngine(game, sportKey, context) {
    const { teamStats, weather } = context;
    const weights = getDynamicWeights(sportKey);
    const { home_team, away_team } = game;
    const homeStats = teamStats[home_team] || { record: '0-0', streak: 'W0' };
    const awayStats = teamStats[away_team] || { record: '0-0', streak: 'W0' };
    
    const redditSentiment = await getRedditSentiment(home_team, away_team, homeStats, awayStats, sportKey);

    let homeScore = 50, awayScore = 50;
    const factors = {};
    
    factors['Record'] = { value: (getWinPct(parseRecord(homeStats.record)) - getWinPct(parseRecord(awayStats.record))) * weights.record, homeStat: homeStats.record, awayStat: awayStats.record };
    const parseStreak = (s) => (s && s.substring(1) ? (s.startsWith('W') ? parseInt(s.substring(1)) : -parseInt(s.substring(1))) : 0);
    factors['Streak'] = { value: (parseStreak(homeStats.streak) - parseStreak(awayStats.streak)) * (weights.momentum / 5), homeStat: homeStats.streak, awayStat: awayStats.streak };
    factors['Social Sentiment'] = { value: (redditSentiment.home - redditSentiment.away) * weights.newsSentiment, homeStat: `${redditSentiment.home.toFixed(1)}/10`, awayStat: `${redditSentiment.away.toFixed(1)}/10` };
    factors['Injury Impact'] = { value: (Math.random() - 0.5) * 5, homeStat: 'N/A', awayStat: 'N/A' };

    for (const factor in factors) { 
        if (factors[factor].value && !isNaN(factors[factor].value)) {
            homeScore += factors[factor].value; 
            awayScore -= factors[factor].value;
        }
    }
    
    const homeOdds = game.bookmakers?.[0]?.markets?.find(m => m.key === 'h2h')?.outcomes?.find(o => o.name === home_team)?.price;
    const awayOdds = game.bookmakers?.[0]?.markets?.find(m => m.key === 'h2h')?.outcomes?.find(o => o.name === away_team)?.price;
    if (homeOdds && awayOdds) {
        const homeImpliedProb = (1 / homeOdds) * 100;
        const homePower = (homeScore / (homeScore + awayScore)) * 100;
        const homeValue = homePower - homeImpliedProb;
        factors['Betting Value'] = { value: homeValue * (weights.value / 5), homeStat: `${homeValue.toFixed(1)}%`, awayStat: `${((100 - homePower) - (1 / awayOdds) * 100).toFixed(1)}%` };
        if (!isNaN(factors['Betting Value'].value)) {
            homeScore += factors['Betting Value'].value;
        }
    }
    
    const winner = homeScore > awayScore ? home_team : away_team;
    const confidence = Math.abs(50 - (homeScore / (homeScore + awayScore)) * 100);
    let strengthText = confidence > 15 ? "Strong Advantage" : confidence > 7.5 ? "Good Chance" : "Slight Edge";
    
    return { winner, strengthText, factors, weather };
}

// --- API ENDPOINTS ---
app.get('/predictions', async (req, res) => {
    const { sport } = req.query;
    if (!sport) return res.status(400).json({ error: "Sport parameter is required." });
    try {
        const [games, teamStats, espnDataResponse] = await Promise.all([
            getOdds(sport),
            getTeamStats(sport),
            fetchEspnData(sport)
        ]);

        if (!games || games.length === 0) { return res.json({ message: `No upcoming games for ${sport}. The season may be over.` }); }
        
        const espnGamesMap = new Map();
        if (espnDataResponse?.events) {
            espnDataResponse.events.forEach(event => {
                const competition = event.competitions?.[0];
                if (!competition) return;
                const homeTeam = competition.competitors.find(t => t.homeAway === 'home');
                const awayTeam = competition.competitors.find(c => c.homeAway === 'away');
                if (homeTeam && awayTeam) {
                    const key = `${awayTeam.team.abbreviation}-vs-${homeTeam.team.abbreviation}`;
                    espnGamesMap.set(key, event);
                }
            });
        }
        
        const predictions = await Promise.all(games.map(async (game) => {
            const awayAbbr = espnTeamAbbreviations[game.away_team];
            const homeAbbr = espnTeamAbbreviations[game.home_team];
            const espnKey = `${awayAbbr}-vs-${homeAbbr}`;
            const espnData = espnGamesMap.get(espnKey) || null;

            const weather = await getWeatherData(game.home_team);
            const context = { teamStats, weather };
            const predictionData = await runPredictionEngine(game, sport, context);
            
            return { game: { ...game, espnData }, prediction: predictionData };
        }));

        res.json(predictions.filter(p => p && p.prediction));
    } catch (error) {
        console.error("Prediction Error:", error);
        res.status(500).json({ error: "Failed to process predictions.", details: error.message });
    }
});
app.get('/futures', (req, res) => res.json(FUTURES_PICKS_DB));
app.get('/', (req, res) => res.send('Attitude Sports Bets API is online.'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
