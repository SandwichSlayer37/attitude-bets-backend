const mongoose = require('mongoose');
require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const axios = require('axios');
const Snoowrap = require('snoowrap');
const { MongoClient } = require('mongodb');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const QUERYABLE_TEAM_STATS = [
    'xGoalsFor', 'goalsFor', 'shotsOnGoalFor', 'shotAttemptsFor', 'missedShotsFor',
    'xGoalsAgainst', 'goalsAgainst', 'shotsOnGoalAgainst', 'shotAttemptsAgainst',
    'powerPlayPercentage', 'penaltyKillPercentage', 'GSAx', 'shootingPercentage', 'savePercentage'
];

const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, '..', 'Public')));

// --- CACHING HELPER ---
const __FUSION_CACHE = new Map();
function __cached(key, ttlMs, fetcher) {
  const now = Date.now();
  const hit = __FUSION_CACHE.get(key);
  if (hit && (now - hit.t) < ttlMs) return hit.v;
  return Promise.resolve(fetcher()).then(v => { __FUSION_CACHE.set(key, { t: now, v }); return v; });
}

// =================================================================
// ✅ FINAL, RESILIENT DATA FUSION SYSTEM
// This version uses a single, reliable API endpoint to prevent failures.
// =================================================================


async function getHistoricalGoalieData(season) {
    const cacheKey = `historical_goalie_data_${season}_v3`; // New cache key
    return fetchData(cacheKey, async () => {
        try {
            if (!goaliesHistCollection) {
                console.error("[ERROR] goaliesHistCollection is not initialized.");
                return {};
            }
            const pipeline = [
                { $match: { season: season } },
                {
                    $group: {
                        _id: "$playerId",
                        name: { $first: "$name" },
                        goals: { $sum: "$goals" },
                        xGoals: { $sum: "$xGoals" },
                    }
                }
            ];
            // FIX: Querying the correct collection now
            const results = await goaliesHistCollection.aggregate(pipeline).toArray();

            const goalieDataMap = results.reduce((acc, goalie) => {
                acc[goalie._id] = { name: goalie.name, gsax: goalie.xGoals - goalie.goals };
                return acc;
            }, {});

            console.log(`✅ Successfully processed historical data for ${Object.keys(goalieDataMap).length} goalies.`);
            return goalieDataMap;
        } catch (error) {
            console.error(`Error fetching historical goalie data for season ${season}:`, error);
            return {};
        }
    }, 86400000);
}
     
async function fetchHistoricalTeamContext(teamAbbrev) {
  try {
    if (!teamsHistCollection || !nhlStatsCollection) return {};
    const result = { team: teamAbbrev };

    try {
      // FIX: Querying the correct 'teamsHistCollection' now
      const cursor = teamsHistCollection.aggregate([
        { $match: { team: teamAbbrev, season: { $gte: 2008, $lte: 2024 } } },
        { $group: { _id:"$team",
          seasons: { $addToSet: "$season" },
          totalWins: { $sum: { $ifNull:["$wins",0]} },
          totalLosses: { $sum: { $ifNull:["$losses",0]} },
          totalOtLosses: { $sum: { $ifNull:["$otLosses",0]} },
          totalGF: { $sum: { $ifNull:["$goalsFor",0]} },
          totalGA: { $sum: { $ifNull:["$goalsAgainst",0]} },
          gamesPlayed: { $sum: { $ifNull:["$gamesPlayed",0]} },
          avgWinPct: { $avg: { $ifNull:["$winPct",0]} },
        } },
        { $limit: 1 }
      ]);
      const doc = await cursor.next();
      if (doc) {
        const totalGames = (doc.totalWins + doc.totalLosses + doc.totalOtLosses);
        result.avgWinPct = (typeof doc.avgWinPct === 'number' && !Number.isNaN(doc.avgWinPct)) ? doc.avgWinPct : (doc.totalWins / Math.max(totalGames,1));
        result.avgGF = (doc.gamesPlayed > 0) ? (doc.totalGF / doc.gamesPlayed) : undefined;
        result.avgGA = (doc.gamesPlayed > 0) ? (doc.totalGA / doc.gamesPlayed) : undefined;
        result.sampleSeasons = (doc.seasons || []).length || undefined;
      }
    } catch {}

    // fallback from nhl_advanced_stats remains the same
    if (result.avgGF == null || result.avgGA == null) {
      try {
        const adv = await nhlStatsCollection.aggregate([
          { $match: { team: teamAbbrev, season: { $gte: 2008, $lte: 2024 } } },
          { $group: { _id:"$team", totalGF:{ $sum:{ $ifNull:["$goalsFor",0]} }, totalGA:{ $sum:{ $ifNull:["$goalsAgainst",0]} }, games:{ $sum:1 } } },
          { $limit: 1 }
        ]).toArray();
        if (adv && adv[0] && adv[0].games > 0) {
          if (result.avgGF == null) result.avgGF = adv[0].totalGF / adv[0].games;
          if (result.avgGA == null) result.avgGA = adv[0].totalGA / adv[0].games;
        }
      } catch {}
    }
    return result;
  } catch { return {}; }
}
function mergeHistoricalCurrent(historical, current) {
  const wHist = 0.7, wCurr = 0.3;
  const out = { ...current };
  if (historical && Object.keys(historical).length) {
    out.historical = historical;
    if (historical.avgGF != null && current.goalsForPerGame != null) out.weightedGF = (historical.avgGF*wHist) + (current.goalsForPerGame*wCurr);
    if (historical.avgGA != null && current.goalsAgainstPerGame != null) out.weightedGA = (historical.avgGA*wHist) + (current.goalsAgainstPerGame*wCurr);
    if (historical.avgWinPct != null && current.winPct != null) out.weightedWinPct = (historical.avgWinPct*wHist) + (current.winPct*wCurr);
  }
  return out;
}

const queryNhlStatsTool = {
  functionDeclarations: [
    {
      name: "queryNhlStats",
      description: "Queries the 'nhl_advanced_stats' collection for historical NHL data. Can retrieve stats for specific skaters, goalies, or pre-aggregated teams.",
      parameters: {
        type: "OBJECT",
        properties: {
          season: {
            type: "NUMBER",
            description: "The year of the NHL season to query, e.g., 2023 for the 2023-2024 season."
          },
          dataType: {
            type: "STRING",
            description: "The type of entity to query. Supported values: 'skater', 'goalie', 'team'."
          },
          stat: {
            type: "STRING",
            description: "The exact, case-sensitive data field to query. CRITICAL: If dataType is 'team', you MUST use an aggregated team-level field like 'goalsFor', 'xGoalsFor', or 'shotsOnGoalFor'. Do NOT use player-specific fields (like those with 'I_F_' or 'onIce_' prefixes) with dataType 'team'. Player-specific fields like 'I_F_goals', 'gameScore', etc. should only be used with dataType 'skater' or 'goalie'."
          },
          playerName: {
            type: "STRING",
            description: "Optional. The full name of a specific player to query, e.g., 'Connor McDavid'. Use with dataType 'skater' or 'goalie'."
          },
          teamName: {
            type: "STRING",
            description: "Optional. The full name of a specific team to filter by, e.g., 'Edmonton Oilers'."
          },
          position: {
            type: "STRING",
            description: "Optional. Filter for a specific position, e.g., 'D', 'C', 'L', 'R'."
          },
          limit: {
            type: "NUMBER",
            description: "The number of results to return. Defaults to 5."
          },
        },
        required: ["season", "dataType", "stat"]
      }
    }
  ]
};

const ODDS_API_KEY = process.env.ODDS_API_KEY;
const DATABASE_URL = process.env.DATABASE_URL;
const RECONCILE_PASSWORD = process.env.RECONCILE_PASSWORD || "your_secret_password";
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const analysisModel = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

const chatModel = genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    tools: [queryNhlStatsTool],
});

const r = new Snoowrap({
    userAgent: process.env.REDDIT_USER_AGENT,
    clientId: process.env.REDDIT_CLIENT_ID,
    clientSecret: process.env.REDDIT_CLIENT_SECRET,
    username: process.env.REDDIT_USERNAME,
    password: process.env.REDDIT_PASSWORD
});

let db, recordsCollection, predictionsCollection, dailyFeaturesCollection, nhlStatsCollection, goaliesHistCollection, linesHistCollection, skatersHistCollection, teamsHistCollection;

async function connectToDb() {
    try {
        if (db) return db;
        const client = new MongoClient(DATABASE_URL);
        await client.connect();
        db = client.db('attitudebets');
        // Live/General Collections
        recordsCollection = db.collection('records');
        predictionsCollection = db.collection('predictions');
        dailyFeaturesCollection = db.collection('daily_features');
        nhlStatsCollection = db.collection('nhl_advanced_stats');

        // NEW: Historical Data Collections
        goaliesHistCollection = db.collection('nhl_goalie_stats_historical');
        linesHistCollection = db.collection('nhl_line_stats_historical');
        skatersHistCollection = db.collection('nhl_skater_stats_historical');
        teamsHistCollection = db.collection('nhl_teams_data_historical');

        console.log('Connected to MongoDB');
        return db;
    } catch (e) {
        console.error("Failed to connect to MongoDB", e);
        process.exit(1);
    }
}

// --- DATA MAPS ---
const teamToAbbrMap = {
    'Anaheim Ducks': 'ANA', 'Arizona Coyotes': 'ARI', 'Boston Bruins': 'BOS', 'Buffalo Sabres': 'BUF', 
    'Calgary Flames': 'CGY', 'Carolina Hurricanes': 'CAR', 'Chicago Blackhawks': 'CHI', 'Colorado Avalanche': 'COL', 
    'Columbus Blue Jackets': 'CBJ', 'Dallas Stars': 'DAL', 'Detroit Red Wings': 'DET', 'Edmonton Oilers': 'EDM', 
    'Florida Panthers': 'FLA', 'Los Angeles Kings': 'LAK', 'Minnesota Wild': 'MIN', 'Montreal Canadiens': 'MTL', 
    'Nashville Predators': 'NSH', 'New Jersey Devils': 'NJD', 'New York Islanders': 'NYI', 'New York Rangers': 'NYR', 
    'Ottawa Senators': 'OTT', 'Philadelphia Flyers': 'PHI', 'Pittsburgh Penguins': 'PIT', 'San Jose Sharks': 'SJS', 
    'Seattle Kraken': 'SEA', 'St. Louis Blues': 'STL', 'Tampa Bay Lightning': 'TBL', 'Toronto Maple Leafs': 'TOR', 
    'Vancouver Canucks': 'VAN', 'Vegas Golden Knights': 'VGK', 'Washington Capitals': 'WSH', 'Winnipeg Jets': 'WPG',
    'Utah Hockey Club': 'UTA' // Updated name for Utah
};

