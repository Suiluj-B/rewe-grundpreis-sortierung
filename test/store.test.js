const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("../src/store.js");

test("context ignores page and sort parameters", () => {
  const a = S.contextFromUrl("https://www.rewe.de/shop/c/obst-gemuese/?page=2&sorting=PRICE_ASC");
  const b = S.contextFromUrl("https://www.rewe.de/shop/c/obst-gemuese");
  assert.equal(a.key, b.key);
  assert.equal(a.page, 2);
  assert.equal(b.page, 1);
  assert.equal(a.listing, true);
});

test("context keeps the search term", () => {
  const a = S.contextFromUrl("https://www.rewe.de/shop/productList?search=milch&page=3");
  const b = S.contextFromUrl("https://www.rewe.de/shop/productList?search=butter");
  assert.notEqual(a.key, b.key);
  assert.match(a.key, /search=milch/);
});

test("product pages are not listings", () => {
  assert.equal(S.contextFromUrl("https://www.rewe.de/shop/p/ja-butter/123").listing, false);
});

test("prune drops old products and pages", () => {
  const now = Date.now();
  const maxAge = 14 * S.DAY_MS;
  const ctx = S.prune({
    pages: { 1: now, 2: now - maxAge - 1 },
    products: { a: { seenAt: now }, b: { seenAt: now - maxAge - 1 } },
  }, now, maxAge);
  assert.deepEqual(Object.keys(ctx.products), ["a"]);
  assert.deepEqual(Object.keys(ctx.pages), ["1"]);
});

test("REWE search pagination (?term=) matches the first page (?search=)", () => {
  const first = S.contextFromUrl("https://www.rewe.de/shop/productList?search=butter&source=mc");
  const second = S.contextFromUrl("https://www.rewe.de/shop/productList/?page=2&source=mc&term=butter");
  assert.equal(first.key, second.key);
  assert.equal(second.page, 2);
});

test("product id from REWE product URLs", () => {
  assert.equal(S.productIdFromUrl("https://www.rewe.de/shop/p/frau-antje-butter-250g/4532600"), "4532600");
  assert.equal(S.productIdFromUrl("/shop/p/paysan-breton-butter/1362019/"), "1362019");
  assert.equal(S.productIdFromUrl("https://www.rewe.de/shop/c/kaese-eier-molkerei/"), null);
  const ctx = S.contextFromUrl("https://www.rewe.de/shop/p/frau-antje-butter-250g/4532600");
  assert.equal(ctx.productId, "4532600");
  assert.equal(ctx.listing, false);
});

test("settings are clamped and defaulted", () => {
  assert.deepEqual(S.normaliseSettings(null), S.DEFAULT_SETTINGS);
  const s = S.normaliseSettings({ retentionDays: 9999, compareDays: "0", showTrend: 0 });
  assert.equal(s.retentionDays, 365);
  assert.equal(s.compareDays, 1);
  assert.equal(s.showTrend, false);
  assert.equal(S.normaliseSettings({ retentionDays: "abc" }).retentionDays, S.DEFAULT_SETTINGS.retentionDays);
});

test("history: new entry on price change, otherwise once a day; old entries dropped", () => {
  const D = S.DAY_MS, keep = 30 * D, t0 = 1e12;
  let h = S.addHistoryEntry([], { p: 2.99, u: 11.96, k: "mass" }, t0, keep);
  h = S.addHistoryEntry(h, { p: 2.99, u: 11.96, k: "mass" }, t0 + 1000, keep);
  assert.equal(h.length, 1, "same price within a day is not repeated");
  h = S.addHistoryEntry(h, { p: 2.49, u: 9.96, k: "mass" }, t0 + 2000, keep);
  assert.equal(h.length, 2, "price change is recorded immediately");
  h = S.addHistoryEntry(h, { p: 2.49, u: 9.96, k: "mass" }, t0 + D + 2000, keep);
  assert.equal(h.length, 3, "unchanged price is recorded again after a day");
  h = S.addHistoryEntry(h, { p: 2.49, u: 9.96, k: "mass" }, t0 + keep + 1500, keep);
  assert.deepEqual(h.map((e) => e.p), [2.49, 2.49, 2.49], "entries older than the retention are dropped");
});

test("trend compares with the oldest price from up to N days ago", () => {
  const D = S.DAY_MS, now = 1e12;
  const entries = [
    { t: now - 10 * D, p: 3.29, u: 13.16, k: "mass" },
    { t: now - 4 * D, p: 2.99, u: 11.96, k: "mass" },
    { t: now - 1 * D, p: 1.99, u: 7.96, k: "mass" },
    { t: now - 60 * 1000, p: 2.49, u: 9.96, k: "mass" }, // just recorded: never a reference
  ];
  const up = S.trend(entries, { p: 3.49, u: 13.96, k: "mass" }, now, 7 * D);
  assert.equal(up.dir, 1);
  assert.equal(up.ref.p, 2.99, "oldest within 7 days, not the 10-day-old one");
  assert.equal(S.trend(entries, { p: 2.49, u: 9.96, k: "mass" }, now, 7 * D).dir, -1);
  assert.equal(S.trend(entries, { p: 2.99, u: 11.96, k: "mass" }, now, 7 * D).dir, 0);
  assert.equal(S.trend(entries, { p: 2.49, u: 9.96, k: "mass" }, now, 2 * D).ref.p, 1.99, "a 1-day-old sighting counts");
  assert.equal(S.trend(entries.slice(3), { p: 2.49 }, now, 7 * D), null, "only the current visit");
  assert.equal(S.trend(entries.slice(0, 1), { p: 2.49 }, now, 7 * D), null, "older than the window");
});

test("trend falls back to total price when the unit kind differs", () => {
  const now = 1e12;
  const r = S.trend([{ t: now - 5 * S.DAY_MS, p: 2, u: null, k: null }], { p: 2.2, u: 4.4, k: "mass" }, now, 7 * S.DAY_MS);
  assert.equal(r.dir, 1);
  assert.ok(Math.abs(r.change - 0.1) < 1e-9);
});
