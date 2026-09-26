# Richmond Golf Tee-Time Alert

The project also includes a personal tee-time website that puts the normalized inventory in one searchable view. It supports date, player count, time window, distance, maximum price, Hot Deal, course-name, and sort controls.

The mobile list uses compact two-line course summaries with shortened names, distance, a price range, and unique tee-start counts. Expand a course to compare sources and rate names under each start. `Filters & courses` contains tap-friendly time/price selectors and course checkboxes; hidden courses are remembered on that browser. The default player setting is `All`, including single spots and offers restricted to particular group sizes.

The course picker includes enabled inventory courses and explicitly designated `mainList` courses, selected by default unless previously hidden. Their directory links appear under `Tracked around Richmond`; Hobbs Hole and Williamsburg National belong here even without live collectors. Remaining courses and practice facilities appear under `Other Local Golf`, without appearing in the picker. Main-list placement does not enable unverified inventory, and courses stay selectable even when they temporarily have no available starts.

TeeItUp's per-rate `allowedPlayers` restrictions are preserved alongside the remaining slot capacity. A four-player promotion only qualifies for four players; regular and prepaid alternatives remain available for smaller parties. Group-only rates do not qualify when the remaining capacity cannot accommodate their required party size.

Stonehouse Golf Club is included in the 24-course Local group with its ForeUp schedule 10756, seven-day collection, and OpenStreetMap golf-course coordinates cross-checked against ForeUp's latitude. Its bookable tee times are separate from the existing GolfMoose voucher.

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

The command collects configured public sources, including Queenfield TeeSnap, Hunting Hawk Play18, GolfNow, TeeItUp, ForeUp, Club Caddie, and exact Chronogolf reservation-option quotes. GolfNow rows use the displayed per-player total including its transaction fee. Separate searches verify bookable party sizes from one through four; `Any` is never assumed to mean four available spots. These searches share a paced queue and honor bounded provider cooldowns, so a full refresh can take several minutes. Birkdale is checked for 21 days; other collectors use the normal seven-day window. Failed-source saved rows are retained with `stale: true` but excluded from available results, except explicitly configured, unexpired Sycamore cache entries described below. Cached rows remain excluded from email alerts.

The generated feed records `checkedAt` plus a `sourceChecks` entry for every collector with its requested range, latest available date, row count, and any error. A full 14-source run measured about nine seconds on September 16, 2026. For a twice-daily refresh, schedule collection around 6:05 AM and 6:05 PM Eastern. This captures rolling morning releases and evening cancellations without excessive polling. Provider data does not expose when a tee time was first posted; determining release patterns requires comparing saved snapshots over several weeks.

On this Windows workstation, the `Richmond Golf Tee Times - Morning` and `Richmond Golf Tee Times - Evening` scheduled tasks run `scripts/refresh-live.ps1` at those times. Opening the website reads the saved feed immediately. Its Refresh button optionally runs the same live collection and displays a loading state while it completes.

## Sycamore laptop publishing

Chronogolf currently rejects the cloud runner and proxy with HTTP 403, while the existing collector works from this Windows laptop. Install the user-approved laptop publisher with `scripts/install-sycamore-task.ps1`. It installs `GolfWithJim - Sycamore Laptop Publisher` for the current signed-in user, every two hours from 6:15 AM through 8:15 PM in Windows local time, plus at sign-in. Missed runs catch up when Windows can run the task. It requires AC power and networking, does not wake the laptop, and cannot run while signed out, asleep, hibernating, or shut down. A locked desktop or switched-off screen is fine if the machine stays awake. Failures retry up to three times at 15-minute intervals; overlapping runs are ignored and execution is limited to 20 minutes. Existing golf tasks and power settings are unchanged.

The standalone runner is copied to `%LOCALAPPDATA%/GolfWithJim/publish-sycamore.mjs`; that folder also holds `sycamore-status.json` and `sycamore.log`. It uses existing Git credentials without interactive prompts, collects only Sycamore, and publishes from disposable checkouts. Collection failures never publish. Successful results are merged with the latest repository feed; newer Sycamore checks and unrelated course data are preserved. Non-forced pushes retry against fresh checkouts if a cloud update races the publisher. Rerun the installer after changing the runner. To remove the task: `Unregister-ScheduledTask -TaskName 'GolfWithJim - Sycamore Laptop Publisher' -Confirm:$false`.

