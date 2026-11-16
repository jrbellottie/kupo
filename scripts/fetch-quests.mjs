// Scrapes FFXI quests & missions (up to Treasures of Aht Urhgan) into src/data/quests.json.
//
// Sources:
//   - Eden wiki (classicffxi.fandom.com): ToAU-era snapshot. Used ONLY to enumerate which
//     quest/mission titles are era-valid (the era gate). No content is taken from it.
//   - FFXIclopedia (ffxiclopedia.fandom.com): all content, coordinates and links. Titles are
//     resolved to canonical ffxiclopedia pages (handles Eden's stale casing/naming), and start-NPC
//     coordinates missing from quest pages are backfilled from the NPC's own page.
//
// Usage: node scripts/fetch-quests.mjs            (full run)
//        LIMIT=10 node scripts/fetch-quests.mjs   (parse only first N pages per category - testing)
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const EDEN = "https://classicffxi.fandom.com/api.php";
const FFXI = "https://ffxiclopedia.fandom.com/api.php";
const UA = "kupo-app quest importer (personal offline FFXI tool)";
const LIMIT = process.env.LIMIT ? parseInt(process.env.LIMIT, 10) : Infinity;

const QUEST_CATS = [
  ["Bastok Quests", "Bastok"],
  ["San d'Oria Quests", "San d'Oria"],
  ["Windurst Quests", "Windurst"],
  ["Jeuno Quests", "Jeuno"],
  ["Outlands Quests", "Outlands"],
  ["Aht Urhgan Quests", "Aht Urhgan"],
  ["Other Quests", "Other"],
  ["Mog House Exit Quests", "Mog House Exit"],
];

const MISSION_CATS = [
  ["Bastok Missions", "Bastok"],
  ["San d'Oria Missions", "San d'Oria"],
  ["Windurst Missions", "Windurst"],
  ["Rise of the Zilart Missions", "Rise of the Zilart"],
  ["Chains of Promathia Missions", "Chains of Promathia"],
  ["Treasures of Aht Urhgan Missions", "Treasures of Aht Urhgan"],
  ["Assault", "Assault"],
];

// ffxiclopedia category names, where they differ from Eden's
const FFXI_MISSION_CATS = new Map([["Assault", "Assault Missions"]]);

// ffxiclopedia-only quests verified era-correct by hand; everything else ffxiclopedia-only is
// reported to the console for review instead of being included (Eden's quest list is the era gate).
const QUEST_WHITELIST = new Set([]);

// Index/landing pages that live inside the categories but aren't quests/missions
const SKIP_TITLES = new Set([
  "Quests", "Missions", "Assault",
  "Bastok Missions", "San d'Oria Missions", "Windurst Missions", "TOAU Missions",
  "Bastok Quests", "San d'Oria Quests", "Windurst Quests", "Jeuno Quests",
  "Rise of the Zilart Missions", "Chains of Promathia Missions",
  "Treasures of Aht Urhgan Missions", "Aht Urhgan Missions",
  "Mission", "Quest", "Reputation", "Fame",
  "Assault Mission Giver", "Ancient Lockbox", "Assault Order", "Nyzul Isle Investigation",
]);
const SKIP_RE = /^\?\?\? |Gate Guard$|^Armor Sets\//;

/** Eden titles assaults "Apkallu Breeding", ffxiclopedia "Assault Mission - Apkallu Breeding". */
const normTitle = (t) => t.replace(/^Assault Mission - /, "");

// Post-ToAU marker in the TITLE only (content mentions are unreliable either way)
const POST_TOAU_TITLE_RE = /Wings of the Goddess|Abyssea|Adoulin|Voidwatch|VW Op|Records of Eminence|Trust:|Coalition|Monstrosity|Dancer|Scholar|Synergistic|Moogle Magic/i;

// Pages whose walkthrough lives in a shared transcluded template (all three nations' Magicite)
const WALKTHROUGH_TRANSCLUSIONS = [{ marker: /\{\{\s*magicite\s*\}\}/i, template: "Template:Magicite" }];

// Assault arena maps, per each zone's "/Maps" subpage gallery captions (assault name -> [zone, mapNo]).
// Gallery says "Escort Professor Clavauert" but the page/entry is "Escort Professor Chanoix" (NPC: Clavauert B Chanoix).
const ASSAULT_MAPS = new Map([
  ["Imperial Code", ["Leujaoam Sanctum", 1]],
  ["Escort Professor Chanoix", ["Leujaoam Sanctum", 2]],
  ["Red Versus Blue", ["Leujaoam Sanctum", 3]],
  ["Shanarha Grass Conservation", ["Leujaoam Sanctum", 4]],
  ["Supplies Recovery", ["Leujaoam Sanctum", 6]],
  ["Leujaoam Cleansing", ["Leujaoam Sanctum", 7]],
  ["Orichalcum Survey", ["Leujaoam Sanctum", 8]],
  ["Counting Sheep", ["Leujaoam Sanctum", 9]],
  ["Azure Experiments", ["Leujaoam Sanctum", 10]],
  ["The Double Agent", ["Mamool Ja Training Grounds", 1]],
  ["Imperial Agent Rescue", ["Mamool Ja Training Grounds", 2]],
  ["Preemptive Strike", ["Mamool Ja Training Grounds", 3]],
  ["Breaking Morale", ["Mamool Ja Training Grounds", 4]],
  ["Imperial Treasure Retrieval", ["Mamool Ja Training Grounds", 5]],
  ["Sagelord Elimination", ["Mamool Ja Training Grounds", 7]],
  ["Blitzkrieg", ["Mamool Ja Training Grounds", 8]],
  ["Azure Ailments", ["Mamool Ja Training Grounds", 8]],
  ["Marids in the Mist", ["Mamool Ja Training Grounds", 10]],
  ["Troll Fugitives", ["Lebros Cavern", 2]],
  ["Apkallu Breeding", ["Lebros Cavern", 3]],
  ["Excavation Duty", ["Lebros Cavern", 4]],
  ["Wamoura Farm Raid", ["Lebros Cavern", 5]],
  ["Lebros Supplies", ["Lebros Cavern", 6]],
  ["Evade and Escape", ["Lebros Cavern", 9]],
  ["Siegemaster Assassination", ["Lebros Cavern", 10]],
  ["Apkallu Seizure", ["Ilrusi Atoll", 1]],
  ["Lost and Found", ["Ilrusi Atoll", 2]],
  ["Deserter", ["Ilrusi Atoll", 3]],
  ["Demolition Duty", ["Ilrusi Atoll", 4]],
  ["Lamia No.13", ["Ilrusi Atoll", 5]],
  ["Extermination", ["Ilrusi Atoll", 7]],
  ["Golden Salvage", ["Ilrusi Atoll", 8]],
  ["Searat Salvation", ["Ilrusi Atoll", 9]],
  ["Desperately Seeking Cephalopods", ["Ilrusi Atoll", 10]],
  ["Shooting Down the Baron", ["Periqia", 1]],
  ["Stop the Bloodshed", ["Periqia", 1]],
  ["Requiem", ["Periqia", 2]],
  ["Defuse the Threat", ["Periqia", 3]],
  ["Saving Private Ryaaf", ["Periqia", 7]],
  ["Building Bridges", ["Periqia", 7]],
  ["Wake the Puppet", ["Periqia", 7]],
  ["Seagull Grounded", ["Periqia", 8]],
  ["Operation: Snake Eyes", ["Periqia", 8]],
  // Area overview entries: show the whole zone's map set
  ["Leujaoam Sanctum", ["Leujaoam Sanctum", null]],
  ["Mamool Ja Training Grounds", ["Mamool Ja Training Grounds", null]],
  ["Lebros Cavern", ["Lebros Cavern", null]],
  ["Periqia", ["Periqia", null]],
  ["Ilrusi Atoll", ["Ilrusi Atoll", null]],
  ["Nyzul Isle", ["Nyzul Isle", null]],
]);

