require('dotenv').config();

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
  AttachmentBuilder,
  MessageFlags,
  ActivityType,
} = require('discord.js');

const Database = require('better-sqlite3');

// ============================================================================
// kvsarchive — rebuilt / hardened edition
// Node 20+ / discord.js v14
//
// Design goals:
// - Reliable Railway deployment + persistent SQLite
// - Simple DM verification (4-digit code, no image captcha)
// - Exact autoroles after verification
// - MEE6-style XP / levels / role rewards / public level-up pings
// - Carl-bot-style logging / moderation / automod / diagnostics
// - Tickets + staff applications + transcripts
// - Private join-to-create clubs + owner controls
// - PFP/banner contribution tracking + MEDIA POSTER unlock
// - Games / community tools without fragile third-party image APIs
// ============================================================================

const CONFIG = {
  GUILD_ID: '1539766406336479302',

  OWNER_IDS: [
    '551313949405085696',
  ],

  ROLES: {
    VERIFY: '1539772558629413036',

    MEMBER: '1539773112504160256',
    MEMBER_TAG: '1539777991901450360',
    MISC: '1539778263507935352',

    LOYAL_MEMBER: '1539774815701958716',
    MEDIA_POSTER: '1539783985188839434',

    ADMIN: '1539778556018823168',
    SR_MOD: '1539777299942211644',
    MOD: '1539775895810867320',
    ASCENDANT: '1539775373028626512',
    MANAGEMENT: '1539779210212548728',

    LEVELS: {
      1: '1539781935188943010',
      5: '1539781912674041866',
      10: '1539781884106510377',
      20: '1539781818734088264',
      40: '1539781779999690892',
      60: '1539781750631436348',
      80: '1539781520124813372',
      100: '1539781401300312084',
    },
  },

  CHANNELS: {
    VERIFY: '1539770446843744336',

    WELC: '1539770679443070996',
    RULES: '1539770701156720750',
    PSA: '1539770732899336292',
    TICKETS: '1539770774968344586',

    CHAT: '1539770804043260007',
    CMDS: '1539770844149059644',
    MEDIA: '1539770868241137796',
    SPECIALTY_INFO: '1539770890068303982',

    PFP: '1539770933760229446',
    BANNER: '1539770959861645383',
    ANYTHING: '1539770985887170661',

    PRIVATE_CLUB_CMDS: '1539771021953994782',
    CLUB_1: '1539771074265227294',
    CLUB_2: '1539771110801801297',
    CLUB_3: '1539771153080524800',
    CREATE_PRIVATE_CLUB: '1539771179785658449',

    STAFF_CHAT: '1539771255069343815',
    STAFF_CMDS: '1539771282869059636',
    SERVER_LOGS: '1539771303106453635',
    TEST: '1539771325415956490',
  },

  BRAND: {
    NAME: 'kvsarchive',
    COLOR: 0x2b0b0b,
    FOOTER: 'kvsarchive // archive system',
  },

  VERIFICATION: {
    EXPIRE_MS: 10 * 60_000,
    MAX_ATTEMPTS: 5,
  },

  LEVELING: {
    XP_BASE: 20,
    TEXT_MIN_XP: 12,
    TEXT_MAX_XP: 20,
    TEXT_COOLDOWN_MS: 45_000,
    VOICE_XP_PER_MINUTE: 6,
    VOICE_MIN_HUMANS: 2,
  },

  MEDIA: {
    REQUIRED_POSTS: 5,
    COOLDOWN_MS: 5 * 60_000,
  },

  AUTOMOD: {
    SPAM_WINDOW_MS: 6_000,
    SPAM_MAX_MESSAGES: 7,
    SPAM_TIMEOUT_MS: 30_000,

    MASS_MENTION_LIMIT: 5,
    MASS_MENTION_TIMEOUT_MS: 60_000,
  },

  PRIVATE_CLUBS: {
    PREFIX: 'club・',
    EMPTY_DELETE_DELAY_MS: 30_000,
  },

  TRANSCRIPTS: {
    MAX_MESSAGES: 500,
  },
};

const STAFF_ROLE_IDS = [
  CONFIG.ROLES.MOD,
  CONFIG.ROLES.SR_MOD,
  CONFIG.ROLES.ADMIN,
  CONFIG.ROLES.ASCENDANT,
  CONFIG.ROLES.MANAGEMENT,
];

const MANAGEMENT_ROLE_IDS = [
  CONFIG.ROLES.ADMIN,
  CONFIG.ROLES.MANAGEMENT,
];

const LEVEL_MILESTONES = Object.keys(CONFIG.ROLES.LEVELS)
  .map(Number)
  .sort((a, b) => a - b);

const REQUIRED_BOT_PERMISSIONS = [
  ['ViewChannel', PermissionFlagsBits.ViewChannel],
  ['SendMessages', PermissionFlagsBits.SendMessages],
  ['ReadMessageHistory', PermissionFlagsBits.ReadMessageHistory],
  ['EmbedLinks', PermissionFlagsBits.EmbedLinks],
  ['AttachFiles', PermissionFlagsBits.AttachFiles],
  ['ManageRoles', PermissionFlagsBits.ManageRoles],
  ['ManageChannels', PermissionFlagsBits.ManageChannels],
  ['ManageMessages', PermissionFlagsBits.ManageMessages],
  ['MoveMembers', PermissionFlagsBits.MoveMembers],
  ['ModerateMembers', PermissionFlagsBits.ModerateMembers],
  ['KickMembers', PermissionFlagsBits.KickMembers],
  ['BanMembers', PermissionFlagsBits.BanMembers],
];

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildModeration,
  ],
  partials: [
    Partials.Channel,
    Partials.Message,
    Partials.User,
    Partials.GuildMember,
  ],
});

// ============================================================================
// STORAGE
// ============================================================================

const requestedDbPath = process.env.DB_PATH?.trim();

const dbDir = process.env.RAILWAY_VOLUME_MOUNT_PATH?.trim()
  || (requestedDbPath ? path.dirname(requestedDbPath) : path.join(process.cwd(), 'data'));

fs.mkdirSync(dbDir, { recursive: true });

const DB_PATH = requestedDbPath || path.join(dbDir, 'kvsarchive.sqlite');

console.log(`[db] path: ${DB_PATH}`);
console.log(`[db] railway volume: ${process.env.RAILWAY_VOLUME_MOUNT_PATH || 'not mounted'}`);

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    user_id TEXT PRIMARY KEY,
    xp INTEGER NOT NULL DEFAULT 0,
    text_xp INTEGER NOT NULL DEFAULT 0,
    voice_xp INTEGER NOT NULL DEFAULT 0,
    messages INTEGER NOT NULL DEFAULT 0,
    voice_minutes INTEGER NOT NULL DEFAULT 0,
    last_text_xp INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS warnings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    moderator_id TEXT NOT NULL,
    reason TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS mod_cases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    action TEXT NOT NULL,
    target_id TEXT NOT NULL,
    moderator_id TEXT NOT NULL,
    reason TEXT NOT NULL,
    duration_ms INTEGER,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS media_posts (
    message_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS media_cooldowns (
    user_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    last_post_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, kind)
  );

  CREATE TABLE IF NOT EXISTS verification_codes (
    user_id TEXT PRIMARY KEY,
    code TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS temp_clubs (
    channel_id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL,
    locked INTEGER NOT NULL DEFAULT 0,
    hidden INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS counting (
    channel_id TEXT PRIMARY KEY,
    next_number INTEGER NOT NULL DEFAULT 1,
    last_user_id TEXT
  );

  CREATE TABLE IF NOT EXISTS tickets (
    channel_id TEXT PRIMARY KEY,
    opener_id TEXT NOT NULL,
    type TEXT NOT NULL,
    claimed_by TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_warnings_user
    ON warnings(guild_id, user_id);

  CREATE INDEX IF NOT EXISTS idx_cases_target
    ON mod_cases(guild_id, target_id);

  CREATE INDEX IF NOT EXISTS idx_media_user_kind
    ON media_posts(user_id, kind);
`);

const sql = {
  ensureUser: db.prepare(`
    INSERT OR IGNORE INTO users (user_id) VALUES (?)
  `),

  getUser: db.prepare(`
    SELECT * FROM users WHERE user_id = ?
  `),

  incrementMessage: db.prepare(`
    UPDATE users
    SET messages = messages + 1
    WHERE user_id = ?
  `),

  awardTextXp: db.prepare(`
    UPDATE users
    SET xp = xp + ?,
        text_xp = text_xp + ?,
        last_text_xp = ?
    WHERE user_id = ?
  `),

  awardVoiceXp: db.prepare(`
    UPDATE users
    SET xp = xp + ?,
        voice_xp = voice_xp + ?,
        voice_minutes = voice_minutes + 1
    WHERE user_id = ?
  `),

  leaderboard: db.prepare(`
    SELECT * FROM users ORDER BY xp DESC LIMIT 10
  `),

  rank: db.prepare(`
    SELECT COUNT(*) + 1 AS rank
    FROM users
    WHERE xp > ?
  `),

  addWarning: db.prepare(`
    INSERT INTO warnings (
      guild_id, user_id, moderator_id, reason, created_at
    ) VALUES (?, ?, ?, ?, ?)
  `),

  getWarnings: db.prepare(`
    SELECT * FROM warnings
    WHERE guild_id = ? AND user_id = ?
    ORDER BY id DESC
    LIMIT 25
  `),

  clearWarnings: db.prepare(`
    DELETE FROM warnings
    WHERE guild_id = ? AND user_id = ?
  `),

  addCase: db.prepare(`
    INSERT INTO mod_cases (
      guild_id, action, target_id, moderator_id, reason, duration_ms, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `),

  getCase: db.prepare(`
    SELECT * FROM mod_cases
    WHERE guild_id = ? AND id = ?
  `),

  getCasesForUser: db.prepare(`
    SELECT * FROM mod_cases
    WHERE guild_id = ? AND target_id = ?
    ORDER BY id DESC
    LIMIT 20
  `),

  addMediaPost: db.prepare(`
    INSERT OR IGNORE INTO media_posts (
      message_id, user_id, kind, created_at
    ) VALUES (?, ?, ?, ?)
  `),

  getMediaPost: db.prepare(`
    SELECT * FROM media_posts WHERE message_id = ?
  `),

  deleteMediaPost: db.prepare(`
    DELETE FROM media_posts WHERE message_id = ?
  `),

  mediaCount: db.prepare(`
    SELECT COUNT(*) AS count
    FROM media_posts
    WHERE user_id = ? AND kind = ?
  `),

  getMediaCooldown: db.prepare(`
    SELECT * FROM media_cooldowns
    WHERE user_id = ? AND kind = ?
  `),

  setMediaCooldown: db.prepare(`
    INSERT INTO media_cooldowns (user_id, kind, last_post_at)
    VALUES (?, ?, ?)
    ON CONFLICT(user_id, kind)
    DO UPDATE SET last_post_at = excluded.last_post_at
  `),

  setVerifyCode: db.prepare(`
    INSERT INTO verification_codes (
      user_id, code, expires_at, attempts
    ) VALUES (?, ?, ?, 0)
    ON CONFLICT(user_id)
    DO UPDATE SET
      code = excluded.code,
      expires_at = excluded.expires_at,
      attempts = 0
  `),

  getVerifyCode: db.prepare(`
    SELECT * FROM verification_codes WHERE user_id = ?
  `),

  incVerifyAttempt: db.prepare(`
    UPDATE verification_codes
    SET attempts = attempts + 1
    WHERE user_id = ?
  `),

  deleteVerifyCode: db.prepare(`
    DELETE FROM verification_codes WHERE user_id = ?
  `),

  addClub: db.prepare(`
    INSERT OR REPLACE INTO temp_clubs (
      channel_id, owner_id, created_at, locked, hidden
    ) VALUES (?, ?, ?, 0, 0)
  `),

  getClubByOwner: db.prepare(`
    SELECT * FROM temp_clubs WHERE owner_id = ?
  `),

  getClubByChannel: db.prepare(`
    SELECT * FROM temp_clubs WHERE channel_id = ?
  `),

  deleteClubByChannel: db.prepare(`
    DELETE FROM temp_clubs WHERE channel_id = ?
  `),

  deleteClubByOwner: db.prepare(`
    DELETE FROM temp_clubs WHERE owner_id = ?
  `),

  setClubLocked: db.prepare(`
    UPDATE temp_clubs SET locked = ? WHERE channel_id = ?
  `),

  setClubHidden: db.prepare(`
    UPDATE temp_clubs SET hidden = ? WHERE channel_id = ?
  `),

  transferClub: db.prepare(`
    UPDATE temp_clubs SET owner_id = ? WHERE channel_id = ?
  `),

  getCounting: db.prepare(`
    SELECT * FROM counting WHERE channel_id = ?
  `),

  startCounting: db.prepare(`
    INSERT OR REPLACE INTO counting (
      channel_id, next_number, last_user_id
    ) VALUES (?, 1, NULL)
  `),

  stopCounting: db.prepare(`
    DELETE FROM counting WHERE channel_id = ?
  `),

  updateCounting: db.prepare(`
    UPDATE counting
    SET next_number = ?, last_user_id = ?
    WHERE channel_id = ?
  `),

  resetCounting: db.prepare(`
    UPDATE counting
    SET next_number = 1, last_user_id = NULL
    WHERE channel_id = ?
  `),

  addTicket: db.prepare(`
    INSERT OR REPLACE INTO tickets (
      channel_id, opener_id, type, created_at
    ) VALUES (?, ?, ?, ?)
  `),

  getTicket: db.prepare(`
    SELECT * FROM tickets WHERE channel_id = ?
  `),

  findTicket: db.prepare(`
    SELECT * FROM tickets
    WHERE opener_id = ? AND type = ?
    ORDER BY created_at DESC LIMIT 1
  `),

  claimTicket: db.prepare(`
    UPDATE tickets SET claimed_by = ? WHERE channel_id = ?
  `),

  deleteTicket: db.prepare(`
    DELETE FROM tickets WHERE channel_id = ?
  `),
};

const ownerXpSql = {
  add: db.prepare(`
    UPDATE users SET xp = xp + ? WHERE user_id = ?
  `),

  remove: db.prepare(`
    UPDATE users
    SET xp = MAX(0, xp - ?)
    WHERE user_id = ?
  `),

  set: db.prepare(`
    UPDATE users SET xp = ? WHERE user_id = ?
  `),
};

// ============================================================================
// RUNTIME STATE
// ============================================================================

const spamTracker = new Map();
const ticTacToeGames = new Map();
const hangmanGames = new Map();
const numberGames = new Map();
const pendingClubDeletes = new Map();

const startedAt = Date.now();

// ============================================================================
// GENERIC HELPERS
// ============================================================================

function isOwner(userId) {
  return CONFIG.OWNER_IDS.includes(userId);
}

function hasAnyRole(member, roleIds) {
  return Boolean(member && roleIds.some((id) => member.roles.cache.has(id)));
}

function isStaff(member) {
  return Boolean(member && (isOwner(member.id) || hasAnyRole(member, STAFF_ROLE_IDS)));
}

function isManagement(member) {
  return Boolean(member && (isOwner(member.id) || hasAnyRole(member, MANAGEMENT_ROLE_IDS)));
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function truncate(text, max = 1000) {
  const value = String(text ?? '');
  if (!value) return '—';
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

function sanitizeChannelName(text) {
  return String(text || 'archive')
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || 'archive';
}

function durationText(ms) {
  if (!ms) return '—';

  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;

  return `${Math.floor(hours / 24)}d`;
}

function baseEmbed() {
  return new EmbedBuilder()
    .setColor(CONFIG.BRAND.COLOR)
    .setFooter({ text: CONFIG.BRAND.FOOTER })
    .setTimestamp();
}

function successEmbed(title, description) {
  return baseEmbed()
    .setTitle(`† ${title}`)
    .setDescription(description);
}

function errorEmbed(description) {
  return baseEmbed()
    .setTitle('⛧ denied')
    .setDescription(description);
}

function ephemeralPayload(payload) {
  return {
    ...payload,
    flags: MessageFlags.Ephemeral,
  };
}

async function fetchGuild() {
  return client.guilds.fetch(CONFIG.GUILD_ID);
}

async function fetchConfiguredChannel(channelId) {
  const guild = await fetchGuild();
  return guild.channels.fetch(channelId).catch(() => null);
}

async function getInteractionMember(interaction) {
  if (!interaction.guild) return null;
  return interaction.guild.members.fetch(interaction.user.id).catch(() => null);
}

async function logEvent(title, description, fields = [], file = null) {
  try {
    const channel = await fetchConfiguredChannel(CONFIG.CHANNELS.SERVER_LOGS);
    if (!channel?.isTextBased()) return;

    const embed = baseEmbed().setTitle(`⌁ ${title}`);

    if (description) {
      embed.setDescription(truncate(description, 4000));
    }

    if (fields.length) {
      embed.addFields(fields.slice(0, 25));
    }

    const payload = {
      embeds: [embed],
    };

    if (file) {
      payload.files = [file];
    }

    await channel.send(payload);
  } catch (error) {
    console.error('[logEvent]', error);
  }
}

function createModCase(action, targetId, moderatorId, reason, durationMs = null) {
  const result = sql.addCase.run(
    CONFIG.GUILD_ID,
    action,
    targetId,
    moderatorId,
    reason || 'No reason provided',
    durationMs,
    Date.now(),
  );

  return Number(result.lastInsertRowid);
}

async function requireOwner(interaction) {
  if (isOwner(interaction.user.id)) return true;

  await interaction.reply(ephemeralPayload({
    embeds: [errorEmbed('owner whitelist only.')],
  })).catch(() => null);

  return false;
}

async function requireStaff(interaction) {
  const member = await getInteractionMember(interaction);

  if (member && isStaff(member)) {
    return member;
  }

  await interaction.reply(ephemeralPayload({
    embeds: [errorEmbed('staff only.')],
  })).catch(() => null);

  return null;
}

async function requireManagement(interaction) {
  const member = await getInteractionMember(interaction);

  if (member && isManagement(member)) {
    return member;
  }

  await interaction.reply(ephemeralPayload({
    embeds: [errorEmbed('management only.')],
  })).catch(() => null);

  return null;
}

function staffRank(member) {
  if (!member) return 0;
  if (isOwner(member.id)) return 100;
  if (member.roles.cache.has(CONFIG.ROLES.MANAGEMENT)) return 90;
  if (member.roles.cache.has(CONFIG.ROLES.ADMIN)) return 80;
  if (member.roles.cache.has(CONFIG.ROLES.SR_MOD)) return 70;
  if (member.roles.cache.has(CONFIG.ROLES.MOD)) return 60;
  if (member.roles.cache.has(CONFIG.ROLES.ASCENDANT)) return 50;
  return 0;
}

async function canModerateTarget(moderator, target) {
  if (!moderator || !target) return false;
  if (moderator.id === target.id) return false;

  if (isOwner(moderator.id)) {
    return !isOwner(target.id) || moderator.id === target.id;
  }

  if (isOwner(target.id)) return false;

  const moderatorRank = staffRank(moderator);
  const targetRank = staffRank(target);

  if (targetRank > 0 && moderatorRank <= targetRank) {
    return false;
  }

  return moderator.roles.highest.position > target.roles.highest.position;
}

// ============================================================================
// LEVELING
// ============================================================================

function xpForLevel(level) {
  return CONFIG.LEVELING.XP_BASE * level * level;
}

function levelFromXp(xp) {
  return Math.floor(Math.sqrt(Math.max(0, xp) / CONFIG.LEVELING.XP_BASE));
}

function progressBar(current, required, size = 12) {
  const ratio = required <= 0
    ? 1
    : Math.max(0, Math.min(1, current / required));

  const filled = Math.round(ratio * size);
  return '▰'.repeat(filled) + '▱'.repeat(size - filled);
}

function nextMilestone(level) {
  return LEVEL_MILESTONES.find((milestone) => milestone > level) || null;
}

async function syncLevelRoles(member, level) {
  if (!member || member.user.bot) return;

  const eligible = LEVEL_MILESTONES.filter((milestone) => level >= milestone);
  const highest = eligible.length ? eligible[eligible.length - 1] : null;

  const levelRoleIds = Object.values(CONFIG.ROLES.LEVELS);
  const targetRoleId = highest ? CONFIG.ROLES.LEVELS[highest] : null;

  const removeIds = levelRoleIds.filter(
    (roleId) => roleId !== targetRoleId && member.roles.cache.has(roleId),
  );

  if (removeIds.length) {
    await member.roles.remove(removeIds, 'kvsarchive level role sync').catch(() => null);
  }

  if (targetRoleId && !member.roles.cache.has(targetRoleId)) {
    await member.roles.add(targetRoleId, `Reached level ${highest}`).catch(() => null);
  }

  if (level >= 60) {
    if (!member.roles.cache.has(CONFIG.ROLES.LOYAL_MEMBER)) {
      await member.roles.add(
        CONFIG.ROLES.LOYAL_MEMBER,
        'Reached level 60',
      ).catch(() => null);
    }
  } else if (member.roles.cache.has(CONFIG.ROLES.LOYAL_MEMBER)) {
    await member.roles.remove(
      CONFIG.ROLES.LOYAL_MEMBER,
      'Level dropped below 60',
    ).catch(() => null);
  }
}

async function announceLevelUp(member, oldLevel, newLevel, totalXp) {
  const channel = await fetchConfiguredChannel(CONFIG.CHANNELS.CMDS)
    || await fetchConfiguredChannel(CONFIG.CHANNELS.CHAT);

  if (!channel?.isTextBased()) return;

  const crossedMilestones = LEVEL_MILESTONES.filter(
    (milestone) => oldLevel < milestone && newLevel >= milestone,
  );

  const fields = [
    {
      name: 'total xp',
      value: totalXp.toLocaleString(),
      inline: true,
    },
  ];

  if (crossedMilestones.length) {
    const milestone = crossedMilestones[crossedMilestones.length - 1];
    fields.push({
      name: 'role unlocked',
      value: `<@&${CONFIG.ROLES.LEVELS[milestone]}>`,
      inline: true,
    });
  }

  const next = nextMilestone(newLevel);

  if (next) {
    fields.push({
      name: 'next role',
      value: `level **${next}**`,
      inline: true,
    });
  }

  await channel.send({
    content: `<@${member.id}>`,
    allowedMentions: {
      users: [member.id],
    },
    embeds: [
      baseEmbed()
        .setTitle('𖤐 LEVEL UP')
        .setDescription(
          [
            `congratulations ${member} — you reached **level ${newLevel}**.`,
            '',
            'keep the archive moving.',
          ].join('\n'),
        )
        .setThumbnail(member.user.displayAvatarURL({ size: 256 }))
        .addFields(fields),
    ],
  }).catch(() => null);
}

async function processLevelChange(member, oldXp, newXp) {
  const oldLevel = levelFromXp(oldXp);
  const newLevel = levelFromXp(newXp);

  if (newLevel <= oldLevel) return;

  await syncLevelRoles(member, newLevel);
  await announceLevelUp(member, oldLevel, newLevel, newXp);
}

async function awardTextXp(message, member) {
  sql.ensureUser.run(member.id);
  sql.incrementMessage.run(member.id);

  const before = sql.getUser.get(member.id);

  if (
    Date.now() - before.last_text_xp <
    CONFIG.LEVELING.TEXT_COOLDOWN_MS
  ) {
    return;
  }

  if (
    message.content.trim().length < 3 &&
    message.attachments.size === 0
  ) {
    return;
  }

  const amount = randInt(
    CONFIG.LEVELING.TEXT_MIN_XP,
    CONFIG.LEVELING.TEXT_MAX_XP,
  );

  sql.awardTextXp.run(
    amount,
    amount,
    Date.now(),
    member.id,
  );

  const after = sql.getUser.get(member.id);
  await processLevelChange(member, before.xp, after.xp);
}

// ============================================================================
// MEDIA
// ============================================================================

function isImageMessage(message) {
  if (
    message.attachments.some((attachment) => {
      if (attachment.contentType?.startsWith('image/')) return true;

      const value = attachment.url || attachment.name || '';
      return /\.(png|jpe?g|gif|webp)(\?.*)?$/i.test(value);
    })
  ) {
    return true;
  }

  const urls = message.content.match(/https?:\/\/\S+/gi) || [];

  return urls.some((url) => /\.(png|jpe?g|gif|webp)(\?.*)?$/i.test(url));
}

async function updateMediaPosterRole(member) {
  if (!member || member.user.bot) return;

  const pfp = sql.mediaCount.get(member.id, 'pfp').count;
  const banner = sql.mediaCount.get(member.id, 'banner').count;

  const qualifies = (
    pfp >= CONFIG.MEDIA.REQUIRED_POSTS ||
    banner >= CONFIG.MEDIA.REQUIRED_POSTS
  );

  const hasRole = member.roles.cache.has(CONFIG.ROLES.MEDIA_POSTER);

  if (qualifies && !hasRole) {
    await member.roles.add(
      CONFIG.ROLES.MEDIA_POSTER,
      'Qualified as MEDIA POSTER',
    ).catch(() => null);

    const type = pfp >= CONFIG.MEDIA.REQUIRED_POSTS ? 'pfp' : 'banner';

    await member.send({
      embeds: [
        successEmbed(
          'media poster unlocked',
          [
            `you reached **${CONFIG.MEDIA.REQUIRED_POSTS}+ ${type} posts**.`,
            '',
            `you received <@&${CONFIG.ROLES.MEDIA_POSTER}> and now bypass the archive media cooldown.`,
          ].join('\n'),
        ),
      ],
    }).catch(() => null);

    await logEvent(
      'media poster unlocked',
      `${member.user.tag} (${member.id}) earned <@&${CONFIG.ROLES.MEDIA_POSTER}>.`,
    );

    return;
  }

  if (!qualifies && hasRole) {
    await member.roles.remove(
      CONFIG.ROLES.MEDIA_POSTER,
      'No longer has enough qualifying media posts',
    ).catch(() => null);
  }
}

async function handleMediaMessage(message, member, kind) {
  if (!isImageMessage(message)) {
    await message.delete().catch(() => null);

    const notice = await message.channel.send({
      content: `${message.author}, images only in this archive channel.`,
    }).catch(() => null);

    if (notice) {
      setTimeout(() => notice.delete().catch(() => null), 5000).unref();
    }

    return false;
  }

  const bypass = (
    member.roles.cache.has(CONFIG.ROLES.MEDIA_POSTER) ||
    isStaff(member)
  );

  if (!bypass) {
    const cooldown = sql.getMediaCooldown.get(member.id, kind);

    if (cooldown) {
      const remaining = CONFIG.MEDIA.COOLDOWN_MS - (
        Date.now() - cooldown.last_post_at
      );

      if (remaining > 0) {
        await message.delete().catch(() => null);

        const seconds = Math.ceil(remaining / 1000);
        const minutes = Math.ceil(seconds / 60);

        const notice = await message.channel.send({
          content: `${message.author}, wait about **${minutes}m** before posting another ${kind}.`,
        }).catch(() => null);

        if (notice) {
          setTimeout(() => notice.delete().catch(() => null), 5000).unref();
        }

        return false;
      }
    }

    sql.setMediaCooldown.run(
      member.id,
      kind,
      Date.now(),
    );
  }

  sql.addMediaPost.run(
    message.id,
    member.id,
    kind,
    Date.now(),
  );

  await updateMediaPosterRole(member);
  return true;
}

// ============================================================================
// VERIFICATION
// ============================================================================

function verificationCode() {
  return String(randInt(1000, 9999));
}

async function completeVerification(userId) {
  const guild = await fetchGuild();

  const member = await guild.members.fetch(userId).catch(() => null);

  if (!member) {
    throw new Error('Member is no longer in the server.');
  }

  const rewardRoles = [
    CONFIG.ROLES.MEMBER_TAG,
    CONFIG.ROLES.MEMBER,
    CONFIG.ROLES.MISC,
  ];

  try {
    await member.roles.add(
      rewardRoles,
      'Passed kvsarchive verification',
    );
  } catch (error) {
    throw new Error(
      `Could not assign verification roles. Put the bot role above MEMBER TAG / MEMBER / MISC and give it Manage Roles. Discord said: ${error.message}`,
    );
  }

  if (member.roles.cache.has(CONFIG.ROLES.VERIFY)) {
    await member.roles.remove(
      CONFIG.ROLES.VERIFY,
      'Verification complete',
    ).catch(() => null);
  }

  sql.ensureUser.run(member.id);

  await sendWelcome(member);

  await logEvent(
    'verification complete',
    `${member.user.tag} (${member.id}) verified successfully.`,
  );
}

async function handleVerificationDM(message) {
  if (message.author.bot) return false;

  const entry = sql.getVerifyCode.get(message.author.id);
  if (!entry) return false;

  if (Date.now() > entry.expires_at) {
    sql.deleteVerifyCode.run(message.author.id);

    await message.reply({
      embeds: [
        errorEmbed(
          'that code expired. go back to the server and press **verify** again.',
        ),
      ],
    }).catch(() => null);

    return true;
  }

  const answer = message.content.trim().replace(/\s+/g, '');

  if (answer === entry.code) {
    sql.deleteVerifyCode.run(message.author.id);

    try {
      await completeVerification(message.author.id);

      await message.reply({
        embeds: [
          successEmbed(
            'verified',
            'code accepted. **access granted.**',
          ),
        ],
      }).catch(() => null);
    } catch (error) {
      await message.reply({
        embeds: [
          errorEmbed(truncate(error.message, 1800)),
        ],
      }).catch(() => null);

      await logEvent(
        'verification role failure',
        `${message.author.tag} (${message.author.id}) passed verification, but role assignment failed: ${error.message}`,
      );
    }

    return true;
  }

  sql.incVerifyAttempt.run(message.author.id);

  const updated = sql.getVerifyCode.get(message.author.id);
  const left = CONFIG.VERIFICATION.MAX_ATTEMPTS - updated.attempts;

  if (left <= 0) {
    sql.deleteVerifyCode.run(message.author.id);

    await message.reply({
      embeds: [
        errorEmbed(
          'too many incorrect attempts. press **verify** in the server again for a new code.',
        ),
      ],
    }).catch(() => null);

    return true;
  }

  await message.reply({
    embeds: [
      errorEmbed(`wrong code. **${left}** attempt${left === 1 ? '' : 's'} left.`),
    ],
  }).catch(() => null);

  return true;
}

async function handleVerifyButton(interaction) {
  const member = await getInteractionMember(interaction);

  if (!member) {
    await interaction.reply(ephemeralPayload({
      embeds: [errorEmbed('I could not find your server member profile.')],
    }));

    return;
  }

  if (member.roles.cache.has(CONFIG.ROLES.MEMBER)) {
    await interaction.reply(ephemeralPayload({
      embeds: [
        successEmbed(
          'already verified',
          'you already have server access.',
        ),
      ],
    }));

    return;
  }

  const code = verificationCode();

  sql.setVerifyCode.run(
    interaction.user.id,
    code,
    Date.now() + CONFIG.VERIFICATION.EXPIRE_MS,
  );

  try {
    await interaction.user.send({
      embeds: [
        baseEmbed()
          .setTitle('⛓ verification code')
          .setDescription(
            [
              'reply to this DM with this **4-digit code**:',
              '',
              `# ${code}`,
              '',
              `expires in **${Math.floor(CONFIG.VERIFICATION.EXPIRE_MS / 60_000)} minutes**.`,
            ].join('\n'),
          ),
      ],
    });
  } catch {
    sql.deleteVerifyCode.run(interaction.user.id);

    await interaction.reply(ephemeralPayload({
      embeds: [
        errorEmbed(
          'I could not DM you. enable direct messages from server members and try again.',
        ),
      ],
    }));

    return;
  }

  await interaction.reply(ephemeralPayload({
    embeds: [
      successEmbed(
        'verification code sent',
        'check your DMs. it is only **4 digits**.',
      ),
    ],
  }));
}

