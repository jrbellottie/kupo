import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import PriceInput from "./PriceInput";
import { itemPrices, useItemPrices } from "./utils/itemPrices";
import { priceCatalogItems } from "./utils/priceCatalog";
import { printBuyPrice, printSellPrice } from "./utils/printingData";
import { normalizeItemName } from "./utils/itemLinks";
import { loadJson, saveJson } from "./utils/storage";
import wikiData from "./data/itemWiki.json";
import "./PricesTab.css";
import { CollapsibleSection } from "./ScreenControls";

type View = { query: string; scope: "used" | "crafting" | "digging" | "all"; status: "all" | "saved" | "missing" | "quotes"; unit: "each" | "stack" };
const PAGE_SIZE = 50;
const wiki = wikiData as unknown as { items: Record<string, { image?: string }> };
const gil = (value: number | null) => value === null ? "Unknown" : value.toLocaleString(undefined, { maximumFractionDigits: 4 });

export default function PricesTab() {
  const prices = useItemPrices();
  const [view, setView] = useState<View>(() => ({ query: "", scope: "used", status: "all", unit: "each", ...loadJson<Partial<View>>("kupo.prices.view.v1", {}) }));
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<string | null>(null);
  useEffect(() => saveJson("kupo.prices.view.v1", view), [view]);
  const update = (patch: Partial<View>) => { setView((previous) => ({ ...previous, ...patch })); setPage(1); setEditing(null); };
  const query = normalizeItemName(useDeferredValue(view.query));
  const items = useMemo(() => priceCatalogItems(prices), [prices]);
  const hasPrice = (key: string) => prices.market[key] !== undefined || prices.buy[key] !== undefined || prices.sell[key] !== undefined || (prices.sellMode[key] !== undefined && prices.sellMode[key] !== "auto");
  const filtered = useMemo(() => items.filter((item) =>
    (view.scope === "all" || (view.scope === "used" ? item.crafting || item.digging || hasPrice(item.key) : item[view.scope])) &&
    (!query || item.search.includes(query)) &&
    (item.key === editing || view.status === "all" || (view.status === "saved" ? hasPrice(item.key) : view.status === "missing" ? prices.market[item.key] === undefined : prices.buy[item.key] !== undefined || prices.sell[item.key] !== undefined))), [items, view.scope, view.status, query, editing, prices]);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, pages);
  const visible = filtered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);
  const savedCount = items.filter((item) => hasPrice(item.key)).length;

  return <div className="prices-view">
    <div className="prices-summary"><h2>Item prices</h2><span>{savedCount.toLocaleString()} saved / {items.length.toLocaleString()} items</span><span>Local price book</span></div>
    {prices.error && <p role="alert" className="print-warning">{prices.error}</p>}
    <CollapsibleSection kind="search">
    <div className="prices-filters">
      <label className="prices-search"><span><Search size={15} /> Search items</span><div><input type="search" aria-label="Search item prices" placeholder="Item name or ID" value={view.query} onChange={(event) => update({ query: event.target.value })} /><button type="button" className="print-icon" title="Clear item search" aria-label="Clear item search" disabled={!view.query} onClick={() => update({ query: "" })}><X size={16} /></button></div></label>
      <label>Items<select value={view.scope} onChange={(event) => update({ scope: event.target.value as View["scope"] })}><option value="used">Crafting, digging &amp; saved</option><option value="crafting">Crafting</option><option value="digging">Digging</option><option value="all">All items</option></select></label>
      <label>Prices<select value={view.status} onChange={(event) => update({ status: event.target.value as View["status"] })}><option value="all">All prices</option><option value="saved">Saved prices</option><option value="missing">Missing market price</option><option value="quotes">Buy / sell quotes</option></select></label>
      <label>Price unit<select value={view.unit} onChange={(event) => update({ unit: event.target.value as View["unit"] })}><option value="each">Per item</option><option value="stack">Per stack</option></select></label>
    </div>
    </CollapsibleSection>
    <div className="prices-results"><span>{filtered.length.toLocaleString()} matching items</span><span>Auto: lowest buy / highest sell</span></div>
    <div className="print-table-wrap prices-table-wrap"><table className="prices-table"><thead><tr><th scope="col">Item</th><th scope="col">Market / AH</th><th scope="col">Buy quote</th><th scope="col">Sell quote</th><th scope="col">NPC references</th><th scope="col">Updated</th></tr></thead><tbody>{visible.map((item) => {
      const quantity = view.unit === "stack" ? item.stack : 1;
      const unit = view.unit === "stack" ? `stack of ${quantity}` : "each";
      const image = wiki.items[item.key]?.image;
      const buy = printBuyPrice(item.name, prices.effectiveBuy);
      const sell = printSellPrice(item.name, prices.effectiveSell);
      const npcBuy = printBuyPrice(item.name, {});
      const npcSell = printSellPrice(item.name, {});
      return <tr key={item.key} data-item-key={item.key} onFocus={() => setEditing(item.key)} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setEditing(null); }}>
        <th scope="row"><div className="prices-item">{image ? <img src={`${import.meta.env.BASE_URL}${image.replace(/^\//, "")}`} alt="" width="32" height="32" loading="lazy" /> : <span className="prices-image-placeholder" />}<div>{item.name}<small>#{item.key} / stack {item.stack}</small><small>{[item.crafting && "Crafting", item.digging && "Digging"].filter(Boolean).join(" / ") || "Catalog"}</small></div></div></th>
        <td><PriceInput key={view.unit} label={`Market ${item.name} gil ${unit}`} value={prices.market[item.key]} baseline={null} quantity={quantity} onChange={(value) => itemPrices.setPrice("market", item.name, value)} /></td>
        <td><PriceInput key={view.unit} label={`Buy ${item.name} gil ${unit}`} value={prices.buy[item.key]} baseline={buy} quantity={quantity} onChange={(value) => itemPrices.setPrice("buy", item.name, value)} /><small>Applied {gil(buy === null ? null : buy * quantity)}</small></td>
        <td><PriceInput key={view.unit} label={`Sell ${item.name} gil ${unit}`} value={prices.sell[item.key]} baseline={sell} quantity={quantity} onChange={(value) => itemPrices.setPrice("sell", item.name, value)} /><small>Applied {gil(sell === null ? null : sell * quantity)}</small></td>
        <td className="prices-reference">Buy {gil(npcBuy === null ? null : npcBuy * quantity)}<small>Sell {gil(npcSell === null ? null : npcSell * quantity)}</small></td>
        <td>{prices.updated[item.key] ? <time dateTime={prices.updated[item.key]} title={new Date(prices.updated[item.key]).toLocaleString()}>{new Date(prices.updated[item.key]).toLocaleDateString()}</time> : hasPrice(item.key) ? "Imported" : "Not set"}</td>
      </tr>;
    })}</tbody></table></div>
    {!visible.length && <p className="print-empty">No items match these filters.</p>}
    <div className="prices-pagination"><span>{filtered.length ? `${(current - 1) * PAGE_SIZE + 1}-${Math.min(current * PAGE_SIZE, filtered.length)}` : "0"} of {filtered.length.toLocaleString()}</span><button type="button" className="print-command" title="Previous price page" aria-label="Previous price page" disabled={current === 1} onClick={() => { setPage(current - 1); setEditing(null); }}><ChevronLeft size={17} /></button><span>Page {current} / {pages}</span><button type="button" className="print-command" title="Next price page" aria-label="Next price page" disabled={current === pages} onClick={() => { setPage(current + 1); setEditing(null); }}><ChevronRight size={17} /></button></div>
  </div>;
}