// Manual overrides for verified wiki errors / prose the parser can't disambiguate
const COORD_FIXES = [
  { page: "Appointment to Jeuno", snippet: "blind staircase area (H-8)", wrong: null, right: "H-8", zone: "Lower Delkfutt's Tower", mapNo: 0 },
  { page: "Appointment to Jeuno", snippet: "top of the blind staircase", wrong: "E-10", right: "F-10", zone: "Upper Delkfutt's Tower", mapNo: 10 },
  { page: "Leaute's Last Wishes", snippet: "Head to the garden", wrong: null, right: "F-7", zone: "Chateau d'Oraguille", mapNo: 1 },
  { page: "Ranperre's Final Rest", snippet: "head for {Ranperre's Tomb", wrong: null, right: "H-8", zone: "King Ranperre's Tomb", mapNo: 1 },
  { page: "Ranperre's Final Rest", snippet: "Heavy Stone Door located", wrong: null, right: "H-8", zone: "King Ranperre's Tomb", mapNo: 1 },
  { page: "Prestige of the Papsque", snippet: "Enter Bostaunieux Oubliette", wrong: null, right: "E-7", zone: "Bostaunieux Oubliette", mapNo: 1, occurrence: 0 },
  { page: "Prestige of the Papsque", snippet: "Enter Bostaunieux Oubliette", wrong: null, right: "E-8", zone: "Bostaunieux Oubliette", mapNo: 1, occurrence: 0 },
  { page: "Prestige of the Papsque", snippet: "Hug the right wall", wrong: null, right: "E-8", zone: "West Ronfaure", mapNo: 1, occurrence: 1 },
  { page: "The Secret Weapon", snippet: "Yughott Grotto Home Point", wrong: null, right: "J-6", zone: "Yughott Grotto", mapNo: 2, replace: true },
  { page: "Coming of Age", snippet: "H-10 entrance", wrong: null, right: "H-10", zone: "Eastern Altepa Desert", mapNo: 1, replace: true },
  { page: "Coming of Age", snippet: "Now head west to D-9", wrong: null, right: "D-9", zone: "Quicksand Caves", mapNo: 2 },
  { page: "Lightbringer", snippet: "main entrance of the temple", wrong: null, right: "J-12", zone: "Yhoator Jungle", mapNo: 1 },
  { page: "Lightbringer", snippet: "zone into the Temple", wrong: null, right: "F-5", zone: "Temple of Uggalepih", mapNo: 1 },
  { page: "Lightbringer", snippet: "\"T\" intersection", wrong: null, right: "H-10", zone: "Temple of Uggalepih", mapNo: 2 },
  { page: "Breaking Barriers", snippet: "proceed to a ???", wrong: null, right: "I-8", zone: "Valley of Sorrows", mapNo: 1 },
  { page: "Breaking Barriers", snippet: "Key Item #1", wrong: null, right: "I-8", zone: "Valley of Sorrows", mapNo: 1 },
  { page: "Breaking Barriers", snippet: "use the Lever", wrong: null, right: "H-8", zone: "The Eldieme Necropolis", mapNo: 1 },
  { page: "Breaking Barriers", snippet: "use the Lever", wrong: null, right: "G-9", zone: "The Eldieme Necropolis", mapNo: 1 },
  { page: "Breaking Barriers", snippet: "drop down the hole", wrong: null, right: "G-9", zone: "The Eldieme Necropolis", mapNo: 1 },
  { page: "Wading Beasts", snippet: "Chomo Jinjahl", wrong: null, right: "E-8", zone: "Windurst Waters", mapNo: 2, replace: true },
  { page: "The Emissary", snippet: "Eyy Mon the Ironbreaker", wrong: null, right: "G-7", zone: "Giddeus", mapNo: 2 },
  { page: "The Emissary", snippet: "Enter Fort Ghelsba", wrong: "K-5", right: "J-7", zone: "Fort Ghelsba", mapNo: 1, replace: true },
  { page: "The Emissary", snippet: "Enter Horlais Peak", wrong: null, right: "J-6", zone: "Yughott Grotto", mapNo: 2 },
  { page: "The Emissary", snippet: "Yughott Grotto via exit 1", wrong: null, right: "H-11", zone: "Ghelsba Outpost", mapNo: 1 },
  { page: "The Emissary", snippet: "Yughott Grotto via exit 4", wrong: null, right: "J-8", zone: "Fort Ghelsba", mapNo: 1 },
  { page: "To the Forsaken Mines", snippet: "sells hare meat", wrong: null, right: "E-8", zone: "Windurst Waters", mapNo: 2, replace: true },
  { page: "Appointment to Jeuno", snippet: "tractored through the Cermet Door", wrong: null, right: "E-8", zone: "Lower Delkfutt's Tower", mapNo: 1, replace: true },
  { page: "Appointment to Jeuno", snippet: "Enter the basement through the Cermet Door", wrong: null, right: "E-8", zone: "Lower Delkfutt's Tower", mapNo: 1, replace: true },
  { page: "Appointment to Jeuno", snippet: "Once in the basement, cross the large room", wrong: "M-8", right: "L-9", zone: "Lower Delkfutt's Tower", mapNo: 0, replace: true },
  // Bastok 3-3 "Jeuno (Mission)": same tower route as San d'Oria 3-3 but a separate wiki page with no tooltips
  { page: "Jeuno (Mission)", snippet: "enter the basement stairway through the Cermet Door", wrong: null, right: "E-8", zone: "Lower Delkfutt's Tower", mapNo: 1, replace: true },
  { page: "Jeuno (Mission)", snippet: "Tractored through the door", wrong: null, right: "E-8", zone: "Lower Delkfutt's Tower", mapNo: 1, replace: true },
  { page: "Jeuno (Mission)", snippet: "click on the Cermet Door at L-9", wrong: null, right: "L-9", zone: "Lower Delkfutt's Tower", mapNo: 0 },
  { page: "Jeuno (Mission)", snippet: "small room at L-9 and trade", wrong: null, right: "L-9", zone: "Lower Delkfutt's Tower", mapNo: 0 },
  { page: "Jeuno (Mission)", snippet: "1st Floor: E-6", wrong: null, right: "E-6", zone: "Lower Delkfutt's Tower", mapNo: 1 },
  { page: "Jeuno (Mission)", snippet: "1st Floor: E-6", wrong: null, right: "F-6", zone: "Lower Delkfutt's Tower", mapNo: 1 },
  { page: "Jeuno (Mission)", snippet: "2nd Floor: I-9", wrong: null, right: "I-9", zone: "Lower Delkfutt's Tower", mapNo: 2 },
  { page: "Jeuno (Mission)", snippet: "2nd Floor: I-9", wrong: null, right: "J-9", zone: "Lower Delkfutt's Tower", mapNo: 2 },
  { page: "Jeuno (Mission)", snippet: "2nd Floor: I-9", wrong: null, right: "H-9", zone: "Lower Delkfutt's Tower", mapNo: 2 },
  { page: "Jeuno (Mission)", snippet: "3rd Floor: G-6", wrong: null, right: "G-6", zone: "Lower Delkfutt's Tower", mapNo: 3 },
  { page: "Jeuno (Mission)", snippet: "4th Floor: I-6", wrong: null, right: "I-6", zone: "Middle Delkfutt's Tower", mapNo: 4 },
  { page: "Jeuno (Mission)", snippet: "4th Floor: I-6", wrong: null, right: "G-7", zone: "Middle Delkfutt's Tower", mapNo: 4 },
  { page: "Jeuno (Mission)", snippet: "4th Floor: I-6", wrong: null, right: "H-9", zone: "Middle Delkfutt's Tower", mapNo: 4 },
  { page: "Jeuno (Mission)", snippet: "4th Floor: I-6", wrong: null, right: "J-9", zone: "Middle Delkfutt's Tower", mapNo: 4 },
  { page: "Jeuno (Mission)", snippet: "5th Floor: H-9", wrong: null, right: "H-9", zone: "Middle Delkfutt's Tower", mapNo: 5 },
  { page: "Jeuno (Mission)", snippet: "5th Floor: H-9", wrong: null, right: "I-10", zone: "Middle Delkfutt's Tower", mapNo: 5 },
  { page: "Jeuno (Mission)", snippet: "6th Floor: J-10", wrong: null, right: "J-10", zone: "Middle Delkfutt's Tower", mapNo: 6 },
  { page: "Jeuno (Mission)", snippet: "7th Floor: F-6", wrong: null, right: "F-6", zone: "Middle Delkfutt's Tower", mapNo: 7 },
  { page: "Jeuno (Mission)", snippet: "8th Floor: (1st time)", wrong: null, right: "I-6", zone: "Middle Delkfutt's Tower", mapNo: 8 },
  { page: "Jeuno (Mission)", snippet: "9th Floor: (1st time)", wrong: null, right: "J-10", zone: "Middle Delkfutt's Tower", mapNo: 9 },
  { page: "Jeuno (Mission)", snippet: "9th Floor: (1st time)", wrong: null, right: "H-10", zone: "Middle Delkfutt's Tower", mapNo: 8 },
  { page: "Jeuno (Mission)", snippet: "8th Floor: (2nd time)", wrong: null, right: "F-9", zone: "Middle Delkfutt's Tower", mapNo: 8 },
  { page: "Jeuno (Mission)", snippet: "8th Floor: (2nd time)", wrong: null, right: "G-10", zone: "Middle Delkfutt's Tower", mapNo: 8 },
  { page: "Jeuno (Mission)", snippet: "9th Floor: (2nd time)", wrong: null, right: "F-6", zone: "Middle Delkfutt's Tower", mapNo: 9 },
  { page: "Jeuno (Mission)", snippet: "fight Porphyrion at H-8", wrong: null, right: "H-8", zone: "Upper Delkfutt's Tower", mapNo: 10 },
  { page: "The Pirate's Cove", snippet: "lava puddle", wrong: null, right: "H-7", zone: "Ifrit's Cauldron", mapNo: 1 },
  { page: "The Chains That Bind Us", snippet: "through the caves to (K-8)", wrong: null, right: "K-8", zone: "Quicksand Caves", mapNo: 4 },
  { page: "The Rites of Life", snippet: "Tales' Beginning", wrong: null, right: "H-10", zone: "Lower Delkfutt's Tower", mapNo: 1, replace: true },
  { page: "The Road Forks", snippet: "Timbre Timbers Tavern", wrong: null, right: "F-10", zone: "Windurst Waters", mapNo: 2, replace: true },
  { page: "The Road Forks", snippet: "Tosuka-Porika", wrong: null, right: "G-8", zone: "Windurst Waters", mapNo: 2, replace: true },
  { page: "Slanderous Utterings", snippet: "Talk to Despachiaire", wrong: null, right: "K-9", zone: "Tavnazian Safehold", mapNo: 2, replace: true },
  { page: "Slanderous Utterings", snippet: "Talk to Despachiaire", wrong: null, right: "K-10", zone: "Tavnazian Safehold", mapNo: 2, replace: true },
  { page: "Slanderous Utterings", snippet: "Enter Sealion's Den", wrong: "H-9", right: "H-10", zone: "Tavnazian Safehold", mapNo: 3, replace: true },
  // ToAU 2 Dvucca Isle route: prose zone inference mislabels the Arrapago Reef legs
  { page: "Aht Urhgan Mission 2: Immortal Sentries", snippet: "Head to C-10 on second map", wrong: null, right: "C-10", zone: "Arrapago Reef", mapNo: 2 },
  { page: "Aht Urhgan Mission 2: Immortal Sentries", snippet: "Head to I-11 on third map", wrong: null, right: "I-11", zone: "Arrapago Reef", mapNo: 3 },
  { page: "Aht Urhgan Mission 2: Immortal Sentries", snippet: "Go through iron gate at H-11", wrong: null, right: "H-11", zone: "Arrapago Reef", mapNo: 3, replace: true },
  { page: "Aht Urhgan Mission 2: Immortal Sentries", snippet: "Exit out to Caedarva Mire (I-10)", wrong: null, right: "I-10", zone: "Caedarva Mire", mapNo: 2 },
  // ToAU 2 Mamool Ja route: coords sit in the zone being left, not the one being entered
  { page: "Aht Urhgan Mission 2: Immortal Sentries", snippet: "until E-12 and enter Mamook", wrong: null, right: "E-12", zone: "Wajaom Woodlands", mapNo: 1, replace: true },
  { page: "Aht Urhgan Mission 2: Immortal Sentries", snippet: "until F-10 and enter Bhaflau Thickets", wrong: null, right: "F-10", zone: "Mamook", mapNo: 1, replace: true },
  { page: "Aht Urhgan Mission 2: Immortal Sentries", snippet: "Head south to H-11", wrong: null, right: "H-11", zone: "Bhaflau Thickets", mapNo: 2 },
  // ToAU 9: the staging-point route steps never name the zone; I-9 is on the Nyzul hub map
  { page: "Aht Urhgan Mission 9: Undersea Scouting", snippet: "west to the room at (I-9)", wrong: null, right: "I-9", zone: "Alzadaal Undersea Ruins", mapNo: 8 },
  // ToAU 31 battlefield is in Periqia; the wiki's Periqia/Maps gallery tags this mission as map 6
  { page: "Aht Urhgan Mission 31: Shades of Vengeance", snippet: "K23H1-LAMIAE. They are located at (H-9)", wrong: null, right: "H-9", zone: "Periqia", mapNo: 6 },
  // Windurst 1-1: the tower entrance is outside, in East Sarutabaruta
  { page: "The Horutoto Ruins Experiment", snippet: "Go to the entrance (#5) to the Inner Horutoto Ruins at J-7", wrong: null, right: "J-7", zone: "East Sarutabaruta", mapNo: 1, replace: true },
  // Windurst 2-1: the Optistery/Tonana are on Waters North (map 2); the Mahogany Door leg is Inner Horutoto map 2
  { page: "Lost for Words", snippet: "Talk to Tosuka-Porika in the Optistery", wrong: null, right: "G-8", zone: "Windurst Waters", mapNo: 2 },
  { page: "Lost for Words", snippet: "Take the warp from Tonana (G-8)", wrong: null, right: "G-8", zone: "Windurst Waters", mapNo: 2 },
  { page: "Lost for Words", snippet: "Beetle's Burrow at (K-9)", wrong: null, right: "K-9", zone: "Inner Horutoto Ruins", mapNo: 2 },
  { page: "Lost for Words", snippet: "Head to (G-8) (the tunnel extension", wrong: null, right: "G-8", zone: "Inner Horutoto Ruins", mapNo: 2 },
  { page: "Lost for Words", snippet: "Go west from (K-9)", wrong: null, right: "K-9", zone: "Inner Horutoto Ruins", mapNo: 2 },
  { page: "Lost for Words", snippet: "At (I-9), take the west tunnel", wrong: null, right: "I-9", zone: "Inner Horutoto Ruins", mapNo: 2 },
  { page: "Lost for Words", snippet: "Click on the Mahogany Door at (G-8)", wrong: null, right: "G-8", zone: "Inner Horutoto Ruins", mapNo: 2 },
  { page: "Lost for Words", snippet: "Return to (G-8) Tosuka-Porika", wrong: null, right: "G-8", zone: "Windurst Waters", mapNo: 2, replace: true },
  // Windurst 2-2: the Aurastery is on Waters North (map 2)
  { page: "A Testing Time", snippet: "Moreno-Toeno (inside the Aurastery)", wrong: null, right: "L-6", zone: "Windurst Waters", mapNo: 2 },
  // Windurst 3-2: wiki's "Rose Tower Map 2" is our Inner Horutoto map 4; Three Mage Gate room is map 3
  { page: "Written in the Stars", snippet: "Gate of Light\" located at Inner Horutoto Ruins (G-7)", wrong: null, right: "G-7", zone: "Inner Horutoto Ruins", mapNo: 4 },
  { page: "Written in the Stars", snippet: "Make your way to (E-10)", wrong: null, right: "E-10", zone: "Inner Horutoto Ruins", mapNo: 2 },
  { page: "Written in the Stars", snippet: "Cracked Door at (D-10)", wrong: null, right: "D-10", zone: "Inner Horutoto Ruins", mapNo: 2 },
  { page: "Written in the Stars", snippet: "large room at (H-9)", wrong: null, right: "H-9", zone: "Inner Horutoto Ruins", mapNo: 3 },
  { page: "Written in the Stars", snippet: "head over to the small room in (G-7)", wrong: null, right: "G-7", zone: "Inner Horutoto Ruins", mapNo: 4 },
  { page: "Written in the Stars", snippet: "east room at (H-6)", wrong: null, right: "H-6", zone: "Inner Horutoto Ruins", mapNo: 4 },
  // Windurst 6-1 route 4: same Three Mage Gate corridor (maps 2/3) up to the canal door on map 4
  { page: "Full Moon Fountain (Mission)", snippet: "head to the Gate: Magical Gizmo at (J-8)", wrong: null, right: "J-8", zone: "Outer Horutoto Ruins", mapNo: 4 },
  { page: "Full Moon Fountain (Mission)", snippet: "Magic Gate of Horutoto at (E-10)", wrong: null, right: "E-10", zone: "Inner Horutoto Ruins", mapNo: 2 },
  { page: "Full Moon Fountain (Mission)", snippet: "Cracked Wall at (D-10)", wrong: null, right: "D-10", zone: "Inner Horutoto Ruins", mapNo: 2 },
  { page: "Full Moon Fountain (Mission)", snippet: "Three Mage Gate at (H-9)", wrong: null, right: "H-9", zone: "Inner Horutoto Ruins", mapNo: 3 },
  { page: "Full Moon Fountain (Mission)", snippet: "Through false wall at (H-8)", wrong: null, right: "H-8", zone: "Inner Horutoto Ruins", mapNo: 3 },
  { page: "Full Moon Fountain (Mission)", snippet: "Toraimarai Canal door is at (H-6)", wrong: null, right: "H-6", zone: "Inner Horutoto Ruins", mapNo: 4 },
  // Windurst 7-1 / 8-1 / 8-2: Optistery & Aurastery are on Waters North (map 2); Gate of Darkness is on Rose Tower (map 4)
  { page: "The Sixth Ministry", snippet: "Tosuka-Porika at the Optistery in Northern Windurst Waters (G-8)", wrong: null, right: "G-8", zone: "Windurst Waters", mapNo: 2 },
  { page: "Vain", snippet: "at (L-6) for a cutscene and the key item Star Seeker", wrong: null, right: "L-6", zone: "Windurst Waters", mapNo: 2 },
  { page: "Vain", snippet: "at (L-6) to complete the mission", wrong: null, right: "L-6", zone: "Windurst Waters", mapNo: 2 },
  { page: "The Jester Who'd Be King", snippet: "Optistery Ring at Optistery, East Wing", wrong: null, right: "G-8", zone: "Windurst Waters", mapNo: 2 },
  { page: "The Jester Who'd Be King", snippet: "on the next map, to the Cracked Wall at (G-8)", wrong: null, right: "G-8", zone: "Outer Horutoto Ruins", mapNo: 5 },
  { page: "The Jester Who'd Be King", snippet: "At (I-7) on the fourth map", wrong: null, right: "I-7", zone: "Inner Horutoto Ruins", mapNo: 4 },
  { page: "The Jester Who'd Be King", snippet: "Check the Gate of Darkness at (I-7)", wrong: null, right: "I-7", zone: "Inner Horutoto Ruins", mapNo: 4 },
  { page: "The Warrior's Path", snippet: "landed at E-12", wrong: null, right: "E-12", zone: "Al'Taieu", mapNo: 1 },
  { page: "Garden of Antiquity", snippet: "Crystalline Field door", wrong: null, right: "H-11", zone: "Al'Taieu", mapNo: 1, replace: true },
  { page: "Garden of Antiquity", snippet: "Auroral Updraft", wrong: null, right: "H-12", zone: "Al'Taieu", mapNo: 1, replace: true },
  { page: "Garden of Antiquity", snippet: "Southern Tower", wrong: null, right: "H-13", zone: "Al'Taieu", mapNo: 1, replace: true },
  { page: "Garden of Antiquity", snippet: "Western Tower", wrong: null, right: "D-10", zone: "Al'Taieu", mapNo: 1, replace: true },
  { page: "Garden of Antiquity", snippet: "Eastern Tower", wrong: null, right: "L-10", zone: "Al'Taieu", mapNo: 1, replace: true },
  { page: "Garden of Antiquity", snippet: "forgot to get the first cutscene", wrong: null, right: "H-11", zone: "Al'Taieu", mapNo: 1, replace: true },
  { page: "Garden of Antiquity", snippet: "all three towers", wrong: null, right: "H-11", zone: "Al'Taieu", mapNo: 1, replace: true },
  { page: "Garden of Antiquity", snippet: "Gate of the Gods", wrong: null, right: "H-8", zone: "Grand Palace of Hu'Xzoi", mapNo: 3, replace: true },
  { page: "A Fate Decided", snippet: "first NPC spawns at J-6", wrong: "J-6", right: "J-8", zone: "Grand Palace of Hu'Xzoi", mapNo: 1, replace: true },
  { page: "When Angels Fall", snippet: "proceed to the elevator", wrong: null, right: "H-8", zone: "The Garden of Ru'Hmet", mapNo: 1 },
  { page: "When Angels Fall", snippet: "Particle Gate (H-8 of Map 3)", wrong: null, right: "H-8", zone: "The Garden of Ru'Hmet", mapNo: 3 },
  { page: "Storms of Fate", snippet: "waypoint to travel to C-10", wrong: null, right: "C-10", zone: "Riverne - Site B01", mapNo: 1 },
  { page: "Storms of Fate", snippet: "normal\" Unstable Displacement", wrong: null, right: "G-8", zone: "Riverne - Site B01", mapNo: 1 },
  { page: "Storms of Fate", snippet: "green Unstable Displacement", wrong: null, right: "E-7", zone: "Riverne - Site B01", mapNo: 1 },
  { page: "Shadows of the Departed", snippet: "To get to Promyvion - Holla", wrong: null, right: "J-8", zone: "La Theine Plateau", mapNo: 1 },
  { page: "Shadows of the Departed", snippet: "To get to Promyvion - Dem", wrong: null, right: "I-7", zone: "Konschtat Highlands", mapNo: 1 },
  { page: "Shadows of the Departed", snippet: "To get to Promyvion - Mea", wrong: null, right: "I-6", zone: "Tahrongi Canyon", mapNo: 1 },
];

