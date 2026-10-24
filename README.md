# Case desk

> This is the starter template, not a project to rename. After `pnpm install`, run `pnpm exec agentflow-app init ../<your-app> --prefix <org>` (or `pnpm exec agentflow-app init ../<your-app> --from <draft.zip>` for a draft from Admin > Apps > Pack) to make your project as a new folder. The template keeps a standalone site and a UI module: add `--no-site` to leave the site out, and `--no-ui` to leave the module out. To use this copy as your project instead, follow `reference/template-copy.md` in the `agentflow-app-release` skill.

`acme/case-desk` is an AgentFlow app, built with the AgentFlow SDK. It holds:

- **An app package** that AgentFlow installs, described by `config/`. `agentflow-app build` turns `config/` into `package/`, which is committed, so a reviewer reads what ships.
  It holds the `case` entity, its create form, a view, its access, a rule and a stage model (`config/entities/case.json`), and the workflow "Open a case" (`config/build/open-case.mjs`).
- **A UI module** that ships inside the package, and that AgentFlow opens in its own pages, at `/apps/<installation key>/`.
  It is the Cases screen (`src/module/`): a list of cases with a "New case" dialog, on the AgentFlow UI kit.
- **A standalone site** (`server/`, `src/`, `static/`): a React app and a small Hono server, on an origin of their own, that sign people in and render the SDK's elements over the installed entity and workflow. Its "Start a case" screen is a form of the site's own, because "Open a case" takes its input from a schema and AgentFlow draws no start form for a schema: the site asks for the summary and amount and starts the run as the signed-in person with them as `params` (`src/StartCase.tsx`).

## Commands

These commands run in the project's folder, after `pnpm install`:

| Command | What it does |
|---|---|
| `pnpm build` | Writes `package/` from `config/`. |
| `pnpm check` | Checks that the committed `package/` is what `config/` builds, and changes nothing. |
| `pnpm test` | The Vitest tests, if the project has any, then `pnpm check`. |
| `pnpm exec agentflow-app keygen --key-id <id>` | Once per publisher: writes the signing key `keys/<id>.pem` and prints where it is and its key id. Never commit `keys/`. |
| `pnpm seal` | Signs `package/` with the ed25519 key in `keys/` into `dist-app/acme-case-desk-<version>.afpkg`. Raise `version` in `config/package-manifest.json` for every release. |
| `pnpm exec agentflow-app lint` | Sends `package/` to the AgentFlow at `AGENTFLOW_URL` and prints the problems it finds; it stores nothing. |
| `pnpm exec agentflow-app deploy --wait` | Uploads the sealed package and asks for it to be installed; an admin approves it at the link it prints. |

`pnpm build` also puts the module into `package/ui/` (git ignores that folder).

`pnpm demo` serves the Cases screen on in-memory sample data at `http://localhost:5174/module.html`: nothing is sent anywhere, and `?empty` shows no cases, `?fail` a refused create.

The site's own signing key sits in `keys/` too, and `pnpm seal` skips it.

