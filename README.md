# Cephalon

A modular TypeScript Discord bot. `/ping` reports websocket latency; `/goal`
manages persistent daily goals, reminders, and check-ins in French.

## Setup

Requires Node.js 24 LTS, npm, and PostgreSQL 16 or newer. Docker is optional.

```sh
npm ci
```

Copy `.env.example` to `.env` (`Copy-Item .env.example .env` in PowerShell),
then fill in these variables:

| Variable | Purpose |
| --- | --- |
| `DISCORD_TOKEN` | Your application's bot token |
| `DISCORD_CLIENT_ID` | Application ID |
| `DISCORD_GUILD_ID` | Server ID for guild command registration |
| `DATABASE_URL` | Private PostgreSQL connection URL, including database name |

All values are required at bot startup. `deploy:commands` only needs the Discord
variables; database migration commands only need `DATABASE_URL`.
Never commit or share `DISCORD_TOKEN`, `DATABASE_URL`, or `.env`.
Keep database credentials in `.env` or your host's environment settings.
Use the database provider's TLS settings when connecting outside a private network;
do not disable certificate verification.
Invite the application with `bot` and `applications.commands` scopes.
Allow **View Channel**, **Send Messages**, **Embed Links**, and **Read Message
History** in the goal channel, plus **Send Messages in Threads** for threads.
No privileged gateway intents are required. Only the Guilds intent is enabled.
Commands must be deployed again to register the new `/goal` command.

## Local commands

```sh
npm run db:migrate
npm run deploy:commands
npm run dev
```

Configure a PostgreSQL database before migrating. `db:migrate` applies the included
versioned migrations and is safe to rerun. `npm run db:generate` generates a new
migration after changing `src/db/schema.ts`; generation needs no database or secrets.
The bot verifies the database schema before logging into Discord and fails clearly
if migrations are missing.

Register commands manually when definitions change. Registration replaces this
application's complete command list in the configured guild. Starting the bot
never registers commands. For production:

```sh
npm run build
npm run db:migrate:prod
npm start
```

If PowerShell blocks `npm.ps1`, use `npm.cmd` instead of `npm`.

## Docker / Coolify

```sh
docker build -t cephalon .
docker run --rm --env-file .env cephalon node dist/db/migrate.js
docker run -d --name cephalon --restart unless-stopped --env-file .env cephalon
docker logs -f cephalon
```

The multi-stage build runs compiled JavaScript as a non-root user with production
dependencies. Migration SQL and metadata are included in the final image.
Environment files are excluded. No inbound bot ports are needed.

In Coolify, manually provision a PostgreSQL resource with persistent storage and
backups. Connect it to the bot's private network and add `DATABASE_URL` using the
database's internal host and credentials. Keep the existing three Discord
variables. Use the Dockerfile and run `node dist/db/migrate.js` as a pre-start
release step in the built image, before `node dist/index.js`. Alternatively run
that migration command once in a one-off container using the new image and the
same environment/network. Do not start the bot on an unmigrated database.

Register slash commands separately with `npm run deploy:commands` locally.
The bot and container start never redeploy commands or automatically migrate.
Configure a restart policy and allow roughly 30 seconds for graceful shutdown.
One bot replica is recommended; database locks also protect overlapping replicas
during redeploys. PostgreSQL must support session advisory locks: use a direct
connection or session-mode pooler, not transaction-mode PgBouncer.

## Goal commands

```text
/goal create user:@Deniz title:"Abdos pendant un mois" start_date:2026-10-05 duration_months:1 reminder_time:18:00
/goal create user:@Deniz title:"Marcher" start_date:2026-10-05 duration_days:30 reminder_time:18:00 timezone:Europe/Brussels
/goal list
/goal show goal_id:12
/goal stop goal_id:12
/goal set-day goal_id:12 date:2026-10-05 status:yes
```

Exactly one of `duration_days` (1–3660) and `duration_months` (1–120) is required.
Dates must be real `YYYY-MM-DD` dates; times must be `HH:mm`. The default timezone
is `Europe/Brussels`; other valid IANA zones are supported. Target users must be
human members of the server, and the creation channel must be accessible.

Past start dates, including fully historical goals, are accepted. End dates are
inclusive: October 5 plus one calendar month ends November 4. Month addition clamps
to the destination month's last day, then subtracts one day; January 31 plus one
month in 2026 ends February 27. Daily reminders run only within that date range.

