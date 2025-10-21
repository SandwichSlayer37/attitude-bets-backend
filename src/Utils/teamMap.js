// Canonical team keys -> all known variants for robust matching.
// Keep as small, audited, and bidirectional as possible.
const TEAM_ALIASES = {
  ANA: ["ANA", "ANAHEIM DUCKS", "DUCKS"],
  ARI: ["ARI", "ARIZONA COYOTES", "COYOTES"],
  BOS: ["BOS", "BOSTON BRUINS", "BRUINS"],
  BUF: ["BUF", "BUFFALO SABRES", "SABRES"],
  CGY: ["CGY", "CALGARY FLAMES", "FLAMES", "CAL"],
  CAR: ["CAR", "CAROLINA HURRICANES", "HURRICANES"],
  CBJ: ["CBJ", "COLUMBUS BLUE JACKETS", "BLUE JACKETS"],
  CHI: ["CHI", "CHICAGO BLACKHAWKS", "BLACKHAWKS"],
  COL: ["COL", "COLORADO AVALANCHE", "AVALANCHE"],
  DAL: ["DAL", "DALLAS STARS", "STARS"],
  DET: ["DET", "DETROIT RED WINGS", "RED WINGS"],
  EDM: ["EDM", "EDMONTON OILERS", "OILERS"],
  FLA: ["FLA", "FLORIDA PANTHERS", "PANTHERS"],
  LAK: ["LAK", "LA", "LOS ANGELES KINGS", "KINGS"],
  MIN: ["MIN", "MINNESOTA WILD", "WILD"],
  MTL: ["MTL", "MON", "MONTREAL CANADIENS", "CANADIENS", "MONTRÉAL CANADIENS", "MONTRÉAL"],
  NJD: ["NJD", "NJ", "NEW JERSEY DEVILS", "DEVILS"],
  NSH: ["NSH", "NASHVILLE PREDATORS", "PREDATORS", "NSH"],
  NYI: ["NYI", "NEW YORK ISLANDERS", "ISLANDERS"],
  NYR: ["NYR", "NEW YORK RANGERS", "RANGERS"],
  OTT: ["OTT", "OTTAWA SENATORS", "SENATORS"],
  PHI: ["PHI", "PHILADELPHIA FLYERS", "FLYERS"],
  PIT: ["PIT", "PITTSBURGH PENGUINS", "PENGUINS"],
  SEA: ["SEA", "SEATTLE KRAKEN", "KRAKEN"],
  SJS: ["SJS", "SJ", "SAN JOSE SHARKS", "SHARKS"],
  STL: ["STL", "ST. LOUIS BLUES", "SAINT LOUIS BLUES", "BLUES"],
  TBL: ["TBL", "TB", "TAMPA BAY LIGHTNING", "LIGHTNING"],
  TOR: ["TOR", "TORONTO MAPLE LEAFS", "MAPLE LEAFS"],
  VAN: ["VAN", "VANCOUVER CANUCKS", "CANUCKS"],
  VGK: ["VGK", "LV", "VEGAS GOLDEN KNIGHTS", "GOLDEN KNIGHTS", "LAS VEGAS"],
  WPG: ["WPG", "WINNIPEG JETS", "JETS"],
  WSH: ["WSH", "WAS", "WASHINGTON CAPITALS", "CAPITALS"],
  UTA: ["UTA", "UTAH HOCKEY CLUB", "UTAH"]
};

// Build reverse lookup map
const ALIAS_TO_CANON = {};
for (const [canon, variants] of Object.entries(TEAM_ALIASES)) {
  variants.forEach(v => {
    ALIAS_TO_CANON[v.toUpperCase()] = canon;
  });
}

function normalizeTeamAbbrev(input) {
  if (!input) return null;
  const k = String(input).trim().toUpperCase();
  return ALIAS_TO_CANON[k] || k;
}

module.exports = { normalizeTeamAbbrev, TEAM_ALIASES };