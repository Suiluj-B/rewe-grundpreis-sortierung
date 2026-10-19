/*
 * Persistent data in storage.local:
 *
 *   "settings"            -> { retentionDays, compareDays, showTrend, showChart }
 *   "ctx:<context key>"   -> products seen on the pages of one category / search:
 *       { label, pages: { <page>: <ts> }, products: { <key>: { key, id, name, url, img, price, unit, page, seenAt } } }
 *   "hist:<product id>"   -> price history of one product:
 *       { name, entries: [{ t, p, u, k }] }   (t = timestamp, p = price EUR, u = unit price, k = unit kind)
 *
 * The context key is the category / search URL without page and sort parameters.
 */
(function (root) {
  "use strict";

  const DAY_MS = 24 * 60 * 60 * 1000;
  const DEFAULT_SETTINGS = { retentionDays: 30, compareDays: 7, showTrend: true, showChart: true };
  const LIMITS = { retentionDays: [1, 365], compareDays: [1, 90] };
  // a new history entry is written when the price changes, otherwise at most this often
  const HISTORY_INTERVAL_MS = DAY_MS;
  // entries this recent belong to the current visit and are not used as comparison
  const MIN_REFERENCE_AGE_MS = 60 * 60 * 1000;

  const IGNORED_PARAMS = /^(page|seite|sorting|sort|order|orderby|objectsperpage|pagesize|size|offset|start|source|utm_.*)$/i;
  // REWE's first search page uses ?search=, its pagination links ?term=
  const PARAM_ALIASES = { term: "search" };

  // ---------- pure helpers (unit-tested) ----------

  /** -> { key, page, listing, productId } for a shop URL. */
  function contextFromUrl(href) {
    const u = new URL(href);
    const params = [...u.searchParams]
      .filter(([k]) => !IGNORED_PARAMS.test(k))
      .map(([k, v]) => [PARAM_ALIASES[k.toLowerCase()] || k, v])
      .sort(([a], [b]) => a.localeCompare(b));
    const path = u.pathname.replace(/\/+$/, "") || "/";
    const query = params.length ? "?" + new URLSearchParams(params) : "";
    const page = parseInt(u.searchParams.get("page") || u.searchParams.get("seite") || "1", 10) || 1;
    const productId = productIdFromUrl(href);
    return {
      key: u.host.replace(/^www\./, "") + path + query,
      page,
      listing: !productId && !/\/p\//.test(path), // product pages only have recommendation carousels
      productId,
    };
  }

  /** REWE product URLs end in the numeric product id: /shop/p/<slug>/<id> */
  function productIdFromUrl(href) {
    try {
      const m = new URL(href, "https://www.rewe.de").pathname.match(/\/p\/[^/]+\/(\d+)\/?$/);
      return m ? m[1] : null;
    } catch (e) {
      return null;
    }
  }

  function normaliseSettings(s) {
    const out = { ...DEFAULT_SETTINGS, ...(s || {}) };
    for (const [k, [min, max]] of Object.entries(LIMITS)) {
      const n = Math.round(Number(out[k]));
      out[k] = Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : DEFAULT_SETTINGS[k];
    }
    out.showTrend = !!out.showTrend;
    out.showChart = !!out.showChart;
    return out;
  }

  function prune(ctx, now, maxAgeMs) {
    for (const [k, p] of Object.entries(ctx.products)) {
      if (now - p.seenAt > maxAgeMs) delete ctx.products[k];
    }
    for (const [page, ts] of Object.entries(ctx.pages)) {
      if (now - ts > maxAgeMs) delete ctx.pages[page];
    }
    return ctx;
  }

  /** Add a price sample to a history (sorted by time), dropping entries older than maxAgeMs. */
  function addHistoryEntry(entries, sample, now, maxAgeMs) {
    const kept = (entries || []).filter((e) => now - e.t <= maxAgeMs);
    if (sample.p == null && sample.u == null) return kept;
    const last = kept[kept.length - 1];
    const changed = !last || last.p !== sample.p || last.u !== sample.u;
    if (changed || now - last.t >= HISTORY_INTERVAL_MS) kept.push({ t: now, ...sample });
    return kept;
  }

  /**
   * The oldest entry from the last `windowMs` (up to X days back), ignoring the
   * last hour so the price just recorded isn't compared with itself; or null.
   * Prices aren't seen every day, so any earlier sighting in the window counts.
   */
  function referenceEntry(entries, now, windowMs) {
    let ref = null;
    for (const e of entries || []) {
      const age = now - e.t;
      if (age >= MIN_REFERENCE_AGE_MS && age <= windowMs && (!ref || e.t < ref.t)) ref = e;
    }
    return ref;
  }

  /**
   * Compare a current sample with the reference: unit price when both have one
   * (survives pack-size changes), total price otherwise.
   * -> { dir: 1 | -1 | 0, ref, change } (change = relative, e.g. -0.05) or null
   */
  function trend(entries, current, now, windowMs) {
    const ref = referenceEntry(entries, now, windowMs);
    if (!ref || !current) return null;
    const useUnit = ref.u != null && current.u != null && ref.k === current.k;
    const before = useUnit ? ref.u : ref.p;
    const after = useUnit ? current.u : current.p;
    if (before == null || after == null || before <= 0) return null;
    const change = (after - before) / before;
    const dir = Math.abs(change) < 0.005 ? 0 : Math.sign(change);
    return { dir, ref, change };
  }

  // ---------- storage ----------

  function storage() {
    // extension API global; absent in unit tests that only use the pure helpers
    const api = typeof browser !== "undefined" ? browser : null;
    return api && api.storage && api.storage.local;
  }

  async function getSettings() {
    const s = storage();
    return normaliseSettings(s ? (await s.get("settings")).settings : null);
  }

  async function saveSettings(partial) {
    const settings = normaliseSettings({ ...(await getSettings()), ...partial });
    const s = storage();
    if (s) await s.set({ settings });
    return settings;
  }

  /** Calls cb(settings) whenever the settings change (in any tab). */
  function onSettingsChanged(cb) {
    const api = typeof browser !== "undefined" ? browser : null;
    if (!api || !api.storage || !api.storage.onChanged) return;
    api.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && changes.settings) cb(normaliseSettings(changes.settings.newValue));
    });
  }

  async function load(key, maxAgeMs) {
    const empty = { label: "", pages: {}, products: {} };
    const s = storage();
    if (!s) return empty;
    const id = "ctx:" + key;
    const ctx = (await s.get(id))[id];
    return ctx ? prune({ ...empty, ...ctx }, Date.now(), maxAgeMs) : empty;
  }

  /** Add the products seen on one page to the stored context. */
  async function remember(key, page, label, products, maxAgeMs) {
    const s = storage();
    if (!s) return null;
    const now = Date.now();
    const ctx = await load(key, maxAgeMs);
    if (label) ctx.label = label;
    ctx.pages[page] = now;
    for (const p of products) ctx.products[p.key] = { ...p, page, seenAt: now };
    await s.set({ ["ctx:" + key]: ctx });
    return ctx;
  }

  async function clear(key) {
    const s = storage();
    if (s) await s.remove("ctx:" + key);
  }

  /** -> { <id>: entries[] } for the given product ids. */
  async function getHistories(ids) {
    const s = storage();
    if (!s || !ids.length) return {};
    const data = await s.get(ids.map((id) => "hist:" + id));
    const out = {};
    for (const id of ids) {
      const h = data["hist:" + id];
      if (h) out[id] = h.entries;
    }
    return out;
  }

  /**
   * Record current prices. samples: [{ id, name, p, u, k }]
   * -> { <id>: entries[] } (the updated histories)
   */
  async function recordPrices(samples, maxAgeMs) {
    const s = storage();
    if (!s || !samples.length) return {};
    const now = Date.now();
    const data = await s.get(samples.map((x) => "hist:" + x.id));
    const write = {};
    const out = {};
    for (const { id, name, p, u, k } of samples) {
      const old = data["hist:" + id] || { name, entries: [] };
      const entries = addHistoryEntry(old.entries, { p, u, k }, now, maxAgeMs);
      out[id] = entries;
      const same = entries.length === old.entries.length && entries.every((e, i) => e === old.entries[i]);
      if (!same || (name && old.name !== name)) write["hist:" + id] = { name: name || old.name, entries };
    }
    if (Object.keys(write).length) await s.set(write);
    return out;
  }

  /** Number of products with a stored price history. */
  async function stats() {
    const s = storage();
    if (!s) return { products: 0 };
    const all = await s.get(null);
    return { products: Object.keys(all).filter((k) => k.startsWith("hist:")).length };
  }

  /** Delete all stored prices (keeps the settings). */
  async function clearAll() {
    const s = storage();
    if (!s) return;
    const all = await s.get(null);
    await s.remove(Object.keys(all).filter((k) => k.startsWith("hist:") || k.startsWith("ctx:")));
  }

  const api = {
    DAY_MS, DEFAULT_SETTINGS, LIMITS,
    contextFromUrl, productIdFromUrl, normaliseSettings, prune, addHistoryEntry, referenceEntry, trend,
    getSettings, saveSettings, onSettingsChanged,
    load, remember, clear, getHistories, recordPrices, stats, clearAll,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ReweStore = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
