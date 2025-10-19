// src/utils/hockeyNormalize.js
const NAME_FIX = {
  'VEGAS GOLDEN KNIGHTS': 'VGK',
  'LAS VEGAS GOLDEN KNIGHTS': 'VGK',
  'VEGAS': 'VGK',
  'VGK': 'VGK',
  'LAS VEGAS': 'VGK',
  'LOS ANGELES KINGS': 'LA',
  'LA KINGS': 'LA',
  'LOS ANGELES': 'LA',
  'KINGS': 'LA',
  'COLORADO AVALANCHE': 'COL',
  'UTAH MAMMOTH': 'UTA',
  'ARIZONA COYOTES': 'UTA',
  'MONTREAL CANADIENS': 'MON',
  'MONTRÉAL CANADIENS': 'MON',
  'MTL': 'MON',
  'TBL': 'TB',
  'TAMPA BAY LIGHTNING': 'TB',
  'WASHINGTON CAPITALS': 'WAS',
  'WSH': 'WAS',
  'NEW JERSEY DEVILS': 'NJ',
  'SAN JOSE SHARKS': 'SJ',
  'NEW YORK RANGERS': 'NYR',
  'NEW YORK ISLANDERS': 'NYI',
  'COLUMBUS BLUE JACKETS': 'CBJ',
  'TORONTO MAPLE LEAFS': 'TOR',
  'EDMONTON OILERS': 'EDM',
  'DETROIT RED WINGS': 'DET',
  'BOSTON BRUINS': 'BOS',
  'CALGARY FLAMES': 'CGY',
  'WINNIPEG JETS': 'WPG',
  'CHICAGO BLACKHAWKS': 'CHI',
  'ANAHEIM DUCKS': 'ANA',
  'FLORIDA PANTHERS': 'FLA',
  'BUFFALO SABRES': 'BUF',
  'OTTAWA SENATORS': 'OTT',
  'SEATTLE KRAKEN': 'SEA',
  'PHILADELPHIA FLYERS': 'PHI',
  'NASHVILLE PREDATORS': 'NSH',
  'CAROLINA HURRICANES': 'CAR',
  'VANCOUVER CANUCKS': 'VAN',
  'DALLAS STARS': 'DAL',
  'ST LOUIS BLUES': 'STL',
  'ST. LOUIS BLUES': 'STL',
  'PITTSBURGH PENGUINS': 'PIT',
  'MINNESOTA WILD': 'MIN'
};

const ABBR_FIX = {
  'VGK': 'VGK', 'LV': 'VGK', 'LAK': 'LA', 'LA': 'LA',
  'COL': 'COL', 'ARI': 'UTA', 'UTA': 'UTA',
  'MTL': 'MON', 'MON': 'MON', 'TBL': 'TB', 'TB': 'TB',
  'WSH': 'WAS', 'WAS': 'WAS', 'NJD': 'NJ', 'NJ': 'NJ',
  'SJS': 'SJ', 'SJ': 'SJ', 'NYR': 'NYR', 'NYI': 'NYI',
  'CBJ': 'CBJ', 'TOR': 'TOR', 'EDM': 'EDM', 'DET': 'DET',
  'BOS': 'BOS', 'CGY': 'CGY', 'WPG': 'WPG', 'CHI': 'CHI',
  'ANA': 'ANA', 'FLA': 'FLA', 'BUF': 'BUF', 'OTT': 'OTT',
  'SEA': 'SEA', 'PHI': 'PHI', 'NSH': 'NSH', 'CAR': 'CAR',
  'VAN': 'VAN', 'DAL': 'DAL', 'STL': 'STL', 'PIT': 'PIT', 'MIN': 'MIN'
};

function normalizeTeamAbbrev(input) {
  if (!input) return null;
  const s = String(input).trim().toUpperCase();
  if (ABBR_FIX[s]) return ABBR_FIX[s];
  if (NAME_FIX[s]) return NAME_FIX[s];
  if (s.includes('VEGAS')) return 'VGK';
  if (s.includes('LOS ANGELES')) return 'LA';
  if (s.includes('ARIZONA')) return 'UTA';
  if (s.includes('MONTREAL') || s.includes('MONTRÉAL')) return 'MON';
  if (s.includes('WASHINGTON')) return 'WAS';
  if (s.includes('TAMPA')) return 'TB';
  if (/^[A-Z]{2,3}$/.test(s)) return s;
  return s;
}

function buildOddsKey(away, home) {
  const a = normalizeTeamAbbrev(away);
  const h = normalizeTeamAbbrev(home);
  return a && h ? `${a}@${h}` : null;
}

function slugifyName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, '-');
}

module.exports = { normalizeTeamAbbrev, buildOddsKey, slugifyName };
