# Case desk against the real stack

This runbook takes Case desk's standalone site from a fresh project to a person who signs in through the real identity provider and works tasks, records and a workflow start in a real AgentFlow. Step 6 is a checklist that shows it all works.
The site is optional: the package and its Cases screen need none of it.

Case desk's own messages point at steps 2 and 4 by number, so keep the numbering when you edit this file.

## Before you start

You need these people:

- **Person A and person B.** Two accounts in the same organization. Each has an AgentFlow seat and has signed in to AgentFlow's own web app at least once. AgentFlow never creates an account for someone who arrives through an app. A person who has never signed in to AgentFlow itself is refused with `USER_NOT_PROJECTED`. For person B, that refusal would hide the one step 6 checks.
- **A suite admin or Reflexify staff**, for step 2 at the identity provider.
- **An AgentFlow admin in that organization**, for steps 3 and 4. They need the `integration.admin` permission, which the `admin` role has. Person A can be this admin.
- **An operator of the deployment**, for step 1: only they can set AgentFlow's `APP_ACCESS_ENABLED`.

You also need Node 22.9 or later, and pnpm.

Generate Case desk's keys first. Step 2 registers them, and step 4 writes to the `.env` file this creates.

```bash
pnpm install
pnpm setup-keys
```

`pnpm setup-keys` writes four files:

- `keys/private.pem` is Case desk's RS256 signing key, in PKCS#8 and readable only by you. It never leaves this machine.
- `keys/public.jwk.json` is its public half. Its `kid` is the key id Case desk signs with.
- `keys/registration.json` is the body that registers Case desk at the identity provider (step 2b). It carries the public key as well.
- `.env` is copied from `.env.example`. It gets a fresh `CASE_DESK_SESSION_KEY`, and `AGENTFLOW_PRIVATE_KEY_ID` set to the new `kid`.

Running the command again is safe. It keeps an existing key and an existing `.env`, and prints the `kid` to set. It always rewrites `keys/registration.json`. Git ignores `keys/` and `.env`.

**Be careful with `pnpm setup-keys --force`.** It makes a new key pair, with a new `kid`, and replaces `.env` with a fresh copy of `.env.example`. Everything you filled in is lost, including `AGENTFLOW_ISSUER` and the two ids from step 4. The new public key must then be registered at the provider again, with step 2b's `PATCH`.

The registration uses the origin `http://localhost:5173` and the client id `case-desk-dev`. To use others, set them in this command's environment, because it does not read `.env`:

```bash
CASE_DESK_ORIGIN=https://cases.example.com AGENTFLOW_CLIENT_ID=case-desk-prod pnpm setup-keys
```

The command fills in only the session key and the key id, so `.env` keeps `.env.example`'s default origin and client id. Put the same two custom values in `.env`.

`pnpm dev` serves only `http://localhost:5173`. With any other origin, run `pnpm start` wherever this runbook says `pnpm dev`: it builds the site (`pnpm build:site`), then serves it.

## Deploy it

