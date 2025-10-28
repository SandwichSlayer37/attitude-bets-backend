// teamMap.js
const canonicalTeamNameMap = {
  "montreal canadiens": "MTL",
  "montréal canadiens": "MTL",
  "utah mammoth": "UTA",
  "st louis blues": "STL",
  "st. louis blues": "STL",
  "los angeles kings": "LAK",
  "tampa bay lightning": "TBL",
  "vegas golden knights": "VGK",
  "new york islanders": "NYI",
  "new york rangers": "NYR",
  "philadelphia flyers": "PHI",
  "pittsburgh penguins": "PIT",
  "calgary flames": "CGY",
  "ottawa senators": "OTT",
  "winnipeg jets": "WPG",
  "boston bruins": "BOS",
  "columbus blue jackets": "CBJ",
  "washington capitals": "WSH",
  "florida panthers": "FLA",
  "anaheim ducks": "ANA",
  "arizona coyotes": "ARI",
  "edmonton oilers": "EDM",
  "san jose sharks": "SJS",
  "minnesota wild": "MIN",
  "detroit red wings": "DET",
  "chicago blackhawks": "CHI",
  "nashville predators": "NSH",
  "buffalo sabres": "BUF",
  "toronto maple leafs": "TOR",
  "carolina hurricanes": "CAR",
  "colorado avalanche": "COL",
  "dallas stars": "DAL",
  "seattle kraken": "SEA",
};

function normalizeTeamAbbrev(name = "") {
  const key = name.toLowerCase().replace(/[^\w\s]/gi, "").trim();
  return canonicalTeamNameMap[key] || key.slice(0, 3).toUpperCase();
};

// FIX: Create and export the missing normalizeGoalieName function
const normalizeGoalieName = (name) => {
    if (!name) return '';
    return name.trim(); // A simple trim is a good starting point
};

module.exports = {
    normalizeTeamAbbrev,
    normalizeGoalieName // Export the new function
};