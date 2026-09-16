import { readFileSync } from "node:fs";

export const config = {
  recipient: process.env.ALERT_TO || "fbpool07@gmail.com",
  minimumPlayers: 2,
  maximumDistanceMiles: 75,
  preferredHoles: 18,
  minimumDropDollars: 10,
  minimumDropPercent: 0.15,
  detailedDays: 7,
};

export const sourceRegistry = JSON.parse(readFileSync(new URL("../config/sources.json", import.meta.url), "utf8"));