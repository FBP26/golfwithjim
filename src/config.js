import { readFileSync } from "node:fs";
import { haversineMiles, RICHMOND_CENTER } from "./dashboard.js";

export const config = {
  recipient: process.env.ALERT_TO || "fbpool07@gmail.com",
  minimumPlayers: 1,
  collectionMinimumPlayers: 1,
  maximumDistanceMiles: 100,
  preferredHoles: 18,
  minimumDropDollars: 10,
  minimumDropPercent: 0.15,
  detailedDays: 7,
};

export const sourceRegistry = JSON.parse(readFileSync(new URL("../config/sources.json", import.meta.url), "utf8"));
sourceRegistry.interactiveOnly = sourceRegistry.interactiveOnly.map(course => ({
  ...course,
  distanceMiles: Number.isFinite(course.latitude) && Number.isFinite(course.longitude)
    ? Math.ceil(haversineMiles(...RICHMOND_CENTER, course.latitude, course.longitude) * 10) / 10
    : course.distanceMiles,
}));