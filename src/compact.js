// Drop fields the site, alert Worker and price pages never read, or that only hold their default
// (false/null/same-as-price). Readers treat a missing field exactly like the default, so behavior is
// unchanged while the file is roughly a third smaller.
export function compactTeeTime(teeTime) {
  const out = { ...teeTime };
  delete out.id;
  delete out.dailyAvailableCount;
  if (!out.cacheExpiresAt) delete out.verifiedAt;
  for (const field of ["stale", "feesWaived", "golfPassEligible"]) if (out[field] === false) delete out[field];
  for (const field of ["golfPassAllInPrice", "deal", "availablePartySizes"]) if (out[field] == null) delete out[field];
  if (out.standardAllInPrice === out.allInPrice) delete out.standardAllInPrice;
  if (out.providerHotDeal === out.hotDeal) delete out.providerHotDeal;
  if (out.hotDeal === false && !("providerHotDeal" in out)) delete out.hotDeal;
  return out;
}
