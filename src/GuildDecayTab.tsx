import { useEffect, useMemo, useState } from "react";
import { styles } from "./styles";
import PresetTimerDetails from "./PresetTimerDetails";
import {
  createGuildDecayTimer,
  GUILD_DECAY_MAX_TIMER_DAYS,
  GUILD_DECAY_OFFERS,
  GUILD_DECAY_PREVIEW_DAYS,
  guildDecayInputError,
  guildDecayPreview,
  guildPriceAfterDays,
  guildDecayStartingPrice,
  guildDecayStartingStock,
  inferGuildStockFromPrice,
  type GuildDecayInputMode,
  type GuildDecaySelection,
} from "./utils/guildDecay";
import { loadJson, saveJson } from "./utils/storage";
import type { EarthTimer } from "./types";
import type { Calibration } from "./vanadiel";

type GuildDecayTabProps = {
  cal: Calibration;
  nowMs: number;
  offsetHours: number;
  offsetDescription: string;
  onAddTimer: (timer: EarthTimer) => void;
};

const STORAGE_KEY = "ffxi_guild_decay_v3";
const GUILDS = [...new Set(GUILD_DECAY_OFFERS.map(offer => offer.guild))].sort();
const DEFAULT_OFFER = GUILD_DECAY_OFFERS.find(offer => offer.guild === "Woodworking" && offer.n === "Piece of Elm Lumber");

if (!DEFAULT_OFFER) throw new Error("Guild decay source data is missing Piece of Elm Lumber.");

const DEFAULT_SELECTION: GuildDecaySelection = {
  guild: DEFAULT_OFFER.guild,
  item: DEFAULT_OFFER.n,
  npc: DEFAULT_OFFER.npc,
  inputMode: "itemsBought",
  quantityBought: 1,
  currentPrice: DEFAULT_OFFER.price,
};

function loadSelection(): GuildDecaySelection {
  const saved = loadJson<Partial<GuildDecaySelection> | null>(STORAGE_KEY, null)
    ?? loadJson<Partial<GuildDecaySelection> | null>("ffxi_guild_decay_v2", null);
  const offer = saved && GUILD_DECAY_OFFERS.find(entry =>
    entry.guild === saved.guild && entry.n === saved.item && entry.npc === saved.npc);
  if (saved && offer) return {
    guild: offer.guild,
    item: offer.n,
    npc: offer.npc,
    inputMode: saved.inputMode === "currentPrice" ? "currentPrice" : "itemsBought",
    quantityBought: Number.isSafeInteger(saved.quantityBought) ? saved.quantityBought ?? 1 : 1,
    currentPrice: Number.isSafeInteger(saved.currentPrice) ? saved.currentPrice ?? offer.price : offer.price,
  };
  return DEFAULT_SELECTION;
}