function welcomeEmbed(member) {
  return baseEmbed()
    .setTitle('kvsarchive // access granted')
    .setDescription(
      [
        `welcome to the archive, ${member}.`,
        '',
        `› read <#${CONFIG.CHANNELS.RULES}>`,
        `› talk in <#${CONFIG.CHANNELS.CHAT}>`,
        `› commands in <#${CONFIG.CHANNELS.CMDS}>`,
        `› pfps in <#${CONFIG.CHANNELS.PFP}>`,
        `› banners in <#${CONFIG.CHANNELS.BANNER}>`,
        '',
        `**${CONFIG.MEDIA.REQUIRED_POSTS}+** valid PFP posts **or** **${CONFIG.MEDIA.REQUIRED_POSTS}+** valid banner posts unlocks <@&${CONFIG.ROLES.MEDIA_POSTER}>.`,
        '',
        'mixing categories does not count toward the unlock.',
      ].join('\n'),
    )
    .setThumbnail(member.user.displayAvatarURL({ size: 256 }));
}

async function sendWelcome(member) {
  const channel = await fetchConfiguredChannel(CONFIG.CHANNELS.WELC);
  if (!channel?.isTextBased()) return;

  await channel.send({
    content: `${member}`,
    allowedMentions: {
      users: [member.id],
    },
    embeds: [welcomeEmbed(member)],
  }).catch(() => null);
}

// ============================================================================
// PANELS
// ============================================================================

function verifyPanel() {
  return {
    embeds: [
      baseEmbed()
        .setTitle('⸸ verification')
        .setDescription(
          [
            '**kvsarchive**',
            '',
            'press **verify** below.',
            '',
            'I will DM you a simple **4-digit code**.',
            'reply with that number and your access roles are assigned automatically.',
            '',
            '*your DMs must be open.*',
          ].join('\n'),
        ),
    ],

    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('verify_start')
          .setLabel('verify')
          .setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}

function ticketPanel() {
  return {
    embeds: [
      baseEmbed()
        .setTitle('⌁ support archive')
        .setDescription(
          [
            'choose what you actually need.',
            '',
            '**member report** — report a member or incident.',
            '**general support** — help with the server.',
            '**owner request** — request intended specifically for the owner.',
            '',
            'false reports and ticket spam may be moderated.',
          ].join('\n'),
        ),
    ],

    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('ticket_report')
          .setLabel('member report')
          .setStyle(ButtonStyle.Secondary),

        new ButtonBuilder()
          .setCustomId('ticket_support')
          .setLabel('general support')
          .setStyle(ButtonStyle.Secondary),

        new ButtonBuilder()
          .setCustomId('ticket_owner')
          .setLabel('owner request')
          .setStyle(ButtonStyle.Danger),
      ),
    ],
  };
}

function staffApplicationPanel() {
  return {
    embeds: [
      baseEmbed()
        .setTitle('⛧ staff applications // open')
        .setDescription(
          [
            '**applications are currently open.**',
            '',
            'answer everything properly.',
            'low-effort / troll / duplicate applications can be ignored.',
          ].join('\n'),
        ),
    ],

    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('staffapp_open')
          .setLabel('apply for staff')
          .setStyle(ButtonStyle.Danger),
      ),
    ],
  };
}

function clubPanel() {
  return {
    embeds: [
      baseEmbed()
        .setTitle('𖤐 private clubs')
        .setDescription(
          [
            `join <#${CONFIG.CHANNELS.CREATE_PRIVATE_CLUB}> to create your temporary private club.`,
            '',
            '**owner controls**',
            '› rename',
            '› user limit',
            '› lock / unlock',
            '› hide / show',
            '› permit member',
            '› block member',
            '› transfer ownership',
            '› delete club',
            '',
            'empty generated clubs automatically disappear.',
          ].join('\n'),
        ),
    ],

    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('club_rename')
          .setLabel('rename')
          .setStyle(ButtonStyle.Secondary),

        new ButtonBuilder()
          .setCustomId('club_limit')
          .setLabel('limit')
          .setStyle(ButtonStyle.Secondary),

        new ButtonBuilder()
          .setCustomId('club_lock')
          .setLabel('lock / unlock')
          .setStyle(ButtonStyle.Secondary),

        new ButtonBuilder()
          .setCustomId('club_hide')
          .setLabel('hide / show')
          .setStyle(ButtonStyle.Secondary),

        new ButtonBuilder()
          .setCustomId('club_info')
          .setLabel('info')
          .setStyle(ButtonStyle.Secondary),
      ),

      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('club_allow')
          .setLabel('permit user')
          .setStyle(ButtonStyle.Success),

        new ButtonBuilder()
          .setCustomId('club_block')
          .setLabel('block user')
          .setStyle(ButtonStyle.Danger),

        new ButtonBuilder()
          .setCustomId('club_transfer')
          .setLabel('transfer owner')
          .setStyle(ButtonStyle.Primary),

        new ButtonBuilder()
          .setCustomId('club_delete')
          .setLabel('delete club')
          .setStyle(ButtonStyle.Danger),
      ),
    ],
  };
}

function specialtyInfoPanel() {
  return {
    embeds: [
      baseEmbed()
        .setTitle('† specialty & info')
        .setDescription(
          [
            '**media poster**',
            `post ${CONFIG.MEDIA.REQUIRED_POSTS}+ pfps OR ${CONFIG.MEDIA.REQUIRED_POSTS}+ banners to unlock <@&${CONFIG.ROLES.MEDIA_POSTER}>.`,
            'the two categories are counted separately.',
            '',
            '**activity levels**',
            'normal chat activity and eligible voice activity earns XP.',
            `level-ups are announced in <#${CONFIG.CHANNELS.CMDS}>.`,
            '`/level` shows your progress and `/leaderboard` shows the top 10.',
            '',
            `level **60** unlocks <@&${CONFIG.ROLES.LOYAL_MEMBER}>.`,
            '',
            '**private clubs**',
            `join <#${CONFIG.CHANNELS.CREATE_PRIVATE_CLUB}> and use the controls in <#${CONFIG.CHANNELS.PRIVATE_CLUB_CMDS}>.`,
          ].join('\n'),
        ),
    ],
  };
}

async function checkPanelChannel(guild, channelId) {
  const channel = await guild.channels.fetch(channelId).catch(() => null);

  if (!channel) {
    throw new Error(`channel ${channelId} does not exist or the bot cannot access it`);
  }

  if (!channel.isTextBased()) {
    throw new Error(`${channel.name} (${channel.id}) is not a text-based channel`);
  }

  const me = guild.members.me || await guild.members.fetchMe();
  const permissions = channel.permissionsFor(me);

  const missing = [
    ['ViewChannel', PermissionFlagsBits.ViewChannel],
    ['SendMessages', PermissionFlagsBits.SendMessages],
    ['EmbedLinks', PermissionFlagsBits.EmbedLinks],
  ]
    .filter(([, bit]) => !permissions?.has(bit))
    .map(([name]) => name);

  if (missing.length) {
    throw new Error(
      `${channel.name} is missing bot permissions: ${missing.join(', ')}`,
    );
  }

  return channel;
}

