# kvsarchive-bot

Discord community bot for the **kvsarchive** server.

## Stack

- Node.js 20+
- discord.js v14
- better-sqlite3
- Railway-compatible persistent storage
- optional OpenAI API support

## Start

```bash
npm install
npm start
```

## Environment

Required:
- `DISCORD_TOKEN`

Recommended:
- `DB_PATH` or Railway `RAILWAY_VOLUME_MOUNT_PATH` for persistent SQLite storage

Optional:
- `OPENAI_API_KEY`
- `OPENAI_MODEL`

Do not commit secrets to the repository.

## Important owner commands

- `/setup` — posts official panels
- `/doctor` — diagnoses bot/server configuration
- `/archive-server` — exports the current live server structure and IDs
- `/syncautoroles` — repairs verification autoroles
- `/synclevelroles` — repairs level roles

## Verification fallback

The support/ticket panel is intentionally kept reachable before verification. Members who cannot complete DM verification can open **Verification Help** and staff can assist them.

## Server map

After structural changes, run `/archive-server` and keep the generated map as the current source of truth for category/channel/role IDs.

## Development

The current production bot is still largely implemented in `index.js`. Major refactors should preserve behaviour and database compatibility. See `KVSARCHIVE_CODEX_HANDOFF.md`.

## AI ticket support

Support tickets are AI-first. The bot attempts to answer/troubleshoot before escalating.

Routing rules:
- verification actions -> lowest active staff role with sufficient role-management permission
- moderation reports/actions -> lowest active moderation-capable staff role
- management/configuration issues -> management-capable staff
- purchases, paid roles, refunds, money, or ownership-only requests -> server owner
- tickets opened by the configured owner run in **owner test mode**: AI replies work, but staff escalation pings are suppressed

The ticket panel includes Verification Help, General Support, Member Report, Purchase / Role, and Owner Request. Claiming a ticket pauses automatic AI replies so a human can take over cleanly.

The old `/verifyhelp` shortcut has been removed; verification support should start from the visible ticket panel.

Running `/setup tickets` refreshes the existing support panel message when possible instead of blindly posting a duplicate.
