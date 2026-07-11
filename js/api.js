// Data layer: live CoinGecko fetch with a committed-snapshot fallback.
//
// The GitHub Action in .github/workflows/update-data.yml refreshes
// data/snapshot.json hourly, so the dashboard still renders meaningful
// data when the browser is rate-limited or offline.

import { API_BASE, SNAPSHOT_URL, TABLE_COINS } from "./config.js";

async function getJson(url) {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

// Fear & Greed index (alternative.me, updates daily). Optional: the
// dashboard must not fail if this secondary source is down.
async function fetchFearGreed() {
  const res = await getJson("https://api.alternative.me/fng/?limit=2");
  const [today, yesterday] = res.data;
  return {
    value: Number(today.value),
    classification: today.value_classification,
    yesterday: Number(yesterday?.value),
  };
}

async function fetchLive() {
  const [markets, globalRes, fearGreed] = await Promise.all([
    getJson(
      `${API_BASE}/coins/markets?vs_currency=usd&order=market_cap_desc` +
      `&per_page=${TABLE_COINS}&page=1&sparkline=true` +
      `&price_change_percentage=24h,7d`
    ),
    getJson(`${API_BASE}/global`),
    fetchFearGreed().catch(() => null),
  ]);
  return {
    source: "live",
    fetchedAt: new Date().toISOString(),
    markets,
    global: globalRes.data,
    fearGreed,
  };
}

async function fetchSnapshot() {
  const snap = await getJson(SNAPSHOT_URL);
  return {
    source: "snapshot",
    fetchedAt: snap.fetched_at,
    markets: snap.markets,
    global: snap.global,
    fearGreed: snap.fear_greed ?? null,
  };
}

// Live first; fall back to the committed snapshot so the page never
// renders empty. Callers read `source` to tell the user which one won.
export async function fetchData() {
  try {
    return await fetchLive();
  } catch (liveErr) {
    console.warn("Live fetch failed, using committed snapshot:", liveErr);
    const snap = await fetchSnapshot();
    snap.liveError = String(liveErr);
    return snap;
  }
}
