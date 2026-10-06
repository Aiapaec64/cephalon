# Cephalon

A modular TypeScript Discord bot. `/ping` reports current Discord websocket latency.

## Setup

Requires Node.js 24 LTS and npm. Docker is optional.

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

All values are required. Never commit or share `DISCORD_TOKEN` or `.env`.
Invite the application with `bot` and `applications.commands` scopes.
No privileged gateway intents are required.

## Local commands

```sh
npm run deploy:commands
npm run dev
```

Register commands manually when definitions change. Registration replaces this
application's complete command list in the configured guild. Starting the bot
never registers commands. For production:

```sh
npm run build
npm start
```

If PowerShell blocks `npm.ps1`, use `npm.cmd` instead of `npm`.

## Docker / Coolify

```sh
docker build -t cephalon .
docker run -d --name cephalon --restart unless-stopped --env-file .env cephalon
docker logs -f cephalon
```

The multi-stage build runs compiled JavaScript as a non-root user with production
dependencies. Environment files are excluded from the image. No inbound ports
are needed. In Coolify, use the Dockerfile and configure the three variables
directly. Register commands separately before running the bot.

## Adding commands and events

Create a command module implementing `Command` with `data` and `execute`, then
add it to the list in `src/commands/index.ts`. The same registry drives dispatch
and registration. Keep event handlers in `src/events/` and wire them in
`src/index.ts`. Commands lasting over three seconds should defer their reply.
Discord users receive generic errors; logs omit raw errors to protect secrets.
