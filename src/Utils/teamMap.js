// src/utils/teamMap.js

// Maps NHL abbreviations to ESPN ones (and vice versa)
const TEAM_MAP = {
  ANA: "ANA",
  ARI: "ARI",
  BOS: "BOS",
  BUF: "BUF",
  CGY: "CGY",
  CAR: "CAR",
  CHI: "CHI",
  COL: "COL",
  CBJ: "CBJ",
  DAL: "DAL",
  DET: "DET",
  EDM: "EDM",
  FLA: "FLA",
  LAK: "LA",
  MIN: "MIN",
  MTL: "MTL",
  NJD: "NJ",
  NSH: "NSH",
  NYI: "NYI",
  NYR: "NYR",
  OTT: "OTT",
  PHI: "PHI",
  PIT: "PIT",
  SJS: "SJ",
  SEA: "SEA",
  STL: "STL",
  TBL: "TB",
  TOR: "TOR",
  VAN: "VAN",
  VGK: "VGK",
  WPG: "WPG",
  WSH: "WSH",
  UTA: "UTA" // Utah Hockey Club
};

function toEspnAbbr(nhlAbbr) {
  return TEAM_MAP[nhlAbbr] || nhlAbbr;
}

function toNhlAbbr(espnAbbr) {
  const reverse = Object.entries(TEAM_MAP).reduce((acc, [nhl, espn]) => {
    acc[espn] = nhl;
    return acc;
  }, {});
  return reverse[espnAbbr] || espnAbbr;
}

module.exports = {
    TEAM_MAP,
    toEspnAbbr,
    toNhlAbbr
};