import assert from "node:assert/strict";
import test from "node:test";
import { extractPlay18Inventory } from "../src/collectors/play18.js";

test("extracts every Play18 result row with exact price and capacity", () => {
  const html = `<table>
    <tr><td class="mtrxTeeTimes">8:04<div class="be_tee_time_ampm">AM</div></td><td class="matrixPlayers">2 to 4 players</td><td><div class="mtrxPrice">$49.00</div><a class="sexybutton teebutton" href="/book?id=one&amp;date=20260917">Book</a></td></tr>
    <tr><td class="mtrxTeeTimes">8:12<div class="be_tee_time_ampm">AM</div></td><td class="matrixPlayers">2 to 3 players</td><td><div class="mtrxPrice">$44</div><a class="sexybutton teebutton" href="/book?id=two">Book</a></td></tr>
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
  ]);
  assert.equal(result[0].url, "https://huntinghawk.play18.com/book?id=one&date=20260917");
});