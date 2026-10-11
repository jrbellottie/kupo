import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { CollapsibleSection } from "./ScreenControls";
import { styles } from "./styles";
import { PHOENIX_SOURCE } from "./utils/phoenixData";
import { loadJson, saveJson } from "./utils/storage";
import { createGuildOpeningTimer, DEFAULT_GUILD_SHOP_HOLIDAYS, findGuildSellItems, guildOpeningStatus, guildOpeningTimerId, guildSellRows, SELLING_GUILD_NAMES, SOURCE_GUILD_SHOP_HOLIDAYS, totalGuildSales, type SellingGuild } from "./utils/guildSelling";
import { getVanaNow, type Calibration } from "./vanadiel";
import { formatCountdown, pad2 } from "./utils/time";
import { WEEKDAYS } from "./utils/weekday";
import type { EarthTimer } from "./types";

export type GuildTimerControls = {
  cal: Calibration;
  nowMs: number;
  activeTimerIds: ReadonlySet<string>;
  onSetGuildTimer: (timer: EarthTimer) => void;
};

const cell: CSSProperties = { padding: "8px 10px", borderBottom: "1px solid #333", textAlign: "right", whiteSpace: "nowrap", fontSize: 13 };
const textCell: CSSProperties = { ...cell, textAlign: "left", whiteSpace: "normal", minWidth: 160 };
const tableStyle: CSSProperties = { borderCollapse: "collapse", width: "100%" };
const headerStyle: CSSProperties = { background: "#161616" };
const number = (value: number) => value.toLocaleString();
const guildLabel = (guild: string) => guild === "Smithing" ? "Smithing (Blacksmithing)" : guild;
const overridesPath = "modules/phoenix/lua/data/era_guild_shops.lua";
type GuildSellingUi = { query: string; guild: string; itemId: number; includeFerries: boolean };

function ShopHours({ shop, holidays, cal, nowMs, activeTimerIds, onSetGuildTimer }: GuildTimerControls & { shop: SellingGuild; holidays: boolean }) {
  const status = guildOpeningStatus(shop, nowMs, cal, holidays);
  const next = getVanaNow(status.nextOpenAt, cal);
  const added = activeTimerIds.has(guildOpeningTimerId(shop, status.nextOpenAt));
  return <td style={{ ...textCell, minWidth: 235 }}>
    <strong style={{ color: status.isOpen ? "#8af6b0" : "#ff9c7a" }}>{status.isOpen ? "Open now" : status.isHoliday ? "Closed - guild holiday" : "Closed"}</strong>
    <div>{pad2(shop.hours[0])}:00-{pad2(shop.hours[1])}:00 Vana&apos;diel</div>
    {shop.holiday !== null && <div style={styles.sub}>{WEEKDAYS[shop.holiday]} holiday{holidays ? "" : " (disabled)"}</div>}
    {status.closeAt !== null && <div>Closes in {formatCountdown(status.closeAt - nowMs)}</div>}
    <div>Next opens in <strong>{formatCountdown(status.nextOpenAt - nowMs)}</strong></div>
    <div style={styles.sub}>{next.weekday} {pad2(next.hour)}:00 / {new Date(status.nextOpenAt).toLocaleTimeString()} local</div>
    <button type="button" style={{ ...styles.buttonCompact, marginTop: 6 }} disabled={added}
      aria-label={`${added ? "Opening reminder set" : "Remind next opening"}: ${shop.merchants[0].name}`}
      onClick={() => onSetGuildTimer(createGuildOpeningTimer(shop, Date.now(), cal, holidays))}>
      {added ? "Reminder set" : "Remind next opening"}
    </button>
  </td>;
}

function ShopCells({ row }: { row: ReturnType<typeof guildSellRows>[number] }) {
  const locations = [...new Set(row.shop.merchants.flatMap(npc => npc.zones))];
  return <>
    <th scope="row" style={textCell}>
      {guildLabel(row.shop.guild)}
      {locations.map(zone => <div key={zone} style={{ fontWeight: 400 }}>{zone}</div>)}
    </th>
    <td style={textCell}>
      {row.shop.merchants.map(npc => npc.name).join(" / ")}
      {row.shop.merchants.length > 1 && <div style={styles.sub}>Shared stock</div>}
      {row.shop.ferry && <div style={styles.sub}>Ferry stock pool</div>}
      {row.stock.hidden && <div style={styles.sub}>Hidden from initial sell menu</div>}
    </td>
  </>;
}

