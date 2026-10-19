// DOM tests against REWE-like markup. The add-on scripts run in a sandbox like
// Firefox's content-script scope: its own global object, the page window as
// prototype, and `window` pointing at the page window (not at the sandbox).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { JSDOM } = require("jsdom");

const SCRIPTS = ["unitprice.js", "store.js", "panel.js", "chart.js", "settings.js", "content.js"];

function load(html, url = "https://www.rewe.de/shop/productList?search=x", initial = {}) {
  const dom = new JSDOM(html, { url, pretendToBeVisual: true });
  const w = dom.window;
  const sandbox = Object.create(w);
  sandbox.window = w;
  sandbox.console = { info: (...a) => process.env.DEBUG && console.log(...a), log: console.log, error: console.error };
  const db = structuredClone(initial);
  const listeners = [];
  const notify = (changes) => listeners.forEach((l) => l(changes, "local"));
  sandbox.browser = { storage: {
    local: {
      async get(k) {
        if (k === null) return structuredClone(db);
        const keys = Array.isArray(k) ? k : [k];
        return Object.fromEntries(keys.filter((x) => x in db).map((x) => [x, structuredClone(db[x])]));
      },
      async set(o) {
        const changes = {};
        for (const [k, v] of Object.entries(o)) changes[k] = { oldValue: db[k], newValue: structuredClone(v) };
        Object.assign(db, structuredClone(o));
        notify(changes);
      },
      async remove(k) {
        for (const x of Array.isArray(k) ? k : [k]) delete db[x];
      },
    },
    onChanged: { addListener: (l) => listeners.push(l) },
  } };
  vm.createContext(sandbox);
  for (const f of SCRIPTS) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "src", f), "utf8"), sandbox, { filename: f });
  }
  return { w, d: w.document, db };
}

const tick = (ms = 350) => new Promise((r) => setTimeout(r, ms));
let nextId = 100;
const tile = (name, price, base, id = nextId++) =>
  `<div class="tile" id="plr-${id}"><a href="/shop/p/${name.toLowerCase()}/${id}"><h3>${name}</h3></a>` +
  `<div id="plr-${id}-price">${price}</div> <span id="plr-${id}-grammage">${base}</span></div>`;
const radio = (id, text) =>
  `<div class="a-sc__input--radiobutton"><input type="radio" name="sorting" id="${id}" value="${id}"><label for="${id}">${text}</label></div>`;
const PAGE = `<body>
  <select id="sorting" name="sorting"><option value="RELEVANCE_DESC">Relevanz</option><option value="PRICE_ASC">Preis aufsteigend</option><option value="PRICE_DESC">Preis absteigend</option></select>
  <div class="radios">${radio("RELEVANCE_DESC", "Relevanz")}${radio("PRICE_ASC", "Preis aufsteigend")}${radio("PRICE_DESC", "Preis absteigend")}</div>
  <div id="grid" style="display:grid">
    ${tile("Butter", "1,69 €", "(1 kg = 6,76 €)", 1)}${tile("Wasser", "0,39 €", "(1 l = 0,26 €)", 2)}
    ${tile("Eier", "2,99 €", "(1 Stück = 0,30 €)", 3)}${tile("Mehl", "0,79 €", "(1 kg = 0,79 €)", 4)}
  </div></body>`;

function visualOrder(d) {
  return [...d.querySelectorAll("#grid > *")]
    .sort((a, b) => (+a.style.order || 0) - (+b.style.order || 0))
    .map((e) => e.querySelector("h3").textContent);
}

test("selecting the option in the <select> sorts by base price", async () => {
  const { w, d } = load(PAGE);
  let reweHandlerFired = false;
  d.getElementById("sorting").addEventListener("change", () => { reweHandlerFired = true; });
  await tick();
  const s = d.getElementById("sorting");
  assert.ok([...s.options].some((o) => o.textContent === "Grundpreis aufsteigend"));
  s.value = "__rewe_unit_price_asc";
  s.dispatchEvent(new w.Event("change", { bubbles: true }));
  assert.deepEqual(visualOrder(d), ["Wasser", "Mehl", "Butter", "Eier"]);
  assert.equal(reweHandlerFired, false);

  s.value = "PRICE_ASC";
  s.dispatchEvent(new w.Event("change", { bubbles: true }));
  assert.deepEqual(visualOrder(d), ["Butter", "Wasser", "Eier", "Mehl"]);
  assert.equal(reweHandlerFired, true);
});

test("radio-button sort list gets one extra entry, not a label per radio", async () => {
  const { w, d } = load(PAGE);
  await tick();
  const entries = [...d.querySelectorAll(".radios > *")];
  assert.equal(entries.length, 4);
  assert.equal(entries[3].textContent.trim(), "Grundpreis aufsteigend");
  assert.equal(d.querySelectorAll(".a-sc__input--radiobutton > [data-rewe-unit-sort]").length, 0);

  entries[3].querySelector("label").dispatchEvent(new w.MouseEvent("mousedown", { bubbles: true, cancelable: true }));
  assert.deepEqual(visualOrder(d), ["Wasser", "Mehl", "Butter", "Eier"]);
});

