// Run with: node --test test/
const test = require("node:test");
const assert = require("node:assert/strict");
const U = require("../src/unitprice.js");

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

test("parses '1 kg = x €' base price", () => {
  const r = U.unitPriceFromText("Butter 250g 1,69 € (1 kg = 6,76 €)");
  assert.equal(r.kind, "mass");
  assert.equal(r.source, "base");
  close(r.value, 6.76);
});

test("normalises 100 g / 100 ml to per kg / per l", () => {
  close(U.unitPriceFromText("100 g = 1,99 €").value, 19.9);
  const r = U.unitPriceFromText("Saft 0,2 l 0,99 € 100 ml = 0,50 €");
  assert.equal(r.kind, "volume");
  close(r.value, 5);
});

test("parses liter and non-breaking spaces", () => {
  close(U.unitPriceFromText("1 l = 1,29 €").value, 1.29);
});

test("parses '€ / kg' style", () => {
  close(U.unitPriceFromText("Grundpreis 3,98 € / kg").value, 3.98);
  close(U.unitPriceFromText("0,79 € pro 100 g").value, 7.9);
});

test("parses per piece", () => {
  const r = U.unitPriceFromText("Eier 10 Stück 2,99 € (1 Stück = 0,30 €)");
  assert.equal(r.kind, "piece");
  close(r.value, 0.3);
});

test("thousands separator", () => {
  close(U.unitPriceFromText("1 kg = 1.234,50 €").value, 1234.5);
});

test("falls back to price / package size", () => {
  const r = U.unitPriceFromText("Mineralwasser 6 x 1,5 l 2,94 €");
  assert.equal(r.source, "computed");
  close(r.value, 2.94 / 9);
  close(U.unitPriceFromText("Mehl 500g statt 1,29 € 0,99 €").value, 1.98);
});

test("does not match units inside words", () => {
  assert.equal(U.unitPriceFromText("Original Kaffee 4,99 €"), null);
});

test("sort order: kg/l ascending, then piece, then unknown", () => {
  const items = [null, { kind: "piece", value: 0.1 }, { kind: "mass", value: 5 }, { kind: "volume", value: 1 }];
  const sorted = [...items].sort(U.compareUnitPrices);
  assert.deepEqual(sorted.map((x) => x && x.value), [1, 5, 0.1, null]);
});

test("parses 'kg: x €' style", () => {
  close(U.unitPriceFromText("1 kg: 6,76 €").value, 6.76);
});
