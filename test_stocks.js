require("dotenv").config();

const TD_KEY = process.env.TWELVE_DATA_KEY;
console.log("TWELVE_DATA_KEY:", TD_KEY ? `${TD_KEY.slice(0,6)}...` : "NO CONFIGURADO");

async function test() {
  // Test Twelve Data /quote (batch)
  console.log("\n--- Probando Twelve Data /quote ---");
  try {
    const url = `https://api.twelvedata.com/quote?symbol=AAPL,NVDA,GGAL&apikey=${TD_KEY}`;
    const res = await fetch(url);
    console.log("Status:", res.status);
    const data = await res.json();
    console.log("Respuesta:", JSON.stringify(data).slice(0, 600));
  } catch (e) {
    console.error("Error TwelveData quote:", e.message);
  }

  // Test Twelve Data /time_series (weekly)
  console.log("\n--- Probando Twelve Data /time_series ---");
  try {
    const url = `https://api.twelvedata.com/time_series?symbol=AAPL,NVDA&interval=1day&outputsize=6&apikey=${TD_KEY}`;
    const res = await fetch(url);
    console.log("Status:", res.status);
    const data = await res.json();
    // Solo mostrar primer símbolo para brevedad
    const keys = Object.keys(data);
    if (keys.length) console.log("Primer símbolo:", JSON.stringify(data[keys[0]]).slice(0, 400));
  } catch (e) {
    console.error("Error TwelveData time_series:", e.message);
  }

  // Test CoinGecko
  console.log("\n--- Probando CoinGecko ---");
  try {
    const res = await fetch("https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&per_page=3&page=1");
    console.log("Status:", res.status);
    const data = await res.json();
    console.log("Respuesta:", JSON.stringify(data[0]).slice(0, 200));
  } catch (e) {
    console.error("Error CoinGecko:", e.message);
  }
}

test();