const SPORTS_DB = [ 
    { key: 'baseball_mlb', name: 'MLB', gameCountThreshold: 5 }, 
    { key: 'icehockey_nhl', name: 'NHL', gameCountThreshold: 5 }, 
    { key: 'americanfootball_nfl', name: 'NFL', gameCountThreshold: 4 } 
];
const teamLocationMap = {
    'Arizona Diamondbacks': { lat: 33.4453, lon: -112.0667 }, 'Atlanta Braves': { lat: 33.8907, lon: -84.4677 }, 'Baltimore Orioles': { lat: 39.2838, lon: -76.6217 }, 'Boston Red Sox': { lat: 42.3467, lon: -71.0972 }, 'Chicago Cubs': { lat: 41.9484, lon: -87.6553 }, 'Chicago White Sox': { lat: 41.8300, lon: -87.6337 }, 'Cincinnati Reds': { lat: 39.0975, lon: -84.5069 }, 'Cleveland Guardians': { lat: 41.4962, lon: -81.6852 }, 'Colorado Rockies': { lat: 39.7562, lon: -104.9942 }, 'Detroit Tigers': { lat: 42.3390, lon: -83.0552 }, 'Houston Astros': { lat: 29.7570, lon: -95.3555 }, 'Kansas City Royals': { lat: 39.0517, lon: -94.4803 }, 'Los Angeles Angels': { lat: 33.8003, lon: -117.8827 }, 'Los Angeles Dodgers': { lat: 34.0739, lon: -118.2398 }, 'Miami Marlins': { lat: 25.7781, lon: -80.2196 }, 'Milwaukee Brewers': { lat: 43.0280, lon: -87.9712 }, 'Minnesota Twins': { lat: 44.9817, lon: -93.2775 }, 'New York Mets': { lat: 40.7571, lon: -73.8458 }, 'New York Yankees': { lat: 40.8296, lon: -73.9262 }, 'Oakland Athletics': { lat: 37.7516, lon: -122.2005 }, 'Philadelphia Phillies': { lat: 39.9061, lon: -75.1665 }, 'Pittsburgh Pirates': { lat: 40.4469, lon: -80.0057 }, 'San Diego Padres': { lat: 32.7073, lon: -117.1570 }, 'San Francisco Giants': { lat: 37.7786, lon: -122.3893 }, 'Seattle Mariners': { lat: 47.5914, lon: -122.3325 }, 'St. Louis Cardinals': { lat: 38.6226, lon: -90.1928 }, 'Tampa Bay Rays': { lat: 27.7682, lon: -82.6534 }, 'Texas Rangers': { lat: 32.7513, lon: -97.0829 }, 'Toronto Blue Jays': { lat: 43.6414, lon: -79.3894 }, 'Washington Nationals': { lat: 38.8729, lon: -77.0074 },
    'Arizona Cardinals': { lat: 33.5276, lon: -112.2625 }, 'Atlanta Falcons': { lat: 33.7554, lon: -84.4009 }, 'Baltimore Ravens': { lat: 39.2780, lon: -76.6227 }, 'Buffalo Bills': { lat: 42.7738, lon: -78.7870 }, 'Carolina Panthers': { lat: 35.2259, lon: -80.8529 }, 'Chicago Bears': { lat: 41.8623, lon: -87.6167 }, 'Cincinnati Bengals': { lat: 39.0954, lon: -84.5160 }, 'Cleveland Browns': { lat: 41.5061, lon: -81.6995 }, 'Dallas Cowboys': { lat: 32.7478, lon: -97.0929 }, 'Denver Broncos': { lat: 39.7439, lon: -105.0201 }, 'Detroit Lions': { lat: 42.3400, lon: -83.0456 }, 'Green Bay Packers': { lat: 44.5013, lon: -88.0622 }, 'Houston Texans': { lat: 29.6847, lon: -95.4109 }, 'Indianapolis Colts': { lat: 39.7601, lon: -86.1639 }, 'Jacksonville Jaguars': { lat: 30.3239, lon: -81.6375 }, 'Kansas City Chiefs': { lat: 39.0489, lon: -94.4839 }, 'Las Vegas Raiders': { lat: 36.0907, lon: -115.1838 }, 'Los Angeles Chargers': { lat: 33.9535, lon: -118.3392 }, 'Los Angeles Rams': { lat: 33.9535, lon: -118.3392 }, 'Miami Dolphins': { lat: 25.9580, lon: -80.2389 }, 'Minnesota Vikings': { lat: 44.9736, lon: -93.2579 }, 'New England Patriots': { lat: 42.0909, lon: -71.2643 }, 'New Orleans Saints': { lat: 29.9509, lon: -90.0821 }, 'New York Giants': { lat: 40.8136, lon: -74.0744 }, 'New York Jets': { lat: 40.8136, lon: -74.0744 }, 'Philadelphia Eagles': { lat: 39.9008, lon: -75.1675 }, 'Pittsburgh Steelers': { lat: 40.4467, lon: -80.0158 }, 'San Francisco 49ers': { lat: 37.4031, lon: -121.9697 }, 'Seattle Seahawks': { lat: 47.5952, lon: -122.3316 }, 'Tampa Bay Buccaneers': { lat: 27.9759, lon: -82.5033 }, 'Tennessee Titans': { lat: 36.1665, lon: -86.7713 }, 'Washington Commanders': { lat: 38.9077, lon: -76.8645 },
    'Anaheim Ducks': { lat: 33.8078, lon: -117.8766 }, 'Arizona Coyotes': { lat: 33.5319, lon: -112.2611 }, 'Boston Bruins': { lat: 42.3662, lon: -71.0621 }, 'Buffalo Sabres': { lat: 42.8751, lon: -78.8765 }, 'Calgary Flames': { lat: 51.0375, lon: -114.0519 }, 'Carolina Hurricanes': { lat: 35.8033, lon: -78.7219 }, 'Chicago Blackhawks': { lat: 41.8807, lon: -87.6742 }, 'Colorado Avalanche': { lat: 39.7486, lon: -105.0076 }, 'Columbus Blue Jackets': { lat: 39.9695, lon: -83.0060 }, 'Dallas Stars': { lat: 32.7905, lon: -96.8103 }, 'Detroit Red Wings': { lat: 42.3411, lon: -83.0553 }, 'Edmonton Oilers': { lat: 53.5469, lon: -113.4973 }, 'Florida Panthers': { lat: 26.1585, lon: -80.3255 }, 'Los Angeles Kings': { lat: 34.0430, lon: -118.2673 }, 'Minnesota Wild': { lat: 44.9447, lon: -93.1008 }, 'Montreal Canadiens': { lat: 45.4965, lon: -73.5694 }, 'Nashville Predators': { lat: 36.1593, lon: -86.7785 }, 'New Jersey Devils': { lat: 40.7336, lon: -74.1711 }, 'New York Islanders': { lat: 40.7230, lon: -73.5925 }, 'New York Rangers': { lat: 40.7505, lon: -73.9934 }, 'Ottawa Senators': { lat: 45.2969, lon: -75.9281 }, 'Philadelphia Flyers': { lat: 39.9012, lon: -75.1720 }, 'Pittsburgh Penguins': { lat: 40.4395, lon: -79.9896 }, 'San Jose Sharks': { lat: 37.3328, lon: -121.9012 }, 'Seattle Kraken': { lat: 47.6221, lon: -122.3539 }, 'St. Louis Blues': { lat: 38.6268, lon: -90.2027 }, 'Tampa Bay Lightning': { lat: 27.9427, lon: -82.4518 }, 'Toronto Maple Leafs': { lat: 43.6435, lon: -79.3791 }, 'Vancouver Canucks': { lat: 49.2778, lon: -123.1089 }, 'Vegas Golden Knights': { lat: 36.0967, lon: -115.1783 }, 'Washington Capitals': { lat: 38.8982, lon: -77.0209 }, 'Winnipeg Jets': { lat: 49.8927, lon: -97.1435 },
    'Utah Hockey Club': { lat: 40.7608, lon: -111.8910 }
};
const teamAliasMap = {
    'Arizona Diamondbacks': ['D-backs', 'Diamondbacks'], 'Atlanta Braves': ['Braves'], 'Baltimore Orioles': ['Orioles'], 'Boston Red Sox': ['Red Sox'], 'Chicago Cubs': ['Cubs'], 'Chicago White Sox': ['White Sox', 'ChiSox'], 'Cincinnati Reds': ['Reds'], 'Cleveland Guardians': ['Guardians'], 'Colorado Rockies': ['Rockies'], 'Detroit Tigers': ['Tigers'], 'Houston Astros': ['Astros'], 'Kansas City Royals': ['Royals'], 'Los Angeles Angels': ['Angels'], 'Los Angeles Dodgers': ['Dodgers'], 'Miami Marlins': ['Marlins'], 'Milwaukee Brewers': ['Brewers'], 'Minnesota Twins': ['Twins'], 'New York Mets': ['Mets'], 'New York Yankees': ['Yankees'], 'Oakland Athletics': ["A's", 'Athletics', "Oakland A's"], 'Philadelphia Phillies': ['Phillies'], 'Pittsburgh Pirates': ['Pirates'], 'San Diego Padres': ['Padres', 'Friars'], 'San Francisco Giants': ['Giants'], 'Seattle Mariners': ['Mariners', "M's"], 'St. Louis Cardinals': ['Cardinals', 'Cards', 'St Louis Cardinals'], 'Tampa Bay Rays': ['Rays'], 'Texas Rangers': ['Rangers'], 'Toronto Blue Jays': ['Blue Jays', 'Jays'], 'Washington Nationals': ['Nationals'],
    'Arizona Cardinals': ['Cardinals'], 'Atlanta Falcons': ['Falcons'], 'Baltimore Ravens': ['Ravens'], 'Buffalo Bills': ['Bills'], 'Carolina Panthers': ['Panthers'], 'Chicago Bears': ['Bears'], 'Cincinnati Bengals': ['Bengals'], 'Cleveland Browns': ['Browns'], 'Dallas Cowboys': ['Cowboys'], 'Denver Broncos': ['Broncos'], 'Detroit Lions': ['Lions'], 'Green Bay Packers': ['Packers'], 'Houston Texans': ['Texans'], 'Indianapolis Colts': ['Colts'], 'Jacksonville Jaguars': ['Jaguars'], 'Kansas City Chiefs': ['Chiefs'], 'Las Vegas Raiders': ['Raiders'], 'Los Angeles Chargers': ['Chargers'], 'Los Angeles Rams': ['Rams'], 'Miami Dolphins': ['Dolphins'], 'Minnesota Vikings': ['Vikings'], 'New England Patriots': ['Patriots'], 'New Orleans Saints': ['Saints'], 'New York Giants': ['Giants'], 'New York Jets': ['Jets'], 'Philadelphia Eagles': ['Eagles'], 'Pittsburgh Steelers': ['Steelers'], 'San Francisco 49ers': ['49ers'], 'Seattle Seahawks': ['Seahawks'], 'Tampa Bay Buccaneers': ['Buccaneers'], 'Tennessee Titans': ['Titans'], 'Washington Commanders': ['Commanders', 'Football Team'],
    'Anaheim Ducks': ['Ducks', 'Anaheim'], 'Arizona Coyotes': ['Coyotes'], 'Boston Bruins': ['Bruins', 'Boston'], 'Buffalo Sabres': ['Sabres', 'Buffalo'], 'Calgary Flames': ['Flames', 'Calgary'], 'Carolina Hurricanes': ['Hurricanes', 'Canes', 'Carolina'], 'Chicago Blackhawks': ['hawks', 'Blackhawks', 'Chicago'], 'Colorado Avalanche': ['ColoradoAvalanche', 'Avalanche', 'Avs', 'Colorado'], 'Columbus Blue Jackets': ['BlueJackets', 'Blue Jackets', 'CBJ', 'Columbus'], 'Dallas Stars': ['DallasStars', 'Stars', 'Dallas'], 'Detroit Red Wings': ['DetroitRedWings', 'Red Wings', 'Detroit'], 'Edmonton Oilers': ['EdmontonOilers', 'Oilers', 'Edmonton'], 'Florida Panthers': ['FloridaPanthers', 'Panthers', 'Florida'], 'Los Angeles Kings': ['losangeleskings', 'Kings', 'Los Angeles'], 'Minnesota Wild': ['wildhockey', 'Wild', 'Minnesota'], 'Montreal Canadiens': ['Habs', 'Canadiens', 'Montréal'], 'Nashville Predators': ['Predators', 'Nashville'], 'New Jersey Devils': ['devils', 'New Jersey'], 'New York Islanders': ['NewYorkIslanders', 'Islanders', 'Isles', 'NY Islanders'], 'New York Rangers': ['rangers', 'NYR', 'NY Rangers'], 'Ottawa Senators': ['OttawaSenators', 'Senators', 'Sens', 'Ottawa'], 'Philadelphia Flyers': ['Flyers', 'Philadelphia'], 'Pittsburgh Penguins': ['penguins', 'Pittsburgh'], 'San Jose Sharks': ['SanJoseSharks', 'Sharks', 'San Jose'], 'Seattle Kraken': ['SeattleKraken', 'Kraken', 'Seattle'], 'St. Louis Blues': ['stlouisblues', 'Blues', 'St Louis Blues', 'St. Louis'], 'Tampa Bay Lightning': ['TampaBayLightning', 'Lightning', 'Bolts', 'Tampa Bay'], 'Toronto Maple Leafs': ['leafs', 'Maple Leafs', 'TOR', 'Toronto'], 'Vancouver Canucks': ['canucks', 'Vancouver'], 'Vegas Golden Knights': ['goldenknights', 'Golden Knights', 'Knights', 'Vegas'], 'Washington Capitals': ['caps', 'Capitals', 'Washington'], 'Winnipeg Jets': ['winnipegjets', 'Jets', 'Winnipeg'], 'Utah Hockey Club': ['Utah']
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

const teamToSubredditMap = {
    'Anaheim Ducks': 'ducks', 'Arizona Coyotes': 'Coyotes', 'Boston Bruins': 'BostonBruins', 'Buffalo Sabres': 'sabres', 'Calgary Flames': 'CalgaryFlames', 'Carolina Hurricanes': 'canes', 'Chicago Blackhawks': 'hawks', 'Colorado Avalanche': 'ColoradoAvalanche', 'Columbus Blue Jackets': 'BlueJackets', 'Dallas Stars': 'DallasStars', 'Detroit Red Wings': 'DetroitRedWings', 'Edmonton Oilers': 'EdmontonOilers', 'Florida Panthers': 'FloridaPanthers', 'Los Angeles Kings': 'losangeleskings', 'Minnesota Wild': 'wildhockey', 'Montreal Canadiens': 'Habs', 'Nashville Predators': 'Predators', 'New Jersey Devils': 'devils', 'New York Islanders': 'NewYorkIslanders', 'New York Rangers': 'rangers', 'Ottawa Senators': 'OttawaSenators', 'Philadelphia Flyers': 'Flyers', 'Pittsburgh Penguins': 'penguins', 'San Jose Sharks': 'SanJoseSharks', 'Seattle Kraken': 'SeattleKraken', 'St. Louis Blues': 'stlouisblues', 'Tampa Bay Lightning': 'TampaBayLightning', 'Toronto Maple Leafs': 'leafs', 'Vancouver Canucks': 'canucks', 'Vegas Golden Knights': 'goldenknights', 'Washington Capitals': 'caps', 'Winnipeg Jets': 'winnipegjets', 'Utah Hockey Club': 'UtahHockey',
    'Arizona Diamondbacks': 'azdiamondbacks', 'Atlanta Braves': 'Braves', 'Baltimore Orioles': 'orioles', 'Boston Red Sox': 'redsox', 'Chicago Cubs': 'CHICubs', 'Chicago White Sox': 'whitesox', 'Cincinnati Reds': 'reds', 'Cleveland Guardians': 'ClevelandGuardians', 'Colorado Rockies': 'ColoradoRockies', 'Detroit Tigers': 'motorcitykitties', 'Houston Astros': 'Astros', 'Kansas City Royals': 'KCRoyals', 'Los Angeles Angels': 'angelsbaseball', 'Los Angeles Dodgers': 'Dodgers', 'Miami Marlins': 'miamimarlins', 'Milwaukee Brewers': 'Brewers', 'Minnesota Twins': 'minnesotatwins', 'New York Mets': 'NewYorkMets', 'New York Yankees': 'NYYankees', 'Oakland Athletics': 'oaklandathletics', 'Philadelphia Phillies': 'phillies', 'Pittsburgh Pirates': 'buccos', 'San Diego Padres': 'Padres', 'San Francisco Giants': 'SFGiants', 'Seattle Mariners': 'Mariners', 'St. Louis Cardinals': 'Cardinals', 'Tampa Bay Rays': 'tampabayrays', 'Texas Rangers': 'TexasRangers', 'Toronto Blue Jays': 'TorontoBlueJays', 'Washington Nationals': 'Nationals',
};

// --- HELPER FUNCTIONS ---
function safeNum(value) {
    const num = parseFloat(value);
    return (typeof num === 'number' && !isNaN(num)) ? num : 0;
}

function safeText(value) {
    return (value && value !== 'undefined' && value !== 'null') ? String(value) : 'N/A';
}

function parseEspnTeamStats(espnEvents) {
    const stats = {};
    if (!espnEvents) return stats;
    espnEvents.forEach(event => {
        const comp = event.competitions?.[0];
        if (!comp) return;
        comp.competitors.forEach(team => {
            const name = team.team.displayName;
            const canonical = canonicalTeamNameMap[name.toLowerCase()] || name;
            if (!stats[canonical]) stats[canonical] = {};
            const overallRecord = team.records?.find(r => r.type === 'total');
            stats[canonical].record = overallRecord?.summary || '0-0-0';
        });
    });
    return stats;
}

// New helper function to get key historical data before calling the AI
async function getAiContextualData(teamName, season) {
    try {
        const canonicalName = canonicalTeamNameMap[teamName.toLowerCase()];
        const teamAbbr = canonicalName ? teamToAbbrMap[canonicalName] : teamName.toUpperCase();
        if (!teamAbbr || !nhlStatsCollection) return null;

        const pipeline = [
            { $match: { team: teamAbbr, season: season } },
            {
                $group: {
                    _id: "$team",
                    goalsFor: { $sum: "$goalsFor" },
                    xGoalsFor: { $sum: "$xGoalsFor" },
                    goalsAgainst: { $sum: "$goalsAgainst" },
                    xGoalsAgainst: { $sum: "$xGoalsAgainst" },
                    shotsOnGoalFor: { $sum: "$shotsOnGoalFor" },
                    shotsOnGoalAgainst: { $sum: "$shotsOnGoalAgainst" }
                }
            }
        ];
        const result = await nhlStatsCollection.aggregate(pipeline).toArray();
        return result[0] || { _id: teamAbbr, goalsFor: 'N/A' }; // Return found data or a default
    } catch (error) {
        console.error(`Error fetching AI contextual data for ${teamName}:`, error);
        return null;
    }
}

function cleanAndParseJson(text) {
    if (!text || typeof text !== 'string') {
        console.error("cleanAndParseJson received invalid input:", text);
        return null;
    }
    // A more robust regex to find the outermost JSON object
    const jsonRegex = /```json\s*({[\s\S]*?})\s*```|({[\s\S]*})/;
    const match = text.match(jsonRegex);

    if (match) {
        // Prefer the content of a markdown block if it exists (group 1), otherwise use the raw object (group 2)
        const jsonString = match[1] || match[2];
        try {
            return JSON.parse(jsonString);
        } catch (e) {
            console.error("Failed to parse the extracted JSON string:", jsonString);
            console.error("Parsing Error:", e.message);
            return null;
        }
    } else {
        console.error("Could not find a valid JSON object in the text:", text);
        return null;
    }
}

// Fetches and processes live goalie stats for the current season.
async function getGoalieStats() {
    // Using a new cache key for the updated endpoint
    const cacheKey = `live_goalie_stats_v4_${new Date().toISOString().slice(0, 10)}`;
    return fetchData(cacheKey, async () => {
        try {
            // This is a different, more stable API endpoint for player summaries
            const url = 'https://api.nhle.com/stats/rest/en/goalie/summary';
            console.log("📡 Fetching live goalie stats from new summary API...");
            const { data } = await axios.get(url);
            const goalieStatsMap = {};

            if (data && data.data) {
                data.data.forEach(goalie => {
                    // This API uses a different name format
                    const fullName = `${goalie.firstName} ${goalie.lastName}`;
                    goalieStatsMap[fullName] = {
                        playerId: goalie.playerId,
                        gaa: goalie.gaa,

                        svPct: goalie.savePct,
                    };
                });
                console.log(`✅ Successfully processed stats for ${Object.keys(goalieStatsMap).length} goalies.`);
                return goalieStatsMap;
            }
            // If the data is not in the expected format, return empty
            return {};
        } catch (error) {
            // CRITICAL: If the API call fails, log the error but return an empty object
            // This prevents the entire application from crashing.
            console.error(`[WARN] Could not fetch live goalie stats: ${error.message}. Proceeding without them.`);
            return {};
        }
    }, 3600000); // Cache for 1 hour
}

// NEW: Resilient function to fetch live team stats with a fallback
// NEW: Resilient function to fetch live team stats with a fallback
async function getLiveTeamStats() {
    try {
        // First, try the more detailed but sometimes unstable API
        const { data: teamStatsData } = await axios.get('https://api-web.nhle.com/v1/club-stats/now/All');
        if (!teamStatsData || teamStatsData.length === 0) throw new Error("Club stats returned empty.");

        const fusedTeamData = teamStatsData.reduce((acc, team) => {
            acc[team.abbreviation] = {
                record: `${team.wins}-${team.losses}-${team.otLosses}`,
                streak: `${team.streakCode}${team.streakCount}`,
                goalsForPerGame: team.goalsForPerGame,
                goalsAgainstPerGame: team.goalsAgainstPerGame,
                faceoffWinPct: team.faceoffWinPct,
            };
            return acc;
        }, {});
        console.log(`✅ Successfully fetched live stats from primary club-stats API.`);
        return fusedTeamData;
    } catch (e) {
        // If it fails, fall back to the simpler but more reliable standings API
        console.warn(`[WARN] Primary club-stats API failed. Falling back to standings API.`);
        const { data: standingsDataResponse } = await axios.get('https://api-web.nhle.com/v1/standings/now');
        if (!standingsDataResponse || !standingsDataResponse.standings) throw new Error("Fallback standings API also failed.");
        
        return (standingsDataResponse.standings).reduce((acc, team) => {
            const abbr = team.teamAbbrev.default;
            if (abbr) {
                const gamesPlayed = safeNum(team.gamesPlayed);
                acc[abbr] = {
                    record: `${team.wins}-${team.losses}-${team.otLosses}`,
                    streak: `${team.streakCode}${team.streakCount}`,
                    goalsForPerGame: gamesPlayed > 0 ? safeNum(team.goalsFor) / gamesPlayed : 0,
                    goalsAgainstPerGame: gamesPlayed > 0 ? safeNum(team.goalsAgainst) / gamesPlayed : 0,
                    faceoffWinPct: 0, // Not available in this API
                };
            }
            return acc;
        }, {});
    }
}

async function fetchData(key, fetcherFn, ttl = 3600000) {
    if (dataCache.has(key) && (Date.now() - dataCache.get(key).timestamp < ttl)) {
        return dataCache.get(key).data;
    }
    const data = await fetcherFn();
    dataCache.set(key, { data, timestamp: Date.now() });
    return data;
}

async function getOdds(sportKey) {
    const cacheKey = `odds_${sportKey}`;
    return fetchData(cacheKey, async () => {
        try {
            const { data } = await axios.get(`https://api.the-odds-api.com/v4/sports/${sportKey}/odds`, {
                params: {
                    apiKey: ODDS_API_KEY,
                    regions: 'us',
                    markets: 'h2h',
                    oddsFormat: 'decimal',
                }
            });
            return data;
        } catch (error) {
            console.error(`Could not fetch odds for ${sportKey}:`, error.response ? error.response.data.message : error.message);
            return [];
        }
    }, 300000); // Cache for 5 minutes
}

// =================================================================
// ✅ FINAL, ROBUST AI INTERACTION FUNCTION
// This version gracefully handles cases where the AI's tool finds no data,
// preventing the final analysis from failing.
// =================================================================
async function runAiChatWithTools(userPrompt) {
    const systemPrompt = `You are a master sports betting analyst. Your task is to synthesize the provided statistical report and news to produce a detailed, data-driven strategic breakdown. Use your 'queryNhlStats' tool to find deeper historical stats that could influence the outcome. You must always return your final analysis in the specified JSON format. If your tool call returns an error or no data, you must indicate that in your final analysis.`;
    const chat = chatModel.startChat({
        systemInstruction: { parts: [{ text: systemPrompt }] },
    });

    const result1 = await chat.sendMessage(userPrompt);
    const response1 = result1.response;

    // LOGGING: See the raw response text from the AI
    const responseText = response1.text();
    console.log("----------- RAW AI RESPONSE (Attempt 1) -----------");
    console.log(responseText);
    console.log("-------------------------------------------------");

    const functionCalls = response1.functionCalls() || [];

    if (functionCalls && functionCalls.length > 0) {
        const call = functionCalls[0];
        console.log(`AI is requesting to call function: ${call.name} with args:`, call.args);

        if (call.name === 'queryNhlStats') {
            const apiResponse = await queryNhlStats(call.args);
            
            if (apiResponse.error || !apiResponse.results || apiResponse.results.length === 0) {
                console.error("Tool call to queryNhlStats returned no data or an error:", apiResponse.error || "No results found.");
                const result2 = await chat.sendMessage([{ functionResponse: { name: call.name, response: { error: "No data was found for the specified criteria." } } }]);
                
                const responseText2 = result2.response.text();
                console.log("----------- RAW AI RESPONSE (After Tool Error) -----------");
                console.log(responseText2);
                console.log("----------------------------------------------------------");
                return cleanAndParseJson(responseText2);
            }

            const result2 = await chat.sendMessage([{ functionResponse: { name: call.name, response: apiResponse } }]);
            const responseText2 = result2.response.text();
            console.log("----------- RAW AI RESPONSE (After Tool Success) -----------");
            console.log(responseText2);
            console.log("------------------------------------------------------------");
            return cleanAndParseJson(responseText2);
        }
    }
    
    // This path is for when the AI doesn't use a tool.
    return cleanAndParseJson(responseText);
}


async function getHistoricalTopLineMetrics(season) {
    // FIX: These two lines were missing. They define the variables needed below.
    const primarySeason = parseInt(String(season), 10);
    const fallbackSeason = primarySeason - 1;

    const fetchMetricsForSeason = async (year) => {
        const cacheKey = `historical_topline_${year}_v10_FINAL`;
        return fetchData(cacheKey, async () => {
            try {
                if (!linesHistCollection) {
                    console.error("[ERROR] linesHistCollection is not initialized.");
                    return {};
                }
                const pipeline = [
                    { $match: { season: year, position: 'line' } },
                    { $addFields: { rankAsInt: { $toInt: "$iceTimeRank" } } },
                    { $sort: { team: 1, rankAsInt: 1 } },
                    {
                        $group: {
                            _id: "$team",
                            topXgPercentage: { $first: { $toDouble: "$xGoalsPercentage" } }
                        }
                    },
                    { $project: { _id: 0, team: "$_id", xGoalsPercentage: "$topXgPercentage" } }
                ];
                const results = await linesHistCollection.aggregate(pipeline).toArray();
                const metrics = {};
                results.forEach(lineData => {
                    metrics[lineData.team] = { xGoalsPercentage: lineData.xGoalsPercentage };
                });
                return metrics;
            } catch (error) {
                console.error(`Error fetching historical top line metrics for season ${year}:`, error);
                return {};
            }
        }, 86400000);
    };

    let results = await fetchMetricsForSeason(primarySeason);
    if (Object.keys(results).length === 0) {
        results = await fetchMetricsForSeason(fallbackSeason);
    }
    return results;
}

async function getHistoricalTeamAndGoalieMetrics(season) {
    const cacheKey = `historical_metrics_${season}_v4`;
    return fetchData(cacheKey, async () => {
        try {
            const pipeline = [
                { $match: { season: season } },
                {
                    $group: {
                        _id: "$team",
                        goalsFor: { $sum: "$goalsFor" },
                        xGoalsFor: { $sum: "$xGoalsFor" },
                        penalityMinutes: { $sum: "$penalityMinutes" },
                        goalies: {
                            $push: {
                                $cond: [
                                    { $eq: ["$position", "G"] },
                                    { name: "$name", goals: "$goals", xGoals: "$xGoals", situation: "$situation" },
                                    "$$REMOVE"
                                ]
                            }
                        }
                    }
                }
            ];
            const results = await nhlStatsCollection.aggregate(pipeline).toArray();
            
            const metrics = {};
            results.forEach(teamData => {
                metrics[teamData._id] = {
                    goalsFor: teamData.goalsFor,
                    xGoalsFor: teamData.xGoalsFor,
                    penalityMinutes: teamData.penalityMinutes,
                    goalies: teamData.goalies.filter(g => g.situation === 'all')
                };
            });
            return metrics;
        } catch (error) {
            console.error(`Error fetching historical metrics for season ${season}:`, error);
            return {};
        }
    }, 86400000);
}

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

async function getTeamNewsFromReddit(teamName) {
    try {
        const subredditName = teamToSubredditMap[teamName];
        if (!subredditName) return "No subreddit found.";
        
        const submissions = await r.getSubreddit(subredditName).getTop({ time: 'week', limit: 5 });
        return submissions.map(post => `- ${post.title}`).join('\n');
    } catch (error) {
        console.error(`Could not fetch Reddit news for ${teamName}:`, error.message);
        return "Could not fetch news.";
    }
}

const ALLOWED_STATS = new Set(['playerId','season','name','team','position','situation','games_played','icetime','xGoals','goals','unblocked_shot_attempts','xRebounds','rebounds','xFreeze','freeze','xOnGoal','ongoal','xPlayStopped','playStopped','xPlayContinuedInZone','playContinuedInZone','xPlayContinuedOutsideZone','playContinuedOutsideZone','flurryAdjustedxGoals','lowDangerShots','mediumDangerShots','highDangerShots','lowDangerxGoals','mediumDangerxGoals','highDangerxGoals','lowDangerGoals','mediumDangerGoals','highDangerGoals','blocked_shot_attempts','penalityMinutes','penalties','lineId','iceTimeRank','xGoalsPercentage','corsiPercentage','fenwickPercentage','xOnGoalFor','xGoalsFor','xReboundsFor','xFreezeFor','xPlayStoppedFor','xPlayContinuedInZoneFor','xPlayContinuedOutsideZoneFor','flurryAdjustedxGoalsFor','scoreVenueAdjustedxGoalsFor','flurryScoreVenueAdjustedxGoalsFor','shotsOnGoalFor','missedShotsFor','blockedShotAttemptsFor','shotAttemptsFor','goalsFor','reboundsFor','reboundGoalsFor','freezeFor','playStoppedFor','playContinuedInZoneFor','playContinuedOutsideZoneFor','savedShotsOnGoalFor','savedUnblockedShotAttemptsFor','penaltiesFor','penalityMinutesFor','faceOffsWonFor','hitsFor','takeawaysFor','giveawaysFor','lowDangerShotsFor','mediumDangerShotsFor','highDangerShotsFor','lowDangerxGoalsFor','mediumDangerxGoalsFor','highDangerxGoalsFor','lowDangerGoalsFor','mediumDangerGoalsFor','highDangerGoalsFor','scoreAdjustedShotsAttemptsFor','unblockedShotAttemptsFor','scoreAdjustedUnblockedShotAttemptsFor','dZoneGiveawaysFor','xGoalsFromxReboundsOfShotsFor','xGoalsFromActualReboundsOfShotsFor','reboundxGoalsFor','totalShotCreditFor','scoreAdjustedTotalShotCreditFor','scoreFlurryAdjustedTotalShotCreditFor','xOnGoalAgainst','xGoalsAgainst','xReboundsAgainst','xFreezeAgainst','xPlayStoppedAgainst','xPlayContinuedInZoneAgainst','xPlayContinuedOutsideZoneAgainst','flurryAdjustedxGoalsAgainst','scoreVenueAdjustedxGoalsAgainst','flurryScoreVenueAdjustedxGoalsAgainst','shotsOnGoalAgainst','missedShotsAgainst','blockedShotAttemptsAgainst','shotAttemptsAgainst','goalsAgainst','reboundsAgainst','reboundGoalsAgainst','freezeAgainst','playStoppedAgainst','playContinuedInZoneAgainst','playContinuedOutsideZoneAgainst','savedShotsOnGoalAgainst','savedUnblockedShotAttemptsAgainst','penaltiesAgainst','penalityMinutesAgainst','faceOffsWonAgainst','hitsAgainst','takeawaysAgainst','giveawaysAgainst','lowDangerShotsAgainst','mediumDangerShotsAgainst','highDangerShotsAgainst','lowDangerxGoalsAgainst','mediumDangerxGoalsAgainst','highDangerxGoalsAgainst','lowDangerGoalsAgainst','mediumDangerGoalsAgainst','highDangerGoalsAgainst','scoreAdjustedShotsAttemptsAgainst','unblockedShotAttemptsAgainst','scoreAdjustedUnblockedShotAttemptsAgainst','dZoneGiveawaysAgainst','xGoalsFromxReboundsOfShotsAgainst','xGoalsFromActualReboundsOfShotsAgainst','reboundxGoalsAgainst','totalShotCreditAgainst','scoreAdjustedTotalShotCreditAgainst','scoreFlurryAdjustedTotalShotCreditAgainst','shifts','gameScore','onIce_xGoalsPercentage','offIce_xGoalsPercentage','onIce_corsiPercentage','offIce_corsiPercentage','onIce_fenwickPercentage','offIce_fenwickPercentage','I_F_xOnGoal','I_F_xGoals','I_F_xRebounds','I_F_xFreeze','I_F_xPlayStopped','I_F_xPlayContinuedInZone','I_F_xPlayContinuedOutsideZone','I_F_flurryAdjustedxGoals','I_F_scoreVenueAdjustedxGoals','I_F_flurryScoreVenueAdjustedxGoals','I_F_primaryAssists','I_F_secondaryAssists','I_F_shotsOnGoal','I_F_missedShots','I_F_blockedShotAttempts','I_F_shotAttempts','I_F_points','I_F_goals','I_F_rebounds','I_F_reboundGoals','I_F_freeze','I_F_playStopped','I_F_playContinuedInZone','I_F_playContinuedOutsideZone','I_F_savedShotsOnGoal','I_F_savedUnblockedShotAttempts','I_F_penalityMinutes','I_F_faceOffsWon','I_F_hits','I_F_takeaways','I_F_giveaways','I_F_lowDangerShots','I_F_mediumDangerShots','I_F_highDangerShots','I_F_lowDangerxGoals','I_F_mediumDangerxGoals','I_F_highDangerxGoals','I_F_lowDangerGoals','I_F_mediumDangerGoals','I_F_highDangerGoals','I_F_scoreAdjustedShotsAttempts','I_F_unblockedShotAttempts','I_F_scoreAdjustedUnblockedShotAttempts','I_F_dZoneGiveaways','I_F_xGoalsFromxReboundsOfShots','I_F_xGoalsFromActualReboundsOfShots','I_F_reboundxGoals','I_F_xGoals_with_earned_rebounds','I_F_xGoals_with_earned_rebounds_scoreAdjusted','I_F_xGoals_with_earned_rebounds_scoreFlurryAdjusted','I_F_shifts','I_F_oZoneShiftStarts','I_F_dZoneShiftStarts','I_F_neutralZoneShiftStarts','I_F_flyShiftStarts','I_F_oZoneShiftEnds','I_F_dZoneShiftEnds','I_F_neutralZoneShiftEnds','I_F_flyShiftEnds','faceoffsWon','faceoffsLost','timeOnBench','penalityMinutesDrawn','penaltiesDrawn','shotsBlockedByPlayer','OnIce_F_xOnGoal','OnIce_F_xGoals','OnIce_F_flurryAdjustedxGoals','OnIce_F_scoreVenueAdjustedxGoals','OnIce_F_flurryScoreVenueAdjustedxGoals','OnIce_F_shotsOnGoal','OnIce_F_missedShots','OnIce_F_blockedShotAttempts','OnIce_F_shotAttempts','OnIce_F_goals','OnIce_F_rebounds','OnIce_F_reboundGoals','OnIce_F_lowDangerShots','OnIce_F_mediumDangerShots','OnIce_F_highDangerShots','OnIce_F_lowDangerxGoals','OnIce_F_mediumDangerxGoals','OnIce_F_highDangerxGoals','OnIce_F_lowDangerGoals','OnIce_F_mediumDangerGoals','OnIce_F_highDangerGoals','OnIce_F_scoreAdjustedShotsAttempts','OnIce_F_unblockedShotAttempts','OnIce_F_scoreAdjustedUnblockedShotAttempts','OnIce_F_xGoalsFromxReboundsOfShots','OnIce_F_xGoalsFromActualReboundsOfShots','OnIce_F_reboundxGoals','OnIce_F_xGoals_with_earned_rebounds','OnIce_F_xGoals_with_earned_rebounds_scoreAdjusted','OnIce_F_xGoals_with_earned_rebounds_scoreFlurryAdjusted','OnIce_A_xOnGoal','OnIce_A_xGoals','OnIce_A_flurryAdjustedxGoals','OnIce_A_scoreVenueAdjustedxGoals','OnIce_A_flurryScoreVenueAdjustedxGoals','OnIce_A_shotsOnGoal','OnIce_A_missedShots','OnIce_A_blockedShotAttempts','OnIce_A_shotAttempts','OnIce_A_goals','OnIce_A_rebounds','OnIce_A_reboundGoals','OnIce_A_lowDangerShots','OnIce_A_mediumDangerShots','OnIce_A_highDangerShots','OnIce_A_lowDangerxGoals','OnIce_A_mediumDangerxGoals','OnIce_A_highDangerxGoals','OnIce_A_lowDangerGoals','OnIce_A_mediumDangerGoals','OnIce_A_highDangerGoals','OnIce_A_scoreAdjustedShotsAttempts','OnIce_A_unblockedShotAttempts','OnIce_A_scoreAdjustedUnblockedShotAttempts','OnIce_A_xGoalsFromxReboundsOfShots','OnIce_A_xGoalsFromActualReboundsOfShots','OnIce_A_reboundxGoals','OnIce_A_xGoals_with_earned_rebounds','OnIce_A_xGoals_with_earned_rebounds_scoreAdjusted','OnIce_A_xGoals_with_earned_rebounds_scoreFlurryAdjusted','OffIce_F_xGoals','OffIce_A_xGoals','OffIce_F_shotAttempts','OffIce_A_shotAttempts','xGoalsForAfterShifts','xGoalsAgainstAfterShifts','corsiForAfterShifts','corsiAgainstAfterShifts','fenwickForAfterShifts','fenwickAgainstAfterShifts']);

async function queryNhlStats(args) {
    console.log("Executing Unified NHL Stats Query with args:", args);
    let { season, dataType, stat, playerName, teamName, limit = 5 } = args;

    const statTranslationMap = {
        'powerPlayPercentage': { newStat: 'xGoalsFor', situation: '5on4' },
        'penaltyKillPercentage': { newStat: 'xGoalsAgainst', situation: '4on5' },
        'powerPlayGoals': { newStat: 'goals', situation: '5on4'},
        'shootingPercentage': { customCalculation: 'shootingPercentage' },
        'savePercentage': { customCalculation: 'savePercentage' },
        'GSAx': { customCalculation: 'GSAx' } // Goals Saved Above Expected
    };

    let situationOverride = null;
    let customCalculation = null;

    if (statTranslationMap[stat]) {
        const translation = statTranslationMap[stat];
        console.log(`Translating conceptual stat '${stat}'...`);
        if (translation.customCalculation) {
            customCalculation = translation.customCalculation;
        } else {
            if(translation.situation) situationOverride = translation.situation;
            stat = translation.newStat; 
        }
    }

    if (!season || !dataType || (!stat && !customCalculation)) {
        return { error: "A season, dataType, and a stat are required." };
    }
    if (!customCalculation && !ALLOWED_STATS.has(stat)) {
        return { error: `The stat '${stat}' is not a valid, queryable field.` };
    }

    try {
        const seasonNumber = parseInt(season, 10);
        let pipeline = [];
        pipeline.push({ $match: { season: seasonNumber } });

        if (teamName) {
            const canonicalName = canonicalTeamNameMap[teamName.toLowerCase()];
            const teamAbbr = canonicalName ? teamToAbbrMap[canonicalName] : teamName.toUpperCase();
            pipeline.push({ $match: { team: teamAbbr } });
        }
        
        if (customCalculation === 'GSAx' && dataType === 'goalie') {
            pipeline.push({ $match: { position: 'G', situation: 'all' } });
            if (playerName) pipeline.push({ $match: { name: playerName } });
            pipeline.push({
                $project: {
                    _id: 0, name: 1, team: 1,
                    statValue: { $subtract: [ { $toDouble: "$xGoals" }, { $toDouble: "$goals" } ] }
                }
            });
            pipeline.push({ $sort: { statValue: -1 } });
            pipeline.push({ $limit: parseInt(limit, 10) });
        } else if (customCalculation === 'shootingPercentage' && dataType === 'team') {
            pipeline.push({ 
                $group: { 
                    _id: "$name", 
                    totalGoalsFor: { $sum: { $toDouble: "$goalsFor" } }, 
                    totalShotsOnGoalFor: { $sum: { $toDouble: "$shotsOnGoalFor" } } 
                } 
            });
            pipeline.push({ 
                $project: { 
                    _id: 0, 
                    team: "$_id", 
                    statValue: { $cond: [{ $eq: ["$totalShotsOnGoalFor", 0] }, 0, { $divide: ["$totalGoalsFor", "$totalShotsOnGoalFor"] }] } 
                } 
            });
            pipeline.push({ $sort: { statValue: -1 } });
            pipeline.push({ $limit: parseInt(limit, 10) });
        } else if (customCalculation === 'savePercentage' && dataType === 'team') {
            pipeline.push({ 
                $group: { 
                    _id: "$name", 
                    totalGoalsAgainst: { $sum: { $toDouble: "$goalsAgainst" } }, 
                    totalShotsOnGoalAgainst: { $sum: { $toDouble: "$shotsOnGoalAgainst" } } 
                } 
            });
            pipeline.push({ 
                $project: { 
                    _id: 0, 
                    team: "$_id", 
                    statValue: { $cond: [{ $eq: ["$totalShotsOnGoalAgainst", 0] }, 0, { $subtract: [1, { $divide: ["$totalGoalsAgainst", "$totalShotsOnGoalAgainst"] }] }] } 
                } 
            });
            pipeline.push({ $sort: { statValue: -1 } });
            pipeline.push({ $limit: parseInt(limit, 10) });
        } else if (customCalculation === 'savePercentage' && dataType === 'goalie') {
            pipeline.push({ $match: { position: 'G', situation: 'all' } });
            if (playerName) pipeline.push({ $match: { name: playerName } });
            pipeline.push({ 
                $project: { 
                    _id: 0, name: 1, team: 1, 
                    statValue: { $cond: [ { $eq: [{ $toDouble: "$unblocked_shot_attempts" }, 0] }, 0, { $subtract: [1, { $divide: [{ $toDouble: "$goals" }, { $toDouble: "$unblocked_shot_attempts" }] }] } ] } 
                } 
            });
            pipeline.push({ $sort: { statValue: -1 } });
            pipeline.push({ $limit: parseInt(limit, 10) });
        } 
        else {
            if (situationOverride) pipeline.push({ $match: { situation: situationOverride } });
            else if (dataType !== 'team') pipeline.push({ $match: { situation: 'all' } });

            if (dataType === 'skater') pipeline.push({ $match: { position: { $in: ['C', 'L', 'R', 'D'] } } });
            else if (dataType === 'goalie') pipeline.push({ $match: { position: 'G' } });
            else if (dataType !== 'team') return { error: "Invalid dataType." };

            if (playerName) pipeline.push({ $match: { name: playerName } });

            if (dataType === 'team') {
                pipeline.push({ 
                    $group: { 
                        _id: "$name",
                        statValue: { $sum: { $toDouble: `$${stat}` } } 
                    } 
                });
                pipeline.push({ $sort: { statValue: -1 } });
                pipeline.push({ $limit: parseInt(limit, 10) });
                pipeline.push({ $project: { _id: 0, team: "$_id", statValue: 1 } });
            } else { // Skater or Goalie
                pipeline.push({ $set: { numericStat: { $toDouble: `$${stat}` } } });
                pipeline.push({ $sort: { numericStat: -1 } });
                pipeline.push({ $limit: parseInt(limit, 10) });
                pipeline.push({ $project: { _id: 0, name: 1, team: 1, position: 1, statValue: "$numericStat" } });
            }
        }

        const results = await nhlStatsCollection.aggregate(pipeline).toArray();
        if (results.length === 0) return { error: `No data was found for the specified criteria.` };

        return { results };
    } catch (error) {
        console.error("Error during Unified NHL stats query:", error);
        return { error: "An error occurred while querying the database." };
    }
}

const DYNAMIC_WEIGHTS = {
    'baseball_mlb': {
        record: 6, momentum: 5, value: 5, newsSentiment: 10, injuryImpact: 12,
        offensiveForm: 12, defensiveForm: 12, h2h: 10, weather: 8, pitcher: 15
    },
    'icehockey_nhl': {
        fiveOnFiveXg: 3.5,
        highDangerBattle: 3.0,
        specialTeamsDuel: 2.5,
        topLinePower: 2.5,
        historicalGoalie: 2.0,
        finishingSkill: 1.5,
        discipline: 1.0,
        goalie: 2.5,
        offensiveForm: 1.0,
        defensiveForm: 1.0,
        injury: 1.5,
        fatigue: 1.0,
        h2h: 1.0,
        record: 0.5,
        hotStreak: 0.8,
        faceoffAdvantage: 0.5,
        pdo: 1.0,
        value: 0.5
    },
    'default': {
        record: 8, fatigue: 7, momentum: 5, matchup: 10, value: 5, newsSentiment: 10,
        injuryImpact: 12, offensiveForm: 9, defensiveForm: 9, h2h: 11, weather: 5
    }
};

function getDynamicWeights(sportKey) {
    return DYNAMIC_WEIGHTS[sportKey] || DYNAMIC_WEIGHTS['default'];
}

async function getProbablePitchersAndStats() {
    const cacheKey = `mlb_probable_pitchers_${new Date().toISOString().split('T')[0]}`;
    return fetchData(cacheKey, async () => {
        const pitcherData = {};
        try {
            const currentYear = new Date().getFullYear();
            const scheduleUrl = `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${new Date().toISOString().split('T')[0]}&hydrate=probablePitcher,team,linescore`;

            const { data: scheduleData } = await axios.get(scheduleUrl);

            if (!scheduleData.dates[0] || !scheduleData.dates[0].games) {
                console.log("No MLB games scheduled for today, skipping pitcher fetch.");
                return {};
            }

            const games = scheduleData.dates[0].games;
            for (const game of games) {
                const homeTeamName = game.teams.home.team.name;
                const awayTeamName = game.teams.away.team.name;

                if (game.teams.home.probablePitcher) {
                    pitcherData[homeTeamName] = { id: game.teams.home.probablePitcher.id };
                }
                if (game.teams.away.probablePitcher) {
                    pitcherData[awayTeamName] = { id: game.teams.away.probablePitcher.id };
                }
            }

            for (const teamName in pitcherData) {
                if (pitcherData[teamName].id) {
                    const pitcherId = pitcherData[teamName].id;
                    const statsUrl = `https://statsapi.mlb.com/api/v1/people/${pitcherId}/stats?stats=season&group=pitching&season=${currentYear}`;
                    const { data: statsData } = await axios.get(statsUrl);

                    if (statsData.stats && statsData.stats[0] && statsData.stats[0].splits[0]) {
                        const stats = statsData.stats[0].splits[0].stat;
                        pitcherData[teamName].name = statsData.stats[0].splits[0].player.fullName;
                        pitcherData[teamName].era = parseFloat(stats.era);
                        pitcherData[teamName].whip = parseFloat(stats.whip);
                    }
                }
            }
            return pitcherData;
        } catch (e) {
            console.error("Could not fetch probable pitcher data:", e.message);
            return {};
        }
    }, 14400000);
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
            console.error(`Could not fetch weather for ${teamName}:`, e.message);
            return null;
        }
    });
}

