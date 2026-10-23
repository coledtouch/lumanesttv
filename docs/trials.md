# Free 24-hour trials

A new visitor can ask for a free 24-hour trial with every feature before they have a provider account or line. Each request waits for the owner. The owner approves or declines it in `/manage`. Nothing is created at the provider, and no email is sent, until the owner approves.

Code: `site/lib/trials.ts`, the routes `site/app/api/trial/route.ts`, `site/app/api/trial/status/route.ts` and `site/app/api/manage/trials/route.ts`, the table `trial_requests` (migration `site/drizzle/0011_trial_requests.sql`), the clean-up steps in `site/lib/maintenance.ts`, and the tests in `site/tests/trial-runtime.test.mjs`. The pages are `/trial` (the request form), `/trial/status` (the requester's private status page) and the **Trial requests** queue in `/manage`.

## Flow

1. The visitor fills in `/trial`: their name, email address, the device they'll watch on, and a required agreement to the terms and privacy policy. `POST /api/trial` stores the request as `pending` and returns a private status link, `/trial/status#<token>`.
2. The status page reads the token from the link's fragment after it loads and posts it to `POST /api/trial/status`. A fragment never reaches a server log, a `Referer` header or a query string. D1 keeps only a hash of the token.
3. The owner opens **Trial requests** in `/manage`. Pending requests come first, oldest first. Each row shows how many other requests came from the same network in the last 30 days (`same_network`) and with the same email address (`same_email`).
4. To approve, the owner creates a 24-hour trial line in the MyBunny reseller panel just before approving, and enters its line ID. The site then:
   1. checks that the customer hub can send invitations (`GET /account`: the hub is approved, its address matches `CUSTOMER_PORTAL_URL`/`CUSTOMER_PORTAL_PRIMARY_URL`, and `site.email_ready` is `true`). Otherwise it answers 503 `invitations_not_ready` and changes nothing;
   2. claims the request (`pending` → `activating`, with `attempted` set) in one conditional update. Only one approval can win;
   3. reads the line (`GET /lines/{id}`). The line must exist, must not be expired, disabled, banned or suspended, must not belong to a customer, and must end about 24 hours from now: between 20 and 26 hours, so the trial lasts what the terms promise. Its `expires_at` is taken as exact only when it is a time with a zone. Otherwise the date (read to within 14 hours) or `days_left` must still fit a trial line, with at most a day left, and a line that reports neither, such as one with no end date, is refused. A line that fails any of these checks is refused, and the request goes back to `pending`, because only reads have happened so far. The owner can then enter the right line ID;
   4. marks the line as a site trial (`PATCH /lines/{id}` with `{"on_site": true, "note": "LumaNest trial <first 8 characters of the request ID>"}`);
   5. creates the customer with the line and an invitation (`POST /customers` with `{"email", "name", "line_ids": [id], "send_invitation": true}` and `Idempotency-Key: trial-<request id>`). The provider then emails the customer their hub invitation;
   6. records the request as `active`, with the line, the customer and the expiry. The expiry is the line's `expires_at` when it is a time with a zone. Otherwise it is 24 hours after approval.

   If anything fails after step 4 begins (a provider error, a timeout, or a reply without a customer ID), the request goes to `needs_review` with a short error code. It is **never retried automatically**, because the provider may already have acted. Check the line and the customer in the provider panel, finish by hand if needed, then **resolve** it with a note. Then email the requester to say what happened: their status page tells them their request needs a closer look and to expect an email from us.
5. When the expiry passes, the trial reads as `ended` everywhere. Clean-up also records it as `ended`. The provider line expires on its own; the site doesn't change it.

A line marked `on_site` that is `active` or `expired` can sign in at `/renew`. That gives a trial customer a way to buy a renewal of the same line when the provider offers renewal prices for it.

## States

| State | Meaning | The requester sees |
| --- | --- | --- |
| `pending` | Waiting for the owner. | `pending` |
| `declined` | The owner declined it, optionally with a message (500 characters at most) that the status page shows. Declines aren't emailed: the requester sees the decline and the message only on their status link. | `declined` (+ `message`) |
| `activating` | An approval is in progress. | `setting_up` |
| `active` | The customer was created and invited. | `active` (+ `expires_at`) |
| `ended` | The expiry has passed. Every read treats an `active` trial past its expiry as `ended`, and clean-up records it. | `ended` (+ `expires_at`) |
| `needs_review` | An approval failed after the provider may have acted. | `support` |
| `resolved` | The owner closed a `needs_review` request, or one stuck in `activating` for more than 10 minutes, with a note (3–500 characters). | `support` |

## Limits

- **One trial per email address.** Letter case doesn't count. Any earlier request except a declined one blocks a new one (409 `trial_already_requested`).
- **Two requests per home network in 30 days.** Declined requests don't count (409 `trial_network_used`). When both limits apply, the network answer comes first, so a network that has used its trials can't find out whether other email addresses have asked. A network is an IPv4 address, or the /48 that an IPv6 address lies in, so one household's IPv6 addresses count once.
- **Request attempts.** Each network gets 3 attempts an hour, refused ones included, and at most 30 new requests an hour are accepted from everyone together (429 `trial_rate_limit`, with `Retry-After: 3600`). Only stored requests count toward the shared limit, so refused attempts can't use it up for everyone else. The counters are hashed buckets in `player_login_attempts` (purposes `trial-network` and `trial-shared`).
- **Status checks.** Each network gets 60 every 15 minutes (429 `trial_rate_limit`, purpose `trial-status`).
- **Queue size.** While 50 requests are pending, new ones are refused (503 `trials_busy`).
- **Honeypot.** The form has a hidden `website` field that people leave empty. A request that fills it is told it worked and gets a status link that leads nowhere, and nothing is stored or counted.
- The email, network and pending-count checks run in one `INSERT … SELECT … WHERE`, so two requests at the same moment can't both slip through.

## API

Successful public answers have `Cache-Control: private, no-store`. Errors have `Cache-Control: no-store` and are `{"error":{"code","message"}}`. Provider text never reaches a requester.

- `POST /api/trial`. Same-site `Origin` only. The body is `application/json`, 2 KB at most, a plain object: `{"name": 1–100 characters, no control characters; "email"; "device": one of android, fire, samsung, lg, roku, apple, web, other; "consent": true; "website": ""}`. The answer is `200 {"state":"pending","status_url":"/trial/status#<43-character token>"}`. Errors: 503 `trials_unavailable`, 400 `invalid_request`, 409 `trial_already_requested`, 409 `trial_network_used`, 429 `trial_rate_limit`, 503 `trials_busy`, 415 `json_required`, 413 `request_too_large` and 403 `origin_rejected`.
- `POST /api/trial/status`. Same-site `Origin` only, with the body `{"token"}`. The answer is `200 {"state","requested_at", "expires_at"?, "message"?}`, using the requester's states above. It never returns the email, name, line or customer. An unknown or malformed token is 404 `trial_not_found`, and more than 60 checks from one network in 15 minutes are 429 `trial_rate_limit`. This route keeps working while `TRIALS_ENABLED` is off, so people who already asked can still check.
- `GET /api/manage/trials` (owner). The answer is `{"trials":[{id, created, name, email, device, state, line_id, customer_id, expires, decided, attempted (true/false), error, message, resolution, same_network, same_email}], "pending_count", "ready", "enabled"}`, at most 200 rows. `ready` is whether visitors can ask for a trial now, and `enabled` whether `TRIALS_ENABLED` is `true`; the panel explains which setting is missing. Loading it also runs clean-up. Before migration `0011` is applied, the queue and its actions answer 503 `trials_storage_missing`, which names the migration.
- `POST /api/manage/trials` (owner, same-site `Origin`):
  - `{"action":"approve","id","line_id"}`. Success is `{"id","state":"active","message"}`. A failure after the provider may have acted is `{"id","state":"needs_review","message"}`. Refusals are 409 `trial_not_pending`, 409 `trial_line_in_use` (another trial already uses the line, or it belongs to a customer), 409 `trial_line_not_found`, 409 `trial_line_unusable`, 409 `trial_line_not_trial` (the line doesn't end about 24 hours from now, or reports no end at all) and 503 `invitations_not_ready`;
  - `{"action":"decline","id","message"?}`;
  - `{"action":"resolve","id","note"}`.

## Privacy and retention

D1 stores the requester's name, email address and device, and the request's state, timestamps, the owner's decision and any message. Once a request is approved, it also stores the provider line ID, the customer ID and the expiry. The status link and the network are kept only as hashes:

- the link token as `SHA-256('trial-status:' + token)`;
- the network as an HMAC-SHA256 under `PLAYER_COOKIE_KEY` (purpose `trial-client`) of `trial-network-v1\n<network>`;
- `email_key` as the same HMAC of `trial-email-v1\n<lowercased email>`, which finds repeats without comparing addresses.

The IP address itself is never stored or logged. Nothing goes to the provider until the owner approves, and then only the email address and name. Logs carry fixed codes only, with no personal data: `lumanest_trial_needs_review` with `{"code"}`, `lumanest_provider_request_failed` with `{"http_status","code"}` when the provider refuses or fails a request during approval, `lumanest_unexpected_error` with the error's name only, and `lumanest_cleanup_failed`.

Clean-up runs when either review queue loads, from **Run cleanup**, and alongside `/api/availability`. It:

- records `active` trials past their expiry as `ended` (`trial_requests_ended`);
- deletes declined and resolved requests 30 days after the owner's decision, and ended trials 180 days after they ended (`trial_requests_removed`).

Until then, a request keeps its email address from asking again, and its network counts toward the network limit for 30 days. Clean-up only touches D1: the provider customer (with the email address and name) and the trial line created on approval stay until the owner deletes them in the provider panel, for example on a deletion request. `/privacy` and `/terms` describe this.

## Turning it on

1. Apply migration `0011_trial_requests.sql` before deploying the code that uses it (see [deployment](deployment.md#free-24-hour-trials)).
2. Check that `MYBUNNY_API_KEY`, `CUSTOMER_PORTAL_URL` and `PLAYER_COOKIE_KEY` are set, and that the provider hub can send invitation emails.
3. Set the plain variable `TRIALS_ENABLED` to `true`. Until trials are ready, the **Trial requests** panel in `/manage` says they are off and which settings are missing. The **Try it free for 24 hours** link, the FAQ entry and the `/trial` form appear only while it is `true` and the settings above are present. To turn trials off, remove it or set any other value. Pending requests stay in the queue, and their status links keep working.

## When the provider documents its trial endpoint

Approval asks for a line ID only because the provider's API for creating trial lines isn't documented yet. All line handling is in `provisionTrialLine()` in `site/lib/trials.ts`. To create the trial line automatically, make that function call the documented endpoint with its own idempotency key, `trial-line-<request id>`, and return the new line's ID and expiry. Then drop the line ID field from the approval form. The claim, the customer creation, review and clean-up stay as they are. Never use `POST /lines` with `months` for a trial: it spends the wallet on a paid line.
