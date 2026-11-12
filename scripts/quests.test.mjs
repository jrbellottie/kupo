import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const questData = JSON.parse(readFileSync(new URL("../src/data/quests.json", import.meta.url), "utf8"));
const { maps } = JSON.parse(readFileSync(new URL("../src/data/maps.json", import.meta.url), "utf8"));
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

test("Wildcat quest coordinates resolve to the map for their city section", () => {
  for (const [pageTitle, sections] of Object.entries(WILDCAT_SECTIONS)) {
    const entry = questData.quests.find((quest) => quest.pageTitle === pageTitle);
    assert.ok(entry, `Missing quest: ${pageTitle}`);
    let zone = null;
    let mapNo = null;
    const foundSections = new Set();
    for (const [step, text] of entry.walkthrough.entries()) {
      const section = sections.find(([heading]) => text.startsWith(heading));
      if (section) {
        [, zone, mapNo = null] = section;
        foundSections.add(zone);
        assert.ok(entry.mapRefs.some((ref) => ref.zone === zone && ref.mapNo === mapNo), `${pageTitle}: missing map ref for ${zone}`);
        assert.ok(maps.some((map) => map.zone === zone && (mapNo == null || map.mapNo === mapNo)), `${pageTitle}: no bundled map for ${zone}`);
      }
      if (!zone) continue;
      for (const [, pos] of text.matchAll(/([A-P]-\d{1,2})/g)) {
        const refs = entry.stepRefs.filter((ref) => ref.step === step && ref.pos === pos);
        assert.deepEqual(refs.map((ref) => [ref.zone, ref.mapNo]), [[zone, mapNo]], `${pageTitle} ${pos} at step ${step}`);
      }
    }
    assert.deepEqual([...foundSections], sections.map(([, sectionZone]) => sectionZone), pageTitle);
  }
});