async function fetchEspnData(sportKey) {
    return fetchData(`espn_scoreboard_${sportKey}_${new Date().toISOString().split('T')[0]}`, async () => {
        const map = { 'baseball_mlb': {sport: 'baseball', league: 'mlb'}, 'icehockey_nhl': {sport: 'hockey', league: 'nhl'}, 'americanfootball_nfl': {sport: 'football', league: 'nfl'} }[sportKey];
        if (!map) return { events: [] };
        try {
            const today = new Date();
            const year = today.getFullYear();
            const month = String(today.getMonth() + 1).padStart(2, '0');
            const day = String(today.getDate()).padStart(2, '0');
            const formattedDate = `${year}${month}${day}`;
            const url = `https://site.api.espn.com/apis/site/v2/sports/${map.sport}/${map.league}/scoreboard?dates=${formattedDate}`;
            const { data } = await axios.get(url, {
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.36' }
            });
            if (!data || !Array.isArray(data.events)) {
                console.warn(`[WARN] ESPN API for ${sportKey} returned an unexpected data structure.`);
                return { events: [] };
            }
            return data;
        } catch (error) {
            console.error(`[CRITICAL] Could not fetch ESPN scoreboard for ${sportKey}: ${error.message}. The app will proceed with limited data.`);
            return { events: [] };
        }
    }, 60000);
}

