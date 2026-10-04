# Kupo

Kupo is an independent desktop companion for **Final Fantasy XI**, with timers, planning tools, and offline references for era-focused / [LandSandBoat](https://github.com/LandSandBoat/server)-based servers. It is fully standalone: it does not read or modify game files, memory, or network traffic, or interact with the FFXI client. Kupo is not affiliated with, endorsed by, or an official tool of any game server.

---

## Quick start

1. Install using the setup file from the latest [release](https://github.com/jrbellottie/kupo/releases).
2. Launch **Kupo**.
3. Confirm the **Vana'diel Clock** on the first tab matches the in-game `/clock`.
4. Enable Windows notifications for Kupo so timers can alert you.

Vana'diel time is global, so Kupo works in any time zone.

### Notification setup

Timers use Windows system notifications. Some alerts repeat until dismissed; clicking a notification stops its repeats and disables that timer. Windows may delay background notifications, and Kupo catches up when it regains focus.

- Open **Windows Settings → System → Notifications** and enable notifications for Kupo once it has fired at least once.
- Turn **Do Not Disturb / Focus Assist** off.
- If alerts are suppressed while gaming, try turning **Game Mode** off.

---

## The tabs

### 🕐 Clock & Timers
View the current Vana'diel time and moon phase, and manage your saved timers and upcoming alerts.

### ⏱️ Time Tools
Create Vana'diel, real-world, countdown, and moon-phase timers, or use a stopwatch to track elapsed time.

### 👹 NM Timers
Track notorious monster spawn windows and lottery placeholders, with reminders to help you follow each camp.

### ⭐ Presets
Quickly add reminders for guild openings, Tenshodo hours, the next Vana'diel day, and scheduled boat or airship journeys. Transport times are timetable estimates, not live tracking.

### 🔢 Counters
Keep manual tallies of session results, including success rates and synthesis outcomes.

### 🪝 Lu Shang
Track progress toward the 10,000 moat carp needed for Lu Shang's Fishing Rod.

### 🐟 Fish
Explore fish, bait, rods, and fishing locations, and plan skill-ups or daily fishing sessions using estimated catches, fatigue, and equipment risks.

### 🪣 Clam
Browse clamming locations and possible rewards, with information to help manage bucket weight and equipment choices.

### 🐤 Digging
Compare chocobo digging locations, possible rewards, and estimated returns under the reference ruleset.

### HELM
Find mining, harvesting, excavation, and logging opportunities, with gathering maps and information about rewards and equipment.

### 🌦️ Weather
Look ahead at estimated weather and elemental-ore opportunities, and set reminders for upcoming windows. Forecasts are not guaranteed in-game conditions.

### ⚔️ BCNM
Browse BCNM, KSNM, and ENM battlefields, including entry requirements and recorded loot tables.

### 💰 Items
Look up items, their recorded sources, and available statistics, with links to related recipes and activities. Supplementary wiki text and tooltip images may reflect later-retail values.

### NPC
Find recorded NPC locations, services, inventories, and related quests. The directory covers known entries rather than every NPC.

### 📖 Bestiary
Browse an offline monster reference with combat statistics and behavior for ToAU- or WotG-capped content. Calculated values may differ from live-server settings.

### 🔗 Skillchains
Find two- and three-step skillchain combinations for your chosen weapons and weapon skills.

### 🔨 Crafting
Browse era-appropriate recipes and guild-point items, or plan a crafting skill-up path using estimated success and skill gains.

### Profits
Compare crafting costs and estimated returns from NPC or auction-house sales, using a local price book shared with Chocobo Digging.

### 📜 Quests
Browse era-focused quests and missions with requirements, rewards, and available walkthroughs, supported by linked maps.

### 🗺️ Atlas
Explore Vana'diel maps with a coordinate grid and plan journeys through Alzadaal's lettered teleporter network. Coverage is incomplete, and routes do not check access requirements or travel hazards.

---

## Data & privacy

- Settings, prices, and timers are stored **locally** on your machine and are not uploaded.
- To start fresh, close the app, delete its data folder at `%APPDATA%\kupo`, and relaunch.
- Uninstall using the uninstaller in the app's install folder. Saved data remains unless you delete it separately.

## Sources and limitations

Kupo uses bundled source snapshots and cached wiki references, not live game data. Coverage is incomplete, estimates may differ from your server, and wiki content may reflect later-retail changes. Source provenance is retained with the data. FFXIclopedia text is credited to its contributors under CC-BY-SA; game imagery belongs to Square Enix, and individual image licenses should be checked before redistribution.

---

## Troubleshooting

- **No notifications:** check Windows notification permissions, Do Not Disturb / Focus Assist, and Game Mode.
- **Alerts only appear when Kupo regains focus:** Windows can throttle background apps; Kupo catches up when it becomes active.
- **Moon percentage differs slightly from the game:** the in-game display is rounded, while Kupo uses the calculated moon phase.

---

## Building from source

Requirements: Node.js.

```powershell
npm install          # install dependencies
npm run dev          # run in development (Vite + Electron)
npm run build        # type-check + build renderer/main
npm run dist:win     # build the Windows installer
```

The Windows installer is produced at `release\Kupo Setup <version>.exe`.

### Data checks and refreshes

Run local checks before downloading or replacing data:

```powershell
npm run data:audit
npm run data:audit -- --lsb C:\path\to\server --json
npm run recipes:check
npm run recipes:check -- --lsb C:\path\to\server
npm run test:data
npm run test:routes
```

Auditing checks data references, map assets, and source fingerprints without writing files. Git is required for checkout comparisons. After reviewing differences and confirming the target revision, use `npm run recipes:update -- --lsb C:\path\to\server` to refresh recipes and their provenance sidecar. Without `--lsb`, generation uses the saved SQL snapshots, whose original revision is unknown. Keep the checkout unchanged during a refresh, review generated changes, rerun checks, and build the app.

Refresh quests, maps, and NPC profiles:

```powershell
npm run quests:fetch
node scripts\fetch-maps.mjs
npm run npcs:generate       # requires the local LandSandBoat checkout
npm run npcs:fetch          # download uncached profiles
npm run npcs:fetch -- --refresh
npm run test:npcs
```

Refresh item metadata, pinned reference overrides, and cached wiki content:

```powershell
npm run items:generate -- C:\path\to\server
npm run source:generate -- C:\path\to\server
npm run source:generate -- C:\path\to\server --check
npm run items:fetch -- --images
npm run items:fetch -- --only "Piccolo,Piccolo +1,Holly Lumber" --refresh --images
npm run items:fetch -- --refresh --resolve-missing --images
npm run test:items
```

Metadata generation reads committed source revisions, records input hashes, and uses `scripts/lsb-data/synth_recipes.sql` for recipe aliases. Reapply pinned overrides after refreshing base metadata; `--check` verifies the saved reference snapshot. Wiki imports save progress in batches and resolve missing titles only through unique exact normalized matches, preserving HQ identities.

Offline tooltip images are stored under `public/items` and add approximately 240 MB before installer compression. Existing files are reused; remove a specific generated image to redownload it with `items:fetch -- --images`. The `--optimize` option converts older generated PNGs to lossless WebP.