Step 4 puts the package in the organization. In the project's folder, with `AGENTFLOW_URL` and `AGENTFLOW_TOKEN` set as the README's [Install the package](README.md#install-the-package) says:

```bash
pnpm build && pnpm seal
pnpm exec agentflow-app deploy --parameters parameters.json --wait
```

An admin approves the install at the link `deploy` prints. The guide's page on checking and deploying explains each refusal: `<AGENTFLOW_URL>/guides/en/xay-dung-ung-dung/kiem-tra-va-trien-khai` (Vietnamese: `<AGENTFLOW_URL>/guides/xay-dung-ung-dung/kiem-tra-va-trien-khai`).

## 1. AgentFlow

AgentFlow must run with `APP_ACCESS_ENABLED=true`, in OIDC mode, against the provider that step 2 uses. The flag defaults to off, and while it is off AgentFlow refuses every app's token. Ask the operator of your deployment to set it. AgentFlow's REST resource, `API_RESOURCE_URI`, defaults to `{HTTP_PUBLIC_BASE}/api/v1/rest`, which is `http://localhost:8080/api/v1/rest` on a local AgentFlow that sets no `HTTP_PUBLIC_BASE`.

Steps 3 and 4 need AgentFlow's web app, and you sign in to it at least once as each person.

Case desk's `AGENTFLOW_RESOURCE` must equal AgentFlow's `API_RESOURCE_URI` exactly, character for character. The provider writes the resource into the token as its `aud`, and AgentFlow compares `aud` exactly.

`.env` leaves `AGENTFLOW_RESOURCE` blank, and blank means `{AGENTFLOW_API_BASE_URL}/rest`:

- with the default API base URL, that is `http://localhost:8080/api/v1/rest`;
- when `AGENTFLOW_API_BASE_URL` is `{HTTP_PUBLIC_BASE}/api/v1`, it is `{HTTP_PUBLIC_BASE}/api/v1/rest`.

So as long as `AGENTFLOW_API_BASE_URL` is `{HTTP_PUBLIC_BASE}/api/v1`, the blank value gives AgentFlow's default resource. Set `AGENTFLOW_RESOURCE` only when AgentFlow's `API_RESOURCE_URI` is something else.

## 2. The identity provider

This step needs a suite admin or Reflexify staff. Use the provider that AgentFlow's `OIDC_ISSUER` names; below, `{issuer}` is that URL. Every request below goes to the provider's admin API with a suite admin's token (`Authorization: Bearer <suite-admin token>`).

**a. Add the REST resource to AgentFlow's own client.**

```http
PATCH {issuer}/api/admin/oauth_clients/{AgentFlow's OIDC_CLIENT_ID}
Content-Type: application/json

{ "resource_uris": [<every URI it already has>, "<AGENTFLOW_RESOURCE>"] }
```

`<AGENTFLOW_RESOURCE>` is the resource from step 1, for example `http://localhost:8080/api/v1/rest`. PATCH replaces the whole list, so read the client first and keep every URI it already has, including its MCP URI.

**b. Register Case desk.** Post the contents of `keys/registration.json`, which `pnpm setup-keys` wrote:

```http
POST {issuer}/api/admin/oauth_clients
Content-Type: application/json

<the contents of keys/registration.json>
```

With the default origin and client id, this registers the confidential client `case-desk-dev`:

- it authenticates with `private_key_jwt`;
- its redirect URI is `http://localhost:5173/agentflow/auth/callback`;
- its post-logout redirect URI is `http://localhost:5173/`;
- its back-channel logout URI is `http://localhost:5173/agentflow/auth/backchannel-logout`;
- it has the `authorization_code` and `refresh_token` grants;
- its scopes are `openid`, `profile`, `email` and `offline_access`;
- its public key travels in the body's `jwks` field, the client metadata field for a public key set (RFC 7591). That is `keys/public.jwk.json`, reduced to its public members.

If the provider does not take the key from the body, register `keys/public.jwk.json` at the key-registration URL or screen that its response names instead.

To set the key on an existing client, or to replace it later, send the body's `jwks` field on its own. `{AGENTFLOW_CLIENT_ID}` defaults to `case-desk-dev`:

```http
PATCH {issuer}/api/admin/oauth_clients/{AGENTFLOW_CLIENT_ID}
Content-Type: application/json

{ "jwks": <the jwks value in keys/registration.json> }
```

To replace the key, send both the old and the new key, switch Case desk to the new one, then `PATCH` again with only the new key.

Either way, the key's `kid` must match `AGENTFLOW_PRIVATE_KEY_ID` in `.env`.

**c. Seats: nothing to do.** Case desk's users need no seats of their own. The token names AgentFlow's resource, so the provider checks the person's seat against AgentFlow, the resource's owner. A person without an AgentFlow seat gets no token.

**d. Back-channel logout.** A hosted provider cannot reach `localhost`, so single logout from the provider does not arrive during a local run. Signing out from Case desk still works.

## 3. AgentFlow admin

As an AgentFlow admin with `integration.admin`, open **Admin → Apps**. That is the **Installed apps** page, at `/admin/apps`. Press **Register app** and fill in:

- **Name:** `Case desk`;
- **Key:** `case-desk`;
- **Client ID:** `case-desk-dev`. This must be the `AGENTFLOW_CLIENT_ID` Case desk signs in with. The page cannot change it later.
- **Who may use it:** **Only chosen people and groups** (the restricted audience). Then add person A under **Allowed**.
- **Ceiling:** the entity and the workflow come from the package that step 4 installs. After step 4, return here and set the ceiling: press **Ceiling** on Case desk's row, add **Case** at **Write** and **Open a case** at **Start and work**, then press **Save ceiling**. Without a ceiling Case desk works only until ceilings are required, and is then refused `APP_NOT_INSTALLED`. **Setting the ceiling takes one thing away:** a ceiling covers no form, so Case desk's **Records** table can no longer fetch the create form (`GET /entities/{id}/create-form` answers `403 APP_CEILING_DENIED`) and its **New record** button disappears. Create cases in AgentFlow under **Entities → Case**. Whether a ceiling should cover forms is an open decision, so treat the missing button as expected.

Press **Register**. Case desk is listed with its **Enabled** switch on.

Person B is a second account in the same organization. Leave them out of the audience.

## 4. Install the case desk package

Case desk's entity and workflow come from the project's own app package, built from `config/`: the entity Case (`case`) with its create form, and the workflow "Open a case" (`open_case`).
The package also carries the Cases screen, a UI module that AgentFlow opens inside its own pages.
Install it, then copy two ids into `.env`.

1. **Seal and deploy it** as "Deploy it" above says. Put person A in the Case desk users group and leave person B out.
   The Cases screen is optional here: the site does not need it.
2. **Create a few cases** before step 3's ceiling is set, because afterwards Case desk itself cannot create them. Make at least one with **Urgent** on and one with it off. Create them in AgentFlow under **Entities → Case** (**New record**).
   The Cases screen's **New case** button works too.
   Step 6's search and filter then have something to narrow.
3. **Copy the two ids** into Case desk's `.env`. The receipt holds no object ids; each is the UUID in the item's admin address:
   - the entity Case, from `/admin/entities/<id>`, as `CASE_DESK_ENTITY_ID`;
   - the workflow "Open a case", from `/admin/workflows/<id>`, as `CASE_DESK_WORKFLOW_ID`.

## 5. Case desk

Work in the project's folder. If you skipped "Before you start", run it now:

```bash
pnpm install && pnpm setup-keys
```

Fill in `.env`:

- `AGENTFLOW_ISSUER` is AgentFlow's `OIDC_ISSUER`. It must match the `issuer` in the provider's discovery document. The SDK compares the two as URLs, so after a path even a trailing slash counts.
- `AGENTFLOW_ORG_HINT` is needed only when person A belongs to several organizations. It is the organization's id, and Case desk sends it to the provider as `org_hint`.
- `CASE_DESK_ENTITY_ID` and `CASE_DESK_WORKFLOW_ID` come from step 4, item 3.
- `AGENTFLOW_API_BASE_URL` stays as it is (`http://localhost:8080/api/v1`) for a local AgentFlow. For a deployed one, set it to `{HTTP_PUBLIC_BASE}/api/v1`.
- `AGENTFLOW_RESOURCE` stays blank (see step 1).
- `CASE_DESK_ORIGIN` and `AGENTFLOW_CLIENT_ID` stay at their defaults (`http://localhost:5173` and `case-desk-dev`). If you set custom values in "Before you start", use those instead.
- Leave `CASE_DESK_SESSION_KEY`, `AGENTFLOW_PRIVATE_KEY_FILE` and `AGENTFLOW_PRIVATE_KEY_ID` as `pnpm setup-keys` wrote them.

Run `pnpm check-setup` until every line is ✓. It prints one line per check:

| Line | ✓ means | ✗ usually means |
|---|---|---|
| `configuration` | `.env` loads. The line names the client id and the origin. | It lists every problem, the same list that makes `pnpm dev` refuse to start. |
| `identity provider` | `{issuer}/.well-known/openid-configuration` answers. It names the issuer exactly as `AGENTFLOW_ISSUER` spells it, and it lists the authorization, token and key endpoints. | The provider is unreachable (the error's code is in brackets, `ECONNREFUSED` or `ENOTFOUND` for example), or discovery answered with another status. Or the issuer differs; the line shows both values. |
| `private_key_jwt` | The provider lists `private_key_jwt` among its token-endpoint methods. | It lists others, or discovery failed ("not checked"). A ✓ that says the provider does not list its methods is a warning. |
| `AgentFlow API` | `GET {AGENTFLOW_API_BASE_URL}/caller` without a token answers `401`. | AgentFlow is unreachable, or another status came back because the base URL is wrong. |
| `demo data` | Both ids are set. | It is never ✗. "not set: …" is a reminder of step 4. |

Some things `pnpm check-setup` cannot see:

- whether the provider holds Case desk's key and AgentFlow's resource;
- whether `APP_ACCESS_ENABLED` is on;
- whether Case desk is registered under Admin → Apps.

The first sign-in tests those, and step 7 lists what goes wrong.

Then run `pnpm dev` and open `http://localhost:5173`. Use exactly that address, not `127.0.0.1`: the sign-in cookie belongs to the host name. Case desk reads `.env` when it starts, so restart it after editing that file. With a custom origin, run `pnpm start` instead and open that origin, because `pnpm dev` serves only `http://localhost:5173`.

## 6. The walkthrough

Tick each box as it passes.

**Person A in the React app**, at `http://localhost:5173`:

- [ ] Opening Case desk sends person A to the provider. After they sign in, they land back on the inbox.
- [ ] The header shows person A's name and organization, as `name · organization`. The organization is left out while AgentFlow has no name on record for it.
- [ ] The app's identity comes from AgentFlow. The header's "Case desk" is also the app's built-in fallback, so it proves nothing. Instead, open `http://localhost:5173/agentflow/session`. It answers `{"signedIn":true,"caller":{…}}`, with `caller.app.key` equal to `case-desk` and `caller.app.name` equal to `Case desk`. That is the app AgentFlow resolved at sign-in from step 3.
- [ ] **Start a case** shows **Summary** and **Amount** (optional). Fill in **Summary**, for example `Refund for order 1042`, and **Amount**, for example `250`, then press **Start**. Case desk starts "Open a case" with those two values and returns to the inbox with "Case started. Its first task will appear in your inbox." Pressing **Start** with an empty **Summary** shows "Enter a summary for the case." and starts nothing.
- [ ] The inbox lists "Review case" for "Open a case"; the run is named after the summary you entered. Its status is **Claimed**, because a step assigned to one person is claimed for them when it opens. If the task is not there yet, wait a moment and reload.
- [ ] Opening the task shows **Release**, **Approve** and **Reject**. **Release** returns the task to the queue and shows **Claim**. After **Claim**, **Approve** and **Reject** appear again.
- [ ] Press **Approve**. Case desk returns to the inbox, and "Review case" is gone. The run created a case titled with the summary, and in AgentFlow, under **Entities → Case**, its status is now **Approved**. **Reject** would have set it to **Rejected**.
- [ ] **Records** lists the cases:
  - typing part of a title in **Search** and pressing Enter narrows the list;
  - ticking **Urgent only** narrows it to the urgent cases. The request is `POST …/records/query` in the Network panel, and the search box is hidden while the filter is on.
  - **New record** opens the create form, and **Create** adds a case that appears in the list. Check this only while Case desk has no ceiling. Once the ceiling of step 3 is set it is expected to be gone (see the troubleshooting table).
- [ ] **Tiếng Việt**, the language switch in the header, turns the elements Vietnamese: **Search** becomes **Tìm kiếm**, and **New record** becomes **Thêm bản ghi**. The app's own text changes too: **Records** becomes **Bản ghi**. **English** switches back.
- [ ] The session outlives its first access token, which lasts at most 10 minutes. Wait at least 10 minutes after Case desk last sent person A through the provider, with no action in Case desk in between: the elements do not poll, so a refresh happens only when you act, and an earlier item that silently went through the provider again restarts the clock. Open the browser's devtools and, in the Network panel, turn on **Preserve log** (Firefox calls it **Persist Logs**). Then open **Records**: it loads, and the Network panel shows no request to `/agentflow/auth/login`. Case desk has refreshed the token at the provider, and the new token still names AgentFlow's resource. If this fails, see step 7 for "Something went wrong (IDP_UNAVAILABLE)." and for a sign-in that repeats about every 10 minutes. Close the devtools afterwards: a log kept from here would hold sign-out's ID token and spoil the `eyJ` search under **No token in the browser**, which opens them only after signing in.
- [ ] **Sign out** ends at the provider. Its end-session page may send you back to Case desk, which then goes straight to the provider's sign-in. Either way, Case desk's session is gone.

**The plain page:**

- [ ] Signed in as person A (sign in again at `http://localhost:5173` first), `http://localhost:5173/plain` shows **My tasks** and **Records** with the same inbox and records. There is no second sign-in. Choosing a task opens it in the React app.
- [ ] Signed out (after **Sign out** in the React app, or in a private window), `/plain` shows "Sign in to see your work." Its **Sign in** link signs in and comes back to `/plain`.

**The refusals:**

- [ ] Person B signs in, in a private window or after person A has signed out. They land on "You're not in this app's audience. Ask an AgentFlow admin to add you under Apps." with the code `APP_NOT_ASSIGNED`. Then press **Sign out** on that screen. It ends person B's session at the provider, so person A can sign in again for the next box.
- [ ] With person A signed in, an admin switches Case desk's **Enabled** switch off under Admin → Apps. Person A's next action shows "Case desk is not installed, or was turned off, in your organization." with the code `APP_NOT_INSTALLED`; opening **Records** is enough. Switch it back on, then reload Case desk, which works again.
- [ ] Two refusals need a raw token, which the browser never holds: an app's token on an internal route (`403 ENDPOINT_NOT_PUBLIC`), and a token carrying `act` (`401 DELEGATED_TOKEN_NOT_ACCEPTED`). AgentFlow's own test suites prove both, so there is nothing to check here.

**No token in the browser.** Run these checks against the production build. Under `pnpm dev`, Vite appends an inline source map to every module (`//# sourceMappingURL=data:application/json;base64,…`), and base64 of `{"` is `eyJ`, so the search below would find false hits. The production build has no source maps. In the project's folder:

1. Stop `pnpm dev`, then run `pnpm start`. It builds the site (`pnpm build:site`) and serves it at the same origin, `http://localhost:5173`. Sessions live in memory, so the restart signs everyone out.
2. Open `http://localhost:5173` and sign in as person A.
3. Open the browser's devtools. In the Network panel, check that it is recording and turn on **Preserve log** (in Chrome; Firefox calls it **Persist Logs**). Then reload the page, so that the provider element's one-time `GET /agentflow/api/caller` is recorded too.
4. Use the app: the inbox, a task, **Records**, and a search. Person A's earlier task is done, so start another case first with **Start a case** if the inbox is empty.
5. Check the three boxes below before signing out.

- [ ] `document.cookie` holds no AgentFlow token. Case desk's session cookie, `agentflow_session`, is `HttpOnly`, so it does not appear there at all. In the Application panel its value is a random 43-character id. Cookies ignore the port, so other apps on `localhost` may show their own cookies here.
- [ ] `localStorage.length`, `sessionStorage.length` and `(await indexedDB.databases()).length` are all `0`.
- [ ] Searching the Network panel (Cmd+F or Ctrl+F inside it) for `eyJ` finds nothing. Every JWT starts with `eyJ`. The check must come before sign-out: sign-out's redirect to the provider carries the ID token as `id_token_hint`, as OpenID Connect RP-initiated logout recommends. That token goes only to the provider, and AgentFlow does not accept it.

When you are done, stop `pnpm start`. `pnpm dev` works again as before.

## 7. Troubleshooting

Case desk logs to the terminal it runs in. Lines starting `[agentflow]` come from the SDK's `onError`. Lines starting `[case-desk]` are errors that escaped a route. Both give the error's name and message, with any control character written as `\xNN` so a line stays one line, then in brackets up to two codes: the error's own and its direct cause's. Each is the provider's OAuth `error` where there is one (`invalid_client`, `access_denied`), and otherwise the error's code (`ECONNREFUSED`, `OAUTH_TIMEOUT`). The logs never print the cause itself, the provider's `error_description` or any response body, because those can hold tokens. They also leave out a code with characters an OAuth error code cannot have: the provider's error at `/agentflow/auth/callback` arrives in an address anyone can write.

| Symptom | Cause |
|---|---|
| `pnpm dev` or `pnpm start` exits with "Case desk is not configured:" and a list. | Each line names a variable in `.env` to fix. `pnpm check-setup` shows the same list. |
| The server exits with "Case desk has no build to serve (…): run `pnpm build:site` first." | Run `pnpm build:site`. |
| The browser shows "Sign-in or this page is unavailable right now", and the terminal has a line like `[case-desk] /agentflow/auth/login: TypeError: fetch failed (ECONNREFUSED)`. | Case desk cannot reach the identity provider (on an `/agentflow/auth/…` path) or AgentFlow (on an `/agentflow/api/…` path). The code in brackets says why: `ECONNREFUSED` means nothing listens at that address, and `ENOTFOUND` means the host name does not resolve. `ClientError: operation timed out (OAUTH_TIMEOUT)` means the provider did not answer in time. `pnpm check-setup` tests both hosts. |
| The provider shows an error about the client or the redirect URI. | Case desk is not registered (step 2b). Or `CASE_DESK_ORIGIN` or `AGENTFLOW_CLIENT_ID` differs from the registration. |
| `invalid_target`, on the provider's error page, in the address bar at `/agentflow/auth/callback?error=invalid_target…`, or in brackets at the end of an `[agentflow] auth/callback` line. | The resource is not on AgentFlow's client (step 2a), or `AGENTFLOW_RESOURCE` is not exactly the registered URI. |
| The browser stops at `/agentflow/auth/callback?error=…` showing `SIGN_IN_EXPIRED`. The terminal shows `[agentflow] auth/callback: AuthorizationResponseError: authorization response from the server is an error (access_denied)`, with the provider's error in brackets. | The provider refused the sign-in and sent it back. The code in brackets is the address's `error`, and the address's `error_description` says more. For example, `access_denied` with `no_seat` means the person has no AgentFlow seat (step 2c). `(OAUTH_AUTHORIZATION_RESPONSE_ERROR)` in its place means the `error` held characters an OAuth error code cannot have; read the address instead. |
| The browser stops at `/agentflow/auth/callback?code=…` showing `SIGN_IN_EXPIRED`. The terminal shows `[agentflow] auth/callback: ResponseBodyError: server responded with an error in the response body (invalid_client)`, or a `WWWAuthenticateChallengeError` line with a code in brackets. | The provider's token endpoint refused the code exchange, and the code in brackets is its reason. `invalid_client` means the public key is not registered (step 2b), or `AGENTFLOW_PRIVATE_KEY_ID` does not match its `kid`. `invalid_target` is the resource, as in the `invalid_target` row above. `invalid_grant` means the code expired or was already used; sign in again. The provider's `error_description` stays out of Case desk's log, and the provider's own log has it. |
| `SIGN_IN_EXPIRED` with no `[agentflow]` line. | The sign-in cookie is missing: Case desk was opened at another host name than `CASE_DESK_ORIGIN` (`127.0.0.1` instead of `localhost`, say), or more than 10 minutes passed at the provider. Open `CASE_DESK_ORIGIN` and sign in again. |
| "Sign-in did not complete (SIGN_IN_FAILED)." (`agentflow_error=SIGN_IN_FAILED`) | The provider issued tokens, but a later step failed. Case desk's terminal has an `[agentflow] auth/callback: …` line from the SDK's `onError` that says which. `token response is missing refresh_token, id_token or a sid claim` means the client lacks `offline_access` or the `refresh_token` grant (step 2b). `TypeError: fetch failed (ECONNREFUSED)`, or another code in those brackets, means AgentFlow is unreachable at `AGENTFLOW_API_BASE_URL`. The code says why, and `pnpm check-setup` checks the address. |
| "Sign-in did not complete (INVALID_TOKEN)." (`agentflow_error=INVALID_TOKEN`) | AgentFlow answered `401 INVALID_TOKEN`. When its detail, which the browser does not see, is "app access is not enabled", `APP_ACCESS_ENABLED` is off (step 1). It is also the answer when `AGENTFLOW_RESOURCE` differs from AgentFlow's `API_RESOURCE_URI`, because the token's audience is then one AgentFlow does not accept. |
| `APP_NOT_INSTALLED` ("Case desk is not installed, or was turned off, in your organization.") for everyone. | The client id in Admin → Apps differs from `AGENTFLOW_CLIENT_ID`. It is also the answer when the app is registered in another organization, or its **Enabled** switch is off. |
| `APP_NOT_ASSIGNED` for person A. | Person A is not under **Allowed** in Case desk's audience (step 3). |
| `USER_NOT_PROJECTED` ("Your AgentFlow account isn't set up in this organization yet."). | The person has never signed in to AgentFlow itself in that organization. |
| After fixing a sign-in refusal, the same message stays on screen. | The code is in the address (`?agentflow_error=…`). Open `http://localhost:5173/` again. |
| "Case desk couldn't load your session from AgentFlow. Reload the page to try again." | The provider element's `GET /caller` failed, and the code under the message says how. `IDP_UNAVAILABLE` means Case desk could not refresh the session at the provider; the next row explains the terminal line. `HTTP_500`, with a `[case-desk] /agentflow/api/caller: TypeError: fetch failed (ECONNREFUSED)` line in the terminal, means AgentFlow is unreachable. `NETWORK_ERROR` means Case desk itself did not answer. |
| "Something went wrong (CODE)." ("Đã có lỗi xảy ra (CODE).") on an element. | The element's own request failed, and the code says how. **`IDP_UNAVAILABLE`** means Case desk could not refresh the session's access token at the provider. The session is kept, so the next action tries again. The terminal's `[agentflow] api: IdpUnavailable: the identity provider could not refresh the session (…)` line gives the reason in brackets. `invalid_target` means the provider will not issue a token for AgentFlow's resource on refresh (step 2a). `invalid_client` means it no longer accepts Case desk's key (step 2b). `OAUTH_TIMEOUT` means it did not answer in time. `OAUTH_RESPONSE_IS_NOT_CONFORM` means it answered with an error status but no OAuth error, a 5xx for example. No code at all means it could not be reached; `pnpm check-setup` says why. **`HTTP_500`**, with a `[case-desk] /agentflow/api/…: TypeError: fetch failed (…)` line, means AgentFlow is unreachable at `AGENTFLOW_API_BASE_URL`; `ECONNREFUSED` in the brackets means nothing listens there. |
| Case desk sends you through the provider again about every 10 minutes, usually without asking you to sign in. | The access token Case desk got by refreshing is refused, and the elements treat that as signed out. Open the devtools' Network panel with **Preserve log** on, and wait for the next time. A `401` on `/agentflow/api/…` whose response has the type `INVALID_TOKEN` means the refreshed token's audience is not AgentFlow's resource: the provider honoured the resource at sign-in but dropped it on refresh. `AGENTFLOW_RESOURCE` is right, or sign-in would fail too; the provider's handling of `resource` on the refresh grant needs fixing. A `401` with the type `NOT_SIGNED_IN`, and an `[agentflow] api: NotSignedIn: the identity provider refused to refresh the session (invalid_grant)` line, means the provider refused the refresh token itself. |
| At sign-out, or after a refused sign-in, the terminal shows `[agentflow] auth/logout: WWWAuthenticateChallengeError: … (invalid_client)` (or the same on `auth/callback`), and nothing else goes wrong. | The provider's revocation endpoint does not accept a `private_key_jwt` client yet: Reflexify Identity answers `invalid_client` with "private_key_jwt verification lands in a later phase" whatever the assertion's audience. Case desk revokes on a best-effort basis, so sign-in and sign-out still work; the refresh token simply stays valid until it expires. Nothing to fix on Case desk's side. |
| "Not configured: set CASE_DESK_ENTITY_ID in .env and restart Case desk." (or `CASE_DESK_WORKFLOW_ID`) | The id is missing. Case desk reads `.env` only when it starts. |
| **Start a case** says "This workflow can't be started here." | The package is not installed, or person A is not in Case desk users (step 4), or `CASE_DESK_WORKFLOW_ID` names another workflow. |
| **Records** has no **New record** button. | Most likely the ceiling of step 3: it covers no form, so the create form is refused `403 APP_CEILING_DENIED` and the table hides the button. This is expected once a ceiling is set. Without a ceiling, person A may not create records: they are not in Case desk users, or their role lacks `entity.write` (step 4). |
| A form says "This field can't be edited here." or "This form has a required field that can't be edited here." | The elements render text, email, date, date and time, number, integer, yes/no and single-select fields. Anything else is shown but cannot be filled in. |
| After restarting Case desk, everyone is signed out. | Sessions are kept in memory, so a restart drops them. Sign in again. |