The target alone can answer Yes/No, only for the current local day while the goal
is active. A response is stored atomically, then Yes/No buttons are disabled;
recap remains available to everyone in that server. If editing a deleted message
fails, the saved answer remains valid and database checks prevent a second answer.
Only the creator or a Discord administrator can stop a goal or use `set-day`.
`set-day` explicitly corrects an existing answer or backfills a past/current date,
even for stopped/finished goals; it does not allow future dates. Backfilling today
before its reminder is sent suppresses that day's reminder.

`list` shows your active goals as creator or target. `show` and recap display
every goal date with paginated embeds: ✅ yes, ❌ no, ⚪ past unanswered,
⏳ today pending, ⬜ future. Success rate is completed / (completed + no + past
unanswered); today pending and future dates are excluded. A zero denominator
shows 0.0%. Remaining counts today pending and future dates.

## Persistence and reminder delivery

PostgreSQL is the source of truth. `goals` stores server/channel, creator/target,
title, inclusive start/end dates, reminder time, IANA timezone, active state, and
timestamps. `goal_checkins` references a goal and stores date, response status,
response timestamp, Discord message ID, and durable delivery bookkeeping.
A unique `(goal_id, checkin_date)` index prevents duplicate daily records.
Response states are `pending`, `yes`, `no`, and `missed`; delivery states are
`queued`, `sending`, `sent`, `uncertain`, and `skipped` (manual backfill).

A minute poll queries the database under a PostgreSQL session lock, then durably
claims each due reminder before sending. Restarting at 18:02 catches up a missing
18:00 reminder for **today only**. Previous dates never generate historical pings;
missing historical records are shown as unanswered. Pending past check-ins become
missed. DST uses each goal's IANA zone: a skipped spring time is caught up after
the gap, while a repeated autumn time still has only one daily record.

Access errors, departed members, and explicit Discord rejections are retried at
15-minute intervals, only while today's reminder is still eligible. One failing
goal does not stop others. Expired goals are deactivated. Stopping prevents new
claims, though a send already in flight may finish. Deleted delivered messages
are never automatically recreated.

Discord sends and PostgreSQL commits cannot be atomic. A crash between the durable
claim and the saved message ID leaves an **uncertain delivery**. The worker searches
up to 500 recent channel messages for the matching button IDs and restores the
message ID if found. Discord nonces also prevent brief duplicate requests. An
uncertain reminder is **never automatically resent**: this avoids duplicate pings,
but a crash immediately before sending can leave that day's reminder undelivered.
Unresolved deliveries are visible in `show`/recap and logs; further reconciliation
runs hourly. Use `set-day` for missing results after checking the channel.
Server logs report operation context and known error codes without raw errors,
tokens, database URLs, or query parameter values.

## Verification

```sh
npm run build
npm test
```

Tests type-check the application, configuration, and tests, then cover date/duration
rules, historical starts, due windows, DST, recap percentages/pagination, component
IDs, and environment validation. PostgreSQL integration tests are opt-in:

```powershell
$env:TEST_DATABASE_URL = '<connection URL for your isolated cephalon_test database>'
npm.cmd test
Remove-Item Env:TEST_DATABASE_URL
```

The dedicated test database must be named `cephalon_test` or
`cephalon_test_<suffix>`. Integration tests apply migrations, insert isolated
fixtures, and remove only their own rows. They use simulated Discord responses,
never connect to Discord, and never load `DATABASE_URL` or `.env`. Without
`TEST_DATABASE_URL`, that suite is skipped. It covers database constraints,
parallel workers, restart recovery, authorization, atomic answers, backfill,
uncertain sends, and channel/member failures.

Drizzle Kit's legacy dev-only loader uses an esbuild override to retain a patched
transitive version. Migration generation and tests are verified with that override.

## Adding commands and events

Create a command module implementing `Command` with `data` and `execute`, then
add it to the list in `src/commands/index.ts`. The same registry drives dispatch
and registration. Keep event handlers in `src/events/` and wire them in
`src/index.ts`. Commands lasting over three seconds should defer their reply.
Goal business rules live in `src/services/`, and component dispatch lives in
`src/components/`. Discord users receive helpful validation errors and generic
unexpected errors; logs omit raw errors to protect secrets.