async function postPanel(guild, channelId, payload) {
  const channel = await checkPanelChannel(guild, channelId);
  await channel.send(payload);
  return channel;
}

// ============================================================================
// TICKETS
// ============================================================================

function ticketModal(type) {
  const modal = new ModalBuilder()
    .setCustomId(`ticket_modal_${type}`);

  if (type === 'report') {
    modal
      .setTitle('member report')
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('subject')
            .setLabel('who are you reporting?')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(100),
        ),

        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('details')
            .setLabel('what happened?')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setMaxLength(1800),
        ),

        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('evidence')
            .setLabel('evidence / links (optional)')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(false)
            .setMaxLength(1000),
        ),
      );

    return modal;
  }

  modal
    .setTitle(type === 'owner' ? 'owner request' : 'general support')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('subject')
          .setLabel('short subject')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(100),
      ),

      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('details')
          .setLabel(type === 'owner' ? 'request / reason' : 'what do you need help with?')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(1800),
      ),
    );

  return modal;
}

function staffApplicationModal() {
  return new ModalBuilder()
    .setCustomId('staffapp_modal')
    .setTitle('staff application')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('age')
          .setLabel('age')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(20),
      ),

      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('timezone')
          .setLabel('timezone')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(60),
      ),

      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('experience')
          .setLabel('moderation experience')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(1000),
      ),

      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('why')
          .setLabel('why should we pick you?')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(1000),
      ),

      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('availability')
          .setLabel('availability')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(500),
      ),
    );
}

function ticketControls(closed = false) {
  if (closed) {
    return [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('ticket_transcript')
          .setLabel('transcript')
          .setStyle(ButtonStyle.Secondary),

        new ButtonBuilder()
          .setCustomId('ticket_delete')
          .setLabel('delete ticket')
          .setStyle(ButtonStyle.Danger),
      ),
    ];
  }

  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('ticket_claim')
        .setLabel('claim')
        .setStyle(ButtonStyle.Secondary),

      new ButtonBuilder()
        .setCustomId('ticket_transcript')
        .setLabel('transcript')
        .setStyle(ButtonStyle.Secondary),

      new ButtonBuilder()
        .setCustomId('ticket_close')
        .setLabel('close')
        .setStyle(ButtonStyle.Danger),
    ),
  ];
}

async function buildTranscript(channel) {
  const messages = [];
  let before;

  while (messages.length < CONFIG.TRANSCRIPTS.MAX_MESSAGES) {
    const batch = await channel.messages.fetch({
      limit: Math.min(100, CONFIG.TRANSCRIPTS.MAX_MESSAGES - messages.length),
      before,
    }).catch(() => null);

    if (!batch?.size) break;

    messages.push(...batch.values());

    const last = batch.last();
    before = last?.id;

    if (batch.size < 100) break;
  }

  messages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);

  const lines = [
    `kvsarchive ticket transcript`,
    `channel: ${channel.name} (${channel.id})`,
    `generated: ${new Date().toISOString()}`,
    '',
  ];

  for (const message of messages) {
    const timestamp = new Date(message.createdTimestamp).toISOString();
    const author = message.author
      ? `${message.author.tag} (${message.author.id})`
      : 'unknown';

    const content = message.content || '[no text]';

    lines.push(`[${timestamp}] ${author}: ${content}`);

    for (const attachment of message.attachments.values()) {
      lines.push(`  attachment: ${attachment.url}`);
    }
  }

  return Buffer.from(lines.join('\n'), 'utf8');
}

async function createTicketChannel(
  interaction,
  type,
  subject,
  details,
  evidence = '',
) {
  const guild = interaction.guild;
  const opener = await guild.members.fetch(interaction.user.id);

  const existing = sql.findTicket.get(opener.id, type);

  if (existing) {
    const existingChannel = await guild.channels.fetch(existing.channel_id).catch(() => null);

    if (existingChannel) {
      await interaction.reply(ephemeralPayload({
        content: `you already have an open **${type}** ticket: ${existingChannel}`,
      }));

      return;
    }

    sql.deleteTicket.run(existing.channel_id);
  }

  const ticketsPanel = await checkPanelChannel(guild, CONFIG.CHANNELS.TICKETS);
  const parentId = ticketsPanel.parentId || undefined;

  const permissionOverwrites = [
    {
      id: guild.roles.everyone.id,
      deny: [PermissionFlagsBits.ViewChannel],
    },
    {
      id: opener.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.EmbedLinks,
      ],
    },
    {
      id: client.user.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.ManageChannels,
        PermissionFlagsBits.ManageMessages,
      ],
    },
  ];

  const addRoleAccess = (roleId) => {
    permissionOverwrites.push({
      id: roleId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.EmbedLinks,
      ],
    });
  };

  if (type === 'owner') {
    permissionOverwrites.push({
      id: CONFIG.OWNER_IDS[0],
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
      ],
    });

    addRoleAccess(CONFIG.ROLES.MANAGEMENT);
  } else {
    for (const roleId of STAFF_ROLE_IDS) {
      addRoleAccess(roleId);
    }
  }

  const suffix = crypto.randomBytes(2).toString('hex');

  const channel = await guild.channels.create({
    name: sanitizeChannelName(`${type}-${opener.user.username}-${suffix}`),
    type: ChannelType.GuildText,
    parent: parentId,
    permissionOverwrites,
    topic: `kvsarchive ticket | opener:${opener.id} | type:${type}`,
    reason: `Ticket opened by ${opener.user.tag}`,
  });

  sql.addTicket.run(
    channel.id,
    opener.id,
    type,
    Date.now(),
  );

  const labels = {
    report: 'member report',
    support: 'general support',
    owner: 'owner request',
  };

  const embed = baseEmbed()
    .setTitle(`⌁ ${labels[type] || type}`)
    .setDescription(`${opener} opened this ticket.`)
    .addFields(
      {
        name: 'subject',
        value: truncate(subject),
      },
      {
        name: 'details',
        value: truncate(details),
      },
    );

  if (evidence) {
    embed.addFields({
      name: 'evidence',
      value: truncate(evidence),
    });
  }

  await channel.send({
    content: `${opener}`,
    allowedMentions: {
      users: [opener.id],
    },
    embeds: [embed],
    components: ticketControls(false),
  });

  await interaction.reply(ephemeralPayload({
    content: `ticket created: ${channel}`,
  }));

  await logEvent(
    'ticket opened',
    `${opener.user.tag} opened a **${type}** ticket: ${channel}.`,
  );
}

async function createStaffApplication(interaction, answers) {
  const guild = interaction.guild;
  const applicant = await guild.members.fetch(interaction.user.id);

  const type = 'staff_application';
  const existing = sql.findTicket.get(applicant.id, type);

  if (existing) {
    const existingChannel = await guild.channels.fetch(existing.channel_id).catch(() => null);

    if (existingChannel) {
      await interaction.reply(ephemeralPayload({
        content: `you already have a staff application open: ${existingChannel}`,
      }));

      return;
    }

    sql.deleteTicket.run(existing.channel_id);
  }

  const ticketsPanel = await checkPanelChannel(guild, CONFIG.CHANNELS.TICKETS);

  const permissionOverwrites = [
    {
      id: guild.roles.everyone.id,
      deny: [PermissionFlagsBits.ViewChannel],
    },
    {
      id: applicant.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
      ],
    },
    {
      id: client.user.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.ManageChannels,
        PermissionFlagsBits.ManageMessages,
      ],
    },
    {
      id: CONFIG.OWNER_IDS[0],
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
      ],
    },
    {
      id: CONFIG.ROLES.MANAGEMENT,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
      ],
    },
    {
      id: CONFIG.ROLES.ADMIN,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
      ],
    },
  ];

  const suffix = crypto.randomBytes(2).toString('hex');

  const channel = await guild.channels.create({
    name: sanitizeChannelName(`staff-app-${applicant.user.username}-${suffix}`),
    type: ChannelType.GuildText,
    parent: ticketsPanel.parentId || undefined,
    permissionOverwrites,
    topic: `kvsarchive staff application | opener:${applicant.id}`,
    reason: `Staff application from ${applicant.user.tag}`,
  });

  sql.addTicket.run(
    channel.id,
    applicant.id,
    type,
    Date.now(),
  );

  const embed = baseEmbed()
    .setTitle('⛧ staff application')
    .setDescription(`${applicant} submitted a staff application.`)
    .setThumbnail(applicant.user.displayAvatarURL({ size: 256 }))
    .addFields(
      {
        name: 'age',
        value: truncate(answers.age),
      },
      {
        name: 'timezone',
        value: truncate(answers.timezone),
      },
      {
        name: 'experience',
        value: truncate(answers.experience),
      },
      {
        name: 'why you?',
        value: truncate(answers.why),
      },
      {
        name: 'availability',
        value: truncate(answers.availability),
      },
    );

  await channel.send({
    content: `${applicant} <@${CONFIG.OWNER_IDS[0]}>`,
    allowedMentions: {
      users: [
        applicant.id,
        CONFIG.OWNER_IDS[0],
      ],
    },
    embeds: [embed],
    components: ticketControls(false),
  });

  await interaction.reply(ephemeralPayload({
    content: `application submitted: ${channel}`,
  }));

  await logEvent(
    'staff application',
    `${applicant.user.tag} submitted ${channel}.`,
  );
}

async function sendTicketTranscript(interaction, ticket, member) {
  if (!member || !isStaff(member)) {
    await interaction.reply(ephemeralPayload({
      embeds: [errorEmbed('staff only.')],
    }));

    return;
  }

  await interaction.deferReply({
    flags: MessageFlags.Ephemeral,
  });

  const buffer = await buildTranscript(interaction.channel);

  const attachment = new AttachmentBuilder(
    buffer,
    {
      name: `${sanitizeChannelName(interaction.channel.name)}-transcript.txt`,
    },
  );

  await interaction.editReply({
    content: 'transcript generated.',
    files: [attachment],
  });

  await logEvent(
    'ticket transcript',
    `${member.user.tag} generated a transcript for <#${interaction.channelId}>.`,
  );
}

async function handleTicketButton(interaction) {
  const action = interaction.customId.replace('ticket_', '');

  if (['report', 'support', 'owner'].includes(action)) {
    await interaction.showModal(ticketModal(action));
    return;
  }

  const ticket = sql.getTicket.get(interaction.channelId);

  if (!ticket) {
    await interaction.reply(ephemeralPayload({
      embeds: [errorEmbed('this is not a tracked ticket.')],
    }));

    return;
  }

  const member = await getInteractionMember(interaction);

  if (action === 'transcript') {
    await sendTicketTranscript(interaction, ticket, member);
    return;
  }

  if (action === 'claim') {
    if (!member || !isStaff(member)) {
      await interaction.reply(ephemeralPayload({
        embeds: [errorEmbed('staff only.')],
      }));

      return;
    }

    if (ticket.claimed_by) {
      await interaction.reply(ephemeralPayload({
        content: `already claimed by <@${ticket.claimed_by}>.`,
      }));

      return;
    }

    sql.claimTicket.run(member.id, interaction.channelId);

    await interaction.reply({
      embeds: [
        successEmbed(
          'ticket claimed',
          `claimed by ${member}.`,
        ),
      ],
    });

    await logEvent(
      'ticket claimed',
      `${member.user.tag} claimed <#${interaction.channelId}>.`,
    );

    return;
  }

  if (action === 'close') {
    const allowed = (
      interaction.user.id === ticket.opener_id ||
      (member && isStaff(member))
    );

    if (!allowed) {
      await interaction.reply(ephemeralPayload({
        embeds: [errorEmbed('only the ticket opener or staff can close this.')],
      }));

      return;
    }

    const transcript = await buildTranscript(interaction.channel);

    await interaction.channel.permissionOverwrites.edit(
      ticket.opener_id,
      {
        SendMessages: false,
      },
      {
        reason: `Ticket closed by ${interaction.user.tag}`,
      },
    ).catch(() => null);

    if (!interaction.channel.name.startsWith('closed-')) {
      await interaction.channel.setName(
        `closed-${interaction.channel.name}`.slice(0, 100),
        `Closed by ${interaction.user.tag}`,
      ).catch(() => null);
    }

    await interaction.reply({
      embeds: [
        baseEmbed()
          .setTitle('⌁ ticket closed')
          .setDescription(`closed by ${interaction.user}.`),
      ],
      components: ticketControls(true),
    });

    await logEvent(
      'ticket closed',
      `${interaction.user.tag} closed <#${interaction.channelId}>.`,
      [],
      new AttachmentBuilder(
        transcript,
        {
          name: `${sanitizeChannelName(interaction.channel.name)}-transcript.txt`,
        },
      ),
    );

    return;
  }

  if (action === 'delete') {
    if (!member || !isStaff(member)) {
      await interaction.reply(ephemeralPayload({
        embeds: [errorEmbed('staff only.')],
      }));

      return;
    }

    await interaction.reply(ephemeralPayload({
      content: 'deleting ticket…',
    }));

    const transcript = await buildTranscript(interaction.channel);

    sql.deleteTicket.run(interaction.channelId);

    await logEvent(
      'ticket deleted',
      `${member.user.tag} deleted ticket <#${interaction.channelId}>.`,
      [],
      new AttachmentBuilder(
        transcript,
        {
          name: `${sanitizeChannelName(interaction.channel.name)}-transcript.txt`,
        },
      ),
    );

    setTimeout(() => {
      interaction.channel.delete(
        `Ticket deleted by ${member.user.tag}`,
      ).catch(() => null);
    }, 1000).unref();
  }
}

// ============================================================================
// PRIVATE CLUBS
// ============================================================================

async function findOwnedClub(guild, userId) {
  const record = sql.getClubByOwner.get(userId);
  if (!record) return null;

  const channel = await guild.channels.fetch(record.channel_id).catch(() => null);

  if (!channel) {
    sql.deleteClubByOwner.run(userId);
    return null;
  }

  return {
    record,
    channel,
  };
}

async function createPrivateClub(member, triggerChannel) {
  const existing = await findOwnedClub(member.guild, member.id);

  if (existing) {
    if (member.voice.channelId !== existing.channel.id) {
      await member.voice.setChannel(existing.channel).catch(() => null);
    }

    return existing.channel;
  }

  const channel = await member.guild.channels.create({
    name: `${CONFIG.PRIVATE_CLUBS.PREFIX}${sanitizeChannelName(member.displayName).slice(0, 35)}`,
    type: ChannelType.GuildVoice,
    parent: triggerChannel.parentId || undefined,
    permissionOverwrites: [
      {
        id: member.guild.roles.everyone.id,
        deny: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.Connect,
        ],
      },
      {
        id: CONFIG.ROLES.MEMBER,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.Connect,
        ],
      },
      {
        id: member.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.Connect,
          PermissionFlagsBits.Speak,
          PermissionFlagsBits.Stream,
          PermissionFlagsBits.UseVAD,
        ],
      },
      {
        id: client.user.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.Connect,
          PermissionFlagsBits.ManageChannels,
          PermissionFlagsBits.MoveMembers,
        ],
      },
      ...STAFF_ROLE_IDS.map((roleId) => ({
        id: roleId,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.Connect,
        ],
      })),
    ],
    reason: `Private club created for ${member.user.tag}`,
  });

  sql.addClub.run(
    channel.id,
    member.id,
    Date.now(),
  );

  await member.voice.setChannel(channel).catch(() => null);

  await logEvent(
    'private club created',
    `${member.user.tag} created <#${channel.id}>.`,
  );

  return channel;
}

function scheduleClubDeletion(channel) {
  if (pendingClubDeletes.has(channel.id)) {
    clearTimeout(pendingClubDeletes.get(channel.id));
  }

  const timer = setTimeout(async () => {
    pendingClubDeletes.delete(channel.id);

    const fresh = await channel.guild.channels.fetch(channel.id).catch(() => null);

    if (!fresh) {
      sql.deleteClubByChannel.run(channel.id);
      return;
    }

    if (!fresh.isVoiceBased() || fresh.members.size > 0) return;

    const record = sql.getClubByChannel.get(fresh.id);
    sql.deleteClubByChannel.run(fresh.id);

    await logEvent(
      'private club expired',
      record
        ? `<#${fresh.id}> owned by <@${record.owner_id}> expired after becoming empty.`
        : `<#${fresh.id}> expired after becoming empty.`,
    );

    await fresh.delete('Temporary club became empty').catch(() => null);
  }, CONFIG.PRIVATE_CLUBS.EMPTY_DELETE_DELAY_MS);

  timer.unref();
  pendingClubDeletes.set(channel.id, timer);
}

async function getOwnedClubOrReply(interaction) {
  const owned = await findOwnedClub(interaction.guild, interaction.user.id);

  if (!owned) {
    await interaction.reply(ephemeralPayload({
      content: `you do not own a private club. join <#${CONFIG.CHANNELS.CREATE_PRIVATE_CLUB}> first.`,
    }));

    return null;
  }

  return owned;
}

function clubRenameModal(channelName) {
  const current = channelName.startsWith(CONFIG.PRIVATE_CLUBS.PREFIX)
    ? channelName.slice(CONFIG.PRIVATE_CLUBS.PREFIX.length)
    : channelName;

  return new ModalBuilder()
    .setCustomId('club_modal_rename')
    .setTitle('rename private club')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('name')
          .setLabel('new club name')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(70)
          .setValue(current.slice(0, 70)),
      ),
    );
}

function clubLimitModal(currentLimit) {
  return new ModalBuilder()
    .setCustomId('club_modal_limit')
    .setTitle('private club limit')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('limit')
          .setLabel('0 = unlimited, otherwise 1-99')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(2)
          .setValue(String(currentLimit || 0)),
      ),
    );
}

async function sendClubUserSelect(interaction, action) {
  const labels = {
    allow: 'choose a user to permit',
    block: 'choose a user to block',
    transfer: 'choose the new owner',
  };

  const menu = new UserSelectMenuBuilder()
    .setCustomId(`club_user_${action}`)
    .setPlaceholder(labels[action])
    .setMinValues(1)
    .setMaxValues(1);

  await interaction.reply(ephemeralPayload({
    content: labels[action],
    components: [
      new ActionRowBuilder().addComponents(menu),
    ],
  }));
}

function clubInfoEmbed(record, channel) {
  return baseEmbed()
    .setTitle('𖤐 your private club')
    .setDescription(`<#${channel.id}>`)
    .addFields(
      {
        name: 'owner',
        value: `<@${record.owner_id}>`,
        inline: true,
      },
      {
        name: 'locked',
        value: record.locked ? 'yes' : 'no',
        inline: true,
      },
      {
        name: 'hidden',
        value: record.hidden ? 'yes' : 'no',
        inline: true,
      },
      {
        name: 'user limit',
        value: channel.userLimit ? String(channel.userLimit) : 'unlimited',
        inline: true,
      },
      {
        name: 'connected',
        value: String(channel.members.size),
        inline: true,
      },
      {
        name: 'created',
        value: `<t:${Math.floor(record.created_at / 1000)}:R>`,
        inline: true,
      },
    );
}

async function deletePrivateClub(channel, reason) {
  if (pendingClubDeletes.has(channel.id)) {
    clearTimeout(pendingClubDeletes.get(channel.id));
    pendingClubDeletes.delete(channel.id);
  }

  const record = sql.getClubByChannel.get(channel.id);
  sql.deleteClubByChannel.run(channel.id);

  await logEvent(
    'private club deleted',
    record
      ? `<#${channel.id}> owned by <@${record.owner_id}> was deleted.`
      : `<#${channel.id}> was deleted.`,
  );

  await channel.delete(reason).catch(() => null);
}