async function runPredictionEngine(game, sportKey, context) {
    const { teamStats, injuries, h2h, allGames, probablePitchers, weather } = context;
    const weights = getDynamicWeights(sportKey);
    const { home_team, away_team } = game;
    const homeCanonicalName = canonicalTeamNameMap[home_team.toLowerCase()] || home_team;
    const awayCanonicalName = canonicalTeamNameMap[away_team.toLowerCase()] || away_team;
    const homeStats = teamStats[homeCanonicalName] || {};
    const awayStats = teamStats[awayCanonicalName] || {};
    let homeScore = 50;
    const factors = {};
    let homeInjuryImpact = (injuries[homeCanonicalName] || []).length;
    let awayInjuryImpact = (injuries[awayCanonicalName] || []).length;

    factors['Record'] = { value: (getWinPct(parseRecord(homeStats.record)) - getWinPct(parseRecord(awayStats.record))), homeStat: homeStats.record || '0-0', awayStat: awayStats.record || '0-0' };
    factors['H2H (Season)'] = { value: (getWinPct(parseRecord(h2h.home)) - getWinPct(parseRecord(h2h.away))), homeStat: h2h.home, awayStat: h2h.away };

    if (sportKey === 'baseball_mlb') {
        factors['Recent Form (L10)'] = { value: (getWinPct(parseRecord(homeStats.lastTen)) - getWinPct(parseRecord(awayStats.lastTen))), homeStat: homeStats.lastTen || '0-0', awayStat: awayStats.lastTen || '0-0' };
        factors['Offensive Form'] = { value: ((homeStats.ops || 0.700) - (awayStats.ops || 0.700)) * 100, homeStat: `${(homeStats.ops || 0.700).toFixed(3)} OPS`, awayStat: `${(awayStats.ops || 0.700).toFixed(3)} OPS` };
        factors['Defensive Form'] = { value: ((awayStats.teamERA || 5.0) - (homeStats.teamERA || 5.0)), homeStat: `${(homeStats.teamERA || 5.0).toFixed(2)} ERA`, awayStat: `${(awayStats.teamERA || 5.0).toFixed(2)} ERA` };
        const homePitcher = probablePitchers[home_team];
        const awayPitcher = probablePitchers[away_team];
        let pitcherValue = 0;
        let homePitcherDisplay = "N/A", awayPitcherDisplay = "N/A";
        if (homePitcher?.name && awayPitcher?.name && homePitcher.era && awayPitcher.era) {
            pitcherValue = (awayPitcher.era - homePitcher.era) + ((awayPitcher.whip - homePitcher.whip) * 10);
            homePitcherDisplay = `${homePitcher.name.split(' ')[1]} (${homePitcher.era.toFixed(2)} ERA)`;
            awayPitcherDisplay = `${awayPitcher.name.split(' ')[1]} (${awayPitcher.era.toFixed(2)} ERA)`;
        }
        factors['Starting Pitcher Duel'] = { value: pitcherValue, homeStat: homePitcherDisplay, awayStat: awayPitcherDisplay };
    }

    factors['Injury Impact'] = { value: (awayInjuryImpact - homeInjuryImpact), homeStat: `${homeInjuryImpact} players`, awayStat: `${awayInjuryImpact} players`, injuries: { home: injuries[homeCanonicalName] || [], away: injuries[awayCanonicalName] || [] } };

    Object.keys(factors).forEach(factorName => {
        if (factors[factorName] && typeof factors[factorName].value === 'number' && !isNaN(factors[factorName].value)) {
            const factorKey = {
                'Record': 'record', 'H2H (Season)': 'h2h', 'Recent Form (L10)': 'momentum',
                'Starting Pitcher Duel': 'pitcher', 'Injury Impact': 'injuryImpact',
                'Offensive Form': 'offensiveForm', 'Defensive Form': 'defensiveForm'
            }[factorName] || 'default';
            const weight = weights[factorKey] || 1;
            homeScore += factors[factorName].value * weight;
        }
    });

    const homeOdds = game.bookmakers?.[0]?.markets?.find(m => m.key === 'h2h')?.outcomes?.find(o => o.name === home_team)?.price;
    const awayOdds = game.bookmakers?.[0]?.markets?.find(m => m.key === 'h2h')?.outcomes?.find(o => o.name === away_team)?.price;
    let homeValue = 0, awayValue = 0;
    if (homeOdds && awayOdds) {
        const homeImpliedProb = (1 / homeOdds) * 100;
        const homePower = homeScore;
        homeValue = homePower - homeImpliedProb;
        awayValue = (100 - homePower) - (1 / awayOdds * 100);
        factors['Betting Value'] = { value: homeValue, homeStat: `${homeValue.toFixed(1)}%`, awayStat: `${awayValue.toFixed(1)}%` };
        homeScore += (homeValue * (weights.value / 10));
    } else {
         factors['Betting Value'] = { value: 0, homeStat: `N/A`, awayStat: `N/A` };
    }

    const winner = homeScore > 50 ? home_team : away_team;
    const confidence = Math.abs(50 - homeScore);
    let strengthText = confidence > 15 ? "Strong Advantage" : confidence > 7.5 ? "Good Chance" : "Slight Edge";
    return { winner, strengthText, confidence, factors, weather, homeValue, awayValue };
}

