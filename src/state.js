import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export async function readState(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return { checkedAt: null, newestDate: null, teeTimes: {} };
    throw error;
  }
}

export async function writeState(path, state) {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await rename(temporaryPath, path);
}

export function nextState(teeTimes, newestDate, checkedAt) {
  return {
    checkedAt,
    newestDate,
    teeTimes: Object.fromEntries(teeTimes.map(teeTime => [teeTime.id, {
      allInPrice: teeTime.allInPrice,
      hotDeal: teeTime.hotDeal,
      lastSeenAt: checkedAt,
    }])),
  };
}

export function findChangedDeals(teeTimes, deals, previousState, config, sendBaseline = false) {
  if (!previousState.checkedAt) return sendBaseline ? deals.map(teeTime => ({ kind: "baseline", teeTime })) : [];
  const changes = teeTimes.flatMap(teeTime => {
    const previous = previousState.teeTimes?.[teeTime.id];
    if (!previous) return [];
    const savings = previous.allInPrice - teeTime.allInPrice;
    const materialDrop = savings >= config.minimumDropDollars
      && savings / previous.allInPrice >= config.minimumDropPercent;
    if (materialDrop) return [{ kind: "price-drop", teeTime, previousPrice: previous.allInPrice }];
    if (teeTime.hotDeal && !previous.hotDeal) return [{ kind: "new-hot-deal", teeTime }];
    return [];
  });
  const changedIds = new Set(changes.map(change => change.teeTime.id));
  for (const teeTime of deals) {
    if (changedIds.has(teeTime.id) || previousState.teeTimes?.[teeTime.id]) continue;
    changes.push({ kind: teeTime.hotDeal ? "new-hot-deal" : "new-price-break", teeTime });
  }
  return changes;
}