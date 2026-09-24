# Richmond Golf Tee-Time Alert

The project also includes a personal tee-time website that puts the normalized inventory in one searchable view. It supports date, player count, time window, distance, maximum price, Hot Deal, course-name, and sort controls.

The mobile list uses compact two-line course summaries with shortened names, distance, a price range, and unique tee-start counts. Expand a course to compare sources and rate names under each start. `Filters & courses` contains tap-friendly time/price selectors and course checkboxes; hidden courses are remembered on that browser. The default player setting is `All`, including single spots and offers restricted to particular group sizes.

```powershell
npm.cmd start
```

Open `http://127.0.0.1:4194`. By default the site uses the saved Richmond snapshot. Set `GOLF_FEED_URL` to a permitted normalized JSON feed to make the Refresh button retrieve current inventory.

Configured public collectors can produce a fresh normalized feed without retaining provider booking records:

```powershell
npm.cmd run collect:live -- --start=2026-09-17 --days=7 --base=fixtures/richmond-live-2026-09-16.json --output=fixtures/live-current.json
$env:GOLF_FEED_URL = "fixtures/live-current.json"
npm.cmd start
```

The command collects configured public sources, including Queenfield TeeSnap, Hunting Hawk Play18, GolfNow, TeeItUp, ForeUp, Club Caddie, and exact Chronogolf reservation-option quotes. GolfNow rows use the displayed per-player total including its transaction fee. Separate searches verify bookable party sizes from one through four; `Any` is never assumed to mean four available spots. These searches share a paced queue and honor bounded provider cooldowns, so a full refresh can take several minutes. Birkdale is checked for 21 days; other collectors use the normal seven-day window. Failed-source saved rows are retained with `stale: true` but excluded from available results.

The generated feed records `checkedAt` plus a `sourceChecks` entry for every collector with its requested range, latest available date, row count, and any error. A full 14-source run measured about nine seconds on September 16, 2026. For a twice-daily refresh, schedule collection around 6:05 AM and 6:05 PM Eastern. This captures rolling morning releases and evening cancellations without excessive polling. Provider data does not expose when a tee time was first posted; determining release patterns requires comparing saved snapshots over several weeks.

On this Windows workstation, the `Richmond Golf Tee Times - Morning` and `Richmond Golf Tee Times - Evening` scheduled tasks run `scripts/refresh-live.ps1` at those times. Opening the website reads the saved feed immediately. Its Refresh button optionally runs the same live collection and displays a loading state while it completes.

Builds two email reports from a permitted JSON tee-time feed:

- `daily`: seven compact daily tables with every qualifying exact-price 18-hole start. Course rows show the usual start cadence, group repeating times into ranges, and separate regular rates from Hot Deals; only course names link to booking.
- `alert`: new Hot Deals, new material local price breaks, and existing tee times whose price falls by at least both $10 and 15%.

Defaults include availability for one through four golfers within 75 miles of Richmond. The monitor prefers explicit GolfPass+ all-in pricing, marks `GP+` and waived-fee benefits, and excludes junior, military, veteran, senior, resident, club-member-only, and member-guest rates. Regular/public/adult and prepaid rates qualify, as do publicly bookable member-for-a-day offers. Restricted rates are removed before choosing a public price, so a cheaper senior rate cannot hide an eligible regular alternative. Availability is a checked snapshot, not a held reservation; the provider's booking page remains authoritative.

## Feed

The monitor does not scrape GolfNow, Chronogolf, or course booking pages. Scheduling requires an API/feed approved by each source. Interactive browser searches can be summarized manually but should not be placed on an unattended timer.

Known Richmond-area Chronogolf courses are listed in `config/sources.json` for interactive checks. The Chronogolf adapter accepts exported or manually captured records with `players` ranges and `holes` lists. A displayed `from` price is retained for reference but excluded from email comparisons until `exactPrice` or `priceIsExact: true` confirms the bookable rate.