// Section headings that refer to maps without a coordinate in their body.
const HEADING_MAPS = {
  "The Mothercrystals": {
    "Promyvion - Mea": "Promyvion - Mea",
    "Promyvion - Dem": "Promyvion - Dem",
    "Promyvion - Holla": "Promyvion - Holla",
  },
  "When Angels Fall": {
    "Part I": "The Garden of Ru'Hmet",
    "Part II": "The Garden of Ru'Hmet",
    "Part III": "The Garden of Ru'Hmet",
  },
};

const WILDCAT_SECTIONS = {
  "Lure of the Wildcat (Bastok)": [
    [";Port Bastok", "Port Bastok"],
    [";Metalworks", "Metalworks"],
    [";Bastok Markets", "Bastok Markets"],
    [";Bastok Mines", "Bastok Mines"],
  ],
  "Lure of the Wildcat (Jeuno)": [
    [";Ru'Lude Gardens", "Ru'Lude Gardens"],
    [";Upper Jeuno", "Upper Jeuno"],
    [";Lower Jeuno", "Lower Jeuno"],
    [";Port Jeuno", "Port Jeuno"],
  ],
  "Lure of the Wildcat (San d'Oria)": [
    [";Southern San d'Oria", "Southern San d'Oria"],
    [";Northern San d'Oria", "Northern San d'Oria"],
    [";Port San d'Oria", "Port San d'Oria"],
    [";Chateau d'Oraguille", "Chateau d'Oraguille"],
  ],
  "Lure of the Wildcat (Windurst)": [
    [";Windurst Woods", "Windurst Woods"],
    [";Windurst Walls", "Windurst Walls"],
    [";Windurst Waters", "Windurst Waters", 2],
    [";Port Windurst", "Port Windurst"],
  ],
};

