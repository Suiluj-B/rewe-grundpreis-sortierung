/*
 * Adds "Grundpreis aufsteigend" to the REWE shop sorting and sorts the
 * product grid by price per kg / liter. Products seen on every visited page
 * are remembered (see store.js), so all of them can be listed sorted.
 *
 * REWE's markup (class names, test ids) changes often, so nothing here relies
 * on it. Products are found by their base-price text ("1 kg = 6,76 €"), the
 * grid is the element whose children hold those products, and the sort
 * control is found by its option labels ("Preis aufsteigend", ...).
 */
(function () {
  "use strict";

  // In Firefox content scripts `window` is the page's window, not our global
  // scope, so the other scripts' exports live on globalThis.
  const U = globalThis.ReweUnitPrice;
  const S = globalThis.ReweStore;
  const P = globalThis.RewePanel;
  const C = globalThis.RewePriceChart;
  const SettingsUI = globalThis.ReweSettingsUI;
  const LABEL = "Grundpreis aufsteigend";
  const OPTION_VALUE = "__rewe_unit_price_asc";
  const MARK = "data-rewe-unit-sort"; // "option" on injected sort options, "ui" on our own widgets
  const STORAGE_KEY = "reweUnitSortActive";
  const PRICE_OPTION_RE = /^\s*(preis\s*[:(]?\s*(auf|ab)steigend|preis\s*[:(]?\s*(niedrig|hoch)|(niedrigste|höchste)r?\s*preis|preis\s*[↑↓])/i;
  const MIN_TILES_TO_REMEMBER = 4;

  const log = (...args) => console.info("[REWE Grundpreis]", ...args);

  let active = loadActive();
  let settings = S.normaliseSettings(null); // replaced by the stored settings once loaded
  const maxAgeMs = () => settings.retentionDays * S.DAY_MS;
  let applying = false;
  const sortContainers = new WeakSet(); // custom dropdown lists we injected into
  let nativeSelects = [];

  // ---------- state ----------

  function loadActive() {
    try { return sessionStorage.getItem(STORAGE_KEY) === "1"; } catch (e) { return false; }
  }
  function saveActive() {
    try { sessionStorage.setItem(STORAGE_KEY, active ? "1" : "0"); } catch (e) { /* ignore */ }
  }

  function activate() {
    active = true;
    saveActive();
    const found = findProductGrid();
    if (found) {
      const sorted = applySort(found);
      log(`sorted ${found.tiles.length} products (${sorted} with a price per kg/l/piece),`,
        usesCssOrder(found.grid) ? "via CSS order" : "by moving nodes", found.grid);
    } else {
      log("no product grid found. Base-price elements on the page:", findBasePriceElements());
    }
    updateUi(!!found);
  }

  function deactivate() {
    if (!active) return;
    active = false;
    saveActive();
    restoreOrder();
    updateUi(!!lastGrid || !!findProductGrid());
  }

  // ---------- product grid detection ----------

  /** Innermost elements whose text contains a base price. */
  function findBasePriceElements() {
    const out = new Set();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      // skip JSON in <script> (REWE embeds product data with base prices there)
      acceptNode: (n) => (/[=€]/.test(n.data) && !n.parentElement.closest("script, style, template, noscript")
        ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
    });
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      // the base price may be split over a few spans, so look up a few levels
      let el = n.parentElement;
      for (let i = 0; el && i < 4; i++, el = el.parentElement) {
        if (el.closest(`[${MARK}]`)) break;
        const text = el.textContent;
        if (text.length > 200) break;
        if (U.hasBasePrice(text)) { out.add(el); break; }
      }
    }
    const all = [...out];
    return all.filter((el) => !all.some((o) => o !== el && el.contains(o)));
  }

  /**
   * -> { grid, tiles } for the main product list, or null.
   * The grid is the element with the most children that contain a base price;
   * this also works when a tile prints its base price more than once.
   */
  function findProductGrid() {
    const leaves = findBasePriceElements();
    if (leaves.length < 2) return null;

    const tilesByGrid = new Map();
    for (const leaf of leaves) {
      for (let el = leaf; el.parentElement && el.parentElement !== document.documentElement; el = el.parentElement) {
        const parent = el.parentElement;
        if (!tilesByGrid.has(parent)) tilesByGrid.set(parent, new Set());
        tilesByGrid.get(parent).add(el);
      }
    }

    let best = null;
    for (const [grid, tiles] of tilesByGrid) {
      // ">" keeps the deepest of equal candidates (wrappers come later in the map)
      if (!best || tiles.size > best.tiles.size) best = { grid, tiles };
    }
    return best && best.tiles.size >= 2 ? { grid: best.grid, tiles: [...best.tiles] } : null;
  }

  // ---------- sorting ----------

  let lastGrid = null;
  let originalChildren = null; // only used when we have to move DOM nodes

  function usesCssOrder(grid) {
    const d = getComputedStyle(grid).display;
    return d.includes("grid") || d.includes("flex");
  }

  /** Sorts the grid; returns how many tiles had a usable price. */
  function applySort(found) {
    if (applying || !found) return 0;
    const { grid, tiles } = found;
    const tileSet = new Set(tiles);

    if (lastGrid && lastGrid !== grid) restoreOrder();
    lastGrid = grid;

    const children = [...grid.children];
    const keyed = children
      .filter((c) => tileSet.has(c))
      .map((el, i) => ({ el, i, price: U.unitPriceFromText(tileText(el)) }));
    keyed.sort((a, b) => U.compareUnitPrices(a.price, b.price) || a.i - b.i);
    const others = children.filter((c) => !tileSet.has(c)); // banners etc. go last
    const desired = [...keyed.map((k) => k.el), ...others];

    applying = true;
    try {
      if (usesCssOrder(grid)) {
        // CSS `order` reorders visually without touching the DOM REWE's framework manages
        desired.forEach((el, idx) => {
          if (!el.hasAttribute("data-rewe-orig-order")) el.setAttribute("data-rewe-orig-order", el.style.order || "");
          if (el.style.order !== String(idx)) el.style.order = String(idx);
        });
      } else {
        if (!originalChildren) originalChildren = children;
        if (desired.some((el, idx) => children[idx] !== el)) grid.append(...desired);
      }
    } finally {
      applying = false;
    }
    return keyed.filter((k) => k.price).length;
  }

  function restoreOrder() {
    if (!lastGrid) return;
    applying = true;
    try {
      for (const el of lastGrid.querySelectorAll(":scope > [data-rewe-orig-order]")) {
        el.style.order = el.getAttribute("data-rewe-orig-order");
        el.removeAttribute("data-rewe-orig-order");
      }
      if (originalChildren) {
        lastGrid.append(...originalChildren.filter((el) => el.parentElement === lastGrid));
        originalChildren = null;
      }
    } finally {
      applying = false;
    }
    lastGrid = null;
  }

  function tileText(el) {
    return el.innerText || el.textContent;
  }

  // ---------- remembering products across pages ----------

  let ctxInfo = null;     // { key, page, listing } of the current URL
  let storedCount = 0;    // products stored for the current context
  let lastSignature = "";

  function extractProduct(tile) {
    const text = tileText(tile);
    const unit = U.unitPriceFromText(text);
    const price = U.parsePrice(text);
    if (!unit && price === null) return null;

    const links = [...tile.querySelectorAll("a[href]")];
    const link = links.find((a) => /\/p\//.test(a.getAttribute("href"))) || links[0];
    let url = null;
    if (link) {
      const u = new URL(link.getAttribute("href"), location.href);
      u.search = "";
      u.hash = "";
      if (/^https?:$/.test(u.protocol)) url = u.href;
    }

    const img = tile.querySelector("img");
    const imgSrc = img && [img.currentSrc, img.src, img.dataset.src].find((s) => /^https?:/.test(s || ""));

    const heading = tile.querySelector("h1, h2, h3, h4, h5") || tile.querySelector('[class*="title" i], [class*="name" i]');
    const name = [
      heading && heading.textContent,
      img && img.alt,
      link && (link.getAttribute("title") || link.getAttribute("aria-label")),
      link && link.textContent,
    ].map((s) => (s || "").replace(/\s+/g, " ").trim()).find(Boolean) || "";
    if (!url && !name) return null;

    const id = (url && S.productIdFromUrl(url)) || null;
    return { key: url || name, id, name: name.slice(0, 200), url, img: imgSrc || null, price, unit };
  }

  function contextLabel() {
    const h1 = document.querySelector("h1");
    return (h1 && h1.textContent.replace(/\s+/g, " ").trim()) || document.title;
  }

  function onContextChange(info) {
    ctxInfo = info;
    storedCount = 0;
    lastSignature = "";
    S.load(info.key, maxAgeMs()).then((ctx) => {
      if (ctxInfo !== info) return;
      storedCount = Object.keys(ctx.products).length;
      updateUi();
    }).catch((e) => log("could not read stored products", e));
  }

  function sampleOf(p) {
    return { p: p.price, u: p.unit ? p.unit.value : null, k: p.unit ? p.unit.kind : null };
  }

  function rememberProducts(found, tileProducts) {
    if (!ctxInfo.listing || !found || found.tiles.length < MIN_TILES_TO_REMEMBER) return;
    const products = tileProducts.map(([, p]) => p).filter(Boolean);
    const signature = ctxInfo.key + "#" + ctxInfo.page + "#" +
      products.map((p) => `${p.key}|${p.price}|${p.unit && p.unit.value}`).join(";");
    if (signature === lastSignature) return;
    lastSignature = signature;

    const info = ctxInfo;
    S.remember(info.key, info.page, contextLabel(), products, maxAgeMs()).then((ctx) => {
      if (!ctx || ctxInfo !== info) return;
      storedCount = Object.keys(ctx.products).length;
      updateUi();
    }).catch((e) => log("could not store products", e));

    const samples = products.filter((p) => p.id).map((p) => ({ id: p.id, name: p.name, ...sampleOf(p) }));
    S.recordPrices(samples, maxAgeMs()).then((histories) => {
      for (const [id, entries] of Object.entries(histories)) histCache.set(id, entries);
      decorateTiles(tileProducts);
    }).catch((e) => log("could not store price history", e));
  }

  // ---------- price trend arrows ----------

  const histCache = new Map(); // product id -> history entries

  /** Innermost element showing the tile's price ("4,39 €"). */
  function priceElement(tile) {
    const byId = tile.querySelector('[id$="-price"]');
    if (byId) return byId;
    for (const el of tile.querySelectorAll("*")) {
      if (!el.closest(`[${MARK}]`) && el.children.length === 0 && /^\s*\d+(\.\d{3})*,\d{2}\s*€\s*$/.test(el.textContent)) return el;
    }
    return null;
  }

  /** Put (or update / remove) a trend arrow inside `host`. */
  function setArrow(host, t) {
    if (!host) return;
    const existing = host.querySelector(":scope > .rewe-unit-sort-trend");
    const want = settings.showTrend && t && t.dir !== 0 ? `${t.dir}|${t.ref.t}|${settings.compareDays}` : "";
    if (existing && existing.dataset.key === want) return; // avoid feeding the MutationObserver
    if (existing) existing.remove();
    if (!want) return;
    const arrow = C.trendArrow(t, settings.compareDays);
    arrow.dataset.key = want;
    arrow.setAttribute(MARK, "ui");
    host.appendChild(arrow);
  }

  function decorateTiles(tileProducts) {
    const now = Date.now();
    const ageMs = settings.compareDays * S.DAY_MS;
    for (const [tile, p] of tileProducts) {
      if (!p || !p.id || !tile.isConnected) continue;
      const entries = histCache.get(p.id);
      if (!entries && !settings.showTrend) continue;
      setArrow(priceElement(tile), entries ? S.trend(entries, sampleOf(p), now, ageMs) : null);
    }
  }

  async function showAllStored() {
    const info = ctxInfo;
    const ctx = await S.load(info.key, maxAgeMs());
    const found = findProductGrid();
    const onPage = new Set(found ? found.tiles.map(extractProduct).filter(Boolean).map((p) => p.key) : []);
    const products = Object.values(ctx.products)
      .sort((a, b) => U.compareUnitPrices(a.unit, b.unit) || (a.price ?? Infinity) - (b.price ?? Infinity));
    const histories = settings.showTrend ? await S.getHistories(products.map((p) => p.id).filter(Boolean)) : {};
    const now = Date.now();
    P.open({
      label: ctx.label || contextLabel(),
      products,
      pages: Object.keys(ctx.pages).map(Number).sort((a, b) => a - b),
      onPage,
      mark: MARK,
      trendFor: (p) => {
        const entries = p.id && histories[p.id];
        const t = entries ? S.trend(entries, sampleOf(p), now, settings.compareDays * S.DAY_MS) : null;
        return C.trendArrow(t, settings.compareDays);
      },
      onClear: async () => {
        await S.clear(info.key);
        storedCount = 0;
        lastSignature = ""; // store the current page again on the next refresh
        refresh();
      },
    });
  }

  // ---------- product page: record the price, show history chart ----------

  let pdp = null; // { id, entries, chart } for the current product page

  /** Current price on a REWE product page, or null when none is shown. */
  function productPageSample() {
    const priceEl = document.querySelector(".pdpr-Price__Price, [itemprop='price']");
    if (!priceEl) return null; // e.g. "nicht verfügbar" in the chosen market
    let pricing = null;
    const script = document.querySelector('script[id^="pdpr-propstore"]');
    try { pricing = script && JSON.parse(script.textContent).productData.pricing; } catch (e) { /* fall back to text */ }
    const p = pricing && typeof pricing.price === "number" ? pricing.price / 100 : U.parsePrice(priceEl.textContent);
    const baseEl = document.querySelector(".pdsr-Grammage, .rs-qa-price-base");
    const unit = U.unitPriceFromText((pricing && pricing.grammage) || (baseEl && baseEl.textContent) || "");
    if (p == null && !unit) return null;
    return { priceEl, p, u: unit ? unit.value : null, k: unit ? unit.kind : null };
  }

  function handleProductPage(info) {
    if (!info.productId) return;
    if (!pdp || pdp.id !== info.productId) {
      pdp = { id: info.productId, entries: null, chart: null };
      const id = info.productId;
      const sample = productPageSample();
      const h1 = document.querySelector("h1");
      const name = h1 ? h1.textContent.replace(/\s+/g, " ").trim() : "";
      const load = sample
        ? S.recordPrices([{ id, name, p: sample.p, u: sample.u, k: sample.k }], maxAgeMs()).then((h) => h[id] || [])
        : S.getHistories([id]).then((h) => h[id] || []);
      load.then((entries) => {
        if (!pdp || pdp.id !== id) return;
        pdp.entries = entries;
        renderProductPage();
      }).catch((e) => log("could not load price history", e));
      return;
    }
    renderProductPage(); // re-insert if the page re-rendered
  }

  function renderProductPage(force = false) {
    if (!pdp || !pdp.entries) return;
    const sample = productPageSample();
    const now = Date.now();
    const t = sample ? S.trend(pdp.entries, sample, now, settings.compareDays * S.DAY_MS) : null;
    if (sample) setArrow(sample.priceEl, t);

    if (!settings.showChart || !pdp.entries.length) {
      if (pdp.chart) pdp.chart.remove();
      pdp.chart = null;
      return;
    }
    if (pdp.chart && pdp.chart.isConnected && !force) return;
    if (pdp.chart) pdp.chart.remove();
    pdp.chart = C.render(pdp.entries, { now, trend: t, compareDays: settings.compareDays, mark: MARK });
    const actions = document.querySelector(".pdpr-ProductActionsContainer");
    const info = document.getElementById("pdpr-ProductInformation");
    const h1 = document.querySelector("h1");
    if (actions) actions.after(pdp.chart);
    else if (info) info.appendChild(pdp.chart);
    else if (h1) h1.after(pdp.chart);
  }

  // ---------- hooking into REWE's sort control ----------

  function injectIntoNativeSelects() {
    nativeSelects = [...document.querySelectorAll("select")].filter((s) =>
      [...s.options].some((o) => PRICE_OPTION_RE.test(o.textContent))
    );
    for (const select of nativeSelects) {
      if (!select.querySelector(`option[value="${OPTION_VALUE}"]`)) {
        const opt = document.createElement("option");
        opt.value = OPTION_VALUE;
        opt.textContent = LABEL;
        opt.setAttribute(MARK, "option");
        select.appendChild(opt);
        log("added option to sort <select>", select);
      }
      if (active && select.value !== OPTION_VALUE) select.value = OPTION_VALUE;
    }
    return nativeSelects.length > 0;
  }

  function isSelected(el) {
    return (
      el.getAttribute("aria-selected") === "true" ||
      el.getAttribute("aria-checked") === "true" ||
      el.getAttribute("aria-current") === "true" ||
      !!el.querySelector('input:checked, [aria-selected="true"], [aria-checked="true"]')
    );
  }

  function injectIntoCustomDropdowns() {
    // deepest elements whose label is a price sort option
    const matches = [...document.querySelectorAll('[role="option"], [role="menuitem"], [role="menuitemradio"], [role="radio"], li, button, a, label')]
      .filter((el) => !el.closest(`[${MARK}]`) && el.textContent.length < 60 && PRICE_OPTION_RE.test(el.textContent.trim()));
    const leaves = matches.filter((el) => !matches.some((o) => o !== el && el.contains(o)));

    let injected = false;
    const seen = new Set();
    for (const leaf of leaves) {
      const item = menuItem(leaf, leaves);
      const list = item.parentElement;
      if (!list || seen.has(list)) continue;
      seen.add(list);
      injected = true;
      if (list.querySelector(`:scope > [${MARK}]`)) continue;

      // clone an unselected sibling so the copy doesn't look selected
      const template = [...list.children].find((c) => !isSelected(c) && PRICE_OPTION_RE.test(c.textContent.trim())) || item;
      const clone = template.cloneNode(true);
      clone.setAttribute(MARK, "option");
      for (const el of [clone, ...clone.querySelectorAll("*")]) {
        el.removeAttribute("id");
        el.removeAttribute("href");
        el.removeAttribute("for");
        if (el.hasAttribute("aria-selected")) el.setAttribute("aria-selected", "false");
        if (el.hasAttribute("aria-checked")) el.setAttribute("aria-checked", "false");
        if (el instanceof HTMLInputElement) {
          el.checked = false;
          el.value = OPTION_VALUE; // don't submit REWE's own sort value
        }
      }
      setLabel(clone, LABEL);
      list.appendChild(clone);
      sortContainers.add(list);
      log("added option to sort menu", list);
    }

    for (const clone of document.querySelectorAll(`[${MARK}="option"]:not(option)`)) {
      if (clone.hasAttribute("aria-selected")) clone.setAttribute("aria-selected", String(active));
      const input = clone.querySelector("input");
      if (input) input.checked = active;
    }
    return injected;
  }

  /**
   * The menu entry that contains `leaf`. With a second price option in the same
   * menu ("Preis absteigend"), the entry is the child of their closest common
   * ancestor, which also covers radio buttons (<div><input><label></div>).
   * Otherwise climb to the first element that has siblings.
   */
  function menuItem(leaf, leaves) {
    let best = null;
    for (const other of leaves) {
      if (other === leaf) continue;
      let common = leaf.parentElement;
      while (common && !common.contains(other)) common = common.parentElement;
      if (common && (!best || best.contains(common))) best = common;
    }
    let item = leaf;
    if (best) {
      while (item.parentElement !== best) item = item.parentElement;
    } else {
      while (item.parentElement && item.parentElement.children.length === 1) item = item.parentElement;
    }
    return item;
  }

  /** Replace the visible label text of a cloned option, keeping its markup. */
  function setLabel(root, text) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let target = null;
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (/preis/i.test(n.data)) { target = n; break; }
    }
    if (target) {
      target.data = text;
      // drop the rest of a label that was split over several text nodes
      for (let n = walker.nextNode(); n; n = walker.nextNode()) if (n.data.trim()) n.data = "";
    } else {
      root.textContent = text;
    }
  }

  function closeDropdown() {
    const opts = { key: "Escape", code: "Escape", keyCode: 27, bubbles: true };
    (document.activeElement || document.body).dispatchEvent(new KeyboardEvent("keydown", opts));
    document.dispatchEvent(new KeyboardEvent("keydown", opts));
  }

  // Capture phase so we see the events before REWE's own handlers do.
  window.addEventListener("change", (e) => {
    const t = e.target;
    if (!(t instanceof HTMLSelectElement) || !nativeSelects.includes(t)) return;
    if (t.value === OPTION_VALUE) {
      e.stopImmediatePropagation();
      activate();
    } else {
      deactivate();
    }
  }, true);

  // Many custom dropdowns select on pointerdown/mousedown and remove the list
  // right away, so a click never reaches the option. React to the earliest event.
  const PRESS_EVENTS = ["pointerdown", "mousedown", "touchstart"];
  for (const type of [...PRESS_EVENTS, "pointerup", "mouseup", "click"]) {
    window.addEventListener(type, (e) => {
      const t = e.target instanceof Element ? e.target : null;
      if (!t) return;
      if (t.closest(`[${MARK}="option"]`)) {
        if (e.cancelable) e.preventDefault();
        e.stopImmediatePropagation();
        if (!active) {
          activate();
          setTimeout(closeDropdown, 0);
        }
        return;
      }
      if (!PRESS_EVENTS.includes(type)) return;
      // any other option in a sort list we injected into -> REWE sorting takes over
      for (let el = t; el; el = el.parentElement) {
        if (sortContainers.has(el.parentElement)) { deactivate(); return; }
      }
    }, { capture: true, passive: false });
  }

  window.addEventListener("keydown", (e) => {
    if ((e.key === "Enter" || e.key === " ") && e.target instanceof Element && e.target.closest(`[${MARK}="option"]`)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      activate();
      closeDropdown();
    }
  }, true);

  // ---------- floating dock: status, fallback toggle, "show all", settings ----------

  let dock = null;
  let dockMain = null;
  let settingsUi = null;
  let dockState = "";
  let haveNativeControl = false;
  let hasGridCached = false;

  function ensureDock() {
    if (dock && dock.isConnected) return;
    dock = document.createElement("div");
    dock.className = "rewe-unit-sort-dock";
    dock.setAttribute(MARK, "ui");
    dockMain = document.createElement("div");
    dockMain.className = "rewe-unit-sort-dock-main";
    settingsUi = SettingsUI.create({ store: S, mark: MARK, onCleared: onDataCleared });
    settingsUi.setSettings(settings);
    dock.appendChild(dockMain);
    dock.appendChild(settingsUi.root);
    document.body.appendChild(dock);
    dockState = "";
  }

  function updateUi(hasGrid = hasGridCached) {
    hasGridCached = hasGrid;
    if (!location.pathname.startsWith("/shop")) return;
    ensureDock();
    const showToggle = !haveNativeControl && hasGrid && !(ctxInfo && ctxInfo.productId);
    const showAll = active && storedCount > 0;
    const state = [showToggle, active, showAll && storedCount].join("|");
    if (state === dockState) return; // avoid feeding the MutationObserver
    dockState = state;

    dockMain.textContent = "";
    if (showToggle) {
      const toggle = button(active ? "✓ Nach Grundpreis sortiert" : "Nach Grundpreis sortieren (€/kg, €/l)",
        () => (active ? deactivate() : activate()));
      toggle.classList.toggle("is-active", active);
      dockMain.appendChild(toggle);
    } else if (active) {
      const label = document.createElement("span");
      label.className = "rewe-unit-sort-status";
      label.textContent = "Sortiert nach Grundpreis ↑";
      dockMain.appendChild(label);
    }
    if (showAll) {
      dockMain.appendChild(button(`Alle ${storedCount} gespeicherten anzeigen`, () => {
        showAllStored().catch((e) => log("could not open list", e));
      }));
    }
    if (!showToggle && active) {
      const reset = button("✕", () => {
        deactivate();
        for (const s of nativeSelects) if (s.value === OPTION_VALUE) s.selectedIndex = 0;
      });
      reset.title = "Sortierung zurücksetzen";
      reset.classList.add("rewe-unit-sort-close");
      dockMain.appendChild(reset);
    }
  }

  function button(text, onClick) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = text;
    b.addEventListener("click", (e) => { e.stopPropagation(); onClick(); });
    return b;
  }

  function onDataCleared() {
    histCache.clear();
    storedCount = 0;
    lastSignature = "";
    if (pdp) pdp.entries = [];
    dockState = "";
    for (const a of document.querySelectorAll(".rewe-unit-sort-trend")) a.remove();
    if (pdp && pdp.chart) { pdp.chart.remove(); pdp.chart = null; }
    pdp = null;
    refresh();
  }

  function applySettings(next) {
    settings = next;
    if (settingsUi) settingsUi.setSettings(settings);
    dockState = "";
    refresh();
    renderProductPage(true);
  }

  // ---------- main loop ----------

  let lastUrl = null;

  function refresh() {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      haveNativeControl = false;
      const info = S.contextFromUrl(location.href);
      if (!ctxInfo || info.key !== ctxInfo.key || info.page !== ctxInfo.page) onContextChange(info);
    }
    const foundSelect = injectIntoNativeSelects();
    const foundDropdown = injectIntoCustomDropdowns();
    // custom dropdowns often only exist while open, so remember that we saw one
    haveNativeControl = haveNativeControl || foundSelect || foundDropdown;

    const found = findProductGrid();
    const tileProducts = found ? found.tiles.map((t) => [t, extractProduct(t)]) : [];
    rememberProducts(found, tileProducts);
    decorateTiles(tileProducts);
    if (active) applySort(found);
    handleProductPage(ctxInfo);
    updateUi(!!found);
  }

  let timer = null;
  const observer = new MutationObserver(() => {
    if (applying) return;
    clearTimeout(timer);
    timer = setTimeout(refresh, 250);
  });
  observer.observe(document.body, { childList: true, subtree: true });

  S.onSettingsChanged(applySettings);
  S.getSettings()
    .then(applySettings)
    .catch((e) => {
      log("could not read settings", e);
      refresh();
    });
})();