Sycamore's `cacheMaxAgeHours: 24` preserves `verifiedAt`, `cacheExpiresAt`, and `lastSuccessfulAt` through cloud failures. Cached results show their original last-checked time in the list and map, are not held reservations, and disappear after 24 hours without successful verification. Failed retries never extend their expiry. Expiry is enforced at build/serve time and in the browser, including when returning to an open tab. The course's direct booking link remains available after expiry.

The public Refresh button still runs the cloud workflow. It does not contact or wake the laptop; there is no remote request queue or inbound laptop service. The phone sees the latest published laptop data until the next successful scheduled update. A full power-off/sleep-and-wake test is not part of installation verification.

## Notifications

### Personal alerts

The separate `alert-worker/` service stores rules in Cloudflare D1. Production uses push-only delivery (`EMAIL_DELIVERY_ENABLED=false`); email sends, recovery emails, and email enrollment are disabled. Existing rules are preserved. Matching uses Eastern time, exact public 18-hole rates, and verified available party sizes. Stale, inexact, restricted, past-start, and incompatible-party offers are excluded.

The website navigation provides List, Map, and Alerts pages; `?view=map` opens directly to the map. Course-row hover shading applies only to fine pointers with hover support, and native tap highlighting is disabled on those rows to avoid sticky highlighting while scrolling a phone. Keyboard focus outlines remain visible.

List, Map, and Alerts share the `tee-times-color-theme` preference through `public/color-theme.js`. Alerts has the same Dark mode switch and theme-aware fields, rule panels, save bar, and error messages. Theme selection survives navigation/reloads and synchronizes between open tabs.

The alert Course dropdown starts with All courses, Local courses, and Regional courses. Group selections use the same Local membership as the website, match only supported inventory courses, and keep all other alert filters. Individual choices use the existing shortened names and sort by those labels (Highlands under H, not The under T); saved values remain the full canonical course names. Group rules are stored as `group:all`, `group:local`, or `group:regional`.

Alerts opens directly without sign-in. `PUBLIC_EDITOR_EMAIL` selects the single existing mailbox's rules on the server; no admin or relay secret is exposed. This is intentionally a public editor: anyone with the site address can view/change those rules or register their own device. Do not use this mode for confidential or multi-user settings. The editor supports course, weekdays, times, prices, golfers, date bounds, Hot Deals, enabled/pause, and add/remove. Saves use version checks, prevent editing during a request, and display server-confirmed timestamps beside sticky mobile Save controls. Network failures explicitly distinguish unconfirmed saves from success.

On iOS 16.4 or newer, open the site in Safari, use Share > Add to Home Screen, open the Home Screen app, then Alerts > Enable notifications > Allow. Permission must be granted on that phone from a user gesture. Send test notification confirms push-service acceptance, not lock-screen display; Focus settings and OS delivery can delay/suppress display. Other supported browsers can enable push directly. Disable on this device unsubscribes that installation; Pause all alerts stops scheduled delivery on every registered device. Up to ten devices are supported.

`public/sw.js` displays notifications and opens the site on tap; it does not cache pages or intercept inventory fetches. The existing artwork is supplied as a PNG for iPhone Home Screen icons. VAPID keys are stored as Worker secrets, with only the public key exposed to browsers. `@block65/webcrypto-web-push` provides Apple-compatible aes128gcm encryption. Endpoints are restricted to Apple/FCM/Mozilla, redirects are not followed, and registration/test requests are rate-limited. Subscription endpoints and encryption keys stay in D1, not public responses or the repository. Expired subscriptions are deleted; successful matches are deduplicated per device.