const SUMMARY_OVERRIDES = {
  "The Last Verse": "This is the last chapter in both the Chains of Promathia and Rise of the Zilart storylines. It is automatically activated after finishing Apocalypse Nigh. It does not have a mission description and simply signifies that you have finished the storylines.",
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(base, params) {
  const url = `${base}?${new URLSearchParams({ format: "json", formatversion: "2", ...params })}`;
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      if (attempt >= 4) throw new Error(`${url}\n  -> ${e.message}`);
      await sleep(1000 * attempt);
    }
  }
}

/** All page titles in a category (paginated), optionally recursing one level into subcats. */
async function categoryPages(base, cat, depth = 0) {
  const titles = [];
  let cmcontinue;
  do {
    const q = await api(base, {
      action: "query", list: "categorymembers", cmtitle: `Category:${cat}`,
      cmnamespace: "0", cmlimit: "500", ...(cmcontinue ? { cmcontinue } : {}),
    });
    for (const m of q.query?.categorymembers ?? []) {
      if (m.title.startsWith("Category:")) {
        if (depth > 0) titles.push(...(await categoryPages(base, m.title.replace(/^Category:/, ""), depth - 1)));
      } else if (!SKIP_TITLES.has(m.title) && !SKIP_RE.test(m.title) && !m.title.includes("/")) {
        titles.push(m.title);
      }
    }
    cmcontinue = q.continue?.cmcontinue;
    await sleep(120);
  } while (cmcontinue);
  return [...new Set(titles)];
}

/** Fetch raw wikitext for many titles. Returns Map(title -> wikitext), following redirects. */
async function fetchPages(base, titles) {
  const out = new Map();
  const redirects = new Map();
  for (let i = 0; i < titles.length; i += 50) {
    const batch = titles.slice(i, i + 50);
    const q = await api(base, {
      action: "query", prop: "revisions", rvprop: "content", rvslots: "main",
      redirects: "1", titles: batch.join("|"),
    });
    for (const r of q.query?.redirects ?? []) redirects.set(r.from, r.to);
    for (const p of q.query?.pages ?? []) {
      if (!p.missing && p.revisions?.[0]) out.set(p.title, p.revisions[0].slots.main.content);
    }
    process.stdout.write(`\r  ${Math.min(i + 50, titles.length)}/${titles.length} pages fetched from ${new URL(base).hostname}   `);
    await sleep(150);
  }
  process.stdout.write("\n");
  // Map original (redirecting) titles to their target content too
  for (const [from, to] of redirects) if (out.has(to)) out.set(from, out.get(to));
  return { pages: out, redirects };
}

// ---------------------------------------------------------------------------
// Wikitext parsing
// ---------------------------------------------------------------------------

/** Split template params into { positional: [...], named: {...} }. */
function templateParams(body) {
  const positional = [];
  const named = {};
  for (const part of body.split("|")) {
    const eq = part.indexOf("=");
    if (eq >= 0) named[part.slice(0, eq).trim().toLowerCase()] = part.slice(eq + 1).trim();
    else if (part.trim()) positional.push(part.trim());
  }
  return { positional, named };
}

/** Strip wiki markup down to plain text (keeps "(H-9)" style coords intact). */
function plain(wt) {
  if (!wt) return "";
  let s = wt;
  s = s.replace(/<!--[\s\S]*?-->/g, "");
  s = s.replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, "").replace(/<ref[^>]*\/>/gi, "");
  s = s.replace(/<br\s*\/?>/gi, "\n");
  // File captions can nest links: [[File:x.png|thumb|[[Ulrich]] reports...]]
  s = s.replace(/\[\[(?:File|Image|Category|de|fr|ja|es):(?:[^[\]]|\[\[[^\]]*\]\])*\]\]/gi, "");
  // Hover-map templates -> readable coords: {{Location Tooltip|area=Norg|pos=K-8}} -> (K-8)
  // (text= params may contain lone braces: text={Port Bastok J-5 house})
  const tmplBody = "((?:[^{}]|\\{(?!\\{)|\\}(?!\\}))*)";
  s = s.replace(new RegExp(`\\{\\{\\s*Location Tooltip\\s*\\|${tmplBody}\\}\\}`, "gi"), (_, body) => {
    const { positional, named } = templateParams(body);
    if (named.text) return named.text.replace(/[{}]/g, "");
    const pos = named.pos ?? positional[1];
    const area = named.area ?? positional[0];
    return pos ? `(${pos})` : area ?? "";
  });
  // {{Location|Norg|L-8}} -> Norg (L-8)
  s = s.replace(new RegExp(`\\{\\{\\s*Location\\s*\\|${tmplBody}\\}\\}`, "gi"), (_, body) => {
    const { positional, named } = templateParams(body);
    const area = named.area ?? positional[0] ?? "";
    const pos = named.pos ?? positional[1];
    return pos ? `${area} (${pos})` : area;
  });
  // [[target|label]] -> label, [[target]] -> target (repeat for nesting)
  for (let i = 0; i < 3; i++) s = s.replace(/\[\[([^[\]|]*)\|([^[\]]*)\]\]/g, "$2").replace(/\[\[([^[\]]*)\]\]/g, "$1");
  s = s.replace(/\{\{sic[^}]*\}\}/gi, "");
  for (let i = 0; i < 3; i++) s = s.replace(/\{\{[^{}]*\}\}/g, ""); // drop remaining templates
  s = s.replace(/'''''|'''|''/g, "");
  s = s.replace(/<[^>]+>/g, "");
  s = s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'");
  s = s.replace(/\(\s*\(([^()]*)\)\s*\)/g, "($1)"); // collapse ((K-8)) from pre-parenthesized templates
  return s.replace(/[ \t]+/g, " ").replace(/ ?\n ?/g, "\n").trim();
}

/** Extract [[link]] targets+labels from a wikitext fragment. */
function links(wt) {
  const out = [];
  const re = /\[\[([^[\]|]+)(?:\|([^[\]]*))?\]\]/g;
  let m;
  while ((m = re.exec(wt ?? ""))) {
    const target = m[1].trim();
    if (/^(?:File|Image|Category|de|fr|ja|es):/i.test(target)) continue;
    out.push({ target, label: (m[2] ?? m[1]).trim() });
  }
  return out;
}

const FIELD_ALIASES = {
  "start npc": "startNpc", "starting npc": "startNpc", "client": "client",
  "requirements": "requirements", "prerequisites": "requirements", "level restriction": "level",
  "suggested level": "level", "level": "level",
  "items needed": "items", "items": "items", "key items": "keyItems", "key item": "keyItems",
  "title": "titles", "titles": "titles", "title obtained": "titles",
  "repeatable": "repeatable", "reward": "reward", "rewards": "reward",
  "previous quest": "previous", "previous mission": "previous", "previous": "previous",
  "next quest": "next", "next mission": "next", "next": "next",
  "mission name": "missionName", "mission": "missionName", "name": "missionName",
  "recruitment": "level", "assault rank": "assaultRank", "rank": "assaultRank",
  "objective": "objective", "mercenary rank": "assaultRank",
  "starting point": "startNpc", "staging point": "stagingPoint",
};

