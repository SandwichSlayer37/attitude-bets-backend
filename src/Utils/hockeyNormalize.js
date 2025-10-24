const teamAliasMap = {
    'Anaheim Ducks': ['Ducks', 'ANA'],
    'Arizona Coyotes': ['Coyotes', 'ARI'],
    'Boston Bruins': ['Bruins', 'BOS'],
    'Buffalo Sabres': ['Sabres', 'BUF'],
    'Calgary Flames': ['Flames', 'CGY'],
    'Carolina Hurricanes': ['Hurricanes', 'Canes', 'CAR'],
    'Chicago Blackhawks': ['Blackhawks', 'CHI'],
    'Colorado Avalanche': ['Avalanche', 'Avs', 'COL'],
    'Columbus Blue Jackets': ['Blue Jackets', 'CBJ'],
    'Dallas Stars': ['Stars', 'DAL'],
    'Detroit Red Wings': ['Red Wings', 'DET'],
    'Edmonton Oilers': ['Oilers', 'EDM'],
    'Florida Panthers': ['Panthers', 'FLA'],
    'Los Angeles Kings': ['Kings', 'LAK', 'Los Angeles'],
    'Minnesota Wild': ['Wild', 'MIN'],
    // FIX: Added 'Montreal Canadiens' as an alias to handle the accent mark difference
    'Montréal Canadiens': ['Canadiens', 'Habs', 'MTL', 'Montreal Canadiens'],
    'Nashville Predators': ['Predators', 'NSH'],
    'New Jersey Devils': ['Devils', 'NJD'],
    'New York Islanders': ['Islanders', 'Isles', 'NYI'],
    'New York Rangers': ['Rangers', 'NYR'],
    'Ottawa Senators': ['Senators', 'Sens', 'OTT'],
    'Philadelphia Flyers': ['Flyers', 'PHI'],
    'Pittsburgh Penguins': ['Penguins', 'PIT'],
    'San Jose Sharks': ['Sharks', 'SJS'],
    'Seattle Kraken': ['Kraken', 'SEA'],
    'St. Louis Blues': ['Blues', 'STL', 'St Louis Blues'],
    'Tampa Bay Lightning': ['Lightning', 'Bolts', 'TBL', 'T.B'],
    'Toronto Maple Leafs': ['Maple Leafs', 'TOR'],
    'Vancouver Canucks': ['Canucks', 'VAN'],
    'Vegas Golden Knights': ['Golden Knights', 'VGK'],
    'Washington Capitals': ['Capitals', 'WSH'],
    'Winnipeg Jets': ['Jets', 'WPG'],
    // FIX: Added the new Utah team name
    'Utah Hockey Club': ['Utah', 'UTA', 'Utah Mammoth'] 
};

const teamToAbbrMap = {};
const canonicalTeamNameMap = {};

Object.keys(teamAliasMap).forEach(canonicalName => {
    const abbr = teamAliasMap[canonicalName][teamAliasMap[canonicalName].length - 1];
    teamToAbbrMap[canonicalName] = abbr;

    const lowerCanonical = canonicalName.toLowerCase();
    if (!canonicalTeamNameMap[lowerCanonical]) {
        canonicalTeamNameMap[lowerCanonical] = canonicalName;
    }
    
    teamAliasMap[canonicalName].forEach(alias => {
        const lowerAlias = alias.toLowerCase();
        if (!canonicalTeamNameMap[lowerAlias]) {
            canonicalTeamNameMap[lowerAlias] = canonicalName;
        }
    });
});

const normalizeTeamAbbrev = (abbrev) => {
    if (!abbrev) return '';
    const upperAbbrev = abbrev.toUpperCase();
    if (upperAbbrev === 'L.A') return 'LAK';
    if (upperAbbrev === 'N.J') return 'NJD';
    if (upperAbbrev === 'S.J') return 'SJS';
    if (upperAbbrev === 'T.B') return 'TBL';
    return upperAbbrev;
};

// FIX: Create and export the missing normalizeGoalieName function
const normalizeGoalieName = (name) => {
    if (!name) return '';
    return name.trim(); // A simple trim is a good starting point
};

module.exports = {
    normalizeTeamAbbrev,
    canonicalTeamNameMap,
    teamToAbbrMap,
    normalizeGoalieName // Export the new function
};