async function getTeamSeasonAdvancedStats(team, season) {
    const cacheKey = `adv_stats_final_agg_${team}_${season}_v5`;
    return fetchData(cacheKey, async () => {
        try {
            const pipeline = [
                { $match: { team: team, season: season } },
                {
                    $group: {
                        _id: "$situation",
                        totalxGoalsFor: { $sum: "$xGoalsFor" },
                        totalxGoalsAgainst: { $sum: "$xGoalsAgainst" },
                        totalHighDangerxGoalsFor: { $sum: "$highDangerxGoalsFor" },
                        totalHighDangerxGoalsAgainst: { $sum: "$highDangerxGoalsAgainst" },
                        totalGoalsFor: { $sum: "$goalsFor" },
                        totalGoalsAgainst: { $sum: "$goalsAgainst" },
                        totalShotsOnGoalFor: { $sum: "$shotsOnGoalFor" },
                        totalShotsOnGoalAgainst: { $sum: "$shotsOnGoalAgainst" },
                    }
                }
            ];
            const results = await nhlStatsCollection.aggregate(pipeline).toArray();
            if (!results || results.length === 0) return {};

            const seasonalData = results.reduce((acc, curr) => { (acc[curr._id] = curr); return acc; }, {});
            const s5on5 = seasonalData['5on5'];
            if (!s5on5) return {};

            const finalStats = {};
            const totalXG_5on5 = s5on5.totalxGoalsFor + s5on5.totalxGoalsAgainst;
            if (totalXG_5on5 > 0) finalStats.fiveOnFiveXgPercentage = (s5on5.totalxGoalsFor / totalXG_5on5) * 100;

            const totalHDXG_5on5 = s5on5.totalHighDangerxGoalsFor + s5on5.totalHighDangerxGoalsAgainst;
            if (totalHDXG_5on5 > 0) finalStats.hdcfPercentage = (s5on5.totalHighDangerxGoalsFor / totalHDXG_5on5) * 100;

            const ppRating = seasonalData['5on4'] ? seasonalData['5on4'].totalxGoalsFor : 0;
            const pkRating = seasonalData['4on5'] ? seasonalData['4on5'].totalxGoalsAgainst : 0;
            finalStats.specialTeamsRating = ppRating - pkRating;

            if (s5on5.totalShotsOnGoalFor > 0 && s5on5.totalShotsOnGoalAgainst > 0) {
                const shootingPct = (s5on5.totalGoalsFor / s5on5.totalShotsOnGoalFor);
                const savePct = 1 - (s5on5.totalGoalsAgainst / s5on5.totalShotsOnGoalAgainst);
                finalStats.pdo = (shootingPct + savePct) * 1000;
            }
            return finalStats;
        } catch (error) {
            console.error(`[CRITICAL ERROR] Error during aggregation for ${team} in ${season}:`, error);
            return {};
        }
    }, 86400000);
}