async function transferPrivateClub(channel, oldOwnerId, newOwnerId) {
  await channel.permissionOverwrites.delete(
    oldOwnerId,
    'Club ownership transferred',
  ).catch(() => null);

  await channel.permissionOverwrites.edit(
    newOwnerId,
    {
      ViewChannel: true,
      Connect: true,
      Speak: true,
      Stream: true,
      UseVAD: true,
    },
    {
      reason: 'New private club owner',
    },
  );

  sql.transferClub.run(
    newOwnerId,
    channel.id,
  );

  await logEvent(
    'club ownership transfer',
    `<@${oldOwnerId}> transferred <#${channel.id}> to <@${newOwnerId}>.`,
  );
}

async function handleClubButton(interaction) {
  if (interaction.customId === 'club_cancel_delete') {
    await interaction.update({
      content: 'cancelled.',
      components: [],
    });

    return;
  }

  const owned = await getOwnedClubOrReply(interaction);
  if (!owned) return;

  const channel = owned.channel;
  const record = sql.getClubByChannel.get(channel.id);

  if (interaction.customId === 'club_confirm_delete') {
    await interaction.update({
      content: 'club deleted.',
      components: [],
    }).catch(() => null);

    await deletePrivateClub(
      channel,
      `Deleted by owner ${interaction.user.tag}`,
    );

    return;
  }

  if (interaction.customId === 'club_rename') {
    await interaction.showModal(clubRenameModal(channel.name));
    return;
  }

  if (interaction.customId === 'club_limit') {
    await interaction.showModal(clubLimitModal(channel.userLimit));
    return;
  }

  if (interaction.customId === 'club_allow') {
    await sendClubUserSelect(interaction, 'allow');
    return;
  }

  if (interaction.customId === 'club_block') {
    await sendClubUserSelect(interaction, 'block');
    return;
  }

  if (interaction.customId === 'club_transfer') {
    await sendClubUserSelect(interaction, 'transfer');
    return;
  }

  if (interaction.customId === 'club_lock') {
    const newLocked = record.locked ? 0 : 1;

    await channel.permissionOverwrites.edit(
      CONFIG.ROLES.MEMBER,
      {
        Connect: newLocked ? false : true,
      },
      {
        reason: `Club ${newLocked ? 'locked' : 'unlocked'} by owner`,
      },
    );

    sql.setClubLocked.run(newLocked, channel.id);

    await interaction.reply(ephemeralPayload({
      content: newLocked ? 'club locked.' : 'club unlocked.',
    }));

    return;
  }

  if (interaction.customId === 'club_hide') {
    const newHidden = record.hidden ? 0 : 1;

    await channel.permissionOverwrites.edit(
      CONFIG.ROLES.MEMBER,
      {
        ViewChannel: newHidden ? false : true,
      },
      {
        reason: `Club ${newHidden ? 'hidden' : 'shown'} by owner`,
      },
    );

    sql.setClubHidden.run(newHidden, channel.id);

    await interaction.reply(ephemeralPayload({
      content: newHidden ? 'club hidden.' : 'club visible.',
    }));

    return;
  }

  if (interaction.customId === 'club_info') {
    const fresh = sql.getClubByChannel.get(channel.id);

    await interaction.reply(ephemeralPayload({
      embeds: [clubInfoEmbed(fresh, channel)],
    }));

    return;
  }

  if (interaction.customId === 'club_delete') {
    await interaction.reply(ephemeralPayload({
      content: `delete <#${channel.id}>?`,
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('club_confirm_delete')
            .setLabel('confirm delete')
            .setStyle(ButtonStyle.Danger),

          new ButtonBuilder()
            .setCustomId('club_cancel_delete')
            .setLabel('cancel')
            .setStyle(ButtonStyle.Secondary),
        ),
      ],
    }));
  }
}

async function handleClubUserSelect(interaction) {
  const action = interaction.customId.replace('club_user_', '');

  const owned = await findOwnedClub(interaction.guild, interaction.user.id);

  if (!owned) {
    await interaction.update({
      content: 'you no longer own a private club.',
      components: [],
    });

    return;
  }

  const targetId = interaction.values[0];

  const target = await interaction.guild.members.fetch(targetId).catch(() => null);

  if (!target || target.user.bot) {
    await interaction.update({
      content: 'choose a real server member.',
      components: [],
    });

    return;
  }

  if (action !== 'allow' && target.id === interaction.user.id) {
    await interaction.update({
      content: `you cannot ${action} yourself.`,
      components: [],
    });

    return;
  }

  if (action === 'block' && isStaff(target)) {
    await interaction.update({
      content: 'staff cannot be blocked from private clubs.',
      components: [],
    });

    return;
  }

  if (action === 'allow') {
    await owned.channel.permissionOverwrites.edit(
      targetId,
      {
        ViewChannel: true,
        Connect: true,
      },
      {
        reason: `Allowed by club owner ${interaction.user.tag}`,
      },
    );

    await interaction.update({
      content: `${target} is permitted.`,
      components: [],
    });

    return;
  }

  if (action === 'block') {
    await owned.channel.permissionOverwrites.edit(
      targetId,
      {
        ViewChannel: false,
        Connect: false,
      },
      {
        reason: `Blocked by club owner ${interaction.user.tag}`,
      },
    );

    if (target.voice.channelId === owned.channel.id) {
      await target.voice.setChannel(
        null,
        'Blocked from private club',
      ).catch(() => null);
    }

    await interaction.update({
      content: `${target} is blocked.`,
      components: [],
    });

    return;
  }

  if (action === 'transfer') {
    if (sql.getClubByOwner.get(targetId)) {
      await interaction.update({
        content: 'that user already owns another private club.',
        components: [],
      });

      return;
    }

    await transferPrivateClub(
      owned.channel,
      interaction.user.id,
      targetId,
    );

    await interaction.update({
      content: `ownership transferred to ${target}.`,
      components: [],
    });
  }
}

async function handleClubRenameModal(interaction) {
  const owned = await findOwnedClub(interaction.guild, interaction.user.id);

  if (!owned) {
    await interaction.reply(ephemeralPayload({
      content: 'you no longer own a private club.',
    }));

    return;
  }

  const safe = sanitizeChannelName(
    interaction.fields.getTextInputValue('name'),
  );

  const newName = `${CONFIG.PRIVATE_CLUBS.PREFIX}${safe}`.slice(0, 100);

  await owned.channel.setName(
    newName,
    `Renamed by club owner ${interaction.user.tag}`,
  );

  await interaction.reply(ephemeralPayload({
    content: `club renamed to **${newName}**.`,
  }));
}

async function handleClubLimitModal(interaction) {
  const owned = await findOwnedClub(interaction.guild, interaction.user.id);

  if (!owned) {
    await interaction.reply(ephemeralPayload({
      content: 'you no longer own a private club.',
    }));

    return;
  }

  const value = Number(
    interaction.fields.getTextInputValue('limit').trim(),
  );

  if (!Number.isInteger(value) || value < 0 || value > 99) {
    await interaction.reply(ephemeralPayload({
      content: 'user limit must be a whole number from **0-99**.',
    }));

    return;
  }

  await owned.channel.setUserLimit(
    value,
    `Changed by club owner ${interaction.user.tag}`,
  );

  await interaction.reply(ephemeralPayload({
    content: value === 0
      ? 'user limit removed.'
      : `user limit set to **${value}**.`,
  }));
}

// ============================================================================
// COUNTING
// ============================================================================

async function handleCountingMessage(message, state) {
  const content = message.content.trim();

  if (!/^\d+$/.test(content)) {
    return false;
  }

  const number = Number(content);

  const sameUser = message.author.id === state.last_user_id;
  const wrongNumber = number !== state.next_number;

  if (sameUser || wrongNumber) {
    await message.react('❌').catch(() => null);

    sql.resetCounting.run(message.channel.id);

    await message.channel.send({
      embeds: [
        baseEmbed()
          .setTitle('⛧ count reset')
          .setDescription(
            [
              `${message.author} broke the count.`,
              '',
              `reason: **${sameUser ? 'same person counted twice' : 'wrong number'}**`,
              `expected: **${state.next_number}**`,
              '',
              'back to **1**.',
            ].join('\n'),
          ),
      ],
    }).catch(() => null);

    return true;
  }

  await message.react('✅').catch(() => null);

  sql.updateCounting.run(
    number + 1,
    message.author.id,
    message.channel.id,
  );

  if ([50, 100, 250, 500, 1000].includes(number)) {
    await message.channel.send({
      embeds: [
        baseEmbed()
          .setTitle('𖤐 counting milestone')
          .setDescription(`the server reached **${number}**.`),
      ],
    }).catch(() => null);
  }

  return true;
}

// ============================================================================
// AUTOMOD
// ============================================================================

async function automodCase(member, action, reason, timeoutMs) {
  const caseId = createModCase(
    action,
    member.id,
    client.user.id,
    reason,
    timeoutMs,
  );

  if (timeoutMs && member.moderatable) {
    await member.timeout(
      timeoutMs,
      `${reason} | case #${caseId}`,
    ).catch(() => null);
  }

  await logEvent(
    `automod // ${action}`,
    `${member.user.tag} triggered automod. case **#${caseId}**.`,
    [
      {
        name: 'reason',
        value: truncate(reason),
      },
    ],
  );

  return caseId;
}

async function handleAutomod(message, member) {
  if (isStaff(member)) return false;

  const mentionCount = message.mentions.users.size + message.mentions.roles.size;

  if (mentionCount >= CONFIG.AUTOMOD.MASS_MENTION_LIMIT) {
    await message.delete().catch(() => null);

    const caseId = await automodCase(
      member,
      'mass_mentions',
      `Mass mentioning (${mentionCount} mentions)`,
      CONFIG.AUTOMOD.MASS_MENTION_TIMEOUT_MS,
    );

    const notice = await message.channel.send({
      content: `${member}, mass mentions are blocked. case **#${caseId}**.`,
    }).catch(() => null);

    if (notice) {
      setTimeout(() => notice.delete().catch(() => null), 6000).unref();
    }

    return true;
  }

  const key = `${message.guildId}:${member.id}`;
  const now = Date.now();

  const recent = (spamTracker.get(key) || [])
    .filter((timestamp) => now - timestamp < CONFIG.AUTOMOD.SPAM_WINDOW_MS);

  recent.push(now);
  spamTracker.set(key, recent);

  if (recent.length < CONFIG.AUTOMOD.SPAM_MAX_MESSAGES) {
    return false;
  }

  spamTracker.set(key, []);

  const caseId = await automodCase(
    member,
    'spam',
    `${recent.length} messages inside ${CONFIG.AUTOMOD.SPAM_WINDOW_MS / 1000}s`,
    CONFIG.AUTOMOD.SPAM_TIMEOUT_MS,
  );

  const notice = await message.channel.send({
    content: `${member}, slow down. case **#${caseId}**.`,
  }).catch(() => null);

  if (notice) {
    setTimeout(() => notice.delete().catch(() => null), 5000).unref();
  }

  return true;
}

// ============================================================================
// GAMES
// ============================================================================

const HANGMAN_WORDS = [
  'archive',
  'shadow',
  'static',
  'cryptic',
  'venom',
  'phantom',
  'hollow',
  'eclipse',
  'fracture',
  'monochrome',
  'glitch',
  'nocturne',
  'obsidian',
  'ritual',
  'vulture',
  'scarlet',
  'anarchy',
  'casket',
  'signal',
  'voided',
  'faceless',
  'afterdark',
  'devoid',
  'corrupted',
  'blackout',
  'nameless',
  'bleak',
  'dread',
  'ghosted',
  'deadframe',
  'graveyard',
  'midnight',
  'forsaken',
  'distorted',
  'decay',
  'silhouette',
  'bloodmoon',
  'terminal',
  'unknown',
  'abandoned',
  'outcast',
  'paranoia',
  'nightmare',
  'reaper',
  'chaotic',
  'offline',
  'forbidden',
  'lostfile',
  'deadpixel',
  'obscura',
];

function hangmanDisplay(game) {
  const shown = game.word
    .split('')
    .map((character) => game.guessed.has(character) ? character : '_')
    .join(' ');

  return [
    `\`${shown}\``,
    '',
    `wrong: ${game.wrong.size ? [...game.wrong].join(', ') : 'none'}`,
    '',
    `tries left: **${game.tries}**`,
  ].join('\n');
}

function ticTacToeWinner(board) {
  const lines = [
    [0, 1, 2],
    [3, 4, 5],
    [6, 7, 8],
    [0, 3, 6],
    [1, 4, 7],
    [2, 5, 8],
    [0, 4, 8],
    [2, 4, 6],
  ];

  for (const [a, b, c] of lines) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return board[a];
    }
  }

  return null;
}

function renderTicTacToeRows(gameId, board, disabled = false) {
  const rows = [];

  for (let row = 0; row < 3; row++) {
    const actionRow = new ActionRowBuilder();

    for (let column = 0; column < 3; column++) {
      const index = row * 3 + column;
      const value = board[index];

      let style = ButtonStyle.Secondary;
      if (value === 'X') style = ButtonStyle.Danger;
      if (value === 'O') style = ButtonStyle.Primary;

      actionRow.addComponents(
        new ButtonBuilder()
          .setCustomId(`ttt_${gameId}_${index}`)
          .setLabel(value || '·')
          .setStyle(style)
          .setDisabled(disabled || Boolean(value)),
      );
    }

    rows.push(actionRow);
  }

  return rows;
}

async function handleTicTacToeButton(interaction) {
  const [, gameId, rawIndex] = interaction.customId.split('_');
  const index = Number(rawIndex);
  const game = ticTacToeGames.get(gameId);

  if (!game) {
    await interaction.reply(ephemeralPayload({
      content: 'that tic tac toe game expired.',
    }));

    return;
  }

  if (!game.players.includes(interaction.user.id)) {
    await interaction.reply(ephemeralPayload({
      content: 'this is not your game.',
    }));

    return;
  }

  if (game.players[game.turn] !== interaction.user.id) {
    await interaction.reply(ephemeralPayload({
      content: 'not your turn.',
    }));

    return;
  }

  if (!Number.isInteger(index) || index < 0 || index > 8 || game.board[index]) {
    await interaction.reply(ephemeralPayload({
      content: 'that square is unavailable.',
    }));

    return;
  }

  game.board[index] = game.turn === 0 ? 'X' : 'O';

  const winner = ticTacToeWinner(game.board);
  const draw = !winner && game.board.every(Boolean);

  if (winner || draw) {
    ticTacToeGames.delete(gameId);

    let winnerId = null;

    if (winner === 'X') winnerId = game.players[0];
    if (winner === 'O') winnerId = game.players[1];

    await interaction.update({
      content: winnerId
        ? `𖤐 <@${winnerId}> wins.`
        : '⌁ draw.',
      components: renderTicTacToeRows(
        gameId,
        game.board,
        true,
      ),
    });

    return;
  }

  game.turn = game.turn === 0 ? 1 : 0;

  await interaction.update({
    content: [
      `<@${game.players[0]}> = **X**`,
      `<@${game.players[1]}> = **O**`,
      '',
      `turn: <@${game.players[game.turn]}>`,
    ].join('\n'),
    components: renderTicTacToeRows(
      gameId,
      game.board,
    ),
  });
}

// ============================================================================
// DIAGNOSTICS
// ============================================================================

async function doctorReport(guild) {
  const lines = [];

  const me = guild.members.me || await guild.members.fetchMe();

  lines.push(`**bot**: ${me.user.tag} (${me.id})`);
  lines.push(`**database**: \`${DB_PATH}\``);
  lines.push(
    `**railway volume**: \`${process.env.RAILWAY_VOLUME_MOUNT_PATH || 'not mounted'}\``,
  );
  lines.push('');

  const missingGuildPermissions = REQUIRED_BOT_PERMISSIONS
    .filter(([, bit]) => !me.permissions.has(bit))
    .map(([name]) => name);

  lines.push(
    missingGuildPermissions.length
      ? `❌ guild permissions missing: ${missingGuildPermissions.join(', ')}`
      : '✅ required guild permissions look good',
  );

  const roleEntries = [
    ['VERIFY', CONFIG.ROLES.VERIFY],
    ['MEMBER', CONFIG.ROLES.MEMBER],
    ['MEMBER_TAG', CONFIG.ROLES.MEMBER_TAG],
    ['MISC', CONFIG.ROLES.MISC],
    ['LOYAL_MEMBER', CONFIG.ROLES.LOYAL_MEMBER],
    ['MEDIA_POSTER', CONFIG.ROLES.MEDIA_POSTER],
    ['ADMIN', CONFIG.ROLES.ADMIN],
    ['SR_MOD', CONFIG.ROLES.SR_MOD],
    ['MOD', CONFIG.ROLES.MOD],
    ['ASCENDANT', CONFIG.ROLES.ASCENDANT],
    ['MANAGEMENT', CONFIG.ROLES.MANAGEMENT],
    ...LEVEL_MILESTONES.map((level) => [
      `LEVEL_${level}`,
      CONFIG.ROLES.LEVELS[level],
    ]),
  ];

  let missingRoles = 0;
  let hierarchyProblems = 0;

  for (const [name, id] of roleEntries) {
    const role = await guild.roles.fetch(id).catch(() => null);

    if (!role) {
      missingRoles++;
      lines.push(`❌ role ${name}: missing / inaccessible (${id})`);
      continue;
    }

    if (
      [
        CONFIG.ROLES.VERIFY,
        CONFIG.ROLES.MEMBER,
        CONFIG.ROLES.MEMBER_TAG,
        CONFIG.ROLES.MISC,
        CONFIG.ROLES.LOYAL_MEMBER,
        CONFIG.ROLES.MEDIA_POSTER,
        ...Object.values(CONFIG.ROLES.LEVELS),
      ].includes(id) &&
      me.roles.highest.position <= role.position
    ) {
      hierarchyProblems++;
      lines.push(`❌ role hierarchy: bot role must be above ${role.name}`);
    }
  }

  if (!missingRoles) {
    lines.push('✅ all configured roles resolve');
  }

  if (!hierarchyProblems) {
    lines.push('✅ managed-role hierarchy looks good');
  }

  const channelEntries = Object.entries(CONFIG.CHANNELS);
  let missingChannels = 0;
  let channelPermissionProblems = 0;

  for (const [name, id] of channelEntries) {
    const channel = await guild.channels.fetch(id).catch(() => null);

    if (!channel) {
      missingChannels++;
      lines.push(`❌ channel ${name}: missing / inaccessible (${id})`);
      continue;
    }

    if (channel.isTextBased()) {
      const permissions = channel.permissionsFor(me);

      const missing = [
        ['ViewChannel', PermissionFlagsBits.ViewChannel],
        ['SendMessages', PermissionFlagsBits.SendMessages],
        ['EmbedLinks', PermissionFlagsBits.EmbedLinks],
      ]
        .filter(([, bit]) => !permissions?.has(bit))
        .map(([label]) => label);

      if (missing.length) {
        channelPermissionProblems++;
        lines.push(
          `❌ #${channel.name}: bot missing ${missing.join(', ')}`,
        );
      }
    }
  }

  if (!missingChannels) {
    lines.push('✅ all configured channels resolve');
  }

  if (!channelPermissionProblems) {
    lines.push('✅ basic channel send/embed permissions look good');
  }

  for (const [label, id] of [
    ['PFP', CONFIG.CHANNELS.PFP],
    ['BANNER', CONFIG.CHANNELS.BANNER],
  ]) {
    const channel = await guild.channels.fetch(id).catch(() => null);

    if (channel?.isTextBased() && channel.rateLimitPerUser > 0) {
      lines.push(
        `⚠️ ${label} native slowmode is ${channel.rateLimitPerUser}s; set it to 0 because the bot handles this cooldown itself`,
      );
    } else if (channel?.isTextBased()) {
      lines.push(`✅ ${label} native slowmode is 0`);
    }
  }

  const ticketChannel = await guild.channels.fetch(CONFIG.CHANNELS.TICKETS).catch(() => null);

  if (ticketChannel?.isTextBased()) {
    lines.push(
      `**ticket parent category**: ${
        ticketChannel.parent
          ? `${ticketChannel.parent.name} (${ticketChannel.parent.id})`
          : 'none — ticket channels will be created at server root'
      }`,
    );
  }

  lines.push('');
  lines.push('If everything above is ✅, the bot is structurally locked in.');

  return lines;
}

