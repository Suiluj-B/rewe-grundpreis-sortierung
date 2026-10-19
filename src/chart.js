/*
 * Price history chart for product pages, and the small trend arrow used on
 * tiles. A price holds until the next sighting, so the chart is a step line.
 * Built with DOM APIs only (no innerHTML).
 */
(function (root) {
  "use strict";

  const SVG_NS = "http://www.w3.org/2000/svg";
  const EUR = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
  const DATE = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
  const DATE_SHORT = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit" });
  const PCT = new Intl.NumberFormat("de-DE", { style: "percent", maximumFractionDigits: 1, signDisplay: "always" });
  const UNIT_SUFFIX = { mass: "kg", volume: "l", piece: "Stück" };

  // chart geometry (viewBox units; the SVG scales to the container width)
  const W = 560, H = 200;
  const M = { top: 16, right: 64, bottom: 26, left: 56 };

  function el(tag, className, text) {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (text != null) e.textContent = text;
    return e;
  }

  function svg(tag, attrs) {
    const e = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs || {})) e.setAttribute(k, v);
    return e;
  }

  function unitText(entry) {
    return entry.u != null && entry.k ? `${EUR.format(entry.u)}/${UNIT_SUFFIX[entry.k]}` : "";
  }

  /** Small ▲/▼ for a trend from ReweStore.trend(); null when there is nothing to show. */
  function trendArrow(t, compareDays) {
    if (!t || t.dir === 0) return null;
    const up = t.dir > 0;
    const a = el("span", "rewe-unit-sort-trend " + (up ? "is-up" : "is-down"), up ? "▲" : "▼");
    const ref = `${EUR.format(t.ref.p)}${t.ref.u != null ? ` (${unitText(t.ref)})` : ""}`;
    a.title = `${up ? "Teurer" : "Günstiger"} als am ${DATE.format(new Date(t.ref.t))}: ${ref}, ${PCT.format(t.change)}` +
      ` (ältester gespeicherter Preis der letzten ${compareDays === 1 ? "24 Stunden" : compareDays + " Tage"})`;
    a.setAttribute("aria-label", a.title);
    return a;
  }

  /** Round the value range outward to "nice" steps for 3 gridlines. */
  function yScaleDomain(values) {
    let lo = Math.min(...values), hi = Math.max(...values);
    if (hi - lo < 0.01) { lo -= Math.max(0.1, lo * 0.1); hi += Math.max(0.1, hi * 0.1); }
    const raw = (hi - lo) / 2;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map((f) => f * mag).find((s) => s >= raw) || raw;
    lo = Math.max(0, Math.floor(lo / step) * step);
    hi = Math.ceil(hi / step) * step;
    if (hi === lo) hi = lo + step;
    return { lo, hi, ticks: [lo, (lo + hi) / 2, hi] };
  }

  function buildSvg(entries, now, wrap) {
    const t0 = entries[0].t;
    const t1 = Math.max(now, entries[entries.length - 1].t + 1);
    const { lo, hi, ticks } = yScaleDomain(entries.map((e) => e.p));
    const x = (t) => M.left + ((t - t0) / (t1 - t0)) * (W - M.left - M.right);
    const y = (v) => M.top + (1 - (v - lo) / (hi - lo)) * (H - M.top - M.bottom);

    const s = svg("svg", { viewBox: `0 0 ${W} ${H}`, class: "rewe-unit-sort-chart-svg", role: "img" });
    s.setAttribute("aria-label", `Preisverlauf von ${DATE.format(new Date(t0))} bis heute`);

    // recessive grid + y labels
    for (const v of ticks) {
      s.appendChild(svg("line", { x1: M.left, x2: W - M.right, y1: y(v), y2: y(v), class: "grid" }));
      const label = svg("text", { x: M.left - 8, y: y(v) + 4, "text-anchor": "end", class: "axis" });
      label.textContent = EUR.format(v);
      s.appendChild(label);
    }
    // x labels: first sighting and today
    for (const [t, anchor, text] of [[t0, "start", DATE_SHORT.format(new Date(t0))], [t1, "end", "heute"]]) {
      const label = svg("text", { x: x(t), y: H - 6, "text-anchor": anchor, class: "axis" });
      label.textContent = text;
      s.appendChild(label);
    }

    // step line: each price holds until the next sighting, the last one until today
    let d = `M${x(entries[0].t)},${y(entries[0].p)}`;
    for (let i = 1; i < entries.length; i++) d += `H${x(entries[i].t)}V${y(entries[i].p)}`;
    d += `H${x(t1)}`;
    s.appendChild(svg("path", { d, class: "line" }));

    // markers only where the price changed (plus first), so a flat line stays quiet
    entries.forEach((e, i) => {
      if (i === 0 || e.p !== entries[i - 1].p) s.appendChild(svg("circle", { cx: x(e.t), cy: y(e.p), r: 4, class: "dot" }));
    });

    // direct label for the current price at the right end
    const last = entries[entries.length - 1];
    const cur = svg("text", { x: x(t1) + 6, y: y(last.p) + 4, class: "label" });
    cur.textContent = EUR.format(last.p);
    s.appendChild(cur);

    // hover: crosshair + tooltip showing the price valid at that moment
    const cross = svg("line", { y1: M.top, y2: H - M.bottom, class: "crosshair", visibility: "hidden" });
    const focus = svg("circle", { r: 5, class: "focus", visibility: "hidden" });
    s.appendChild(cross);
    s.appendChild(focus);
    const tip = el("div", "rewe-unit-sort-chart-tip");
    tip.hidden = true;
    wrap.appendChild(tip);

    const hit = svg("rect", { x: M.left, y: 0, width: W - M.left - M.right, height: H, class: "hit" });
    s.appendChild(hit);
    const move = (evt) => {
      const box = s.getBoundingClientRect();
      const vx = ((evt.clientX - box.left) / box.width) * W;
      const t = t0 + ((vx - M.left) / (W - M.left - M.right)) * (t1 - t0);
      let e = entries[0];
      for (const c of entries) if (c.t <= t) e = c;
      const cx = Math.min(Math.max(vx, M.left), W - M.right);
      for (const [k, v] of [["x1", cx], ["x2", cx]]) cross.setAttribute(k, v);
      focus.setAttribute("cx", cx);
      focus.setAttribute("cy", y(e.p));
      cross.setAttribute("visibility", "visible");
      focus.setAttribute("visibility", "visible");
      tip.textContent = "";
      tip.appendChild(el("strong", null, EUR.format(e.p)));
      if (e.u != null) tip.appendChild(el("span", null, unitText(e)));
      tip.appendChild(el("span", "muted", `gesehen ${DATE.format(new Date(e.t))}`));
      tip.hidden = false;
      const px = (cx / W) * box.width;
      tip.style.left = Math.min(Math.max(px, 70), box.width - 70) + "px";
      tip.style.top = ((y(e.p) / H) * box.height) + "px";
      // near the top the tooltip would cover the stats above the chart: show it below the point
      tip.classList.toggle("is-below", y(e.p) < H * 0.45);
    };
    const leave = () => {
      cross.setAttribute("visibility", "hidden");
      focus.setAttribute("visibility", "hidden");
      tip.hidden = true;
    };
    hit.addEventListener("pointermove", move);
    hit.addEventListener("pointerleave", leave);
    return s;
  }

  function stat(label, entry, extra) {
    const box = el("div", "rewe-unit-sort-stat");
    box.appendChild(el("span", "muted", label));
    const value = el("strong", null, EUR.format(entry.p));
    if (extra) value.appendChild(extra);
    box.appendChild(value);
    const sub = unitText(entry);
    if (sub) box.appendChild(el("span", "muted", sub));
    return box;
  }

  /**
   * entries: price history (sorted by time); opts: { now, trend, compareDays, mark }
   * -> element to insert into the product page
   */
  function render(entries, opts) {
    const box = el("section", "rewe-unit-sort-chart");
    box.setAttribute(opts.mark, "ui");
    const head = el("div", "rewe-unit-sort-chart-head");
    head.appendChild(el("h3", null, "Preisverlauf"));
    if (entries.length) {
      head.appendChild(el("span", "muted",
        `${entries.length} ${entries.length === 1 ? "Preis" : "Preise"} gespeichert seit ${DATE.format(new Date(entries[0].t))}`));
    }
    box.appendChild(head);

    if (!entries.length) {
      box.appendChild(el("p", "muted", "Noch kein Preis gespeichert."));
      return box;
    }

    const last = entries[entries.length - 1];
    const min = entries.reduce((a, b) => (b.p < a.p ? b : a));
    const max = entries.reduce((a, b) => (b.p > a.p ? b : a));
    const stats = el("div", "rewe-unit-sort-stats");
    stats.appendChild(stat("Zuletzt", last, trendArrow(opts.trend, opts.compareDays)));
    stats.appendChild(stat(`Tiefster (${DATE_SHORT.format(new Date(min.t))})`, min));
    stats.appendChild(stat(`Höchster (${DATE_SHORT.format(new Date(max.t))})`, max));
    box.appendChild(stats);

    const changes = entries.filter((e, i) => i === 0 || e.p !== entries[i - 1].p);
    if (changes.length < 2 && opts.now - entries[0].t < 2 * 24 * 60 * 60 * 1000) {
      box.appendChild(el("p", "muted",
        "Der Verlauf füllt sich, wenn du das Produkt an weiteren Tagen siehst (Produktseite oder Liste)."));
    }

    const wrap = el("div", "rewe-unit-sort-chart-plot");
    wrap.appendChild(buildSvg(entries, opts.now, wrap));
    box.appendChild(wrap);

    // table view
    const details = el("details");
    details.appendChild(el("summary", null, "Als Tabelle anzeigen"));
    const table = el("table");
    const thead = el("tr");
    for (const h of ["Gesehen", "Preis", "Grundpreis"]) thead.appendChild(el("th", null, h));
    table.appendChild(thead);
    for (const e of [...entries].reverse()) {
      const tr = el("tr");
      tr.appendChild(el("td", null, DATE.format(new Date(e.t))));
      tr.appendChild(el("td", null, EUR.format(e.p)));
      tr.appendChild(el("td", null, unitText(e) || "–"));
      table.appendChild(tr);
    }
    details.appendChild(table);
    box.appendChild(details);
    return box;
  }

  root.RewePriceChart = { render, trendArrow };
})(typeof globalThis !== "undefined" ? globalThis : this);