`SIGNUP_EMAIL_TO=fbpool07@gmail.com` separately enables owner-only emails for future new push subscriptions. Tee-time emails remain disabled. A new device and its `signup_notifications` outbox entry are committed atomically; repeated registration/refresh, concurrent requests, and re-enabling the same endpoint do not repeat the email. Existing devices are not backfilled. The outbox stores only an endpoint hash, coarse device type, timestamps, and delivery status, never push keys or the raw endpoint. Delivery runs after signup without blocking it and retries on scheduled checks with backoff and a claim lock. A network failure after relay acceptance can still cause a duplicate notice. The email identifies a browser installation, not a verified person: no name/email is collected by push signup. Applying the idempotent `schema.sql` adds the outbox; no existing rules or subscriptions are changed.

The Worker checks the published feed every 15 minutes, not each course's live booking system. Existing GitHub collection is scheduled at 10:05, 11:05, 22:05, and 23:05 UTC, subject to runner delays; manual Refresh also updates it. A 15-minute alert check does not imply 15-minute inventory freshness. Feed and successful source observations older than 30 hours are rejected. Up to 100 newly matching starts are grouped per device/check; a notification summarizes the first three. Failed push sends retry on a later check if offers still qualify. Acceptance is not an exactly-once guarantee: an ambiguous network failure can cause a repeated notification.

Deployment and verification, from the project root:

```powershell
npm.cmd --prefix alert-worker ci
node alert-worker/verify.mjs
node alert-worker/setup-push.mjs
node alert-worker/node_modules/wrangler/bin/wrangler.js d1 execute golfwithjim-alerts --remote --config alert-worker/wrangler.toml --file alert-worker/schema.sql --yes
npm.cmd --prefix alert-worker run deploy
```

Existing databases created before push need `migrate-save-time.sql` applied exactly once before the schema/deploy commands. New databases use `schema.sql` directly. `setup-push.mjs` generates VAPID keys and passes them to Wrangler over stdin without printing or writing them to source; do not rotate keys after devices subscribe. Worker deployment and Pages publication are separate operations. `GET /health` reports configuration only. The integration suite exercises encrypted push with mocked delivery and verifies no email in push-only mode; real iPhone permission and receipt require a device test. Legacy email code remains available but is disabled in production; do not run email activation for push-only operation.

### Legacy reports

Builds two email reports from a permitted JSON tee-time feed:

- `daily`: seven compact daily tables with every qualifying exact-price 18-hole start. Course rows show the usual start cadence, group repeating times into ranges, and separate regular rates from Hot Deals; only course names link to booking.
- `alert`: new Hot Deals, new material local price breaks, and existing tee times whose price falls by at least both $10 and 15%.

Defaults include availability for one through four golfers within 100 miles of Richmond. The monitor prefers explicit GolfPass+ all-in pricing, marks `GP+` and waived-fee benefits, and excludes junior, military, veteran, senior, resident, club-member-only, and member-guest rates. Regular/public/adult and prepaid rates qualify, as do publicly bookable member-for-a-day offers. Restricted rates are removed before choosing a public price, so a cheaper senior rate cannot hide an eligible regular alternative. Availability is a checked snapshot, not a held reservation; the provider's booking page remains authoritative.

## Coverage and location

The default radius and outer map ring are 100 miles around Richmond (37.5407, -77.436). The map initially fits all selected courses with known coordinates, including selected courses with no current inventory, with padding and a maximum initial zoom of 11. Pins still represent qualifying availability only. Clicking a pin preserves the map's zoom and center; manual navigation remains available. Coordinate-backed distances are straight-line miles, rounded up to a tenth, not driving distances; existing unmapped local links retain their estimates. The shared distance calculation is used by the registry and the existing locate-me control.

The September 24 expansion cross-checked GolfNow regional course results, VSGA listings, and Census street-address geocoding. `fixtures/course-discovery-100mi.json` records added courses, unresolved addresses, and out-of-radius exclusions. Course listings are not a guarantee of current tee times or an exhaustive census of every facility. Public/resort booking links may appear on the main list without live collection; short, private, and military facilities remain separate. Map availability pins continue to represent qualifying inventory, not every directory link. New sources are labelled as not checked until an actual collection result exists.

Discovery was a one-time interactive review, not a new scheduled crawler. Only the existing collector implementations are used for live inventory. VSGA/GHIN membership is not proof of VIP Card ownership, and VIP offers are not included as generally available prices.

### Future phone-centered searches