async function startupAudit() {
  try {
    const guild = await fetchGuild();
    const lines = await doctorReport(guild);

    console.log('[doctor]');
    for (const line of lines) {
      console.log(line.replace(/\*\*/g, ''));
    }

    const me = guild.members.me || await guild.members.fetchMe();

    if (me.permissions.has(PermissionFlagsBits.ManageChannels)) {
      for (const id of [CONFIG.CHANNELS.PFP, CONFIG.CHANNELS.BANNER]) {
        const channel = await guild.channels.fetch(id).catch(() => null);

        if (
          channel?.isTextBased() &&
          typeof channel.setRateLimitPerUser === 'function' &&
          channel.rateLimitPerUser > 0
        ) {
          await channel.setRateLimitPerUser(
            0,
            'kvsarchive uses its own media cooldown for MEDIA POSTER bypass',
          ).catch(() => null);
        }
      }
    }
  } catch (error) {
    console.error('[startupAudit]', error);
  }
}

// ============================================================================
// SLASH COMMAND DEFINITIONS
// ============================================================================

const STAFF_DEFAULT_PERMISSION = PermissionFlagsBits.ManageMessages;
const MANAGEMENT_DEFAULT_PERMISSION = PermissionFlagsBits.ManageGuild;
const OWNER_DEFAULT_PERMISSION = PermissionFlagsBits.Administrator;

const commands = [
  new SlashCommandBuilder()
    .setName('help')
    .setDescription('show kvsarchive commands'),

  new SlashCommandBuilder()
    .setName('ping')
    .setDescription('check bot latency'),

  new SlashCommandBuilder()
    .setName('uptime')
    .setDescription('show bot uptime'),

  new SlashCommandBuilder()
    .setName('level')
    .setDescription('check an activity level')
    .addUserOption((option) =>
      option
        .setName('user')
        .setDescription('user to inspect'),
    ),

  new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('show the top activity levels'),

  new SlashCommandBuilder()
    .setName('mediastats')
    .setDescription('check PFP/banner contribution progress')
    .addUserOption((option) =>
      option
        .setName('user')
        .setDescription('user to inspect'),
    ),

  new SlashCommandBuilder()
    .setName('avatar')
    .setDescription('show a user avatar')
    .addUserOption((option) =>
      option
        .setName('user')
        .setDescription('user'),
    ),

  new SlashCommandBuilder()
    .setName('banner')
    .setDescription('show a user Discord profile banner')
    .addUserOption((option) =>
      option
        .setName('user')
        .setDescription('user'),
    ),

  new SlashCommandBuilder()
    .setName('userinfo')
    .setDescription('show basic user information')
    .addUserOption((option) =>
      option
        .setName('user')
        .setDescription('user'),
    ),

  new SlashCommandBuilder()
    .setName('serverinfo')
    .setDescription('show server information'),

  new SlashCommandBuilder()
    .setName('roleinfo')
    .setDescription('show role information')
    .addRoleOption((option) =>
      option
        .setName('role')
        .setDescription('role')
        .setRequired(true),
    ),

  new SlashCommandBuilder()
    .setName('coinflip')
    .setDescription('flip a coin'),

  new SlashCommandBuilder()
    .setName('roll')
    .setDescription('roll a die')
    .addIntegerOption((option) =>
      option
        .setName('sides')
        .setDescription('number of sides')
        .setMinValue(2)
        .setMaxValue(100000),
    ),

  new SlashCommandBuilder()
    .setName('8ball')
    .setDescription('ask the 8ball something')
    .addStringOption((option) =>
      option
        .setName('question')
        .setDescription('your question')
        .setRequired(true)
        .setMaxLength(500),
    ),

  new SlashCommandBuilder()
    .setName('rps')
    .setDescription('rock paper scissors')
    .addStringOption((option) =>
      option
        .setName('choice')
        .setDescription('your move')
        .setRequired(true)
        .addChoices(
          {
            name: 'rock',
            value: 'rock',
          },
          {
            name: 'paper',
            value: 'paper',
          },
          {
            name: 'scissors',
            value: 'scissors',
          },
        ),
    ),

  new SlashCommandBuilder()
    .setName('choose')
    .setDescription('let the bot choose between options')
    .addStringOption((option) =>
      option
        .setName('choices')
        .setDescription('separate choices with |')
        .setRequired(true)
        .setMaxLength(1000),
    ),

  new SlashCommandBuilder()
    .setName('ship')
    .setDescription('calculate a compatibility percentage')
    .addUserOption((option) =>
      option
        .setName('user1')
        .setDescription('first user')
        .setRequired(true),
    )
    .addUserOption((option) =>
      option
        .setName('user2')
        .setDescription('second user')
        .setRequired(true),
    ),

  new SlashCommandBuilder()
    .setName('hangman')
    .setDescription('start a hangman game'),

  new SlashCommandBuilder()
    .setName('guess')
    .setDescription('guess a hangman letter or word')
    .addStringOption((option) =>
      option
        .setName('guess')
        .setDescription('letter or full word')
        .setRequired(true)
        .setMaxLength(30),
    ),

  new SlashCommandBuilder()
    .setName('numberguess')
    .setDescription('start a number guessing game')
    .addIntegerOption((option) =>
      option
        .setName('max')
        .setDescription('maximum possible number')
        .setMinValue(10)
        .setMaxValue(100000),
    ),

  new SlashCommandBuilder()
    .setName('guessnum')
    .setDescription('guess the current number')
    .addIntegerOption((option) =>
      option
        .setName('number')
        .setDescription('your guess')
        .setRequired(true),
    ),

  new SlashCommandBuilder()
    .setName('tictactoe')
    .setDescription('challenge another member to tic tac toe')
    .addUserOption((option) =>
      option
        .setName('user')
        .setDescription('opponent')
        .setRequired(true),
    ),

  new SlashCommandBuilder()
    .setName('poll')
    .setDescription('create a reaction poll')
    .addStringOption((option) =>
      option
        .setName('question')
        .setDescription('poll question')
        .setRequired(true)
        .setMaxLength(500),
    )
    .addStringOption((option) =>
      option
        .setName('option1')
        .setDescription('option one')
        .setRequired(true)
        .setMaxLength(100),
    )
    .addStringOption((option) =>
      option
        .setName('option2')
        .setDescription('option two')
        .setRequired(true)
        .setMaxLength(100),
    )
    .addStringOption((option) =>
      option
        .setName('option3')
        .setDescription('optional')
        .setMaxLength(100),
    )
    .addStringOption((option) =>
      option
        .setName('option4')
        .setDescription('optional')
        .setMaxLength(100),
    )
    .addStringOption((option) =>
      option
        .setName('option5')
        .setDescription('optional')
        .setMaxLength(100),
    ),

  new SlashCommandBuilder()
    .setName('counting')
    .setDescription('counting game controls')
    .addSubcommand((subcommand) =>
      subcommand
        .setName('status')
        .setDescription('show counting status here'),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('start')
        .setDescription('staff: start counting here'),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('stop')
        .setDescription('staff: stop counting here'),
    ),

  new SlashCommandBuilder()
    .setName('warn')
    .setDescription('warn a member')
    .setDefaultMemberPermissions(STAFF_DEFAULT_PERMISSION)
    .addUserOption((option) =>
      option
        .setName('user')
        .setDescription('member')
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName('reason')
        .setDescription('warning reason')
        .setRequired(true)
        .setMaxLength(1000),
    ),

  new SlashCommandBuilder()
    .setName('warnings')
    .setDescription('view member warnings')
    .setDefaultMemberPermissions(STAFF_DEFAULT_PERMISSION)
    .addUserOption((option) =>
      option
        .setName('user')
        .setDescription('member')
        .setRequired(true),
    ),

  new SlashCommandBuilder()
    .setName('clearwarnings')
    .setDescription('clear all warnings from a member')
    .setDefaultMemberPermissions(STAFF_DEFAULT_PERMISSION)
    .addUserOption((option) =>
      option
        .setName('user')
        .setDescription('member')
        .setRequired(true),
    ),

  new SlashCommandBuilder()
    .setName('case')
    .setDescription('view one moderation case')
    .setDefaultMemberPermissions(STAFF_DEFAULT_PERMISSION)
    .addIntegerOption((option) =>
      option
        .setName('id')
        .setDescription('case ID')
        .setRequired(true)
        .setMinValue(1),
    ),

  new SlashCommandBuilder()
    .setName('cases')
    .setDescription('view recent moderation cases for a member')
    .setDefaultMemberPermissions(STAFF_DEFAULT_PERMISSION)
    .addUserOption((option) =>
      option
        .setName('user')
        .setDescription('member')
        .setRequired(true),
    ),

  new SlashCommandBuilder()
    .setName('clear')
    .setDescription('bulk delete messages')
    .setDefaultMemberPermissions(STAFF_DEFAULT_PERMISSION)
    .addIntegerOption((option) =>
      option
        .setName('amount')
        .setDescription('number of messages')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(100),
    ),

  new SlashCommandBuilder()
    .setName('timeout')
    .setDescription('timeout a member')
    .setDefaultMemberPermissions(STAFF_DEFAULT_PERMISSION)
    .addUserOption((option) =>
      option
        .setName('user')
        .setDescription('member')
        .setRequired(true),
    )
    .addIntegerOption((option) =>
      option
        .setName('minutes')
        .setDescription('timeout duration in minutes')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(40320),
    )
    .addStringOption((option) =>
      option
        .setName('reason')
        .setDescription('reason')
        .setMaxLength(1000),
    ),

  new SlashCommandBuilder()
    .setName('untimeout')
    .setDescription('remove a timeout')
    .setDefaultMemberPermissions(STAFF_DEFAULT_PERMISSION)
    .addUserOption((option) =>
      option
        .setName('user')
        .setDescription('member')
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName('reason')
        .setDescription('reason')
        .setMaxLength(1000),
    ),

  new SlashCommandBuilder()
    .setName('kick')
    .setDescription('kick a member')
    .setDefaultMemberPermissions(STAFF_DEFAULT_PERMISSION)
    .addUserOption((option) =>
      option
        .setName('user')
        .setDescription('member')
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName('reason')
        .setDescription('reason')
        .setMaxLength(1000),
    ),

  new SlashCommandBuilder()
    .setName('ban')
    .setDescription('ban a member')
    .setDefaultMemberPermissions(STAFF_DEFAULT_PERMISSION)
    .addUserOption((option) =>
      option
        .setName('user')
        .setDescription('member')
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName('reason')
        .setDescription('reason')
        .setMaxLength(1000),
    )
    .addIntegerOption((option) =>
      option
        .setName('delete_hours')
        .setDescription('message history to delete')
        .setMinValue(0)
        .setMaxValue(168),
    ),

  new SlashCommandBuilder()
    .setName('unban')
    .setDescription('unban a user by Discord ID')
    .setDefaultMemberPermissions(STAFF_DEFAULT_PERMISSION)
    .addStringOption((option) =>
      option
        .setName('userid')
        .setDescription('Discord user ID')
        .setRequired(true)
        .setMinLength(17)
        .setMaxLength(20),
    )
    .addStringOption((option) =>
      option
        .setName('reason')
        .setDescription('reason')
        .setMaxLength(1000),
    ),

  new SlashCommandBuilder()
    .setName('slowmode')
    .setDescription('change channel slowmode')
    .setDefaultMemberPermissions(STAFF_DEFAULT_PERMISSION)
    .addIntegerOption((option) =>
      option
        .setName('seconds')
        .setDescription('0 disables slowmode')
        .setRequired(true)
        .setMinValue(0)
        .setMaxValue(21600),
    )
    .addChannelOption((option) =>
      option
        .setName('channel')
        .setDescription('channel; defaults to current'),
    ),

  new SlashCommandBuilder()
    .setName('lock')
    .setDescription('lock a text channel')
    .setDefaultMemberPermissions(STAFF_DEFAULT_PERMISSION)
    .addChannelOption((option) =>
      option
        .setName('channel')
        .setDescription('channel; defaults to current'),
    ),

  new SlashCommandBuilder()
    .setName('unlock')
    .setDescription('unlock a text channel')
    .setDefaultMemberPermissions(STAFF_DEFAULT_PERMISSION)
    .addChannelOption((option) =>
      option
        .setName('channel')
        .setDescription('channel; defaults to current'),
    ),

  new SlashCommandBuilder()
    .setName('nick')
    .setDescription('change a member nickname')
    .setDefaultMemberPermissions(STAFF_DEFAULT_PERMISSION)
    .addUserOption((option) =>
      option
        .setName('user')
        .setDescription('member')
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName('nickname')
        .setDescription('leave blank to clear nickname')
        .setMaxLength(32),
    ),

  new SlashCommandBuilder()
    .setName('psa')
    .setDescription('post a PSA')
    .setDefaultMemberPermissions(MANAGEMENT_DEFAULT_PERMISSION)
    .addStringOption((option) =>
      option
        .setName('message')
        .setDescription('PSA text')
        .setRequired(true)
        .setMaxLength(4000),
    )
    .addStringOption((option) =>
      option
        .setName('title')
        .setDescription('optional title')
        .setMaxLength(200),
    ),

  new SlashCommandBuilder()
    .setName('setup')
    .setDescription('owner: post official panels')
    .setDefaultMemberPermissions(OWNER_DEFAULT_PERMISSION)
    .addStringOption((option) =>
      option
        .setName('panel')
        .setDescription('panel to post')
        .setRequired(true)
        .addChoices(
          {
            name: 'all',
            value: 'all',
          },
          {
            name: 'verification',
            value: 'verify',
          },
          {
            name: 'tickets',
            value: 'tickets',
          },
          {
            name: 'private clubs',
            value: 'clubs',
          },
          {
            name: 'specialty info',
            value: 'info',
          },
        ),
    ),

  new SlashCommandBuilder()
    .setName('staffapppost')
    .setDescription('owner: post staff application panel')
    .setDefaultMemberPermissions(OWNER_DEFAULT_PERMISSION),

  new SlashCommandBuilder()
    .setName('test')
    .setDescription('owner: test bot panels')
    .setDefaultMemberPermissions(OWNER_DEFAULT_PERMISSION)
    .addStringOption((option) =>
      option
        .setName('type')
        .setDescription('what to test')
        .setRequired(true)
        .addChoices(
          {
            name: 'welcome',
            value: 'welcome',
          },
          {
            name: 'verification panel',
            value: 'verify',
          },
          {
            name: 'ticket panel',
            value: 'tickets',
          },
          {
            name: 'club panel',
            value: 'clubs',
          },
          {
            name: 'specialty info',
            value: 'info',
          },
          {
            name: 'staff application',
            value: 'staffapp',
          },
          {
            name: 'verification code',
            value: 'verification',
          },
        ),
    ),

  new SlashCommandBuilder()
    .setName('doctor')
    .setDescription('owner: diagnose channels, roles, permissions and storage')
    .setDefaultMemberPermissions(OWNER_DEFAULT_PERMISSION),

  new SlashCommandBuilder()
    .setName('xp')
    .setDescription('owner: manage activity XP')
    .setDefaultMemberPermissions(OWNER_DEFAULT_PERMISSION)
    .addSubcommand((subcommand) =>
      subcommand
        .setName('add')
        .setDescription('add XP')
        .addUserOption((option) =>
          option
            .setName('user')
            .setDescription('member')
            .setRequired(true),
        )
        .addIntegerOption((option) =>
          option
            .setName('amount')
            .setDescription('XP amount')
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(10000000),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('remove')
        .setDescription('remove XP')
        .addUserOption((option) =>
          option
            .setName('user')
            .setDescription('member')
            .setRequired(true),
        )
        .addIntegerOption((option) =>
          option
            .setName('amount')
            .setDescription('XP amount')
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(10000000),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('set')
        .setDescription('set exact XP')
        .addUserOption((option) =>
          option
            .setName('user')
            .setDescription('member')
            .setRequired(true),
        )
        .addIntegerOption((option) =>
          option
            .setName('amount')
            .setDescription('exact XP')
            .setRequired(true)
            .setMinValue(0)
            .setMaxValue(100000000),
        ),
    ),

  new SlashCommandBuilder()
    .setName('synclevelroles')
    .setDescription('owner: resync activity roles')
    .setDefaultMemberPermissions(OWNER_DEFAULT_PERMISSION),

  new SlashCommandBuilder()
    .setName('syncautoroles')
    .setDescription('owner: give VERIFY to currently unverified members')
    .setDefaultMemberPermissions(OWNER_DEFAULT_PERMISSION),

  new SlashCommandBuilder()
    .setName('say')
    .setDescription('owner: send a bot message')
    .setDefaultMemberPermissions(OWNER_DEFAULT_PERMISSION)
    .addChannelOption((option) =>
      option
        .setName('channel')
        .setDescription('destination')
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName('message')
        .setDescription('message content')
        .setRequired(true)
        .setMaxLength(2000),
    ),

  new SlashCommandBuilder()
    .setName('embedpost')
    .setDescription('owner: post a custom archive embed')
    .setDefaultMemberPermissions(OWNER_DEFAULT_PERMISSION)
    .addChannelOption((option) =>
      option
        .setName('channel')
        .setDescription('destination')
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName('title')
        .setDescription('embed title')
        .setRequired(true)
        .setMaxLength(256),
    )
    .addStringOption((option) =>
      option
        .setName('description')
        .setDescription('embed body')
        .setRequired(true)
        .setMaxLength(4000),
    ),
].map((command) => command.toJSON());

async function registerGuildCommands() {
  if (!process.env.DISCORD_TOKEN) {
    throw new Error('DISCORD_TOKEN is missing.');
  }

  const rest = new REST({
    version: '10',
  }).setToken(process.env.DISCORD_TOKEN);

  await rest.put(
    Routes.applicationGuildCommands(
      client.user.id,
      CONFIG.GUILD_ID,
    ),
    {
      body: commands,
    },
  );

  console.log(`[commands] registered ${commands.length} guild commands`);
}

// ============================================================================
// EVENT: READY
// ============================================================================

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`[ready] logged in as ${readyClient.user.tag}`);

  readyClient.user.setPresence({
    activities: [
      {
        name: 'kvsarchive',
        type: ActivityType.Watching,
      },
    ],
    status: 'dnd',
  });

  try {
    await registerGuildCommands();
  } catch (error) {
    console.error('[command registration]', error);
  }

  const guild = await fetchGuild().catch(() => null);

  if (guild) {
    const clubRows = db.prepare('SELECT * FROM temp_clubs').all();

    for (const record of clubRows) {
      const channel = await guild.channels.fetch(record.channel_id).catch(() => null);

      if (!channel) {
        sql.deleteClubByChannel.run(record.channel_id);
        continue;
      }

      if (channel.isVoiceBased() && channel.members.size === 0) {
        scheduleClubDeletion(channel);
      }
    }
  }

  await startupAudit();

  console.log('[ready] kvsarchive systems online');
});

