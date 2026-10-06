# KVSArchive — Codex Handoff

## Project

Repository: `kvvux/kvsarchive-bot`

Discord bot: **stupid assistant**

Runtime:
- Node.js 20+
- discord.js v14
- better-sqlite3
- Railway deployment/persistent volume
- optional OpenAI integration for `/ask` and staff-application summaries

The bot is currently a large single-file implementation in `index.js`. Preserve production behaviour before doing any major refactor.

## Current server direction

KVSArchive is a dark/archive-styled community server with:
- verification
- support tickets
- moderation and mod cases
- automod
- XP / level roles
- media contribution tracking
- private clubs
- community/fun commands
- games
- staff applications
- AI assistant features
- logging / diagnostics

The server now has a much larger PFP/media section than the original build, including channels for male/female PFPs, GIFs, banners, anime, manga and more. An external PFP bot is also present.

## Recent ChatGPT branch work

Branch:
`chatgpt/kvsarchive-polish-2026-10-06`

Recent changes include:
- welcome copy no longer points users at one old PFP channel; it directs them to the broader PFP/media category
- verification panel tells users to use support if DMs/verification fail
- support tickets are intended to remain visible before verification
- a dedicated **Verification Help** ticket type was added
- verification-help tickets include a staff-only manual verification action
- support-channel permissions are repaired on bot startup and when the ticket panel is posted
- `/archive-server` exports a JSON + Markdown snapshot of live categories, channels, IDs, roles, permission overwrites, bots/apps, emojis/stickers and slash commands
- `/username` generates 3- or 4-character username ideas
- `/doctor` checks whether support appears reachable before verification

## Source of truth for server IDs

Do not assume historical IDs are still correct.

Run:

`/archive-server`

in the live server and use the generated `kvsarchive-server-map.json` / `.md` as the current source of truth.

When server structure changes, refresh the export.

## Important verification/support rule

Unverified users MUST be able to access the support panel.

Reason:
if DM verification breaks, DMs are disabled, or role assignment fails, members still need a route to staff.

Verification Help tickets may be used by authorized staff to manually verify the opener. Preserve audit logging and role hierarchy safety.

## PFP/media rule

Do not collapse the new PFP/media section back into a single PFP channel.

The server has multiple choices now and the welcome flow should reflect that.

The existing stupid-assistant media contribution system may still reference historical archive PFP/banner channels. Do not automatically apply those old cooldown/contribution rules to external PFP-bot feed channels without inspecting the live layout first.

## Heavy engineering work for Codex

When asked to do a larger pass:

1. inspect the current branch/repo and live server map
2. test the current bot before refactoring
3. preserve Railway SQLite persistence
4. preserve command names/behaviour unless intentionally changed
5. split the huge `index.js` carefully into modules
6. avoid destructive live-server changes

Suggested target structure:

```
src/
  config/
  commands/
    community/
    moderation/
    owner/
  events/
  systems/
    verification/
    tickets/
    moderation/
    leveling/
    media/
    clubs/
    community/
    staff-apps/
  database/
  utils/
```

## Server-operation rules

When changing the live Discord server:
- inventory first
- preserve existing content
- do not delete/recreate channels or roles merely for neatness
- preserve channel permission intent
- keep support accessible to unverified members
- keep staff/private areas private
- make changes reversible where practical
- refresh the server archive after structural changes

## Product goal

Stupid assistant should feel like a polished community/server-management bot, not a pile of unrelated commands.

Prioritize:
- reliable verification/support
- useful moderation
- clean error messages
- good audit logs
- sensible diagnostics
- community features that members actually use
- consistent archive visual style
- safe configuration and deployment

## AI-first ticket handler

The current support design is AI-first rather than immediate staff pinging.

- The bot replies to the ticket opener automatically while the ticket is unclaimed.
- Claiming a ticket pauses automatic AI replies.
- Verification troubleshooting can stay AI-only until a real role/manual-verification action is required.
- Human escalation is permission-aware and prefers the lowest active staff role that can actually perform the requested action.
- Member reports force moderation escalation.
- Purchase / Role and Owner Request tickets force owner escalation.
- If AI is unavailable, the bot falls back to human escalation instead of silently stranding a support ticket.
- Owner-opened tickets are test mode: no staff escalation pings; only the owner is mentioned.
- Manual verification is guarded so staff without sufficient Manage Roles/hierarchy cannot use the bot as a privilege bypass.
- `/verifyhelp` was removed; verification help is intentionally accessed from the ticket panel visible to unverified members.
- `/setup tickets` should refresh an existing matching panel instead of creating needless duplicates.

When changing routing, preserve the distinction between answering questions and performing privileged actions. AI may explain/troubleshoot, but it must never claim to have performed staff/admin actions it did not actually execute.
