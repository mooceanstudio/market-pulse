#!/usr/bin/env node
// Fetch a market snapshot from CoinGecko and write data/snapshot.json.
//
// Run hourly by .github/workflows/update-data.yml so the dashboard has
// fresh fallback data even when the browser can't reach the live API.
// Also runnable locally: `node scripts/fetch-snapshot.mjs`

import { writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const API = "https://api.coingecko.com/api/v3";
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "snapshot.json");

async function getJson(url, retries = 3) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (res.ok) return res.json();
    if (attempt >= retries) throw new Error(`${res.status} ${res.statusText} for ${url}`);
    const wait = attempt * 15_000; // free tier rate limit — back off politely
    console.warn(`HTTP ${res.status}, retry ${attempt}/${retries - 1} in ${wait / 1000}s`);
    await new Promise(r => setTimeout(r, wait));
  }
}

const markets = await getJson(
  `${API}/coins/markets?vs_currency=usd&order=market_cap_desc` +
  `&per_page=10&page=1&sparkline=true&price_change_percentage=24h,7d`
);
const global = (await getJson(`${API}/global`)).data;

// Secondary source — mirror of fetchFearGreed() in js/api.js; optional,
// so a hiccup here never blocks the market snapshot.
const fearGreed = await getJson("https://api.alternative.me/fng/?limit=2", 1)
  .then(res => ({
    value: Number(res.data[0].value),
    classification: res.data[0].value_classification,
    yesterday: Number(res.data[1]?.value),
  }))
  .catch(err => {
    console.warn("Fear & Greed fetch failed, omitting:", err.message);
    return null;
  });

const snapshot = {
  fetched_at: new Date().toISOString(),
  source: "coingecko",
  fear_greed: fearGreed,
  global: {
    total_market_cap: { usd: global.total_market_cap.usd },
    total_volume: { usd: global.total_volume.usd },
    market_cap_percentage: {
      btc: global.market_cap_percentage.btc,
      eth: global.market_cap_percentage.eth,
    },
    market_cap_change_percentage_24h_usd: global.market_cap_change_percentage_24h_usd,
  },
  markets: markets.map(c => ({
    id: c.id,
    symbol: c.symbol,
    name: c.name,
    image: c.image,
    market_cap_rank: c.market_cap_rank,
    current_price: c.current_price,
    market_cap: c.market_cap,
    total_volume: c.total_volume,
    price_change_percentage_24h: c.price_change_percentage_24h,
    price_change_percentage_7d_in_currency: c.price_change_percentage_7d_in_currency,
    sparkline_in_7d: { price: c.sparkline_in_7d.price.map(p => +p.toPrecision(6)) },
  })),
};

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify(snapshot) + "\n");
console.log(`Wrote ${OUT} — ${snapshot.markets.length} coins at ${snapshot.fetched_at}`);