// ============================================================================
// EVENT: MEMBER JOIN / LEAVE / UPDATE
// ============================================================================

client.on(Events.GuildMemberAdd, async (member) => {
  if (member.guild.id !== CONFIG.GUILD_ID || member.user.bot) return;

  sql.ensureUser.run(member.id);

  if (!member.roles.cache.has(CONFIG.ROLES.VERIFY)) {
    try {
      await member.roles.add(
        CONFIG.ROLES.VERIFY,
        'Awaiting kvsarchive verification',
      );
    } catch (error) {
      await logEvent(
        'autorole failed',
        `Could not give VERIFY to ${member.user.tag} (${member.id}): ${error.message}`,
      );
    }
  }

  await logEvent(
    'member joined',
    [
      `${member.user.tag}`,
      `id: \`${member.id}\``,
      `account created: <t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`,
    ].join('\n'),
  );
});

client.on(Events.GuildMemberRemove, async (member) => {
  if (member.guild.id !== CONFIG.GUILD_ID) return;

  sql.deleteVerifyCode.run(member.id);

  const owned = sql.getClubByOwner.get(member.id);

  if (owned) {
    const channel = await member.guild.channels.fetch(owned.channel_id).catch(() => null);

    sql.deleteClubByOwner.run(member.id);

    if (channel) {
      await channel.delete('Private club owner left server').catch(() => null);
    }
  }

  await logEvent(
    'member left',
    `${member.user.tag} (${member.id}) left the server.`,
  );
});

client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
  if (newMember.guild.id !== CONFIG.GUILD_ID || newMember.user.bot) return;

  const oldRoles = oldMember.roles.cache;
  const newRoles = newMember.roles.cache;

  const added = newRoles.filter((role) => !oldRoles.has(role.id));
  const removed = oldRoles.filter((role) => !newRoles.has(role.id));

  const fields = [];

  if (added.size) {
    fields.push({
      name: 'roles added',
      value: truncate(added.map((role) => `${role}`).join(' ')),
    });
  }

  if (removed.size) {
    fields.push({
      name: 'roles removed',
      value: truncate(removed.map((role) => `${role}`).join(' ')),
    });
  }

  if (oldMember.nickname !== newMember.nickname) {
    fields.push({
      name: 'nickname',
      value: `${oldMember.nickname || 'none'} → ${newMember.nickname || 'none'}`,
    });
  }

  if (
    oldMember.communicationDisabledUntilTimestamp !==
    newMember.communicationDisabledUntilTimestamp
  ) {
    fields.push({
      name: 'timeout',
      value: newMember.communicationDisabledUntilTimestamp
        ? `<t:${Math.floor(newMember.communicationDisabledUntilTimestamp / 1000)}:R>`
        : 'removed',
    });
  }

  if (fields.length) {
    await logEvent(
      'member updated',
      `${newMember.user.tag} (${newMember.id})`,
      fields,
    );
  }
});

// ============================================================================
// EVENT: BANS
// ============================================================================

client.on(Events.GuildBanAdd, async (ban) => {
  if (ban.guild.id !== CONFIG.GUILD_ID) return;

  await logEvent(
    'guild ban added',
    `${ban.user.tag} (${ban.user.id}) was banned.`,
  );
});

client.on(Events.GuildBanRemove, async (ban) => {
  if (ban.guild.id !== CONFIG.GUILD_ID) return;

  await logEvent(
    'guild ban removed',
    `${ban.user.tag} (${ban.user.id}) was unbanned.`,
  );
});

// ============================================================================
// EVENT: VOICE
// ============================================================================

client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
  const guild = newState.guild || oldState.guild;

  if (guild.id !== CONFIG.GUILD_ID) return;

  const member = newState.member || oldState.member;

  if (!member || member.user.bot) return;

  if (newState.channelId === CONFIG.CHANNELS.CREATE_PRIVATE_CLUB) {
    try {
      await createPrivateClub(member, newState.channel);
    } catch (error) {
      await member.send({
        embeds: [
          errorEmbed(
            `I could not create your private club: ${truncate(error.message, 1200)}`,
          ),
        ],
      }).catch(() => null);

      await logEvent(
        'private club creation failed',
        `${member.user.tag}: ${error.message}`,
      );
    }
  }

  if (
    oldState.channelId &&
    oldState.channelId !== newState.channelId
  ) {
    const record = sql.getClubByChannel.get(oldState.channelId);

    if (
      record &&
      oldState.channel &&
      oldState.channel.members.size === 0
    ) {
      scheduleClubDeletion(oldState.channel);
    }
  }

  if (
    newState.channelId &&
    pendingClubDeletes.has(newState.channelId)
  ) {
    clearTimeout(pendingClubDeletes.get(newState.channelId));
    pendingClubDeletes.delete(newState.channelId);
  }
});

setInterval(async () => {
  const guild = await fetchGuild().catch(() => null);
  if (!guild) return;

  for (const channel of guild.channels.cache.values()) {
    if (!channel.isVoiceBased()) continue;
    if (channel.id === CONFIG.CHANNELS.CREATE_PRIVATE_CLUB) continue;
    if (guild.afkChannelId && channel.id === guild.afkChannelId) continue;

    const humans = channel.members.filter((member) => {
      if (member.user.bot) return false;
      if (member.voice.selfDeaf || member.voice.serverDeaf) return false;
      return true;
    });

    if (humans.size < CONFIG.LEVELING.VOICE_MIN_HUMANS) continue;

    for (const member of humans.values()) {
      sql.ensureUser.run(member.id);

      const before = sql.getUser.get(member.id);
      const amount = CONFIG.LEVELING.VOICE_XP_PER_MINUTE;

      sql.awardVoiceXp.run(
        amount,
        amount,
        member.id,
      );

      const after = sql.getUser.get(member.id);

      await processLevelChange(member, before.xp, after.xp);
    }
  }
}, 60_000).unref();

// ============================================================================
// EVENT: MESSAGES
// ============================================================================

client.on(Events.MessageCreate, async (message) => {
  try {
    if (!message.guild) {
      await handleVerificationDM(message);
      return;
    }

    if (message.guild.id !== CONFIG.GUILD_ID || message.author.bot) {
      return;
    }

    const member = message.member;
    if (!member) return;

    const isPfp = message.channelId === CONFIG.CHANNELS.PFP;
    const isBanner = message.channelId === CONFIG.CHANNELS.BANNER;

    if (isPfp) {
      const accepted = await handleMediaMessage(message, member, 'pfp');
      if (!accepted) return;
    }

    if (isBanner) {
      const accepted = await handleMediaMessage(message, member, 'banner');
      if (!accepted) return;
    }

    const counting = sql.getCounting.get(message.channelId);

    if (counting) {
      const handled = await handleCountingMessage(message, counting);
      if (handled) return;
    }

    if (!isPfp && !isBanner) {
      const moderated = await handleAutomod(message, member);
      if (moderated) return;
    }

    await awardTextXp(message, member);
  } catch (error) {
    console.error('[message create]', error);
  }
});

client.on(Events.MessageDelete, async (message) => {
  try {
    if (message.guild?.id !== CONFIG.GUILD_ID) return;

    const tracked = sql.getMediaPost.get(message.id);

    if (tracked) {
      sql.deleteMediaPost.run(message.id);

      const member = await message.guild.members.fetch(tracked.user_id).catch(() => null);

      if (member) {
        await updateMediaPosterRole(member);
      }
    }

    if (message.author?.bot) return;
    if (message.channelId === CONFIG.CHANNELS.SERVER_LOGS) return;

    const attachments = message.attachments?.size
      ? [...message.attachments.values()].map((attachment) => attachment.url).join('\n')
      : 'none';

    await logEvent(
      'message deleted',
      [
        `channel: <#${message.channelId}>`,
        `author: ${message.author ? `${message.author.tag} (${message.author.id})` : 'unknown'}`,
        '',
        `content: ${truncate(message.content || '[not cached]', 1600)}`,
      ].join('\n'),
      [
        {
          name: 'attachments',
          value: truncate(attachments),
        },
      ],
    );
  } catch (error) {
    console.error('[message delete]', error);
  }
});

client.on(Events.MessageUpdate, async (oldMessage, newMessage) => {
  try {
    if (newMessage.guild?.id !== CONFIG.GUILD_ID) return;
    if (newMessage.author?.bot) return;
    if (newMessage.channelId === CONFIG.CHANNELS.SERVER_LOGS) return;
    if (oldMessage.content === newMessage.content) return;

    await logEvent(
      'message edited',
      `channel: <#${newMessage.channelId}>\nauthor: ${
        newMessage.author
          ? `${newMessage.author.tag} (${newMessage.author.id})`
          : 'unknown'
      }`,
      [
        {
          name: 'before',
          value: truncate(oldMessage.content || '[not cached]'),
        },
        {
          name: 'after',
          value: truncate(newMessage.content || '[empty]'),
        },
      ],
    );
  } catch (error) {
    console.error('[message update]', error);
  }
});

client.on(Events.ChannelDelete, async (channel) => {
  if (channel.guild?.id !== CONFIG.GUILD_ID) return;

  if (sql.getClubByChannel.get(channel.id)) {
    sql.deleteClubByChannel.run(channel.id);

    if (pendingClubDeletes.has(channel.id)) {
      clearTimeout(pendingClubDeletes.get(channel.id));
      pendingClubDeletes.delete(channel.id);
    }
  }

  if (sql.getTicket.get(channel.id)) {
    sql.deleteTicket.run(channel.id);
  }
});

// ============================================================================
// MODAL HANDLER
// ============================================================================

async function handleModalSubmission(interaction) {
  if (interaction.customId.startsWith('ticket_modal_')) {
    const type = interaction.customId.replace('ticket_modal_', '');

    const subject = interaction.fields.getTextInputValue('subject');
    const details = interaction.fields.getTextInputValue('details');

    let evidence = '';

    try {
      evidence = interaction.fields.getTextInputValue('evidence');
    } catch {
      evidence = '';
    }

    await createTicketChannel(
      interaction,
      type,
      subject,
      details,
      evidence,
    );

    return;
  }

  if (interaction.customId === 'staffapp_modal') {
    await createStaffApplication(
      interaction,
      {
        age: interaction.fields.getTextInputValue('age'),
        timezone: interaction.fields.getTextInputValue('timezone'),
        experience: interaction.fields.getTextInputValue('experience'),
        why: interaction.fields.getTextInputValue('why'),
        availability: interaction.fields.getTextInputValue('availability'),
      },
    );

    return;
  }

  if (interaction.customId === 'club_modal_rename') {
    await handleClubRenameModal(interaction);
    return;
  }

  if (interaction.customId === 'club_modal_limit') {
    await handleClubLimitModal(interaction);
  }
}

// ============================================================================
// INTERACTION ROUTER
// ============================================================================

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.guild && interaction.guild.id !== CONFIG.GUILD_ID) {
      return;
    }

    if (interaction.isButton()) {
      if (!interaction.guild) return;

      if (interaction.customId === 'verify_start') {
        await handleVerifyButton(interaction);
        return;
      }

      if (interaction.customId === 'staffapp_open') {
        await interaction.showModal(staffApplicationModal());
        return;
      }

      if (interaction.customId.startsWith('ticket_')) {
        await handleTicketButton(interaction);
        return;
      }

      if (interaction.customId.startsWith('club_')) {
        await handleClubButton(interaction);
        return;
      }

      if (interaction.customId.startsWith('ttt_')) {
        await handleTicTacToeButton(interaction);
        return;
      }

      return;
    }

    if (interaction.isUserSelectMenu()) {
      if (
        interaction.guild &&
        interaction.customId.startsWith('club_user_')
      ) {
        await handleClubUserSelect(interaction);
      }

      return;
    }

    if (interaction.isModalSubmit()) {
      if (interaction.guild) {
        await handleModalSubmission(interaction);
      }

      return;
    }

    if (interaction.isChatInputCommand()) {
      if (!interaction.guild) return;
      await handleSlashCommand(interaction);
    }
  } catch (error) {
    console.error('[interaction]', error);

    const payload = ephemeralPayload({
      embeds: [
        errorEmbed(
          [
            'something went wrong while running that.',
            '',
            `\`${truncate(error.message, 1500)}\``,
          ].join('\n'),
        ),
      ],
    });

    if (!interaction.isRepliable()) return;

    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(payload).catch(() => null);
    } else {
      await interaction.reply(payload).catch(() => null);
    }
  }
});

// ============================================================================
// SLASH COMMAND HANDLER
// ============================================================================

