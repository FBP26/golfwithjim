import assert from "node:assert/strict";
import test from "node:test";
import { collectPlay18Day, extractPlay18Inventory } from "../src/collectors/play18.js";

test("extracts every Play18 result row with exact price and capacity", () => {
  const html = `<table>
    <tr><td class="mtrxTeeTimes">8:04<div class="be_tee_time_ampm">AM</div></td><td class="matrixPlayers">2 to 4 players</td><td><div class="mtrxPrice">$49.00</div><a class="sexybutton teebutton" href="/book?id=one&amp;date=20260917">Book</a></td></tr>
    <tr><td class="mtrxTeeTimes">8:12<div class="be_tee_time_ampm">AM</div></td><td class="matrixPlayers">2 to 3 players</td><td><div class="mtrxPrice">$44</div><a class="sexybutton teebutton" href="/book?id=two">Book</a></td></tr>
    <tr><td class="mtrxTeeTimes">8:20<div class="be_tee_time_ampm">AM</div></td><td class="matrixPlayers">2 players</td><td><div class="mtrxPrice">$42</div><a class="sexybutton teebutton" href="/book?id=three">Book</a></td></tr>
  </table>`;
  const result = extractPlay18Inventory(html, {
    baseUrl: "https://huntinghawk.play18.com",
    course: "Hunting Hawk Golf Club",
    date: "2026-09-17",
    distanceMiles: 24,
  });

  assert.deepEqual(result.map(item => ({ time: item.time, players: item.availablePlayers, price: item.allInPrice })), [
    { time: "8:04 AM", players: 4, price: 49 },
    { time: "8:12 AM", players: 3, price: 44 },
    { time: "8:20 AM", players: 2, price: 42 },
  ]);
  assert.equal(result[0].url, "https://huntinghawk.play18.com/book?id=one&date=20260917");
});

test("collects the date-specific Play18 booking page with GET", async () => {
  let requestedUrl;
  let options;
  const rows = await collectPlay18Day({
    url: "https://huntinghawk.play18.com/teetimes/searchmatrix",
    date: "2026-10-09",
    course: "Hunting Hawk Golf Club",
    distanceMiles: 24,
    fetchImpl: async (url, requestOptions) => {
      requestedUrl = new URL(url);
      options = requestOptions;
      return {
        ok: true,
        text: async () => `<tr><td class="mtrxTeeTimes">9:36<div class="be_tee_time_ampm">AM</div></td><td class="matrixPlayers">2 to 4 players</td><td><div class="mtrxPrice">$64</div><a class="sexybutton teebutton" href="/book">Book</a></td></tr>`,
      };
    },
  });

  assert.equal(requestedUrl.searchParams.get("teedate"), "20261009");
  assert.equal(options.method, undefined);
  assert.deepEqual(rows.map(item => ({ time: item.time, price: item.allInPrice })), [{ time: "9:36 AM", price: 64 }]);
});