/*
 * ⚙ button with a settings popover that grows out of it. Changes are saved
 * immediately to storage.local (ReweStore.saveSettings); other tabs pick them up
 * through storage.onChanged.
 */
(function (root) {
  "use strict";

  function el(tag, className, text) {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (text != null) e.textContent = text;
    return e;
  }

  function numberRow(id, label, unit, [min, max], hint) {
    const row = el("label", "rewe-unit-sort-field");
    row.htmlFor = id;
    row.appendChild(el("span", "rewe-unit-sort-field-label", label));
    const wrap = el("span", "rewe-unit-sort-field-input");
    const input = el("input");
    input.type = "number";
    input.id = id;
    input.min = String(min);
    input.max = String(max);
    input.step = "1";
    input.required = true;
    wrap.appendChild(input);
    wrap.appendChild(el("span", null, unit));
    row.appendChild(wrap);
    if (hint) row.appendChild(el("span", "rewe-unit-sort-hint", hint));
    return { row, input };
  }

  function checkRow(id, label) {
    const row = el("label", "rewe-unit-sort-check");
    row.htmlFor = id;
    const input = el("input");
    input.type = "checkbox";
    input.id = id;
    row.appendChild(input);
    row.appendChild(el("span", null, label));
    return { row, input };
  }

  /**
   * opts: { store: ReweStore, mark: attribute name for our widgets }
   * -> { root: element to put in the dock, setSettings(settings) }
   */
  function create(opts) {
    const S = opts.store;
    const wrap = el("div", "rewe-unit-sort-gearwrap");

    const pop = el("div", "rewe-unit-sort-settings");
    pop.id = "rewe-unit-sort-settings";
    pop.setAttribute("role", "dialog");
    pop.setAttribute("aria-label", "Einstellungen REWE Grundpreis-Sortierung");
    pop.appendChild(el("h2", null, "Einstellungen"));

    const retention = numberRow("rus-retention", "Preise speichern für", "Tage", S.LIMITS.retentionDays,
      "Ältere Preise werden gelöscht, auch aus dem Preisverlauf.");
    const compare = numberRow("rus-compare", "Pfeil vergleicht mit Preisen der letzten", "Tage", S.LIMITS.compareDays,
      "▲ teurer, ▼ günstiger als der älteste gespeicherte Preis aus diesem Zeitraum.");
    const showTrend = checkRow("rus-show-trend", "Pfeile an den Preisen anzeigen");
    const showChart = checkRow("rus-show-chart", "Preisverlauf auf Produktseiten anzeigen");
    for (const r of [retention, compare, showTrend, showChart]) pop.appendChild(r.row);

    const status = el("p", "rewe-unit-sort-saved");
    status.setAttribute("aria-live", "polite");
    pop.appendChild(status);

    const storageRow = el("div", "rewe-unit-sort-storage");
    const count = el("span", "rewe-unit-sort-hint");
    const clear = el("button", "rewe-unit-sort-danger", "Alle Preise löschen");
    clear.type = "button";
    storageRow.appendChild(count);
    storageRow.appendChild(clear);
    pop.appendChild(storageRow);

    const gear = el("button", "rewe-unit-sort-gear", "⚙");
    gear.type = "button";
    gear.title = "Einstellungen";
    gear.setAttribute("aria-label", "Einstellungen");
    gear.setAttribute("aria-expanded", "false");
    gear.setAttribute("aria-controls", pop.id);

    wrap.appendChild(pop);
    wrap.appendChild(gear);

    // ---- state ----

    let statusTimer = null;
    function flash(text) {
      status.textContent = text;
      clearTimeout(statusTimer);
      statusTimer = setTimeout(() => (status.textContent = ""), 1800);
    }

    function setSettings(s) {
      // don't overwrite a field the user is typing in
      if (document.activeElement !== retention.input) retention.input.value = s.retentionDays;
      if (document.activeElement !== compare.input) compare.input.value = s.compareDays;
      showTrend.input.checked = s.showTrend;
      showChart.input.checked = s.showChart;
    }

    async function refreshCount() {
      const { products } = await S.stats();
      count.textContent = `${products} ${products === 1 ? "Produkt" : "Produkte"} mit gespeicherten Preisen`;
    }

    let saveTimer = null;
    function save() {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(async () => {
        if (!retention.input.checkValidity() || !compare.input.checkValidity()) {
          flash("Bitte gültige Werte eingeben.");
          return;
        }
        const s = await S.saveSettings({
          retentionDays: retention.input.value,
          compareDays: compare.input.value,
          showTrend: showTrend.input.checked,
          showChart: showChart.input.checked,
        });
        setSettings(s);
        flash("Gespeichert ✓");
      }, 350);
    }
    for (const input of [retention.input, compare.input]) {
      input.addEventListener("input", save);
      input.addEventListener("change", save);
    }
    showTrend.input.addEventListener("change", save);
    showChart.input.addEventListener("change", save);

    // two-step confirm instead of window.confirm()
    let armed = false;
    clear.addEventListener("click", async () => {
      if (!armed) {
        armed = true;
        clear.textContent = "Wirklich löschen?";
        clear.classList.add("is-armed");
        setTimeout(() => {
          armed = false;
          clear.textContent = "Alle Preise löschen";
          clear.classList.remove("is-armed");
        }, 4000);
        return;
      }
      armed = false;
      await S.clearAll();
      clear.textContent = "Alle Preise löschen";
      clear.classList.remove("is-armed");
      flash("Alle gespeicherten Preise gelöscht.");
      refreshCount();
      if (opts.onCleared) opts.onCleared();
    });

    // ---- open / close ----

    function isOpen() {
      return wrap.classList.contains("is-open");
    }
    function open() {
      wrap.classList.add("is-open");
      gear.setAttribute("aria-expanded", "true");
      S.getSettings().then(setSettings);
      refreshCount();
      setTimeout(() => retention.input.focus(), 180);
    }
    function close() {
      wrap.classList.remove("is-open");
      gear.setAttribute("aria-expanded", "false");
    }
    gear.addEventListener("click", (e) => {
      e.stopPropagation();
      isOpen() ? close() : open();
    });
    document.addEventListener("pointerdown", (e) => {
      if (isOpen() && !wrap.contains(e.target)) close();
    }, true);
    document.addEventListener("keydown", (e) => {
      if (isOpen() && e.key === "Escape") {
        close();
        gear.focus();
      }
    }, true);

    return { root: wrap, setSettings, close };
  }

  root.ReweSettingsUI = { create };
})(typeof globalThis !== "undefined" ? globalThis : this);
