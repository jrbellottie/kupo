import { useState } from "react";
import { styles } from "./styles";
import ChocoboRaisingPlanner from "./ChocoboRaisingPlanner";
import { RAISING_ABILITIES } from "./utils/chocoboRaisingPlanner";
import {
  RAISING, STAT_KEYS, STAT_GRADES,
  foodStatText, foodEffects, statRank, signed, carePlanRange,
} from "./utils/chocoboRaising";
import "./ChocoboRaisingTab.css";

const sourceRoot = `${RAISING.source.repository}/blob/${RAISING.source.revision}/`;
const actions = [
  { id: 48, name: "Watch Over", stage: "Egg", effect: "Free for eggs; otherwise costs energy. Collects an item held from a walk. No direct stat gain is implemented here." },
  { id: 42, name: "Short Walk", stage: "Chick", effect: "Local trainer encounters, items and the lost-chick mini-quest. Not the daily Take a Walk care plan." },
  { id: 43, name: "Regular Walk", stage: "Adolescent", effect: "Trainer/rival encounters and items. The first regular walk meets the rivals, unlocking Compete with Others." },
  { id: 44, name: "Long Walk", stage: "Adult", effect: "More trainer encounters, including Brutus. Dietmund can appear after Save My Son; this alone does not verify a story reward." },
  { id: 50, name: "Tell a Story", stage: "Adolescent", effect: "A selected ability story adds +1 DSC before its threshold check. A successful learning/inspiration roll consumes the story and restores 10-100 energy." },
  { id: 51, name: "Scold", stage: "Chick", effect: "Lowers affection by 10 and clears spoiled behavior. Chocotonic is the explicit immediate waking food." },
  { id: 52, name: "Compete with Others", stage: "Adolescent + rivals met", effect: "50% win chance in this model; +1 affection and a pending boredom cure. Three wins earn the Happy Chocobo story." },
] as const;

function ReferenceLink({ file, children }: { file: string; children: React.ReactNode }) {
  return <a href={`${sourceRoot}${file}`} target="_blank" rel="noreferrer">{children}</a>;
}