export default function GuildDecayTab({ cal, nowMs, offsetHours, offsetDescription, onAddTimer }: GuildDecayTabProps) {
  const [selection, setSelection] = useState<GuildDecaySelection>(loadSelection);
  const [targetDay, setTargetDay] = useState(1);
  const timerOffsetDescription = offsetHours === 0
    ? "at the selected day boundary"
    : `${offsetDescription} before the selected day boundary`;
  const guildOffers = GUILD_DECAY_OFFERS.filter(offer => offer.guild === selection.guild);
  const itemNames = [...new Set(guildOffers.map(offer => offer.n))].sort((first, second) => first.localeCompare(second));
  const itemOffers = guildOffers.filter(offer => offer.n === selection.item);
  const selectedOffer = itemOffers.find(offer => offer.npc === selection.npc) ?? itemOffers[0];
  const error = guildDecayInputError(selectedOffer, selection);
  useEffect(() => saveJson(STORAGE_KEY, selection), [selection]);

  const preview = useMemo(() => error || !selectedOffer
    ? null
    : guildDecayPreview(selectedOffer, selection), [error, selectedOffer, selection]);
  const priceEstimate = error || !selectedOffer || selection.inputMode !== "currentPrice"
    ? null
    : inferGuildStockFromPrice(selectedOffer, selection.currentPrice);
  const startingPrice = error || !selectedOffer ? null : guildDecayStartingPrice(selectedOffer, selection);
  const startingStock = error || !selectedOffer ? null : guildDecayStartingStock(selectedOffer, selection);
  const targetDayError = !Number.isSafeInteger(targetDay) || targetDay < 1 || targetDay > GUILD_DECAY_MAX_TIMER_DAYS
    ? `Choose a whole number of game days from 1 to ${GUILD_DECAY_MAX_TIMER_DAYS}.`
    : null;
  const targetPrice = error || targetDayError || !selectedOffer
    ? null
    : guildPriceAfterDays(selectedOffer, selection, targetDay);
  const canSetTargetTimer = !error && !targetDayError && selectedOffer !== undefined
    && targetPrice !== null;
  const changeGuild = (guild: string) => {
    const firstOffer = GUILD_DECAY_OFFERS.find(offer => offer.guild === guild);
    if (!firstOffer) throw new Error(`No guild shop offers are available for ${guild}.`);
    setSelection(previous => ({
      ...previous, guild, item: firstOffer.n, npc: firstOffer.npc, quantityBought: 1,
      currentPrice: firstOffer.price,
    }));
  };
  const changeItem = (item: string) => {
    const firstOffer = guildOffers.find(offer => offer.n === item);
    if (!firstOffer) throw new Error(`No ${item} offer is available at ${selection.guild}.`);
    setSelection(previous => ({
      ...previous, item, npc: firstOffer.npc, quantityBought: 1, currentPrice: firstOffer.price,
    }));
  };
  const addTimer = (days: number) => {
    if (!selectedOffer) throw new Error("Choose a guild item and shop before setting a timer.");
    onAddTimer(createGuildDecayTimer(selectedOffer, selection, days, nowMs, cal, offsetHours));
  };
  const timerFireAt = (days: number) => {
    if (!selectedOffer || error || !Number.isSafeInteger(days) || days < 1 || days > GUILD_DECAY_MAX_TIMER_DAYS) {
      return null;
    }
    return createGuildDecayTimer(selectedOffer, selection, days, nowMs, cal, offsetHours).targetEarthMs;
  };
  const setQuantityBought = (value: number) => setSelection(previous => ({ ...previous, quantityBought: value }));
  const setCurrentPrice = (value: number) => setSelection(previous => ({ ...previous, currentPrice: value }));
  const setInputMode = (inputMode: GuildDecayInputMode) => setSelection(previous => ({ ...previous, inputMode }));

  return <section style={{ ...styles.card, display: "grid", gap: 14 }} aria-labelledby="guild-decay-title">
    <div>
      <h3 id="guild-decay-title" style={styles.h3}>Guild decay</h3>
      <p style={styles.sub}>Choose a guild item and estimate its price as the shop restocks, using the item&apos;s source stock and price curve.</p>
    </div>

    <div style={{ ...styles.subCard, display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", alignItems: "end" }}>
      <label style={styles.field}>
        <span style={styles.label}>Guild</span>
        <select style={styles.input} value={selection.guild} onChange={event => changeGuild(event.target.value)}>
          {GUILDS.map(guild => <option key={guild} value={guild}>{guild}</option>)}
        </select>
      </label>
      <label style={styles.field}>
        <span style={styles.label}>Item</span>
        <select style={styles.input} value={selection.item} onChange={event => changeItem(event.target.value)}>
          {itemNames.map(item => <option key={item} value={item}>{item}</option>)}
        </select>
      </label>
      <label style={styles.field}>
        <span style={styles.label}>Guild shop</span>
        <select style={styles.input} value={selectedOffer?.npc ?? ""} onChange={event => {
          const shop = itemOffers.find(offer => offer.npc === event.target.value);
          if (!shop) throw new Error(`No ${selection.item} offer is available at ${event.target.value}.`);
          setSelection(previous => ({ ...previous, npc: shop.npc, quantityBought: 1, currentPrice: shop.price }));
        }}>
          {itemOffers.map(offer => <option key={`${offer.npc}:${offer.zone}`} value={offer.npc}>{offer.npc} — {offer.zone}</option>)}
        </select>
      </label>
      <div role="group" aria-label="Starting information" style={{ gridColumn: "1 / -1", display: "flex", gap: 16, flexWrap: "wrap" }}>
        <span style={styles.label}>Calculate from:</span>
        <label style={{ ...styles.label, display: "flex", alignItems: "center", gap: 6 }}>
          <input type="radio" name="guild-decay-input-mode" checked={selection.inputMode === "itemsBought"}
            onChange={() => setInputMode("itemsBought")} />
          Items bought
        </label>
        <label style={{ ...styles.label, display: "flex", alignItems: "center", gap: 6 }}>
          <input type="radio" name="guild-decay-input-mode" checked={selection.inputMode === "currentPrice"}
            onChange={() => setInputMode("currentPrice")} />
          Current price
        </label>
      </div>
      {selection.inputMode === "itemsBought"
        ? <label style={styles.field}>
            <span style={styles.label}>Items bought</span>
            <input style={styles.input} type="number" min={0} max={selectedOffer?.targetStock ?? 0} step={1}
              value={selection.quantityBought} onChange={event => setQuantityBought(Number(event.target.value))} />
          </label>
        : <label style={styles.field}>
            <span style={styles.label}>Current guild price (gil)</span>
            <input style={styles.input} type="number" min={0} max={1_000_000_000} step={1}
              value={selection.currentPrice} onChange={event => setCurrentPrice(Number(event.target.value))} />
          </label>}
    </div>

    {error && <p role="alert" style={styles.errorText}>{error}</p>}
    {!error && selectedOffer && <>
      <p style={styles.sub}>
        {selection.inputMode === "itemsBought"
          ? <>Normal price: <strong>{selectedOffer.price.toLocaleString()} gil</strong> at the daily stock target of {selectedOffer.targetStock}.
              The estimate starts at that stock level before your purchase.</>
          : <>Current price: <strong>{selection.currentPrice.toLocaleString()} gil</strong>; estimated shelf stock is
              {" "}<strong>{priceEstimate?.estimatedStock}</strong> of {selectedOffer.targetStock}.</>}
        {" "}The current day&apos;s quote is locked; stock is replenished by {selectedOffer.restockRate} items per Vana&apos;diel day,
        up to the target. Timer fires {timerOffsetDescription}.
      </p>
      {priceEstimate && !priceEstimate.exact && <p role="status" style={styles.sub}>
        That price is not on the exact item curve. The closest source price is {priceEstimate.sourcePrice.toLocaleString()} gil
        at stock {priceEstimate.estimatedStock}; the forecast uses that stock estimate.
      </p>}
      {priceEstimate?.exact && priceEstimate.matchCount > 1 && <p role="status" style={styles.sub}>
        That price can match {priceEstimate.matchCount} stock amounts because the formula rounds to whole gil. The estimate uses
        the highest matching stock ({priceEstimate.estimatedStock}).
      </p>}

      <div style={{ overflowX: "auto" }} tabIndex={0} role="region" aria-label="Guild item stock and price forecast">
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr style={{ background: "#161616" }}>
              {["Game day", "Estimated stock", "Calculated price", "Timer"].map(label =>
                <th key={label} scope="col" style={{ padding: "8px 10px", borderBottom: "1px solid #333", textAlign: "left" }}>{label}</th>)}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={{ padding: "8px 10px", borderBottom: "1px solid #333" }}>Today (price already set)</td>
              <td style={{ padding: "8px 10px", borderBottom: "1px solid #333" }}>{startingStock}</td>
              <td style={{ padding: "8px 10px", borderBottom: "1px solid #333" }}>{startingPrice?.toLocaleString()} gil</td>
              <td style={{ padding: "8px 10px", borderBottom: "1px solid #333" }}>—</td>
            </tr>
            {preview?.days.map(({ day, stock, price }) => {
              const fireAtMs = timerFireAt(day);
              return <tr key={day}>
                <td style={{ padding: "8px 10px", borderBottom: "1px solid #333" }}>After {day} {day === 1 ? "day" : "days"}</td>
                <td style={{ padding: "8px 10px", borderBottom: "1px solid #333" }}>{stock}</td>
                <td style={{ padding: "8px 10px", borderBottom: "1px solid #333" }}>{price.toLocaleString()} gil</td>
                <td style={{ padding: "8px 10px", borderBottom: "1px solid #333" }}>
                  <button type="button" style={styles.buttonCompact} onClick={() => addTimer(day)}>Set timer</button>
                  {fireAtMs !== null && <PresetTimerDetails offsetText={offsetDescription} offsetValue={offsetHours}
                    reference="the selected guild day boundary" fireAtMs={fireAtMs} nowMs={nowMs} />}
                </td>
              </tr>;
            })}
          </tbody>
        </table>
      </div>

      {preview?.capped && <p style={styles.sub}>Showing the first {GUILD_DECAY_PREVIEW_DAYS} days. Use the day selector for a later forecast.</p>}
      {selection.inputMode === "itemsBought" && selection.quantityBought === 0
        && <p role="status" style={styles.sub}>No purchase was entered, so stock and price remain at the daily target.</p>}
      {selectedOffer.restockRate === 0 && startingStock !== selectedOffer.targetStock
        && <p role="status" style={styles.sub}>This item has no automatic restock, so the price will not decay from waiting alone.</p>}
      {preview && preview.days.length > 0 && preview.days.every(day => day.price === startingPrice)
        && <p role="status" style={styles.sub}>This stock level is replenished by the next daily refresh, so the calculated price stays at its current level.</p>}

      <div style={{ ...styles.subCard, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "end" }}>
        <label style={{ ...styles.field, width: 180 }}>
          <span style={styles.label}>Choose a game day</span>
          <input style={styles.input} type="number" min={1} max={GUILD_DECAY_MAX_TIMER_DAYS} step={1} value={targetDay}
            onChange={event => setTargetDay(Number(event.target.value))} />
        </label>
        <div style={styles.sub} aria-live="polite">
          Calculated price: {targetPrice === null ? "—" : `${targetPrice.toLocaleString()} gil`}
        </div>
        <div>
          <button type="button" style={styles.buttonPrimary} disabled={!canSetTargetTimer} onClick={() => addTimer(targetDay)}>
            Set timer for this day
          </button>
          {canSetTargetTimer && <PresetTimerDetails offsetText={offsetDescription} offsetValue={offsetHours}
            reference="the selected guild day boundary" fireAtMs={timerFireAt(targetDay)!} nowMs={nowMs} />}
        </div>
      </div>
      {targetDayError && <p role="alert" style={styles.errorText}>{targetDayError}</p>}

      <details style={styles.subCard}>
        <summary>How the source price formula works</summary>
        <div style={{ ...styles.sub, lineHeight: 1.6 }}>
          <p>The price is based on shelf stock, not a percentage. At each new-day shop refresh, stock rises by the source&apos;s restock amount up to its target, then the buy-price curve is recalculated. The current day&apos;s quote stays fixed after a purchase.</p>
          <p>Let <code>F</code> be the item&apos;s price floor, <code>M</code> its maximum stock, <code>B</code> its empty-shelf price, and <code>S</code> its stock. The default <code>F</code> is 75% of <code>M</code>, unless the item overrides it; the curve&apos;s knee is <code>2F/3</code>.</p>
          <p><code>S ≤ 2F/3</code>: <code>floor(B × (125 − floor(150S/F)) / 125)</code><br />
            <code>S &gt; 2F/3</code>: <code>floor(B × (200 − floor(100(S − 2F/3)/(M − 2F/3))) / 1000)</code></p>
          <p>The timer fires {timerOffsetDescription}. Actual prices can differ if other players change stock; the new quote is applied when the shop refreshes.</p>
        </div>
      </details>
    </>}
  </section>;
}