`node_modules/@reflexify/agentflow-app-builder/README.md` documents `config/`. [Install the package](#install-the-package) puts it in an organization.

## The module

The module's files, in `src/module/`:

- `module.tsx` is the entry: `mount(root, host)`, which AgentFlow imports and calls;
- `mount.tsx` puts the stylesheet in the shadow root and renders the screen, following the host's language and theme;
- `CasesScreen.tsx` and `NewCaseDialog.tsx` are the screen and its dialog;
- `cases-api.ts` is what the screen needs from AgentFlow, `http-cases-api.ts` does it over the published record operations, and `memory-cases-api.ts` is the fake the demo and the tests use;
- `kit.tsx` wraps the kit's elements for React, and `icons.tsx` holds the icons;
- `text.ts` holds the English and Vietnamese text, and `styles.css` the module's one stylesheet;
- `demo.tsx` mounts the module on the fake, for `module.html`.

## Install the package

1. **Seal it.** In this folder:
   ```bash
   pnpm build && pnpm exec agentflow-app keygen --key-id dev-acme && pnpm seal
   ```
   - `pnpm build` writes `package/` from `config/`.
   - With the module, it also writes the module into `package/ui/`: it builds it with Vite or, when `ui` in `agentflow.app.mjs` names a `prebuilt` folder, copies that folder as it is.
   - `keygen` writes the signing key `keys/dev-acme.pem`, readable only by you, and prints where it is. It never overwrites a key, so leave it out when you seal again. Git ignores `keys/`: never commit it.
   - `pnpm seal` signs `package/` with the one ed25519 key in `keys/`, into `dist-app/acme-case-desk-<version>.afpkg`. Sealing the same package again changes nothing. A changed package under the same version is refused: raise `version` in `config/package-manifest.json`.
2. **Connect to AgentFlow.** Ask an admin of your organization for a service principal key (`afk_…`), made under **Admin → Service principals** for a principal whose role holds `integration.admin`. Then, in this shell:
   ```bash
   export AGENTFLOW_URL=https://agentflow.example.com
   read -rs AGENTFLOW_TOKEN && export AGENTFLOW_TOKEN
   ```
   `AGENTFLOW_URL` is the address you open AgentFlow at. `read -rs` takes the key without showing it or keeping it in your shell history. Never write the key into a file.
3. **Check it.** `pnpm exec agentflow-app lint` sends `package/` to AgentFlow, which runs its own checks and stores nothing. It prints each problem as `<code>  <object>  <path>: <message>`, or `no problems`.
4. **Deploy it.**
   ```bash
   pnpm exec agentflow-app deploy --parameters parameters.json --wait
   ```
   - It uploads `dist-app/acme-case-desk-<version>.afpkg`, asks for it to be installed, and prints `awaiting approval: <link>`. An admin opens the link, which leads to the app's setup page, completes the setup (any setting `parameters.json` left out), reviews what the app asks for, and presses **Approve and activate** (or approves it and activates it later). `--wait` waits until it is installed; Ctrl-C stops the waiting, not the deployment.
   - `parameters.json` holds the setup answers: `{ "app_users": "<the group's id>" }`, the group of the app's users. Leave `--parameters` out to fill everything in on the setup page.

Installing asks for `app_users`, the group of the app's users (its label is "Case desk users"). Who may do what comes with the package: everyone in that group may read, list and create cases, may change the cases they opened, and may start "Open a case", which runs as the person who starts it. Its step "Review case" goes to that same person, who decides with **Approve** or **Reject**. When the person who opened the case cannot take the review, it goes to the app's users group, `app_users`, instead.

A role does not come from a group, so give the group's members a role with `entity.read`, `entity.list` and `entity.write`. The package has no trigger, so there is nothing to turn on after the install. This paragraph, and the parts of this file about cases, describe the starter's own objects: rewrite them when your objects replace those.

## The standalone site

The site's commands, in the project's folder:

| Command | What it does |
|---|---|
| `pnpm setup-keys` | Writes Case desk's signing key and its identity-provider registration body to `keys/`, and creates `.env` with a fresh session key. |
| `pnpm check-setup` | Checks the configuration, the identity provider and AgentFlow, one ✓ or ✗ line each. |
| `pnpm dev` | Runs Case desk with hot reload, always at `http://localhost:5173`. It ignores `PORT`, so a custom `CASE_DESK_ORIGIN` needs `pnpm start`. |
| `pnpm start` | Builds the site (`pnpm build:site`), then serves the production build with the same server. Sessions stay in memory, so a restart signs everyone out. It listens on `PORT` (5173 by default). `CASE_DESK_ORIGIN` must be the address the browser uses. |

`vite preview` does not work here: it serves the built files without the server's routes. Use `pnpm start`.

Before the first sign-in, you must set up AgentFlow and the identity provider, and install the package. [RUNBOOK.md](RUNBOOK.md) covers that, then gives a checklist that shows everything works.

### Layout

- `server/` holds the server:
  - `app.ts` is the Hono app;
  - `config.ts` reads `.env`;
  - `checks.ts` holds the checks behind `pnpm check-setup`;
  - `main.ts` is the production entry point;
  - `vite-plugin.ts` mounts the server inside Vite's dev server.
- `src/` is the React app.
- `static/plain.html` is the plain page.
- `scripts/` holds `pnpm setup-keys` and `pnpm check-setup`.
