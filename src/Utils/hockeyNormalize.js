const deburr = (str) => str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

function normalizeTeamAbbrev(raw = "") {
  if (!raw) return "";
  const s = deburr(raw).toUpperCase().trim();
  const map = {
    "MONTRÉAL": "MTL",
    "MONTREAL": "MTL",
    "UTAH MAMMOTH": "UTA", // for expansion team
    "T.B": "TBL",
    "TB": "TBL",
    // add others as needed
  };
  return map[s] || s.slice(0, 3);
}

function normalizeGoalieName(name = "") {
  return deburr(name)
    .replace(/\./g, "")
    .replace(/\s+/g, " ")
    .trim();
}

module.exports = {
  normalizeTeamAbbrev,
  normalizeGoalieName,
};