The existing location button can locate a consenting user and show nearby catalog courses, but the search radius and filtering remain Richmond-based. Re-centering the radius and recomputing catalog distances from a phone is a modest frontend change; GPS requires HTTPS, permission, and a manual-location fallback. This release does not enable that change.

Reliable live availability while travelling requires a backend that selects nearby mapped courses, queries supported provider APIs for the chosen date and party size, and caches results with per-source freshness and failure status. The phone should request results, not scrape arbitrary booking websites itself: browser cross-origin rules, authentication, rate limits, and provider changes make that unreliable. Mobile browsers also suspend background work.

A global catalog is not required upfront. Regions can be added incrementally or discovered on demand, but a course's location, access rules, booking URL/provider ID, and supported integration must be verified before claiming live coverage. Unsupported courses should remain useful booking links. A phone-centered catalog would be reliable; universal, instant, exact tee times from every course would not be a credible promise. Live collection must remain provider-permitted and rate-limited.

## Feed

The monitor does not scrape GolfNow, Chronogolf, or course booking pages. Scheduling requires an API/feed approved by each source. Interactive browser searches can be summarized manually but should not be placed on an unattended timer.

Known Richmond-area Chronogolf courses are listed in `config/sources.json` for interactive checks. The Chronogolf adapter accepts exported or manually captured records with `players` ranges and `holes` lists. A displayed `from` price is retained for reference but excluded from email comparisons until `exactPrice` or `priceIsExact: true` confirms the bookable rate.

Pendleton Golf Club is registered as an interactive ForeUp source with a seven-day booking window. ForeUp rows expose exact displayed rates, available-player counts, and 9/18-hole choices; the adapter prefers 18 holes when both are offered.

Hunting Hawk Golf Club is registered through Sagacity/Play18, and Queenfield Golf Club is registered through TeeSnap. Both expose exact displayed prices and include single openings. Queenfield's observed rate includes the selected cart option; unknown booking sizes are not assumed to be empty spots. Play18 rates are labeled `Regular` unless a captured row explicitly supplies another rate name.

Windy Hill's Lake Course is registered through Whoosh. Whoosh list pages show price ranges for 9/18-hole choices, so those rows are excluded until an exact selected price is available. Belmont and Tattersall are registered through their direct Chronogolf club links. Glenwood and Brookwoods are tracked as manual-only because they currently require phone booking or lack a functioning online inventory widget.

Windy Hill, Belmont, Tattersall, Amelia, and Independence Bear intentionally remain link-only in the daily report even if a feed contains inventory. Glenwood is listed as closed, and Brookwoods displays its booking phone number. The report keeps these courses visible without presenting tee-time rows for them.

Verified GolfNow/TeeItUp engines cover Magnolia Green, Viniterra, Royal New Kent, Mill Quarter, The Hollows, Lake Chesdin, Dogwood Trace, Mattaponi Springs, Hanover, and Providence. TeeItUp captures must include an exact selected rate before they qualify; a list or advertised rate alone is not enough. GolfMoose is tracked separately from tee-time inventory because its current Stonehouse offer is a prepaid two-player voucher that requires a phone reservation.

The Highlands also uses TeeItUp. Independence exposes separate Championship and Bear course views through Club Caddie; those captures likewise require an exact selected price rather than the static daily rate page.

The source registry also records investigated exclusions. Private-only rates, stale booking engines, unrelated expired domains, and courses outside the 100-mile Richmond boundary must not enter scheduled alerts.

Elson Redmond Memorial Driving Range appears in `Other courses` as a link-only First Tee facility. Coverage reviews also search current GolfNow marketplace results for newly listed public courses; a stale or broken direct-booking URL is not sufficient reason to exclude a course that has live marketplace inventory. Marketplace discovery restored Birkdale and Meadowbrook and added the currently visible full-size courses, including the three Ford's Colony courses. The 75-mile review also added Williamsburg National's public online tee sheet and Kiln Creek as a phone-booked public course.

Spring Creek Golf Club is a private club, but its publicly bookable GolfNow member-for-a-day offers qualify when an exact public rate and available party size are verified. Club-member-only rates remain excluded. Lake Monticello and the reopened Meadows Farms are registered through their current GolfNow facility IDs.

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