Pendleton Golf Club is registered as an interactive ForeUp source with a seven-day booking window. ForeUp rows expose exact displayed rates, available-player counts, and 9/18-hole choices; the adapter prefers 18 holes when both are offered.

Hunting Hawk Golf Club is registered through Sagacity/Play18, and Queenfield Golf Club is registered through TeeSnap. Both expose exact displayed prices and include single openings. Queenfield's observed rate includes the selected cart option; unknown booking sizes are not assumed to be empty spots. Play18 rates are labeled `Regular` unless a captured row explicitly supplies another rate name.

Windy Hill's Lake Course is registered through Whoosh. Whoosh list pages show price ranges for 9/18-hole choices, so those rows are excluded until an exact selected price is available. Belmont and Tattersall are registered through their direct Chronogolf club links. Glenwood and Brookwoods are tracked as manual-only because they currently require phone booking or lack a functioning online inventory widget.

Windy Hill, Belmont, Tattersall, Amelia, and Independence Bear intentionally remain link-only in the daily report even if a feed contains inventory. Glenwood is listed as closed, and Brookwoods displays its booking phone number. The report keeps these courses visible without presenting tee-time rows for them.

Verified GolfNow/TeeItUp engines cover Magnolia Green, Viniterra, Royal New Kent, Mill Quarter, The Hollows, Lake Chesdin, Dogwood Trace, Mattaponi Springs, Hanover, and Providence. TeeItUp captures must include an exact selected rate before they qualify; a list or advertised rate alone is not enough. GolfMoose is tracked separately from tee-time inventory because its current Stonehouse offer is a prepaid two-player voucher that requires a phone reservation.

The Highlands also uses TeeItUp. Independence exposes separate Championship and Bear course views through Club Caddie; those captures likewise require an exact selected price rather than the static daily rate page.

The source registry also records investigated exclusions. Private clubs, stale booking engines, unrelated expired domains, and courses outside the 75-mile Richmond boundary must not enter scheduled alerts.

Elson Redmond Memorial Driving Range appears in `Other courses` as a link-only First Tee facility. Coverage reviews also search current GolfNow marketplace results for newly listed public courses; a stale or broken direct-booking URL is not sufficient reason to exclude a course that has live marketplace inventory. Marketplace discovery restored Birkdale and Meadowbrook and added the currently visible full-size courses, including the three Ford's Colony courses. The 75-mile review also added Williamsburg National's public online tee sheet and Kiln Creek as a phone-booked public course.

Spring Creek Golf Club also appears in `Other courses` through its GolfNow listing. It has been fully private since May 2024, so the report links the club without presenting public tee-time inventory. Lake Monticello and the reopened Meadows Farms are registered through their current GolfNow facility IDs.

Accepted payloads are an array or an object containing `teeTimes`, `times`, `items`, or `data`:

```json
{
  "id": "stable-provider-id",
  "source": "Approved provider",
  "course": "Providence Golf Club",
  "date": "2026-09-25",
  "time": "8:00 AM",
  "availablePlayers": 4,
  "holes": 18,
  "standardAllInPrice": 84.99,
  "golfPassAllInPrice": 81.99,
  "golfPassEligible": true,
  "feesWaived": true,
  "hotDeal": false,
  "rateName": "GolfPass member",
  "distanceMiles": 7,
  "url": "https://provider.example/book"
}
```

Only set `golfPassAllInPrice`, `golfPassEligible`, or `feesWaived` when the source explicitly identifies that benefit for the signed-in account. Do not infer membership pricing from marketing badges.

## Run

```powershell
npm.cmd test
npm.cmd run preview:daily
npm.cmd run preview:alerts
$env:GOLF_FEED_URL = "https://approved-provider.example/tee-times"
node src/index.js --mode=daily --send
node src/index.js --mode=alert --send
```

The two modes keep separate state. A practical schedule is one morning digest after local courses usually release inventory and a provider-compliant alert cadence during the day. Email uses `EMAIL_RELAY_URL`, `EMAIL_RELAY_SECRET`, and optional `ALERT_TO`.