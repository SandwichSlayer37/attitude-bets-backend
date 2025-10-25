const teamToAbbrMap = {
  "montreal canadiens": "MTL",
  "montréal canadiens": "MTL",
  "utah mammoth": "UTA",
  "utah hockey club": "UTA",
  "tampa bay lightning": "TBL",
  "st louis blues": "STL",
  "st. louis blues": "STL",
  "los angeles kings": "LAK",
  "new jersey devils": "NJD",
  "vegas golden knights": "VGK",
  "new york rangers": "NYR",
  "new york islanders": "NYI",
  "anaheim ducks": "ANA",
  "arizona coyotes": "ARI",
  "boston bruins": "BOS",
  "buffalo sabres": "BUF",
  "calgary flames": "CGY",
  "carolina hurricanes": "CAR",
  "chicago blackhawks": "CHI",
  "colorado avalanche": "COL",
  "columbus blue jackets": "CBJ",
  "dallas stars": "DAL",
  "detroit red wings": "DET",
  "edmonton oilers": "EDM",
  "florida panthers": "FLA",
  "minnesota wild": "MIN",
  "nashville predators": "NSH",
  "ottawa senators": "OTT",
  "philadelphia flyers": "PHI",
  "pittsburgh penguins": "PIT",
  "san jose sharks": "SJS",
  "seattle kraken": "SEA",
  "toronto maple leafs": "TOR",
  "vancouver canucks": "VAN",
  "washington capitals": "WSH",
  "winnipeg jets": "WPG"
};

function normalizeTeamAbbrev(name = "") {
  if (!name) return "";
  const cleanedName = name.toLowerCase().replace(/[^\w\s]/gi, "").trim();
  return teamToAbbrMap[cleanedName] || cleanedName.toUpperCase().slice(0, 3);
};

// FIX: Create and export the missing normalizeGoalieName function
const normalizeGoalieName = (name) => {
    if (!name) return '';
    return name.trim(); // A simple trim is a good starting point
};

module.exports = {
    normalizeTeamAbbrev,
    teamToAbbrMap,
    normalizeGoalieName // Export the new function
};