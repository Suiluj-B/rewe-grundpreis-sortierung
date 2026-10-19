/*
 * Side panel listing every remembered product of the current category /
 * search, sorted by price per kg / liter. Built with DOM APIs only (no
 * innerHTML), since product names and URLs come from the page.
 */
(function (root) {
  "use strict";

  const EUR = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
  const DATE = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit" });
  const UNIT_SUFFIX = { mass: "kg", volume: "l", piece: "Stück" };

  let current = null;

  function el(tag, className, text) {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (text != null) e.textContent = text;
    return e;
  }

  function safeUrl(url) {
    try {
      const u = new URL(url, location.href);
      return /^https?:$/.test(u.protocol) ? u.href : null;
    } catch (e) {
      return null;
    }
  }

  function close() {
    if (!current) return;
    current.remove();
    current = null;
    document.removeEventListener("keydown", onKey, true);
  }

  function onKey(e) {
    if (e.key === "Escape") close();
  }

  function row(p, rank, onPage, arrow) {
    const li = el("li", "rewe-unit-sort-row" + (onPage ? " is-on-page" : ""));
    li.appendChild(el("span", "rewe-unit-sort-rank", String(rank)));

    const href = p.url && safeUrl(p.url);
    const main = el(href ? "a" : "div", "rewe-unit-sort-main");
    if (href) main.href = href;

    const imgSrc = p.img && safeUrl(p.img);
    if (imgSrc) {
      const img = el("img");
      img.src = imgSrc;
      img.alt = "";
      img.loading = "lazy";
      main.appendChild(img);
    } else {
      main.appendChild(el("span", "rewe-unit-sort-noimg"));
    }

    const info = el("span", "rewe-unit-sort-info");
    info.appendChild(el("span", "rewe-unit-sort-name", p.name || p.url || "?"));
    const meta = [p.price != null ? EUR.format(p.price) : null, `Seite ${p.page}`, `gesehen ${DATE.format(new Date(p.seenAt))}`];
    if (onPage) meta.push("auf dieser Seite");
    info.appendChild(el("span", "rewe-unit-sort-meta", meta.filter(Boolean).join(" · ")));
    main.appendChild(info);
    li.appendChild(main);

    const unit = el("span", "rewe-unit-sort-unit");
    if (p.unit) {
      unit.textContent = `${p.unit.source === "computed" ? "≈ " : ""}${EUR.format(p.unit.value)}/${UNIT_SUFFIX[p.unit.kind]}`;
      if (p.unit.source === "computed") unit.title = "Aus Preis und Packungsgröße berechnet";
    } else {
      unit.textContent = "–";
      unit.title = "Kein Grundpreis gefunden";
    }
    if (arrow) unit.appendChild(arrow);
    li.appendChild(unit);
    return li;
  }

  /**
   * opts: { label, products (sorted), pages: number[], onPage: Set<key>,
   *         mark: attribute name for our widgets, trendFor: (product) => element | null,
   *         onClear: async () => void }
   */
  function open(opts) {
    close();
    const overlay = el("div", "rewe-unit-sort-overlay");
    overlay.setAttribute(opts.mark, "ui");
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });

    const panel = el("aside", "rewe-unit-sort-panel");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "Alle gespeicherten Produkte nach Grundpreis");

    const header = el("header");
    const titles = el("div");
    titles.appendChild(el("h2", null, opts.label || "Gespeicherte Produkte"));
    titles.appendChild(el("p", null,
      `${opts.products.length} Produkte nach Grundpreis aufsteigend · ` +
      `besuchte Seiten: ${opts.pages.length ? opts.pages.join(", ") : "–"}`));
    header.appendChild(titles);
    const closeBtn = el("button", "rewe-unit-sort-close", "✕");
    closeBtn.type = "button";
    closeBtn.title = "Schließen";
    closeBtn.addEventListener("click", close);
    header.appendChild(closeBtn);
    panel.appendChild(header);

    const filter = el("input", "rewe-unit-sort-filter");
    filter.type = "search";
    filter.placeholder = "Filtern…";
    panel.appendChild(filter);

    const list = el("ol", "rewe-unit-sort-list");
    opts.products.forEach((p, i) =>
      list.appendChild(row(p, i + 1, opts.onPage.has(p.key), opts.trendFor ? opts.trendFor(p) : null)));
    panel.appendChild(list);

    filter.addEventListener("input", () => {
      const q = filter.value.trim().toLowerCase();
      for (const [i, li] of [...list.children].entries()) {
        li.hidden = !!q && !(opts.products[i].name || "").toLowerCase().includes(q);
      }
    });

    const footer = el("footer");
    footer.appendChild(el("span", null, "Besuche weitere Seiten der Kategorie, um sie hinzuzufügen."));
    const clear = el("button", null, "Liste leeren");
    clear.type = "button";
    clear.addEventListener("click", async () => {
      await opts.onClear();
      close();
    });
    footer.appendChild(clear);
    panel.appendChild(footer);

    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    document.addEventListener("keydown", onKey, true);
    current = overlay;
    filter.focus();
  }

  root.RewePanel = { open, close };
})(typeof globalThis !== "undefined" ? globalThis : this);