/** Parse the classic colored info-table: cells of '''Field:''' followed by a value cell. */
function parseInfoTable(wt) {
  const fields = {};
  const lines = wt.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const cell = lines[i];
    if (!cell.startsWith("|")) continue;
    const m = cell.match(/'''\s*([^':]+?)\s*:?\s*'''/);
    if (!m) continue;
    const key = FIELD_ALIASES[m[1].trim().toLowerCase()];
    if (!key) continue;
    // Value: same line after ||, or the next |-cell line
    let value = null;
    const dbl = cell.split("||");
    if (dbl.length > 1) value = dbl.slice(1).join("||");
    else {
      for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
        const l = lines[j];
        if (l.startsWith("|-") || l.startsWith("|}") || l.startsWith("{|")) break;
        if (l.startsWith("|")) { value = l; break; }
      }
    }
    if (value == null) continue;
    // Strip cell attributes ("| valign=... |&nbsp;&nbsp;VALUE")
    let v = value.replace(/^\|/, "");
    const attr = v.match(/^[^[\]{}|]*(?:valign|bgcolor|width|align|style)\s*=[^|]*\|/i);
    if (attr) v = v.slice(attr[0].length);
    if (!(key in fields)) fields[key] = v.trim();
  }
  return fields;
}

/** Parse {{Quest|param=...}} / {{Mission|...}} style templates. */
function parseTemplate(wt) {
  const m = wt.match(/\{\{\s*(?:Quest|Mission|Infobox[^|}]*)\s*\|/i);
  if (!m) return null;
  // Brace-match the template body
  let depth = 0, start = m.index, end = -1;
  for (let i = start; i < wt.length - 1; i++) {
    if (wt[i] === "{" && wt[i + 1] === "{") { depth++; i++; }
    else if (wt[i] === "}" && wt[i + 1] === "}") { depth--; i++; if (depth === 0) { end = i + 1; break; } }
  }
  if (end < 0) return null;
  const body = wt.slice(start + 2, end - 2);
  // Split on top-level pipes
  const parts = [];
  let level = 0, cur = "";
  for (let i = 0; i < body.length; i++) {
    const two = body.slice(i, i + 2);
    if (two === "{{" || two === "[[") { level++; cur += two; i++; }
    else if (two === "}}" || two === "]]") { level--; cur += two; i++; }
    else if (body[i] === "|" && level === 0) { parts.push(cur); cur = ""; }
    else cur += body[i];
  }
  parts.push(cur);
  const fields = {};
  const TMPL_ALIASES = {
    startnpc: "startNpc", npc: "startNpc", requirements: "requirements", items: "items", keyitems: "keyItems",
    title: "titles", titles: "titles", repeatable: "repeatable", reward: "reward", rewards: "reward",
    previous: "previous", next: "next", level: "level", name: "missionName", number: "missionNumber",
  };
  for (const p of parts.slice(1)) {
    const eq = p.indexOf("=");
    if (eq < 0) continue;
    const key = TMPL_ALIASES[p.slice(0, eq).trim().toLowerCase()];
    const val = p.slice(eq + 1).trim();
    if (key && val && !(key in fields)) fields[key] = val;
  }
  return Object.keys(fields).length ? fields : null;
}

/** Walkthrough section -> array of step strings ("## " prefix = sub-heading). */
/** {{Location}}/{{Location Tooltip}} references in a wikitext fragment: zone + sub-map + position. */
// Wiki names some sub-maps instead of numbering them (map=Surface, map=North); matches fetch-maps numbering
const NAMED_MAP_NOS = { surface: 1, tunnels: 2, south: 1, north: 2 };
function locRefs(wt) {
  const out = [];
  const re = /\{\{\s*Location(?: Tooltip)?\s*\|((?:[^{}]|\{(?!\{)|\}(?!\}))*)\}\}/gi;
  let m;
  while ((m = re.exec(wt ?? ""))) {
    const { positional, named } = templateParams(m[1]);
    const zone = plain(named.area ?? positional[0] ?? "").trim();
    const pos = (named.pos ?? positional[1] ?? "").trim().toUpperCase();
    const mapNo = named.map
      ? (parseInt(named.map.match(/\d+/)?.[0] ?? "", 10) || null) ?? NAMED_MAP_NOS[named.map.trim().toLowerCase()] ?? null
      : null;
    if (zone && /^[A-P]-\d{1,2}$/.test(pos)) out.push({ zone, mapNo, pos });
  }
  return out;
}

const ORDINALS = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8 };

