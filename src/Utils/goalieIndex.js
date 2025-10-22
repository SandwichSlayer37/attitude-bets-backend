// Index of goalie metrics from Mongo (Moneypuck historical).
// Expect a collection 'goalies' with docs like: { name, teamAbbr, season, gsax, rollingForm (0..5) ... }

const { normalizeGoalieName, normalizeTeamAbbrev } = require("./hockeyNormalize"); // No changes needed here.