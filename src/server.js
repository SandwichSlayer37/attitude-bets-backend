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
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, '..', 'Public')));

const queryNhlStatsTool = {
  functionDeclarations: [
    {
      name: "queryNhlStats",
      description: "Queries a comprehensive historical NHL database for player or team statistics. Can aggregate data to find league leaders or retrieve stats for a specific player/team in a given season.",
      parameters: {
        type: "OBJECT",
        properties: {
          season: {
            type: "NUMBER",
            description: "The year of the NHL season to query, e.g., 2023 for the 2023-2024 season."
          },
          dataType: {
            type: "STRING",
            description: "The type of data to query. Supported values are 'player' for individual player stats, and 'team' for aggregated team stats.",
          },
          stat: {
            type: "STRING",
            description: "The exact, case-sensitive data field to query, such as 'I_F_goals', 'onIce_corsiPercentage', 'xGoalsFor', etc."
          },
          playerName: {
            type: "STRING",
            description: "Optional. The full name of a specific player to query, e.g., 'Connor McDavid'. Required if dataType is 'player'."
          },
          teamName: {
            type: "STRING",
            description: "Optional. The full name of a specific team to aggregate or filter by, e.g., 'Edmonton Oilers'."
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

let db, recordsCollection, predictionsCollection, dailyFeaturesCollection, nhlStatsCollection;

async function connectToDb() {
    try {
        if (db) return db;
        const client = new MongoClient(DATABASE_URL);
        await client.connect();
        db = client.db('attitudebets');
        recordsCollection = db.collection('records');
        predictionsCollection = db.collection('predictions');
        dailyFeaturesCollection = db.collection('daily_features');
        nhlStatsCollection = db.collection('nhl_advanced_stats');
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
    'Vancouver Canucks': 'VAN', 'Vegas Golden Knights': 'VGK', 'Washington Capitals': 'WSH', 'Winnipeg Jets': 'WPG'
};

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
    'Anaheim Ducks': ['Ducks'], 'Arizona Coyotes': ['Coyotes'], 'Boston Bruins': ['Bruins'], 'Buffalo Sabres': ['Sabres'], 'Calgary Flames': ['Flames'], 'Carolina Hurricanes': ['Hurricanes', 'Canes'], 'Chicago Blackhawks': ['hawks', 'Blackhawks'], 'Colorado Avalanche': ['ColoradoAvalanche', 'Avalanche', 'Avs'], 'Columbus Blue Jackets': ['BlueJackets', 'Blue Jackets', 'CBJ'], 'Dallas Stars': ['DallasStars', 'Stars'], 'Detroit Red Wings': ['DetroitRedWings', 'Red Wings'], 'Edmonton Oilers': ['EdmontonOilers', 'Oilers'], 'Florida Panthers': ['FloridaPanthers', 'Panthers'], 'Los Angeles Kings': ['losangeleskings', 'Kings'], 'Minnesota Wild': ['wildhockey', 'Wild'], 'Montreal Canadiens': ['Habs', 'Canadiens'], 'Nashville Predators': ['Predators'], 'New Jersey Devils': ['devils'], 'New York Islanders': ['NewYorkIslanders', 'Islanders', 'Isles'], 'New York Rangers': ['rangers', 'NYR'], 'Ottawa Senators': ['OttawaSenators', 'Senators', 'Sens'], 'Philadelphia Flyers': ['Flyers'], 'Pittsburgh Penguins': ['penguins'], 'San Jose Sharks': ['SanJoseSharks', 'Sharks'], 'Seattle Kraken': ['SeattleKraken', 'Kraken'], 'St. Louis Blues': ['stlouisblues', 'Blues', 'St Louis Blues'], 'Tampa Bay Lightning': ['TampaBayLightning', 'Lightning', 'Bolts'], 'Toronto Maple Leafs': ['leafs', 'Maple Leafs', 'TOR'], 'Vancouver Canucks': ['canucks'], 'Vegas Golden Knights': ['goldenknights', 'Golden Knights', 'Knights'], 'Washington Capitals': ['caps', 'Capitals'], 'Winnipeg Jets': ['winnipegjets', 'Jets'],
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
    'Anaheim Ducks': 'ducks', 'Arizona Coyotes': 'Coyotes', 'Boston Bruins': 'BostonBruins', 'Buffalo Sabres': 'sabres', 'Calgary Flames': 'CalgaryFlames', 'Carolina Hurricanes': 'canes', 'Chicago Blackhawks': 'hawks', 'Colorado Avalanche': 'ColoradoAvalanche', 'Columbus Blue Jackets': 'BlueJackets', 'Dallas Stars': 'DallasStars', 'Detroit Red Wings': 'DetroitRedWings', 'Edmonton Oilers': 'EdmontonOilers', 'Florida Panthers': 'FloridaPanthers', 'Los Angeles Kings': 'losangeleskings', 'Minnesota Wild': 'wildhockey', 'Montreal Canadiens': 'Habs', 'Nashville Predators': 'Predators', 'New Jersey Devils': 'devils', 'New York Islanders': 'NewYorkIslanders', 'New York Rangers': 'rangers', 'Ottawa Senators': 'OttawaSenators', 'Philadelphia Flyers': 'Flyers', 'Pittsburgh Penguins': 'penguins', 'San Jose Sharks': 'SanJoseSharks', 'Seattle Kraken': 'SeattleKraken', 'St. Louis Blues': 'stlouisblues', 'Tampa Bay Lightning': 'TampaBayLightning', 'Toronto Maple Leafs': 'leafs', 'Vancouver Canucks': 'canucks', 'Vegas Golden Knights': 'goldenknights', 'Washington Capitals': 'caps', 'Winnipeg Jets': 'winnipegjets',
    'Arizona Diamondbacks': 'azdiamondbacks', 'Atlanta Braves': 'Braves', 'Baltimore Orioles': 'orioles', 'Boston Red Sox': 'redsox', 'Chicago Cubs': 'CHICubs', 'Chicago White Sox': 'whitesox', 'Cincinnati Reds': 'reds', 'Cleveland Guardians': 'ClevelandGuardians', 'Colorado Rockies': 'ColoradoRockies', 'Detroit Tigers': 'motorcitykitties', 'Houston Astros': 'Astros', 'Kansas City Royals': 'KCRoyals', 'Los Angeles Angels': 'angelsbaseball', 'Los Angeles Dodgers': 'Dodgers', 'Miami Marlins': 'miamimarlins', 'Milwaukee Brewers': 'Brewers', 'Minnesota Twins': 'minnesotatwins', 'New York Mets': 'NewYorkMets', 'New York Yankees': 'NYYankees', 'Oakland Athletics': 'oaklandathletics', 'Philadelphia Phillies': 'phillies', 'Pittsburgh Pirates': 'buccos', 'San Diego Padres': 'Padres', 'San Francisco Giants': 'SFGiants', 'Seattle Mariners': 'Mariners', 'St. Louis Cardinals': 'Cardinals', 'Tampa Bay Rays': 'tampabayrays', 'Texas Rangers': 'TexasRangers', 'Toronto Blue Jays': 'TorontoBlueJays', 'Washington Nationals': 'Nationals',
};

// --- HELPER FUNCTIONS ---
function cleanAndParseJson(jsonString) {
    if (!jsonString) return null;
    const cleanedString = jsonString.replace(/^```json\s*/, '').replace(/```$/, '');
    try {
        return JSON.parse(cleanedString);
    } catch (e) {
        console.error("Failed to parse cleaned JSON string:", cleanedString);
        throw e;
    }
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
    console.log("Executing Dynamic NHL Stats Query with args:", args);
    const { season, dataType, stat, playerName, teamName, limit = 5 } = args;

    if (!season || !dataType || !stat) {
        return { error: "A season, dataType ('player' or 'team'), and a stat are required." };
    }
    if (!ALLOWED_STATS.has(stat)) {
        return { error: `The stat '${stat}' is not a valid, queryable field.` };
    }

    try {
        const seasonNumber = parseInt(season, 10);
        const pipeline = [];

        // Match the season first
        pipeline.push({ $match: { season: seasonNumber } });
        
        let results;

        if (dataType === 'player') {
            if (!playerName) return { error: "playerName is required for dataType 'player'." };
            
            pipeline.push({ $match: { name: playerName } });
            pipeline.push({ $limit: 1 });
            pipeline.push({ $project: { _id: 0, name: 1, team: 1, position: 1, games_played: 1, statValue: `$${stat}` } });
            results = await nhlStatsCollection.aggregate(pipeline).toArray();

        } else if (dataType === 'team') {
            if (teamName) {
                const teamAbbr = teamToAbbrMap[teamName] || teamName.toUpperCase();
                pipeline.push({ $match: { team: teamAbbr } });
            }
            
            pipeline.push({
                $group: {
                    _id: "$team",
                    statValue: { $sum: `$${stat}` } // Aggregate the requested stat
                }
            });
            pipeline.push({ $sort: { statValue: -1 } });
            pipeline.push({ $limit: parseInt(limit, 10) });
            pipeline.push({ $project: { _id: 0, team: "$_id", statValue: 1 } });
            results = await nhlStatsCollection.aggregate(pipeline).toArray();

        } else {
            return { error: "Invalid dataType. Must be 'player' or 'team'." };
        }
        
        return { results };

    } catch (error) {
        console.error("Error during Dynamic NHL stats query:", error);
        return { error: "An error occurred while querying the database." };
    }
}


async function getDynamicWeights(sportKey) {
    if (sportKey === 'baseball_mlb') {
        return { record: 6, momentum: 5, value: 5, newsSentiment: 10, injuryImpact: 12, offensiveForm: 12, defensiveForm: 12, h2h: 10, weather: 8, pitcher: 15 };
    }
    // ENGINE 2.0 HYBRID WEIGHTS
    if (sportKey === 'icehockey_nhl') {
        return { 
            // Engine 2.0 Advanced Factors
            fiveOnFiveXg: 3.5,
            highDangerBattle: 3.0,
            specialTeamsDuel: 2.5,
            // Core Real-Time Factors
            goalie: 2.5,
            offensiveForm: 1.0,
            defensiveForm: 1.0,
            injury: 1.5,
            fatigue: 1.0,
            h2h: 1.0,
            // Situational & Legacy Factors
            record: 0.5,
            hotStreak: 0.8,
            faceoffAdvantage: 0.5,
            pdo: 1.0, // Kept for luck regression
            value: 0.5 
        };
    }
    return { record: 8, fatigue: 7, momentum: 5, matchup: 10, value: 5, newsSentiment: 10, injuryImpact: 12, offensiveForm: 9, defensiveForm: 9, h2h: 11, weather: 5 };
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

// ✅ FIX: Re-enabled the prop bet logic, it will now run.
async function updatePlayerSpotlightForSport(sport) {
    console.log(`--- Starting BACKGROUND JOB: AI Player Spotlight for ${sport.name} ---`);
    try {
        const gamesForSport = await getOdds(sport.key);
        let allPropBets = [];
        for (const game of gamesForSport) {
            const props = await getPropBets(game.sportKey, game.id);
            if (props.length > 0) {
                allPropBets.push({
                    matchup: `${game.away_team} @ ${game.home_team}`,
                    bookmakers: props
                });
            }
            await new Promise(resolve => setTimeout(resolve, 2500)); 
        }

        const dbKey = `spotlight_${sport.key}`;
        if (allPropBets.length < 3) {
            console.log(`Not enough prop data for ${sport.name} to generate spotlight. Skipping update.`);
            await dailyFeaturesCollection.updateOne({ _id: dbKey }, { $set: { error: `Not enough prop bet data available for ${sport.name}.`, updatedAt: new Date() } }, { upsert: true });
            return;
        }

        const propsForPrompt = allPropBets.map(game => {
            let gameText = `\nMatchup: ${game.matchup}\n`;
            if (game.bookmakers && Array.isArray(game.bookmakers)) {
                game.bookmakers.forEach(bookmaker => {
                    if (bookmaker.markets && Array.isArray(bookmaker.markets)) {
                        bookmaker.markets.forEach(market => {
                            if (market.outcomes && Array.isArray(market.outcomes)) {
                                market.outcomes.forEach(outcome => {
                                    gameText += `- ${outcome.description} (${outcome.name}): ${outcome.price}\n`;
                                });
                            }
                        });
                    }
                });
            }
            return gameText;
        }).join('');

        // ✅ FIX: Removed instruction to use search tools from the prompt.
        const systemPrompt = `You are an expert sports betting analyst. Your only task is to analyze a massive list of available player prop bets for the day and identify the single "Hottest Player". Complete the JSON object provided by the user.`;
        
        const userPrompt = `Based on the following comprehensive list of player prop bets, identify the single best "Hottest Player" of the day and complete the JSON object below. Do not add any extra text, markdown, or explanations.
**Available Prop Bets Data:**
${propsForPrompt}
**JSON to complete:**
{
  "playerName": "",
  "teamName": "",
  "rationale": "Provide a 3-4 sentence analysis explaining why this player is the 'hottest player'. Mention the specific matchups or statistical advantages that make their props attractive.",
  "keyBets": "List 2-3 of their most attractive prop bets that you identified."
}`;

        const result = await analysisModel.generateContent(userPrompt);
        const responseText = result.response.text();
        const analysisResult = cleanAndParseJson(responseText);

        await dailyFeaturesCollection.updateOne({ _id: dbKey }, { $set: { data: analysisResult, error: null, updatedAt: new Date() } }, { upsert: true });
        console.log(`--- BACKGROUND JOB COMPLETE: AI Player Spotlight for ${sport.name} updated. ---`);
    } catch (error) {
        console.error(`Error during background Player Spotlight update for ${sport.key}:`, error);
        const dbKey = `spotlight_${sport.key}`;
        await dailyFeaturesCollection.updateOne({ _id: dbKey }, { $set: { error: `An unexpected error occurred during analysis for ${sport.name}.`, updatedAt: new Date() } }, { upsert: true });
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
            for (const date of datesToFetch) {
                const { data } = await axios.get(`https://api.the-odds-api.com/v4/sports/${sportKey}/odds/?regions=us&markets=h2h&oddsFormat=decimal&date=${date}&apiKey=${ODDS_API_KEY}`);
                if (data) {
                    for (const game of data) {
                        if (!gameIds.has(game.id)) {
                            allGames.push(game);
                            gameIds.add(game.id);
                        }
                    }
                }
            }
            return allGames;
        } catch (error) {
            if (error.response && error.response.status === 429) {
                 console.error("ERROR IN getOdds function: Rate limit hit (429). The API is busy. Please wait a minute.");
            } else {
                 console.error("ERROR IN getOdds function:", error.message);
            }
            return [];
        }
    }, 900000);
}

// ✅ FIX: Improved error handling to be less noisy for expected 404s.
async function getPropBets(sportKey, gameId) {
    const key = `props_${gameId}`;
    return fetchData(key, async () => {
        try {
            const markets = 'player_points,player_rebounds,player_assists,player_pass_tds,player_pass_yds,player_strikeouts';
            const url = `https://api.the-odds-api.com/v4/sports/${sportKey}/events/${gameId}/odds?apiKey=${ODDS_API_KEY}&regions=us&markets=${markets}&oddsFormat=decimal`;
            const { data } = await axios.get(url);
            return data.bookmakers || [];
        } catch (error) {
            if (error.response && (error.response.status === 404 || error.response.status === 422)) {
                // Log 404/422 (Not Found) errors quietly as they are expected if props aren't available
                console.log(`[INFO] No prop bet markets found for game ${gameId}. (Status: ${error.response.status})`);
            } else if (error.response) {
                // Log other HTTP errors more loudly
                console.error(`Could not fetch prop bets for game ${gameId}: Request failed with status code ${error.response.status}`);
            } else {
                 console.error(`Could not fetch prop bets for game ${gameId}:`, error.message);
            }
            return [];
        }
    }, 1800000);
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

// =================================================================
// NEW NHL ENGINE 2.0
// =================================================================

// MODIFICATION START: Final and correct DB aggregation logic
async function getTeamSeasonAdvancedStats(team, season) {
    const cacheKey = `adv_stats_final_agg_${team}_${season}_v3`;
    return fetchData(cacheKey, async () => {
        try {
            const seasonNumber = parseInt(String(season), 10);

            const pipeline = [
                {
                    // FIX: Match season as either a number or a string to handle data inconsistencies
                    $match: {
                        team: team,
                        $or: [
                            { season: seasonNumber },
                            { season: String(seasonNumber) }
                        ]
                    }
                },
                {
                    $group: {
                        _id: "$situation", // Group by each situation (5on5, 5on4, etc.)
                        // Sum the required fields for the entire season
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

            if (!results || results.length === 0) {
                console.log(`[DATA NOT FOUND] Aggregation returned no documents for ${team} in season ${seasonNumber}.`);
                return {};
            }
            
            const seasonalData = results.reduce((acc, curr) => {
                acc[curr._id] = curr;
                return acc;
            }, {});

            const s5on5 = seasonalData['5on5'];
            const s5on4 = seasonalData['5on4']; // Team is on the Power Play
            const s4on5 = seasonalData['4on5']; // Team is on the Penalty Kill

            if (!s5on5) {
                console.log(`[WARN] Aggregated 5on5 data missing for ${team} in ${seasonNumber}. Cannot calculate advanced stats.`);
                return {};
            }

            const finalStats = {};

            // Calculate 5-on-5 xG%
            const totalXG_5on5 = s5on5.totalxGoalsFor + s5on5.totalxGoalsAgainst;
            if (totalXG_5on5 > 0) {
                finalStats.fiveOnFiveXgPercentage = (s5on5.totalxGoalsFor / totalXG_5on5) * 100;
            }

            // Calculate High-Danger Battle
            const totalHDXG_5on5 = s5on5.totalHighDangerxGoalsFor + s5on5.totalHighDangerxGoalsAgainst;
            if (totalHDXG_5on5 > 0) {
                finalStats.hdcfPercentage = (s5on5.totalHighDangerxGoalsFor / totalHDXG_5on5) * 100;
            }
            
            // Calculate Special Teams Duel
            const ppRating = s5on4 ? s5on4.totalxGoalsFor : 0;
            const pkRating = s4on5 ? s4on5.totalxGoalsAgainst : 0;
            finalStats.specialTeamsRating = ppRating - pkRating;

            // Calculate PDO (Luck Factor)
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
// MODIFICATION END


async function runAdvancedNhlPredictionEngine(game, context) {
    const { teamStats, injuries, h2h, allGames, goalieStats, probableStarters } = context;
    const { home_team, away_team } = game;
    const weights = getDynamicWeights('icehockey_nhl');
    
    const homeCanonical = Object.keys(teamToAbbrMap).find(key => key.toLowerCase() === home_team.toLowerCase()) || home_team;
    const awayCanonical = Object.keys(teamToAbbrMap).find(key => key.toLowerCase() === away_team.toLowerCase()) || away_team;
    
    const homeAbbr = teamToAbbrMap[homeCanonical] || homeCanonical;
    const awayAbbr = teamToAbbrMap[awayCanonical] || awayCanonical;

    const currentYear = new Date().getFullYear();
    const previousSeasonId = currentYear - 1; // 2024 for a 2025 run
    const twoSeasonsAgoId = currentYear - 2; // 2023 for a 2025 run

    let [homeAdvStats, awayAdvStats] = await Promise.all([
        getTeamSeasonAdvancedStats(homeAbbr, previousSeasonId),
        getTeamSeasonAdvancedStats(awayAbbr, previousSeasonId)
    ]);
    
    if (Object.keys(homeAdvStats).length === 0 || Object.keys(awayAdvStats).length === 0) {
         console.log(`[WARN] No data found for previous season (${previousSeasonId}). Falling back two seasons to ${twoSeasonsAgoId} as a temporary measure.`);
         [homeAdvStats, awayAdvStats] = await Promise.all([
            getTeamSeasonAdvancedStats(homeAbbr, twoSeasonsAgoId),
            getTeamSeasonAdvancedStats(awayAbbr, twoSeasonsAgoId)
        ]);
    }

    let homeScore = 50.0;
    const factors = {};

    const homeRealTimeStats = teamStats[homeCanonical] || {};
    const awayRealTimeStats = teamStats[awayCanonical] || {};

    factors['Record'] = { value: (getWinPct(parseRecord(homeRealTimeStats.record)) - getWinPct(parseRecord(awayRealTimeStats.record))), homeStat: homeRealTimeStats.record || '0-0', awayStat: awayRealTimeStats.record || '0-0' };
    factors['Offensive Form (G/GP)'] = { value: (homeRealTimeStats.goalsForPerGame || 0) - (awayRealTimeStats.goalsForPerGame || 0), homeStat: `${(homeRealTimeStats.goalsForPerGame || 0).toFixed(2)} G/GP`, awayStat: `${(awayRealTimeStats.goalsForPerGame || 0).toFixed(2)} G/GP` };
    factors['Defensive Form (GA/GP)'] = { value: (awayRealTimeStats.goalsAgainstPerGame || 0) - (homeRealTimeStats.goalsAgainstPerGame || 0), homeStat: `${(homeRealTimeStats.goalsAgainstPerGame || 0).toFixed(2)} GA/GP`, awayStat: `${(awayRealTimeStats.goalsAgainstPerGame || 0).toFixed(2)} GA/GP` };
    factors['Faceoff Advantage'] = { value: (homeRealTimeStats.faceoffWinPct || 0) - (awayRealTimeStats.faceoffWinPct || 0), homeStat: `${(homeRealTimeStats.faceoffWinPct || 0).toFixed(1)}%`, awayStat: `${(awayRealTimeStats.faceoffWinPct || 0).toFixed(1)}%` };
    
    if (homeAdvStats.fiveOnFiveXgPercentage && awayAdvStats.fiveOnFiveXgPercentage) {
        factors['5-on-5 xG%'] = { value: homeAdvStats.fiveOnFiveXgPercentage - awayAdvStats.fiveOnFiveXgPercentage, homeStat: `${homeAdvStats.fiveOnFiveXgPercentage.toFixed(1)}%`, awayStat: `${awayAdvStats.fiveOnFiveXgPercentage.toFixed(1)}%` };
    }
    if (homeAdvStats.hdcfPercentage && awayAdvStats.hdcfPercentage) {
        factors['High-Danger Battle'] = { value: homeAdvStats.hdcfPercentage - awayAdvStats.hdcfPercentage, homeStat: `${homeAdvStats.hdcfPercentage.toFixed(1)}%`, awayStat: `${awayAdvStats.hdcfPercentage.toFixed(1)}%` };
    }
    if (typeof homeAdvStats.specialTeamsRating === 'number' && typeof awayAdvStats.specialTeamsRating === 'number') {
        factors['Special Teams Duel'] = { value: homeAdvStats.specialTeamsRating - awayAdvStats.specialTeamsRating, homeStat: `${homeAdvStats.specialTeamsRating.toFixed(2)}`, awayStat: `${awayAdvStats.specialTeamsRating.toFixed(2)}` };
    }
    if (homeAdvStats.pdo && awayAdvStats.pdo) {
        factors['PDO (Luck Factor)'] = { value: homeAdvStats.pdo - awayAdvStats.pdo, homeStat: `${homeAdvStats.pdo.toFixed(0)}`, awayStat: `${awayAdvStats.pdo.toFixed(0)}` };
    }

    const homeStreakVal = (homeRealTimeStats.streak?.startsWith('W') ? 1 : -1) * parseInt(homeRealTimeStats.streak?.substring(1) || 0, 10);
    const awayStreakVal = (awayRealTimeStats.streak?.startsWith('W') ? 1 : -1) * parseInt(awayRealTimeStats.streak?.substring(1) || 0, 10);
    factors['Hot Streak'] = { value: homeStreakVal - awayStreakVal, homeStat: homeRealTimeStats.streak || 'N/A', awayStat: awayRealTimeStats.streak || 'N/A' };
    
    const homeGoalieName = probableStarters[homeCanonical];
    const awayGoalieName = probableStarters[awayCanonical];
    const homeGoalieStats = homeGoalieName ? goalieStats[homeGoalieName] : null;
    const awayGoalieStats = awayGoalieName ? goalieStats[awayGoalieName] : null;
    let goalieValue = 0;
    let homeGoalieDisplay = "N/A", awayGoalieDisplay = "N/A";
    if (homeGoalieStats && awayGoalieStats) {
        goalieValue = (awayGoalieStats.gaa - homeGoalieStats.gaa) + ((homeGoalieStats.svPct - awayGoalieStats.svPct) * 100);
        homeGoalieDisplay = `${homeGoalieName.split(' ').slice(-1)} ${(homeGoalieStats.svPct || 0).toFixed(3)}`;
        awayGoalieDisplay = `${awayGoalieName.split(' ').slice(-1)} ${(awayGoalieStats.svPct || 0).toFixed(3)}`;
    }
    factors['Goalie Matchup'] = { value: goalieValue, homeStat: homeGoalieDisplay, awayStat: awayGoalieDisplay };
    factors['H2H (Season)'] = { value: (getWinPct(parseRecord(h2h.home)) - getWinPct(parseRecord(h2h.away))) * 10, homeStat: h2h.home, awayStat: h2h.away };
    
    factors['Fatigue'] = { 
        value: (calculateFatigue(away_team, allGames, new Date(game.commence_time)) - calculateFatigue(home_team, allGames, new Date(game.commence_time))), 
        homeStat: `${calculateFatigue(home_team, allGames, new Date(game.commence_time))} pts`, 
        awayStat: `${calculateFatigue(away_team, allGames, new Date(game.commence_time))} pts` 
    };
    
    const homeInjuryImpact = (injuries[homeCanonical] || []).length;
    const awayInjuryImpact = (injuries[awayCanonical] || []).length;
    // FIX: Corrected typo from awayCanonicalName to awayCanonical
    factors['Injury Impact'] = { value: (awayInjuryImpact - homeInjuryImpact), homeStat: `${homeInjuryImpact} players`, awayStat: `${awayInjuryImpact} players`, injuries: { home: injuries[homeCanonical] || [], away: injuries[awayCanonical] || [] } };

    Object.keys(factors).forEach(factorName => {
        if (factors[factorName] && typeof factors[factorName].value === 'number' && !isNaN(factors[factorName].value)) {
            const factorKey = {
                '5-on-5 xG%': 'fiveOnFiveXg',
                'High-Danger Battle': 'highDangerBattle',
                'Special Teams Duel': 'specialTeamsDuel',
                'Goalie Matchup': 'goalie',
                'Injury Impact': 'injury',
                'Fatigue': 'fatigue',
                'H2H (Season)': 'h2h',
                'Hot Streak': 'hotStreak',
                'Record': 'record',
                'Offensive Form (G/GP)': 'offensiveForm',
                'Defensive Form (GA/GP)': 'defensiveForm',
                'Faceoff Advantage': 'faceoffAdvantage',
                'PDO (Luck Factor)': 'pdo'
            }[factorName];

            if (factorKey && weights[factorKey]) {
                const weight = weights[factorKey];
                homeScore += factors[factorName].value * weight;
            }
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
    } else {
         factors['Betting Value'] = { value: 0, homeStat: `N/A`, awayStat: `N/A` };
    }
    
    const winner = homeScore > 50 ? home_team : away_team;
    const confidence = Math.abs(50 - homeScore);
    let strengthText = confidence > 15 ? "Strong Advantage" : confidence > 7.5 ? "Good Chance" : "Slight Edge";

    return { winner, strengthText, confidence, factors, homeValue, awayValue };
}
// =================================================================
// END OF NHL ENGINE 2.0
// =================================================================

// MODIFICATION START: Refactored prediction logic into a reusable function
async function getPredictionsForSport(sportKey) {
    const [games, espnDataResponse, teamStats, probablePitchers, goalieStats] = await Promise.all([
        getOdds(sportKey),
        fetchEspnData(sportKey),
        getTeamStatsFromAPI(sportKey),
        sportKey === 'baseball_mlb' ? getProbablePitchersAndStats() : Promise.resolve({}),
        sportKey === 'icehockey_nhl' ? getGoalieStats() : Promise.resolve({})
    ]);

    if (!games || games.length === 0) {
        return []; 
    }

    const injuries = {};
    const h2hRecords = {};
    const probableStarters = {};
    if (espnDataResponse?.events) {
        espnDataResponse.events.forEach(event => {
            const competition = event.competitions?.[0];
            if (!competition) return;
            competition.competitors.forEach(competitor => {
                const canonicalName = canonicalTeamNameMap[competitor.team.displayName.toLowerCase()];
                if (canonicalName) {
                    injuries[canonicalName] = (competitor.injuries || []).map(inj => ({ name: inj.athlete.displayName, status: inj.status.name }));
                    if (sportKey === 'icehockey_nhl' && competitor.probablePitcher) {
                        probableStarters[canonicalName] = competitor.probablePitcher.athlete.displayName;
                    }
                }
            });
            const homeTeam = competition.competitors.find(c => c.homeAway === 'home');
            const awayTeam = competition.competitors.find(c => c.homeAway === 'away');
            if (competition.series && homeTeam && awayTeam) {
                const homeCanonical = canonicalTeamNameMap[homeTeam.team.displayName.toLowerCase()];
                const awayCanonical = canonicalTeamNameMap[awayTeam.team.displayName.toLowerCase()];
                if (homeCanonical && awayCanonical) {
                    const gameId = `${awayCanonical}@${homeCanonical}`;
                    const homeWins = competition.series.competitors.find(c => c.id === homeTeam.id)?.wins || 0;
                    const awayWins = competition.series.competitors.find(c => c.id === awayTeam.id)?.wins || 0;
                    h2hRecords[gameId] = { home: `${homeWins}-${awayWins}`, away: `${awayWins}-${homeWins}` };
                }
            }
        });
    }

    const predictions = [];
    for (const game of games) {
        const homeCanonical = canonicalTeamNameMap[game.home_team.toLowerCase()] || game.home_team;
        const awayCanonical = canonicalTeamNameMap[game.away_team.toLowerCase()] || game.away_team;
        const weather = await getWeatherData(homeCanonical);
        const h2h = h2hRecords[`${awayCanonical}@${homeCanonical}`] || { home: '0-0', away: '0-0' };
        
        let predictionData;
        if (sportKey === 'icehockey_nhl') {
            const context = { teamStats, injuries, h2h, allGames: games, goalieStats, probableStarters };
            predictionData = await runAdvancedNhlPredictionEngine(game, context);
        } else {
            const context = { teamStats, weather, injuries, h2h, allGames: games, probablePitchers };
            predictionData = await runPredictionEngine(game, sportKey, context);
        }

        if (predictionData && predictionData.winner && predictionsCollection) {
            try {
                const homeOdds = game.bookmakers?.[0]?.markets?.find(m => m.key === 'h2h')?.outcomes?.find(o => o.name === game.home_team)?.price;
                const awayOdds = game.bookmakers?.[0]?.markets?.find(m => m.key === 'h2h')?.outcomes?.find(o => o.name === game.away_team)?.price;
                const winnerOdds = predictionData.winner === game.home_team ? homeOdds : awayOdds;
                await predictionsCollection.updateOne(
                    { gameId: game.id },
                    {
                        $set: {
                            gameId: game.id, sportKey: sportKey, homeTeam: game.home_team, awayTeam: game.away_team,
                            predictedWinner: predictionData.winner, gameDate: game.commence_time, status: 'pending',
                            odds: winnerOdds || null
                        }
                    },
                    { upsert: true }
                );
            } catch (dbError) {
                console.error("DB Save Error:", dbError);
            }
        }

        const espnEvent = espnDataResponse?.events?.find(e => {
            const competitors = e.competitions?.[0]?.competitors;
            if (!competitors) return false;
            const home = competitors.find(c => c.homeAway === 'home');
            const away = competitors.find(c => c.homeAway === 'away');
            if (!home || !away) return false;
            return (canonicalTeamNameMap[home.team.displayName.toLowerCase()] === homeCanonical && canonicalTeamNameMap[away.team.displayName.toLowerCase()] === awayCanonical);
        });

        predictions.push({ game: { ...game, sportKey: sportKey, espnData: espnEvent || null }, prediction: predictionData });
    }
    return predictions.filter(p => p && p.prediction);
}

// FIX: Added the missing getAllDailyPredictions function to resolve server crash
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
// MODIFICATION END


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

app.get('/api/player-spotlight', async (req, res) => {
    const { sport } = req.query;
    if (!sport) {
        return res.status(400).json({ error: "Sport parameter is required." });
    }
    try {
        const spotlightDoc = await dailyFeaturesCollection.findOne({ _id: `spotlight_${sport}` });
        if (spotlightDoc) {
            res.json(spotlightDoc);
        } else {
            res.status(404).json({ error: "Spotlight analysis not yet available." });
        }
    } catch (error) {
        console.error("Player Spotlight GET Endpoint Error:", error);
        res.status(500).json({ error: "Failed to retrieve Player Spotlight analysis." });
    }
});

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
        const { candidates } = req.body; // Expect an array of top picks
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

// Add this new endpoint to handle chat requests
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
                // Handle other potential function calls in the future
                functionResponse = { error: `Unknown function ${call.name}` };
            }

            // Send the function's result back to the model
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
            // The model answered directly without needing the database
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
            const { data: espnData } = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0...' }});
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
        res.json(recentBets);
    } catch (error) {
        console.error("Recent Bets Error:", error);
        res.status(500).json({ error: "Failed to fetch recent bets." });
    }
});
app.get('/api/futures', (req, res) => res.json(FUTURES_PICKS_DB));
// STEP 1: Define the new, more detailed JSON schema just before your endpoint.
const V2_ANALYSIS_SCHEMA = {
  "finalPick": "string",
  "isOverride": "boolean",
  "confidenceScore": "string (High, Medium, or Low)",
  "confidenceRationale": "string (A brief explanation for the confidence level, citing data.)",
  "gameNarrative": "string (The story of the matchup in 2-3 sentences.)",
  "keyFactorWithData": {
    "factor": "string (The single most important factor, e.g., 'Starting Pitcher Duel')",
    "data": "string (The specific stats that make this factor critical, e.g., 'Home pitcher has a 1.85 ERA over his last 5 starts, while the away pitcher's is 5.50.')"
  },
  "counterArgument": "string (The strongest argument AGAINST your final pick.)",
  "rebuttal": "string (Why you believe your pick is still the right one despite the counter-argument.)",
  "xFactor": "string (A player, stat, or condition that could unexpectedly swing the outcome.)"
};

app.post('/api/ai-analysis', async (req, res) => {
    try {
        const { game, prediction } = req.body;
        const { factors } = prediction;

        const homeCanonical = canonicalTeamNameMap[game.home_team.toLowerCase()] || game.home_team;
        const awayCanonical = canonicalTeamNameMap[game.away_team.toLowerCase()] || game.away_team;
        const [homeNews, awayNews] = await Promise.all([
            getTeamNewsFromReddit(homeCanonical),
            getTeamNewsFromReddit(awayCanonical)
        ]);

        const factorsList = Object.entries(factors).map(([key, value]) => `- ${key}: Home (${value.homeStat}), Away (${value.awayStat})`).join('\n');

        // ✅ FIX: Removed instruction to use search tools from the prompt.
        const systemPrompt = `You are a master sports betting analyst and strategist, acting as the final decision-maker. You will be given a statistical report and recent news headlines from team communities. Your task is to synthesize all of this information to create a compelling game narrative, identify the single most important factor, and acknowledge any risks before making your final pick. Your response must be only the JSON object specified.`;
        
        const userPrompt = `
**STATISTICAL REPORT: ${game.away_team} @ ${game.home_team}**
- Initial Recommended Pick: ${prediction.winner}
- Algorithm Confidence: ${prediction.strengthText}
${factorsList}

**RECENT NEWS & SENTIMENT (from team subreddits):**
- **${game.home_team} News:**
${homeNews}
- **${game.away_team} News:**
${awayNews}

**TASK:**
Analyze all provided information and complete the following JSON object with your strategic breakdown. Ensure every field is populated with deep, data-driven insights.

**JSON TO COMPLETE:**
${JSON.stringify(V2_ANALYSIS_SCHEMA, null, 2)}
`;
        const result = await analysisModel.generateContent({
            contents: [{ role: "user", parts: [{ text: userPrompt }] }],
            systemInstruction: {
                parts: [{ text: systemPrompt }],
            },
        });
        const responseText = result.response.text();
        const analysisData = cleanAndParseJson(responseText);
        res.json({ analysisData });
    } catch (error) {
        console.error("Advanced AI Analysis Error:", error);
        res.status(500).json({ error: "Failed to generate Advanced AI analysis." });
    }
});

app.post('/api/parlay-ai-analysis', async (req, res) => {
    try {
        if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not set.");
        const { parlay } = req.body;
        const leg1 = parlay.legs[0];
        const leg2 = parlay.legs[1];
        const systemPrompt = `You are a data analyst. Your only task is to complete the JSON object provided by the user with accurate and insightful analysis based on the data.`;
        
        const userPrompt = `Based on the following data, analyze the parlay and complete the JSON object below. Do not add any extra text, markdown, or explanations.
**Data:**
- Total Odds: ${parlay.totalOdds}
- Leg 1: Pick ${leg1.prediction.winner} in the matchup ${leg1.game.away_team} @ ${leg1.game.home_team}.
- Leg 2: Pick ${leg2.prediction.winner} in the matchup ${leg2.game.away_team} @ ${leg2.game.home_team}.
**JSON to complete:**
{
  "overview": "",
  "bullCase": "",
  "bearCase": ""
}`;
        const result = await analysisModel.generateContent({
            contents: [{ role: "user", parts: [{ text: userPrompt }] }],
            systemInstruction: {
                parts: [{ text: systemPrompt }],
            },
        });
        const responseText = result.response.text();
        const parlayData = cleanAndParseJson(responseText);

        const analysisHtml = `
            <div class="p-4 rounded-lg bg-slate-700/50 border border-purple-500 text-center mb-4">
                 <h4 class="text-sm font-bold text-gray-400 uppercase">Parlay Overview</h4>
                 <p class="text-lg text-white mt-1">${parlayData.overview}</p>
            </div>
            <div class="space-y-4">
                <div class="p-4 rounded-lg bg-slate-700/50 border border-slate-600">
                    <h4 class="text-lg font-bold text-green-400">Bull Case (Why It Hits)</h4>
                    <p class="mt-2 text-gray-300">${parlayData.bullCase}</p>
                </div>
                <div class="p-4 rounded-lg bg-slate-700/50 border border-slate-600">
                    <h4 class="text-lg font-bold text-red-400">Bear Case (Primary Risks)</h4>
                    <p class="mt-2 text-gray-300">${parlayData.bearCase}</p>
                </div>
            </div>`;
        res.json({ analysisHtml });
    } catch (error) {
        console.error("Parlay AI Analysis Error:", error);
        res.status(500).json({ error: "Failed to generate Parlay AI analysis." });
    }
});

// ✅ FIX: Re-enabled prop analysis endpoint, but warns user if data is unavailable.
app.post('/api/ai-prop-analysis', async (req, res) => {
    try {
        const { game, prediction } = req.body;
        if (!game || !prediction) return res.status(400).json({ error: 'Game and prediction data are required.' });
        
        const bookmakers = await getPropBets(game.sportKey, game.id);
        
        if (bookmakers.length === 0 || !bookmakers[0].markets || bookmakers[0].markets.length === 0) {
            return res.json({ 
                analysisHtml: `<h4 class='text-lg font-bold text-yellow-400 mb-2'>No Prop Bets Found</h4><p>We couldn't find any player prop bet markets for this game at the moment. This is common for games that are further out.</p>`
            });
        }
        
        let availableProps = '';
        bookmakers[0].markets.forEach(market => {
            availableProps += `\nMarket: ${market.key}\n`;
            market.outcomes.forEach(outcome => {
                availableProps += `- ${outcome.description} (${outcome.name}): ${outcome.price}\n`;
            });
        });

        // ✅ FIX: Removed instruction to use search tools from the prompt.
        const systemPrompt = `You are a data analyst. Your only task is to complete the JSON object provided by the user with accurate and insightful analysis based on the data.`;

        const userPrompt = `Based on the following data, identify the single best prop bet and complete the JSON object below. Do not add any extra text, markdown, or explanations.
**Data:**
Main Game Analysis: The algorithm predicts ${prediction.winner} will win.
Available Prop Bets: ${availableProps}
**JSON to complete:**
{
  "pick": "",
  "rationale": "",
  "risk": ""
}`;
        const result = await analysisModel.generateContent(userPrompt);
        const responseText = result.response.text();
        const propData = cleanAndParseJson(responseText);

        const analysisHtml = `
            <div class="space-y-4">
                <div class="p-4 rounded-lg bg-slate-700/50 border border-teal-500 text-center">
                     <h4 class="text-sm font-bold text-gray-400 uppercase">Top AI Prop Pick</h4>
                     <p class="text-xl font-bold text-white mt-1">${propData.pick}</p>
                </div>
                <div class="p-4 rounded-lg bg-slate-700/50 border border-slate-600">
                    <h4 class="text-lg font-bold text-green-400">Rationale</h4>
                    <p class="mt-2 text-gray-300">${propData.rationale}</p>
                </div>
                <div class="p-4 rounded-lg bg-slate-700/50 border border-slate-600">
                    <h4 class="text-lg font-bold text-red-400">Risk Factor</h4>
                    <p class="mt-2 text-gray-300">${propData.risk}</p>
                </div>
            </div>`;
        res.json({ analysisHtml });
    } catch (error) {
        console.error("AI Prop Analysis Error:", error);
        res.status(500).json({ error: "Failed to generate AI prop analysis." });
    }
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'Public', 'index.html'));
});

function runSpotlightJobs() {
    console.log("Kicking off sequential spotlight jobs...");
    (async () => {
        for (const sport of SPORTS_DB) {
            await updatePlayerSpotlightForSport(sport);
        }
        console.log("All spotlight jobs complete.");
    })();
}

const PORT = process.env.PORT || 10000;
connectToDb()
    .then(() => {
        app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
        setTimeout(runSpotlightJobs, 30000); 
    })
    .catch(error => {
        console.error("Failed to start server:", error);
        process.exit(1);
    });