async function runAdvancedNhlPredictionEngine(game, context) {
    const { teamStats, allGames, h2h, probableStarters, historicalGoalieData, homeAbbr, awayAbbr } = context;
    const { home_team, away_team } = game;
    const weights = getDynamicWeights('icehockey_nhl');
    
    const previousSeasonId = new Date().getFullYear() - 1;

    const [historicalMetrics, [homeAdvStats, awayAdvStats], topLineMetrics] = await Promise.all([
        getHistoricalTeamAndGoalieMetrics(previousSeasonId),
        Promise.all([ getTeamSeasonAdvancedStats(homeAbbr, previousSeasonId), getTeamSeasonAdvancedStats(awayAbbr, previousSeasonId) ]),
        getHistoricalTopLineMetrics(previousSeasonId)
    ]);

    const homeHist = historicalMetrics[homeAbbr] || {};
    const awayHist = historicalMetrics[awayAbbr] || {};
    const homeTopLine = topLineMetrics[homeAbbr] || {};
    const awayTopLine = topLineMetrics[awayAbbr] || {};

    let homeScore = 50.0;
    const factors = {};

    const homeRealTimeStats = teamStats[homeAbbr] || {};
    const awayRealTimeStats = teamStats[awayAbbr] || {};

    // --- GOALIE LOGIC WITH TARGETED DEBUGGING ---
    const homeHistGoalie = historicalGoalieData[probableStarters.homeId];
    const awayHistGoalie = historicalGoalieData[probableStarters.awayId];
    
    // DEBUGGING BLOCK: This will tell us exactly what's happening.
    console.log(`--- Goalie Debug for ${away_team} @ ${home_team} ---`);
    console.log(`Home Goalie ID from Schedule: ${probableStarters.homeId} | Away Goalie ID: ${probableStarters.awayId}`);
    console.log(`Historical DB contains ${Object.keys(historicalGoalieData).length} goalies. First 5 keys:`, Object.keys(historicalGoalieData).slice(0, 5));
    console.log(`Lookup for Home ID (${probableStarters.homeId}) found: ${homeHistGoalie ? `Yes, ${homeHistGoalie.name}` : 'No Match'}`);
    console.log(`Lookup for Away ID (${probableStarters.awayId}) found: ${awayHistGoalie ? `Yes, ${awayHistGoalie.name}` : 'No Match'}`);
    console.log("-----------------------------------------------------");
    
    const homeGSAx = homeHistGoalie?.gsax || 0;
    const awayGSAx = awayHistGoalie?.gsax || 0;
    factors['Historical Goalie Edge (GSAx)'] = { value: homeGSAx - awayGSAx, homeStat: homeGSAx.toFixed(2), awayStat: awayGSAx.toFixed(2) };
    
    // For now, we are focusing on historical stats, so Current Form is disabled.
    factors['Current Goalie Form'] = { value: 0, homeStat: 'N/A', awayStat: 'N/A' };
    // --- END GOALIE LOGIC ---
    
    // (The rest of the factor calculations remain the same)
    const homeFinish = safeNum(homeHist.xGoalsFor) > 0 ? safeNum(homeHist.goalsFor) / safeNum(homeHist.xGoalsFor) : 1;
    const awayFinish = safeNum(awayHist.xGoalsFor) > 0 ? safeNum(awayHist.goalsFor) / safeNum(awayHist.xGoalsFor) : 1;
    factors['Team Finishing Skill'] = { value: homeFinish - awayFinish, homeStat: `${(homeFinish * 100).toFixed(1)}%`, awayStat: `${(awayFinish * 100).toFixed(1)}%` };
    factors['Team Discipline (PIMs)'] = { value: safeNum(awayHist.penalityMinutes) - safeNum(homeHist.penalityMinutes), homeStat: `${safeNum(homeHist.penalityMinutes)}`, awayStat: `${safeNum(awayHist.penalityMinutes)}` };
    const homeTopLineXG = safeNum(homeTopLine.xGoalsPercentage) || 0.5;
    const awayTopLineXG = safeNum(awayTopLine.xGoalsPercentage) || 0.5;
    factors['Top Line Power (xG%)'] = { value: (homeTopLineXG - awayTopLineXG) * 100, homeStat: `${(homeTopLineXG * 100).toFixed(1)}%`, awayStat: `${(awayTopLineXG * 100).toFixed(1)}%` };
    factors['5-on-5 xG%'] = { value: safeNum(homeAdvStats.fiveOnFiveXgPercentage) - safeNum(awayAdvStats.fiveOnFiveXgPercentage), homeStat: `${safeNum(homeAdvStats.fiveOnFiveXgPercentage).toFixed(1)}%`, awayStat: `${safeNum(awayAdvStats.fiveOnFiveXgPercentage).toFixed(1)}%` };
    factors['High-Danger Battle'] = { value: safeNum(homeAdvStats.hdcfPercentage) - safeNum(awayAdvStats.hdcfPercentage), homeStat: `${safeNum(homeAdvStats.hdcfPercentage).toFixed(1)}%`, awayStat: `${safeNum(awayAdvStats.hdcfPercentage).toFixed(1)}%` };
    factors['Special Teams Duel'] = { value: safeNum(homeAdvStats.specialTeamsRating) - safeNum(awayAdvStats.specialTeamsRating), homeStat: `${safeNum(homeAdvStats.specialTeamsRating).toFixed(2)}`, awayStat: `${safeNum(awayAdvStats.specialTeamsRating).toFixed(2)}` };
    factors['PDO (Luck Factor)'] = { value: safeNum(homeAdvStats.pdo) - safeNum(awayAdvStats.pdo), homeStat: `${safeNum(homeAdvStats.pdo).toFixed(0)}`, awayStat: `${safeNum(awayAdvStats.pdo).toFixed(0)}` };
    factors['Faceoff Advantage'] = { value: safeNum(homeRealTimeStats.faceoffWinPct) - safeNum(awayRealTimeStats.faceoffWinPct), homeStat: `${safeNum(homeRealTimeStats.faceoffWinPct).toFixed(1)}%`, awayStat: `${safeNum(awayRealTimeStats.faceoffWinPct).toFixed(1)}%` };
    factors['Record'] = { value: (getWinPct(parseRecord(homeRealTimeStats.record)) - getWinPct(parseRecord(awayRealTimeStats.record))), homeStat: safeText(homeRealTimeStats.record), awayStat: safeText(awayRealTimeStats.record) };
    factors['Offensive Form (G/GP)'] = { value: safeNum(homeRealTimeStats.goalsForPerGame) - safeNum(awayRealTimeStats.goalsForPerGame), homeStat: `${safeNum(homeRealTimeStats.goalsForPerGame).toFixed(2)}`, awayStat: `${safeNum(awayRealTimeStats.goalsForPerGame).toFixed(2)}` };
    factors['Defensive Form (GA/GP)'] = { value: safeNum(awayRealTimeStats.goalsAgainstPerGame) - safeNum(homeRealTimeStats.goalsAgainstPerGame), homeStat: `${safeNum(homeRealTimeStats.goalsAgainstPerGame).toFixed(2)}`, awayStat: `${safeNum(awayRealTimeStats.goalsAgainstPerGame).toFixed(2)}` };
    factors['Hot Streak'] = { value: (safeText(homeRealTimeStats.streak).startsWith('W') ? 1 : -1) * parseInt(safeText(homeRealTimeStats.streak).substring(1) || '0', 10) - (safeText(awayRealTimeStats.streak).startsWith('W') ? 1 : -1) * parseInt(safeText(awayRealTimeStats.streak).substring(1) || '0', 10), homeStat: safeText(homeRealTimeStats.streak), awayStat: safeText(awayRealTimeStats.streak) };
    factors['H2H (Season)'] = { value: (getWinPct(parseRecord(h2h.home)) - getWinPct(parseRecord(h2h.away))) * 10, homeStat: safeText(h2h.home), awayStat: safeText(h2h.away) };
    factors['Fatigue'] = { value: (calculateFatigue(away_team, allGames, new Date(game.commence_time)) - calculateFatigue(home_team, allGames, new Date(game.commence_time))), homeStat: `${calculateFatigue(home_team, allGames, new Date(game.commence_time))} pts`, awayStat: `${calculateFatigue(away_team, allGames, new Date(game.commence_time))} pts` };
    factors['Injury Impact'] = { value: 0, homeStat: `0 players`, awayStat: `0 players`}; // Placeholder
    Object.keys(factors).forEach(factorName => { if (factors[factorName] && typeof factors[factorName].value === 'number' && !isNaN(factors[factorName].value)) { const factorKey = { 'Historical Goalie Edge (GSAx)': 'historicalGoalie', 'Team Finishing Skill': 'finishingSkill', 'Team Discipline (PIMs)': 'discipline', 'Top Line Power (xG%)': 'topLinePower', '5-on-5 xG%': 'fiveOnFiveXg', 'High-Danger Battle': 'highDangerBattle', 'Special Teams Duel': 'specialTeamsDuel', 'PDO (Luck Factor)': 'pdo', 'Faceoff Advantage': 'faceoffAdvantage', 'Current Goalie Form': 'goalie', 'Injury Impact': 'injury', 'Fatigue': 'fatigue', 'H2H (Season)': 'h2h', 'Hot Streak': 'hotStreak', 'Record': 'record', 'Offensive Form (G/GP)': 'offensiveForm', 'Defensive Form (GA/GP)': 'defensiveForm' }[factorName]; if (factorKey && weights[factorKey]) { homeScore += factors[factorName].value * weights[factorKey]; } } });
    const homeOdds = game.bookmakers?.[0]?.markets?.find(m => m.key === 'h2h')?.outcomes?.find(o => o.name === home_team)?.price;
    const awayOdds = game.bookmakers?.[0]?.markets?.find(m => m.key === 'h2h')?.outcomes?.find(o => o.name === away_team)?.price;
    let homeValue = 0, awayValue = 0;
    if (homeOdds && awayOdds) {
        const homeImpliedProb = (1 / homeOdds) * 100;
        homeValue = homeScore - homeImpliedProb;
        awayValue = (100 - homeScore) - (1 / awayOdds * 100);
        factors['Betting Value'] = { value: homeValue, homeStat: `${homeValue.toFixed(1)}%`, awayStat: `${awayValue.toFixed(1)}%` };
    } else {
        factors['Betting Value'] = { value: 0, homeStat: `N/A`, awayStat: `N/A` };
    }
    const winner = homeScore > 50 ? home_team : away_team;
    const confidence = Math.abs(50 - homeScore);
    let strengthText = confidence > 15 ? "Strong Advantage" : confidence > 7.5 ? "Good Chance" : "Slight Edge";
    return { winner, strengthText, confidence, factors, homeValue, awayValue };
}

