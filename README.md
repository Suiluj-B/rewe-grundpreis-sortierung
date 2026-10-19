# REWE Grundpreis-Sortierung

Firefox add-on that adds **"Grundpreis aufsteigend"** to the sorting options in the
[REWE online shop](https://www.rewe.de/shop/). It sorts products by their price per
kg or liter, cheapest first, instead of by total price.

## How it sorts

- Uses the base price REWE prints on each product (`1 kg = 6,76 €`, `100 g = 1,99 €`,
  `1 l = 1,29 €`, `100 ml = …`), normalised to €/kg or €/l.
- If a product has no base price, it's calculated from the package size and price
  (`6 x 1,5 l`, `500g`).
- €/kg and €/l are compared directly, whichever the product has.
- Products only priced per piece (`1 Stück = …`) come next, then products with no
  usable price. Banners stay at the end.

## Install permanently

Release versions of Firefox only install add-ons signed by Mozilla. Signing as
**unlisted** is free, automatic (usually a few minutes) and doesn't publish the add-on.

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

3. The signed `.xpi` lands in `web-ext-artifacts/`. Install it in Firefox via
   `about:addons` → ⚙ → **Install Add-on From File…**

For a new version, raise `version` in `manifest.json` and run `npm run sign` again;
installing the new `.xpi` updates the add-on and keeps its data.

### Development

- `npm run start`: launches a separate Firefox with the add-on loaded (auto-reloads on changes)
- Or temporarily: `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on…** →
  `manifest.json`
- `npm test`, `npm run lint`, `npm run build` (unsigned zip)

## Usage

Open a category or search on rewe.de and choose **Grundpreis aufsteigend** in the
sort menu. A dock in the bottom-right corner shows that the sorting is active; ✕ or
picking another sort option turns it off. If the add-on can't find REWE's sort menu,
the dock shows a toggle button instead.

### Sorting across all pages

Every visited page of a category or search is remembered (product name, link, image,
price and base price, stored locally in the add-on's storage). While Grundpreis
sorting is active, **"Alle N gespeicherten anzeigen"** opens a panel listing all
remembered products of that category, cheapest per kg/l first, with a filter box.
So: open the category, click through its pages once, then open the list. Tip: set
"Artikel pro Seite" to 80 so there are fewer pages to click through.

- Categories / searches are kept apart; page and sort URL parameters are ignored.
- "Liste leeren" in the panel clears a category.
- `≈` marks base prices calculated from price and package size.

### Price history and trend arrows

Each product's price is recorded whenever it shows up in a list or on its product
page: a new entry when the price changes, otherwise at most once a day.

- **▲ / ▼** next to a price: more expensive / cheaper than the oldest recorded price
  from up to *N* days ago (default 7), so it works even if you don't visit every day.
  Prices from the last hour don't count. Hover for the old price and date. Compares
  the base price when available, so a changed pack size doesn't fool it.
- **Product pages** get a "Preisverlauf" box below the price: a step chart (hover for
  details), lowest / highest price, and a table view.

### Settings (⚙ bottom right)

- **Preise speichern für … Tage** (default 30): older prices are deleted.
- **Pfeil vergleicht mit Preisen der letzten … Tage** (default 7)
- Arrows and the product page chart can be switched off.
- **Alle Preise löschen** deletes all stored prices (click twice to confirm).

All data stays in the browser (`storage.local`); nothing is sent anywhere.

## Troubleshooting

The add-on logs what it detects to the browser console (F12 → Console), prefixed with
`[REWE Grundpreis]`: whether it found the sort menu, and how many products it sorted
or which base-price elements it saw when it found no product grid.

## Notes / limitations

- REWE's markup changes often, so the add-on doesn't depend on class names. It finds
  products by their base-price text and finds the sort menu by labels such as
  "Preis aufsteigend".
- The product grid itself only reorders the products currently loaded. Products from
  other pages appear in the "Alle … anzeigen" panel.
- Products are reordered with CSS `order`, so the shop's own DOM, links and cart
  buttons stay untouched.

## REWE markup (checked October 2026)

For reference when REWE changes things. The add-on finds all of this by text, not by
these names:

- Sort: `<select id="sorting">` with `RELEVANCE_DESC`, `TOPSELLER_DESC`, `NAME_ASC`,
  `PRICE_ASC`, `PRICE_DESC`, plus radio groups with the same options in the mobile
  filter dialogs (`plr-mobile-filter-modal-sorting`, `plr-quick-facet-filter-modal-sorting`).
- Grid: `ul.plrProductGrid` (`display: grid`), one `<li>` per product.
- Tile: `#plr-<id>`, title `#plr-<id>-title`, price `#plr-<id>-price` (`4,39 €`),
  base price `#plr-<id>-grammage` (`250g (1 kg = 17,56 €)`).
- Prices only appear once a market or delivery area is selected.
- Pagination swaps the content in place (no page reload); search page 1 uses
  `?search=`, later pages `?term=`.

## Tests

```sh
npm install   # jsdom, for the DOM tests
npm test
```

The DOM tests run the scripts in a sandbox shaped like Firefox's content-script
scope, where `window` is not the script's global object.
