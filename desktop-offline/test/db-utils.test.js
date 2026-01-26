const test = require("node:test");
const assert = require("node:assert/strict");

const { cleanCsvIds, toInt, isDate } = require("../utils");

test("cleanCsvIds trims, filters, dedupes, and preserves order", () => {
  assert.equal(cleanCsvIds(""), "");
  assert.equal(cleanCsvIds("  "), "");
  assert.equal(cleanCsvIds("3,2,3,1"), "3,2,1");
  assert.equal(cleanCsvIds(" 1, 2,2, 0, -1, foo, 3 "), "1,2,3");
});

test("toInt returns defaults for non-numeric values", () => {
  assert.equal(toInt("5"), 5);
  assert.equal(toInt(7.9), 7);
  assert.equal(toInt(undefined, 42), 42);
});

test("isDate rejects invalid shapes", () => {
  assert.equal(isDate("2024-02-01"), true);
  assert.equal(isDate("2024/02/01"), false);
  assert.equal(isDate(""), false);
});