async function getPredictionsForSport(sportKey) {
    if (sportKey !== 'icehockey_nhl') return [];

    try {
        console.log("🚀 Starting new definitive prediction pipeline...");

        // --- Step 1: Fetch all data sources in parallel with robust error handling ---
        const lastCompletedSeason = new Date().getFullYear() - 1;
        const [oddsData, scheduleData, historicalGoalieData, teamStandingsData] = await Promise.all([
            getOdds(sportKey).catch(e => { console.error("Failed to fetch odds:", e.message); return []; }),
            axios.get('https://api-web.nhle.com/v1/schedule/now').then(res => res.data).catch(e => { console.error("Failed to fetch schedule:", e.message); return null; }),
            getHistoricalGoalieData(lastCompletedSeason).catch(e => { console.error("Failed to fetch historical goalies:", e.message); return {}; }),
            axios.get('https://api-web.nhle.com/v1/standings/now').then(res => res.data.standings).catch(e => { console.error("Failed to fetch team standings:", e.message); return []; })
        ]);

        if (!scheduleData?.gameWeek || !teamStandingsData || !oddsData) {
            throw new Error("Critical data failure: Could not fetch all required data sources.");
        }

        // --- Step 2: Process and map data for reliable lookups ---
        const liveTeamStats = teamStandingsData.reduce((acc, team) => {
            const abbr = team.teamAbbrev.default;
            if (abbr) {
                const gamesPlayed = safeNum(team.gamesPlayed);
                acc[abbr] = {
                    record: `${team.wins}-${team.losses}-${team.otLosses}`,
                    streak: `${team.streakCode}${team.streakCount}`,
                    goalsForPerGame: gamesPlayed > 0 ? safeNum(team.goalsFor) / gamesPlayed : 0,
                    goalsAgainstPerGame: gamesPlayed > 0 ? safeNum(team.goalsAgainst) / gamesPlayed : 0,
                    faceoffWinPct: 0,
                };
            }
            return acc;
        }, {});
        console.log(`✅ Processed live stats for ${Object.keys(liveTeamStats).length} teams.`);

        // Create a lookup map from the betting odds data, keyed by a standardized name.
        const oddsMap = (oddsData || []).reduce((acc, game) => {
            const homeTeamCanonical = canonicalTeamNameMap[game.home_team.toLowerCase()];
            const awayTeamCanonical = canonicalTeamNameMap[game.away_team.toLowerCase()];
            if (homeTeamCanonical && awayTeamCanonical) {
                const key = `${awayTeamCanonical} @ ${homeTeamCanonical}`;
                acc[key] = game;
            }
            return acc;
        }, {});
        console.log(`✅ Created odds map with ${Object.keys(oddsMap).length} games.`);

        // --- Step 3: Iterate through the official schedule (our "source of truth") ---
        const officialGames = scheduleData.gameWeek.flatMap(day => day.games);
        const predictions = [];

        for (const officialGame of officialGames) {
            const homeTeamName = officialGame.homeTeam?.name?.default;
            const awayTeamName = officialGame.awayTeam?.name?.default;
            if (!homeTeamName || !awayTeamName) continue;

            // Standardize names from the official schedule to create a reliable key
            const homeTeamCanonical = canonicalTeamNameMap[homeTeamName.toLowerCase()];
            const awayTeamCanonical = canonicalTeamNameMap[awayTeamName.toLowerCase()];
            if (!homeTeamCanonical || !awayTeamCanonical) continue;

            const matchupKey = `${awayTeamCanonical} @ ${homeTeamCanonical}`;
            const oddsGame = oddsMap[matchupKey]; // Find the matching odds game
            if (!oddsGame) {
                console.warn(`[WARN] No odds found for schedule game: ${matchupKey}. Skipping.`);
                continue;
            }

            const homeAbbr = officialGame.homeTeam.abbrev;
            const awayAbbr = officialGame.awayTeam.abbrev;

            const context = {
                teamStats: liveTeamStats,
                allGames: oddsData,
                h2h: { home: '0-0', away: '0-0' },
                probableStarters: {
                     homeId: officialGame.homeTeam.probableStarterId,
                     awayId: officialGame.awayTeam.probableStarterId
                },
                historicalGoalieData,
                homeAbbr,
                awayAbbr,
            };

            const predictionData = await runAdvancedNhlPredictionEngine(oddsGame, context);
            if (predictionData) {
                predictions.push({ game: oddsGame, prediction: predictionData });
            }
        }
        
        console.log(`✅ Generated ${predictions.length} predictions.`);
        return predictions;

    } catch (error) {
        console.error("Critical error during the new prediction pipeline:", error.message);
        return []; 
    }
}

// Health check route for Render to confirm the service is running
app.get('/api/health', (req, res) => {
    res.status(200).json({ status: 'ok', message: 'Service is healthy' });
});

app.get('/api/predictions', async (req, res) => {
    const { sport } = req.query;
    if (!sport) return res.status(400).json({ error: "Sport parameter is required." });

    try {
        const predictions = await getPredictionsForSport(sport);
        if (predictions.length === 0 && !dataCache.has(`odds_${sport}`)) {
            return res.json({ message: `No upcoming games for ${sport}.` });
        }
        res.json(predictions);
    } catch(error) {
        console.error(`Prediction Error for ${sport}:`, error.message);
        res.status(500).json({ error: `Failed to get predictions for ${sport}`});
    }
});

async function getAllDailyPredictions() {
    let allPredictions = [];
    const gameCounts = {};

    for (const sport of SPORTS_DB) {
        const predictions = await getPredictionsForSport(sport.key);
        allPredictions = allPredictions.concat(predictions);
        gameCounts[sport.key] = predictions.length;
    }
    return { allPredictions, gameCounts };
}

