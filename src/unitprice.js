/*
 * Pure text parsing for REWE product tiles. No DOM access here so it can be
 * unit-tested with plain Node (see test/unitprice.test.js).
 *
 * All results are normalised to EUR per 1 kg, per 1 l or per 1 piece.
 */
(function (root) {
  "use strict";

  const NUM = String.raw`\d{1,3}(?:\.\d{3})*(?:,\d+)?|\d+(?:[.,]\d+)?`;
  const UNIT = String.raw`(?<![a-zäöü])(?:kg|g|mg|l|ltr|liter|ml|cl|stück|stk|st\.?)`;
  const EURO = String.raw`(?:€|eur\b)`;

  // "1 kg = 6,76 €", "(100 g = 1,99 €)", "1 l = € 1,29", "1 kg: 6,76 €"
  const BASE_EQ = new RegExp(
    String.raw`(${NUM})?\s*(${UNIT})\s*[=:]\s*(?:${EURO}\s*)?(${NUM})\s*(?:${EURO})?`,
    "gi"
  );
  // "6,76 € / kg", "6,76 €/1 kg", "6,76 € pro 100 g", "6,76 € je l"
  const BASE_PER = new RegExp(
    String.raw`(${NUM})\s*${EURO}\s*(?:/|pro|je)\s*(${NUM})?\s*(${UNIT})(?![a-zäöü])`,
    "gi"
  );
  // a price like "2,49 €" or "€ 2,49"
  const PRICE = new RegExp(
    String.raw`(?:${EURO}\s*(\d+(?:\.\d{3})*,\d{2}))|(?:(\d+(?:\.\d{3})*,\d{2})\s*${EURO})`,
    "gi"
  );
  // package size: "500g", "1,5 l", "6 x 0,5 l", "4x125 g"
  const SIZE = new RegExp(
    String.raw`(?:(\d+)\s*[x×]\s*)?(${NUM})\s*(${UNIT})(?![a-zäöü])`,
    "gi"
  );

  function parseNumber(s) {
    if (s == null || s === "") return NaN;
    s = String(s).trim();
    if (s.includes(",")) return parseFloat(s.replace(/\./g, "").replace(",", "."));
    // "1.000" is a thousands separator in German, "1.5" a decimal
    if (/^\d{1,3}(\.\d{3})+$/.test(s)) return parseFloat(s.replace(/\./g, ""));
    return parseFloat(s);
  }

  // -> { kind, factor } where amount * factor = amount in kg / l / pieces
  function unitInfo(unit) {
    const u = unit.toLowerCase().replace(/\.$/, "");
    switch (u) {
      case "kg": return { kind: "mass", factor: 1 };
      case "g": return { kind: "mass", factor: 1e-3 };
      case "mg": return { kind: "mass", factor: 1e-6 };
      case "l": case "ltr": case "liter": return { kind: "volume", factor: 1 };
      case "ml": return { kind: "volume", factor: 1e-3 };
      case "cl": return { kind: "volume", factor: 1e-2 };
      case "stück": case "stk": case "st": return { kind: "piece", factor: 1 };
      default: return null;
    }
  }

  function normalise(price, amount, unit) {
    const info = unitInfo(unit);
    const qty = (isNaN(amount) ? 1 : amount) * (info ? info.factor : NaN);
    if (!info || !(price >= 0) || !(qty > 0)) return null;
    return { value: price / qty, kind: info.kind };
  }

  /** Parse the base price ("Grundpreis") REWE prints on a tile. */
  function parseBasePrice(text) {
    for (const m of text.matchAll(BASE_EQ)) {
      const r = normalise(parseNumber(m[3]), parseNumber(m[1]), m[2]);
      if (r) return { ...r, source: "base", match: m[0] };
    }
    for (const m of text.matchAll(BASE_PER)) {
      const r = normalise(parseNumber(m[1]), parseNumber(m[2]), m[3]);
      if (r) return { ...r, source: "base", match: m[0] };
    }
    return null;
  }

  function stripBasePrices(text) {
    return text.replace(BASE_EQ, " ").replace(BASE_PER, " ");
  }

  /** Lowest "x,yz €" in the text (a sale price is lower than the struck-out one). */
  function parsePrice(text) {
    let best = null;
    for (const m of stripBasePrices(text).matchAll(PRICE)) {
      const p = parseNumber(m[1] || m[2]);
      if (p > 0 && (best === null || p < best)) best = p;
    }
    return best;
  }

  /** Fallback when no base price is printed: price / package size. */
  function computeFromSize(text) {
    const price = parsePrice(text);
    if (price === null) return null;
    for (const m of stripBasePrices(text).matchAll(SIZE)) {
      const count = m[1] ? parseInt(m[1], 10) : 1;
      const info = unitInfo(m[3]);
      if (!info || info.kind === "piece") continue;
      const r = normalise(price, count * parseNumber(m[2]), m[3]);
      if (r) return { ...r, source: "computed", match: m[0] };
    }
    return null;
  }

  /**
   * Unit price for a product tile's text, or null.
   * kind: "mass" (EUR/kg) | "volume" (EUR/l) | "piece" (EUR/Stück)
   */
  function unitPriceFromText(text) {
    text = text.replace(/ /g, " ").replace(/\s+/g, " ");
    return parseBasePrice(text) || computeFromSize(text);
  }

  /** Whether the text contains something that looks like a base price. */
  function hasBasePrice(text) {
    return parseBasePrice(text.replace(/ /g, " ").replace(/\s+/g, " ")) !== null;
  }

  /**
   * Comparator, ascending. kg and l are compared directly with each other;
   * per-piece prices come after them, products without any price last.
   */
  const KIND_RANK = { mass: 0, volume: 0, piece: 1 };
  function compareUnitPrices(a, b) {
    const ra = a ? KIND_RANK[a.kind] : 2;
    const rb = b ? KIND_RANK[b.kind] : 2;
    if (ra !== rb) return ra - rb;
    if (!a || !b) return 0;
    return a.value - b.value;
  }

  const api = { parseNumber, parseBasePrice, parsePrice, computeFromSize, unitPriceFromText, hasBasePrice, compareUnitPrices };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ReweUnitPrice = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
