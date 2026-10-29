# Kupo

Kupo is an independent desktop companion for **Final Fantasy XI**, with timers, planning tools, and offline references for era-focused / [LandSandBoat](https://github.com/LandSandBoat/server)-based servers. It is fully standalone: it does not read or modify game files, memory, or network traffic, or interact with the FFXI client. Kupo is not affiliated with, endorsed by, or an official tool of any game server.

---

## Quick start

1. Install using the setup file from the latest [release](https://github.com/jrbellottie/kupo/releases).
2. Launch **Kupo**.
3. Confirm the **Vana'diel Clock** on the first tab matches the in-game `/clock`.
4. In **Clock & Timers → Timer popups**, use **Test / position popup**, drag its header to your preferred location, and adjust the alert volume.

Vana'diel time is global, so Kupo works in any time zone.

### Notification setup

Use **Clock & Timers → Timer popups → Open timer window** to watch live countdowns, soonest first, with flashing due alerts at the top and an adjustable soft chime. Drag the header to move it or its edges to resize; Kupo remembers the monitor, position, and size. Dismissing an alert leaves the window open while other alerts are pending; dismissing the last alert closes it, even if future countdowns remain. **Dismiss all alerts** or the close button clears all alerts and closes the window. Recurring timers stay enabled. Keep Kupo running; native system-notification permissions are not needed.

Linux uses software rendering and X11 (or XWayland on Wayland desktops) for graphics-driver compatibility and saved popup positions. XWayland must be installed when using a Wayland session. Popups request always-on-top stacking without taking focus, but the desktop controls whether they appear above games. **Reset to primary monitor** recovers an inconvenient popup position.

---

## The tabs

### 🕐 Clock & Timers
View the current Vana'diel time and moon phase, and manage your saved timers and upcoming alerts.

### ⏱️ Time Tools
Create Vana'diel, real-world, countdown, and moon-phase timers, use color-coded ports and countdowns on every transport route, or use a stopwatch to track elapsed time.

### 👹 NM Timers
Track notorious monster spawn windows and lottery placeholders, with reminders to help you follow each camp.

### ⭐ Presets
Quickly add reminders for guild openings, Tenshodo hours, the next Vana'diel day, and scheduled boat or airship journeys, with each timer button showing its offset and local alert time. Transport times are timetable estimates, not live tracking.

### 🔢 Counters
Keep manual tallies of session results, including success rates and synthesis outcomes.

### 🪝 Lu Shang
Track progress toward the 10,000 moat carp needed for Lu Shang's Fishing Rod.

### 🐟 Fish
Explore fish, bait, rods, and locations, plan fishing skill-ups, and compare estimated fishing time and direct-vendor returns across spots, with fish prices and crafting options using the pinned reference ruleset.

### 🪣 Clam
Browse clamming locations and possible rewards, with information to help manage bucket weight and equipment choices.

### 🐤 Digging
Compare chocobo digging locations and estimated returns, including ore, weather and night-drop rates under their required conditions, alongside clearly labeled base-source ability-layer references.

### Chocobo Raising
Save your egg's start time and use trainer reports to plan meals, track daily activities, and estimate training through day 128 with digging and racing presets. An optional non-yellow goal estimates color odds and plans worm feedings from your starting egg. Training follows a pinned reference ruleset, racing advice is community-based, and live availability and outcomes may differ.

### 🌦️ Weather
Look ahead at estimated weather and elemental-ore opportunities, and set reminders for upcoming windows. Forecasts are not guaranteed in-game conditions.

### Gardening
Find Mog House gardening recipes by harvest item, pot, seed, or crystal, with yields and growth estimates from a pinned reference ruleset. Set one rolling timer per planting for feeding windows and harvest readiness, with optional actual feeding records to refine later estimates.

### 🪑 Moghancement
Plan Mog House furniture for a selected Moghancement and aura tier, choose quantities with live aura and storage totals and one-copy limits for Rare items, and browse listed crafting recipes.

### HELM
Find mining, harvesting, excavation, and logging opportunities, with gathering maps and information about rewards and equipment.

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
Browse era-appropriate recipes and guild-point items, plan a crafting skill-up path, or compare selling prices, locations, stock capacity, and opening countdowns with reminders across all nine guilds.

### Profits
Compare crafting and desynthesis returns, explore ingredient chains, estimate quantities from a target or available materials, and manage a shared local price book.

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

- **No popup or sound:** keep Kupo running, use **Clock & Timers → Timer popups → Test / position popup**, check its volume and your system audio output, and try **Reset to primary monitor**.
- **Popup hidden while gaming:** try windowed mode; desktop window-manager rules can hide always-on-top windows. On KDE/Wayland, a game labeled borderless can still be treated as fullscreen. If windowed mode fixes it, check the game's KDE window settings or add a rule for that game with **Fullscreen** forced to **No**; Kupo cannot override the compositor's fullscreen stacking policy.
- **Linux window positioning:** use an X11 session or install/enable XWayland in your Wayland desktop.
- **Older AppImage crashes during GPU startup:** launch it with `--ozone-platform=x11 --disable-gpu`. New builds select X11/XWayland and disable hardware acceleration automatically on Linux; Windows is unchanged. Software rendering uses the CPU and may make graphics-heavy views slower.
- **Alerts only appear when Kupo regains focus:** the OS can suspend background apps; Kupo catches up when it becomes active.
- **Moon percentage differs slightly from the game:** the in-game display is rounded, while Kupo uses the calculated moon phase.

---

## Building from source

Requirements: Node.js 22.13 or later in the 22.x line, or Node.js 24 or later.

```powershell
npm install          # install dependencies
npm run dev          # run in development (Vite + Electron)
npm run build        # type-check + build renderer/main
npm run dist:win     # build the Windows installer
npm run dist:linux   # build the Linux AppImage (uses WSL on Windows)
```

The bundled alert sound is an original synthesized chime. Regenerate it with
`node scripts/generate-timer-chime.mjs`; no external sound downloads are needed.

The Windows installer is produced at `release\Kupo Setup <version>.exe`.

### Linux AppImage from Windows

Run `npm run dist:linux` from PowerShell. It uses your default WSL distribution,
copies the current build sources (including uncommitted edits) into a temporary
Linux workspace, installs Linux dependencies, and copies the finished AppImage
to `release\<version>\Kupo-Linux-<version>.AppImage`. The temporary workspace is
removed afterward. Windows dependencies, icons, build outputs, and the
`npm run dist:win` command are left unchanged.

One-time setup: run `wsl --install -d Ubuntu` in an administrator PowerShell,
restart if requested, and open Ubuntu to complete its first-run setup. Install
Linux Node.js 22.13 or later in the 22.x line, or Node.js 24 or later, with npm
inside that distribution (a default nvm installation is supported). Windows
Node.js does not replace Linux Node.js.
The build uses the default distribution selected by `wsl --set-default <name>`
and needs network access for npm dependencies and packaging tools.

Alternatively, no local Linux installation is needed with GitHub Actions. Push the build
workflow and source changes to GitHub's default branch, then open the repository's
**Actions** tab, select **Build AppImage**, and choose **Run workflow**. Once the
run succeeds, download **Kupo-Linux-x64-AppImage** from its **Artifacts** section
and extract the ZIP to get `Kupo-Linux-<version>.AppImage`. This builds a Linux x64
app; it does not run on Windows or publish a GitHub release.

On Linux, mark the extracted AppImage as executable in its file properties before
launching it. To build locally on Linux or in a separate WSL Linux checkout with
Node.js 22.13 or later in the 22.x line, or Node.js 24 or later, installed, run
`npm ci` followed by `npm run dist:linux`. The output is
in the versioned `release` directory. Do not reuse Windows `node_modules` in WSL.
The Linux command generates its PNG icon automatically and explicitly uses
`electron-builder.json5`; Windows packaging continues to use the configuration
in `package.json`. AppImage packaging requires Linux tools such as `mksquashfs`;
Windows builds run those tools inside WSL rather than directly on Windows.
On macOS, use GitHub Actions or a Linux environment. Vite's large-chunk warning
does not fail the build and is unrelated to AppImage packaging.

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

Auditing checks data references, map assets, and source fingerprints without writing files. Git is required for checkout comparisons. After reviewing differences and confirming the target revision, use `npm run recipes:update -- --lsb C:\path\to\server --revision <commit>` to refresh recipes and their provenance sidecar from that exact commit, including desynthesis result IDs rather than recipe labels. Omit `--revision` to read the checkout's SQL files. Without `--lsb`, generation uses the saved SQL snapshots, whose original revision is unknown. Keep the checkout unchanged during a refresh, review generated changes, rerun checks, and build the app.

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

Guild selling uses the pinned stock definitions, era overrides, and stock-based payout rules. Some target stocks are source assumptions. Opening reminders enable weekly holidays by default to match confirmed live behavior, while retaining the public source's disabled-holidays setting as provenance; the Guilds view lets you change this assumption. Validate guild calculations with `npm run test:guilds`.

The raising reference is independently pinned to [source revision 9b93232](https://github.com/phoenixffxi/Phoenix/tree/9b93232a0cc1e4a5a50b0f988f37d7ae63b8fcfa), checked October 5, 2026. Source mechanics and numeric tables are credited to the source fork and LandSandBoat contributors ([GPL-3.0 source license](https://github.com/phoenixffxi/Phoenix/blob/9b93232a0cc1e4a5a50b0f988f37d7ae63b8fcfa/LICENSE)); explanatory text is independently written. Input hashes are recorded in `src/data/chocoboRaising.json`. The public configuration does not enable the optional accelerated-raising module, and its active digging override does not apply personal-chocobo bonuses. Public source is not proof of live deployment; several implemented formulas are themselves estimates of retail behavior.

```powershell
npm run raising:generate -- C:\path\to\source-checkout
npm run raising:generate -- C:\path\to\source-checkout --check
npm run test:raising
```

The gardening reference uses the same [pinned source revision](https://github.com/phoenixffxi/Phoenix/tree/9b93232a0cc1e4a5a50b0f988f37d7ae63b8fcfa), with input hashes in `src/data/gardening.json`. Mechanics and numeric tables are credited to Darkstar, LandSandBoat and source-fork contributors under the source's GPL-3.0-or-later terms; explanatory text is independently written. Public defaults disable pot, weekday, moon and room-aura modifiers. Outcome chances enumerate the 33 possible planting rolls rather than treating SQL weights as probabilities. Timings assume prompt stage updates; live configuration and offline delays can change results.

```powershell
npm run gardening:generate -- C:\path\to\source-checkout
npm run gardening:generate -- C:\path\to\source-checkout --check
npm run test:gardening
```

Offline tooltip images are stored under `public/items` and add approximately 240 MB before installer compression. Existing files are reused; remove a specific generated image to redownload it with `items:fetch -- --images`. The `--optimize` option converts older generated PNGs to lossless WebP.
