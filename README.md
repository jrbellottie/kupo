# Kupo

A desktop companion app for **Final Fantasy XI** (era-focused / [LandSandBoat](https://github.com/LandSandBoat/server)-based servers). Hosting a full toolkit of timers and notifications, fishing and clamming references, chocobo digging, weather forecasting, a bestiary, item and BCNM databases, a skillchain calculator, a crafting planner, a quest & mission guide with interactive walkthrough maps, and a full zone map atlas.

Vana'diel time is **global** (the same instant for every player on Earth), so the app works out of the box in any time zone. Just install and go.

Kupo is a **fully standalone app**. It never reads, writes, or modifies game files, memory, or network traffic, and it doesn't hook into or interact with the FFXI client in any way. Everything you see is driven by the app's own simulation of Vana'diel time and its bundled database information — it's a reference and timer tool for informational purposes only.

---

## Quick start

1. Install using the setup file from the latest [release](https://github.com/jrbellottie/kupo/releases).
2. Launch **Kupo**.
3. Confirm the **Vana'diel Clock** on the first tab matches the in-game `/clock`.
4. **Turn on Windows notifications** for the app (see below) so timers can alert you.

---

## Notifications

The app fires **Windows system notifications** when a timer is due. If Windows is suppressing notifications, your timers will run but you won't see or hear the alert.

- Open **Windows Settings → System → Notifications** and make sure notifications are **On**, and enabled for **Kupo** once it has fired at least once.
- Turn **Do Not Disturb / Focus Assist** **OFF** (it hides toasts).
- Turn **Game Mode OFF** if you're not seeing alerts — it can suppress notifications while a game is focused.

**How alerts behave:**

- Repeating timers (Vana'diel, real life, moon, presets) show a toast and **repeat about every 20 seconds until you click the notification** to dismiss it. Clicking the toast stops the repeats and disables that timer.
- If you never click, repeats **stop automatically after 10 alerts**.
- NM interval pops are **one-shot** notifications (they don't repeat).

**Background note:** Windows may throttle background apps to save power. If a timer is delayed while the app is minimized, the app **catches up immediately** when it regains focus and fires anything that was due.

---

## The tabs

### 🕐 Clock & Timers
The home screen. Shows the live **Vana'diel clock** (weekday + time, color-coded by day) and the **moon phase** (percentage, waxing/waning, countdown to the next moon step). Below is the list of every timer you've created, with next fire time in both Earth and Vana'diel time, a live countdown, and Enable/Disable/Delete controls. When you add a timer from any tab, this tab briefly flashes to confirm it.

### ⏱️ Time Tools
Create timers of every kind:
- **Vana'diel timers** — fire at a specific Vana'diel weekday + time (e.g. Firesday 06:00).
- **Real life timers** — fire at a local date/time (daily reminders roll forward automatically) or as a simple countdown.
- **Moon timers** — fire at a specific moon phase (waxing/waning + target %).
- **Stopwatch** — a stopwatch with lap tracking.

### 👹 NM Timers
Track notorious monsters in two modes:
- **Timed spawn** — enter ToD (or use *now*), a spawn window (e.g. `21h`–`24h`), a re-alert interval, and a warn lead. The app alerts before the window, at each interval inside it, and when it closes.
- **Lottery** — enter the placeholder respawn time and click **PH killed** each kill to reset the loop; **Clear PH** stops it.

Durations accept `10s`, `2.5h`, `1h45m55s`, or colon formats (`1:45:55`); all fields validate live.

### ⭐ Presets
One-click Vana'diel timers for recurring openings: **crafting guilds** (all nine, each skipping its weekly holiday), **Tenshodo** locations, and **Next Day** (00:00 Vana'diel time). A configurable offset alerts you N Vana'diel hours before the target time, and each card previews its next fire time. Next Day is server-independent; it does not represent a server-specific digging fatigue reset.

### 🔢 Counters
Manual tally counters for sessions: **Success/Failure** with a success-rate percentage, and a **Synthesis** tracker for HQ1/HQ2/HQ3/NQ/Break results with per-tier percentages. Left-click adds, right-click subtracts.

### 🪝 Lu Shang
Progress tracker for the 10,000 moat carp needed for the Lu Shang's Fishing Rod. Add singles or full stacks, set the total directly, and watch the remaining count and progress bar.

### 🐟 Fish
Six subtabs: **Fish list**, **Bait list**, **Best spots**, **Skill-up planner**, **Rod break matrix**, and **Rod stats**. Each view retains its filters, and the selected subtab is remembered.

The fish list is a searchable, sortable database: zones and areas, skill level, size, vendor price, catch requirements, rarity, and optimal moon/time/season conditions.

#### Bait and Skill-up Planning
Fishing spot analyzer. Pick a zone/area and bait to see the full catch pool, hook rates, and competing fish — plus a skill-up calculator for finding the best spots to level fishing.

#### Rods
Rod stats and the break matrix use the same Phoenix snapshot and risk formulas as the skill-up planner. Phoenix removes the skill-based durability bonus, uses 19% snap chance per excess rank (capped at 55%), and 10% break chance per adjusted excess rank (capped at 20%). Escape uses Phoenix's size and skill-gap rules, including certain escape at a 50-level deficit.

### 🪣 Clam
Clamming reference for all clamming points: item drop rates (with and without +1 swimwear), vendor prices, and bucket weight management.

### 🐤 Digging
Chocobo digging tables by zone: item rates, vendor/AH prices, moon-phase success modifiers, digging rank requirements, and gil-per-dig estimates.

### HELM
Mining, harvesting, excavation, and logging reference with searchable item rates, equipment modifiers, gathering limits, and reset rules. Browse annotated gathering maps with zoom and map selection, with optional WotG zones.

### 🌦️ Weather
Vana'diel weather forecaster for every zone. Shows each zone's weather patterns and elements and predicts upcoming weather by Vana'diel day.

### ⚔️ BCNM
Battlefield browser for BCNM/KSNM/ENM fights: filter by arena or type, search by name, and view orb requirements, level caps, and complete loot tables with drop rates.

### 💰 Items
Item source database searchable by item name. Every item shows **all** the era ways to get it: mob drops (drop/steal/despoil rates, mob level and zone), shop and guild vendors with prices, conquest point purchases, BCNM loot, HELM points, fishing, digging, clamming, quest rewards, and crafting recipes. Rows expand into a full per-item detail view, and items cross-link into the Crafting and BCNM tabs (and back).

### NPC
Search NPCs by name, zone, role, or an item they sell. Profiles show known map-grid locations, zone maps, services, recorded vendor inventories and prices, and linked quests and missions. Vendor names in Items, quest starters and recognized walkthrough names, and the purification NPC open these profiles. Inventory and quest links return to their in-app views; Back restores the previous tab.

The directory is seeded from bundled vendors, quest starters, and named service scripts, not an exhaustive list of all NPCs. Missing locations and inventories are labeled. XYZ positions are not converted to map-grid coordinates, and an unverified map floor is not highlighted. Cached FFXIclopedia notes may describe retail changes; prices and stock vary by server and conditions.

Refresh with `npm run npcs:generate` (requires the local LandSandBoat checkout), then `npm run npcs:fetch` (downloads uncached profiles; add `-- --refresh` to refresh existing profiles). Run `npm run test:npcs` to check identities, inventories, locations, quest links, and navigation.

### 📖 Bestiary
Offline monster database generated from a pinned LandSandBoat revision: per-zone monster groups, level-based HP/MP and combat stats, jobs, family, aggro/link behavior, detection senses, resistances, and modifiers. Choose **ToAU cap** or **WotG cap** rulesets; post-WotG content is excluded. Calculated totals use default LSB settings — live server values can differ, and the detail view labels this.

### 🔗 Skillchains
Skillchain calculator: pick weapons/weapon skills and find the two- and three-step combinations that produce each skillchain property.

### 🔨 Crafting
Two tools in one:
- **Recipes** — browse era-appropriate recipes by craft, level, and crystal (optionally including WotG).
- **Planner** — enter your skill to see the best recipes to level on, with success rates, expected skill gain per synth, and support/gear/moghancement bonuses factored in. Guild rank-up test items are highlighted.

### Profits
Crafting profit calculator with ingredient cost breakdowns, NQ/HQ comparisons, and estimated profit and gil per hour for NPC or auction-house sales. A shared local price book keeps custom buy and sell prices in sync with Chocobo Digging.

### 📜 Quests
Era-gated quest & mission guide (through Treasures of Aht Urhgan) with imported walkthroughs. Browse missions by storyline (nations, Zilart, Promathia, ToAU, Assault) or quests by area, with search across names, NPCs, items, rewards, and walkthrough text, plus fame and repeatability filters. The detail view shows requirements, rewards, previous/next chain links, and available walkthrough text. Hover or click mapped coordinates to spotlight grid cells in the side panel, including assault arena maps. Some entries and coordinate associations are incomplete; the sticky header links to the source ffxiclopedia page.

### 🗺️ Atlas
A Vana'diel map collection (340+ maps across 130+ zones) with a hoverable coordinate grid. Search or pick any map, mouse over it to read grid coordinates, or type a cell like `H-9` to highlight it — handy for following guides outside the Quests tab. Coverage is driven primarily by quest references, not a complete inventory of era zones.

**Alzadaal Routes** provides start/destination routing between the Al Zahbi entrance, Tandjana merit camp, Khimaira, Azouph Isle, Dvucca Isle, Mount Zhayolm behind the gate, Nashmau, both staging points, and all four remnants. Each step shows the departure teleporter letter, its marked pad, and the current/next maps, including outside entrances and exits. Swap endpoints to reverse the trip; route selection and progress are saved locally.

The lettered network follows the supplied two-way connections. Map 1 connects to map 4 via an explicitly marked outdoor walk across Dvucca Isle, not a direct teleport. Routes minimize map transitions through this network; they do not check access requirements, monster danger, or travel times. Portal markers and outside links are based on the bundled map images; map 1's internal pads are not included in the lettered-teleport count.

---

## Data & privacy

- All settings and timers are stored **locally** on your machine. Nothing is uploaded anywhere.
- To start completely fresh, close the app and delete its data folder at `%APPDATA%\kupo`, then relaunch.
- Uninstall via the uninstaller in the app's install folder; the data folder above is kept unless you delete it yourself.

---

## Troubleshooting

**I don't get notifications.**
- Enable notifications for the app in **Windows Settings → System → Notifications**.
- Turn **Do Not Disturb / Focus Assist** and **Game Mode** **OFF**.

**Notifications only appear when I focus the app.**
- Windows throttles background apps. The app catches up and fires due timers when it regains focus. This is expected.

**Moon % doesn't match in-game exactly.**
- Expected — the in-game display is a rounded estimate; the app uses the true moon phase.

---

## Building from source

Requirements: Node.js.

```powershell
npm install          # install dependencies
npm run dev          # run in development (Vite + Electron)
npm run build        # type-check + build renderer/main
npm run dist:win     # build the Windows installer into release/
```

### Data checks and refreshes

Run the inexpensive local checks before downloading or replacing data:

```powershell
npm run data:audit
npm run data:audit -- --lsb C:\path\to\server --json
npm run recipes:check                            # compare saved SQL snapshots
npm run recipes:check -- --lsb C:\path\to\server # compare selected server
npm run test:data                                # formulas and isolated refresh tests
npm run test:routes                              # Alzadaal journeys and map references
```

`data:audit` checks map image presence, grid metadata, quest map references, recipe IDs and item names, missing refresh scripts, and source fingerprints. `--json` includes full unresolved references and dataset SHA-256 hashes. Neither auditing nor recipe checking writes files. Git must be available for checkout comparisons; sparse checkout inputs can be read from the committed tree.

After reviewing the diff and confirming the target server revision, run `npm run recipes:update -- --lsb C:\path\to\server`. This replaces the recipe database and writes a provenance sidecar containing the commit, input hashes, generator hash, and output hash. Without `--lsb`, it uses the saved SQL snapshots, whose original revision is unknown. Review generated changes in Git, rerun the audit and tests, then run `npm run build`. Avoid changing the checkout during a refresh.

To refresh the quest/mission database and zone maps from ffxiclopedia:

```powershell
npm run quests:fetch          # rebuild src/data/quests.json
node scripts/fetch-maps.mjs   # download maps referenced by the quest data
```

### Item descriptions and tooltips

Expanded Items rows include offline game-tooltip images, wiki descriptions and statistics, equipment level/jobs/slots, weapon stats, stack size, base vendor value, and available LSB modifiers. Food effects and durations, wiki hidden effects, furnishing storage, and conditional server modifiers are included where present. NQ and HQ use separate item IDs. Existing source and recipe links remain below the item information.

The September 5, 2026 import covers 9,021 matched item IDs: 8,561 wiki statistics sections and 8,506 local tooltip images. There are 433 unresolved wiki titles and 27 pages without a Statistics section. Coverage is not a complete FFXI item database: unmatched names, scripted effects, and some templates still need review. Missing descriptions are labeled, never fabricated. LSB data is committed upstream revision `3e73b0bd38626df86481547133332f0c1e59dc1d`, not verified live-server configuration; wiki information reflects its page revision and may include later-retail changes. Conditional effects and raw modifier units are labeled separately.

```powershell
npm run items:generate -- C:\path\to\server
npm run items:fetch -- --images                 # resume missing pages/images
npm run items:fetch -- --only "Piccolo,Piccolo +1,Holly Lumber" --refresh --images
npm run items:fetch -- --refresh --resolve-missing --images
npm run test:items
```

Generation reads the selected committed Git revision, records source hashes, and uses the saved recipe SQL snapshot for recipe aliases. Wiki imports save every batch; `--refresh` rechecks cached pages and `--resolve-missing` accepts only unique exact normalized title matches, preserving HQ suffixes. No fuzzy item substitution is performed. Existing image files are reused; to redownload a changed image, remove its generated file before running `items:fetch -- --images`. `--optimize` converts older generated PNGs to lossless WebP.

The metadata component is lazy-loaded when a row expands. Tooltip images are bundled under `public/items` for offline use and currently add approximately 240 MB before installer compression. Wiki text attribution and page revisions accompany each entry; tooltip images link to their source file pages. FFXIclopedia text is attributed to its contributors (CC-BY-SA); game imagery belongs to Square Enix, and individual image licensing should be reviewed before redistribution. These source notices do not imply permission from the rights holder.

The Windows setup installer is produced at `release\Kupo Setup <version>.exe`.
