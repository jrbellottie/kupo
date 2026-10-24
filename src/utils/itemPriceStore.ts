export const ITEM_PRICES_KEY = "kupo.item-prices.v1";
export type PriceKind = "market" | "buy" | "sell" | "vendor";
export type SellMode = "auto" | "vendor" | "quote";
export type ItemPriceBook = Record<string, number>;
type PriceData = {
  version: 1; market: ItemPriceBook; buy: ItemPriceBook; sell: ItemPriceBook; vendor: ItemPriceBook;
  sellMode: Record<string, SellMode>;
  names: Record<string, string>; updated: Record<string, string>;
};
export type PriceSnapshot = PriceData & { effectiveBuy: ItemPriceBook; effectiveSell: ItemPriceBook; error: string | null };
type PriceStorage = Pick<Storage, "getItem" | "setItem">;
const valid = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const read = (storage: PriceStorage, key: string): Record<string, unknown> => {
  try { return record(JSON.parse(storage.getItem(key) ?? "null")); } catch { return {}; }
};
const empty = (): PriceData => ({ version: 1, market: {}, buy: {}, sell: {}, vendor: {}, sellMode: {}, names: {}, updated: {} });
export function selectedBuyPrice(data: PriceData, key: string, npc: number | null): number | null {
  const baseline = data.buy[key] ?? npc;
  const market = data.market[key];
  return market === undefined ? baseline : baseline === null ? market : Math.min(market, baseline);
}
export function selectedSellPrice(data: PriceData, key: string, npc: number | null): number | null {
  const vendor = data.vendor?.[key] ?? npc;
  const baseline = data.sell[key] ?? vendor;
  if (data.sellMode[key] === "vendor") return vendor;
  if (data.sellMode[key] === "quote") return baseline;
  const market = data.market[key];
  return market === undefined ? baseline : baseline === null ? market : Math.max(market, baseline);
}
export function resolvedPriceBooks(data: PriceData, npcBuy: (key: string) => number | null, npcSell: (key: string) => number | null) {
  const effectiveBuy: ItemPriceBook = {};
  const effectiveSell: ItemPriceBook = {};
  for (const key of new Set([...Object.keys(data.market), ...Object.keys(data.buy), ...Object.keys(data.sell), ...Object.keys(data.vendor ?? {}), ...Object.keys(data.sellMode)])) {
    const buy = selectedBuyPrice(data, key, npcBuy(key));
    const sell = selectedSellPrice(data, key, npcSell(key));
    if (buy !== null) effectiveBuy[key] = buy;
    if (sell !== null) effectiveSell[key] = sell;
  }
  return { effectiveBuy, effectiveSell };
}
const snapshot = (data: PriceData, error: string | null = null): PriceSnapshot => ({ ...data, ...resolvedPriceBooks(data, () => null, () => null), error });

export function createItemPriceStore(storage: PriceStorage, itemKey: (name: string) => string, now = () => new Date().toISOString()) {
  let current: PriceSnapshot | undefined;
  const listeners = new Set<() => void>();
  const persist = (data: PriceData) => {
    try { storage.setItem(ITEM_PRICES_KEY, JSON.stringify(data)); return null; }
    catch { return "Prices could not be saved to this device. Changes are available for this session only."; }
  };
  const decode = (saved: Record<string, unknown>): PriceData => {
    const data = empty();
    for (const kind of ["market", "buy", "sell", "vendor"] as const) {
      for (const [name, value] of Object.entries(record(saved[kind]))) if (valid(value)) data[kind][itemKey(name)] = value;
    }
    for (const [key, mode] of Object.entries(record(saved.sellMode))) if (mode === "auto" || mode === "vendor" || mode === "quote") data.sellMode[itemKey(key)] = mode;
    for (const [key, name] of Object.entries(record(saved.names))) if (typeof name === "string") data.names[itemKey(key)] = name;
    for (const [key, date] of Object.entries(record(saved.updated))) if (typeof date === "string" && Number.isFinite(Date.parse(date))) data.updated[itemKey(key)] = date;
    return data;
  };
  const getSnapshot = (): PriceSnapshot => {
    if (current) return current;
    const saved = read(storage, ITEM_PRICES_KEY);
    if (saved.version === 1) current = snapshot(decode(saved));
    else {
      const legacy = read(storage, "kupo.printing.v1");
      const data = decode({ buy: legacy.buy, sell: legacy.sell });
      for (const [name, value] of Object.entries(read(storage, "ffxi_dig_ah_prices_v1"))) if (valid(value)) {
        const key = itemKey(name);
        data.market[key] = value;
        data.names[key] = name;
      }
      current = snapshot(data, persist(data));
    }
    return current;
  };
  const setPrice = (kind: PriceKind, name: string, value: number | null) => {
    if (value !== null && !valid(value)) return;
    const previous = getSnapshot();
    const key = itemKey(name);
    if (previous[kind][key] === (value ?? undefined)) return;
    const book = { ...previous[kind] };
    if (value === null) delete book[key]; else book[key] = value;
    const data: PriceData = { version: 1, market: previous.market, buy: previous.buy, sell: previous.sell, vendor: previous.vendor,
      sellMode: kind === "sell" ? { ...previous.sellMode, [key]: value === null ? "auto" : "quote" } : previous.sellMode,
      names: { ...previous.names, [key]: name }, updated: { ...previous.updated, [key]: now() }, [kind]: book };
    current = snapshot(data, persist(data));
    for (const listener of listeners) listener();
  };
  const setSellMode = (name: string, mode: SellMode) => {
    if (mode !== "auto" && mode !== "vendor" && mode !== "quote") return;
    const previous = getSnapshot();
    const key = itemKey(name);
    if ((previous.sellMode[key] ?? "auto") === mode) return;
    const data: PriceData = { version: 1, market: previous.market, buy: previous.buy, sell: previous.sell, vendor: previous.vendor,
      sellMode: { ...previous.sellMode, [key]: mode }, names: { ...previous.names, [key]: name }, updated: { ...previous.updated, [key]: now() } };
    current = snapshot(data, persist(data));
    for (const listener of listeners) listener();
  };
  const reload = () => {
    const saved = read(storage, ITEM_PRICES_KEY);
    if (saved.version !== 1) return;
    current = snapshot(decode(saved));
    for (const listener of listeners) listener();
  };
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  };
  return { getSnapshot, setPrice, setSellMode, subscribe, reload };
}