/** Fill in missing map numbers from prose like "(H-7) on the second map" / "on Map 2 at (F-7)". */
function inferMapNos(text, refs) {
  const mapNo = (s, last) => {
    const re = /\b(?:(first|second|third|fourth|fifth|sixth|seventh|eighth)\s+map|map\s*#?\s*(\d+)|(\d+)(?:st|nd|rd|th)\s+map)\b/gi;
    const hits = [...s.matchAll(re)];
    const m = last ? hits[hits.length - 1] : hits[0];
    if (!m) return null;
    return m[1] ? ORDINALS[m[1].toLowerCase()] : parseInt(m[2] ?? m[3], 10) || null;
  };
  let from = 0, prevEnd = 0;
  for (const ref of refs) {
    const at = text.indexOf(ref.pos, from);
    if (at < 0) continue;
    from = at + ref.pos.length;
    if (ref.mapNo != null) { prevEnd = from; continue; }
    // Prefer a qualifier after the coord, else one shortly before it ("on Map 2 at (G-10)")
    const nextIdx = refs.map((r) => text.indexOf(r.pos, from)).filter((i) => i > 0);
    const after = text.slice(from, nextIdx.length ? Math.min(...nextIdx) : from + 90);
    const before = text.slice(Math.max(prevEnd, at - 40), at);
    ref.mapNo = mapNo(after, false) ?? mapNo(before, true);
    prevEnd = from;
  }
  return refs;
}

function parseWalkthrough(wt) {
  const m = wt.match(/^=+\s*Walkthrough\s*=+\s*$/im);
  if (!m) return { steps: [], stepRefs: [] };
  const rest = wt.slice(m.index + m[0].length);
  const endM = rest.match(/^=+\s*(?:Game Description|Game description|Description|Trivia|See Also|Notes)\s*=+\s*$|\{\{(?:Quest|Mission)\/Description/im);
  const body = endM ? rest.slice(0, endM.index) : rest;
  const steps = [];
  const stepRefs = [];
  for (const raw of body.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("__") || /^\[\[(?:Category|de|fr|ja|es):/i.test(line)) continue;
    if (/^(\{\||\|)/.test(line)) continue; // table syntax (dialogue transcripts etc.)
    const h = line.match(/^=+\s*(.+?)\s*=+$/);
    if (h) { steps.push("## " + plain(h[1])); continue; }
    const b = line.match(/^([*#:]+)\s*(.*)$/);
    const depth = b ? Math.max(0, b[1].length - 1) : 0;
    const text = plain(b ? b[2] : line);
    if (!text || text.includes("{{") || text.includes("}}")) continue; // unparsed multi-line template
    if (/^(?:File|Image):/i.test(text)) continue; // gallery entries, not steps
    for (const r of inferMapNos(text, locRefs(b ? b[2] : line))) stepRefs.push({ step: steps.length, ...r });
    steps.push("  ".repeat(depth) + text);
  }
  return { steps, stepRefs };
}

/** Game description (client + summary), from section or template. */
function parseDescription(wt) {
  const t = wt.match(/\{\{(?:Quest|Mission)\/Description\s*\|([\s\S]*?)\}\}/i);
  if (t) {
    const client = t[1].match(/client\s*=\s*([^|\n]*)/i);
    const summary = t[1].match(/(?:summary|orders)\s*=\s*([\s\S]*?)(?:\n\s*\||$)/i);
    return { client: client ? plain(client[1]) : null, summary: summary ? plain(summary[1]) : null };
  }
  const m = wt.match(/^=+\s*Game Description\s*=+\s*$/im);
  if (!m) return { client: null, summary: null };
  const body = wt.slice(m.index + m[0].length).split(/^=+[^=]+=+$/m)[0];
  const client = body.match(/'''Client:?'''\s*(.*)/i);
  const sum = body.match(/'''(?:Summary|Mission Orders):?'''\s*([\s\S]*)/i);
  return {
    client: client ? plain(client[1]) : null,
    summary: sum ? plain(sum[1]).replace(/^:?\s*/, "").split("\n").join(" ").trim() || null : null,
  };
}

const COORD_RE = /\(([A-P]-\d{1,2})\)/g;

function parseStartNpc(raw) {
  if (!raw) return { npc: null, zone: null, coord: null };
  const ls = links(raw);
  const text = plain(raw);
  const coord = text.match(/\(([A-P]-\d{1,2})\)/)?.[1] ?? null;
  // Convention: first link = NPC, second = zone; {{Location}} zones aren't links, so fall back to text
  const npc = ls[0]?.label ?? (text.split(/[-–]/)[0].trim() || null);
  const zone = ls[1]?.label ?? text.match(/[-–]\s*([^(\n,]+?)\s*(?:\(|,|\n|$)/)?.[1]?.trim() ?? null;
  return { npc, zone: zone || null, coord };
}

function parseFame(raw) {
  if (!raw) return { fame: null, fameArea: null };
  const m = raw.match(/(?:\[\[)?([A-Za-z' .]+?)(?:\]\])?\s*(?:\[\[)?(?:Fame|Reputation)(?:\]\])?\s*(?:level\s*)?(\d+)/i);
  if (!m) return { fame: null, fameArea: null };
  const area = m[1]?.trim();
  return { fame: parseInt(m[2], 10), fameArea: area && area.length > 2 ? area : null };
}

function parseItems(raw) {
  if (!raw) return [];
  const out = [];
  for (const chunk of raw.split(/<br\s*\/?>|\n/i)) {
    const ls = links(chunk);
    if (ls.length) {
      const qty = plain(chunk).match(/x\s*(\d+)/i)?.[1];
      for (const l of ls) out.push(qty && ls.length === 1 ? `${l.label} x${qty}` : l.label);
    } else {
      const t = plain(chunk);
      if (t && !/^(?:none|n\/a|-)\.?$/i.test(t)) out.push(t);
    }
  }
  return out;
}

function parseChain(raw) {
  if (!raw) return [];
  const t = plain(raw);
  if (!t || /^(?:none|n\/a|-)\.?$/i.test(t)) return [];
  const ls = links(raw);
  if (ls.length) return ls.map((l) => ({ name: l.label, target: l.target }));
  return t.split(/\n|,/).map((s) => s.trim()).filter((s) => s && !/^(?:none|and)$/i.test(s)).map((name) => ({ name, target: name }));
}

function slug(title) {
  return title.toLowerCase().replace(/[''’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/** Mission number from a page/redirect title, e.g. "Bastok Mission 2-3" -> "2-3". */
function numberFromTitle(t) {
  let m = t.match(/^(?:Bastok|San d'Oria|Windurst) Mission (\d+-\d+)/i);
  if (m) return m[1];
  m = t.match(/^(?:Rise of the )?Zilart Mission (\d+)/i) ?? t.match(/^ZM(\d+)$/i);
  if (m) return m[1];
  m = t.match(/^(?:Chains of )?Promathia Mission (\d+-\d+)/i) ?? t.match(/^(?:CoP|PM) ?(\d+-\d+)$/i);
  if (m) return m[1];
  m = t.match(/^(?:Treasures of )?Aht Urhgan Mission (\d+)/i) ?? t.match(/^ToAU (\d+)$/i);
  if (m) return m[1];
  return null;
}

function parsePage(title, wt, type, group) {
  const fields = parseTemplate(wt) ?? parseInfoTable(wt);
  const { npc, zone, coord } = parseStartNpc(fields.startNpc);
  const { fame, fameArea } = parseFame(fields.requirements);
  const { steps: walkthrough, stepRefs } = parseWalkthrough(wt);
  const desc = parseDescription(wt);
  const repRaw = plain(fields.repeatable ?? "");
  const allCoords = [...new Set([...plain(wt).matchAll(COORD_RE)].map((m) => m[1]))];
  if (coord && !allCoords.includes(coord)) allCoords.unshift(coord);

  // Page-wide refs (deduped) for fallback association
  const mapRefs = [];
  const seenRef = new Set();
  for (const r of locRefs(wt)) {
    const key = `${r.zone}|${r.mapNo}|${r.pos}`;
    if (!seenRef.has(key)) { seenRef.add(key); mapRefs.push(r); }
  }

  // ToAU mission titles embed number + name: "Aht Urhgan Mission 12: Royal Puppeteer"
  let name = normTitle(title).replace(/ \((?:Quest|Mission)\)$/, "");
  let number = numberFromTitle(title);
  const toau = title.match(/^Aht Urhgan Mission (\d+): (.+)$/);
  if (toau) { number = toau[1]; name = toau[2]; }
  else if (number && fields.missionName) name = plain(fields.missionName).split("\n")[0].replace(/\s*\((?:ZM|PM|BM|SM|WM)[^)]*\)\s*$/i, "").trim() || name;
  if (!number && fields.missionNumber) number = plain(fields.missionNumber).match(/(\d+-\d+|\d+)/)?.[1] ?? null;
  const headingRefs = Object.entries(HEADING_MAPS[title] ?? {})
    .map(([heading, zone]) => ({ step: walkthrough.findIndex((s) => s === `## ${heading}`), zone }))
    .filter((ref) => ref.step >= 0);

  return {
    id: slug(title),
    name,
    pageTitle: title,
    type,
    group,
    number,
    startNpc: npc,
    startZone: zone,
    startCoord: coord,
    requirements: fields.requirements ? plain(fields.requirements).split("\n").join("; ") : null,
    fame,
    fameArea,
    level: fields.level ? plain(fields.level).split("\n").join("; ") || null : null,
    items: parseItems(fields.items),
    keyItems: parseItems(fields.keyItems),
    titles: fields.titles ? plain(fields.titles).split("\n").map((s) => s.trim()).filter((s) => s && !/^none$/i.test(s)) : [],
    repeatable: /yes/i.test(repRaw) ? true : /no/i.test(repRaw) ? false : null,
    reward: fields.reward ? plain(fields.reward).split("\n").join("; ") || null : null,
    previous: parseChain(fields.previous),
    next: parseChain(fields.next),
    walkthrough,
    client: desc.client,
    summary: SUMMARY_OVERRIDES[title] ?? desc.summary,
    coords: allCoords,
    mapRefs,
    stepRefs,
    headingRefs,
  };
}

/** Resolve titles to canonical ffxiclopedia titles via redirects, with a search fallback. */
async function resolveTitles(titles) {
  const resolved = new Map(); // input title -> canonical title | null
  for (let i = 0; i < titles.length; i += 50) {
    const batch = titles.slice(i, i + 50);
    const q = await api(FFXI, { action: "query", redirects: "1", titles: batch.join("|") });
    const redirect = new Map((q.query?.redirects ?? []).map((r) => [r.from, r.to]));
    const normalized = new Map((q.query?.normalized ?? []).map((n) => [n.from, n.to]));
    const missing = new Set((q.query?.pages ?? []).filter((p) => p.missing).map((p) => p.title));
    for (const t of batch) {
      let cur = normalized.get(t) ?? t;
      const seen = new Set();
      while (redirect.has(cur) && !seen.has(cur)) { seen.add(cur); cur = redirect.get(cur); }
      resolved.set(t, missing.has(cur) ? null : cur);
    }
    await sleep(120);
  }
  // Search fallback for stale Eden titles ("Fear Of Flying" -> "Fear of Flying")
  const alnum = (s) => s.toLowerCase().replace(/\([^)]*\)/g, "").replace(/[^a-z0-9]/g, "");
  for (const [t, r] of resolved) {
    if (r) continue;
    const q = await api(FFXI, { action: "query", list: "search", srsearch: t.replace(/["()]/g, " "), srlimit: "5" });
    const hits = q.query?.search ?? [];
    // Containment only counts when lengths are close ("wading beast(s)"), not "moogle" in "give moogle a break"
    const close = (a, b) => a.includes(b) && b.length >= a.length * 0.7;
    const hit =
      hits.find((s) => alnum(s.title) === alnum(t)) ??
      hits.find((s) => close(alnum(s.title), alnum(t)) || close(alnum(t), alnum(s.title)));
    if (hit) {
      console.log(`  ~ resolved by search: "${t}" -> "${hit.title}"`);
      resolved.set(t, hit.title);
    } else {
      console.log(`  ! not found on ffxiclopedia, dropped: ${t}`);
    }
    await sleep(150);
  }
  return resolved;
}

/** True disambiguation page: disambig template (not Disambig3 hatnotes) or bare "may refer to". */
function isDisambig(wt, title, type, group) {
  if (/\{\{\s*disambig(?:uation)?\s*[|}]/i.test(wt)) return true;
  if (!/may refer to/i.test(wt)) return false;
  const p = parsePage(title, wt, type, group);
  return !p.startNpc && !p.walkthrough.length && !p.reward && !p.items.length;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

console.log("Enumerating Eden categories...");
const questTitles = new Map(); // title -> group
for (const [cat, group] of QUEST_CATS) {
  const pages = (await categoryPages(EDEN, cat)).slice(0, LIMIT);
  let added = 0;
  for (const t of pages) if (!questTitles.has(t)) { questTitles.set(t, group); added++; }
  console.log(`  ${cat}: ${pages.length} pages (${added} new)`);
}
const missionTitles = new Map();
for (const [cat, group] of MISSION_CATS) {
  const pages = (await categoryPages(EDEN, cat, cat === "Assault" ? 1 : 0)).slice(0, LIMIT);
  let added = 0;
  for (const t of pages) if (!missionTitles.has(t) && !questTitles.has(t)) { missionTitles.set(t, group); added++; }
  console.log(`  ${cat}: ${pages.length} pages (${added} new)`);
}

// Missions are closed, era-bound sets, so backfill Eden's gaps from ffxiclopedia
console.log("Backfilling missions from ffxiclopedia...");
const missionNorm = new Set([...missionTitles.keys()].map((t) => normTitle(t).toLowerCase()));
for (const [cat, group] of MISSION_CATS) {
  const fcat = FFXI_MISSION_CATS.get(cat) ?? cat;
  const pages = (await categoryPages(FFXI, fcat).catch(() => [])).slice(0, LIMIT);
  let added = 0;
  for (const t of pages) {
    if (POST_TOAU_TITLE_RE.test(t)) continue;
    const norm = normTitle(t).toLowerCase();
    if (!missionNorm.has(norm) && !questTitles.has(t)) { missionTitles.set(t, group); missionNorm.add(norm); added++; }
  }
  if (added) console.log(`  ${fcat}: +${added} missions missing from Eden`);
}

// ffxiclopedia-only quests: NOT included (era can't be verified automatically) - just reported.
console.log("Checking ffxiclopedia for quests missing from Eden (report only)...");
const extraTitles = new Map();
for (const [cat, group] of QUEST_CATS) {
  const pages = await categoryPages(FFXI, cat).catch(() => []);
  for (const t of pages) {
    if (!questTitles.has(t) && !missionTitles.has(t) && !POST_TOAU_TITLE_RE.test(t)) extraTitles.set(t, group);
  }
}
console.log(`  ${extraTitles.size} candidate extra quests (will era-filter after fetch)`);

console.log("Resolving titles on ffxiclopedia...");
const whitelisted = [...extraTitles.keys()].filter((t) => QUEST_WHITELIST.has(t));
const inputQuests = new Map([...questTitles, ...whitelisted.map((t) => [t, extraTitles.get(t)])]);
const canonical = await resolveTitles([...new Set([...inputQuests.keys(), ...missionTitles.keys()])]);

// canonical title -> group; titles resolving to the same page collapse into one entry
function canonicalize(map) {
  const out = new Map();
  for (const [t, group] of map) {
    const c = canonical.get(t);
    if (!c) { console.log(`  ! not found on ffxiclopedia, dropped: ${t}`); continue; }
    if (!out.has(c)) out.set(c, group);
  }
  return out;
}
const questCanon = canonicalize(inputQuests);
const missionCanon = canonicalize(missionTitles);
for (const c of questCanon.keys()) missionCanon.delete(c);

console.log("Fetching page content...");
const ffxi = await fetchPages(FFXI, [...questCanon.keys(), ...missionCanon.keys()]);

// Disambiguation pages: swap for their "(Quest)" / "(Mission)" variant page when one exists
async function swapDisambigs(canonMap, type, suffix) {
  const disambigs = [...canonMap.keys()].filter((t) => {
    const wt = ffxi.pages.get(t);
    return wt && isDisambig(wt, t, type, canonMap.get(t));
  });
  if (!disambigs.length) return;
  const variants = disambigs.map((t) => `${t.replace(/ \((?:Quest|Mission)\)$/, "")} (${suffix})`);
  const fetched = await fetchPages(FFXI, variants);
  for (const [f, to] of fetched.redirects) ffxi.redirects.set(f, to);
  for (let i = 0; i < disambigs.length; i++) {
    const wt = fetched.pages.get(variants[i]);
    if (wt && !isDisambig(wt, variants[i], type, canonMap.get(disambigs[i]))) {
      console.log(`  ~ disambig swap: "${disambigs[i]}" -> "${variants[i]}"`);
      canonMap.set(variants[i], canonMap.get(disambigs[i]));
      ffxi.pages.set(variants[i], wt);
    } else {
      console.log(`  ! disambig with no ${suffix} variant, dropped: ${disambigs[i]}`);
    }
    canonMap.delete(disambigs[i]);
  }
}
await swapDisambigs(questCanon, "quest", "Quest");
await swapDisambigs(missionCanon, "mission", "Mission");

// Mission numbers via redirect resolution ("Bastok Mission 2-3" -> "The Emissary")
console.log("Resolving mission-number redirects...");
const numberCandidates = [];
for (const nation of ["Bastok", "San d'Oria", "Windurst"])
  for (let r = 1; r <= 9; r++) for (let p = 1; p <= 3; p++) numberCandidates.push(`${nation} Mission ${r}-${p}`);
for (let n = 1; n <= 17; n++) numberCandidates.push(`Zilart Mission ${n}`, `ZM${n}`);
for (let c = 1; c <= 8; c++) for (let p = 1; p <= 7; p++) numberCandidates.push(`Promathia Mission ${c}-${p}`, `Chains of Promathia Mission ${c}-${p}`);
const numByPage = new Map(); // pageTitle -> number
for (let i = 0; i < numberCandidates.length; i += 50) {
  const q = await api(FFXI, { action: "query", redirects: "1", titles: numberCandidates.slice(i, i + 50).join("|") });
  for (const r of q.query?.redirects ?? []) {
    const num = numberFromTitle(r.from);
    if (num && !numByPage.has(r.to)) numByPage.set(r.to, num);
  }
  await sleep(120);
}
console.log(`  resolved ${numByPage.size} mission numbers`);

// Parse everything -------------------------------------------------------------------------------
function buildEntry(title, type, group) {
  const wt = ffxi.pages.get(title);
  if (!wt) return null;
  const entry = parsePage(title, wt, type, group);
  entry.url = "https://ffxiclopedia.fandom.com/wiki/" + encodeURIComponent(title.replace(/ /g, "_"));
  if (!entry.number) entry.number = numByPage.get(title) ?? null;
  return entry;
}

console.log("Parsing...");
const quests = [];
for (const [title, group] of questCanon) {
  const e = buildEntry(title, "quest", group);
  if (e) quests.push(e);
}
const missions = [];
for (const [title, group] of missionCanon) {
  const e = buildEntry(title, "mission", group);
  if (e) missions.push(e);
}

// Expand walkthroughs that live in shared templates ({{magicite}}) and parsed empty
const tplNeeds = new Map(); // template page -> entries
for (const e of [...quests, ...missions]) {
  if (e.walkthrough.length) continue;
  const t = WALKTHROUGH_TRANSCLUSIONS.find((x) => x.marker.test(ffxi.pages.get(e.pageTitle) ?? ""));
  if (t) tplNeeds.set(t.template, [...(tplNeeds.get(t.template) ?? []), e]);
}
if (tplNeeds.size) {
  const tpl = await fetchPages(FFXI, [...tplNeeds.keys()]);
  for (const [page, entries] of tplNeeds) {
    const twt = tpl.pages.get(page);
    if (!twt) { console.log(`  ! transcluded walkthrough not found: ${page}`); continue; }
    const { steps, stepRefs } = parseWalkthrough(twt);
    const refs = locRefs(twt);
    const coords = [...new Set([...plain(twt).matchAll(COORD_RE)].map((m) => m[1]))];
    for (const e of entries) {
      e.walkthrough = steps;
      e.stepRefs = stepRefs.map((r) => ({ ...r }));
      for (const r of refs) if (!e.mapRefs.some((x) => x.zone === r.zone && x.mapNo === r.mapNo && x.pos === r.pos)) e.mapRefs.push({ ...r });
      for (const c of coords) if (!e.coords.includes(c)) e.coords.push(c);
      console.log(`  transcluded walkthrough: ${e.pageTitle} <- ${page} (${steps.length} steps)`);
    }
  }
}

// Dedupe same-name entries (e.g. "Lamia No.13" monster stub vs "Lamia No.13 (Mission)")
function dedupe(arr) {
  const richness = (x) => x.walkthrough.length * 2 + (x.startNpc ? 1 : 0) + x.items.length + (x.reward ? 1 : 0);
  const best = new Map();
  for (const e of arr) {
    const k = `${e.group}|${e.name.toLowerCase()}`;
    if (!best.has(k) || richness(e) > richness(best.get(k))) best.set(k, e);
  }
  return arr.filter((e) => {
    const keep = best.get(`${e.group}|${e.name.toLowerCase()}`) === e;
    if (!keep) console.log(`  dropping duplicate: ${e.pageTitle}`);
    return keep;
  });
}
const dedupedQuests = dedupe(quests);
const dedupedMissions = dedupe(missions);
quests.length = 0; quests.push(...dedupedQuests);
missions.length = 0; missions.push(...dedupedMissions);

// Punctuation-only title differences can collide after slugging ("Curses, Foiled Again!" vs "Curses, Foiled...Again!?")
const usedIds = new Map();
for (const e of [...quests, ...missions]) {
  const n = usedIds.get(e.id) ?? 0;
  usedIds.set(e.id, n + 1);
  if (n > 0) {
    console.log(`  id collision: ${e.pageTitle} -> ${e.id}-${n + 1}`);
    e.id = `${e.id}-${n + 1}`;
  }
}

console.log(`\nffxiclopedia-only quests NOT included (add to QUEST_WHITELIST if era-correct):`);
for (const t of [...extraTitles.keys()].filter((t) => !QUEST_WHITELIST.has(t)).sort()) console.log(`  ? [${extraTitles.get(t)}] ${t}`);

// Infer zones for walkthrough coords the wiki wrote as plain text (no {{Location}} template) ------
const ZONE_VOCAB = new Set();
for (const e of [...quests, ...missions]) {
  if (e.startZone) ZONE_VOCAB.add(e.startZone);
  for (const r of e.mapRefs) ZONE_VOCAB.add(r.zone);
}
// Longest first so "Northern San d'Oria" wins over "San d'Oria"
const zoneNames = [...ZONE_VOCAB].filter((z) => z.length > 3 && /^[A-Z]/.test(z)).sort((a, b) => b.length - a.length);

/** Zone mentions in a step, non-overlapping, longest match first. */
function zoneMentions(text) {
  const out = [];
  const claimed = [];
  for (const zone of zoneNames) {
    let i = text.indexOf(zone);
    while (i >= 0) {
      const end = i + zone.length;
      if (!claimed.some(([s, e]) => i < e && end > s)) {
        claimed.push([i, end]);
        out.push({ zone, start: i, end });
      }
      i = text.indexOf(zone, i + 1);
    }
  }
  return out;
}

let inferredZones = 0;
for (const e of [...quests, ...missions]) {
  const covered = new Set(e.stepRefs.map((r) => `${r.step}|${r.pos}`));
  const added = [];
  for (const [i, step] of e.walkthrough.entries()) {
    const mentions = zoneMentions(step);
    if (!mentions.length) continue;
    for (const m of step.matchAll(/\b([A-P]-\d{1,2})\b/g)) {
      const pos = m[1];
      if (covered.has(`${i}|${pos}`)) continue;
      const at = m.index;
      // Nearest zone name to this coordinate, within the same sentence-ish distance
      let best = null;
      for (const mn of mentions) {
        const dist = at < mn.start ? mn.start - at : at - mn.end;
        if (dist <= 60 && (!best || dist < best.dist)) best = { zone: mn.zone, dist };
      }
      if (!best) continue;
      covered.add(`${i}|${pos}`);
      added.push({ step: i, zone: best.zone, mapNo: null, pos });
      inferredZones++;
    }
    if (added.length) inferMapNos(step, added.filter((r) => r.step === i));
  }
  if (added.length) {
    e.stepRefs = [...e.stepRefs, ...added].sort((a, b) => a.step - b.step);
    for (const r of added) {
      if (!e.mapRefs.some((x) => x.zone === r.zone && x.mapNo === r.mapNo && x.pos === r.pos))
        e.mapRefs.push({ zone: r.zone, mapNo: r.mapNo, pos: r.pos });
    }
  }
}
console.log(`Inferred zones for ${inferredZones} plain-text walkthrough coordinates`);

// Multi-floor dungeons: the wiki tags only some steps with map=, but writes "3rd Floor:" on all.
// Learn the floor->map offset from the tagged steps, then apply it to the untagged ones.
const FLOOR_WORDS = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10 };
function floorOf(step) {
  if (/\bbasement\b/i.test(step)) return 0;
  const d = step.match(/\b(\d+)(?:st|nd|rd|th)\s+floor\b/i);
  if (d) return parseInt(d[1], 10);
  const w = step.match(/\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\s+floor\b/i);
  return w ? FLOOR_WORDS[w[1].toLowerCase()] : null;
}

let floorFilled = 0;
for (const e of [...quests, ...missions]) {
  const counts = new Map();
  for (const r of e.stepRefs) {
    if (r.mapNo == null) continue;
    const f = floorOf(e.walkthrough[r.step] ?? "");
    if (f != null) counts.set(r.mapNo - f, (counts.get(r.mapNo - f) ?? 0) + 1);
  }
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  const [offset, n] = [...counts].sort((a, b) => b[1] - a[1])[0] ?? [];
  // Need a clear majority; a lone outlier (wiki tagging one coord to the floor below) is ignored
  if (n == null || n < 2 || n / total <= 0.6) continue;
  for (const r of e.stepRefs) {
    if (r.mapNo != null) continue;
    const f = floorOf(e.walkthrough[r.step] ?? "");
    if (f == null) continue;
    r.mapNo = f + offset;
    floorFilled++;
  }
}
console.log(`Filled ${floorFilled} map numbers from floor references`);

// Verified wiki typos / prose the parser can't disambiguate
for (const fix of COORD_FIXES) {
  const e = [...quests, ...missions].find((x) => x.pageTitle === fix.page);
  if (!e) continue;
  const i = e.walkthrough.findIndex((s) => s.includes(fix.snippet));
  if (i < 0) continue;
  const pos = fix.right ?? fix.wrong;
  if (fix.wrong && fix.right) {
    e.walkthrough[i] = e.walkthrough[i].replaceAll(fix.wrong, fix.right);
    for (const r of e.stepRefs) if (r.step === i && r.pos === fix.wrong) r.pos = fix.right;
  }
  if (fix.zone) {
    if (fix.replace) {
      e.stepRefs = e.stepRefs.filter((r) => !(r.step === i && r.pos === pos && r.occurrence == null));
    }
    const existing = e.stepRefs.find(
      (r) => r.step === i && r.pos === pos && r.zone === fix.zone && (fix.occurrence == null || r.occurrence === fix.occurrence)
    );
    const patch = { zone: fix.zone, mapNo: fix.mapNo ?? null, occurrence: fix.occurrence };
    if (existing) Object.assign(existing, patch);
    else e.stepRefs.push({ step: i, pos, ...patch });
    if (!e.mapRefs.some((r) => r.zone === fix.zone && r.mapNo === (fix.mapNo ?? null) && r.pos === pos))
      e.mapRefs.push({ zone: fix.zone, mapNo: fix.mapNo ?? null, pos });
  }
  console.log(`  corrected ${fix.page} step ${i}: ${fix.wrong ?? pos} -> ${pos}${fix.zone ? ` @ ${fix.zone}${fix.mapNo != null ? ` map ${fix.mapNo}` : ""}` : ""}`);
}

for (const e of [...quests, ...missions]) {
  const sections = WILDCAT_SECTIONS[e.pageTitle];
  if (!sections) continue;
  let zone = null;
  let mapNo = null;
  for (const [step, text] of e.walkthrough.entries()) {
    const section = sections.find(([heading]) => text.startsWith(heading));
    if (section) [ , zone, mapNo = null] = section;
    if (!zone) continue;
    for (const match of text.matchAll(/[A-P]-\d{1,2}/g)) {
      const pos = match[0];
      const incorrectRefs = e.stepRefs.filter((r) => r.step === step && r.pos === pos && (r.zone !== zone || (mapNo != null && r.mapNo !== mapNo)));
      e.stepRefs = e.stepRefs.filter((r) => !incorrectRefs.includes(r));
      for (const ref of incorrectRefs) {
        if (!e.stepRefs.some((r) => r.zone === ref.zone && r.pos === ref.pos)) {
          e.mapRefs = e.mapRefs.filter((r) => r.zone !== ref.zone || r.pos !== ref.pos);
        }
      }
      if (!e.stepRefs.some((r) => r.step === step && r.pos === pos && r.zone === zone && (mapNo == null || r.mapNo === mapNo))) {
        e.stepRefs.push({ step, zone, mapNo, pos });
      }
    }
    if (!e.mapRefs.some((r) => r.zone === zone && r.mapNo === mapNo)) {
      e.mapRefs = e.mapRefs.filter((r) => r.zone !== zone || r.pos !== "");
      e.mapRefs.push({ zone, mapNo, pos: "" });
    }
  }
}

// Pin each assault to its arena map so the map panel shows it (assault pages have no {{Location}} refs)
let assaultPinned = 0;
for (const e of [...quests, ...missions]) {
  if (e.group !== "Assault") continue;
  const am = ASSAULT_MAPS.get(e.name);
  if (!am) continue;
  const [zone, mapNo] = am;
  if (!e.mapRefs.some((r) => r.zone === zone)) { e.mapRefs.push({ zone, mapNo, pos: "" }); assaultPinned++; }
}
console.log(`Pinned ${assaultPinned} assault arena maps`);

// Backfill missing start-NPC coordinates from the NPCs' own pages ---------------------------------
function npcLocation(wt) {
  // Only trust the NPC infobox's location param; avoid scraping coords from unrelated page text
  const line = wt.match(/\|\s*location\s*=\s*(.*)/i);
  if (!line) return null;
  const tmpl = line[1].match(/\{\{Location\|([^|}]+)\|([A-P]-\d{1,2})/i);
  if (tmpl) return { zone: plain(tmpl[1]), coord: tmpl[2] };
  const coord = line[1].match(/\(?([A-P]-\d{1,2})\)?/)?.[1] ?? null;
  const zone = links(line[1])[0]?.label ?? null;
  return zone || coord ? { zone, coord } : null;
}

console.log("\nBackfilling start-NPC coordinates from NPC pages...");
const everything = [...quests, ...missions];
const needLoc = everything.filter((e) => e.startNpc && (!e.startCoord || !e.startZone));
const npcNames = [...new Set(needLoc.map((e) => e.startNpc))].filter((n) => !/gate guard|^any\b/i.test(n));
const npcPages = await fetchPages(FFXI, npcNames);
let filled = 0;
for (const e of needLoc) {
  const wt = npcPages.pages.get(e.startNpc);
  if (!wt) continue;
  const loc = npcLocation(wt);
  if (!loc) continue;
  // Don't apply a coord from a different zone than the quest states
  if (e.startZone && loc.zone && e.startZone.toLowerCase() !== loc.zone.toLowerCase()) continue;
  if (!e.startZone && loc.zone) e.startZone = loc.zone;
  if (!e.startCoord && loc.coord) { e.startCoord = loc.coord; filled++; }
  if (e.startCoord && !e.coords.includes(e.startCoord)) e.coords.unshift(e.startCoord);
}
console.log(`  filled ${filled} missing start coordinates (of ${needLoc.length} candidates)`);

// Resolve chain links to ids ---------------------------------------------------------------------
const byName = new Map();
const all = [...quests, ...missions];
for (const e of all) {
  byName.set(e.pageTitle.toLowerCase(), e.id);
  byName.set(e.name.toLowerCase(), e.id);
}
// Also map redirect titles (e.g. "Bastok Mission 2-2") to target page ids
for (const [from, to] of ffxi.redirects) {
  const id = byName.get(to.toLowerCase());
  if (id && !byName.has(from.toLowerCase())) byName.set(from.toLowerCase(), id);
}
let linked = 0, dangling = 0;
for (const e of all) {
  for (const arr of [e.previous, e.next]) {
    for (const c of arr) {
      c.id = byName.get(c.target?.toLowerCase() ?? "") ?? byName.get(c.name.toLowerCase()) ?? null;
      delete c.target;
      c.id ? linked++ : dangling++;
    }
  }
}
console.log(`\nChain links: ${linked} resolved, ${dangling} unresolved (kept as names)`);

// Write -------------------------------------------------------------------------------------------
// Keep source-verified quest mechanics separate from the later-retail wiki import.
const belly = JSON.parse(await readFile(new URL("../src/data/insideBelly.json", import.meta.url), "utf8"));
const bellyQuest = quests.find(entry => entry.id === "inside-the-belly");
if (bellyQuest) Object.assign(bellyQuest, belly.quest);

quests.sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name));
const numKey = (n) => (n ? n.split("-").map((x) => x.padStart(3, "0")).join(".") : "999");
missions.sort((a, b) => a.group.localeCompare(b.group) || numKey(a.number).localeCompare(numKey(b.number)) || a.name.localeCompare(b.name));

const outPath = path.join(import.meta.dirname, "..", "src", "data", "quests.json");
await mkdir(path.dirname(outPath), { recursive: true });
await writeFile(outPath, JSON.stringify({
  generatedAt: new Date().toISOString().slice(0, 10),
  quests,
  missions,
}, null, 1));

const stats = (arr) => `${arr.length} total | npc:${arr.filter((e) => e.startNpc).length} | coords:${arr.filter((e) => e.startCoord).length} | walkthrough:${arr.filter((e) => e.walkthrough.length).length} | fame:${arr.filter((e) => e.fame != null).length}`;
console.log(`\nWrote ${outPath}`);
console.log(`Quests:   ${stats(quests)}`);
console.log(`Missions: ${stats(missions)}`);
for (const [g, arr] of Object.entries(Object.groupBy(missions, (m) => m.group)))
  console.log(`  ${g}: ${arr.length} missions, ${arr.filter((m) => m.number).length} numbered`);