async function handleSlashCommand(interaction) {
  const name = interaction.commandName;

  if (name === 'help') {
    const member = await getInteractionMember(interaction);

    const lines = [
      '**community**',
      '`/level` `/leaderboard` `/mediastats` `/avatar` `/banner`',
      '`/userinfo` `/serverinfo` `/roleinfo` `/uptime` `/ping`',
      '',
      '**fun / games**',
      '`/coinflip` `/roll` `/8ball` `/rps` `/choose` `/ship`',
      '`/hangman` + `/guess`',
      '`/numberguess` + `/guessnum`',
      '`/tictactoe` `/poll` `/counting status`',
    ];

    if (member && isStaff(member)) {
      lines.push(
        '',
        '**staff**',
        '`/warn` `/warnings` `/clearwarnings` `/case` `/cases`',
        '`/clear` `/timeout` `/untimeout` `/kick` `/ban` `/unban`',
        '`/slowmode` `/lock` `/unlock` `/nick`',
        '`/counting start` `/counting stop`',
      );
    }

    if (member && isManagement(member)) {
      lines.push(
        '',
        '**management**',
        '`/psa`',
      );
    }

    if (isOwner(interaction.user.id)) {
      lines.push(
        '',
        '**owner**',
        '`/setup` `/staffapppost` `/test` `/doctor`',
        '`/xp` `/synclevelroles` `/syncautoroles`',
        '`/say` `/embedpost`',
      );
    }

    await interaction.reply(ephemeralPayload({
      embeds: [
        baseEmbed()
          .setTitle('⌁ kvsarchive commands')
          .setDescription(lines.join('\n')),
      ],
    }));

    return;
  }

  if (name === 'ping') {
    const started = Date.now();

    await interaction.reply(ephemeralPayload({
      content: 'checking…',
    }));

    await interaction.editReply({
      content: [
        `websocket: **${client.ws.ping}ms**`,
        `interaction: **${Date.now() - started}ms**`,
      ].join('\n'),
    });

    return;
  }

  if (name === 'uptime') {
    const uptime = Date.now() - startedAt;

    await interaction.reply({
      embeds: [
        baseEmbed()
          .setTitle('⌁ uptime')
          .setDescription(
            `online for **${durationText(uptime)}**.`,
          ),
      ],
    });

    return;
  }

  if (name === 'level') {
    const target = interaction.options.getUser('user') || interaction.user;

    sql.ensureUser.run(target.id);

    const data = sql.getUser.get(target.id);
    const level = levelFromXp(data.xp);

    const floor = xpForLevel(level);
    const nextFloor = xpForLevel(level + 1);

    const progress = data.xp - floor;
    const required = nextFloor - floor;

    const rank = sql.rank.get(data.xp).rank;

    const targetMember = await interaction.guild.members.fetch(target.id).catch(() => null);

    if (targetMember) {
      await syncLevelRoles(targetMember, level);
    }

    const next = nextMilestone(level);

    await interaction.reply({
      embeds: [
        baseEmbed()
          .setTitle(`𖤐 ${target.username} // level ${level}`)
          .setThumbnail(target.displayAvatarURL({ size: 256 }))
          .setDescription(
            [
              progressBar(progress, required),
              '',
              `**${progress.toLocaleString()} / ${required.toLocaleString()} XP** to level **${level + 1}**`,
            ].join('\n'),
          )
          .addFields(
            {
              name: 'total xp',
              value: data.xp.toLocaleString(),
              inline: true,
            },
            {
              name: 'rank',
              value: `#${rank}`,
              inline: true,
            },
            {
              name: 'messages',
              value: data.messages.toLocaleString(),
              inline: true,
            },
            {
              name: 'voice time',
              value: `${data.voice_minutes.toLocaleString()}m`,
              inline: true,
            },
            {
              name: 'next role',
              value: next ? `level ${next}` : 'max milestone reached',
              inline: true,
            },
          ),
      ],
    });

    return;
  }

  if (name === 'leaderboard') {
    const rows = sql.leaderboard.all();

    const medals = [
      '🥇',
      '🥈',
      '🥉',
    ];

    const description = rows.length
      ? rows.map((row, index) => {
          const level = levelFromXp(row.xp);
          return `${
            medals[index] || `**${index + 1}.**`
          } <@${row.user_id}> — lvl **${level}** · **${row.xp.toLocaleString()} xp**`;
        }).join('\n')
      : 'no activity data yet.';

    await interaction.reply({
      embeds: [
        baseEmbed()
          .setTitle('𖤐 activity leaderboard')
          .setDescription(description),
      ],
    });

    return;
  }

  if (name === 'mediastats') {
    const target = interaction.options.getUser('user') || interaction.user;

    const pfp = sql.mediaCount.get(target.id, 'pfp').count;
    const banner = sql.mediaCount.get(target.id, 'banner').count;

    const qualifies = (
      pfp >= CONFIG.MEDIA.REQUIRED_POSTS ||
      banner >= CONFIG.MEDIA.REQUIRED_POSTS
    );

    await interaction.reply({
      embeds: [
        baseEmbed()
          .setTitle(`⌁ ${target.username} // media progress`)
          .setThumbnail(target.displayAvatarURL({ size: 256 }))
          .addFields(
            {
              name: 'pfp posts',
              value: `${pfp} / ${CONFIG.MEDIA.REQUIRED_POSTS}`,
              inline: true,
            },
            {
              name: 'banner posts',
              value: `${banner} / ${CONFIG.MEDIA.REQUIRED_POSTS}`,
              inline: true,
            },
            {
              name: 'media poster',
              value: qualifies ? 'unlocked' : 'not yet',
              inline: true,
            },
          )
          .setDescription(
            'PFP and banner counts are **separate**. You need 5 of one type.',
          ),
      ],
    });

    return;
  }

  if (name === 'avatar') {
    const user = interaction.options.getUser('user') || interaction.user;
    const avatar = user.displayAvatarURL({
      size: 4096,
      extension: 'png',
    });

    await interaction.reply({
      embeds: [
        baseEmbed()
          .setTitle(`${user.username} // avatar`)
          .setDescription(`[open original](${avatar})`)
          .setImage(avatar),
      ],
    });

    return;
  }

  if (name === 'banner') {
    const requested = interaction.options.getUser('user') || interaction.user;
    const user = await client.users.fetch(requested.id, { force: true }).catch(() => requested);
    const banner = user.bannerURL({
      size: 4096,
      extension: 'png',
    });

    if (!banner) {
      await interaction.reply(ephemeralPayload({
        content: `${user.username} does not have a profile banner.`,
      }));

      return;
    }

    await interaction.reply({
      embeds: [
        baseEmbed()
          .setTitle(`${user.username} // banner`)
          .setDescription(`[open original](${banner})`)
          .setImage(banner),
      ],
    });

    return;
  }

  if (name === 'userinfo') {
    const user = interaction.options.getUser('user') || interaction.user;
    const member = await interaction.guild.members.fetch(user.id).catch(() => null);

    const embed = baseEmbed()
      .setTitle(`${user.username} // user info`)
      .setThumbnail(user.displayAvatarURL({ size: 256 }))
      .addFields(
        {
          name: 'user',
          value: `${user}`,
          inline: true,
        },
        {
          name: 'id',
          value: `\`${user.id}\``,
          inline: true,
        },
        {
          name: 'bot',
          value: user.bot ? 'yes' : 'no',
          inline: true,
        },
        {
          name: 'account created',
          value: `<t:${Math.floor(user.createdTimestamp / 1000)}:F>\n<t:${Math.floor(user.createdTimestamp / 1000)}:R>`,
        },
      );

    if (member?.joinedTimestamp) {
      embed.addFields({
        name: 'joined server',
        value: `<t:${Math.floor(member.joinedTimestamp / 1000)}:F>\n<t:${Math.floor(member.joinedTimestamp / 1000)}:R>`,
      });

      const roles = member.roles.cache
        .filter((role) => role.id !== interaction.guild.id)
        .sort((a, b) => b.position - a.position)
        .map((role) => `${role}`)
        .slice(0, 15);

      embed.addFields({
        name: `roles (${Math.max(member.roles.cache.size - 1, 0)})`,
        value: roles.length ? truncate(roles.join(' ')) : 'none',
      });
    }

    await interaction.reply({
      embeds: [embed],
    });

    return;
  }

  if (name === 'serverinfo') {
    const guild = interaction.guild;

    await interaction.reply({
      embeds: [
        baseEmbed()
          .setTitle(`${guild.name} // server info`)
          .setThumbnail(guild.iconURL({ size: 256 }))
          .addFields(
            {
              name: 'members',
              value: guild.memberCount.toLocaleString(),
              inline: true,
            },
            {
              name: 'channels',
              value: guild.channels.cache.size.toLocaleString(),
              inline: true,
            },
            {
              name: 'roles',
              value: guild.roles.cache.size.toLocaleString(),
              inline: true,
            },
            {
              name: 'owner',
              value: `<@${guild.ownerId}>`,
              inline: true,
            },
            {
              name: 'boosts',
              value: String(guild.premiumSubscriptionCount || 0),
              inline: true,
            },
            {
              name: 'created',
              value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:F>`,
            },
          ),
      ],
    });

    return;
  }

  if (name === 'roleinfo') {
    const role = interaction.options.getRole('role');

    await interaction.reply({
      embeds: [
        baseEmbed()
          .setTitle(`${role.name} // role info`)
          .addFields(
            {
              name: 'id',
              value: `\`${role.id}\``,
              inline: true,
            },
            {
              name: 'members',
              value: role.members.size.toLocaleString(),
              inline: true,
            },
            {
              name: 'position',
              value: String(role.position),
              inline: true,
            },
            {
              name: 'mentionable',
              value: role.mentionable ? 'yes' : 'no',
              inline: true,
            },
            {
              name: 'managed',
              value: role.managed ? 'yes' : 'no',
              inline: true,
            },
            {
              name: 'created',
              value: `<t:${Math.floor(role.createdTimestamp / 1000)}:R>`,
              inline: true,
            },
          ),
      ],
    });

    return;
  }

  if (name === 'coinflip') {
    await interaction.reply({
      embeds: [
        baseEmbed()
          .setTitle('⌁ coin flip')
          .setDescription(Math.random() < 0.5 ? '**heads**' : '**tails**'),
      ],
    });

    return;
  }

  if (name === 'roll') {
    const sides = interaction.options.getInteger('sides') || 6;

    await interaction.reply({
      embeds: [
        baseEmbed()
          .setTitle('⌁ dice')
          .setDescription(`rolled **${randInt(1, sides)}** / ${sides}`),
      ],
    });

    return;
  }

  if (name === '8ball') {
    const responses = [
      'yes.',
      'no.',
      'probably.',
      'probably not.',
      'absolutely.',
      'absolutely not.',
      'looks likely.',
      'not looking good.',
      'ask again later.',
      'the archive says yes.',
      'the archive says no.',
      'you already know the answer.',
      '50/50. good luck.',
      'without a doubt.',
      'do not count on it.',
      'very doubtful.',
      'signs point to yes.',
    ];

    await interaction.reply({
      embeds: [
        baseEmbed()
          .setTitle('🎱 8ball')
          .addFields(
            {
              name: 'question',
              value: truncate(interaction.options.getString('question')),
            },
            {
              name: 'answer',
              value: `**${responses[randInt(0, responses.length - 1)]}**`,
            },
          ),
      ],
    });

    return;
  }

  if (name === 'rps') {
    const userChoice = interaction.options.getString('choice');
    const choices = ['rock', 'paper', 'scissors'];
    const botChoice = choices[randInt(0, choices.length - 1)];

    const userWins = (
      (userChoice === 'rock' && botChoice === 'scissors') ||
      (userChoice === 'paper' && botChoice === 'rock') ||
      (userChoice === 'scissors' && botChoice === 'paper')
    );

    const result = userChoice === botChoice
      ? 'draw.'
      : userWins
        ? 'you win.'
        : 'you lose.';

    await interaction.reply({
      embeds: [
        baseEmbed()
          .setTitle('⌁ rock paper scissors')
          .setDescription(
            [
              `you: **${userChoice}**`,
              `bot: **${botChoice}**`,
              '',
              `**${result}**`,
            ].join('\n'),
          ),
      ],
    });

    return;
  }

  if (name === 'choose') {
    const choices = interaction.options.getString('choices')
      .split('|')
      .map((value) => value.trim())
      .filter(Boolean);

    if (choices.length < 2) {
      await interaction.reply(ephemeralPayload({
        content: 'give me at least **2 choices** separated by `|`.',
      }));

      return;
    }

    await interaction.reply({
      embeds: [
        baseEmbed()
          .setTitle('⌁ choice')
          .setDescription(`I pick **${truncate(choices[randInt(0, choices.length - 1)])}**`),
      ],
    });

    return;
  }

  if (name === 'ship') {
    const first = interaction.options.getUser('user1');
    const second = interaction.options.getUser('user2');

    const seed = [first.id, second.id].sort().join(':');

    let hash = 0;

    for (const character of seed) {
      hash = ((hash * 31) + character.charCodeAt(0)) >>> 0;
    }

    const percentage = hash % 101;

    let comment = 'eh.';

    if (percentage >= 90) comment = 'damn 😭';
    else if (percentage >= 75) comment = 'actually kinda crazy.';
    else if (percentage >= 50) comment = 'could work.';
    else if (percentage >= 25) comment = 'not looking amazing.';
    else comment = 'yeah wrap it up.';

    await interaction.reply({
      embeds: [
        baseEmbed()
          .setTitle('♡ compatibility')
          .setDescription(
            [
              `${first} × ${second}`,
              '',
              `**${percentage}%**`,
              '',
              comment,
            ].join('\n'),
          ),
      ],
    });

    return;
  }

  if (name === 'hangman') {
    const key = `${interaction.guildId}:${interaction.channelId}`;

    if (hangmanGames.has(key)) {
      await interaction.reply(ephemeralPayload({
        content: 'there is already a hangman game here. use `/guess`.',
      }));

      return;
    }

    const game = {
      word: HANGMAN_WORDS[randInt(0, HANGMAN_WORDS.length - 1)],
      guessed: new Set(),
      wrong: new Set(),
      tries: 7,
    };

    hangmanGames.set(key, game);

    setTimeout(() => {
      if (hangmanGames.get(key) === game) {
        hangmanGames.delete(key);
      }
    }, 15 * 60_000).unref();

    await interaction.reply({
      embeds: [
        baseEmbed()
          .setTitle('⌁ hangman')
          .setDescription(hangmanDisplay(game))
          .setFooter({
            text: 'use /guess • expires in 15m',
          }),
      ],
    });

    return;
  }

  if (name === 'guess') {
    const key = `${interaction.guildId}:${interaction.channelId}`;
    const game = hangmanGames.get(key);

    if (!game) {
      await interaction.reply(ephemeralPayload({
        content: 'no hangman game is active here. use `/hangman` first.',
      }));

      return;
    }

    const guess = interaction.options.getString('guess').toLowerCase().trim();

    if (!/^[a-z]+$/.test(guess)) {
      await interaction.reply(ephemeralPayload({
        content: 'letters only.',
      }));

      return;
    }

    let won = false;

    if (guess.length === 1) {
      if (game.guessed.has(guess) || game.wrong.has(guess)) {
        await interaction.reply(ephemeralPayload({
          content: 'that letter has already been guessed.',
        }));

        return;
      }

      if (game.word.includes(guess)) {
        game.guessed.add(guess);
      } else {
        game.wrong.add(guess);
        game.tries--;
      }

      won = game.word
        .split('')
        .every((character) => game.guessed.has(character));
    } else {
      if (guess === game.word) {
        won = true;
      } else {
        game.tries--;
      }
    }

    if (won) {
      hangmanGames.delete(key);

      await interaction.reply({
        embeds: [
          baseEmbed()
            .setTitle('𖤐 hangman won')
            .setDescription(`${interaction.user} got it.\n\nword: **${game.word}**`),
        ],
      });

      return;
    }

    if (game.tries <= 0) {
      hangmanGames.delete(key);

      await interaction.reply({
        embeds: [
          baseEmbed()
            .setTitle('⛧ hangman lost')
            .setDescription(`the word was **${game.word}**.`),
        ],
      });

      return;
    }

    await interaction.reply({
      embeds: [
        baseEmbed()
          .setTitle('⌁ hangman')
          .setDescription(hangmanDisplay(game)),
      ],
    });

    return;
  }

  if (name === 'numberguess') {
    const key = `${interaction.guildId}:${interaction.channelId}`;

    if (numberGames.has(key)) {
      await interaction.reply(ephemeralPayload({
        content: 'there is already a number guessing game active here.',
      }));

      return;
    }

    const max = interaction.options.getInteger('max') || 100;

    const game = {
      number: randInt(1, max),
      max,
      guesses: 0,
    };

    numberGames.set(key, game);

    setTimeout(() => {
      if (numberGames.get(key) === game) {
        numberGames.delete(key);
      }
    }, 15 * 60_000).unref();

    await interaction.reply({
      embeds: [
        baseEmbed()
          .setTitle('⌁ number guess')
          .setDescription(
            `I picked a number from **1-${max}**.\n\nuse \`/guessnum\`.`,
          ),
      ],
    });

    return;
  }

  if (name === 'guessnum') {
    const key = `${interaction.guildId}:${interaction.channelId}`;
    const game = numberGames.get(key);

    if (!game) {
      await interaction.reply(ephemeralPayload({
        content: 'no number game is active here.',
      }));

      return;
    }

    const number = interaction.options.getInteger('number');

    if (number < 1 || number > game.max) {
      await interaction.reply(ephemeralPayload({
        content: `guess from **1-${game.max}**.`,
      }));

      return;
    }

    game.guesses++;

    if (number === game.number) {
      numberGames.delete(key);

      await interaction.reply({
        embeds: [
          baseEmbed()
            .setTitle('𖤐 correct')
            .setDescription(
              `${interaction.user} got it.\n\nnumber: **${number}**\nguesses: **${game.guesses}**`,
            ),
        ],
      });

      return;
    }

    await interaction.reply({
      content: number < game.number ? '**higher.**' : '**lower.**',
    });

    return;
  }

  if (name === 'tictactoe') {
    const opponent = interaction.options.getUser('user');

    if (opponent.bot || opponent.id === interaction.user.id) {
      await interaction.reply(ephemeralPayload({
        content: 'pick another real member.',
      }));

      return;
    }

    const gameId = crypto.randomBytes(4).toString('hex');

    const game = {
      board: Array(9).fill(null),
      players: [
        interaction.user.id,
        opponent.id,
      ],
      turn: 0,
    };

    ticTacToeGames.set(gameId, game);

    setTimeout(() => {
      ticTacToeGames.delete(gameId);
    }, 10 * 60_000).unref();

    await interaction.reply({
      content: [
        `${interaction.user} = **X**`,
        `${opponent} = **O**`,
        '',
        `turn: ${interaction.user}`,
      ].join('\n'),
      components: renderTicTacToeRows(
        gameId,
        game.board,
      ),
    });

    return;
  }

  if (name === 'poll') {
    const question = interaction.options.getString('question');

    const options = [
      interaction.options.getString('option1'),
      interaction.options.getString('option2'),
      interaction.options.getString('option3'),
      interaction.options.getString('option4'),
      interaction.options.getString('option5'),
    ].filter(Boolean);

    const emojis = [
      '1️⃣',
      '2️⃣',
      '3️⃣',
      '4️⃣',
      '5️⃣',
    ];

    await interaction.reply({
      embeds: [
        baseEmbed()
          .setTitle('⌁ poll')
          .setDescription(
            [
              `**${question}**`,
              '',
              ...options.map((option, index) => `${emojis[index]} ${option}`),
            ].join('\n'),
          )
          .setFooter({
            text: `poll by ${interaction.user.username}`,
          }),
      ],
    });

    const pollMessage = await interaction.fetchReply();

    for (let index = 0; index < options.length; index++) {
      await pollMessage.react(emojis[index]).catch(() => null);
    }

    return;
  }

  if (name === 'counting') {
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'status') {
      const current = sql.getCounting.get(interaction.channelId);

      await interaction.reply({
        embeds: [
          baseEmbed()
            .setTitle('⌁ counting')
            .setDescription(
              current
                ? `next number: **${current.next_number}**\nlast counter: ${
                    current.last_user_id
                      ? `<@${current.last_user_id}>`
                      : 'nobody'
                  }`
                : 'counting is not active in this channel.',
            ),
        ],
      });

      return;
    }

    const staff = await requireStaff(interaction);
    if (!staff) return;

    if (subcommand === 'start') {
      sql.startCounting.run(interaction.channelId);

      await interaction.reply({
        embeds: [
          baseEmbed()
            .setTitle('⌁ counting started')
            .setDescription(
              'start with **1**. same person cannot count twice in a row. mistakes reset it.',
            ),
        ],
      });

      return;
    }

    sql.stopCounting.run(interaction.channelId);

    await interaction.reply({
      embeds: [
        successEmbed(
          'counting stopped',
          `counting disabled in ${interaction.channel}.`,
        ),
      ],
    });

    return;
  }

  if (name === 'warn') {
    const staff = await requireStaff(interaction);
    if (!staff) return;

    const user = interaction.options.getUser('user');
    const reason = interaction.options.getString('reason');
    const target = await interaction.guild.members.fetch(user.id).catch(() => null);

    if (!target) {
      await interaction.reply(ephemeralPayload({
        content: 'that member is not in the server.',
      }));

      return;
    }

    if (!await canModerateTarget(staff, target)) {
      await interaction.reply(ephemeralPayload({
        embeds: [errorEmbed('you cannot moderate that member.')],
      }));

      return;
    }

    sql.addWarning.run(
      interaction.guildId,
      user.id,
      staff.id,
      reason,
      Date.now(),
    );

    const caseId = createModCase(
      'warn',
      user.id,
      staff.id,
      reason,
    );

    await user.send({
      embeds: [
        baseEmbed()
          .setTitle(`⚠ warning // case #${caseId}`)
          .setDescription(reason),
      ],
    }).catch(() => null);

    await interaction.reply(ephemeralPayload({
      embeds: [
        successEmbed(
          'warning added',
          `${user} was warned. case **#${caseId}**.`,
        ),
      ],
    }));

    await logEvent(
      'warning',
      `${staff.user.tag} warned ${user.tag}. case **#${caseId}**.`,
      [
        {
          name: 'reason',
          value: truncate(reason),
        },
      ],
    );

    return;
  }

  if (name === 'warnings') {
    const staff = await requireStaff(interaction);
    if (!staff) return;

    const user = interaction.options.getUser('user');
    const warnings = sql.getWarnings.all(interaction.guildId, user.id);

    const description = warnings.length
      ? warnings.map((warning) => [
          `**warning #${warning.id}**`,
          `<t:${Math.floor(warning.created_at / 1000)}:R>`,
          `by <@${warning.moderator_id}>`,
          '',
          truncate(warning.reason, 300),
        ].join(' ')).join('\n\n')
      : 'no warnings.';

    await interaction.reply(ephemeralPayload({
      embeds: [
        baseEmbed()
          .setTitle(`warnings // ${user.username}`)
          .setDescription(description),
      ],
    }));

    return;
  }

  if (name === 'clearwarnings') {
    const staff = await requireStaff(interaction);
    if (!staff) return;

    const user = interaction.options.getUser('user');
    const target = await interaction.guild.members.fetch(user.id).catch(() => null);

    if (target && !await canModerateTarget(staff, target)) {
      await interaction.reply(ephemeralPayload({
        embeds: [errorEmbed('you cannot manage that member.')],
      }));

      return;
    }

    const result = sql.clearWarnings.run(
      interaction.guildId,
      user.id,
    );

    const caseId = createModCase(
      'clearwarnings',
      user.id,
      staff.id,
      `Cleared ${result.changes} warning(s)`,
    );

    await interaction.reply(ephemeralPayload({
      embeds: [
        successEmbed(
          'warnings cleared',
          `removed **${result.changes}** warning(s) from ${user}. case **#${caseId}**.`,
        ),
      ],
    }));

    return;
  }

  if (name === 'case') {
    const staff = await requireStaff(interaction);
    if (!staff) return;

    const id = interaction.options.getInteger('id');
    const row = sql.getCase.get(interaction.guildId, id);

    if (!row) {
      await interaction.reply(ephemeralPayload({
        content: `case **#${id}** was not found.`,
      }));

      return;
    }

    await interaction.reply(ephemeralPayload({
      embeds: [
        baseEmbed()
          .setTitle(`moderation case #${row.id}`)
          .addFields(
            {
              name: 'action',
              value: row.action,
              inline: true,
            },
            {
              name: 'target',
              value: `<@${row.target_id}>`,
              inline: true,
            },
            {
              name: 'moderator',
              value: `<@${row.moderator_id}>`,
              inline: true,
            },
            {
              name: 'duration',
              value: durationText(row.duration_ms),
              inline: true,
            },
            {
              name: 'created',
              value: `<t:${Math.floor(row.created_at / 1000)}:F>`,
              inline: true,
            },
            {
              name: 'reason',
              value: truncate(row.reason),
            },
          ),
      ],
    }));

    return;
  }

  if (name === 'cases') {
    const staff = await requireStaff(interaction);
    if (!staff) return;

    const user = interaction.options.getUser('user');
    const rows = sql.getCasesForUser.all(interaction.guildId, user.id);

    const description = rows.length
      ? rows.map((row) => (
          `**#${row.id}** · ${row.action} · <t:${Math.floor(row.created_at / 1000)}:R> · ${truncate(row.reason, 120)}`
        )).join('\n')
      : 'no moderation cases.';

    await interaction.reply(ephemeralPayload({
      embeds: [
        baseEmbed()
          .setTitle(`cases // ${user.username}`)
          .setDescription(description),
      ],
    }));

    return;
  }

  if (name === 'clear') {
    const staff = await requireStaff(interaction);
    if (!staff) return;

    const amount = interaction.options.getInteger('amount');

    if (
      !interaction.channel?.isTextBased() ||
      typeof interaction.channel.bulkDelete !== 'function'
    ) {
      await interaction.reply(ephemeralPayload({
        content: 'message clearing is not supported here.',
      }));

      return;
    }

    const deleted = await interaction.channel.bulkDelete(amount, true);

    await interaction.reply(ephemeralPayload({
      content: `deleted **${deleted.size}** message(s).`,
    }));

    await logEvent(
      'messages cleared',
      `${staff.user.tag} deleted ${deleted.size} messages in ${interaction.channel}.`,
    );

    return;
  }

  if (name === 'timeout') {
    const staff = await requireStaff(interaction);
    if (!staff) return;

    const user = interaction.options.getUser('user');
    const minutes = interaction.options.getInteger('minutes');
    const reason = interaction.options.getString('reason') || 'No reason provided';

    const target = await interaction.guild.members.fetch(user.id).catch(() => null);

    if (!target) {
      await interaction.reply(ephemeralPayload({
        content: 'that member is not in the server.',
      }));

      return;
    }

    if (!await canModerateTarget(staff, target) || !target.moderatable) {
      await interaction.reply(ephemeralPayload({
        embeds: [errorEmbed('I cannot timeout that member. check hierarchy.')],
      }));

      return;
    }

    const durationMs = minutes * 60_000;

    const caseId = createModCase(
      'timeout',
      user.id,
      staff.id,
      reason,
      durationMs,
    );

    await target.timeout(
      durationMs,
      `${reason} | case #${caseId}`,
    );

    await interaction.reply(ephemeralPayload({
      embeds: [
        successEmbed(
          'member timed out',
          `${user} for **${minutes}m**. case **#${caseId}**.`,
        ),
      ],
    }));

    await logEvent(
      'timeout',
      `${staff.user.tag} timed out ${user.tag} for ${minutes}m. case **#${caseId}**.`,
      [
        {
          name: 'reason',
          value: truncate(reason),
        },
      ],
    );

    return;
  }

  if (name === 'untimeout') {
    const staff = await requireStaff(interaction);
    if (!staff) return;

    const user = interaction.options.getUser('user');
    const reason = interaction.options.getString('reason') || 'Timeout removed';
    const target = await interaction.guild.members.fetch(user.id).catch(() => null);

    if (!target) {
      await interaction.reply(ephemeralPayload({
        content: 'that member is not in the server.',
      }));

      return;
    }

    if (!await canModerateTarget(staff, target) || !target.moderatable) {
      await interaction.reply(ephemeralPayload({
        embeds: [errorEmbed('I cannot modify that member.')],
      }));

      return;
    }

    const caseId = createModCase(
      'untimeout',
      user.id,
      staff.id,
      reason,
    );

    await target.timeout(
      null,
      `${reason} | case #${caseId}`,
    );

    await interaction.reply(ephemeralPayload({
      embeds: [
        successEmbed(
          'timeout removed',
          `${user} can talk again. case **#${caseId}**.`,
        ),
      ],
    }));

    return;
  }

  if (name === 'kick') {
    const staff = await requireStaff(interaction);
    if (!staff) return;

    const user = interaction.options.getUser('user');
    const reason = interaction.options.getString('reason') || 'No reason provided';

    const target = await interaction.guild.members.fetch(user.id).catch(() => null);

    if (!target) {
      await interaction.reply(ephemeralPayload({
        content: 'that member is not in the server.',
      }));

      return;
    }

    if (!await canModerateTarget(staff, target) || !target.kickable) {
      await interaction.reply(ephemeralPayload({
        embeds: [errorEmbed('I cannot kick that member. check hierarchy.')],
      }));

      return;
    }

    const caseId = createModCase(
      'kick',
      user.id,
      staff.id,
      reason,
    );

    await user.send({
      embeds: [
        baseEmbed()
          .setTitle(`⛧ removed // case #${caseId}`)
          .setDescription(`reason: ${reason}`),
      ],
    }).catch(() => null);

    await target.kick(`${reason} | case #${caseId}`);

    await interaction.reply(ephemeralPayload({
      embeds: [
        successEmbed(
          'member kicked',
          `${user.tag} was removed. case **#${caseId}**.`,
        ),
      ],
    }));

    await logEvent(
      'kick',
      `${staff.user.tag} kicked ${user.tag}. case **#${caseId}**.`,
      [
        {
          name: 'reason',
          value: truncate(reason),
        },
      ],
    );

    return;
  }

  if (name === 'ban') {
    const staff = await requireStaff(interaction);
    if (!staff) return;

    const user = interaction.options.getUser('user');
    const reason = interaction.options.getString('reason') || 'No reason provided';
    const deleteHours = interaction.options.getInteger('delete_hours') || 0;

    const target = await interaction.guild.members.fetch(user.id).catch(() => null);

    if (target) {
      if (!await canModerateTarget(staff, target) || !target.bannable) {
        await interaction.reply(ephemeralPayload({
          embeds: [errorEmbed('I cannot ban that member. check hierarchy.')],
        }));

        return;
      }
    }

    const caseId = createModCase(
      'ban',
      user.id,
      staff.id,
      reason,
    );

    await user.send({
      embeds: [
        baseEmbed()
          .setTitle(`⛧ banned // case #${caseId}`)
          .setDescription(`reason: ${reason}`),
      ],
    }).catch(() => null);

    await interaction.guild.members.ban(
      user.id,
      {
        deleteMessageSeconds: Math.min(deleteHours * 3600, 604800),
        reason: `${reason} | case #${caseId} | by ${staff.user.tag}`,
      },
    );

    await interaction.reply(ephemeralPayload({
      embeds: [
        successEmbed(
          'member banned',
          `${user.tag} was banned. case **#${caseId}**.`,
        ),
      ],
    }));

    await logEvent(
      'ban',
      `${staff.user.tag} banned ${user.tag}. case **#${caseId}**.`,
      [
        {
          name: 'reason',
          value: truncate(reason),
        },
      ],
    );

    return;
  }

  if (name === 'unban') {
    const staff = await requireStaff(interaction);
    if (!staff) return;

    const userId = interaction.options.getString('userid').trim();
    const reason = interaction.options.getString('reason') || 'Unbanned by staff';

    if (!/^\d{17,20}$/.test(userId)) {
      await interaction.reply(ephemeralPayload({
        content: 'that does not look like a valid Discord user ID.',
      }));

      return;
    }

    const ban = await interaction.guild.bans.fetch(userId).catch(() => null);

    if (!ban) {
      await interaction.reply(ephemeralPayload({
        content: 'that user is not banned.',
      }));

      return;
    }

    const caseId = createModCase(
      'unban',
      userId,
      staff.id,
      reason,
    );

    await interaction.guild.members.unban(
      userId,
      `${reason} | case #${caseId} | by ${staff.user.tag}`,
    );

    await interaction.reply(ephemeralPayload({
      embeds: [
        successEmbed(
          'user unbanned',
          `${ban.user.tag} was unbanned. case **#${caseId}**.`,
        ),
      ],
    }));

    return;
  }

  if (name === 'slowmode') {
    const staff = await requireStaff(interaction);
    if (!staff) return;

    const seconds = interaction.options.getInteger('seconds');
    const channel = interaction.options.getChannel('channel') || interaction.channel;

    if (
      !channel?.isTextBased() ||
      typeof channel.setRateLimitPerUser !== 'function'
    ) {
      await interaction.reply(ephemeralPayload({
        content: 'choose a normal text channel.',
      }));

      return;
    }

    if (
      [CONFIG.CHANNELS.PFP, CONFIG.CHANNELS.BANNER].includes(channel.id) &&
      seconds > 0
    ) {
      await interaction.reply(ephemeralPayload({
        embeds: [
          errorEmbed(
            'PFP/banner use the bot-managed 5 minute cooldown so MEDIA POSTER can bypass it. keep Discord native slowmode at **0** there.',
          ),
        ],
      }));

      return;
    }

    await channel.setRateLimitPerUser(
      seconds,
      `Changed by ${staff.user.tag}`,
    );

    await interaction.reply(ephemeralPayload({
      embeds: [
        successEmbed(
          'slowmode updated',
          `${channel} → **${seconds}s**`,
        ),
      ],
    }));

    return;
  }

  if (name === 'lock' || name === 'unlock') {
    const staff = await requireStaff(interaction);
    if (!staff) return;

    const channel = interaction.options.getChannel('channel') || interaction.channel;

    if (!channel?.isTextBased()) {
      await interaction.reply(ephemeralPayload({
        content: 'choose a text channel.',
      }));

      return;
    }

    const locked = name === 'lock';

    await channel.permissionOverwrites.edit(
      CONFIG.ROLES.MEMBER,
      {
        SendMessages: locked ? false : null,
      },
      {
        reason: `${locked ? 'Locked' : 'Unlocked'} by ${staff.user.tag}`,
      },
    );

    await interaction.reply(ephemeralPayload({
      embeds: [
        successEmbed(
          locked ? 'channel locked' : 'channel unlocked',
          `${channel}`,
        ),
      ],
    }));

    return;
  }

  if (name === 'nick') {
    const staff = await requireStaff(interaction);
    if (!staff) return;

    const user = interaction.options.getUser('user');
    const nickname = interaction.options.getString('nickname');

    const target = await interaction.guild.members.fetch(user.id).catch(() => null);

    if (!target) {
      await interaction.reply(ephemeralPayload({
        content: 'that member is not in the server.',
      }));

      return;
    }

    if (!await canModerateTarget(staff, target) || !target.manageable) {
      await interaction.reply(ephemeralPayload({
        embeds: [errorEmbed('I cannot change that nickname. check hierarchy.')],
      }));

      return;
    }

    await target.setNickname(
      nickname || null,
      `Changed by ${staff.user.tag}`,
    );

    await interaction.reply(ephemeralPayload({
      embeds: [
        successEmbed(
          'nickname updated',
          nickname
            ? `${user} → **${nickname}**`
            : `${user}'s nickname was cleared.`,
        ),
      ],
    }));

    return;
  }

  if (name === 'psa') {
    const management = await requireManagement(interaction);
    if (!management) return;

    const channel = await checkPanelChannel(
      interaction.guild,
      CONFIG.CHANNELS.PSA,
    );

    const title = interaction.options.getString('title') || 'PSA';
    const text = interaction.options.getString('message');

    await channel.send({
      embeds: [
        baseEmbed()
          .setTitle(`⚠ ${title}`)
          .setDescription(text)
          .setFooter({
            text: `posted by ${interaction.user.username}`,
          }),
      ],
    });

    await interaction.reply(ephemeralPayload({
      content: `PSA posted in ${channel}.`,
    }));

    return;
  }

  if (name === 'setup') {
    if (!await requireOwner(interaction)) return;

    const panel = interaction.options.getString('panel');

    await interaction.deferReply({
      flags: MessageFlags.Ephemeral,
    });

    const tasks = [];

    if (panel === 'all' || panel === 'verify') {
      tasks.push([
        'verification',
        CONFIG.CHANNELS.VERIFY,
        verifyPanel(),
      ]);
    }

    if (panel === 'all' || panel === 'tickets') {
      tasks.push([
        'tickets',
        CONFIG.CHANNELS.TICKETS,
        ticketPanel(),
      ]);
    }

    if (panel === 'all' || panel === 'clubs') {
      tasks.push([
        'private clubs',
        CONFIG.CHANNELS.PRIVATE_CLUB_CMDS,
        clubPanel(),
      ]);
    }

    if (panel === 'all' || panel === 'info') {
      tasks.push([
        'specialty info',
        CONFIG.CHANNELS.SPECIALTY_INFO,
        specialtyInfoPanel(),
      ]);
    }

    const completed = [];
    const failures = [];

    for (const [label, channelId, payload] of tasks) {
      try {
        const channel = await postPanel(
          interaction.guild,
          channelId,
          payload,
        );

        completed.push(`${label} → #${channel.name}`);
      } catch (error) {
        failures.push(`${label}: ${truncate(error.message, 500)}`);
      }
    }

    const description = [
      `**posted**`,
      completed.length ? completed.join('\n') : 'none',
      '',
      `**failed**`,
      failures.length ? failures.join('\n') : 'none',
    ].join('\n');

    await interaction.editReply({
      embeds: [
        baseEmbed()
          .setTitle('† setup result')
          .setDescription(description),
      ],
    });

    return;
  }

  if (name === 'staffapppost') {
    if (!await requireOwner(interaction)) return;

    try {
      const channel = await postPanel(
        interaction.guild,
        CONFIG.CHANNELS.TICKETS,
        staffApplicationPanel(),
      );

      await interaction.reply(ephemeralPayload({
        embeds: [
          successEmbed(
            'staff applications opened',
            `panel posted in ${channel}.`,
          ),
        ],
      }));
    } catch (error) {
      await interaction.reply(ephemeralPayload({
        embeds: [
          errorEmbed(
            `staff application panel failed: ${truncate(error.message, 1200)}`,
          ),
        ],
      }));
    }

    return;
  }

  if (name === 'test') {
    if (!await requireOwner(interaction)) return;

    const type = interaction.options.getString('type');
    const channel = await checkPanelChannel(
      interaction.guild,
      CONFIG.CHANNELS.TEST,
    );

    if (type === 'welcome') {
      const member = await interaction.guild.members.fetch(interaction.user.id);

      await channel.send({
        content: `${interaction.user}`,
        embeds: [welcomeEmbed(member)],
      });
    }

    if (type === 'verify') {
      await channel.send(verifyPanel());
    }

    if (type === 'tickets') {
      await channel.send(ticketPanel());
    }

    if (type === 'clubs') {
      await channel.send(clubPanel());
    }

    if (type === 'info') {
      await channel.send(specialtyInfoPanel());
    }

    if (type === 'staffapp') {
      await channel.send(staffApplicationPanel());
    }

    if (type === 'verification') {
      await channel.send({
        embeds: [
          baseEmbed()
            .setTitle('⛓ verification code test')
            .setDescription(
              `the real verification flow DMs a simple 4-digit code like **${verificationCode()}**.`,
            ),
        ],
      });
    }

    await interaction.reply(ephemeralPayload({
      content: `sent **${type}** test to ${channel}.`,
    }));

    return;
  }

  if (name === 'doctor') {
    if (!await requireOwner(interaction)) return;

    await interaction.deferReply({
      flags: MessageFlags.Ephemeral,
    });

    const lines = await doctorReport(interaction.guild);

    const chunks = [];
    let current = '';

    for (const line of lines) {
      if ((current + '\n' + line).length > 3800) {
        chunks.push(current);
        current = line;
      } else {
        current += `${current ? '\n' : ''}${line}`;
      }
    }

    if (current) chunks.push(current);

    await interaction.editReply({
      embeds: chunks.slice(0, 10).map((chunk, index) =>
        baseEmbed()
          .setTitle(index === 0 ? '⌁ kvsarchive doctor' : `doctor continued ${index + 1}`)
          .setDescription(chunk),
      ),
    });

    return;
  }

  if (name === 'xp') {
    if (!await requireOwner(interaction)) return;

    const subcommand = interaction.options.getSubcommand();
    const user = interaction.options.getUser('user');
    const amount = interaction.options.getInteger('amount');

    sql.ensureUser.run(user.id);

    const before = sql.getUser.get(user.id);

    if (subcommand === 'add') {
      ownerXpSql.add.run(amount, user.id);
    }

    if (subcommand === 'remove') {
      ownerXpSql.remove.run(amount, user.id);
    }

    if (subcommand === 'set') {
      ownerXpSql.set.run(amount, user.id);
    }

    const after = sql.getUser.get(user.id);

    const member = await interaction.guild.members.fetch(user.id).catch(() => null);

    if (member) {
      await syncLevelRoles(member, levelFromXp(after.xp));

      if (after.xp > before.xp) {
        await processLevelChange(member, before.xp, after.xp);
      }
    }

    await interaction.reply(ephemeralPayload({
      embeds: [
        successEmbed(
          'xp updated',
          [
            `${user}`,
            '',
            `before: **${before.xp.toLocaleString()} XP** · lvl ${levelFromXp(before.xp)}`,
            `after: **${after.xp.toLocaleString()} XP** · lvl ${levelFromXp(after.xp)}`,
          ].join('\n'),
        ),
      ],
    }));

    return;
  }

  if (name === 'synclevelroles') {
    if (!await requireOwner(interaction)) return;

    await interaction.deferReply({
      flags: MessageFlags.Ephemeral,
    });

    await interaction.guild.members.fetch();

    let processed = 0;

    for (const member of interaction.guild.members.cache.values()) {
      if (member.user.bot) continue;

      sql.ensureUser.run(member.id);
      const data = sql.getUser.get(member.id);

      await syncLevelRoles(
        member,
        levelFromXp(data.xp),
      );

      processed++;
    }

    await interaction.editReply({
      embeds: [
        successEmbed(
          'level roles synced',
          `processed **${processed}** members.`,
        ),
      ],
    });

    return;
  }

  if (name === 'syncautoroles') {
    if (!await requireOwner(interaction)) return;

    await interaction.deferReply({
      flags: MessageFlags.Ephemeral,
    });

    await interaction.guild.members.fetch();

    let added = 0;
    let skipped = 0;
    let failed = 0;

    for (const member of interaction.guild.members.cache.values()) {
      if (member.user.bot) continue;

      if (member.roles.cache.has(CONFIG.ROLES.MEMBER)) {
        skipped++;
        continue;
      }

      if (member.roles.cache.has(CONFIG.ROLES.VERIFY)) {
        skipped++;
        continue;
      }

      try {
        await member.roles.add(
          CONFIG.ROLES.VERIFY,
          'Owner /syncautoroles',
        );

        added++;
      } catch {
        failed++;
      }
    }

    await interaction.editReply({
      embeds: [
        baseEmbed()
          .setTitle('† autorole sync complete')
          .addFields(
            {
              name: 'VERIFY added',
              value: String(added),
              inline: true,
            },
            {
              name: 'skipped',
              value: String(skipped),
              inline: true,
            },
            {
              name: 'failed',
              value: String(failed),
              inline: true,
            },
          ),
      ],
    });

    return;
  }

  if (name === 'say') {
    if (!await requireOwner(interaction)) return;

    const channel = interaction.options.getChannel('channel');
    const message = interaction.options.getString('message');

    if (!channel?.isTextBased()) {
      await interaction.reply(ephemeralPayload({
        content: 'choose a text channel.',
      }));

      return;
    }

    await channel.send({
      content: message,
      allowedMentions: {
        parse: [
          'users',
          'roles',
        ],
      },
    });

    await interaction.reply(ephemeralPayload({
      content: `sent in ${channel}.`,
    }));

    return;
  }

  if (name === 'embedpost') {
    if (!await requireOwner(interaction)) return;

    const channel = interaction.options.getChannel('channel');
    const title = interaction.options.getString('title');
    const description = interaction.options.getString('description');

    if (!channel?.isTextBased()) {
      await interaction.reply(ephemeralPayload({
        content: 'choose a text channel.',
      }));

      return;
    }

    await channel.send({
      embeds: [
        baseEmbed()
          .setTitle(title)
          .setDescription(description),
      ],
    });

    await interaction.reply(ephemeralPayload({
      content: `embed posted in ${channel}.`,
    }));
  }
}

// ============================================================================
// TOKEN / SHUTDOWN
// ============================================================================

process.on('unhandledRejection', (error) => {
  console.error('[unhandledRejection]', error);
});

process.on('uncaughtException', (error) => {
  console.error('[uncaughtException]', error);
});

let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log(`[shutdown] ${signal}`);

  try {
    db.pragma('wal_checkpoint(TRUNCATE)');
  } catch {}

  try {
    db.close();
  } catch {}

  try {
    client.destroy();
  } catch {}

  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

if (!process.env.DISCORD_TOKEN) {
  console.error('DISCORD_TOKEN is missing from Railway Variables / .env.');
  process.exit(1);
}

console.log('============================================================');
console.log('kvsarchive');
console.log('starting archive systems...');
console.log(`guild: ${CONFIG.GUILD_ID}`);
console.log(`owner whitelist: ${CONFIG.OWNER_IDS.join(', ')}`);
console.log('============================================================');

client.login(process.env.DISCORD_TOKEN);