export default function ChocoboRaisingTab() {
  const [query, setQuery] = useState("");
  const [chick, setChick] = useState(true);
  const [focus, setFocus] = useState("all");
  const filtered = RAISING.foods.filter(entry => {
    const matchesQuery = `${entry.name} ${foodEffects(entry, chick)}`.toLowerCase().includes(query.trim().toLowerCase());
    const matchesFocus = focus === "all"
      || (focus === "physical" && (entry.stats.strength > 0 || entry.stats.endurance > 0 || entry.random.fields.includes("strength")))
      || (focus === "mental" && (entry.stats.discernment > 0 || entry.stats.receptivity > 0 || entry.random.fields.includes("discernment")))
      || (focus === "medicine" && entry.category === "Medicine");
    return matchesQuery && matchesFocus;
  });

  return <section className="raising" style={styles.card}>
    <div style={styles.titleRow}><h3 style={styles.h3}>Chocobo Raising</h3><span style={styles.sub}>Reference snapshot: {RAISING.source.checkedOn}</span></div>
    <p className="raising-notice">{RAISING.source.caveat} The values below follow the pinned implementation, not generic retail advice. Food affects stats; stories teach abilities. A diet alone does not determine the final bird.</p>
    <p><a href="https://wiki.phoenix-xi.com/Chocobo_raising" target="_blank" rel="noreferrer">Chocobo raising wiki guide</a></p>
    <ChocoboRaisingPlanner />

    <details>
      <summary>What happens when I feed it?</summary>
      <div className="raising-controls">
        <label>Search food or effect<input style={styles.input} value={query} onChange={event => setQuery(event.target.value)} placeholder="Vomp, energy, illness..." /></label>
        <label>Feeding stage<select style={styles.select} value={chick ? "chick" : "older"} onChange={event => setChick(event.target.value === "chick")}><option value="chick">Chick</option><option value="older">Adolescent / Adult</option></select></label>
        <label>Focus<select style={styles.select} value={focus} onChange={event => setFocus(event.target.value)}><option value="all">All foods</option><option value="physical">Physical stats</option><option value="mental">Mental stats</option><option value="medicine">Medicine</option></select></label>
      </div>
    <p className="raising-small">Per item eaten, before caps. STR = Strength, END = Endurance, DSC = Discernment, RCP = Receptivity. Fullness and affection use a 0-255 scale; energy uses 0-100. Paste effects change with age. Eggs cannot be fed.</p>
    <div className="raising-table-wrap" tabIndex={0} role="region" aria-label="Food effects table">
      <table>
        <caption>{filtered.length} of {RAISING.foods.length} foods - {chick ? "chick" : "adolescent / adult"} effects</caption>
        <thead><tr><th scope="col">Food</th>{["STR", "END", "DSC", "RCP"].map(label => <th scope="col" key={label}>{label}</th>)}<th scope="col">Fullness</th><th scope="col">Affection</th><th scope="col">Energy</th><th scope="col">Result / caution</th></tr></thead>
        <tbody>{filtered.map(entry => {
          const variant = chick ? entry.chick : entry;
          return <tr key={entry.id}>
            <th scope="row">{entry.name}</th>
            {STAT_KEYS.map(key => <td key={key} className={entry.stats[key] < 0 ? "raising-loss" : entry.stats[key] > 0 ? "raising-gain" : ""}>{foodStatText(entry, key)}</td>)}
            <td>{signed(variant.fullness)}</td><td className={variant.affection < 0 ? "raising-loss" : ""}>{signed(variant.affection)}</td><td>{entry.energy ? signed(entry.energy) : "-"}</td>
            <td className="raising-description">{foodEffects(entry, chick)}</td>
          </tr>;
        })}</tbody>
      </table>
      {!filtered.length && <p role="status">No foods match these filters.</p>}
    </div>
    <p className="raising-small">Feeding at fullness 224 or higher is forced feeding, with a {RAISING.forcedFeedIllnessChance}% stomachache roll at the next rollover. Up to four items are consumed per trade: medicine, elixirs, training foods, then ordinary food. This is not a daily feeding limit. Chocotonic is consumed alone; sleeping birds refuse other foods. Cures normally wait for the next rollover.</p>
    <p className="raising-small"><ReferenceLink file="scripts/globals/hobbies/chocobo_raising/constants.lua">Food and care tables</ReferenceLink> / <ReferenceLink file="scripts/globals/hobbies/chocobo_raising/event_vm.lua">Feeding behavior</ReferenceLink></p>
    </details>

    <details>
      <summary>Stats, goals and abilities</summary>
      <p>Stats affect raising and riding, and the source-derived server wiki documents additional benefits when digging with your registered chocobo:</p>
      <ul>
        <li><strong>Strength (STR):</strong> sets riding speed, helping you travel between digging spots. The documented digging bonuses do not list a direct Strength bonus to finds.</li>
        <li><strong>Endurance (END):</strong> sets riding duration. The wiki also specifies +1 dig to the daily limit for every 2 END points; 224 END corresponds to +112 digs.</li>
        <li><strong>Discernment (DSC):</strong> gates story learning, including 160 DSC for Bore. The wiki also specifies a 5% chance to save greens per grade above E; A-grade DSC (160-191) corresponds to a 20% chance that a dig does not consume greens.</li>
        <li><strong>Receptivity (RCP):</strong> improves trainer meeting chances and breeding inheritance rolls in the raising model. The wiki also describes rare finds as 5% more likely per grade above F; SS-grade RCP (224-255) corresponds to a 35% increase, not a flat 35% chance to find a rare item.</li>
      </ul>
      <p>Grades run F, E, D, C, B, A, S, SS in 32-point bands: F is 0-31, D is 64-95, C is 96-127, A is 160-191, SS is 224-255. Registration stores your stats and abilities, so re-register after training to use the updated values.</p>
      <p><strong>Riding goal:</strong> raise DSC for the desired stories first (Zegham Carrots and mental care plans help), learn Gallop/Canter, then favor STR/END with Vomp Carrots and physical care plans. Lowering DSC later does not itself erase learned abilities. Keep affection and health up; no single fixed diet guarantees maximum stats.</p>
      <p><strong>Digging goal:</strong> the default 32 STR / 224 END / 160 DSC / 224 RCP build favors digging capacity and rare finds while retaining Bore's learning threshold, at the cost of riding speed. These digging benefits are documented in the <a href="https://wiki.phoenix-xi.com/Chocobo_digging#Digging_with_your_own_chocobo" target="_blank" rel="noreferrer">source-derived digging guide</a>. The inspected override in the pinned snapshot does not apply personal-chocobo stats, Burrow, Bore or Treasure Finder, so the documentation and that snapshot differ. Server-specific code remains authoritative; these documented bonuses are not included in the current Digging tab estimates.</p>
      <p>Stories can be told from adolescence. The selected ability story adds +1 DSC (subject to caps), then checks its threshold and a {RAISING.learnChance}% learning roll. Two ability slots are available. Learning or inspiration consumes the story. A known ability or two full slots produces inspiration instead of a new ability. Lethe foods forget one random learned ability, not a chosen slot.</p>
      <div className="raising-table-wrap"><table><caption>Story abilities in the pinned model</caption><thead><tr><th>Ability</th><th>DSC needed after story's +1</th><th>Story / acquisition</th><th>Implemented effect / limitation</th></tr></thead><tbody>
        {RAISING_ABILITIES.map(ability => <tr key={ability.name}><th scope="row">{ability.name}</th><td>{ability.discernment} ({STAT_GRADES[statRank(ability.discernment)]})</td><td className="raising-description"><strong>{ability.story}</strong><br />{ability.obtain}</td><td className="raising-description">{ability.effect}</td></tr>)}
      </tbody></table></div>
      <p className="raising-small">Learning thresholds and chances are implemented values, but explicitly marked as retail estimates by the source authors. <ReferenceLink file="scripts/globals/hobbies/chocobo_raising/walks.lua">Story and encounter logic</ReferenceLink> / <ReferenceLink file="modules/phoenix/lua/globals/hobbies/chocobo_digging/pxi_digging_logic.lua">Active digging override</ReferenceLink></p>
    </details>

    <details>
      <summary>Daily care plans: stat gains, losses and costs</summary>
      <p>Queue four plans of 1-7 days each. In this implementation, a plan set on day N first runs on day N + 2; the next day's plan is already locked. Empty slots refill with seven days of Basic Care.</p>
      <p className="raising-small">Good-day raw ranges below use 2-3 points per arrow, before caps. A poor day halves gains and losses toward zero. Basic Care rolls +1 independently for each stat one day in six; a poor result reduces that to zero. From day 64, care-plan losses stop, but food penalties still apply. Day 43 is a reported milestone, not an extra numeric growth multiplier in this model.</p>
      <div className="raising-table-wrap"><table><caption>Care-plan results per executed day</caption><thead><tr><th>Plan</th><th>Available</th>{["STR", "END", "DSC", "RCP"].map(label => <th key={label}>{label}</th>)}<th>Affection</th><th>Energy cost good / poor</th><th>Gil good / poor</th></tr></thead><tbody>
        {RAISING.plans.map(plan => <tr key={plan.id}><th scope="row">{plan.name}</th><td>{plan.stage}</td>{STAT_KEYS.map(key => <td key={key}>{carePlanRange(plan, key)}</td>)}<td>{signed(plan.affection)}</td><td>{plan.energy} / {plan.energy + plan.poorEnergy}</td><td>{plan.pay.length ? plan.pay.join(" / ") : "-"}</td></tr>)}
      </tbody></table></div>
      <p>Energy refills to 100 minus that day's plan cost. Rest has a 50% cure roll for each bad condition and induces sleep; other foods are refused while sleeping except Chocotonic. Affection and the plan's relevant stat ranks influence good-day odds, bounded at 5-95%; harder plans are less reliable.</p>
      <p className="raising-small"><ReferenceLink file="scripts/globals/hobbies/chocobo_raising/care_plan.lua">Care-plan calculations</ReferenceLink> / <ReferenceLink file="scripts/globals/hobbies/chocobo_raising/model.lua">Daily rollover and schedule timing</ReferenceLink></p>
    </details>

    <details>
      <summary>Affection: levels, feeding and care</summary>
      <h4>Keep affection high without wasting training meals</h4>
      <p>The pinned source starts a new bird at 255 affection. The highest band is 224-255 (regards you as a parent); 255 provides a buffer, not a higher rank bonus. Affection is separate from the four-stat cap. Higher affection improves modeled care success, not the 25% story-learning roll. The care-success formula is explicitly an estimate in the source.</p>
      <p>Zegham and Vomp Carrots each add 24 affection, Azouph Greens add 72, and Cupid Worms add 120 but lower STR and END. Care normally costs 2-10 affection per day, so training carrots can often maintain the top band without extra greens. Rest adds 2; Scold removes 10. Values cap at 255; do not force-feed to chase extra affection. At 0-31, running-away checks become possible, and adult birds can become lonely.</p>
      <p><strong>Daily recommendation:</strong> check the trainer's affection and hunger reports, enter them in the planner, and follow the recommended meals for your build. Aim to maintain the highest affection band while training stats, rather than spending extra food just to reach exactly 255. If affection drops, let the planner choose a safe recovery meal instead of adding food on top of the planned ration.</p>
      <p><strong>Do not use Watch Over as an affection grind.</strong> No direct affection increase is implemented for it in the pinned source. Watching an egg is free, but after hatching it costs energy; save that energy for useful walks and stories instead of repeatedly watching for an affection gain. Watch Over can still collect an item the bird brought back from a walk.</p>
      <p className="raising-small"><ReferenceLink file="scripts/globals/hobbies/chocobo_raising/choco_data.lua">Starting affection</ReferenceLink> / <ReferenceLink file="scripts/globals/hobbies/chocobo_raising/care_plan.lua">Care success and affection</ReferenceLink> / <ReferenceLink file="scripts/globals/hobbies/chocobo_raising/model.lua">Daily hunger and condition rules</ReferenceLink> / <ReferenceLink file="scripts/globals/hobbies/chocobo_raising/event_vm.lua">Feeding and Watch Over behavior</ReferenceLink></p>
    </details>

    <details>
      <summary>Hands-on activities and keeping the bird healthy</summary>
      <div className="raising-table-wrap"><table><caption>Energy per action</caption><thead><tr><th>Action</th><th>Available</th><th>Clear / other weather</th><th>Result</th></tr></thead><tbody>
        {actions.map(action => <tr key={action.id}><th scope="row">{action.name}</th><td>{action.stage}</td><td>{RAISING.actionEnergy[action.id]["1"]} / {RAISING.actionEnergy[action.id]["2"]}</td><td className="raising-description">{action.effect}</td></tr>)}
      </tbody></table></div>
      <p>The bird needs enough energy for the higher cost even in clear weather. Manual walks do not apply the daily Take a Walk plan's stat changes. Watching an egg is free; repeated watching is not a verified stat-training method in this implementation.</p>
      <h4>Which area's weather matters?</h4>
      <p><strong>Manual walks use the destination zone's current weather when you start the action, not the weather at the stable.</strong> The destination depends on your home stable and the walk length:</p>
      <div className="raising-table-wrap"><table aria-label="Walk weather destinations">
        <thead><tr><th>Home stable</th><th>Short walk</th><th>Regular walk</th><th>Long walk</th></tr></thead>
        <tbody>
          <tr><th scope="row">Southern San d'Oria</th><td>West Ronfaure</td><td>La Theine Plateau</td><td>Jugner Forest</td></tr>
          <tr><th scope="row">Bastok Mines</th><td>North Gustaberg</td><td>Konschtat Highlands</td><td>Pashhow Marshlands</td></tr>
          <tr><th scope="row">Windurst Woods</th><td>East Sarutabaruta</td><td>Tahrongi Canyon</td><td>Meriphataud Mountains</td></tr>
        </tbody>
      </table></div>
      <p><strong>Watch Over, Tell a Story, Scold and Compete with Others use your current stable/city zone's weather.</strong> In the energy table, Clear means no weather or Sunshine. All other weather, including Clouds and Fog, uses the higher deduction. For example, a short walk deducts 24 energy in clear weather at its destination or 30 otherwise, but still requires at least 30 energy to start.</p>
      <h4>How do I check the weather?</h4>
      <p>For planning, open Kupo's <strong>Weather</strong> tab, turn off <strong>Elemental ore</strong>, choose the destination under <strong>Zone</strong>, and use <strong>Any weather</strong> to see the full forecast. These are possible weather-roll windows, not a live reading or a guarantee of clear conditions. The daily care-plan schedule is separate from these hands-on action costs.</p>
      <p>To confirm current conditions, check in the relevant zone in game or ask someone who is there. The weather icon shows elemental weather in your current zone; the city's icon does not tell you the walk destination's weather. Also check sky and fog conditions: no elemental icon alone does not prove Clear, because Clouds and Fog still cost more here. If a stable/city zone is not listed in the forecast, check it in game rather than substituting a nearby outdoor zone. Conditions can change before you start the action, so budget for the higher energy cost.</p>
      <p className="raising-small"><ReferenceLink file="scripts/globals/hobbies/chocobo_raising/constants.lua">Walk destinations and energy costs</ReferenceLink> / <ReferenceLink file="scripts/globals/hobbies/chocobo_raising/event_vm.lua">Weather selection and energy checks</ReferenceLink></p>
      <p>Gausebit Wildgrass treats injury, Tokopekko treats minor/serious illness, and Garidav treats stomachache. Chick Herb Paste treats all four. Celerity/Tornado Salad queues cures for injury, illness, stomachache, loneliness, boredom, spoiled behavior and lovesickness. Chocotonic wakes immediately but lowers affection.</p>
      <p>Chicks lose fullness according to energy spent; older birds reset to starving at rollover. A newly hatched chick starts full. Low affection can lead to loneliness or running away; forcing food can cause stomachache. Visit the home stable for reports, food and care instead of assuming a daily fixed ration is always safe.</p>
    </details>

    <details>
      <summary>Getting an egg, growth stages and breeding</summary>
      <ol>
        <li>Verified egg routes include <strong>Chocobo on the Loose!</strong> (faintly warm), ISNM rewards, and breeding at Finbarr. ISNMs include Shadows of the Mind, Happy Caster and Compliments to the Chef (somewhat warm); Making a Mockery, Tough Nut to Crack and Call to Arms (a little warm). Access and live rewards should be checked in game.</li>
        <li>Trade one egg to Hantileon in Southern San d'Oria, Zopago in Bastok Mines, or Pulonono in Windurst Woods. One bird is raised at a time, and care stays at that stable.</li>
        <li>The reference day lasts {RAISING.settings.dayLength / 3600} Earth hours, anchored to egg hand-in rather than midnight JST. Days are processed when visiting the home stable. Name the chick after hatching.</li>
      </ol>
      <div className="raising-table-wrap"><table><caption>Growth thresholds (elapsed raising days in the source)</caption><thead><tr><th>Threshold</th><th>Milestone</th></tr></thead><tbody>
        <tr><td>{RAISING.settings.daysToChick}</td><td>Hatches; feeding, short walks and chick plans unlock.</td></tr>
        <tr><td>{RAISING.settings.daysToAdolescent}</td><td>Adolescent; color shows, stories, regular walks and more plans unlock.</td></tr>
        <tr><td>{RAISING.settings.daysToAdult1}</td><td>Adult; long walks, documentation, riding registration and adult plans unlock.</td></tr>
        <tr><td>{RAISING.settings.daysToAdult2}</td><td>Adult growth report; no extra stat multiplier is applied here.</td></tr>
        <tr><td>{RAISING.settings.daysToAdult3}</td><td>Growth-stability report; care-plan stat losses stop.</td></tr>
        <tr><td>{RAISING.settings.daysToAdult4}</td><td>Automatic retirement with the pinned settings.</td></tr>
      </tbody></table></div>
      <p className="raising-notice">The optional accelerated-growth module (2/7/14-day early stages and faster mounts) is not enabled in the public module list. Live configuration can differ. Retail guides name Dabih Jajalioh as an egg seller, but the egg stock is commented out in this snapshot; do not rely on that purchase route.</p>
      <p>Breeding uses male/female chococards and a VCS Honeymoon Ticket at Finbarr in Upper Jeuno. Documentation costs 300 gil; the ticket costs 3,500 gil. The egg is ready after the next JST midnight. Gourmet seeds STR, Sports END, Hiking DSC, and the Jeuno Tour RCP. Genes, parental stats and abilities affect the offspring; food is not the only influence.</p>
      <p>Retiring preserves the registered riding bird; obtain the registration card and re-register if you need its latest stats. Do not give up a bird expecting the same rewards as retirement.</p>
      <p className="raising-small"><ReferenceLink file="scripts/globals/hobbies/chocobo_raising/settings.lua">Pinned settings</ReferenceLink> / <ReferenceLink file="modules/init.txt">Module configuration</ReferenceLink> / <ReferenceLink file="scripts/globals/hobbies/chocobo_raising/breeding.lua">Breeding</ReferenceLink> / <ReferenceLink file="scripts/zones/RuLude_Gardens/npcs/Dabih_Jajalioh.lua">Vendor stock</ReferenceLink></p>
    </details>

    <details>
      <summary>Chocobo color: eggs, breeding and Parasite Worms</summary>
      <p><strong>You can influence color, but cannot guarantee a chosen color with a diet.</strong> The pinned model has yellow, black, blue, red and green chocobos. Color comes from three inherited or egg-generated genes, not Strength, Endurance or ordinary food color. The displayed plumage appears at adolescence, day {RAISING.settings.daysToAdolescent}.</p>
      <h4>Choose an egg with better odds</h4>
      <p>These chances apply to eggs without inherited breeding data, before gene-changing food. Somewhat warm gives the best chance here for any one non-yellow color: 22% each. Faintly warm favors yellow at 95%. None of these eggs guarantees a particular color, and a bred egg follows its inherited genes instead of this table.</p>
      <div className="raising-table-wrap"><table aria-label="Egg color chances">
        <caption>Starting color odds from the pinned source; also documented in the source-derived raising guide</caption>
        <thead><tr><th>Egg warmth</th><th>Yellow</th><th>Black</th><th>Blue</th><th>Red</th><th>Green</th></tr></thead>
        <tbody>{RAISING.eggColorOdds.map(egg => <tr key={egg.id}>
          <th scope="row">{egg.name}</th><td>{egg.yellow}%</td><td>{egg.black}%</td><td>{egg.blue}%</td><td>{egg.red}%</td><td>{egg.green}%</td>
        </tr>)}</tbody>
      </table></div>
      <h4>Breed toward the color you want</h4>
      <p>Use male and female chococards at Finbarr with a VCS Honeymoon Ticket. Choosing parents of the desired color is a practical starting point, but their visible colors do not reveal all three genes. Each offspring gene is picked from the corresponding gene of either parent, with a 5% mutation roll that randomly replaces it. Even matching-color parents are not a guarantee.</p>
      <p>Two or three matching genes determine the color. With three different genes, the result is yellow if yellow is present; otherwise it is black if black is present, and yellow if neither is present. Hidden genes and mutations prevent an exact offspring-color prediction from the parents' appearances alone. Honeymoon plans seed a stat, not a chosen color.</p>
      <h4>What Parasite Worm actually changes</h4>
      <p>Each Parasite Worm randomly replaces one of the three color genes with one of the five colors. It can roll the same gene value again, and changing one gene may not change the resulting color. You cannot choose the replacement color.</p>
      <ul>
        <li><strong>Before adolescence:</strong> feeding a chick a Parasite Worm can change its eventual displayed color. Eggs cannot be fed. The color is not yet visible, so you cannot reliably stop on a desired color by looking at the chick.</li>
        <li><strong>From adolescence onward (day {RAISING.settings.daysToAdolescent}):</strong> the displayed color is fixed. A worm changes genes for future breeding, not the color of this bird.</li>
      </ul>
      <p>Do not mass-feed worms to force a color: normal fullness and force-feeding risks still apply. For a specific non-yellow color, start with better egg odds or breed suitable parents and allow for retries. Vomp Carrots and Zegham Carrots train stats; they do not dye the bird.</p>
      <p className="raising-small">These are source-specific rules, not universal retail guarantees. The source labels some genetics parameters as estimates, and live overrides may differ. <a href="https://wiki.phoenix-xi.com/Chocobo_raising" target="_blank" rel="noreferrer">Source-derived raising guide</a> / <ReferenceLink file="scripts/globals/hobbies/chocobo_raising/breeding.lua">Egg odds and inheritance</ReferenceLink> / <ReferenceLink file="scripts/globals/hobbies/chocobo_raising/event_vm.lua">Parasite Worm behavior</ReferenceLink></p>
    </details>

    <details>
      <summary>Chocobo Whistle: unlock, register and ride</summary>
      <p><strong>Retirement is not required.</strong> The whistle quest becomes available at adulthood (day {RAISING.settings.daysToAdult1} in the pinned settings). After completing it and registering the bird, you can ride while continuing to raise and train it through day {RAISING.settings.daysToAdult4 - 1}.</p>
      <ol>
        <li>Raise the bird to adulthood. The whistle quest starts then; if raised outside San d'Oria, speak to Hantileon in Southern San d'Oria first.</li>
        <li>Go on walks with your adult bird at its home stable and search for the handkerchief. One randomly chosen walk distance holds it. Try the other distances when a search fails.</li>
        <li>Return the handkerchief to Hantileon for the Chocobo Whistle. The earlier White Handkerchief sequence affects which handkerchief you find; missing it does not block this quest in the pinned model.</li>
        <li>Register the adult bird to call it (250 gil). You need the Chocobo License to ride. Equip/use the whistle where chocobo riding is permitted.</li>
      </ol>
      <h4>How to re-register after training</h4>
      <ol>
        <li>Return to the bird's home-stable trainer: Hantileon in Southern San d'Oria, Zopago in Bastok Mines, or Pulonono in Windurst Woods. Finish the current care reports and any training you want included in the update.</li>
        <li>Use the trainer's chocobo registration option again and pay <strong>250 gil each time</strong>. The bird must be an adult and you must have completed the whistle quest. You do not need to repeat the handkerchief quest or retire the bird.</li>
        <li>Keep using the same Chocobo Whistle. Registration replaces the saved riding-bird snapshot with the bird's current stats and abilities; the whistle does not automatically track later training.</li>
      </ol>
      <p>Re-register when you want training improvements or newly learned abilities reflected in the bird you call; it is not a required daily task. This saves the current values, including any decreases, rather than keeping the best value ever reached. Trading the whistle to the trainer is for recharging, not updating this snapshot.</p>
      <p><strong>After retirement:</strong> trade the bird's VCS Registration Card to a stable trainer and choose the registration option. It costs 250 gil and uses the stats and abilities stored on that card; the card is returned, not consumed. This is the retirement registration card, not a male/female breeding chococard. Retirement alone does not refresh the registered snapshot.</p>
      <p>The whistle has 25 charges, a 5-minute reuse cooldown, and a 30-second wait after equipping before use in the pinned item data. Recharging costs 400 gil per used charge; a Whistle Coupon can cover the refill. A replacement costs 20,000 gil. Re-registration is separate from recharging and does not refill charges.</p>
      <p>Without bonuses, speed is 80% of rental speed plus 2.5 percentage points per STR grade, capped at 100%. Duration is 17 minutes plus four per END grade, capped at 45. Gallop/Purple Race Silks add a speed rank; Canter/Red Race Silks add a duration rank. Purple silks must remain worn; red silks are checked when calling. The optional faster-mount module is not assumed.</p>
      <p className="raising-small"><ReferenceLink file="scripts/quests/hiddenQuests/Chocobo_Whistle.lua">Whistle quest</ReferenceLink> / <ReferenceLink file="scripts/globals/hobbies/chocobo_raising/event_vm.lua">Active-bird registration</ReferenceLink> / <ReferenceLink file="scripts/globals/hobbies/chocobo_raising/whistle.lua">Registration and riding formulas</ReferenceLink> / <ReferenceLink file="sql/item_usable.sql">Item cooldown data</ReferenceLink></p>
    </details>

    <details>
      <summary>Sources, confidence and known gaps</summary>
      <p>{RAISING.source.attribution} The tab works offline; links open the supporting references. Research checked on {RAISING.source.checkedOn}, revision <code>{RAISING.source.revision}</code>.</p>
      <p>Numeric effects describe this implementation, not proven universal game mechanics. The source labels food point conversions, several random chances, story learning and care-plan formulas as guesses or fitted estimates of retail behavior. Server hotfixes, private configuration and unimplemented reward paths can change the practical outcome. No claim is made that the public revision exactly matches today's live deployment.</p>
      <p><ReferenceLink file="scripts/globals/hobbies/chocobo_raising/README.md">Source implementation notes and research bibliography</ReferenceLink> / <a href={RAISING.source.wiki} target="_blank" rel="noreferrer">BG Wiki raising reference (retail context)</a> / <a href={RAISING.source.licenseUrl} target="_blank" rel="noreferrer">Source license (GPL-3.0)</a></p>
    </details>
  </section>;
}