app.get('/api/special-picks', async (req, res) => {
    try {
        const { allPredictions, gameCounts } = await getAllDailyPredictions();

        let sportsInSeason = Object.values(gameCounts).filter(count => count > 4).length;
        const potdConfidenceThreshold = sportsInSeason >= 2 ? 15 : 10;
        const potdValueThreshold = sportsInSeason >= 2 ? 5 : 2.5;
        const parlayConfidenceThreshold = 7.5;

        const now = new Date();
        const cutoff = new Date(now.getTime() + 24 * 60 * 60 * 1000);
        const upcomingTodayPredictions = allPredictions.filter(p => {
            const gameDate = new Date(p.game.commence_time);
            return gameDate > now && gameDate < cutoff;
        });

        let pickOfTheDay = null;
        let parlay = null;
        let arbitrationCandidates = [];

        const highValuePicks = upcomingTodayPredictions.filter(p => {
            const value = p.prediction.winner === p.game.home_team ? p.prediction.homeValue : p.prediction.awayValue;
            return p.prediction.confidence > potdConfidenceThreshold && typeof value === 'number' && value > potdValueThreshold;
        });

        highValuePicks.sort((a, b) => {
            const aValue = a.prediction.winner === a.game.home_team ? a.prediction.homeValue : a.prediction.awayValue;
            const bValue = b.prediction.winner === b.game.home_team ? b.prediction.homeValue : b.prediction.awayValue;
            return (b.prediction.confidence + bValue) - (a.prediction.confidence + aValue);
        });

        if (highValuePicks.length > 0) {
            pickOfTheDay = highValuePicks[0];
        }

        if (highValuePicks.length >= 2 && highValuePicks.length <= 3) {
            arbitrationCandidates = highValuePicks;
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
        res.json({ pickOfTheDay, parlay, arbitrationCandidates });
    } catch (error) {
        console.error("Special Picks Error:", error);
        res.status(500).json({ error: 'Failed to generate special picks.' });
    }
});

const ARBITER_SCHEMA = {
    "bestBet": {
        "matchup": "string (e.g., 'Team A @ Team B')",
        "pick": "string (The winning team's name)"
    },
    "comparativeAnalysis": "string (A detailed 2-3 sentence narrative comparing the pros and cons of each bet.)",
    "finalVerdict": "string (A concluding sentence explaining why the chosen bet is superior to the others.)"
};

app.post('/api/arbitrate-picks', async (req, res) => {
    try {
        const { candidates } = req.body;
        if (!candidates || candidates.length < 2) {
            return res.status(400).json({ error: "Not enough candidates for arbitration." });
        }

        const candidatesSummary = candidates.map((c, index) => {
            const value = c.prediction.winner === c.game.home_team ? c.prediction.homeValue : c.prediction.awayValue;
            return `
Candidate ${index + 1}: Pick ${c.prediction.winner} in ${c.game.away_team} @ ${c.game.home_team}
- Confidence Score: ${c.prediction.confidence.toFixed(1)}
- Value Edge: ${value.toFixed(1)}%`
        }).join('');

        const systemPrompt = `You are 'The Arbiter,' an elite sports betting analyst. Your sole task is to compare a few top-rated betting opportunities and determine the single best bet among them. You must provide a comparative analysis and a final verdict, strictly following the user's JSON schema.`;

        const userPrompt = `
**TOP CANDIDATES FOR BEST BET OF THE DAY:**
${candidatesSummary}

**TASK:**
Analyze the candidates. Compare their relative strengths (confidence vs. value) and risks. Declare the single best bet and provide your reasoning by completing the following JSON object.

**JSON TO COMPLETE:**
${JSON.stringify(ARBITER_SCHEMA, null, 2)}
`;

        const result = await analysisModel.generateContent(userPrompt);

        const responseText = result.response.text();
        const arbitrationData = cleanAndParseJson(responseText);
        res.json({ arbitrationData });

    } catch (error) {
        console.error("Arbitration AI Error:", error);
        res.status(500).json({ error: "Failed to generate Arbitration AI analysis." });
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

app.post('/api/hockey-chat', async (req, res) => {
    try {
        const { question } = req.body;
        if (!question) {
            return res.status(400).json({ error: 'Question is required.' });
        }

        const chat = chatModel.startChat();
        const result1 = await chat.sendMessage(question);
        const response1 = result1.response;

        const functionCalls = response1.functionCalls();

        if (functionCalls && functionCalls.length > 0) {
            const call = functionCalls[0];
            console.log(`AI is requesting to call function: ${call.name}`);

            let functionResponse;
            if (call.name === 'queryNhlStats') {
                functionResponse = await queryNhlStats(call.args);
            } else {
                functionResponse = { error: `Unknown function ${call.name}` };
            }

            const result2 = await chat.sendMessage([
                {
                    functionResponse: {
                        name: call.name,
                        response: functionResponse,
                    },
                },
            ]);

            const finalAnswer = result2.response.text();
            res.json({ answer: finalAnswer });

        } else {
            const directAnswer = response1.text();
            res.json({ answer: directAnswer });
        }
    } catch (error) {
        console.error("Hockey Chat Error:", error);
        res.status(500).json({ error: 'Failed to process chat message.' });
    }
});

app.get('/api/reconcile-results', async (req, res) => {
    const { password } = req.query;
    if (password !== RECONCILE_PASSWORD) {
        return res.status(401).json({ error: "Unauthorized" });
    }
    try {
        if (!predictionsCollection || !recordsCollection) await connectToDb();
        
        const threeDaysAgo = new Date();
        threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

        const pendingPredictions = await predictionsCollection.find({
            status: 'pending',
            gameDate: { $gte: threeDaysAgo.toISOString() }
        }).toArray();

        if (pendingPredictions.length === 0) {
            return res.json({ message: "No recent pending predictions to reconcile." });
        }

        let reconciledCount = 0;
        const sportKeys = [...new Set(pendingPredictions.map(p => p.sportKey))];
        
        let allRecentEvents = [];
        for (let i = 0; i < 3; i++) {
            const dateToFetch = new Date();
            dateToFetch.setDate(dateToFetch.getDate() - i);
            const formattedDate = `${dateToFetch.getFullYear()}${(dateToFetch.getMonth() + 1).toString().padStart(2, '0')}${dateToFetch.getDate().toString().padStart(2, '0')}`;
            
            for (const sportKey of sportKeys) {
                 const map = { 'baseball_mlb': { sport: 'baseball', league: 'mlb' }, 'icehockey_nhl': { sport: 'hockey', league: 'nhl' }, 'americanfootball_nfl': { sport: 'football', league: 'nfl' } }[sportKey];
                 if (!map) continue;
                 
                 try {
                    const url = `https://site.api.espn.com/apis/site/v2/sports/${map.sport}/${map.league}/scoreboard?dates=${formattedDate}`;
                    const { data: espnData } = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0...' }});
                    if (espnData.events) {
                        allRecentEvents.push(...espnData.events);
                    }
                 } catch (apiError) {
                    console.error(`Could not fetch ESPN data for ${formattedDate}: ${apiError.message}`);
                 }
            }
        }

        for (const prediction of pendingPredictions) {
            const gameEvent = allRecentEvents.find(e => {
                const homeCanonical = canonicalTeamNameMap[prediction.homeTeam.toLowerCase()] || prediction.homeTeam;
                const awayCanonical = canonicalTeamNameMap[prediction.awayTeam.toLowerCase()] || prediction.awayTeam;

                const competitors = e.competitions?.[0]?.competitors;
                if (!competitors) return false;

                const eventHome = competitors.find(c => c.homeAway === 'home');
                const eventAway = competitors.find(c => c.homeAway === 'away');

                if (!eventHome?.team?.displayName || !eventAway?.team?.displayName) return false;
                
                const eventHomeCanonical = canonicalTeamNameMap[eventHome.team.displayName.toLowerCase()];
                const eventAwayCanonical = canonicalTeamNameMap[eventAway.team.displayName.toLowerCase()];
                
                return homeCanonical === eventHomeCanonical && awayCanonical === eventAwayCanonical;
            });

            if (gameEvent && gameEvent.status.type.completed) {
                const competition = gameEvent.competitions[0];
                const winnerData = competition.competitors.find(c => c.winner === true);
                if (!winnerData?.team?.displayName) continue;

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
                    { sport: prediction.sportKey },
                    updateField,
                    { upsert: true }
                );
                reconciledCount++;
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
        res.json(recentBets);
    } catch (error) {
        console.error("Recent Bets Error:", error);
        res.status(500).json({ error: "Failed to fetch recent bets." });
    }
});
app.get('/api/futures', (req, res) => res.json(FUTURES_PICKS_DB));

const V3_ANALYSIS_SCHEMA = {
  "finalPick": "string",
  "isOverride": "boolean",
  "investmentThesis": "string (A 1-2 sentence professional summary of the core reason this bet is valuable.)",
  "dynamicResearch": [
    {
      "question": "string (The specific question the AI asked the database.)",
      "finding": "string (The data/answer the AI found that influenced its decision.)"
    }
  ],
  "gameNarrative": "string",
  "keyFactorWithData": {
    "factor": "string",
    "data": "string"
  },
  "counterArgument": "string",
  "rebuttal": "string",
  "xFactor": "string",
  "confidenceScore": "string (High, Medium, or Low)",
  "confidenceRationale": "string"
};

app.post('/api/ai-analysis', async (req, res) => {
    try {
        const { game, prediction } = req.body;

        const lastCompletedSeasonYear = new Date().getFullYear() - 1;
        const [homeHistData, awayHistData] = await Promise.all([
            getAiContextualData(game.home_team, lastCompletedSeasonYear),
            getAiContextualData(game.away_team, lastCompletedSeasonYear)
        ]);

        const factorsList = Object.entries(prediction.factors)
            .filter(([key, value]) => value && value.homeStat !== 'N/A' && value.awayStat !== 'N/A' && value.homeStat !== '0.00' && value.awayStat !== '0.00')
            .map(([key, value]) => `- ${key}: Home (${value.homeStat}), Away (${value.awayStat})`)
            .join('\n');

        const preFetchedDataSummary = `
**Pre-Fetched Historical Data (${lastCompletedSeasonYear} Season):**
- ${game.home_team}: 
  - Goals For: ${homeHistData?.goalsFor ?? 'N/A'}, Expected Goals For: ${homeHistData?.xGoalsFor?.toFixed(2) ?? 'N/A'}
  - Goals Against: ${homeHistData?.goalsAgainst ?? 'N/A'}, Expected Goals Against: ${homeHistData?.xGoalsAgainst?.toFixed(2) ?? 'N/A'}
- ${game.away_team}:
  - Goals For: ${awayHistData?.goalsFor ?? 'N/A'}, Expected Goals For: ${awayHistData?.xGoalsFor?.toFixed(2) ?? 'N/A'}
  - Goals Against: ${awayHistData?.goalsAgainst ?? 'N/A'}, Expected Goals Against: ${awayHistData?.xGoalsAgainst?.toFixed(2) ?? 'N/A'}
`;
        
        // FIX: The instruction is now a direct command to NOT use tools.
        const instruction = `
You are an expert sports betting analyst. You have been provided with all the necessary data in the 'Pre-Fetched Historical Data' and 'Prediction Model Factors' sections.
**Do not use your \`queryNhlStats\` tool.** Your sole task is to synthesize the data provided below and generate the final JSON object.
`;

        const analysisPrompt = `
**SYSTEM ANALYSIS REPORT**
**Matchup:** ${game.away_team} @ ${game.home_team}

${preFetchedDataSummary}

**Prediction Model Factors (Current Season):**
${factorsList || 'No valid live factors available.'}

**TASK:**
${instruction}

**JSON TO COMPLETE:**
${JSON.stringify(V3_ANALYSIS_SCHEMA, null, 2)}

**IMPORTANT: You MUST return ONLY the completed JSON object. Do not include any extra text, explanations, or markdown formatting.**
`;
        // We no longer need the logging now that the prompt is stable.
        const analysisData = await runAiChatWithTools(analysisPrompt);

        if (!analysisData || !analysisData.finalPick) {
            throw new Error("AI analysis failed to produce a valid JSON response after all steps.");
        }

        console.log("✅ Successfully generated final AI analysis.");
        res.json({ analysisData });

    } catch (error) {
        console.error("Global AI Analysis Endpoint Error:", error.message);
        res.status(500).json({ error: "A critical error occurred in the AI analysis endpoint." });
    }
});

app.get('/api/fusion-preview', async (req, res) => {
    try {
      
      const allAbbrevs = Object.keys(snapshot.teamStats);
      const filter = (req.query.teams || '').split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
      const target = filter.length ? filter : allAbbrevs;
      const fused = {};
      for (const abbr of target) {
        const curr = snapshot.teamStats[abbr];
        if (!curr) continue;
        const hist = await fetchHistoricalTeamContext(abbr);
        fused[abbr] = mergeHistoricalCurrent(hist, curr);
      }
      res.json({ date: snapshot.date, count: Object.keys(fused).length, teams: fused });
    } catch (e) {
      res.status(500).json({ error: 'Fusion failed', message: e?.message || String(e) });
    }
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'Public', 'index.html'));
});

const PORT = process.env.PORT || 10000;

// Start the server immediately
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    
    // Connect to the database in the background after the server has started
    connectToDb().catch(error => {
        console.error("Background database connection failed:", error);
        // We don't exit the process here, so the server keeps running
        // Your routes will handle the case where the DB is not available
    });
});
