function isDate(d) {
  return /^\d{4}-\d{2}-\d{2}$/.test(d || "");
}

function toInt(v, def = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? (n | 0) : def;
}

function cleanCsvIds(s) {
  const raw = String(s || "").trim();
  if (!raw) return "";
  const ids = raw
    .split(",")
    .map((x) => Number(String(x).trim()))
    .filter((x) => Number.isFinite(x) && x > 0);
  return Array.from(new Set(ids)).join(",");
}

module.exports = { cleanCsvIds, isDate, toInt };