test("products are remembered and listed across pages", async () => {
  const { d, db } = load(PAGE, "https://www.rewe.de/shop/c/backen/?page=2");
  await tick();
  const ctx = db["ctx:rewe.de/shop/c/backen"];
  assert.equal(Object.keys(ctx.products).length, 4);
  assert.deepEqual(Object.keys(ctx.pages), ["2"]);
  // price history per product id
  assert.deepEqual(Object.keys(db).filter((k) => k.startsWith("hist:")).sort(), ["hist:1", "hist:2", "hist:3", "hist:4"]);
  assert.equal(db["hist:1"].entries[0].p, 1.69);
  assert.equal(db["hist:1"].entries[0].u, 6.76);
  // dock: only the ⚙ button while sorting is off
  assert.equal(d.querySelector(".rewe-unit-sort-dock-main").children.length, 0);
  assert.ok(d.querySelector(".rewe-unit-sort-gear"));
});

const DAY = 24 * 60 * 60 * 1000;
const hist = (daysAgo, p, u) => ({ t: Date.now() - daysAgo * DAY, p, u, k: "mass" });

test("trend arrows on tiles compare with prices from up to N days ago", async () => {
  const { d } = load(PAGE, undefined, {
    "hist:1": { name: "Butter", entries: [hist(5, 1.99, 7.96)] },  // was more expensive -> ▼
    "hist:4": { name: "Mehl", entries: [hist(1, 0.69, 0.69)] },    // yesterday cheaper -> ▲
    "hist:3": { name: "Eier", entries: [hist(10, 1.99, 0.2)] },    // older than 7 days -> nothing
  });
  await tick();
  const arrow = (id) => d.querySelector(`#plr-${id}-price .rewe-unit-sort-trend`);
  assert.equal(arrow(1).textContent, "▼");
  assert.match(arrow(1).title, /Günstiger als am .*1,99/);
  assert.equal(arrow(4).textContent, "▲");
  assert.equal(arrow(3), null);
  assert.equal(arrow(2), null);
});

test("settings popover saves settings and hides arrows when switched off", async () => {
  const { w, d, db } = load(PAGE, undefined, { "hist:1": { name: "Butter", entries: [hist(5, 1.99, 7.96)] } });
  await tick();
  assert.ok(d.querySelector("#plr-1-price .rewe-unit-sort-trend"));
  d.querySelector(".rewe-unit-sort-gear").click();
  assert.ok(d.querySelector(".rewe-unit-sort-gearwrap").classList.contains("is-open"));
  await tick(50);
  const retention = d.getElementById("rus-retention");
  assert.equal(retention.value, "30");
  retention.value = "60";
  retention.dispatchEvent(new w.Event("input", { bubbles: true }));
  d.getElementById("rus-show-trend").click();
  await tick(600);
  assert.equal(db.settings.retentionDays, 60);
  assert.equal(db.settings.showTrend, false);
  assert.equal(d.querySelector("#plr-1-price .rewe-unit-sort-trend"), null);
  // clicking outside closes it
  d.body.dispatchEvent(new w.MouseEvent("pointerdown", { bubbles: true }));
  assert.ok(!d.querySelector(".rewe-unit-sort-gearwrap").classList.contains("is-open"));
});

test("product page records the price and shows the history chart", async () => {
  const PDP = `<body><div id="pdpr-ProductInformation"><h1 class="pdpr-Title">Paysan Breton Butter 250g</h1>
    <div class="pdpr-ProductActionsContainer"><div class="pdpr-ProductActionsContainer__Box">
      <div class="pdpr-Price"><mark class="pdpr-Price__Price rs-qa-price" itemprop="price">4,39 €</mark></div>
      <div class="rs-qa-price-base pdsr-Grammage">250g (1 kg = 17,56 €)</div></div></div></div>
    <script type="application/json" id="pdpr-propstore13-x">{"productData":{"productId":"1362019","pricing":{"grammage":"250g (1 kg = 17,56 €)","price":439}}}</script></body>`;
  const { d, db } = load(PDP, "https://www.rewe.de/shop/p/paysan-breton-butter-gesalzen-250g/1362019", {
    "hist:1362019": { name: "Paysan Breton", entries: [hist(10, 3.99, 15.96), hist(4, 4.19, 16.76)] },
  });
  await tick();
  const entries = db["hist:1362019"].entries;
  assert.equal(entries.length, 3);
  assert.equal(entries[2].p, 4.39);
  assert.equal(entries[2].u, 17.56);
  const chart = d.querySelector(".pdpr-ProductActionsContainer + .rewe-unit-sort-chart");
  assert.ok(chart, "chart inserted after the price box");
  assert.ok(chart.querySelector("svg path.line"));
  assert.equal(chart.querySelectorAll("table tr").length, 4); // header + 3 rows
  assert.match(chart.textContent, /Tiefster.*3,99/);
  assert.equal(d.querySelector(".pdpr-Price__Price .rewe-unit-sort-trend").textContent, "▲");
});