export default function GuildSellingTab({ fishingOnly = false, ...timerControls }: GuildTimerControls & { fishingOnly?: boolean }) {
  const storageKey = fishingOnly ? "ffxi_fishing_guild_selling_v1" : "ffxi_guild_selling_v1";
  const [ui, setUi] = useState<GuildSellingUi>(() => loadJson(storageKey, {
    query: "", guild: "", itemId: 4451, includeFerries: true,
  }));
  useEffect(() => saveJson(storageKey, ui), [storageKey, ui]);
  const [holidays, setHolidays] = useState(() => loadJson("ffxi_guild_holidays_v1", DEFAULT_GUILD_SHOP_HOLIDAYS));
  useEffect(() => saveJson("ffxi_guild_holidays_v1", holidays), [holidays]);
  const now = getVanaNow(timerControls.nowMs, timerControls.cal);
  const guild = fishingOnly ? "Fishing" : ui.guild;
  const items = useMemo(() => findGuildSellItems(ui.query, guild, ui.includeFerries), [ui.query, guild, ui.includeFerries]);
  const selected = items.find(item => item.itemId === ui.itemId) ?? items[0];
  const rows = useMemo(() => selected ? guildSellRows(selected.itemId, guild, ui.includeFerries) : [], [selected, guild, ui.includeFerries]);
  const totals = [{ label: "Total", values: totalGuildSales(rows) }];
  if (rows.some(row => row.shop.ferry) && rows.some(row => !row.shop.ferry)) {
    totals.unshift({ label: "Land-based subtotal", values: totalGuildSales(rows.filter(row => !row.shop.ferry)) });
  }
  const update = (patch: Partial<GuildSellingUi>) => setUi(previous => ({ ...previous, ...patch }));

  return <section style={{ display: "grid", gap: 14, minWidth: 0 }} aria-label="Guild selling">
    <div>
      <h3 style={styles.h3}>Guild selling</h3>
      <p style={styles.sub}>Search an item to compare what guilds pay you, how many they can accept, and when each shop opens. Shared merchants count as one stock pool.</p>
      <div>Now: {now.weekday} {pad2(now.hour)}:{pad2(now.minute)} Vana&apos;diel</div>
    </div>
    <CollapsibleSection kind="search">
      <div style={{ ...styles.subCard, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "end" }}>
        <label style={{ ...styles.field, flex: "1 1 220px" }}>
          <span style={styles.label}>Search item</span>
          <input type="search" style={styles.input} value={ui.query} placeholder="Silver Shark, iron ingot, maple log..."
            onChange={event => update({ query: event.target.value })} />
        </label>
        {!fishingOnly && <label style={{ ...styles.field, flex: "0 1 220px" }}>
          <span style={styles.label}>Guild</span>
          <select style={styles.input} value={guild} onChange={event => update({ guild: event.target.value })}>
            <option value="">All guilds</option>
            {SELLING_GUILD_NAMES.map(name => <option key={name} value={name}>{guildLabel(name)}</option>)}
          </select>
        </label>}
        <label style={{ ...styles.field, flex: "1 1 240px" }}>
          <span style={styles.label}>Matching item ({items.length})</span>
          <select style={styles.input} value={selected?.itemId ?? ""} disabled={!items.length}
            onChange={event => update({ itemId: Number(event.target.value) })}>
            {!items.length && <option value="">No matching items</option>}
            {items.map(item => <option key={item.itemId} value={item.itemId}>{item.item}</option>)}
          </select>
        </label>
        <label style={{ ...styles.label, paddingBottom: 8 }}>
          <input type="checkbox" checked={ui.includeFerries} onChange={event => update({ includeFerries: event.target.checked })} /> Include ferries
        </label>
        <label style={{ ...styles.label, paddingBottom: 8 }}>
          <input type="checkbox" checked={holidays} onChange={event => setHolidays(event.target.checked)} /> Observe weekly guild holidays
        </label>
      </div>
    </CollapsibleSection>
    <div style={styles.sub}>Hours use your app clock calibration. Weekly holidays are enabled by default to match confirmed live behavior (the pinned source default is {SOURCE_GUILD_SHOP_HOLIDAYS ? "on" : "off"}). Opening reminders appear in Clock &amp; Timers and fire once; keep Kupo running.</div>

    {!selected ? <p role="status">No sellable guild items match these filters. Try another item or guild; buy-only items are excluded.</p> : <>
      <h4 style={{ margin: 0 }}>{selected.item} <span style={styles.sub}>({rows.length} stock pools)</span></h4>
      <div style={styles.sub}>
        Amounts are individual items, not stacks. Gil/item is paid to you. These are reference estimates, not live inventory or price quotes.
      </div>
      <section aria-labelledby="guild-fresh-heading">
        <h4 id="guild-fresh-heading" style={{ margin: "0 0 8px" }}>Fresh start</h4>
        <p style={styles.sub}>Fresh start uses the source&apos;s initial stock at first opening. Empty capacity assumes zero stock; crafting shops often start with some inventory.</p>
        <div style={{ overflowX: "auto" }} tabIndex={0} role="region" aria-label="Fresh start guild selling table">
          <table style={tableStyle}>
            <thead style={headerStyle}><tr>
              {["Guild / location", "Merchant(s)", "Hours / opening reminder", "Starting stock", "Empty capacity", "Empty gil/item", "Can sell fresh", "Fresh gil/item", "Fresh total gil"].map(label =>
                <th key={label} scope="col" style={cell}>{label}</th>)}
            </tr></thead>
            <tbody>{rows.map(row => <tr key={row.shop.pool}>
              <ShopCells row={row} />
              <ShopHours shop={row.shop} holidays={holidays} {...timerControls} />
              <td style={cell}>{number(row.freshStock)}</td>
              <td style={cell}>{number(row.emptyCapacity)}</td>
              <td style={cell}>{number(row.emptyPrice)}</td>
              <td style={cell}><strong>{number(row.freshCapacity)}</strong></td>
              <td style={cell}>{number(row.freshPrice)}</td>
              <td style={cell}>{number(row.freshGil)}</td>
            </tr>)}</tbody>
            <tfoot>{totals.map(({ label, values }) => <tr key={label}>
              <th scope="row" colSpan={3} style={textCell}>{label}</th>
              <td style={cell}>-</td><td style={cell}>{number(values.emptyCapacity)}</td><td style={cell}>-</td>
              <td style={cell}><strong>{number(values.freshCapacity)}</strong></td><td style={cell}>-</td>
              <td style={cell}>{number(values.freshGil)}</td>
            </tr>)}</tfoot>
          </table>
        </div>
      </section>
      <section aria-labelledby="guild-decay-heading">
        <h4 id="guild-decay-heading" style={{ margin: "0 0 8px" }}>After daily decay (from full stock)</h4>
        <p style={styles.sub}>After you fill a shop, its next daily refresh trims stock to the target below. The freed room is how many more you can sell.</p>
        <div style={{ overflowX: "auto" }} tabIndex={0} role="region" aria-label="Daily decay guild selling table">
          <table style={tableStyle}>
            <thead style={headerStyle}><tr>
              {["Guild / location", "Merchant(s)", "Full stock", "Trim target", "Can sell after trim", "Trim from full", "Restock/day", "Gil/item after trim", "Total gil after trim"].map(label =>
                <th key={label} scope="col" style={cell}>{label}</th>)}
            </tr></thead>
            <tbody>{rows.map(row => <tr key={row.shop.pool}>
              <ShopCells row={row} />
              <td style={cell}>{number(row.emptyCapacity)}</td>
              <td style={cell}>{number(row.dailyStock)}</td>
              <td style={cell}><strong>{number(row.dailyCapacity)}</strong></td>
              <td style={cell}>{row.trimPercent.toLocaleString(undefined, { maximumFractionDigits: 2 })}%</td>
              <td style={cell}>{number(row.stock.restockRate)}</td>
              <td style={cell}>{number(row.dailyPrice)}</td>
              <td style={cell}>{number(row.dailyGil)}</td>
            </tr>)}</tbody>
            <tfoot>{totals.map(({ label, values }) => <tr key={label}>
              <th scope="row" colSpan={2} style={textCell}>{label}</th>
              <td style={cell}>{number(values.emptyCapacity)}</td><td style={cell}>-</td>
              <td style={cell}><strong>{number(values.dailyCapacity)}</strong></td>
              <td style={cell}>-</td><td style={cell}>-</td><td style={cell}>-</td>
              <td style={cell}>{number(values.dailyGil)}</td>
            </tr>)}</tfoot>
          </table>
        </div>
      </section>
    </>}
    <details style={styles.subCard}>
      <summary>Stock, prices, and source assumptions</summary>
      <ul style={{ ...styles.sub, lineHeight: 1.6 }}>
        <li>Stock is shared by all players. Other sales reduce capacity; purchases can free more space. Normal and pirate ferry variants with the same merchant share one pool.</li>
        <li>Daily decay is a trim to a target, not repeated percentage decay. Stock at or below the target does not decay further just by waiting. Restock/day adds stock below the target, up to that target; it is not extra selling capacity.</li>
        <li>A Vana&apos;diel day lasts 57 minutes 36 seconds. Refresh occurs on shop interaction for a new game day. Opening hours and enabled guild holidays still restrict selling.</li>
        <li>The guild&apos;s payout is locked from opening stock for the game day. The default ranges from 1.5 times base NPC sell value when empty to base value when full, with source rounding; fixed-price overrides take precedence.</li>
        <li>Daily totals assume you filled every listed pool before the refresh, then sell into all freed space without other players competing. Fresh totals assume the source&apos;s initial inventory.</li>
        <li>Some target stocks are explicitly assumed in the pinned source. These tables use the reference ruleset, not universal or guaranteed live-server values.</li>
      </ul>
      <a href={`${PHOENIX_SOURCE.repository}/blob/${PHOENIX_SOURCE.revision}/scripts/data/guild_shops.lua`} target="_blank" rel="noreferrer">Pinned stock definitions</a>
      {" | "}
      <a href={`${PHOENIX_SOURCE.repository}/blob/${PHOENIX_SOURCE.revision}/${overridesPath}`} target="_blank" rel="noreferrer">Source overrides</a>
      {" | "}
      <a href={`${PHOENIX_SOURCE.repository}/blob/${PHOENIX_SOURCE.revision}/scripts/globals/guild_shops.lua`} target="_blank" rel="noreferrer">Stock and payout rules</a>
    </details>
  </section>;
}
