# REWE Grundpreis-Sortierung

**EN:** Firefox add-on for the [REWE online shop](https://www.rewe.de/shop/): sort products
by price per kg / liter, compare all products of a category across pages, and see each
product's price history with trend arrows.

**DE:** Firefox-Addon für den [REWE Onlineshop](https://www.rewe.de/shop/): Produkte nach
Grundpreis (€/kg, €/l) sortieren, alle Produkte einer Kategorie seitenübergreifend
vergleichen und den Preisverlauf jedes Produkts mit Trendpfeilen sehen.

[English](#english) · [Deutsch](#deutsch)

> Unofficial project, not affiliated with REWE. / Inoffizielles Projekt, keine Verbindung zu REWE.

---

## English

### Features

- **"Grundpreis aufsteigend" sorting.** Adds a new option to REWE's own sort menu that
  sorts by price per kg or liter instead of total price, cheapest first.
- **All pages at once.** Every page of a category or search you visit is remembered.
  "Alle N gespeicherten anzeigen" lists all of them sorted by base price, with a filter box.
- **Price history.** Prices are recorded whenever a product shows up. Product pages get a
  chart with the price over time, lowest / highest price and a table view.
- **Trend arrows.** ▲ / ▼ next to prices show whether a product got more expensive or
  cheaper than the oldest price seen in the last *N* days.
- **Settings** (⚙ bottom right): how long prices are kept, the arrow's comparison window,
  arrows and chart on/off, delete all stored prices.
- **Private.** All data stays in your browser (`storage.local`). Nothing is sent anywhere,
  no tracking, no extra permissions besides storage and access to rewe.de.

### Usage

Open a category or search on rewe.de (prices only appear after choosing a market or
delivery area) and choose **Grundpreis aufsteigend** in the sort menu. A dock in the
bottom-right corner shows that the sorting is active; ✕ or picking another sort option
turns it off.

**Sorting across all pages:** click through the pages of a category once, then open
"Alle N gespeicherten anzeigen". Tip: set "Artikel pro Seite" to 80 so there are fewer
pages. Categories and searches are kept separately; `≈` marks base prices calculated
from price and pack size.

**How it sorts:**

- Uses the base price REWE prints on each product (`1 kg = 6,76 €`, `100 g = 1,99 €`,
  `1 l = 1,29 €`, `100 ml = …`), normalised to €/kg or €/l.
- Without a base price, it's calculated from pack size and price (`6 x 1,5 l`, `500g`).
- €/kg and €/l are compared directly, whichever the product has.
- Products only priced per piece (`1 Stück = …`) come next, then products without a
  usable price. Banners stay at the end.

**Price history and arrows:** a new entry is stored when the price changes, otherwise at
most once a day. The arrow compares with the oldest price from up to *N* days ago
(default 7), so it works even if you don't visit every day; prices from the last hour
don't count. It compares base prices when available, so a changed pack size doesn't
fool it. Hover an arrow for the old price and date.

**Settings (⚙):**

- **Preise speichern für … Tage** (default 30): older prices are deleted.
- **Pfeil vergleicht mit Preisen der letzten … Tage** (default 7)
- Arrows and the product page chart can be switched off.
- **Alle Preise löschen** deletes all stored prices (click twice to confirm).

### Install

**Temporarily (for testing):** `about:debugging#/runtime/this-firefox` →
**Load Temporary Add-on…** → select `manifest.json`. It's removed when Firefox restarts.

**Permanently:** release versions of Firefox only install add-ons signed by Mozilla.
Signing as **unlisted** is free, automatic (usually a few minutes) and doesn't publish
the add-on.

1. Log in at [addons.mozilla.org](https://addons.mozilla.org/developers/) and create an
   API key under **Tools → Manage API Keys**
   (<https://addons.mozilla.org/developers/addon/api/key/>).
2. In a terminal in this folder:

   ```sh
   npm install
   export WEB_EXT_API_KEY="user:12345:678"      # "JWT issuer"
   export WEB_EXT_API_SECRET="…"               # "JWT secret"
   npm run sign
   ```

3. The signed `.xpi` lands in `web-ext-artifacts/`. Install it via `about:addons` →
   ⚙ → **Install Add-on From File…**

For a new version, raise `version` in `manifest.json` and sign again; installing the new
`.xpi` updates the add-on and keeps its data.

### Publishing on addons.mozilla.org

Upload **only** the built package, never a zip of the project folder (that would
include `node_modules/` with the dev tools and fail validation with hundreds of
messages):

```sh
npm run build    # -> web-ext-artifacts/rewe_grundpreis-sortierung-<version>.zip
```

Upload that zip at <https://addons.mozilla.org/developers/addon/submit/>. When asked
whether source code is needed, answer **No**: nothing is minified or bundled, the
files in the zip are the source.

### Development

- `npm run start`: launches a separate Firefox with the add-on loaded (auto-reloads on changes)
- `npm test`: unit and DOM tests (jsdom; the DOM tests run the scripts in a sandbox
  shaped like Firefox's content-script scope, where `window` is not the script's global)
- `npm run lint`, `npm run build` (unsigned zip)

Code overview (`src/`):

| File | Purpose |
|---|---|
| `unitprice.js` | parses base prices / pack sizes from text, sort comparator |
| `store.js` | storage: settings, products per category, price history, trend calculation |
| `content.js` | finds grid and sort menu, sorting, recording, arrows, product page, dock |
| `panel.js` | "all stored products" side panel |
| `chart.js` | price history chart and trend arrow |
| `settings.js` | ⚙ settings popover |

### Troubleshooting

The add-on logs what it detects to the browser console (F12 → Console), prefixed with
`[REWE Grundpreis]`: whether it found the sort menu, and how many products it sorted or
which base-price elements it saw when it found no product grid.

### Notes and limitations

- REWE's markup changes often, so the add-on doesn't depend on class names. It finds
  products by their base-price text and the sort menu by labels such as "Preis aufsteigend".
- The product grid itself only reorders the products currently loaded. Products from
  other pages appear in the "Alle … anzeigen" panel.
- Products are reordered with CSS `order`, so the shop's own DOM, links and cart
  buttons stay untouched.

REWE markup as checked in October 2026, for reference when things change:

- Sort: `<select id="sorting">` with `RELEVANCE_DESC`, `TOPSELLER_DESC`, `NAME_ASC`,
  `PRICE_ASC`, `PRICE_DESC`, plus radio groups with the same options in the mobile
  filter dialogs (`plr-mobile-filter-modal-sorting`, `plr-quick-facet-filter-modal-sorting`).
- Grid: `ul.plrProductGrid` (`display: grid`), one `<li>` per product.
- Tile: `#plr-<id>`, title `#plr-<id>-title`, price `#plr-<id>-price` (`4,39 €`),
  base price `#plr-<id>-grammage` (`250g (1 kg = 17,56 €)`).
- Product page: price `mark.pdpr-Price__Price`, base price `.pdsr-Grammage`, product data
  as JSON in `script[id^="pdpr-propstore"]` (`productData.pricing.price` in cents).
- Pagination swaps the content in place (no page reload); search page 1 uses
  `?search=`, later pages `?term=`.

---

## Deutsch

### Funktionen

- **Sortierung „Grundpreis aufsteigend“.** Eine neue Option direkt in REWEs
  Sortiermenü: sortiert nach Preis pro kg bzw. Liter statt nach Gesamtpreis, günstigstes
  zuerst.
- **Alle Seiten auf einmal.** Jede besuchte Seite einer Kategorie oder Suche wird
  gemerkt. „Alle N gespeicherten anzeigen“ listet alle Produkte nach Grundpreis sortiert,
  mit Filterfeld.
- **Preisverlauf.** Preise werden gespeichert, sobald ein Produkt angezeigt wird.
  Produktseiten bekommen ein Diagramm mit dem Preis über die Zeit, tiefstem / höchstem
  Preis und einer Tabellenansicht.
- **Trendpfeile.** ▲ / ▼ neben den Preisen zeigen, ob ein Produkt teurer oder günstiger
  ist als der älteste gespeicherte Preis der letzten *N* Tage.
- **Einstellungen** (⚙ unten rechts): wie lange Preise gespeichert werden, Zeitraum für
  den Pfeil-Vergleich, Pfeile und Diagramm ein/aus, alle Preise löschen.
- **Privat.** Alle Daten bleiben in deinem Browser (`storage.local`). Es wird nichts
  gesendet, kein Tracking, keine Berechtigungen außer Speicher und Zugriff auf rewe.de.

### Benutzung

Öffne eine Kategorie oder Suche auf rewe.de (Preise erscheinen erst, wenn ein Markt
bzw. Liefergebiet gewählt ist) und wähle im Sortiermenü **Grundpreis aufsteigend**. Ein
Hinweis unten rechts zeigt, dass die Sortierung aktiv ist; ✕ oder eine andere
Sortierung schaltet sie ab.

**Seitenübergreifend sortieren:** Klick dich einmal durch die Seiten einer Kategorie und
öffne dann „Alle N gespeicherten anzeigen“. Tipp: „Artikel pro Seite“ auf 80 stellen,
dann sind es weniger Seiten. Kategorien und Suchen werden getrennt gespeichert; `≈`
markiert Grundpreise, die aus Preis und Packungsgröße berechnet wurden.

**So wird sortiert:**

- Grundlage ist der Grundpreis, den REWE an jedem Produkt angibt (`1 kg = 6,76 €`,
  `100 g = 1,99 €`, `1 l = 1,29 €`, `100 ml = …`), umgerechnet auf €/kg bzw. €/l.
- Fehlt der Grundpreis, wird er aus Packungsgröße und Preis berechnet (`6 x 1,5 l`, `500g`).
- €/kg und €/l werden direkt miteinander verglichen, je nachdem, was das Produkt hat.
- Danach folgen Produkte mit Preis pro Stück (`1 Stück = …`), dann Produkte ohne
  verwertbaren Preis. Werbebanner bleiben am Ende.

**Preisverlauf und Pfeile:** Ein neuer Eintrag wird gespeichert, wenn sich der Preis
ändert, sonst höchstens einmal am Tag. Der Pfeil vergleicht mit dem ältesten Preis aus
den letzten *N* Tagen (Standard 7). Das funktioniert also auch, wenn du nicht jeden Tag
reinschaust; Preise aus der letzten Stunde zählen nicht. Verglichen wird möglichst der
Grundpreis, damit eine geänderte Packungsgröße keinen falschen Pfeil erzeugt. Mit der
Maus über dem Pfeil siehst du den alten Preis und das Datum.

**Einstellungen (⚙):**

- **Preise speichern für … Tage** (Standard 30): ältere Preise werden gelöscht.
- **Pfeil vergleicht mit Preisen der letzten … Tage** (Standard 7)
- Pfeile und das Diagramm auf Produktseiten lassen sich abschalten.
- **Alle Preise löschen** löscht alle gespeicherten Preise (zum Bestätigen zweimal klicken).

### Installation

**Vorübergehend (zum Testen):** `about:debugging#/runtime/this-firefox` →
**Temporäres Add-on laden…** → `manifest.json` auswählen. Nach einem Firefox-Neustart
ist es wieder weg.

**Dauerhaft:** Normale Firefox-Versionen installieren nur von Mozilla signierte Addons.
Das Signieren als **„unlisted“** ist kostenlos, läuft automatisch (meist ein paar
Minuten) und veröffentlicht das Addon nicht.

1. Bei [addons.mozilla.org](https://addons.mozilla.org/developers/) anmelden und unter
   **Tools → Manage API Keys** einen API-Schlüssel erstellen
   (<https://addons.mozilla.org/developers/addon/api/key/>).
2. Im Terminal in diesem Ordner:

   ```sh
   npm install
   export WEB_EXT_API_KEY="user:12345:678"      # "JWT issuer"
   export WEB_EXT_API_SECRET="…"               # "JWT secret"
   npm run sign
   ```

3. Die signierte `.xpi` liegt danach in `web-ext-artifacts/`. Installieren über
   `about:addons` → ⚙ → **Add-on aus Datei installieren…**

Für eine neue Version `version` in `manifest.json` erhöhen und erneut signieren; die
neue `.xpi` aktualisiert das Addon, gespeicherte Daten bleiben erhalten.

**Bei addons.mozilla.org veröffentlichen:** nur das gebaute Paket hochladen
(`npm run build` → `web-ext-artifacts/rewe_grundpreis-sortierung-<version>.zip`), nie
den ganzen Projektordner. Die Frage nach dem Quellcode mit **Nein** beantworten: Der Code
ist weder komprimiert noch gebündelt.

### Entwicklung

Befehle, Code-Übersicht, Fehlersuche und Hinweise zum REWE-Markup stehen im
[englischen Teil](#development).
