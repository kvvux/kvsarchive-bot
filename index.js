require('dotenv').config();

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
} = require('discord.js');

const Database = require('better-sqlite3');
const { createCanvas } = require('@napi-rs/canvas');

// ============================================================================
// kvsarchive
// discord.js v14
// Node.js 20+
//
// Main systems:
// - Verification + generated captcha
// - Automatic roles
// - Welcome system
// - XP / levels / level roles
// - Voice XP
// - Loyal member
// - PFP/banner poster tracking
// - Custom media cooldown
// - Private club VCs
// - Club owner control panel
// - Ticket system
// - Staff applications
// - Moderation
// - Logging
// - Anti-spam
// - Games
// - Community commands
// - Owner testing/setup
// ============================================================================

// ============================================================================
// CONFIG
// ============================================================================

const CONFIG = {
  GUILD_ID: '1539766406336479302',

  // Commands such as /test, /setup and /staffapppost are hard-whitelisted
  // to these IDs in addition to Discord-side permission controls.
  OWNER_IDS: [
    '551313949405085696',
  ],

  ROLES: {
    // Temporary / unverified role.
    VERIFY: '1539772558629413036',

    // Verification rewards.
    MEMBER: '1539773112504160256',
    MEMBER_TAG: '1539777991901450360',
    MISC: '1539778263507935352',

    // Progress/community.
    LOYAL_MEMBER: '1539774815701958716',

    // Earned after 5 valid PFP posts OR 5 valid banner posts.
    MEDIA_POSTER: '1539783985188839434',

    // Staff.
    ADMIN: '1539778556018823168',
    SR_MOD: '1539777299942211644',
    MOD: '1539775895810867320',
    ASCENDANT: '1539775373028626512',
    MANAGEMENT: '1539779210212548728',

    // Activity roles.
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
    // 00
    VERIFY: '1539770446843744336',

    // 01
    WELC: '1539770679443070996',
    RULES: '1539770701156720750',
    PSA: '1539770732899336292',
    TICKETS: '1539770774968344586',

    // 02
    CHAT: '1539770804043260007',
    CMDS: '1539770844149059644',
    MEDIA: '1539770868241137796',
    SPECIALTY_INFO: '1539770890068303982',

    // 03
    PFP: '1539770933760229446',
    BANNER: '1539770959861645383',
    ANYTHING: '1539770985887170661',

    // 04
    PRIVATE_CLUB_CMDS: '1539771021953994782',

    // Existing permanent club VCs.
    CLUB_1: '1539771074265227294',
    CLUB_2: '1539771110801801297',
    CLUB_3: '1539771153080524800',

    // Join-to-create VC.
    CREATE_PRIVATE_CLUB: '1539771179785658449',

    // 05
    STAFF_CHAT: '1539771255069343815',
    STAFF_CMDS: '1539771282869059636',
    SERVER_LOGS: '1539771303106453635',
    TEST: '1539771325415956490',
  },

  BRAND: {
    NAME: 'kvsarchive',

    // Dark red / archive theme.
    COLOR: 0x2b0b0b,
    DARK: 0x160808,
    ACCENT: 0x6f1111,

    FOOTER: 'kvsarchive // archive system',
  },

  LEVELING: {
    // Level calculation:
    // required total XP = XP_BASE * level^2
    XP_BASE: 20,

    TEXT_MIN_XP: 12,
    TEXT_MAX_XP: 20,

    // Prevents spam farming.
    TEXT_COOLDOWN_MS: 45_000,

    // Voice XP given per eligible minute.
    VOICE_XP_PER_MINUTE: 6,

    // At least 2 real users must be in VC.
    VOICE_MIN_HUMANS: 2,
  },

  MEDIA: {
    REQUIRED_POSTS: 5,

    // Custom cooldown rather than Discord native slowmode.
    //
    // Reason:
    // Discord does not have a safe "bypass slowmode only" role permission.
    // Using the bot to enforce this means MEDIA_POSTER can bypass without
    // being handed moderation permissions.
    COOLDOWN_MS: 5 * 60_000,
  },

  AUTOMOD: {
    SPAM_ENABLED: true,

    // 7 messages inside 6 seconds.
    SPAM_WINDOW_MS: 6_000,
    SPAM_MAX_MESSAGES: 7,

    // Automatic timeout.
    SPAM_TIMEOUT_MS: 30_000,
  },

  VERIFICATION: {
    CODE_LENGTH: 4,
    EXPIRE_MS: 10 * 60_000,
    MAX_ATTEMPTS: 5,
  },

  PRIVATE_CLUBS: {
    // Delete an empty generated club after 20 seconds.
    EMPTY_DELETE_DELAY_MS: 20_000,

    // Prefix used for generated voice channels.
    PREFIX: 'club・',
  },
};

// ============================================================================
// ROLE GROUPS
// ============================================================================

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

const LEVEL_MILESTONES = Object
  .keys(CONFIG.ROLES.LEVELS)
  .map(Number)
  .sort((a, b) => a - b);

// ============================================================================
// DISCORD CLIENT
// ============================================================================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.DirectMessages,
  ],

  partials: [
    Partials.Channel,
    Partials.Message,
    Partials.User,
  ],
});

// ============================================================================
// DATABASE
// ============================================================================

const fs = require('fs');
const path = require('path');

const DB_DIR =
  process.env.RAILWAY_VOLUME_MOUNT_PATH ||
  './data';

fs.mkdirSync(DB_DIR, {
  recursive: true,
});

const DB_PATH =
  path.join(
    DB_DIR,
    'kvsarchive.sqlite',
  );

console.log(`[db] database path: ${DB_PATH}`);

console.log(
  `[db] Railway volume: ${
    process.env.RAILWAY_VOLUME_MOUNT_PATH ||
    'NOT MOUNTED'
  }`,
);

const db =
  new Database(
    DB_PATH,
  );

db.pragma('journal_mode = WAL');

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

    PRIMARY KEY (
      user_id,
      kind
    )
  );

  CREATE TABLE IF NOT EXISTS verification_codes (
    user_id TEXT PRIMARY KEY,

    code TEXT NOT NULL,
    expires_at INTEGER NOT NULL,

    attempts INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS temp_clubs (
    channel_id TEXT PRIMARY KEY,

    owner_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,

    locked INTEGER NOT NULL DEFAULT 0,
    hidden INTEGER NOT NULL DEFAULT 0
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_temp_club_owner
  ON temp_clubs(owner_id);

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
`);

// ============================================================================
// PREPARED SQL
// ============================================================================

const sql = {
  // --------------------------------------------------------------------------
  // USERS / XP
  // --------------------------------------------------------------------------

  ensureUser: db.prepare(`
    INSERT OR IGNORE INTO users (
      user_id
    )
    VALUES (?)
  `),

  getUser: db.prepare(`
    SELECT *
    FROM users
    WHERE user_id = ?
  `),

  addTextXp: db.prepare(`
    UPDATE users

    SET
      xp = xp + ?,
      text_xp = text_xp + ?,
      messages = messages + 1,
      last_text_xp = ?

    WHERE user_id = ?
  `),

  addVoiceXp: db.prepare(`
    UPDATE users

    SET
      xp = xp + ?,
      voice_xp = voice_xp + ?,
      voice_minutes = voice_minutes + 1

    WHERE user_id = ?
  `),

  leaderboard: db.prepare(`
    SELECT *
    FROM users

    ORDER BY xp DESC

    LIMIT 10
  `),

  // --------------------------------------------------------------------------
  // WARNINGS
  // --------------------------------------------------------------------------

  addWarning: db.prepare(`
    INSERT INTO warnings (
      guild_id,
      user_id,
      moderator_id,
      reason,
      created_at
    )

    VALUES (?, ?, ?, ?, ?)
  `),

  getWarnings: db.prepare(`
    SELECT *
    FROM warnings

    WHERE
      guild_id = ?
      AND user_id = ?

    ORDER BY id DESC

    LIMIT 20
  `),

  clearWarnings: db.prepare(`
    DELETE FROM warnings

    WHERE
      guild_id = ?
      AND user_id = ?
  `),

  // --------------------------------------------------------------------------
  // MEDIA POST TRACKING
  // --------------------------------------------------------------------------

  addMediaPost: db.prepare(`
    INSERT OR IGNORE INTO media_posts (
      message_id,
      user_id,
      kind,
      created_at
    )

    VALUES (?, ?, ?, ?)
  `),

  getMediaPost: db.prepare(`
    SELECT *
    FROM media_posts

    WHERE message_id = ?
  `),

  deleteMediaPost: db.prepare(`
    DELETE FROM media_posts

    WHERE message_id = ?
  `),

  mediaCountByKind: db.prepare(`
    SELECT COUNT(*) AS count

    FROM media_posts

    WHERE
      user_id = ?
      AND kind = ?
  `),

  getMediaCooldown: db.prepare(`
    SELECT *
    FROM media_cooldowns

    WHERE
      user_id = ?
      AND kind = ?
  `),

  setMediaCooldown: db.prepare(`
    INSERT INTO media_cooldowns (
      user_id,
      kind,
      last_post_at
    )

    VALUES (?, ?, ?)

    ON CONFLICT(user_id, kind)

    DO UPDATE SET
      last_post_at = excluded.last_post_at
  `),

  // --------------------------------------------------------------------------
  // VERIFICATION
  // --------------------------------------------------------------------------

  setVerifyCode: db.prepare(`
    INSERT INTO verification_codes (
      user_id,
      code,
      expires_at,
      attempts
    )

    VALUES (?, ?, ?, 0)

    ON CONFLICT(user_id)

    DO UPDATE SET
      code = excluded.code,
      expires_at = excluded.expires_at,
      attempts = 0
  `),

  getVerifyCode: db.prepare(`
    SELECT *
    FROM verification_codes

    WHERE user_id = ?
  `),

  incVerifyAttempt: db.prepare(`
    UPDATE verification_codes

    SET attempts = attempts + 1

    WHERE user_id = ?
  `),

  deleteVerifyCode: db.prepare(`
    DELETE FROM verification_codes

    WHERE user_id = ?
  `),

  // --------------------------------------------------------------------------
  // PRIVATE CLUBS
  // --------------------------------------------------------------------------

  addClub: db.prepare(`
    INSERT OR REPLACE INTO temp_clubs (
      channel_id,
      owner_id,
      created_at,
      locked,
      hidden
    )

    VALUES (?, ?, ?, 0, 0)
  `),

  getClubByOwner: db.prepare(`
    SELECT *
    FROM temp_clubs

    WHERE owner_id = ?
  `),

  getClubByChannel: db.prepare(`
    SELECT *
    FROM temp_clubs

    WHERE channel_id = ?
  `),

  deleteClubByChannel: db.prepare(`
    DELETE FROM temp_clubs

    WHERE channel_id = ?
  `),

  deleteClubByOwner: db.prepare(`
    DELETE FROM temp_clubs

    WHERE owner_id = ?
  `),

  setClubLocked: db.prepare(`
    UPDATE temp_clubs

    SET locked = ?

    WHERE channel_id = ?
  `),

  setClubHidden: db.prepare(`
    UPDATE temp_clubs

    SET hidden = ?

    WHERE channel_id = ?
  `),

  transferClub: db.prepare(`
    UPDATE temp_clubs

    SET owner_id = ?

    WHERE channel_id = ?
  `),

  // --------------------------------------------------------------------------
  // COUNTING
  // --------------------------------------------------------------------------

  getCounting: db.prepare(`
    SELECT *
    FROM counting

    WHERE channel_id = ?
  `),

  startCounting: db.prepare(`
    INSERT OR REPLACE INTO counting (
      channel_id,
      next_number,
      last_user_id
    )

    VALUES (?, 1, NULL)
  `),

  stopCounting: db.prepare(`
    DELETE FROM counting

    WHERE channel_id = ?
  `),

  updateCounting: db.prepare(`
    UPDATE counting

    SET
      next_number = ?,
      last_user_id = ?

    WHERE channel_id = ?
  `),

  resetCounting: db.prepare(`
    UPDATE counting

    SET
      next_number = 1,
      last_user_id = NULL

    WHERE channel_id = ?
  `),

  // --------------------------------------------------------------------------
  // TICKETS
  // --------------------------------------------------------------------------

  addTicket: db.prepare(`
    INSERT OR REPLACE INTO tickets (
      channel_id,
      opener_id,
      type,
      created_at
    )

    VALUES (?, ?, ?, ?)
  `),

  getTicket: db.prepare(`
    SELECT *
    FROM tickets

    WHERE channel_id = ?
  `),

  claimTicket: db.prepare(`
    UPDATE tickets

    SET claimed_by = ?

    WHERE channel_id = ?
  `),

  deleteTicket: db.prepare(`
    DELETE FROM tickets

    WHERE channel_id = ?
  `),
};

// ============================================================================
// RUNTIME STATE
// ============================================================================

const ticTacToeGames = new Map();

const hangmanGames = new Map();

const numberGames = new Map();

const spamTracker = new Map();

const pendingClubDeletes = new Map();

// ============================================================================
// GENERIC HELPERS
// ============================================================================

function isOwner(userId) {
  return CONFIG.OWNER_IDS.includes(userId);
}

function hasAnyRole(member, roleIds) {
  if (!member) {
    return false;
  }

  return roleIds.some((roleId) => {
    return member.roles.cache.has(roleId);
  });
}

function isStaff(member) {
  if (!member) {
    return false;
  }

  return (
    isOwner(member.id) ||
    hasAnyRole(member, STAFF_ROLE_IDS)
  );
}

function isManagement(member) {
  if (!member) {
    return false;
  }

  return (
    isOwner(member.id) ||
    hasAnyRole(member, MANAGEMENT_ROLE_IDS)
  );
}

function randInt(min, max) {
  return Math.floor(
    Math.random() * (max - min + 1),
  ) + min;
}

function truncate(text, max = 1000) {
  if (!text) {
    return '—';
  }

  const value = String(text);

  if (value.length <= max) {
    return value;
  }

  return `${value.slice(0, max - 1)}…`;
}

function sanitizeChannelName(input) {
  const value = String(input || '')
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);

  return value || 'archive';
}

function baseEmbed() {
  return new EmbedBuilder()
    .setColor(CONFIG.BRAND.COLOR)
    .setFooter({
      text: CONFIG.BRAND.FOOTER,
    })
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

async function fetchGuild() {
  return client.guilds.fetch(
    CONFIG.GUILD_ID,
  );
}

async function fetchConfiguredChannel(channelId) {
  const guild = await fetchGuild();

  return guild.channels
    .fetch(channelId)
    .catch(() => null);
}

async function logEvent(
  title,
  description,
  fields = [],
) {
  try {
    const channel = await fetchConfiguredChannel(
      CONFIG.CHANNELS.SERVER_LOGS,
    );

    if (!channel?.isTextBased()) {
      return;
    }

    const embed = baseEmbed()
      .setTitle(`⌁ ${title}`);

    if (description) {
      embed.setDescription(description);
    }

    if (fields.length) {
      embed.addFields(
        fields.slice(0, 25),
      );
    }

    await channel.send({
      embeds: [embed],
    });
  } catch (error) {
    console.error(
      '[logEvent]',
      error,
    );
  }
}

// ============================================================================
// LEVEL / XP HELPERS
// ============================================================================

function xpForLevel(level) {
  return (
    CONFIG.LEVELING.XP_BASE *
    level *
    level
  );
}

function levelFromXp(xp) {
  return Math.floor(
    Math.sqrt(
      Math.max(0, xp) /
      CONFIG.LEVELING.XP_BASE,
    ),
  );
}

function progressBar(
  current,
  needed,
  size = 12,
) {
  const ratio = needed <= 0
    ? 1
    : Math.max(
        0,
        Math.min(
          1,
          current / needed,
        ),
      );

  const filled = Math.round(
    ratio * size,
  );

  return (
    '▰'.repeat(filled) +
    '▱'.repeat(size - filled)
  );
}

async function syncLevelRoles(
  member,
  level,
) {
  if (!member) {
    return;
  }

  if (member.user.bot) {
    return;
  }

  const eligibleMilestones =
    LEVEL_MILESTONES.filter(
      (milestone) => level >= milestone,
    );

  const highestMilestone =
    eligibleMilestones.length
      ? eligibleMilestones[
          eligibleMilestones.length - 1
        ]
      : null;

  const levelRoleIds =
    Object.values(
      CONFIG.ROLES.LEVELS,
    );

  const targetRoleId =
    highestMilestone
      ? CONFIG.ROLES.LEVELS[
          highestMilestone
        ]
      : null;

  const rolesToRemove =
    levelRoleIds.filter(
      (roleId) =>
        member.roles.cache.has(roleId) &&
        roleId !== targetRoleId,
    );

  if (rolesToRemove.length) {
    await member.roles
      .remove(rolesToRemove)
      .catch(() => null);
  }

  if (
    targetRoleId &&
    !member.roles.cache.has(
      targetRoleId,
    )
  ) {
    await member.roles
      .add(targetRoleId)
      .catch(() => null);
  }

  if (
    level >= 60 &&
    !member.roles.cache.has(
      CONFIG.ROLES.LOYAL_MEMBER,
    )
  ) {
    await member.roles
      .add(
        CONFIG.ROLES.LOYAL_MEMBER,
      )
      .catch(() => null);
  }
}

async function maybeAnnounceMilestone(
  member,
  oldLevel,
  newLevel,
) {
  const crossed =
    LEVEL_MILESTONES.find(
      (milestone) =>
        oldLevel < milestone &&
        newLevel >= milestone,
    );

  if (!crossed) {
    return;
  }

  const chat =
    await fetchConfiguredChannel(
      CONFIG.CHANNELS.CHAT,
    );

  if (!chat?.isTextBased()) {
    return;
  }

  await chat.send({
    embeds: [
      baseEmbed()
        .setTitle('𖤐 level up')
        .setDescription(
          `${member} reached **level ${crossed}**.`,
        ),
    ],
  }).catch(() => null);
}

// ============================================================================
// MEDIA / PFP / BANNER HELPERS
// ============================================================================

function isImageMessage(message) {
  const attachmentHasImage =
    message.attachments.some(
      (attachment) => {
        if (
          attachment.contentType
            ?.startsWith('image/')
        ) {
          return true;
        }

        const path =
          attachment.url ||
          attachment.name ||
          '';

        return /\.(png|jpe?g|gif|webp)(\?.*)?$/i
          .test(path);
      },
    );

  if (attachmentHasImage) {
    return true;
  }

  const urls =
    message.content.match(
      /https?:\/\/\S+/gi,
    ) || [];

  return urls.some((url) => {
    return /\.(png|jpe?g|gif|webp)(\?.*)?$/i
      .test(url);
  });
}

async function updateMediaPosterRole(
  member,
) {
  if (
    !member ||
    member.user.bot
  ) {
    return;
  }

  const pfpPosts =
    sql.mediaCountByKind
      .get(
        member.id,
        'pfp',
      )
      .count;

  const bannerPosts =
    sql.mediaCountByKind
      .get(
        member.id,
        'banner',
      )
      .count;

  // IMPORTANT:
  // It is 5 OF ONE TYPE.
  //
  // 3 PFP + 2 banner DOES NOT qualify.
  //
  // 5 PFP qualifies.
  // OR
  // 5 banner qualifies.
  const qualifies =
    pfpPosts >=
      CONFIG.MEDIA.REQUIRED_POSTS ||
    bannerPosts >=
      CONFIG.MEDIA.REQUIRED_POSTS;

  const alreadyHasRole =
    member.roles.cache.has(
      CONFIG.ROLES.MEDIA_POSTER,
    );

  if (
    qualifies &&
    !alreadyHasRole
  ) {
    await member.roles
      .add(
        CONFIG.ROLES.MEDIA_POSTER,
      )
      .catch(() => null);

    const qualifyingType =
      pfpPosts >=
      CONFIG.MEDIA.REQUIRED_POSTS
        ? 'pfp'
        : 'banner';

    await member.send({
      embeds: [
        successEmbed(
          'media poster unlocked',
          [
            `you hit **${CONFIG.MEDIA.REQUIRED_POSTS}+ ${qualifyingType} posts**.`,
            '',
            `you received <@&${CONFIG.ROLES.MEDIA_POSTER}>.`,
            '',
            'the 5 minute archive cooldown no longer applies to you.',
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

  // If enough qualifying posts are deleted later,
  // remove the role again.
  if (
    !qualifies &&
    alreadyHasRole
  ) {
    await member.roles
      .remove(
        CONFIG.ROLES.MEDIA_POSTER,
      )
      .catch(() => null);
  }
}

// ============================================================================
// CAPTCHA / VERIFICATION HELPERS
// ============================================================================

function verificationCode() {
  return String(
    randInt(
      1000,
      9999,
    ),
  );
}
  // No I, O, 0 or 1.
  // Makes the captcha less annoying to read.
  const characters =
    'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

  let code = '';

  for (
    let index = 0;
    index < CONFIG.VERIFICATION.CODE_LENGTH;
    index++
  ) {
    code += characters[
      randInt(
        0,
        characters.length - 1,
      )
    ];
  }

  return code;
}

function renderCaptcha(code) {
  const canvas = createCanvas(
    700,
    220,
  );

  const ctx =
    canvas.getContext('2d');

  ctx.fillStyle =
    '#120707';

  ctx.fillRect(
    0,
    0,
    canvas.width,
    canvas.height,
  );

  ctx.fillStyle =
    '#ffffff';

  ctx.font =
    'bold 100px sans-serif';

  ctx.textAlign =
    'center';

  ctx.textBaseline =
    'middle';

  ctx.fillText(
    code,
    canvas.width / 2,
    canvas.height / 2,
  );

  return canvas.toBuffer(
    'image/png',
  );
}
  // --------------------------------------------------------------------------
  // BACKGROUND
  // --------------------------------------------------------------------------

  ctx.fillStyle = '#120707';

  ctx.fillRect(
    0,
    0,
    canvas.width,
    canvas.height,
  );

  // --------------------------------------------------------------------------
  // RANDOM RED/DARK LINES
  // --------------------------------------------------------------------------

  for (
    let index = 0;
    index < 35;
    index++
  ) {
    ctx.strokeStyle =
      `rgba(` +
      `${randInt(80, 150)}, ` +
      `${randInt(5, 30)}, ` +
      `${randInt(5, 30)}, ` +
      `0.35)`;

    ctx.lineWidth =
      randInt(
        1,
        4,
      );

    ctx.beginPath();

    ctx.moveTo(
      randInt(0, 700),
      randInt(0, 220),
    );

    ctx.lineTo(
      randInt(0, 700),
      randInt(0, 220),
    );

    ctx.stroke();
  }

  // --------------------------------------------------------------------------
  // CAPTCHA CHARACTERS
  // --------------------------------------------------------------------------

  ctx.textAlign = 'center';

  ctx.textBaseline = 'middle';

  for (
    let index = 0;
    index < code.length;
    index++
  ) {
    ctx.save();

    ctx.translate(
      115 + index * 95,
      110 + randInt(-18, 18),
    );

    ctx.rotate(
      (
        randInt(-18, 18) *
        Math.PI
      ) / 180,
    );

    ctx.font =
      `bold ${randInt(58, 76)}px sans-serif`;

    ctx.fillStyle =
      index % 2 === 0
        ? '#f2e9e9'
        : '#b24b4b';

    ctx.fillText(
      code[index],
      0,
      0,
    );

    ctx.restore();
  }

  // --------------------------------------------------------------------------
  // STATIC / NOISE
  // --------------------------------------------------------------------------

  for (
    let index = 0;
    index < 250;
    index++
  ) {
    ctx.fillStyle =
      `rgba(255,255,255,` +
      `${Math.random() * 0.18})`;

    ctx.fillRect(
      randInt(0, 699),
      randInt(0, 219),
      randInt(1, 3),
      randInt(1, 3),
    );
  }

  return canvas.toBuffer(
    'image/png',
  );
}

async function completeVerification(
  userId,
) {
  const guild =
    await fetchGuild();

  const member =
    await guild.members
      .fetch(userId)
      .catch(() => null);

  if (!member) {
    throw new Error(
      'Member is no longer in the server.',
    );
  }

  // EXACT roles requested.
  const verificationRoles = [
    CONFIG.ROLES.MEMBER_TAG,
    CONFIG.ROLES.MEMBER,
    CONFIG.ROLES.MISC,
  ];

  await member.roles.add(
    verificationRoles,
  );

  // Remove unverified/verify role.
  if (
    member.roles.cache.has(
      CONFIG.ROLES.VERIFY,
    )
  ) {
    await member.roles
      .remove(
        CONFIG.ROLES.VERIFY,
      )
      .catch(() => null);
  }

  // Ensure their XP database row exists.
  sql.ensureUser.run(
    member.id,
  );

  await sendWelcome(
    member,
  );

  await logEvent(
    'verification complete',
    `${member.user.tag} (${member.id}) verified successfully.`,
  );
}

// ============================================================================
// WELCOME
// ============================================================================

function welcomeEmbed(member) {
  return baseEmbed()
    .setTitle(
      'kvsarchive // access granted',
    )
    .setDescription(
      [
        `welcome to the archive, ${member}.`,
        '',
        `› read <#${CONFIG.CHANNELS.RULES}>`,
        `› talk in <#${CONFIG.CHANNELS.CHAT}>`,
        `› drop pfps in <#${CONFIG.CHANNELS.PFP}>`,
        `› drop banners in <#${CONFIG.CHANNELS.BANNER}>`,
        '',
        `**${CONFIG.MEDIA.REQUIRED_POSTS}+** valid posts in either **pfp** or **banner** unlocks <@&${CONFIG.ROLES.MEDIA_POSTER}>.`,
        '',
        '5 pfps counts.',
        '5 banners counts.',
        'mixing the two does not.',
        '',
        'stay active. archive something worth keeping.',
      ].join('\n'),
    )
    .setThumbnail(
      member.user.displayAvatarURL({
        size: 256,
      }),
    );
}

async function sendWelcome(member) {
  const channel =
    await fetchConfiguredChannel(
      CONFIG.CHANNELS.WELC,
    );

  if (!channel?.isTextBased()) {
    return;
  }

  await channel.send({
    content: `${member}`,
    embeds: [
      welcomeEmbed(member),
    ],
  });
}

// ============================================================================
// VERIFY PANEL
// ============================================================================

function verifyPanel() {
  const embed =
    baseEmbed()
      .setTitle(
        '⸸ verification',
      )
      .setDescription(
        [
          '**kvsarchive**',
          '',
          'verify below to access the archive.',
          '',
          'you will receive a short captcha through DMs.',
          'reply with the characters shown.',
          '',
          'access is granted automatically after completion.',
          '',
          '*your DMs must be open.*',
        ].join('\n'),
      );

  const row =
    new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(
            'verify_start',
          )
          .setLabel(
            'verify',
          )
          .setStyle(
            ButtonStyle.Secondary,
          )
          .setEmoji(
            '⛓️',
          ),
      );

  return {
    embeds: [
      embed,
    ],

    components: [
      row,
    ],
  };
}

// ============================================================================
// TICKET PANEL
// ============================================================================

function ticketPanel() {
  const embed =
    baseEmbed()
      .setTitle(
        '⌁ support archive',
      )
      .setDescription(
        [
          'choose the ticket type you actually need.',
          '',
          '**member report**',
          'report a member, behaviour or server incident.',
          '',
          '**general support**',
          'server questions, help or problems.',
          '',
          '**owner request**',
          'a request specifically intended for the owner.',
          '',
          'false reports / ticket spam may be moderated.',
        ].join('\n'),
      );

  const row =
    new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(
            'ticket_report',
          )
          .setLabel(
            'member report',
          )
          .setStyle(
            ButtonStyle.Secondary,
          )
          .setEmoji(
            '⚠️',
          ),

        new ButtonBuilder()
          .setCustomId(
            'ticket_support',
          )
          .setLabel(
            'general support',
          )
          .setStyle(
            ButtonStyle.Secondary,
          )
          .setEmoji(
            '🛠️',
          ),

        new ButtonBuilder()
          .setCustomId(
            'ticket_owner',
          )
          .setLabel(
            'owner request',
          )
          .setStyle(
            ButtonStyle.Danger,
          )
          .setEmoji(
            '👑',
          ),
      );

  return {
    embeds: [
      embed,
    ],

    components: [
      row,
    ],
  };
}

// ============================================================================
// PRIVATE CLUB PANEL
// ============================================================================

function clubPanel() {
  const embed =
    baseEmbed()
      .setTitle(
        '𖤐 private clubs',
      )
      .setDescription(
        [
          `join <#${CONFIG.CHANNELS.CREATE_PRIVATE_CLUB}> to generate your own temporary club.`,
          '',
          '**club owners can:**',
          '› rename their club',
          '› set a user limit',
          '› lock / unlock joining',
          '› hide / show the channel',
          '› permit individual members',
          '› block individual members',
          '› transfer ownership',
          '› delete the club',
          '',
          'clubs automatically disappear after becoming empty.',
          '',
          'staff retain access for moderation.',
        ].join('\n'),
      );

  const firstRow =
    new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(
            'club_rename',
          )
          .setLabel(
            'rename',
          )
          .setStyle(
            ButtonStyle.Secondary,
          ),

        new ButtonBuilder()
          .setCustomId(
            'club_limit',
          )
          .setLabel(
            'limit',
          )
          .setStyle(
            ButtonStyle.Secondary,
          ),

        new ButtonBuilder()
          .setCustomId(
            'club_lock',
          )
          .setLabel(
            'lock / unlock',
          )
          .setStyle(
            ButtonStyle.Secondary,
          ),

        new ButtonBuilder()
          .setCustomId(
            'club_hide',
          )
          .setLabel(
            'hide / show',
          )
          .setStyle(
            ButtonStyle.Secondary,
          ),

        new ButtonBuilder()
          .setCustomId(
            'club_info',
          )
          .setLabel(
            'info',
          )
          .setStyle(
            ButtonStyle.Secondary,
          ),
      );

  const secondRow =
    new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(
            'club_allow',
          )
          .setLabel(
            'permit user',
          )
          .setStyle(
            ButtonStyle.Success,
          ),

        new ButtonBuilder()
          .setCustomId(
            'club_block',
          )
          .setLabel(
            'block user',
          )
          .setStyle(
            ButtonStyle.Danger,
          ),

        new ButtonBuilder()
          .setCustomId(
            'club_transfer',
          )
          .setLabel(
            'transfer owner',
          )
          .setStyle(
            ButtonStyle.Primary,
          ),

        new ButtonBuilder()
          .setCustomId(
            'club_delete',
          )
          .setLabel(
            'delete club',
          )
          .setStyle(
            ButtonStyle.Danger,
          ),
      );

  return {
    embeds: [
      embed,
    ],

    components: [
      firstRow,
      secondRow,
    ],
  };
}

// ============================================================================
// SPECIALTY / INFO PANEL
// ============================================================================

function specialtyInfoPanel() {
  return {
    embeds: [
      baseEmbed()
        .setTitle(
          '† specialty & info',
        )
        .setDescription(
          [
            '**media poster**',
            `post ${CONFIG.MEDIA.REQUIRED_POSTS}+ pfps OR ${CONFIG.MEDIA.REQUIRED_POSTS}+ banners to unlock <@&${CONFIG.ROLES.MEDIA_POSTER}>.`,
            '',
            'once earned, the 5 minute PFP/banner cooldown is bypassed.',
            '',
            '**activity levels**',
            'chatting normally and spending time in active voice calls earns XP.',
            '',
            'use `/level` to inspect yourself.',
            'use `/leaderboard` for server rankings.',
            '',
            `level **60** automatically gives <@&${CONFIG.ROLES.LOYAL_MEMBER}>.`,
            '',
            '**private clubs**',
            `join <#${CONFIG.CHANNELS.CREATE_PRIVATE_CLUB}> and use the control panel in <#${CONFIG.CHANNELS.PRIVATE_CLUB_CMDS}>.`,
          ].join('\n'),
        ),
    ],
  };
}

// ============================================================================
// STAFF APPLICATION PANEL
// ============================================================================

function staffApplicationPanel() {
  const embed =
    baseEmbed()
      .setTitle(
        '⛧ staff applications // open',
      )
      .setDescription(
        [
          '**applications are currently open.**',
          '',
          'answer everything properly.',
          '',
          'low-effort, troll or spam applications are ignored.',
          '',
          'submitting multiple applications does not increase your chances.',
        ].join('\n'),
      );

  const row =
    new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(
            'staffapp_open',
          )
          .setLabel(
            'apply',
          )
          .setStyle(
            ButtonStyle.Danger,
          )
          .setEmoji(
            '👑',
          ),
      );

  return {
    embeds: [
      embed,
    ],

    components: [
      row,
    ],
  };
}

// ============================================================================
// SLASH COMMAND DEFINITIONS
// ============================================================================

// Discord uses these permissions to decide who can SEE staff commands.
//
// Runtime checks below ALSO verify your actual configured staff role IDs.
// That means we have both:
// 1. Discord-side command visibility
// 2. Bot-side role security
const STAFF_DEFAULT_PERMISSION =
  PermissionFlagsBits.ManageMessages;

const MANAGEMENT_DEFAULT_PERMISSION =
  PermissionFlagsBits.ManageGuild;

const OWNER_DEFAULT_PERMISSION =
  PermissionFlagsBits.Administrator;

const commands = [
  // ==========================================================================
  // GENERAL / COMMUNITY
  // ==========================================================================

  new SlashCommandBuilder()
    .setName('help')
    .setDescription(
      'show the useful kvsarchive commands',
    ),

  new SlashCommandBuilder()
    .setName('ping')
    .setDescription(
      'check bot latency',
    ),

  new SlashCommandBuilder()
    .setName('level')
    .setDescription(
      'check an activity level',
    )
    .addUserOption((option) =>
      option
        .setName('user')
        .setDescription(
          'user to inspect',
        ),
    ),

  new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription(
      'show the top activity levels',
    ),

  new SlashCommandBuilder()
    .setName('avatar')
    .setDescription(
      'show a user avatar',
    )
    .addUserOption((option) =>
      option
        .setName('user')
        .setDescription(
          'user',
        ),
    ),

  new SlashCommandBuilder()
    .setName('userinfo')
    .setDescription(
      'show basic user information',
    )
    .addUserOption((option) =>
      option
        .setName('user')
        .setDescription(
          'user',
        ),
    ),

  new SlashCommandBuilder()
    .setName('serverinfo')
    .setDescription(
      'show server information',
    ),

  // ==========================================================================
  // SMALL FUN COMMANDS
  // ==========================================================================

  new SlashCommandBuilder()
    .setName('coinflip')
    .setDescription(
      'flip a coin',
    ),

  new SlashCommandBuilder()
    .setName('roll')
    .setDescription(
      'roll a die',
    )
    .addIntegerOption((option) =>
      option
        .setName('sides')
        .setDescription(
          'number of sides',
        )
        .setMinValue(2)
        .setMaxValue(100000),
    ),

  new SlashCommandBuilder()
    .setName('8ball')
    .setDescription(
      'ask the 8ball something',
    )
    .addStringOption((option) =>
      option
        .setName('question')
        .setDescription(
          'your question',
        )
        .setRequired(true)
        .setMaxLength(500),
    ),

  new SlashCommandBuilder()
    .setName('rps')
    .setDescription(
      'rock paper scissors',
    )
    .addStringOption((option) =>
      option
        .setName('choice')
        .setDescription(
          'your move',
        )
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
    .setDescription(
      'let the bot choose between options',
    )
    .addStringOption((option) =>
      option
        .setName('choices')
        .setDescription(
          'separate choices using |',
        )
        .setRequired(true)
        .setMaxLength(1000),
    ),

  new SlashCommandBuilder()
    .setName('ship')
    .setDescription(
      'calculate a compatibility percentage',
    )
    .addUserOption((option) =>
      option
        .setName('user1')
        .setDescription(
          'first user',
        )
        .setRequired(true),
    )
    .addUserOption((option) =>
      option
        .setName('user2')
        .setDescription(
          'second user',
        )
        .setRequired(true),
    ),

  // ==========================================================================
  // IMAGE / REACTION COMMANDS
  // ==========================================================================

  new SlashCommandBuilder()
    .setName('neko')
    .setDescription(
      'random SFW neko image',
    ),

  new SlashCommandBuilder()
    .setName('waifu')
    .setDescription(
      'random SFW waifu image',
    ),

  new SlashCommandBuilder()
    .setName('hug')
    .setDescription(
      'hug someone',
    )
    .addUserOption((option) =>
      option
        .setName('user')
        .setDescription(
          'who',
        )
        .setRequired(true),
    ),

  new SlashCommandBuilder()
    .setName('pat')
    .setDescription(
      'pat someone',
    )
    .addUserOption((option) =>
      option
        .setName('user')
        .setDescription(
          'who',
        )
        .setRequired(true),
    ),

  new SlashCommandBuilder()
    .setName('slap')
    .setDescription(
      'slap someone',
    )
    .addUserOption((option) =>
      option
        .setName('user')
        .setDescription(
          'who',
        )
        .setRequired(true),
    ),

  new SlashCommandBuilder()
    .setName('kiss')
    .setDescription(
      'kiss someone',
    )
    .addUserOption((option) =>
      option
        .setName('user')
        .setDescription(
          'who',
        )
        .setRequired(true),
    ),

  // ==========================================================================
  // HANGMAN
  // ==========================================================================

  new SlashCommandBuilder()
    .setName('hangman')
    .setDescription(
      'start a hangman game',
    ),

  new SlashCommandBuilder()
    .setName('guess')
    .setDescription(
      'guess a hangman letter or word',
    )
    .addStringOption((option) =>
      option
        .setName('guess')
        .setDescription(
          'letter or full word',
        )
        .setRequired(true)
        .setMaxLength(30),
    ),

  // ==========================================================================
  // NUMBER GUESSING
  // ==========================================================================

  new SlashCommandBuilder()
    .setName('numberguess')
    .setDescription(
      'start a number guessing game',
    )
    .addIntegerOption((option) =>
      option
        .setName('max')
        .setDescription(
          'maximum possible number',
        )
        .setMinValue(10)
        .setMaxValue(100000),
    ),

  new SlashCommandBuilder()
    .setName('guessnum')
    .setDescription(
      'guess the current number',
    )
    .addIntegerOption((option) =>
      option
        .setName('number')
        .setDescription(
          'your guess',
        )
        .setRequired(true),
    ),

  // ==========================================================================
  // TIC TAC TOE
  // ==========================================================================

  new SlashCommandBuilder()
    .setName('tictactoe')
    .setDescription(
      'challenge another member to tic tac toe',
    )
    .addUserOption((option) =>
      option
        .setName('user')
        .setDescription(
          'opponent',
        )
        .setRequired(true),
    ),

  // ==========================================================================
  // POLLS
  // ==========================================================================

  new SlashCommandBuilder()
    .setName('poll')
    .setDescription(
      'create a reaction poll',
    )
    .addStringOption((option) =>
      option
        .setName('question')
        .setDescription(
          'poll question',
        )
        .setRequired(true)
        .setMaxLength(500),
    )
    .addStringOption((option) =>
      option
        .setName('option1')
        .setDescription(
          'option one',
        )
        .setRequired(true)
        .setMaxLength(100),
    )
    .addStringOption((option) =>
      option
        .setName('option2')
        .setDescription(
          'option two',
        )
        .setRequired(true)
        .setMaxLength(100),
    )
    .addStringOption((option) =>
      option
        .setName('option3')
        .setDescription(
          'optional',
        )
        .setMaxLength(100),
    )
    .addStringOption((option) =>
      option
        .setName('option4')
        .setDescription(
          'optional',
        )
        .setMaxLength(100),
    )
    .addStringOption((option) =>
      option
        .setName('option5')
        .setDescription(
          'optional',
        )
        .setMaxLength(100),
    ),

  // ==========================================================================
  // COUNTING GAME
  // ==========================================================================

  new SlashCommandBuilder()
    .setName('counting')
    .setDescription(
      'counting game controls',
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('status')
        .setDescription(
          'show counting status in this channel',
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('start')
        .setDescription(
          'staff: start counting here',
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('stop')
        .setDescription(
          'staff: stop counting here',
        ),
    ),

  // ==========================================================================
  // STAFF MODERATION
  // ==========================================================================

  new SlashCommandBuilder()
    .setName('warn')
    .setDescription(
      'warn a member',
    )
    .setDefaultMemberPermissions(
      STAFF_DEFAULT_PERMISSION,
    )
    .addUserOption((option) =>
      option
        .setName('user')
        .setDescription(
          'member',
        )
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName('reason')
        .setDescription(
          'warning reason',
        )
        .setRequired(true)
        .setMaxLength(1000),
    ),

  new SlashCommandBuilder()
    .setName('warnings')
    .setDescription(
      'view member warnings',
    )
    .setDefaultMemberPermissions(
      STAFF_DEFAULT_PERMISSION,
    )
    .addUserOption((option) =>
      option
        .setName('user')
        .setDescription(
          'member',
        )
        .setRequired(true),
    ),

  new SlashCommandBuilder()
    .setName('clearwarnings')
    .setDescription(
      'clear all warnings from a member',
    )
    .setDefaultMemberPermissions(
      STAFF_DEFAULT_PERMISSION,
    )
    .addUserOption((option) =>
      option
        .setName('user')
        .setDescription(
          'member',
        )
        .setRequired(true),
    ),

  new SlashCommandBuilder()
    .setName('clear')
    .setDescription(
      'bulk delete messages',
    )
    .setDefaultMemberPermissions(
      STAFF_DEFAULT_PERMISSION,
    )
    .addIntegerOption((option) =>
      option
        .setName('amount')
        .setDescription(
          'number of messages',
        )
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(100),
    ),

  new SlashCommandBuilder()
    .setName('timeout')
    .setDescription(
      'timeout a member',
    )
    .setDefaultMemberPermissions(
      STAFF_DEFAULT_PERMISSION,
    )
    .addUserOption((option) =>
      option
        .setName('user')
        .setDescription(
          'member',
        )
        .setRequired(true),
    )
    .addIntegerOption((option) =>
      option
        .setName('minutes')
        .setDescription(
          'timeout duration in minutes',
        )
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(40320),
    )
    .addStringOption((option) =>
      option
        .setName('reason')
        .setDescription(
          'reason',
        )
        .setMaxLength(1000),
    ),

  new SlashCommandBuilder()
    .setName('untimeout')
    .setDescription(
      'remove a timeout',
    )
    .setDefaultMemberPermissions(
      STAFF_DEFAULT_PERMISSION,
    )
    .addUserOption((option) =>
      option
        .setName('user')
        .setDescription(
          'member',
        )
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName('reason')
        .setDescription(
          'reason',
        )
        .setMaxLength(1000),
    ),

  new SlashCommandBuilder()
    .setName('kick')
    .setDescription(
      'kick a member',
    )
    .setDefaultMemberPermissions(
      STAFF_DEFAULT_PERMISSION,
    )
    .addUserOption((option) =>
      option
        .setName('user')
        .setDescription(
          'member',
        )
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName('reason')
        .setDescription(
          'reason',
        )
        .setMaxLength(1000),
    ),

  new SlashCommandBuilder()
    .setName('ban')
    .setDescription(
      'ban a member',
    )
    .setDefaultMemberPermissions(
      STAFF_DEFAULT_PERMISSION,
    )
    .addUserOption((option) =>
      option
        .setName('user')
        .setDescription(
          'member',
        )
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName('reason')
        .setDescription(
          'reason',
        )
        .setMaxLength(1000),
    )
    .addIntegerOption((option) =>
      option
        .setName('delete_hours')
        .setDescription(
          'message history to delete',
        )
        .setMinValue(0)
        .setMaxValue(168),
    ),

  new SlashCommandBuilder()
    .setName('unban')
    .setDescription(
      'unban a user by Discord ID',
    )
    .setDefaultMemberPermissions(
      STAFF_DEFAULT_PERMISSION,
    )
    .addStringOption((option) =>
      option
        .setName('userid')
        .setDescription(
          'Discord user ID',
        )
        .setRequired(true)
        .setMinLength(17)
        .setMaxLength(20),
    )
    .addStringOption((option) =>
      option
        .setName('reason')
        .setDescription(
          'reason',
        )
        .setMaxLength(1000),
    ),

  new SlashCommandBuilder()
    .setName('slowmode')
    .setDescription(
      'change channel slowmode',
    )
    .setDefaultMemberPermissions(
      STAFF_DEFAULT_PERMISSION,
    )
    .addIntegerOption((option) =>
      option
        .setName('seconds')
        .setDescription(
          '0 disables slowmode',
        )
        .setRequired(true)
        .setMinValue(0)
        .setMaxValue(21600),
    )
    .addChannelOption((option) =>
      option
        .setName('channel')
        .setDescription(
          'channel; defaults to current',
        ),
    ),

  new SlashCommandBuilder()
    .setName('lock')
    .setDescription(
      'lock a text channel',
    )
    .setDefaultMemberPermissions(
      STAFF_DEFAULT_PERMISSION,
    )
    .addChannelOption((option) =>
      option
        .setName('channel')
        .setDescription(
          'channel; defaults to current',
        ),
    ),

  new SlashCommandBuilder()
    .setName('unlock')
    .setDescription(
      'unlock a text channel',
    )
    .setDefaultMemberPermissions(
      STAFF_DEFAULT_PERMISSION,
    )
    .addChannelOption((option) =>
      option
        .setName('channel')
        .setDescription(
          'channel; defaults to current',
        ),
    ),

  new SlashCommandBuilder()
    .setName('nick')
    .setDescription(
      'change a member nickname',
    )
    .setDefaultMemberPermissions(
      STAFF_DEFAULT_PERMISSION,
    )
    .addUserOption((option) =>
      option
        .setName('user')
        .setDescription(
          'member',
        )
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName('nickname')
        .setDescription(
          'leave blank to clear nickname',
        )
        .setMaxLength(32),
    ),

  // ==========================================================================
  // MANAGEMENT
  // ==========================================================================

  new SlashCommandBuilder()
    .setName('psa')
    .setDescription(
      'post a PSA in the configured PSA channel',
    )
    .setDefaultMemberPermissions(
      MANAGEMENT_DEFAULT_PERMISSION,
    )
    .addStringOption((option) =>
      option
        .setName('message')
        .setDescription(
          'PSA text',
        )
        .setRequired(true)
        .setMaxLength(4000),
    )
    .addStringOption((option) =>
      option
        .setName('title')
        .setDescription(
          'optional title',
        )
        .setMaxLength(200),
    ),

  // ==========================================================================
  // OWNER-ONLY SERVER SETUP
  // ==========================================================================

  new SlashCommandBuilder()
    .setName('setup')
    .setDescription(
      'owner: post official kvsarchive panels',
    )
    .setDefaultMemberPermissions(
      OWNER_DEFAULT_PERMISSION,
    )
    .addStringOption((option) =>
      option
        .setName('panel')
        .setDescription(
          'panel to post',
        )
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
    .setDescription(
      'owner: post the staff application panel',
    )
    .setDefaultMemberPermissions(
      OWNER_DEFAULT_PERMISSION,
    ),

  new SlashCommandBuilder()
    .setName('test')
    .setDescription(
      'owner-only bot test command',
    )
    .setDefaultMemberPermissions(
      OWNER_DEFAULT_PERMISSION,
    )
    .addStringOption((option) =>
      option
        .setName('type')
        .setDescription(
          'what to test',
        )
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
            name: 'captcha',
            value: 'captcha',
          },
        ),
    ),

  // ==========================================================================
  // OWNER XP CONTROL
  // ==========================================================================

  new SlashCommandBuilder()
    .setName('xp')
    .setDescription(
      'owner: manage activity XP',
    )
    .setDefaultMemberPermissions(
      OWNER_DEFAULT_PERMISSION,
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('add')
        .setDescription(
          'add XP',
        )
        .addUserOption((option) =>
          option
            .setName('user')
            .setDescription(
              'member',
            )
            .setRequired(true),
        )
        .addIntegerOption((option) =>
          option
            .setName('amount')
            .setDescription(
              'XP amount',
            )
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(10000000),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('remove')
        .setDescription(
          'remove XP',
        )
        .addUserOption((option) =>
          option
            .setName('user')
            .setDescription(
              'member',
            )
            .setRequired(true),
        )
        .addIntegerOption((option) =>
          option
            .setName('amount')
            .setDescription(
              'XP amount',
            )
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(10000000),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('set')
        .setDescription(
          'set exact XP',
        )
        .addUserOption((option) =>
          option
            .setName('user')
            .setDescription(
              'member',
            )
            .setRequired(true),
        )
        .addIntegerOption((option) =>
          option
            .setName('amount')
            .setDescription(
              'exact XP',
            )
            .setRequired(true)
            .setMinValue(0)
            .setMaxValue(100000000),
        ),
    ),

  new SlashCommandBuilder()
    .setName('synclevelroles')
    .setDescription(
      'owner: resync every member activity role',
    )
    .setDefaultMemberPermissions(
      OWNER_DEFAULT_PERMISSION,
    ),

  // ==========================================================================
  // OWNER MESSAGE TOOLS
  // ==========================================================================

  new SlashCommandBuilder()
    .setName('say')
    .setDescription(
      'owner: send a bot message',
    )
    .setDefaultMemberPermissions(
      OWNER_DEFAULT_PERMISSION,
    )
    .addChannelOption((option) =>
      option
        .setName('channel')
        .setDescription(
          'destination',
        )
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName('message')
        .setDescription(
          'message content',
        )
        .setRequired(true)
        .setMaxLength(2000),
    ),

  new SlashCommandBuilder()
    .setName('embedpost')
    .setDescription(
      'owner: post a custom archive embed',
    )
    .setDefaultMemberPermissions(
      OWNER_DEFAULT_PERMISSION,
    )
    .addChannelOption((option) =>
      option
        .setName('channel')
        .setDescription(
          'destination',
        )
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName('title')
        .setDescription(
          'embed title',
        )
        .setRequired(true)
        .setMaxLength(256),
    )
    .addStringOption((option) =>
      option
        .setName('description')
        .setDescription(
          'embed body',
        )
        .setRequired(true)
        .setMaxLength(4000),
    ),
].map((command) =>
  command.toJSON(),
);

// ============================================================================
// REGISTER GUILD COMMANDS
// ============================================================================

async function registerGuildCommands() {
  const token =
    process.env.DISCORD_TOKEN;

  if (!token) {
    throw new Error(
      'DISCORD_TOKEN is missing from .env',
    );
  }

  if (!client.user) {
    throw new Error(
      'Bot client is not ready.',
    );
  }

  const rest =
    new REST({
      version: '10',
    }).setToken(token);

  await rest.put(
    Routes.applicationGuildCommands(
      client.user.id,
      CONFIG.GUILD_ID,
    ),
    {
      body: commands,
    },
  );

  console.log(
    `[commands] registered ${commands.length} guild commands`,
  );
}

// ============================================================================
// INTERACTION MEMBER HELPERS
// ============================================================================

async function getInteractionMember(
  interaction,
) {
  if (!interaction.guild) {
    return null;
  }

  return interaction.guild.members
    .fetch(
      interaction.user.id,
    )
    .catch(() => null);
}

// ============================================================================
// OWNER SECURITY
// ============================================================================

async function requireOwner(
  interaction,
) {
  if (
    isOwner(
      interaction.user.id,
    )
  ) {
    return true;
  }

  if (
    interaction.isRepliable()
  ) {
    await interaction.reply({
      embeds: [
        errorEmbed(
          'owner whitelist only.',
        ),
      ],
      ephemeral: true,
    }).catch(() => null);
  }

  return false;
}

// ============================================================================
// STAFF SECURITY
// ============================================================================

async function requireStaff(
  interaction,
) {
  const member =
    await getInteractionMember(
      interaction,
    );

  if (
    member &&
    isStaff(member)
  ) {
    return member;
  }

  await interaction.reply({
    embeds: [
      errorEmbed(
        'staff only.',
      ),
    ],
    ephemeral: true,
  }).catch(() => null);

  return null;
}

// ============================================================================
// MANAGEMENT SECURITY
// ============================================================================

async function requireManagement(
  interaction,
) {
  const member =
    await getInteractionMember(
      interaction,
    );

  if (
    member &&
    isManagement(member)
  ) {
    return member;
  }

  await interaction.reply({
    embeds: [
      errorEmbed(
        'management only.',
      ),
    ],
    ephemeral: true,
  }).catch(() => null);

  return null;
}

// ============================================================================
// MODERATION TARGET SECURITY
// ============================================================================

function staffRankValue(member) {
  if (!member) {
    return 0;
  }

  if (isOwner(member.id)) {
    return 100;
  }

  if (
    member.roles.cache.has(
      CONFIG.ROLES.MANAGEMENT,
    )
  ) {
    return 90;
  }

  if (
    member.roles.cache.has(
      CONFIG.ROLES.ADMIN,
    )
  ) {
    return 80;
  }

  if (
    member.roles.cache.has(
      CONFIG.ROLES.SR_MOD,
    )
  ) {
    return 70;
  }

  if (
    member.roles.cache.has(
      CONFIG.ROLES.MOD,
    )
  ) {
    return 60;
  }

  if (
    member.roles.cache.has(
      CONFIG.ROLES.ASCENDANT,
    )
  ) {
    return 50;
  }

  return 0;
}

async function canModerateTarget(
  moderator,
  target,
) {
  if (!moderator || !target) {
    return false;
  }

  // Owner can manage everyone except Discord itself/bot hierarchy restrictions.
  if (
    isOwner(
      moderator.id,
    )
  ) {
    return true;
  }

  // Nobody except owner should moderate owner.
  if (
    isOwner(
      target.id,
    )
  ) {
    return false;
  }

  const moderatorRank =
    staffRankValue(
      moderator,
    );

  const targetRank =
    staffRankValue(
      target,
    );

  // Staff cannot punish equal/higher internal ranks.
  if (
    targetRank > 0 &&
    moderatorRank <= targetRank
  ) {
    return false;
  }

  // Also respect Discord role hierarchy.
  if (
    moderator.roles.highest.position <=
    target.roles.highest.position
  ) {
    return false;
  }

  return true;
}

// ============================================================================
// TICKET MODALS
// ============================================================================

function ticketModal(type) {
  const modal =
    new ModalBuilder()
      .setCustomId(
        `ticket_modal_${type}`,
      );

  // --------------------------------------------------------------------------
  // MEMBER REPORT
  // --------------------------------------------------------------------------

  if (
    type === 'report'
  ) {
    modal.setTitle(
      'member report',
    );

    modal.addComponents(
      new ActionRowBuilder()
        .addComponents(
          new TextInputBuilder()
            .setCustomId(
              'subject',
            )
            .setLabel(
              'who are you reporting?',
            )
            .setStyle(
              TextInputStyle.Short,
            )
            .setRequired(true)
            .setMaxLength(100),
        ),

      new ActionRowBuilder()
        .addComponents(
          new TextInputBuilder()
            .setCustomId(
              'details',
            )
            .setLabel(
              'what happened?',
            )
            .setStyle(
              TextInputStyle.Paragraph,
            )
            .setRequired(true)
            .setMaxLength(1800),
        ),

      new ActionRowBuilder()
        .addComponents(
          new TextInputBuilder()
            .setCustomId(
              'evidence',
            )
            .setLabel(
              'evidence / links (optional)',
            )
            .setStyle(
              TextInputStyle.Paragraph,
            )
            .setRequired(false)
            .setMaxLength(1000),
        ),
    );

    return modal;
  }

  // --------------------------------------------------------------------------
  // GENERAL SUPPORT
  // --------------------------------------------------------------------------

  if (
    type === 'support'
  ) {
    modal.setTitle(
      'general support',
    );

    modal.addComponents(
      new ActionRowBuilder()
        .addComponents(
          new TextInputBuilder()
            .setCustomId(
              'subject',
            )
            .setLabel(
              'short subject',
            )
            .setStyle(
              TextInputStyle.Short,
            )
            .setRequired(true)
            .setMaxLength(100),
        ),

      new ActionRowBuilder()
        .addComponents(
          new TextInputBuilder()
            .setCustomId(
              'details',
            )
            .setLabel(
              'what do you need help with?',
            )
            .setStyle(
              TextInputStyle.Paragraph,
            )
            .setRequired(true)
            .setMaxLength(1800),
        ),
    );

    return modal;
  }

  // --------------------------------------------------------------------------
  // OWNER REQUEST
  // --------------------------------------------------------------------------

  modal.setTitle(
    'owner request',
  );

  modal.addComponents(
    new ActionRowBuilder()
      .addComponents(
        new TextInputBuilder()
          .setCustomId(
            'subject',
          )
          .setLabel(
            'short subject',
          )
          .setStyle(
            TextInputStyle.Short,
          )
          .setRequired(true)
          .setMaxLength(100),
      ),

    new ActionRowBuilder()
      .addComponents(
        new TextInputBuilder()
          .setCustomId(
            'details',
          )
          .setLabel(
            'request / reason',
          )
          .setStyle(
            TextInputStyle.Paragraph,
          )
          .setRequired(true)
          .setMaxLength(1800),
      ),
  );

  return modal;
}

// ============================================================================
// TICKET CONTROL BUTTONS
// ============================================================================

function ticketControlRows() {
  const row =
    new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(
            'ticket_claim',
          )
          .setLabel(
            'claim',
          )
          .setStyle(
            ButtonStyle.Secondary,
          ),

        new ButtonBuilder()
          .setCustomId(
            'ticket_close',
          )
          .setLabel(
            'close',
          )
          .setStyle(
            ButtonStyle.Danger,
          ),
      );

  return [
    row,
  ];
}

// ============================================================================
// OPEN TICKET CHECK
// ============================================================================

function findExistingUserTicket(
  openerId,
  type,
) {
  return db.prepare(`
    SELECT *
    FROM tickets

    WHERE
      opener_id = ?
      AND type = ?
  `).get(
    openerId,
    type,
  );
}

// ============================================================================
// CREATE TICKET
// ============================================================================

async function createTicketChannel(
  interaction,
  type,
  subject,
  details,
  evidence = '',
) {
  const guild =
    interaction.guild;

  if (!guild) {
    return;
  }

  const opener =
    await guild.members.fetch(
      interaction.user.id,
    );

  // --------------------------------------------------------------------------
  // STOP DUPLICATE TICKETS OF SAME TYPE
  // --------------------------------------------------------------------------

  const existing =
    findExistingUserTicket(
      opener.id,
      type,
    );

  if (existing) {
    const existingChannel =
      await guild.channels
        .fetch(
          existing.channel_id,
        )
        .catch(() => null);

    if (existingChannel) {
      await interaction.reply({
        content:
          `you already have an open **${type}** ticket: ${existingChannel}`,
        ephemeral: true,
      });

      return;
    }

    // DB record exists but channel doesn't.
    sql.deleteTicket.run(
      existing.channel_id,
    );
  }

  // --------------------------------------------------------------------------
  // FIND TICKET CATEGORY
  // --------------------------------------------------------------------------

  const ticketPanelChannel =
    await guild.channels
      .fetch(
        CONFIG.CHANNELS.TICKETS,
      )
      .catch(() => null);

  const parentId =
    ticketPanelChannel?.parentId ||
    null;

  // --------------------------------------------------------------------------
  // BASE PERMISSION OVERWRITES
  // --------------------------------------------------------------------------

  const permissionOverwrites = [
    {
      id: guild.roles.everyone.id,

      deny: [
        PermissionFlagsBits.ViewChannel,
      ],
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
        PermissionFlagsBits.ManageChannels,
        PermissionFlagsBits.ManageMessages,
        PermissionFlagsBits.ReadMessageHistory,
      ],
    },
  ];

  // --------------------------------------------------------------------------
  // HELPER FOR STAFF OVERWRITES
  // --------------------------------------------------------------------------

  const addRoleOverwrite = (
    roleId,
  ) => {
    if (!roleId) {
      return;
    }

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

  // --------------------------------------------------------------------------
  // OWNER REQUEST
  //
  // Intentionally more private than normal staff tickets.
  // --------------------------------------------------------------------------

  if (
    type === 'owner'
  ) {
    permissionOverwrites.push({
      id: CONFIG.OWNER_IDS[0],

      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
      ],
    });

    addRoleOverwrite(
      CONFIG.ROLES.MANAGEMENT,
    );
  } else {
    // Normal support/report tickets visible to all configured staff.
    for (
      const roleId
      of STAFF_ROLE_IDS
    ) {
      addRoleOverwrite(
        roleId,
      );
    }
  }

  // --------------------------------------------------------------------------
  // GENERATE CHANNEL NAME
  // --------------------------------------------------------------------------

  const suffix =
    Math.random()
      .toString(36)
      .slice(2, 6);

  const safeUsername =
    sanitizeChannelName(
      opener.user.username,
    );

  const channelName =
    `${type}-${safeUsername}-${suffix}`;

  // --------------------------------------------------------------------------
  // CREATE CHANNEL
  // --------------------------------------------------------------------------

  const channel =
    await guild.channels.create({
      name:
        sanitizeChannelName(
          channelName,
        ),

      type:
        ChannelType.GuildText,

      parent:
        parentId,

      permissionOverwrites,

      topic:
        `kvsarchive ticket | opener:${opener.id} | type:${type}`,

      reason:
        `Ticket opened by ${opener.user.tag}`,
    });

  // --------------------------------------------------------------------------
  // TRACK
  // --------------------------------------------------------------------------

  sql.addTicket.run(
    channel.id,
    opener.id,
    type,
    Date.now(),
  );

  // --------------------------------------------------------------------------
  // INITIAL TICKET EMBED
  // --------------------------------------------------------------------------

  let ticketTitle =
    'general support';

  if (
    type === 'report'
  ) {
    ticketTitle =
      'member report';
  }

  if (
    type === 'owner'
  ) {
    ticketTitle =
      'owner request';
  }

  const embed =
    baseEmbed()
      .setTitle(
        `🛠️ ${ticketTitle}`,
      )
      .setDescription(
        `${opener} opened this ticket.`,
      )
      .addFields(
        {
          name: 'subject',
          value: truncate(
            subject,
            1000,
          ),
        },

        {
          name: 'details',
          value: truncate(
            details,
            1000,
          ),
        },
      );

  if (evidence) {
    embed.addFields({
      name: 'evidence',
      value: truncate(
        evidence,
        1000,
      ),
    });
  }

  // --------------------------------------------------------------------------
  // SEND
  // --------------------------------------------------------------------------

  await channel.send({
    content:
      `${opener}`,

    embeds: [
      embed,
    ],

    components:
      ticketControlRows(),
  });

  // --------------------------------------------------------------------------
  // CONFIRM PRIVATELY
  // --------------------------------------------------------------------------

  await interaction.reply({
    content:
      `ticket created: ${channel}`,
    ephemeral: true,
  });

  // --------------------------------------------------------------------------
  // LOG
  // --------------------------------------------------------------------------

  await logEvent(
    'ticket opened',
    `${opener.user.tag} opened a **${type}** ticket: ${channel}.`,
  );
}

// ============================================================================
// STAFF APPLICATION MODAL
// ============================================================================

function staffApplicationModal() {
  return new ModalBuilder()
    .setCustomId(
      'staffapp_modal',
    )
    .setTitle(
      'staff application',
    )
    .addComponents(
      new ActionRowBuilder()
        .addComponents(
          new TextInputBuilder()
            .setCustomId(
              'age',
            )
            .setLabel(
              'age',
            )
            .setStyle(
              TextInputStyle.Short,
            )
            .setRequired(true)
            .setMaxLength(20),
        ),

      new ActionRowBuilder()
        .addComponents(
          new TextInputBuilder()
            .setCustomId(
              'timezone',
            )
            .setLabel(
              'timezone',
            )
            .setStyle(
              TextInputStyle.Short,
            )
            .setRequired(true)
            .setMaxLength(60),
        ),

      new ActionRowBuilder()
        .addComponents(
          new TextInputBuilder()
            .setCustomId(
              'experience',
            )
            .setLabel(
              'moderation experience',
            )
            .setStyle(
              TextInputStyle.Paragraph,
            )
            .setRequired(true)
            .setMaxLength(1000),
        ),

      new ActionRowBuilder()
        .addComponents(
          new TextInputBuilder()
            .setCustomId(
              'why',
            )
            .setLabel(
              'why should we pick you?',
            )
            .setStyle(
              TextInputStyle.Paragraph,
            )
            .setRequired(true)
            .setMaxLength(1000),
        ),

      new ActionRowBuilder()
        .addComponents(
          new TextInputBuilder()
            .setCustomId(
              'availability',
            )
            .setLabel(
              'availability',
            )
            .setStyle(
              TextInputStyle.Paragraph,
            )
            .setRequired(true)
            .setMaxLength(500),
        ),
    );
}

// ============================================================================
// CREATE STAFF APPLICATION TICKET
// ============================================================================

async function createStaffApplication(
  interaction,
  answers,
) {
  const guild =
    interaction.guild;

  if (!guild) {
    return;
  }

  const applicant =
    await guild.members.fetch(
      interaction.user.id,
    );

  // --------------------------------------------------------------------------
  // DUPLICATE CHECK
  // --------------------------------------------------------------------------

  const existing =
    findExistingUserTicket(
      applicant.id,
      'staff_application',
    );

  if (existing) {
    const existingChannel =
      await guild.channels
        .fetch(
          existing.channel_id,
        )
        .catch(() => null);

    if (existingChannel) {
      await interaction.reply({
        content:
          `you already have a staff application open: ${existingChannel}`,
        ephemeral: true,
      });

      return;
    }

    sql.deleteTicket.run(
      existing.channel_id,
    );
  }

  // --------------------------------------------------------------------------
  // FIND CATEGORY
  // --------------------------------------------------------------------------

  const ticketsChannel =
    await guild.channels
      .fetch(
        CONFIG.CHANNELS.TICKETS,
      )
      .catch(() => null);

  const parentId =
    ticketsChannel?.parentId ||
    null;

  // --------------------------------------------------------------------------
  // PERMISSIONS
  // --------------------------------------------------------------------------

  const permissionOverwrites = [
    {
      id:
        guild.roles.everyone.id,

      deny: [
        PermissionFlagsBits.ViewChannel,
      ],
    },

    {
      id:
        applicant.id,

      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
      ],
    },

    {
      id:
        client.user.id,

      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ManageChannels,
        PermissionFlagsBits.ManageMessages,
      ],
    },

    {
      id:
        CONFIG.OWNER_IDS[0],

      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
      ],
    },

    {
      id:
        CONFIG.ROLES.MANAGEMENT,

      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
      ],
    },

    {
      id:
        CONFIG.ROLES.ADMIN,

      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
      ],
    },
  ];

  // --------------------------------------------------------------------------
  // CREATE
  // --------------------------------------------------------------------------

  const suffix =
    Math.random()
      .toString(36)
      .slice(2, 6);

  const channel =
    await guild.channels.create({
      name:
        sanitizeChannelName(
          `staff-app-${applicant.user.username}-${suffix}`,
        ),

      type:
        ChannelType.GuildText,

      parent:
        parentId,

      permissionOverwrites,

      topic:
        `kvsarchive staff application | opener:${applicant.id}`,

      reason:
        `Staff application from ${applicant.user.tag}`,
    });

  // --------------------------------------------------------------------------
  // SAVE AS TICKET
  // --------------------------------------------------------------------------

  sql.addTicket.run(
    channel.id,
    applicant.id,
    'staff_application',
    Date.now(),
  );

  // --------------------------------------------------------------------------
  // APPLICATION EMBED
  // --------------------------------------------------------------------------

  const embed =
    baseEmbed()
      .setTitle(
        '⛧ staff application',
      )
      .setDescription(
        `${applicant} submitted a staff application.`,
      )
      .setThumbnail(
        applicant.user.displayAvatarURL({
          size: 256,
        }),
      )
      .addFields(
        {
          name: 'age',
          value: truncate(
            answers.age,
          ),
        },

        {
          name: 'timezone',
          value: truncate(
            answers.timezone,
          ),
        },

        {
          name: 'experience',
          value: truncate(
            answers.experience,
          ),
        },

        {
          name: 'why you?',
          value: truncate(
            answers.why,
          ),
        },

        {
          name: 'availability',
          value: truncate(
            answers.availability,
          ),
        },
      );

  // --------------------------------------------------------------------------
  // SEND
  // --------------------------------------------------------------------------

  await channel.send({
    content:
      `${applicant} <@${CONFIG.OWNER_IDS[0]}>`,

    embeds: [
      embed,
    ],

    components:
      ticketControlRows(),
  });

  // --------------------------------------------------------------------------
  // CONFIRM
  // --------------------------------------------------------------------------

  await interaction.reply({
    content:
      `application submitted: ${channel}`,
    ephemeral: true,
  });

  await logEvent(
    'staff application',
    `${applicant.user.tag} submitted ${channel}.`,
  );
}

// ============================================================================
// PRIVATE CLUB SYSTEM
// ============================================================================

// ============================================================================
// FIND OWNED CLUB
// ============================================================================

async function findOwnedClub(
  guild,
  userId,
) {
  const record =
    sql.getClubByOwner.get(
      userId,
    );

  if (!record) {
    return null;
  }

  const channel =
    await guild.channels
      .fetch(
        record.channel_id,
      )
      .catch(() => null);

  // Club record exists but Discord channel is gone.
  if (!channel) {
    sql.deleteClubByOwner.run(
      userId,
    );

    return null;
  }

  return {
    record,
    channel,
  };
}

// ============================================================================
// CREATE PRIVATE CLUB
// ============================================================================

async function createPrivateClub(
  member,
  triggerChannel,
) {
  const guild =
    member.guild;

  // --------------------------------------------------------------------------
  // ONE CLUB PER OWNER
  // --------------------------------------------------------------------------

  const existing =
    await findOwnedClub(
      guild,
      member.id,
    );

  if (existing) {
    // If they already own one, move them into it.
    if (
      member.voice.channelId !==
      existing.channel.id
    ) {
      await member.voice
        .setChannel(
          existing.channel,
        )
        .catch(() => null);
    }

    return existing.channel;
  }

  // --------------------------------------------------------------------------
  // CLEAN OWNER NAME
  // --------------------------------------------------------------------------

  const cleanOwnerName =
    sanitizeChannelName(
      member.displayName,
    ).slice(
      0,
      35,
    );

  // --------------------------------------------------------------------------
  // CREATE VOICE CHANNEL
  // --------------------------------------------------------------------------

  const channel =
    await guild.channels.create({
      name:
        `${CONFIG.PRIVATE_CLUBS.PREFIX}${cleanOwnerName}`,

      type:
        ChannelType.GuildVoice,

      parent:
        triggerChannel.parentId ||
        null,

      bitrate:
        Math.min(
          triggerChannel.bitrate ||
          64000,

          guild.maximumBitrate ||
          96000,
        ),

      userLimit:
        0,

      reason:
        `Private club created for ${member.user.tag}`,
    });

  // --------------------------------------------------------------------------
  // OWNER ACCESS
  //
  // We intentionally DO NOT give ManageChannels.
  //
  // They control the channel through our bot interface instead.
  // This prevents abuse while still letting them fully operate their club.
  // --------------------------------------------------------------------------

  await channel.permissionOverwrites
    .edit(
      member.id,
      {
        ViewChannel: true,
        Connect: true,
        Speak: true,
        Stream: true,
        UseVAD: true,
      },
    )
    .catch(() => null);

  // --------------------------------------------------------------------------
  // VERIFIED MEMBERS DEFAULT ACCESS
  //
  // Clubs start public.
  // Owner can lock/hide later.
  // --------------------------------------------------------------------------

  await channel.permissionOverwrites
    .edit(
      CONFIG.ROLES.MEMBER,
      {
        ViewChannel: true,
        Connect: true,
      },
    )
    .catch(() => null);

  // --------------------------------------------------------------------------
  // STAFF ALWAYS RETAIN ACCESS
  // --------------------------------------------------------------------------

  for (
    const roleId
    of STAFF_ROLE_IDS
  ) {
    await channel.permissionOverwrites
      .edit(
        roleId,
        {
          ViewChannel: true,
          Connect: true,
        },
      )
      .catch(() => null);
  }

  // --------------------------------------------------------------------------
  // BOT ACCESS
  // --------------------------------------------------------------------------

  await channel.permissionOverwrites
    .edit(
      client.user.id,
      {
        ViewChannel: true,
        Connect: true,
        ManageChannels: true,
        MoveMembers: true,
      },
    )
    .catch(() => null);

  // --------------------------------------------------------------------------
  // SAVE DATABASE RECORD
  // --------------------------------------------------------------------------

  sql.addClub.run(
    channel.id,
    member.id,
    Date.now(),
  );

  // --------------------------------------------------------------------------
  // MOVE CREATOR
  // --------------------------------------------------------------------------

  await member.voice
    .setChannel(
      channel,
    )
    .catch(() => null);

  // --------------------------------------------------------------------------
  // LOG
  // --------------------------------------------------------------------------

  await logEvent(
    'private club created',
    `${member.user.tag} created <#${channel.id}>.`,
  );

  return channel;
}

// ============================================================================
// TEMP CLUB CLEANUP
// ============================================================================

function scheduleClubDeletion(
  channel,
) {
  // Cancel old timer first.
  if (
    pendingClubDeletes.has(
      channel.id,
    )
  ) {
    clearTimeout(
      pendingClubDeletes.get(
        channel.id,
      ),
    );
  }

  const timer =
    setTimeout(
      async () => {
        pendingClubDeletes.delete(
          channel.id,
        );

        const freshChannel =
          await channel.guild.channels
            .fetch(
              channel.id,
            )
            .catch(() => null);

        // Already deleted.
        if (!freshChannel) {
          sql.deleteClubByChannel.run(
            channel.id,
          );

          return;
        }

        // Not voice.
        if (
          freshChannel.type !==
          ChannelType.GuildVoice
        ) {
          return;
        }

        // Somebody came back.
        if (
          freshChannel.members.size > 0
        ) {
          return;
        }

        const record =
          sql.getClubByChannel.get(
            freshChannel.id,
          );

        sql.deleteClubByChannel.run(
          freshChannel.id,
        );

        await logEvent(
          'private club deleted',
          record
            ? `<#${freshChannel.id}> owned by <@${record.owner_id}> expired after becoming empty.`
            : `<#${freshChannel.id}> expired after becoming empty.`,
        );

        await freshChannel
          .delete(
            'Temporary private club became empty',
          )
          .catch(() => null);
      },

      CONFIG.PRIVATE_CLUBS
        .EMPTY_DELETE_DELAY_MS,
    );

  pendingClubDeletes.set(
    channel.id,
    timer,
  );
}

// ============================================================================
// GET OWNED CLUB OR ERROR
// ============================================================================

async function getOwnedClubOrReply(
  interaction,
) {
  const owned =
    await findOwnedClub(
      interaction.guild,
      interaction.user.id,
    );

  if (!owned) {
    await interaction.reply({
      content:
        `you don't own a private club. join <#${CONFIG.CHANNELS.CREATE_PRIVATE_CLUB}> first.`,
      ephemeral: true,
    });

    return null;
  }

  return owned;
}

// ============================================================================
// CLUB RENAME MODAL
// ============================================================================

function clubRenameModal(
  channelName,
) {
  let currentName =
    channelName;

  if (
    currentName.startsWith(
      CONFIG.PRIVATE_CLUBS.PREFIX,
    )
  ) {
    currentName =
      currentName.slice(
        CONFIG.PRIVATE_CLUBS.PREFIX.length,
      );
  }

  return new ModalBuilder()
    .setCustomId(
      'club_modal_rename',
    )
    .setTitle(
      'rename private club',
    )
    .addComponents(
      new ActionRowBuilder()
        .addComponents(
          new TextInputBuilder()
            .setCustomId(
              'name',
            )
            .setLabel(
              'new club name',
            )
            .setStyle(
              TextInputStyle.Short,
            )
            .setRequired(true)
            .setMaxLength(70)
            .setValue(
              currentName.slice(
                0,
                70,
              ),
            ),
        ),
    );
}

// ============================================================================
// CLUB USER LIMIT MODAL
// ============================================================================

function clubLimitModal(
  currentLimit,
) {
  return new ModalBuilder()
    .setCustomId(
      'club_modal_limit',
    )
    .setTitle(
      'private club limit',
    )
    .addComponents(
      new ActionRowBuilder()
        .addComponents(
          new TextInputBuilder()
            .setCustomId(
              'limit',
            )
            .setLabel(
              '0 = unlimited, otherwise 1-99',
            )
            .setStyle(
              TextInputStyle.Short,
            )
            .setRequired(true)
            .setMaxLength(2)
            .setValue(
              String(
                currentLimit ||
                0,
              ),
            ),
        ),
    );
}

// ============================================================================
// CLUB USER SELECT MENU
// ============================================================================

async function sendClubUserSelect(
  interaction,
  action,
) {
  const labels = {
    allow:
      'choose a user to permit',

    block:
      'choose a user to block',

    transfer:
      'choose the new owner',
  };

  const menu =
    new UserSelectMenuBuilder()
      .setCustomId(
        `club_user_${action}`,
      )
      .setPlaceholder(
        labels[action],
      )
      .setMinValues(
        1,
      )
      .setMaxValues(
        1,
      );

  const row =
    new ActionRowBuilder()
      .addComponents(
        menu,
      );

  await interaction.reply({
    content:
      labels[action],

    components: [
      row,
    ],

    ephemeral: true,
  });
}

// ============================================================================
// CLUB LOCK
// ============================================================================

async function toggleClubLock(
  channel,
  record,
) {
  const newLockedState =
    record.locked
      ? 0
      : 1;

  // If locked:
  // MEMBER role loses Connect.
  //
  // If unlocked:
  // MEMBER is explicitly allowed Connect.
  await channel.permissionOverwrites
    .edit(
      CONFIG.ROLES.MEMBER,
      {
        Connect:
          newLockedState
            ? false
            : true,
      },
    );

  sql.setClubLocked.run(
    newLockedState,
    channel.id,
  );

  return Boolean(
    newLockedState,
  );
}

// ============================================================================
// CLUB HIDE
// ============================================================================

async function toggleClubHidden(
  channel,
  record,
) {
  const newHiddenState =
    record.hidden
      ? 0
      : 1;

  await channel.permissionOverwrites
    .edit(
      CONFIG.ROLES.MEMBER,
      {
        ViewChannel:
          newHiddenState
            ? false
            : true,
      },
    );

  sql.setClubHidden.run(
    newHiddenState,
    channel.id,
  );

  return Boolean(
    newHiddenState,
  );
}

// ============================================================================
// CLUB INFO EMBED
// ============================================================================

function clubInfoEmbed(
  record,
  channel,
) {
  return baseEmbed()
    .setTitle(
      '𖤐 your private club',
    )
    .setDescription(
      `<#${channel.id}>`,
    )
    .addFields(
      {
        name:
          'owner',

        value:
          `<@${record.owner_id}>`,

        inline:
          true,
      },

      {
        name:
          'locked',

        value:
          record.locked
            ? 'yes'
            : 'no',

        inline:
          true,
      },

      {
        name:
          'hidden',

        value:
          record.hidden
            ? 'yes'
            : 'no',

        inline:
          true,
      },

      {
        name:
          'user limit',

        value:
          channel.userLimit
            ? String(
                channel.userLimit,
              )
            : 'unlimited',

        inline:
          true,
      },

      {
        name:
          'connected',

        value:
          String(
            channel.members.size,
          ),

        inline:
          true,
      },

      {
        name:
          'created',

        value:
          `<t:${Math.floor(
            record.created_at /
            1000,
          )}:R>`,

        inline:
          true,
      },
    );
}

// ============================================================================
// DELETE CLUB
// ============================================================================

async function deletePrivateClub(
  channel,
  reason,
) {
  const record =
    sql.getClubByChannel.get(
      channel.id,
    );

  if (
    pendingClubDeletes.has(
      channel.id,
    )
  ) {
    clearTimeout(
      pendingClubDeletes.get(
        channel.id,
      ),
    );

    pendingClubDeletes.delete(
      channel.id,
    );
  }

  sql.deleteClubByChannel.run(
    channel.id,
  );

  await logEvent(
    'private club deleted',
    record
      ? `<#${channel.id}> owned by <@${record.owner_id}> was deleted.`
      : `<#${channel.id}> was deleted.`,
  );

  await channel
    .delete(reason)
    .catch(() => null);
}

// ============================================================================
// CLUB OWNERSHIP TRANSFER
// ============================================================================

async function transferPrivateClub(
  channel,
  oldOwnerId,
  newOwnerId,
) {
  // --------------------------------------------------------------------------
  // OLD OWNER
  //
  // Delete their special overwrite.
  // They fall back to normal MEMBER permissions.
  // --------------------------------------------------------------------------

  await channel.permissionOverwrites
    .delete(
      oldOwnerId,
    )
    .catch(() => null);

  // --------------------------------------------------------------------------
  // NEW OWNER
  // --------------------------------------------------------------------------

  await channel.permissionOverwrites
    .edit(
      newOwnerId,
      {
        ViewChannel:
          true,

        Connect:
          true,

        Speak:
          true,

        Stream:
          true,

        UseVAD:
          true,
      },
    )
    .catch(() => null);

  // --------------------------------------------------------------------------
  // DATABASE
  // --------------------------------------------------------------------------

  sql.transferClub.run(
    newOwnerId,
    channel.id,
  );

  await logEvent(
    'club ownership transfer',
    `<@${oldOwnerId}> transferred <#${channel.id}> to <@${newOwnerId}>.`,
  );
}

// ============================================================================
// PRIVATE CLUB INTERACTION HANDLER
// ============================================================================

async function handleClubButton(
  interaction,
) {
  const owned =
    await getOwnedClubOrReply(
      interaction,
    );

  if (!owned) {
    return;
  }

  // Always refetch record because lock/hide values may have changed.
  const record =
    sql.getClubByChannel.get(
      owned.channel.id,
    );

  const channel =
    owned.channel;

  // --------------------------------------------------------------------------
  // RENAME
  // --------------------------------------------------------------------------

  if (
    interaction.customId ===
    'club_rename'
  ) {
    await interaction.showModal(
      clubRenameModal(
        channel.name,
      ),
    );

    return;
  }

  // --------------------------------------------------------------------------
  // LIMIT
  // --------------------------------------------------------------------------

  if (
    interaction.customId ===
    'club_limit'
  ) {
    await interaction.showModal(
      clubLimitModal(
        channel.userLimit,
      ),
    );

    return;
  }

  // --------------------------------------------------------------------------
  // ALLOW USER
  // --------------------------------------------------------------------------

  if (
    interaction.customId ===
    'club_allow'
  ) {
    await sendClubUserSelect(
      interaction,
      'allow',
    );

    return;
  }

  // --------------------------------------------------------------------------
  // BLOCK USER
  // --------------------------------------------------------------------------

  if (
    interaction.customId ===
    'club_block'
  ) {
    await sendClubUserSelect(
      interaction,
      'block',
    );

    return;
  }

  // --------------------------------------------------------------------------
  // TRANSFER
  // --------------------------------------------------------------------------

  if (
    interaction.customId ===
    'club_transfer'
  ) {
    await sendClubUserSelect(
      interaction,
      'transfer',
    );

    return;
  }

  // --------------------------------------------------------------------------
  // LOCK
  // --------------------------------------------------------------------------

  if (
    interaction.customId ===
    'club_lock'
  ) {
    const locked =
      await toggleClubLock(
        channel,
        record,
      );

    await interaction.reply({
      content:
        locked
          ? 'club locked.'
          : 'club unlocked.',

      ephemeral:
        true,
    });

    return;
  }

  // --------------------------------------------------------------------------
  // HIDE
  // --------------------------------------------------------------------------

  if (
    interaction.customId ===
    'club_hide'
  ) {
    const hidden =
      await toggleClubHidden(
        channel,
        record,
      );

    await interaction.reply({
      content:
        hidden
          ? 'club hidden.'
          : 'club visible.',

      ephemeral:
        true,
    });

    return;
  }

  // --------------------------------------------------------------------------
  // INFO
  // --------------------------------------------------------------------------

  if (
    interaction.customId ===
    'club_info'
  ) {
    const freshRecord =
      sql.getClubByChannel.get(
        channel.id,
      );

    await interaction.reply({
      embeds: [
        clubInfoEmbed(
          freshRecord,
          channel,
        ),
      ],

      ephemeral:
        true,
    });

    return;
  }

  // --------------------------------------------------------------------------
  // DELETE PROMPT
  // --------------------------------------------------------------------------

  if (
    interaction.customId ===
    'club_delete'
  ) {
    const confirmRow =
      new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId(
              'club_confirm_delete',
            )
            .setLabel(
              'confirm delete',
            )
            .setStyle(
              ButtonStyle.Danger,
            ),

          new ButtonBuilder()
            .setCustomId(
              'club_cancel_delete',
            )
            .setLabel(
              'cancel',
            )
            .setStyle(
              ButtonStyle.Secondary,
            ),
        );

    await interaction.reply({
      content:
        `delete <#${channel.id}>?`,

      components: [
        confirmRow,
      ],

      ephemeral:
        true,
    });

    return;
  }

  // --------------------------------------------------------------------------
  // CONFIRM DELETE
  // --------------------------------------------------------------------------

  if (
    interaction.customId ===
    'club_confirm_delete'
  ) {
    await interaction.update({
      content:
        'club deleted.',

      components: [],
    }).catch(() => null);

    await deletePrivateClub(
      channel,
      `Deleted by club owner ${interaction.user.tag}`,
    );

    return;
  }

  // --------------------------------------------------------------------------
  // CANCEL DELETE
  // --------------------------------------------------------------------------

  if (
    interaction.customId ===
    'club_cancel_delete'
  ) {
    await interaction.update({
      content:
        'cancelled.',

      components: [],
    });

    return;
  }
}

// ============================================================================
// CLUB USER SELECT HANDLER
// ============================================================================

async function handleClubUserSelect(
  interaction,
) {
  const action =
    interaction.customId.replace(
      'club_user_',
      '',
    );

  const owned =
    await findOwnedClub(
      interaction.guild,
      interaction.user.id,
    );

  if (!owned) {
    await interaction.update({
      content:
        'you no longer own a private club.',

      components: [],
    });

    return;
  }

  const targetId =
    interaction.values[0];

  const channel =
    owned.channel;

  // --------------------------------------------------------------------------
  // BASIC TARGET VALIDATION
  // --------------------------------------------------------------------------

  if (
    targetId ===
      interaction.user.id &&
    action !== 'allow'
  ) {
    await interaction.update({
      content:
        `you can't ${action} yourself.`,

      components: [],
    });

    return;
  }

  const target =
    await interaction.guild.members
      .fetch(
        targetId,
      )
      .catch(() => null);

  if (
    !target ||
    target.user.bot
  ) {
    await interaction.update({
      content:
        'choose a real server member.',

      components: [],
    });

    return;
  }

  // --------------------------------------------------------------------------
  // NEVER ALLOW CLUB OWNERS TO BLOCK STAFF
  // --------------------------------------------------------------------------

  if (
    action === 'block' &&
    isStaff(target)
  ) {
    await interaction.update({
      content:
        'staff cannot be blocked from private clubs.',

      components: [],
    });

    return;
  }

  // --------------------------------------------------------------------------
  // PERMIT
  // --------------------------------------------------------------------------

  if (
    action === 'allow'
  ) {
    await channel.permissionOverwrites
      .edit(
        targetId,
        {
          ViewChannel:
            true,

          Connect:
            true,
        },
      )
      .catch(() => null);

    await interaction.update({
      content:
        `${target} is permitted.`,

      components: [],
    });

    return;
  }

  // --------------------------------------------------------------------------
  // BLOCK
  // --------------------------------------------------------------------------

  if (
    action === 'block'
  ) {
    await channel.permissionOverwrites
      .edit(
        targetId,
        {
          ViewChannel:
            false,

          Connect:
            false,
        },
      )
      .catch(() => null);

    // Kick them from VC if currently connected.
    if (
      target.voice.channelId ===
      channel.id
    ) {
      await target.voice
        .disconnect(
          'Blocked from private club',
        )
        .catch(() => null);
    }

    await interaction.update({
      content:
        `${target} is blocked.`,

      components: [],
    });

    return;
  }

  // --------------------------------------------------------------------------
  // TRANSFER
  // --------------------------------------------------------------------------

  if (
    action === 'transfer'
  ) {
    const alreadyOwnsClub =
      sql.getClubByOwner.get(
        targetId,
      );

    if (alreadyOwnsClub) {
      await interaction.update({
        content:
          'that user already owns another private club.',

        components: [],
      });

      return;
    }

    await transferPrivateClub(
      channel,
      interaction.user.id,
      targetId,
    );

    await interaction.update({
      content:
        `ownership transferred to ${target}.`,

      components: [],
    });

    return;
  }
}

// ============================================================================
// CLUB RENAME SUBMISSION
// ============================================================================

async function handleClubRenameModal(
  interaction,
) {
  const owned =
    await findOwnedClub(
      interaction.guild,
      interaction.user.id,
    );

  if (!owned) {
    await interaction.reply({
      content:
        'you no longer own a private club.',

      ephemeral:
        true,
    });

    return;
  }

  const rawName =
    interaction.fields
      .getTextInputValue(
        'name',
      );

  const safeName =
    sanitizeChannelName(
      rawName,
    );

  const newName =
    `${CONFIG.PRIVATE_CLUBS.PREFIX}${safeName}`
      .slice(
        0,
        100,
      );

  await owned.channel.setName(
    newName,
    `Renamed by club owner ${interaction.user.tag}`,
  );

  await interaction.reply({
    content:
      `club renamed to **${newName}**.`,

    ephemeral:
      true,
  });
}

// ============================================================================
// CLUB LIMIT SUBMISSION
// ============================================================================

async function handleClubLimitModal(
  interaction,
) {
  const owned =
    await findOwnedClub(
      interaction.guild,
      interaction.user.id,
    );

  if (!owned) {
    await interaction.reply({
      content:
        'you no longer own a private club.',

      ephemeral:
        true,
    });

    return;
  }

  const raw =
    interaction.fields
      .getTextInputValue(
        'limit',
      )
      .trim();

  const limit =
    Number(raw);

  if (
    !Number.isInteger(limit) ||
    limit < 0 ||
    limit > 99
  ) {
    await interaction.reply({
      content:
        'user limit must be a whole number from **0-99**.',

      ephemeral:
        true,
    });

    return;
  }

  await owned.channel
    .setUserLimit(
      limit,
      `Changed by club owner ${interaction.user.tag}`,
    );

  await interaction.reply({
    content:
      limit === 0
        ? 'user limit removed.'
        : `user limit set to **${limit}**.`,

    ephemeral:
      true,
  });
}

// ============================================================================
// PART 3
// LIVE SERVER EVENTS / ACTIVITY / VERIFICATION / ROUTER
// ============================================================================

// ============================================================================
// READY EVENT
// ============================================================================

client.once(
  Events.ClientReady,
  async (readyClient) => {
    console.log(
      `[ready] logged in as ${readyClient.user.tag}`,
    );

    // ------------------------------------------------------------------------
    // REGISTER GUILD COMMANDS
    // ------------------------------------------------------------------------

    try {
      await registerGuildCommands();

      console.log(
        '[ready] slash commands synced',
      );
    } catch (error) {
      console.error(
        '[command registration error]',
        error,
      );
    }

    // ------------------------------------------------------------------------
    // PRESENCE
    // ------------------------------------------------------------------------

    await readyClient.user
      .setPresence({
        activities: [
          {
            name: 'kvsarchive',
          },
        ],

        status: 'dnd',
      })
      .catch(() => null);

    // ------------------------------------------------------------------------
    // RESTORE TEMP CLUB STATE AFTER RESTART
    //
    // If the bot restarts while a temporary club exists:
    // - keep populated clubs
    // - remove stale DB records
    // - schedule empty clubs for deletion
    // ------------------------------------------------------------------------

    const guild =
      await fetchGuild()
        .catch(() => null);

    if (guild) {
      const clubRows =
        db.prepare(`
          SELECT *
          FROM temp_clubs
        `).all();

      for (
        const record
        of clubRows
      ) {
        const channel =
          await guild.channels
            .fetch(
              record.channel_id,
            )
            .catch(() => null);

        if (!channel) {
          sql.deleteClubByChannel.run(
            record.channel_id,
          );

          continue;
        }

        if (
          channel.type ===
            ChannelType.GuildVoice &&
          channel.members.size === 0
        ) {
          scheduleClubDeletion(
            channel,
          );
        }
      }
    }

    console.log(
      '[ready] kvsarchive systems online',
    );
  },
);

// ============================================================================
// MEMBER JOIN
// ============================================================================

client.on(
  Events.GuildMemberAdd,
  async (member) => {
    if (
      member.guild.id !==
      CONFIG.GUILD_ID
    ) {
      return;
    }

    if (
      member.user.bot
    ) {
      return;
    }

    // ------------------------------------------------------------------------
    // DATABASE USER
    // ------------------------------------------------------------------------

    sql.ensureUser.run(
      member.id,
    );

    // ------------------------------------------------------------------------
    // GIVE UNVERIFIED / VERIFY ROLE
    //
    // This role should be configured in Discord so it only sees:
    //
    // 00
    // #verify
    //
    // The bot will remove this role after captcha completion.
    // ------------------------------------------------------------------------

    if (
      !member.roles.cache.has(
        CONFIG.ROLES.VERIFY,
      )
    ) {
      await member.roles
        .add(
          CONFIG.ROLES.VERIFY,
          'Waiting for kvsarchive verification',
        )
        .catch((error) => {
          console.error(
            '[join verify role]',
            error,
          );
        });
    }

    // ------------------------------------------------------------------------
    // LOG
    // ------------------------------------------------------------------------

    await logEvent(
      'member joined',
      [
        `${member.user.tag}`,
        `id: \`${member.id}\``,
        `account: <t:${Math.floor(
          member.user.createdTimestamp /
          1000,
        )}:R>`,
      ].join('\n'),
    );
  },
);

// ============================================================================
// MEMBER LEAVE
// ============================================================================

client.on(
  Events.GuildMemberRemove,
  async (member) => {
    if (
      member.guild.id !==
      CONFIG.GUILD_ID
    ) {
      return;
    }

    // ------------------------------------------------------------------------
    // DELETE PRIVATE CLUB IF LEAVING MEMBER OWNED ONE
    // ------------------------------------------------------------------------

    const ownedClub =
      sql.getClubByOwner.get(
        member.id,
      );

    if (ownedClub) {
      const channel =
        await member.guild.channels
          .fetch(
            ownedClub.channel_id,
          )
          .catch(() => null);

      sql.deleteClubByOwner.run(
        member.id,
      );

      if (channel) {
        await channel
          .delete(
            'Private club owner left server',
          )
          .catch(() => null);
      }
    }

    // ------------------------------------------------------------------------
    // CLEAR PENDING CAPTCHA
    // ------------------------------------------------------------------------

    sql.deleteVerifyCode.run(
      member.id,
    );

    // ------------------------------------------------------------------------
    // LOG
    // ------------------------------------------------------------------------

    await logEvent(
      'member left',
      [
        `${member.user.tag}`,
        `id: \`${member.id}\``,
      ].join('\n'),
    );
  },
);

// ============================================================================
// VOICE STATE UPDATE
// ============================================================================

client.on(
  Events.VoiceStateUpdate,
  async (
    oldState,
    newState,
  ) => {
    const guild =
      newState.guild ||
      oldState.guild;

    if (
      guild.id !==
      CONFIG.GUILD_ID
    ) {
      return;
    }

    const member =
      newState.member ||
      oldState.member;

    if (
      !member ||
      member.user.bot
    ) {
      return;
    }

    // ------------------------------------------------------------------------
    // JOIN TO CREATE PRIVATE CLUB
    // ------------------------------------------------------------------------

    if (
      newState.channelId ===
      CONFIG.CHANNELS.CREATE_PRIVATE_CLUB
    ) {
      const triggerChannel =
        newState.channel;

      if (triggerChannel) {
        try {
          await createPrivateClub(
            member,
            triggerChannel,
          );
        } catch (error) {
          console.error(
            '[private club create]',
            error,
          );

          await member.send({
            embeds: [
              errorEmbed(
                [
                  'I could not create your private club.',
                  '',
                  `\`${truncate(
                    error.message,
                    500,
                  )}\``,
                ].join('\n'),
              ),
            ],
          }).catch(() => null);
        }
      }
    }

    // ------------------------------------------------------------------------
    // USER LEFT A TEMP CLUB
    // ------------------------------------------------------------------------

    if (
      oldState.channelId &&
      oldState.channelId !==
        newState.channelId
    ) {
      const clubRecord =
        sql.getClubByChannel.get(
          oldState.channelId,
        );

      if (
        clubRecord &&
        oldState.channel
      ) {
        // Discord's member cache on the old channel should now reflect
        // the member leaving.
        if (
          oldState.channel.members.size ===
          0
        ) {
          scheduleClubDeletion(
            oldState.channel,
          );
        }
      }
    }

    // ------------------------------------------------------------------------
    // USER JOINED A CLUB THAT WAS WAITING TO DELETE
    // ------------------------------------------------------------------------

    if (
      newState.channelId &&
      pendingClubDeletes.has(
        newState.channelId,
      )
    ) {
      clearTimeout(
        pendingClubDeletes.get(
          newState.channelId,
        ),
      );

      pendingClubDeletes.delete(
        newState.channelId,
      );
    }
  },
);

// ============================================================================
// VOICE XP LOOP
//
// Runs once per minute.
//
// Requirements:
// - real member
// - not server AFK
// - not self deafened
// - at least 2 eligible humans in the VC
//
// This helps stop:
// - AFK farming
// - solo VC farming
// - bot + human farming
// ============================================================================

setInterval(
  async () => {
    const guild =
      await fetchGuild()
        .catch(() => null);

    if (!guild) {
      return;
    }

    for (
      const channel
      of guild.channels.cache.values()
    ) {
      if (
        !channel.isVoiceBased()
      ) {
        continue;
      }

      // Join-to-create waiting room itself earns no XP.
      if (
        channel.id ===
        CONFIG.CHANNELS.CREATE_PRIVATE_CLUB
      ) {
        continue;
      }

      // AFK channel earns no XP.
      if (
        guild.afkChannelId &&
        channel.id ===
        guild.afkChannelId
      ) {
        continue;
      }

      const eligibleHumans =
        channel.members.filter(
          (member) => {
            if (
              member.user.bot
            ) {
              return false;
            }

            if (
              member.voice.selfDeaf
            ) {
              return false;
            }

            if (
              member.voice.serverDeaf
            ) {
              return false;
            }

            return true;
          },
        );

      if (
        eligibleHumans.size <
        CONFIG.LEVELING
          .VOICE_MIN_HUMANS
      ) {
        continue;
      }

      for (
        const member
        of eligibleHumans.values()
      ) {
        sql.ensureUser.run(
          member.id,
        );

        const before =
          sql.getUser.get(
            member.id,
          );

        const oldLevel =
          levelFromXp(
            before.xp,
          );

        const xpAmount =
          CONFIG.LEVELING
            .VOICE_XP_PER_MINUTE;

        sql.addVoiceXp.run(
          xpAmount,
          xpAmount,
          member.id,
        );

        const after =
          sql.getUser.get(
            member.id,
          );

        const newLevel =
          levelFromXp(
            after.xp,
          );

        if (
          newLevel >
          oldLevel
        ) {
          await syncLevelRoles(
            member,
            newLevel,
          );

          await maybeAnnounceMilestone(
            member,
            oldLevel,
            newLevel,
          );
        }
      }
    }
  },

  60_000,
).unref();

// ============================================================================
// DM VERIFICATION HANDLER
// ============================================================================

async function handleVerificationDM(
  message,
) {
  if (
    message.author.bot
  ) {
    return false;
  }

  const verification =
    sql.getVerifyCode.get(
      message.author.id,
    );

  if (!verification) {
    return false;
  }

  // --------------------------------------------------------------------------
  // EXPIRED
  // --------------------------------------------------------------------------

  if (
    Date.now() >
    verification.expires_at
  ) {
    sql.deleteVerifyCode.run(
      message.author.id,
    );

    await message.reply({
      embeds: [
        errorEmbed(
          [
            'that captcha expired.',
            '',
            'go back to the server and press **verify** again.',
          ].join('\n'),
        ),
      ],
    }).catch(() => null);

    return true;
  }

  // --------------------------------------------------------------------------
  // NORMALISE ANSWER
  // --------------------------------------------------------------------------

  const answer =
    message.content
      .trim()
      .toUpperCase()
      .replace(
        /\s+/g,
        '',
      );

  // --------------------------------------------------------------------------
  // CORRECT
  // --------------------------------------------------------------------------

  if (
    answer ===
    verification.code
  ) {
    sql.deleteVerifyCode.run(
      message.author.id,
    );

    try {
      await completeVerification(
        message.author.id,
      );

      await message.reply({
        embeds: [
          successEmbed(
            'verified',
            [
              'captcha accepted.',
              '',
              '**access granted.**',
            ].join('\n'),
          ),
        ],
      }).catch(() => null);
    } catch (error) {
      console.error(
        '[verification complete]',
        error,
      );

      await message.reply({
        embeds: [
          errorEmbed(
            [
              'your captcha was correct, but I could not finish assigning roles.',
              '',
              'tell server staff.',
            ].join('\n'),
          ),
        ],
      }).catch(() => null);
    }

    return true;
  }

  // --------------------------------------------------------------------------
  // WRONG
  // --------------------------------------------------------------------------

  sql.incVerifyAttempt.run(
    message.author.id,
  );

  const updated =
    sql.getVerifyCode.get(
      message.author.id,
    );

  if (!updated) {
    return true;
  }

  const attemptsLeft =
    CONFIG.VERIFICATION
      .MAX_ATTEMPTS -
    updated.attempts;

  if (
    attemptsLeft <= 0
  ) {
    sql.deleteVerifyCode.run(
      message.author.id,
    );

    await message.reply({
      embeds: [
        errorEmbed(
          [
            'too many incorrect attempts.',
            '',
            'press **verify** in the server again for a new captcha.',
          ].join('\n'),
        ),
      ],
    }).catch(() => null);

    return true;
  }

  await message.reply({
    embeds: [
      errorEmbed(
        [
          'incorrect code.',
          '',
          `**${attemptsLeft}** attempt${
            attemptsLeft === 1
              ? ''
              : 's'
          } remaining.`,
        ].join('\n'),
      ),
    ],
  }).catch(() => null);

  return true;
}

// ============================================================================
// MEDIA CHANNEL HANDLER
// ============================================================================

async function handleMediaChannelMessage(
  message,
  member,
  kind,
) {
  // --------------------------------------------------------------------------
  // ONLY IMAGES
  // --------------------------------------------------------------------------

  if (
    !isImageMessage(
      message,
    )
  ) {
    await message
      .delete()
      .catch(() => null);

    const notice =
      await message.channel
        .send({
          content:
            `${message.author}, images only in this channel.`,
        })
        .catch(() => null);

    if (notice) {
      setTimeout(
        () => {
          notice
            .delete()
            .catch(() => null);
        },
        5000,
      ).unref();
    }

    return false;
  }

  // --------------------------------------------------------------------------
  // MEDIA POSTER / STAFF BYPASS
  // --------------------------------------------------------------------------

  const bypass =
    member.roles.cache.has(
      CONFIG.ROLES.MEDIA_POSTER,
    ) ||
    isStaff(member);

  // --------------------------------------------------------------------------
  // BOT-MANAGED 5 MINUTE COOLDOWN
  // --------------------------------------------------------------------------

  if (!bypass) {
    const cooldown =
      sql.getMediaCooldown.get(
        member.id,
        kind,
      );

    if (cooldown) {
      const elapsed =
        Date.now() -
        cooldown.last_post_at;

      const remaining =
        CONFIG.MEDIA
          .COOLDOWN_MS -
        elapsed;

      if (
        remaining > 0
      ) {
        await message
          .delete()
          .catch(() => null);

        const minutes =
          Math.ceil(
            remaining /
            60_000,
          );

        const notice =
          await message.channel
            .send({
              content:
                `${message.author}, wait **${minutes}m** before posting another ${kind}.`,
            })
            .catch(() => null);

        if (notice) {
          setTimeout(
            () => {
              notice
                .delete()
                .catch(() => null);
            },
            5000,
          ).unref();
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

  // --------------------------------------------------------------------------
  // TRACK VALID POST
  // --------------------------------------------------------------------------

  sql.addMediaPost.run(
    message.id,
    member.id,
    kind,
    Date.now(),
  );

  // --------------------------------------------------------------------------
  // CHECK 5+ QUALIFICATION
  // --------------------------------------------------------------------------

  await updateMediaPosterRole(
    member,
  );

  return true;
}

// ============================================================================
// COUNTING GAME MESSAGE HANDLER
// ============================================================================

async function handleCountingMessage(
  message,
  counting,
) {
  const content =
    message.content.trim();

  // Ignore non-number messages.
  if (
    !/^\d+$/.test(
      content,
    )
  ) {
    return false;
  }

  const number =
    Number(content);

  // --------------------------------------------------------------------------
  // SAME PERSON TWICE
  // --------------------------------------------------------------------------

  const samePerson =
    message.author.id ===
    counting.last_user_id;

  // --------------------------------------------------------------------------
  // WRONG NUMBER
  // --------------------------------------------------------------------------

  const wrongNumber =
    number !==
    counting.next_number;

  if (
    samePerson ||
    wrongNumber
  ) {
    await message
      .react(
        '❌',
      )
      .catch(() => null);

    let reason =
      `wrong number`;

    if (
      samePerson
    ) {
      reason =
        'same person counted twice';
    }

    await message.channel
      .send({
        embeds: [
          baseEmbed()
            .setTitle(
              '⛧ count reset',
            )
            .setDescription(
              [
                `${message.author} broke the count.`,
                '',
                `reason: **${reason}**`,
                '',
                `expected: **${counting.next_number}**`,
                '',
                'back to **1**.',
              ].join('\n'),
            ),
        ],
      })
      .catch(() => null);

    sql.resetCounting.run(
      message.channel.id,
    );

    return true;
  }

  // --------------------------------------------------------------------------
  // CORRECT NUMBER
  // --------------------------------------------------------------------------

  await message
    .react(
      '✅',
    )
    .catch(() => null);

  sql.updateCounting.run(
    number + 1,
    message.author.id,
    message.channel.id,
  );

  // Nice milestones.
  if (
    [
      50,
      100,
      250,
      500,
      1000,
    ].includes(number)
  ) {
    await message.channel
      .send({
        embeds: [
          baseEmbed()
            .setTitle(
              '𖤐 counting milestone',
            )
            .setDescription(
              `the server reached **${number}**.`,
            ),
        ],
      })
      .catch(() => null);
  }

  return true;
}

// ============================================================================
// ANTI-SPAM
// ============================================================================

async function handleAntiSpam(
  message,
  member,
) {
  if (
    !CONFIG.AUTOMOD
      .SPAM_ENABLED
  ) {
    return false;
  }

  if (
    isStaff(member)
  ) {
    return false;
  }

  const key =
    `${message.guild.id}:${member.id}`;

  const now =
    Date.now();

  const previous =
    spamTracker.get(
      key,
    ) || [];

  const recent =
    previous.filter(
      (timestamp) =>
        now -
          timestamp <
        CONFIG.AUTOMOD
          .SPAM_WINDOW_MS,
    );

  recent.push(
    now,
  );

  spamTracker.set(
    key,
    recent,
  );

  if (
    recent.length <
    CONFIG.AUTOMOD
      .SPAM_MAX_MESSAGES
  ) {
    return false;
  }

  // Reset their tracker before doing moderation.
  spamTracker.set(
    key,
    [],
  );

  // --------------------------------------------------------------------------
  // TIMEOUT
  // --------------------------------------------------------------------------

  if (
    member.moderatable
  ) {
    await member
      .timeout(
        CONFIG.AUTOMOD
          .SPAM_TIMEOUT_MS,
        'kvsarchive automatic anti-spam',
      )
      .catch(() => null);
  }

  // --------------------------------------------------------------------------
  // WARNING MESSAGE
  // --------------------------------------------------------------------------

  const warning =
    await message.channel
      .send({
        content:
          `${member}, slow down.`,
      })
      .catch(() => null);

  if (warning) {
    setTimeout(
      () => {
        warning
          .delete()
          .catch(() => null);
      },
      5000,
    ).unref();
  }

  await logEvent(
    'automod // spam',
    [
      `${member.user.tag} triggered anti-spam.`,
      `user: <@${member.id}>`,
      `channel: ${message.channel}`,
      `window: ${CONFIG.AUTOMOD.SPAM_WINDOW_MS / 1000}s`,
      `messages: ${recent.length}`,
    ].join('\n'),
  );

  return true;
}

// ============================================================================
// TEXT XP
// ============================================================================

async function awardTextXp(
  message,
  member,
) {
  // --------------------------------------------------------------------------
  // MINIMUM ACTIVITY QUALITY
  //
  // Must contain a little bit of text OR an attachment.
  // --------------------------------------------------------------------------

  if (
    message.content
      .trim()
      .length <
      3 &&
    message.attachments.size ===
      0
  ) {
    return;
  }

  sql.ensureUser.run(
    member.id,
  );

  const data =
    sql.getUser.get(
      member.id,
    );

  const now =
    Date.now();

  // --------------------------------------------------------------------------
  // XP COOLDOWN
  // --------------------------------------------------------------------------

  if (
    now -
      data.last_text_xp <
    CONFIG.LEVELING
      .TEXT_COOLDOWN_MS
  ) {
    return;
  }

  const xp =
    randInt(
      CONFIG.LEVELING
        .TEXT_MIN_XP,

      CONFIG.LEVELING
        .TEXT_MAX_XP,
    );

  const oldLevel =
    levelFromXp(
      data.xp,
    );

  sql.addTextXp.run(
    xp,
    xp,
    now,
    member.id,
  );

  const updated =
    sql.getUser.get(
      member.id,
    );

  const newLevel =
    levelFromXp(
      updated.xp,
    );

  // --------------------------------------------------------------------------
  // LEVEL UP
  // --------------------------------------------------------------------------

  if (
    newLevel >
    oldLevel
  ) {
    await syncLevelRoles(
      member,
      newLevel,
    );

    await maybeAnnounceMilestone(
      member,
      oldLevel,
      newLevel,
    );
  }
}

// ============================================================================
// MESSAGE CREATE
// ============================================================================

client.on(
  Events.MessageCreate,
  async (message) => {
    try {
      // ======================================================================
      // DIRECT MESSAGE
      // ======================================================================

      if (!message.guild) {
        await handleVerificationDM(
          message,
        );

        return;
      }

      // ======================================================================
      // WRONG SERVER
      // ======================================================================

      if (
        message.guild.id !==
        CONFIG.GUILD_ID
      ) {
        return;
      }

      // ======================================================================
      // BOTS
      // ======================================================================

      if (
        message.author.bot
      ) {
        return;
      }

      const member =
        message.member;

      if (!member) {
        return;
      }

      // ======================================================================
      // PFP CHANNEL
      // ======================================================================

      const isPfp =
        message.channel.id ===
        CONFIG.CHANNELS.PFP;

      const isBanner =
        message.channel.id ===
        CONFIG.CHANNELS.BANNER;

      if (
        isPfp
      ) {
        const accepted =
          await handleMediaChannelMessage(
            message,
            member,
            'pfp',
          );

        // Deleted / rejected.
        if (!accepted) {
          return;
        }
      }

      // ======================================================================
      // BANNER CHANNEL
      // ======================================================================

      if (
        isBanner
      ) {
        const accepted =
          await handleMediaChannelMessage(
            message,
            member,
            'banner',
          );

        if (!accepted) {
          return;
        }
      }

      // ======================================================================
      // COUNTING GAME
      // ======================================================================

      const counting =
        sql.getCounting.get(
          message.channel.id,
        );

      if (counting) {
        const handled =
          await handleCountingMessage(
            message,
            counting,
          );

        // Count messages intentionally do not earn XP.
        if (handled) {
          return;
        }
      }

      // ======================================================================
      // ANTI-SPAM
      // ======================================================================

      // Media posting already has a dedicated cooldown system.
      // Don't punish someone twice for the same behaviour.
      if (
        !isPfp &&
        !isBanner
      ) {
        await handleAntiSpam(
          message,
          member,
        );
      }

      // ======================================================================
      // TEXT XP
      // ======================================================================

      await awardTextXp(
        message,
        member,
      );
    } catch (error) {
      console.error(
        '[message create]',
        error,
      );
    }
  },
);

// ============================================================================
// MESSAGE DELETE
// ============================================================================

client.on(
  Events.MessageDelete,
  async (message) => {
    try {
      if (
        message.guild?.id !==
        CONFIG.GUILD_ID
      ) {
        return;
      }

      // ----------------------------------------------------------------------
      // MEDIA POST WAS DELETED
      //
      // This matters because MEDIA_POSTER requires 5 CURRENT tracked posts.
      //
      // Example:
      // User had 5 PFP posts.
      // They delete one.
      // Now they have 4.
      // Role is removed.
      // ----------------------------------------------------------------------

      const trackedPost =
        sql.getMediaPost.get(
          message.id,
        );

      if (trackedPost) {
        sql.deleteMediaPost.run(
          message.id,
        );

        const member =
          await message.guild.members
            .fetch(
              trackedPost.user_id,
            )
            .catch(() => null);

        if (member) {
          await updateMediaPosterRole(
            member,
          );
        }
      }

      // ----------------------------------------------------------------------
      // DON'T LOG BOT MESSAGES
      // ----------------------------------------------------------------------

      if (
        message.author?.bot
      ) {
        return;
      }

      // Don't create recursive logs.
      if (
        message.channelId ===
        CONFIG.CHANNELS.SERVER_LOGS
      ) {
        return;
      }

      // ----------------------------------------------------------------------
      // LOG DELETED MESSAGE
      // ----------------------------------------------------------------------

      const authorText =
        message.author
          ? `${message.author.tag} (${message.author.id})`
          : 'unknown';

      const attachmentText =
        message.attachments?.size
          ? `\nattachments: ${message.attachments.size}`
          : '';

      await logEvent(
        'message deleted',
        [
          `channel: <#${message.channelId}>`,
          `author: ${authorText}`,
          '',
          `content:`,
          truncate(
            message.content ||
              '[no cached content]',
            1200,
          ),
          attachmentText,
        ].join('\n'),
      );
    } catch (error) {
      console.error(
        '[message delete]',
        error,
      );
    }
  },
);

// ============================================================================
// MESSAGE UPDATE
// ============================================================================

client.on(
  Events.MessageUpdate,
  async (
    oldMessage,
    newMessage,
  ) => {
    try {
      if (
        newMessage.guild?.id !==
        CONFIG.GUILD_ID
      ) {
        return;
      }

      if (
        newMessage.author?.bot
      ) {
        return;
      }

      if (
        newMessage.channelId ===
        CONFIG.CHANNELS.SERVER_LOGS
      ) {
        return;
      }

      // No textual change.
      if (
        oldMessage.content ===
        newMessage.content
      ) {
        return;
      }

      await logEvent(
        'message edited',
        [
          `channel: <#${newMessage.channelId}>`,
          `author: ${
            newMessage.author
              ? `${newMessage.author.tag} (${newMessage.author.id})`
              : 'unknown'
          }`,
          '',
          '**before**',
          truncate(
            oldMessage.content ||
              '[not cached]',
            700,
          ),
          '',
          '**after**',
          truncate(
            newMessage.content ||
              '[empty]',
            700,
          ),
        ].join('\n'),
      );
    } catch (error) {
      console.error(
        '[message update]',
        error,
      );
    }
  },
);

// ============================================================================
// CHANNEL DELETE
//
// Cleans database if a temporary club/ticket is manually deleted.
// ============================================================================

client.on(
  Events.ChannelDelete,
  async (channel) => {
    if (
      channel.guild?.id !==
      CONFIG.GUILD_ID
    ) {
      return;
    }

    // ------------------------------------------------------------------------
    // TEMP CLUB DATABASE
    // ------------------------------------------------------------------------

    const club =
      sql.getClubByChannel.get(
        channel.id,
      );

    if (club) {
      sql.deleteClubByChannel.run(
        channel.id,
      );

      if (
        pendingClubDeletes.has(
          channel.id,
        )
      ) {
        clearTimeout(
          pendingClubDeletes.get(
            channel.id,
          ),
        );

        pendingClubDeletes.delete(
          channel.id,
        );
      }
    }

    // ------------------------------------------------------------------------
    // TICKET DATABASE
    // ------------------------------------------------------------------------

    const ticket =
      sql.getTicket.get(
        channel.id,
      );

    if (ticket) {
      sql.deleteTicket.run(
        channel.id,
      );
    }
  },
);

// ============================================================================
// VERIFY BUTTON HANDLER
// ============================================================================

async function handleVerifyButton(
  interaction,
) {
  const member =
    await getInteractionMember(
      interaction,
    );

  if (!member) {
    await interaction.reply({
      content:
        'I could not find your server member profile.',
      ephemeral:
        true,
    });

    return;
  }

  // --------------------------------------------------------------------------
  // ALREADY VERIFIED
  // --------------------------------------------------------------------------

  if (
    member.roles.cache.has(
      CONFIG.ROLES.MEMBER,
    )
  ) {
    await interaction.reply({
      embeds: [
        successEmbed(
          'already verified',
          'you already have server access.',
        ),
      ],

      ephemeral:
        true,
    });

    return;
  }

  // --------------------------------------------------------------------------
  // GENERATE CAPTCHA
  // --------------------------------------------------------------------------

  const code =
    verificationCode();

  const png =
    renderCaptcha(
      code,
    );

  // --------------------------------------------------------------------------
  // SAVE CAPTCHA
  // --------------------------------------------------------------------------

  sql.setVerifyCode.run(
    interaction.user.id,
    code,
    Date.now() +
      CONFIG.VERIFICATION
        .EXPIRE_MS,
  );

  // --------------------------------------------------------------------------
  // DM USER
  // --------------------------------------------------------------------------

  try {
    await interaction.user.send({
      embeds: [
        baseEmbed()
          .setTitle(
            '⛓ verification captcha',
          )
          .setDescription(
            [
              'reply to this DM with the **4 digits** shown below.',
              '',
              'type the number exactly as shown.',
              '',
              `expires in **${Math.floor(
                CONFIG.VERIFICATION.EXPIRE_MS /
                60_000,
              )} minutes**.`,
            ].join('\n'),
          ),
      ],

      files: [
        new AttachmentBuilder(
          png,
          {
            name:
              'kvsarchive-captcha.png',
          },
        ),
      ],
    });
  } catch {
    sql.deleteVerifyCode.run(
      interaction.user.id,
    );

    await interaction.reply({
      embeds: [
        errorEmbed(
          [
            'I could not DM you.',
            '',
            'enable direct messages from server members and try again.',
          ].join('\n'),
        ),
      ],

      ephemeral:
        true,
    });

    return;
  }

  // --------------------------------------------------------------------------
  // CONFIRM
  // --------------------------------------------------------------------------

  await interaction.reply({
    embeds: [
      successEmbed(
        'captcha sent',
        'check your DMs.',
      ),
    ],

    ephemeral:
      true,
  });
}

// ============================================================================
// TICKET BUTTON HANDLER
// ============================================================================

async function handleTicketButton(
  interaction,
) {
  const action =
    interaction.customId.replace(
      'ticket_',
      '',
    );

  // --------------------------------------------------------------------------
  // NEW TICKET BUTTONS
  // --------------------------------------------------------------------------

  if (
    [
      'report',
      'support',
      'owner',
    ].includes(
      action,
    )
  ) {
    await interaction.showModal(
      ticketModal(
        action,
      ),
    );

    return;
  }

  // --------------------------------------------------------------------------
  // EXISTING TICKET RECORD
  // --------------------------------------------------------------------------

  const ticket =
    sql.getTicket.get(
      interaction.channelId,
    );

  if (!ticket) {
    await interaction.reply({
      content:
        'this is not a tracked ticket.',
      ephemeral:
        true,
    });

    return;
  }

  const member =
    await getInteractionMember(
      interaction,
    );

  // --------------------------------------------------------------------------
  // CLAIM
  // --------------------------------------------------------------------------

  if (
    action ===
    'claim'
  ) {
    if (
      !member ||
      !isStaff(member)
    ) {
      await interaction.reply({
        content:
          'staff only.',
        ephemeral:
          true,
      });

      return;
    }

    if (
      ticket.claimed_by
    ) {
      await interaction.reply({
        content:
          `already claimed by <@${ticket.claimed_by}>.`,
        ephemeral:
          true,
      });

      return;
    }

    sql.claimTicket.run(
      member.id,
      interaction.channelId,
    );

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

  // --------------------------------------------------------------------------
  // CLOSE
  // --------------------------------------------------------------------------

  if (
    action ===
    'close'
  ) {
    const allowed =
      interaction.user.id ===
        ticket.opener_id ||
      (
        member &&
        isStaff(member)
      );

    if (!allowed) {
      await interaction.reply({
        content:
          'only the ticket opener or staff can close this.',
        ephemeral:
          true,
      });

      return;
    }

    // Stop opener sending.
    await interaction.channel
      .permissionOverwrites
      .edit(
        ticket.opener_id,
        {
          SendMessages:
            false,
        },
      )
      .catch(() => null);

    // Rename.
    if (
      !interaction.channel.name
        .startsWith(
          'closed-',
        )
    ) {
      await interaction.channel
        .setName(
          `closed-${interaction.channel.name}`
            .slice(
              0,
              100,
            ),
        )
        .catch(() => null);
    }

    const deleteRow =
      new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId(
              'ticket_delete',
            )
            .setLabel(
              'delete ticket',
            )
            .setStyle(
              ButtonStyle.Danger,
            ),
        );

    await interaction.reply({
      embeds: [
        baseEmbed()
          .setTitle(
            '🛠️ ticket closed',
          )
          .setDescription(
            `closed by ${interaction.user}.`,
          ),
      ],

      components: [
        deleteRow,
      ],
    });

    await logEvent(
      'ticket closed',
      `${interaction.user.tag} closed <#${interaction.channelId}>.`,
    );

    return;
  }

  // --------------------------------------------------------------------------
  // DELETE
  // --------------------------------------------------------------------------

  if (
    action ===
    'delete'
  ) {
    if (
      !member ||
      !isStaff(member)
    ) {
      await interaction.reply({
        content:
          'staff only.',
        ephemeral:
          true,
      });

      return;
    }

    await interaction.reply({
      content:
        'deleting ticket…',
      ephemeral:
        true,
    });

    sql.deleteTicket.run(
      interaction.channelId,
    );

    await logEvent(
      'ticket deleted',
      `${member.user.tag} deleted ticket <#${interaction.channelId}>.`,
    );

    setTimeout(
      () => {
        interaction.channel
          .delete(
            `Ticket deleted by ${member.user.tag}`,
          )
          .catch(() => null);
      },
      1200,
    ).unref();

    return;
  }
}

// ============================================================================
// MODAL SUBMISSION ROUTER
// ============================================================================

async function handleModalSubmission(
  interaction,
) {
  // --------------------------------------------------------------------------
  // TICKET MODALS
  // --------------------------------------------------------------------------

  if (
    interaction.customId.startsWith(
      'ticket_modal_',
    )
  ) {
    const type =
      interaction.customId.replace(
        'ticket_modal_',
        '',
      );

    const subject =
      interaction.fields
        .getTextInputValue(
          'subject',
        );

    const details =
      interaction.fields
        .getTextInputValue(
          'details',
        );

    let evidence =
      '';

    try {
      evidence =
        interaction.fields
          .getTextInputValue(
            'evidence',
          );
    } catch {
      evidence =
        '';
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

  // --------------------------------------------------------------------------
  // STAFF APPLICATION
  // --------------------------------------------------------------------------

  if (
    interaction.customId ===
    'staffapp_modal'
  ) {
    const answers = {
      age:
        interaction.fields
          .getTextInputValue(
            'age',
          ),

      timezone:
        interaction.fields
          .getTextInputValue(
            'timezone',
          ),

      experience:
        interaction.fields
          .getTextInputValue(
            'experience',
          ),

      why:
        interaction.fields
          .getTextInputValue(
            'why',
          ),

      availability:
        interaction.fields
          .getTextInputValue(
            'availability',
          ),
    };

    await createStaffApplication(
      interaction,
      answers,
    );

    return;
  }

  // --------------------------------------------------------------------------
  // CLUB RENAME
  // --------------------------------------------------------------------------

  if (
    interaction.customId ===
    'club_modal_rename'
  ) {
    await handleClubRenameModal(
      interaction,
    );

    return;
  }

  // --------------------------------------------------------------------------
  // CLUB LIMIT
  // --------------------------------------------------------------------------

  if (
    interaction.customId ===
    'club_modal_limit'
  ) {
    await handleClubLimitModal(
      interaction,
    );

    return;
  }
}

// ============================================================================
// INTERACTION ROUTER
// ============================================================================

client.on(
  Events.InteractionCreate,
  async (interaction) => {
    try {
      // ======================================================================
      // BUTTONS
      // ======================================================================

      if (
        interaction.isButton()
      ) {
        if (
          !interaction.guild ||
          interaction.guild.id !==
          CONFIG.GUILD_ID
        ) {
          return;
        }

        // --------------------------------------------------------------------
        // VERIFY
        // --------------------------------------------------------------------

        if (
          interaction.customId ===
          'verify_start'
        ) {
          await handleVerifyButton(
            interaction,
          );

          return;
        }

        // --------------------------------------------------------------------
        // TICKETS
        // --------------------------------------------------------------------

        if (
          interaction.customId
            .startsWith(
              'ticket_',
            )
        ) {
          await handleTicketButton(
            interaction,
          );

          return;
        }

        // --------------------------------------------------------------------
        // STAFF APPLICATION OPEN
        // --------------------------------------------------------------------

        if (
          interaction.customId ===
          'staffapp_open'
        ) {
          await interaction.showModal(
            staffApplicationModal(),
          );

          return;
        }

        // --------------------------------------------------------------------
        // PRIVATE CLUB BUTTONS
        // --------------------------------------------------------------------

        if (
          interaction.customId
            .startsWith(
              'club_',
            )
        ) {
          await handleClubButton(
            interaction,
          );

          return;
        }

        // --------------------------------------------------------------------
        // TIC TAC TOE BUTTONS
        //
        // Function is defined in Part 4.
        // Function declarations are hoisted, so this is safe.
        // --------------------------------------------------------------------

        if (
          interaction.customId
            .startsWith(
              'ttt_',
            )
        ) {
          await handleTicTacToeButton(
            interaction,
          );

          return;
        }

        return;
      }

      // ======================================================================
      // USER SELECT MENUS
      // ======================================================================

      if (
        interaction.isUserSelectMenu()
      ) {
        if (
          !interaction.guild ||
          interaction.guild.id !==
          CONFIG.GUILD_ID
        ) {
          return;
        }

        if (
          interaction.customId
            .startsWith(
              'club_user_',
            )
        ) {
          await handleClubUserSelect(
            interaction,
          );

          return;
        }

        return;
      }

      // ======================================================================
      // MODALS
      // ======================================================================

      if (
        interaction.isModalSubmit()
      ) {
        if (
          !interaction.guild ||
          interaction.guild.id !==
          CONFIG.GUILD_ID
        ) {
          return;
        }

        await handleModalSubmission(
          interaction,
        );

        return;
      }

      // ======================================================================
      // SLASH COMMANDS
      //
      // The monster command handler comes in Part 4.
      // ======================================================================

      if (
        interaction.isChatInputCommand()
      ) {
        if (
          !interaction.guild ||
          interaction.guild.id !==
          CONFIG.GUILD_ID
        ) {
          return;
        }

        await handleSlashCommand(
          interaction,
        );

        return;
      }
    } catch (error) {
      console.error(
        '[interaction error]',
        error,
      );

      // ----------------------------------------------------------------------
      // GLOBAL INTERACTION ERROR RESPONSE
      // ----------------------------------------------------------------------

      const payload = {
        embeds: [
          errorEmbed(
            [
              'something went wrong while running that.',
              '',
              `\`${truncate(
                error.message,
                1000,
              )}\``,
            ].join('\n'),
          ),
        ],

        ephemeral:
          true,
      };

      if (
        interaction.isRepliable()
      ) {
        if (
          interaction.replied ||
          interaction.deferred
        ) {
          await interaction
            .followUp(
              payload,
            )
            .catch(() => null);
        } else {
          await interaction
            .reply(
              payload,
            )
            .catch(() => null);
        }
      }
    }
  },
);

// ============================================================================
// HELPER — RANDOM SFW IMAGE / ACTION API
// ============================================================================

async function nekosBest(
  endpoint,
) {
  const response =
    await fetch(
      `https://nekos.best/api/v2/${endpoint}`,
    );

  if (
    !response.ok
  ) {
    throw new Error(
      `nekos.best returned HTTP ${response.status}`,
    );
  }

  const data =
    await response.json();

  const result =
    data.results?.[0];

  if (
    !result?.url
  ) {
    throw new Error(
      'image API returned no image',
    );
  }

  return result.url;
}

// ============================================================================
// GAME DATA — HANGMAN
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

// ============================================================================
// HANGMAN DISPLAY
// ============================================================================

function hangmanDisplay(
  game,
) {
  const shown =
    game.word
      .split('')
      .map(
        (character) => {
          if (
            game.guessed.has(
              character,
            )
          ) {
            return character;
          }

          return '_';
        },
      )
      .join(' ');

  const wrong =
    [
      ...game.wrong,
    ];

  return [
    `\`${shown}\``,
    '',
    `wrong: ${
      wrong.length
        ? wrong.join(', ')
        : 'none'
    }`,
    '',
    `tries left: **${game.tries}**`,
  ].join('\n');
}

// ============================================================================
// TIC TAC TOE HELPERS
// ============================================================================

function ticTacToeWinner(
  board,
) {
  const winningLines = [
    [
      0,
      1,
      2,
    ],

    [
      3,
      4,
      5,
    ],

    [
      6,
      7,
      8,
    ],

    [
      0,
      3,
      6,
    ],

    [
      1,
      4,
      7,
    ],

    [
      2,
      5,
      8,
    ],

    [
      0,
      4,
      8,
    ],

    [
      2,
      4,
      6,
    ],
  ];

  for (
    const [
      a,
      b,
      c,
    ]
    of winningLines
  ) {
    if (
      board[a] &&
      board[a] ===
        board[b] &&
      board[a] ===
        board[c]
    ) {
      return board[a];
    }
  }

  return null;
}

// ============================================================================
// RENDER TIC TAC TOE BUTTON GRID
// ============================================================================

function renderTicTacToeRows(
  gameId,
  board,
  disabled = false,
) {
  const rows = [];

  for (
    let rowIndex = 0;
    rowIndex < 3;
    rowIndex++
  ) {
    const row =
      new ActionRowBuilder();

    for (
      let columnIndex = 0;
      columnIndex < 3;
      columnIndex++
    ) {
      const index =
        rowIndex * 3 +
        columnIndex;

      const value =
        board[index];

      let style =
        ButtonStyle.Secondary;

      if (
        value === 'X'
      ) {
        style =
          ButtonStyle.Danger;
      }

      if (
        value === 'O'
      ) {
        style =
          ButtonStyle.Primary;
      }

      row.addComponents(
        new ButtonBuilder()
          .setCustomId(
            `ttt_${gameId}_${index}`,
          )
          .setLabel(
            value ||
            '·',
          )
          .setStyle(
            style,
          )
          .setDisabled(
            disabled ||
            Boolean(value),
          ),
      );
    }

    rows.push(
      row,
    );
  }

  return rows;
}

// ============================================================================
// HANDLE TIC TAC TOE BUTTON
// ============================================================================

async function handleTicTacToeButton(
  interaction,
) {
  const parts =
    interaction.customId.split(
      '_',
    );

  // ttt_GAMEID_INDEX
  if (
    parts.length !== 3
  ) {
    return;
  }

  const gameId =
    parts[1];

  const index =
    Number(
      parts[2],
    );

  const game =
    ticTacToeGames.get(
      gameId,
    );

  if (!game) {
    await interaction.reply({
      content:
        'that tic tac toe game expired.',
      ephemeral:
        true,
    });

    return;
  }

  // --------------------------------------------------------------------------
  // ONLY THE TWO PLAYERS
  // --------------------------------------------------------------------------

  if (
    !game.players.includes(
      interaction.user.id,
    )
  ) {
    await interaction.reply({
      content:
        'this is not your game.',
      ephemeral:
        true,
    });

    return;
  }

  // --------------------------------------------------------------------------
  // CORRECT TURN
  // --------------------------------------------------------------------------

  const currentPlayer =
    game.players[
      game.turn
    ];

  if (
    currentPlayer !==
    interaction.user.id
  ) {
    await interaction.reply({
      content:
        'not your turn.',
      ephemeral:
        true,
    });

    return;
  }

  // --------------------------------------------------------------------------
  // VALID SQUARE
  // --------------------------------------------------------------------------

  if (
    !Number.isInteger(
      index,
    ) ||
    index < 0 ||
    index > 8
  ) {
    return;
  }

  if (
    game.board[
      index
    ]
  ) {
    await interaction.reply({
      content:
        'that square is already taken.',
      ephemeral:
        true,
    });

    return;
  }

  // --------------------------------------------------------------------------
  // PLACE SYMBOL
  // --------------------------------------------------------------------------

  const symbol =
    game.turn === 0
      ? 'X'
      : 'O';

  game.board[
    index
  ] = symbol;

  // --------------------------------------------------------------------------
  // WIN?
  // --------------------------------------------------------------------------

  const winner =
    ticTacToeWinner(
      game.board,
    );

  const draw =
    !winner &&
    game.board.every(
      Boolean,
    );

  // --------------------------------------------------------------------------
  // GAME FINISHED
  // --------------------------------------------------------------------------

  if (
    winner ||
    draw
  ) {
    ticTacToeGames.delete(
      gameId,
    );

    let winnerId =
      null;

    if (
      winner === 'X'
    ) {
      winnerId =
        game.players[0];
    }

    if (
      winner === 'O'
    ) {
      winnerId =
        game.players[1];
    }

    await interaction.update({
      content:
        winnerId
          ? `𖤐 <@${winnerId}> wins.`
          : '⌁ draw.',

      components:
        renderTicTacToeRows(
          gameId,
          game.board,
          true,
        ),
    });

    return;
  }

  // --------------------------------------------------------------------------
  // NEXT TURN
  // --------------------------------------------------------------------------

  game.turn =
    game.turn === 0
      ? 1
      : 0;

  await interaction.update({
    content:
      [
        `<@${game.players[0]}> = **X**`,
        `<@${game.players[1]}> = **O**`,
        '',
        `turn: <@${game.players[game.turn]}>`,
      ].join('\n'),

    components:
      renderTicTacToeRows(
        gameId,
        game.board,
      ),
  });
}

// ============================================================================
// OWNER XP DATABASE HELPERS
// ============================================================================

const ownerXpSql = {
  add:
    db.prepare(`
      UPDATE users

      SET xp = xp + ?

      WHERE user_id = ?
    `),

  remove:
    db.prepare(`
      UPDATE users

      SET xp =
        CASE
          WHEN xp - ? < 0
          THEN 0
          ELSE xp - ?
        END

      WHERE user_id = ?
    `),

  set:
    db.prepare(`
      UPDATE users

      SET xp = ?

      WHERE user_id = ?
    `),
};

// ============================================================================
// SERVER ROLE RESYNC HELPER
// ============================================================================

async function resyncAllLevelRoles(
  guild,
) {
  await guild.members.fetch();

  let processed =
    0;

  let changed =
    0;

  for (
    const member
    of guild.members.cache.values()
  ) {
    if (
      member.user.bot
    ) {
      continue;
    }

    sql.ensureUser.run(
      member.id,
    );

    const data =
      sql.getUser.get(
        member.id,
      );

    const level =
      levelFromXp(
        data.xp,
      );

    const beforeRoles =
      new Set(
        member.roles.cache.keys(),
      );

    await syncLevelRoles(
      member,
      level,
    );

    processed++;

    const afterRoles =
      new Set(
        member.roles.cache.keys(),
      );

    const beforeString =
      [
        ...beforeRoles,
      ]
        .sort()
        .join(',');

    const afterString =
      [
        ...afterRoles,
      ]
        .sort()
        .join(',');

    if (
      beforeString !==
      afterString
    ) {
      changed++;
    }
  }

  return {
    processed,
    changed,
  };
}
// ============================================================================
// PART 4
// COMPLETE SLASH COMMAND HANDLER + STARTUP
// ============================================================================

// ============================================================================
// LEVEL ROLE / LOYAL ROLE SYNC AFTER MANUAL XP CHANGES
// ============================================================================

async function syncManualXpRoles(
  member,
  level,
) {
  await syncLevelRoles(
    member,
    level,
  );

  // syncLevelRoles automatically adds loyal member at 60+
  // but manual XP removal should also remove loyal if they fall below 60.
  if (
    level < 60 &&
    member.roles.cache.has(
      CONFIG.ROLES.LOYAL_MEMBER,
    )
  ) {
    await member.roles
      .remove(
        CONFIG.ROLES.LOYAL_MEMBER,
        'Activity level dropped below 60',
      )
      .catch(() => null);
  }
}

// ============================================================================
// MAIN SLASH COMMAND HANDLER
// ============================================================================

async function handleSlashCommand(
  interaction,
) {
  const name =
    interaction.commandName;

  // ==========================================================================
  // HELP
  // ==========================================================================

  if (
    name === 'help'
  ) {
    const member =
      await getInteractionMember(
        interaction,
      );

    const lines = [
      '**community**',
      '`/level` `/leaderboard` `/avatar` `/userinfo` `/serverinfo`',
      '',
      '**fun**',
      '`/coinflip` `/roll` `/8ball` `/rps` `/choose` `/ship`',
      '`/neko` `/waifu` `/hug` `/pat` `/slap` `/kiss`',
      '',
      '**games**',
      '`/hangman` + `/guess`',
      '`/numberguess` + `/guessnum`',
      '`/tictactoe`',
      '`/poll`',
      '`/counting status`',
    ];

    if (
      member &&
      isStaff(member)
    ) {
      lines.push(
        '',
        '**staff**',
        '`/warn` `/warnings` `/clearwarnings`',
        '`/clear` `/timeout` `/untimeout`',
        '`/kick` `/ban` `/unban`',
        '`/slowmode` `/lock` `/unlock` `/nick`',
        '`/counting start` `/counting stop`',
      );
    }

    if (
      member &&
      isManagement(member)
    ) {
      lines.push(
        '',
        '**management**',
        '`/psa`',
      );
    }

    if (
      isOwner(
        interaction.user.id,
      )
    ) {
      lines.push(
        '',
        '**owner**',
        '`/setup` `/staffapppost` `/test`',
        '`/xp` `/synclevelroles`',
        '`/say` `/embedpost`',
      );
    }

    await interaction.reply({
      embeds: [
        baseEmbed()
          .setTitle(
            '⌁ kvsarchive commands',
          )
          .setDescription(
            lines.join('\n'),
          ),
      ],

      ephemeral:
        true,
    });

    return;
  }

  // ==========================================================================
  // PING
  // ==========================================================================

  if (
    name === 'ping'
  ) {
    const started =
      Date.now();

    await interaction.reply({
      content:
        'checking…',
      ephemeral:
        true,
    });

    const roundTrip =
      Date.now() -
      started;

    await interaction.editReply({
      content:
        [
          `⌁ websocket: **${client.ws.ping}ms**`,
          `⌁ interaction: **${roundTrip}ms**`,
        ].join('\n'),
    });

    return;
  }

  // ==========================================================================
  // LEVEL
  // ==========================================================================

  if (
    name === 'level'
  ) {
    const target =
      interaction.options
        .getUser(
          'user',
        ) ||
      interaction.user;

    sql.ensureUser.run(
      target.id,
    );

    const data =
      sql.getUser.get(
        target.id,
      );

    const level =
      levelFromXp(
        data.xp,
      );

    const currentLevelFloor =
      xpForLevel(
        level,
      );

    const nextLevelFloor =
      xpForLevel(
        level + 1,
      );

    const progress =
      data.xp -
      currentLevelFloor;

    const required =
      nextLevelFloor -
      currentLevelFloor;

    // ------------------------------------------------------------------------
    // SERVER RANK
    // ------------------------------------------------------------------------

    const rankRow =
      db.prepare(`
        SELECT COUNT(*) + 1 AS rank
        FROM users
        WHERE xp > ?
      `).get(
        data.xp,
      );

    const rank =
      rankRow?.rank ||
      1;

    // ------------------------------------------------------------------------
    // SYNC TARGET ROLES WHILE WE ARE HERE
    // ------------------------------------------------------------------------

    const targetMember =
      await interaction.guild.members
        .fetch(
          target.id,
        )
        .catch(() => null);

    if (
      targetMember
    ) {
      await syncManualXpRoles(
        targetMember,
        level,
      );
    }

    // ------------------------------------------------------------------------
    // EMBED
    // ------------------------------------------------------------------------

    await interaction.reply({
      embeds: [
        baseEmbed()
          .setTitle(
            `𖤐 ${target.username} // level ${level}`,
          )
          .setThumbnail(
            target.displayAvatarURL({
              size: 256,
            }),
          )
          .setDescription(
            [
              progressBar(
                progress,
                required,
              ),
              '',
              `**${progress.toLocaleString()} / ${required.toLocaleString()} XP**`,
              `until level **${level + 1}**`,
            ].join('\n'),
          )
          .addFields(
            {
              name:
                'total xp',

              value:
                data.xp
                  .toLocaleString(),

              inline:
                true,
            },

            {
              name:
                'rank',

              value:
                `#${rank}`,

              inline:
                true,
            },

            {
              name:
                'messages',

              value:
                data.messages
                  .toLocaleString(),

              inline:
                true,
            },

            {
              name:
                'text xp',

              value:
                data.text_xp
                  .toLocaleString(),

              inline:
                true,
            },

            {
              name:
                'voice xp',

              value:
                data.voice_xp
                  .toLocaleString(),

              inline:
                true,
            },

            {
              name:
                'voice time',

              value:
                `${data.voice_minutes.toLocaleString()}m`,

              inline:
                true,
            },
          ),
      ],
    });

    return;
  }

  // ==========================================================================
  // LEADERBOARD
  // ==========================================================================

  if (
    name ===
    'leaderboard'
  ) {
    const rows =
      sql.leaderboard.all();

    if (
      !rows.length
    ) {
      await interaction.reply({
        embeds: [
          baseEmbed()
            .setTitle(
              '𖤐 activity leaderboard',
            )
            .setDescription(
              'no activity data yet.',
            ),
        ],
      });

      return;
    }

    const medals = [
      '🥇',
      '🥈',
      '🥉',
    ];

    const leaderboardLines =
      rows.map(
        (
          row,
          index,
        ) => {
          const level =
            levelFromXp(
              row.xp,
            );

          const placement =
            medals[index] ||
            `**${index + 1}.**`;

          return (
            `${placement} <@${row.user_id}>` +
            ` — lvl **${level}**` +
            ` · **${row.xp.toLocaleString()} xp**`
          );
        },
      );

    await interaction.reply({
      embeds: [
        baseEmbed()
          .setTitle(
            '𖤐 activity leaderboard',
          )
          .setDescription(
            leaderboardLines
              .join('\n'),
          ),
      ],
    });

    return;
  }

  // ==========================================================================
  // AVATAR
  // ==========================================================================

  if (
    name === 'avatar'
  ) {
    const user =
      interaction.options
        .getUser(
          'user',
        ) ||
      interaction.user;

    const avatar =
      user.displayAvatarURL({
        size:
          4096,

        extension:
          'png',
      });

    await interaction.reply({
      embeds: [
        baseEmbed()
          .setTitle(
            `${user.username} // avatar`,
          )
          .setDescription(
            `[open original](${avatar})`,
          )
          .setImage(
            avatar,
          ),
      ],
    });

    return;
  }

  // ==========================================================================
  // USER INFO
  // ==========================================================================

  if (
    name === 'userinfo'
  ) {
    const user =
      interaction.options
        .getUser(
          'user',
        ) ||
      interaction.user;

    const member =
      await interaction.guild.members
        .fetch(
          user.id,
        )
        .catch(() => null);

    const roles =
      member
        ? member.roles.cache
            .filter(
              (role) =>
                role.id !==
                interaction.guild.id,
            )
            .sort(
              (
                first,
                second,
              ) =>
                second.position -
                first.position,
            )
            .map(
              (role) =>
                `${role}`,
            )
            .slice(
              0,
              15,
            )
        : [];

    const embed =
      baseEmbed()
        .setTitle(
          `${user.username} // user info`,
        )
        .setThumbnail(
          user.displayAvatarURL({
            size: 256,
          }),
        )
        .addFields(
          {
            name:
              'user',

            value:
              `${user}`,

            inline:
              true,
          },

          {
            name:
              'id',

            value:
              `\`${user.id}\``,

            inline:
              true,
          },

          {
            name:
              'bot',

            value:
              user.bot
                ? 'yes'
                : 'no',

            inline:
              true,
          },

          {
            name:
              'account created',

            value:
              `<t:${Math.floor(
                user.createdTimestamp /
                1000,
              )}:F>\n<t:${Math.floor(
                user.createdTimestamp /
                1000,
              )}:R>`,

            inline:
              false,
          },
        );

    if (
      member?.joinedTimestamp
    ) {
      embed.addFields({
        name:
          'joined server',

        value:
          `<t:${Math.floor(
            member.joinedTimestamp /
            1000,
          )}:F>\n<t:${Math.floor(
            member.joinedTimestamp /
            1000,
          )}:R>`,

        inline:
          false,
      });
    }

    if (
      member
    ) {
      embed.addFields({
        name:
          `roles (${Math.max(
            member.roles.cache.size -
            1,
            0,
          )})`,

        value:
          roles.length
            ? truncate(
                roles.join(' '),
                1000,
              )
            : 'none',

        inline:
          false,
      });
    }

    await interaction.reply({
      embeds: [
        embed,
      ],
    });

    return;
  }

  // ==========================================================================
  // SERVER INFO
  // ==========================================================================

  if (
    name ===
    'serverinfo'
  ) {
    const guild =
      interaction.guild;

    const owner =
      await guild.members
        .fetch(
          guild.ownerId,
        )
        .catch(() => null);

    await interaction.reply({
      embeds: [
        baseEmbed()
          .setTitle(
            `${guild.name} // server info`,
          )
          .setThumbnail(
            guild.iconURL({
              size: 256,
            }),
          )
          .addFields(
            {
              name:
                'members',

              value:
                guild.memberCount
                  .toLocaleString(),

              inline:
                true,
            },

            {
              name:
                'channels',

              value:
                guild.channels.cache
                  .size
                  .toLocaleString(),

              inline:
                true,
            },

            {
              name:
                'roles',

              value:
                guild.roles.cache
                  .size
                  .toLocaleString(),

              inline:
                true,
            },

            {
              name:
                'owner',

              value:
                owner
                  ? `${owner}`
                  : `<@${guild.ownerId}>`,

              inline:
                true,
            },

            {
              name:
                'boosts',

              value:
                String(
                  guild.premiumSubscriptionCount ||
                  0,
                ),

              inline:
                true,
            },

            {
              name:
                'boost level',

              value:
                String(
                  guild.premiumTier,
                ),

              inline:
                true,
            },

            {
              name:
                'created',

              value:
                `<t:${Math.floor(
                  guild.createdTimestamp /
                  1000,
                )}:F>`,

              inline:
                false,
            },

            {
              name:
                'server id',

              value:
                `\`${guild.id}\``,

              inline:
                false,
            },
          ),
      ],
    });

    return;
  }

  // ==========================================================================
  // COIN FLIP
  // ==========================================================================

  if (
    name ===
    'coinflip'
  ) {
    const result =
      Math.random() <
      0.5
        ? 'heads'
        : 'tails';

    await interaction.reply({
      embeds: [
        baseEmbed()
          .setTitle(
            '⌁ coin flip',
          )
          .setDescription(
            `**${result}**`,
          ),
      ],
    });

    return;
  }

  // ==========================================================================
  // ROLL
  // ==========================================================================

  if (
    name ===
    'roll'
  ) {
    const sides =
      interaction.options
        .getInteger(
          'sides',
        ) ||
      6;

    const result =
      randInt(
        1,
        sides,
      );

    await interaction.reply({
      embeds: [
        baseEmbed()
          .setTitle(
            '⌁ dice',
          )
          .setDescription(
            `rolled **${result}** / ${sides}`,
          ),
      ],
    });

    return;
  }

  // ==========================================================================
  // 8BALL
  // ==========================================================================

  if (
    name ===
    '8ball'
  ) {
    const question =
      interaction.options
        .getString(
          'question',
        );

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
      'don’t count on it.',
      'very doubtful.',
      'signs point to yes.',
      'there is a chance.',
    ];

    const answer =
      responses[
        randInt(
          0,
          responses.length -
          1,
        )
      ];

    await interaction.reply({
      embeds: [
        baseEmbed()
          .setTitle(
            '🎱 8ball',
          )
          .addFields(
            {
              name:
                'question',

              value:
                truncate(
                  question,
                  1000,
                ),
            },

            {
              name:
                'answer',

              value:
                `**${answer}**`,
            },
          ),
      ],
    });

    return;
  }

  // ==========================================================================
  // RPS
  // ==========================================================================

  if (
    name ===
    'rps'
  ) {
    const userChoice =
      interaction.options
        .getString(
          'choice',
        );

    const choices = [
      'rock',
      'paper',
      'scissors',
    ];

    const botChoice =
      choices[
        randInt(
          0,
          choices.length -
          1,
        )
      ];

    const userWins =
      (
        userChoice ===
          'rock' &&
        botChoice ===
          'scissors'
      ) ||
      (
        userChoice ===
          'paper' &&
        botChoice ===
          'rock'
      ) ||
      (
        userChoice ===
          'scissors' &&
        botChoice ===
          'paper'
      );

    let result =
      'you lose.';

    if (
      userChoice ===
      botChoice
    ) {
      result =
        'draw.';
    } else if (
      userWins
    ) {
      result =
        'you win.';
    }

    await interaction.reply({
      embeds: [
        baseEmbed()
          .setTitle(
            '⌁ rock paper scissors',
          )
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

  // ==========================================================================
  // CHOOSE
  // ==========================================================================

  if (
    name ===
    'choose'
  ) {
    const raw =
      interaction.options
        .getString(
          'choices',
        );

    const choices =
      raw
        .split('|')
        .map(
          (choice) =>
            choice.trim(),
        )
        .filter(
          Boolean,
        );

    if (
      choices.length <
      2
    ) {
      await interaction.reply({
        content:
          'give me at least **2 choices** separated by `|`.\nexample: `pizza | maccas | sleep`',

        ephemeral:
          true,
      });

      return;
    }

    const selection =
      choices[
        randInt(
          0,
          choices.length -
          1,
        )
      ];

    await interaction.reply({
      embeds: [
        baseEmbed()
          .setTitle(
            '⌁ choice',
          )
          .setDescription(
            `I pick **${truncate(
              selection,
              1000,
            )}**`,
          ),
      ],
    });

    return;
  }

  // ==========================================================================
  // SHIP
  // ==========================================================================

  if (
    name ===
    'ship'
  ) {
    const first =
      interaction.options
        .getUser(
          'user1',
        );

    const second =
      interaction.options
        .getUser(
          'user2',
        );

    const seed =
      [
        first.id,
        second.id,
      ]
        .sort()
        .join(':');

    let hash =
      0;

    for (
      const character
      of seed
    ) {
      hash =
        (
          hash *
          31 +
          character.charCodeAt(
            0,
          )
        ) >>>
        0;
    }

    const percentage =
      hash %
      101;

    let comment =
      'eh.';

    if (
      percentage >=
      90
    ) {
      comment =
        'damn 😭';
    } else if (
      percentage >=
      75
    ) {
      comment =
        'actually kinda crazy.';
    } else if (
      percentage >=
      50
    ) {
      comment =
        'could work.';
    } else if (
      percentage >=
      25
    ) {
      comment =
        'not looking amazing.';
    } else {
      comment =
        'yeah wrap it up.';
    }

    await interaction.reply({
      embeds: [
        baseEmbed()
          .setTitle(
            '♡ compatibility',
          )
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

  // ==========================================================================
  // NEKO / WAIFU
  // ==========================================================================

  if (
    [
      'neko',
      'waifu',
    ].includes(
      name,
    )
  ) {
    await interaction.deferReply();

    try {
      const image =
        await nekosBest(
          name,
        );

      await interaction.editReply({
        embeds: [
          baseEmbed()
            .setTitle(
              `𖤐 ${name}`,
            )
            .setImage(
              image,
            ),
        ],
      });
    } catch (error) {
      await interaction.editReply({
        embeds: [
          errorEmbed(
            `image API failed: ${error.message}`,
          ),
        ],
      });
    }

    return;
  }

  // ==========================================================================
  // HUG / PAT / SLAP / KISS
  // ==========================================================================

  if (
    [
      'hug',
      'pat',
      'slap',
      'kiss',
    ].includes(
      name,
    )
  ) {
    const target =
      interaction.options
        .getUser(
          'user',
        );

    await interaction.deferReply();

    const verbMap = {
      hug:
        'hugs',

      pat:
        'pats',

      slap:
        'slaps',

      kiss:
        'kisses',
    };

    try {
      const image =
        await nekosBest(
          name,
        );

      await interaction.editReply({
        embeds: [
          baseEmbed()
            .setDescription(
              `${interaction.user} **${verbMap[name]}** ${target}`,
            )
            .setImage(
              image,
            ),
        ],
      });
    } catch (error) {
      await interaction.editReply({
        embeds: [
          errorEmbed(
            `image API failed: ${error.message}`,
          ),
        ],
      });
    }

    return;
  }

  // ==========================================================================
  // HANGMAN START
  // ==========================================================================

  if (
    name ===
    'hangman'
  ) {
    const key =
      `${interaction.guildId}:${interaction.channelId}`;

    if (
      hangmanGames.has(
        key,
      )
    ) {
      await interaction.reply({
        content:
          'there is already a hangman game here. use `/guess`.',

        ephemeral:
          true,
      });

      return;
    }

    const word =
      HANGMAN_WORDS[
        randInt(
          0,
          HANGMAN_WORDS.length -
          1,
        )
      ];

    const game = {
      word,

      guessed:
        new Set(),

      wrong:
        new Set(),

      tries:
        7,

      startedBy:
        interaction.user.id,

      createdAt:
        Date.now(),
    };

    hangmanGames.set(
      key,
      game,
    );

    // Auto expire.
    setTimeout(
      () => {
        const current =
          hangmanGames.get(
            key,
          );

        if (
          current ===
          game
        ) {
          hangmanGames.delete(
            key,
          );
        }
      },
      15 * 60_000,
    ).unref();

    await interaction.reply({
      embeds: [
        baseEmbed()
          .setTitle(
            '⌁ hangman',
          )
          .setDescription(
            hangmanDisplay(
              game,
            ),
          )
          .setFooter({
            text:
              'use /guess • expires in 15m',
          }),
      ],
    });

    return;
  }

  // ==========================================================================
  // HANGMAN GUESS
  // ==========================================================================

  if (
    name ===
    'guess'
  ) {
    const key =
      `${interaction.guildId}:${interaction.channelId}`;

    const game =
      hangmanGames.get(
        key,
      );

    if (!game) {
      await interaction.reply({
        content:
          'no hangman game is active here. use `/hangman` first.',

        ephemeral:
          true,
      });

      return;
    }

    const guess =
      interaction.options
        .getString(
          'guess',
        )
        .toLowerCase()
        .trim();

    if (
      !/^[a-z]+$/.test(
        guess,
      )
    ) {
      await interaction.reply({
        content:
          'letters only.',

        ephemeral:
          true,
      });

      return;
    }

    let won =
      false;

    // ------------------------------------------------------------------------
    // LETTER
    // ------------------------------------------------------------------------

    if (
      guess.length ===
      1
    ) {
      if (
        game.guessed.has(
          guess,
        ) ||
        game.wrong.has(
          guess,
        )
      ) {
        await interaction.reply({
          content:
            'that letter has already been guessed.',

          ephemeral:
            true,
        });

        return;
      }

      if (
        game.word.includes(
          guess,
        )
      ) {
        game.guessed.add(
          guess,
        );
      } else {
        game.wrong.add(
          guess,
        );

        game.tries--;
      }

      won =
        game.word
          .split('')
          .every(
            (character) =>
              game.guessed.has(
                character,
              ),
          );
    }

    // ------------------------------------------------------------------------
    // FULL WORD
    // ------------------------------------------------------------------------

    else {
      if (
        guess ===
        game.word
      ) {
        won =
          true;
      } else {
        game.tries--;
      }
    }

    // ------------------------------------------------------------------------
    // WON
    // ------------------------------------------------------------------------

    if (won) {
      hangmanGames.delete(
        key,
      );

      await interaction.reply({
        embeds: [
          baseEmbed()
            .setTitle(
              '𖤐 hangman won',
            )
            .setDescription(
              [
                `${interaction.user} got it.`,
                '',
                `word: **${game.word}**`,
              ].join('\n'),
            ),
        ],
      });

      return;
    }

    // ------------------------------------------------------------------------
    // LOST
    // ------------------------------------------------------------------------

    if (
      game.tries <=
      0
    ) {
      hangmanGames.delete(
        key,
      );

      await interaction.reply({
        embeds: [
          baseEmbed()
            .setTitle(
              '⛧ hangman lost',
            )
            .setDescription(
              `the word was **${game.word}**.`,
            ),
        ],
      });

      return;
    }

    // ------------------------------------------------------------------------
    // CONTINUE
    // ------------------------------------------------------------------------

    await interaction.reply({
      embeds: [
        baseEmbed()
          .setTitle(
            '⌁ hangman',
          )
          .setDescription(
            hangmanDisplay(
              game,
            ),
          ),
      ],
    });

    return;
  }

  // ==========================================================================
  // NUMBER GUESS START
  // ==========================================================================

  if (
    name ===
    'numberguess'
  ) {
    const key =
      `${interaction.guildId}:${interaction.channelId}`;

    if (
      numberGames.has(
        key,
      )
    ) {
      await interaction.reply({
        content:
          'there is already a number guessing game active here.',

        ephemeral:
          true,
      });

      return;
    }

    const max =
      interaction.options
        .getInteger(
          'max',
        ) ||
      100;

    const game = {
      number:
        randInt(
          1,
          max,
        ),

      max,

      guesses:
        0,

      startedBy:
        interaction.user.id,
    };

    numberGames.set(
      key,
      game,
    );

    setTimeout(
      () => {
        if (
          numberGames.get(
            key,
          ) ===
          game
        ) {
          numberGames.delete(
            key,
          );
        }
      },
      15 * 60_000,
    ).unref();

    await interaction.reply({
      embeds: [
        baseEmbed()
          .setTitle(
            '⌁ number guess',
          )
          .setDescription(
            [
              `I picked a number from **1-${max}**.`,
              '',
              'use `/guessnum`.',
              '',
              '*game expires in 15 minutes.*',
            ].join('\n'),
          ),
      ],
    });

    return;
  }

  // ==========================================================================
  // NUMBER GUESS ATTEMPT
  // ==========================================================================

  if (
    name ===
    'guessnum'
  ) {
    const key =
      `${interaction.guildId}:${interaction.channelId}`;

    const game =
      numberGames.get(
        key,
      );

    if (!game) {
      await interaction.reply({
        content:
          'no number game is active here.',

        ephemeral:
          true,
      });

      return;
    }

    const number =
      interaction.options
        .getInteger(
          'number',
        );

    if (
      number < 1 ||
      number >
      game.max
    ) {
      await interaction.reply({
        content:
          `guess a number from **1-${game.max}**.`,

        ephemeral:
          true,
      });

      return;
    }

    game.guesses++;

    if (
      number ===
      game.number
    ) {
      numberGames.delete(
        key,
      );

      await interaction.reply({
        embeds: [
          baseEmbed()
            .setTitle(
              '𖤐 correct',
            )
            .setDescription(
              [
                `${interaction.user} got it.`,
                '',
                `number: **${number}**`,
                `guesses: **${game.guesses}**`,
              ].join('\n'),
            ),
        ],
      });

      return;
    }

    const direction =
      number <
      game.number
        ? 'higher'
        : 'lower';

    await interaction.reply({
      content:
        `**${direction}.**`,
    });

    return;
  }

  // ==========================================================================
  // TIC TAC TOE START
  // ==========================================================================

  if (
    name ===
    'tictactoe'
  ) {
    const opponent =
      interaction.options
        .getUser(
          'user',
        );

    if (
      opponent.bot
    ) {
      await interaction.reply({
        content:
          'pick a real member.',

        ephemeral:
          true,
      });

      return;
    }

    if (
      opponent.id ===
      interaction.user.id
    ) {
      await interaction.reply({
        content:
          'you cannot challenge yourself 😭',

        ephemeral:
          true,
      });

      return;
    }

    const gameId =
      Math.random()
        .toString(36)
        .slice(
          2,
          9,
        );

    const game = {
      board:
        Array(9).fill(
          null,
        ),

      players: [
        interaction.user.id,
        opponent.id,
      ],

      turn:
        0,

      createdAt:
        Date.now(),
    };

    ticTacToeGames.set(
      gameId,
      game,
    );

    setTimeout(
      () => {
        ticTacToeGames.delete(
          gameId,
        );
      },
      10 * 60_000,
    ).unref();

    await interaction.reply({
      content:
        [
          `${interaction.user} = **X**`,
          `${opponent} = **O**`,
          '',
          `turn: ${interaction.user}`,
        ].join('\n'),

      components:
        renderTicTacToeRows(
          gameId,
          game.board,
        ),
    });

    return;
  }

  // ==========================================================================
  // POLL
  // ==========================================================================

  if (
    name ===
    'poll'
  ) {
    const question =
      interaction.options
        .getString(
          'question',
        );

    const options = [
      interaction.options
        .getString(
          'option1',
        ),

      interaction.options
        .getString(
          'option2',
        ),

      interaction.options
        .getString(
          'option3',
        ),

      interaction.options
        .getString(
          'option4',
        ),

      interaction.options
        .getString(
          'option5',
        ),
    ].filter(
      Boolean,
    );

    const numberEmojis = [
      '1️⃣',
      '2️⃣',
      '3️⃣',
      '4️⃣',
      '5️⃣',
    ];

    const description =
      [
        `**${question}**`,
        '',
        ...options.map(
          (
            option,
            index,
          ) =>
            `${numberEmojis[index]} ${option}`,
        ),
      ].join('\n');

    await interaction.reply({
      embeds: [
        baseEmbed()
          .setTitle(
            '⌁ poll',
          )
          .setDescription(
            description,
          )
          .setFooter({
            text:
              `poll by ${interaction.user.username}`,
          }),
      ],
    });

    const pollMessage =
      await interaction.fetchReply();

    for (
      let index = 0;
      index < options.length;
      index++
    ) {
      await pollMessage
        .react(
          numberEmojis[index],
        )
        .catch(() => null);
    }

    return;
  }

  // ==========================================================================
  // COUNTING
  // ==========================================================================

  if (
    name ===
    'counting'
  ) {
    const subcommand =
      interaction.options
        .getSubcommand();

    // ------------------------------------------------------------------------
    // STATUS
    // ------------------------------------------------------------------------

    if (
      subcommand ===
      'status'
    ) {
      const current =
        sql.getCounting.get(
          interaction.channelId,
        );

      if (!current) {
        await interaction.reply({
          embeds: [
            baseEmbed()
              .setTitle(
                '⌁ counting',
              )
              .setDescription(
                'counting is not active in this channel.',
              ),
          ],
        });

        return;
      }

      await interaction.reply({
        embeds: [
          baseEmbed()
            .setTitle(
              '⌁ counting',
            )
            .addFields(
              {
                name:
                  'next number',

                value:
                  `**${current.next_number}**`,

                inline:
                  true,
              },

              {
                name:
                  'last counter',

                value:
                  current.last_user_id
                    ? `<@${current.last_user_id}>`
                    : 'nobody',

                inline:
                  true,
              },
            ),
        ],
      });

      return;
    }

    // ------------------------------------------------------------------------
    // START / STOP = STAFF
    // ------------------------------------------------------------------------

    const staff =
      await requireStaff(
        interaction,
      );

    if (!staff) {
      return;
    }

    if (
      !interaction.channel
        ?.isTextBased()
    ) {
      await interaction.reply({
        content:
          'counting must be used in a text channel.',

        ephemeral:
          true,
      });

      return;
    }

    // ------------------------------------------------------------------------
    // START
    // ------------------------------------------------------------------------

    if (
      subcommand ===
      'start'
    ) {
      sql.startCounting.run(
        interaction.channelId,
      );

      await interaction.reply({
        embeds: [
          baseEmbed()
            .setTitle(
              '⌁ counting started',
            )
            .setDescription(
              [
                'start with **1**.',
                '',
                'rules:',
                '› numbers must be in order',
                '› one number per message',
                '› the same person cannot count twice in a row',
                '› mistakes reset the count',
              ].join('\n'),
            ),
        ],
      });

      await logEvent(
        'counting started',
        `${staff.user.tag} started counting in ${interaction.channel}.`,
      );

      return;
    }

    // ------------------------------------------------------------------------
    // STOP
    // ------------------------------------------------------------------------

    sql.stopCounting.run(
      interaction.channelId,
    );

    await interaction.reply({
      embeds: [
        successEmbed(
          'counting stopped',
          `counting disabled in ${interaction.channel}.`,
        ),
      ],
    });

    await logEvent(
      'counting stopped',
      `${staff.user.tag} stopped counting in ${interaction.channel}.`,
    );

    return;
  }

  // ==========================================================================
  // WARN
  // ==========================================================================

  if (
    name ===
    'warn'
  ) {
    const staff =
      await requireStaff(
        interaction,
      );

    if (!staff) {
      return;
    }

    const user =
      interaction.options
        .getUser(
          'user',
        );

    const reason =
      interaction.options
        .getString(
          'reason',
        );

    const target =
      await interaction.guild.members
        .fetch(
          user.id,
        )
        .catch(() => null);

    if (!target) {
      await interaction.reply({
        content:
          'that member is not in the server.',

        ephemeral:
          true,
      });

      return;
    }

    if (
      !await canModerateTarget(
        staff,
        target,
      )
    ) {
      await interaction.reply({
        embeds: [
          errorEmbed(
            'you cannot moderate that member.',
          ),
        ],

        ephemeral:
          true,
      });

      return;
    }

    sql.addWarning.run(
      interaction.guildId,
      user.id,
      staff.id,
      reason,
      Date.now(),
    );

    const warnings =
      sql.getWarnings.all(
        interaction.guildId,
        user.id,
      );

    await interaction.reply({
      embeds: [
        successEmbed(
          'warning added',
          [
            `${user}`,
            '',
            truncate(
              reason,
              1000,
            ),
            '',
            `total warnings: **${warnings.length}**`,
          ].join('\n'),
        ),
      ],

      ephemeral:
        true,
    });

    await user.send({
      embeds: [
        baseEmbed()
          .setTitle(
            '⚠ warning // kvsarchive',
          )
          .setDescription(
            reason,
          )
          .addFields({
            name:
              'moderator',

            value:
              `${staff.user.tag}`,
          }),
      ],
    }).catch(() => null);

    await logEvent(
      'warning',
      `${staff.user.tag} warned ${user.tag} (${user.id}).`,
      [
        {
          name:
            'reason',

          value:
            truncate(
              reason,
              1000,
            ),
        },
      ],
    );

    return;
  }

  // ==========================================================================
  // WARNINGS
  // ==========================================================================

  if (
    name ===
    'warnings'
  ) {
    const staff =
      await requireStaff(
        interaction,
      );

    if (!staff) {
      return;
    }

    const user =
      interaction.options
        .getUser(
          'user',
        );

    const warnings =
      sql.getWarnings.all(
        interaction.guildId,
        user.id,
      );

    let description =
      'no warnings.';

    if (
      warnings.length
    ) {
      description =
        warnings.map(
          (warning) => {
            return [
              `**#${warning.id}**`,
              `<t:${Math.floor(
                warning.created_at /
                1000,
              )}:R>`,
              `by <@${warning.moderator_id}>`,
              '',
              truncate(
                warning.reason,
                250,
              ),
            ].join(' ');
          },
        ).join(
          '\n\n',
        );
    }

    await interaction.reply({
      embeds: [
        baseEmbed()
          .setTitle(
            `warnings // ${user.username}`,
          )
          .setThumbnail(
            user.displayAvatarURL({
              size:
                256,
            }),
          )
          .setDescription(
            description,
          ),
      ],

      ephemeral:
        true,
    });

    return;
  }

  // ==========================================================================
  // CLEAR WARNINGS
  // ==========================================================================

  if (
    name ===
    'clearwarnings'
  ) {
    const staff =
      await requireStaff(
        interaction,
      );

    if (!staff) {
      return;
    }

    const user =
      interaction.options
        .getUser(
          'user',
        );

    const target =
      await interaction.guild.members
        .fetch(
          user.id,
        )
        .catch(() => null);

    if (
      target &&
      !await canModerateTarget(
        staff,
        target,
      )
    ) {
      await interaction.reply({
        content:
          'you cannot manage warnings for that member.',

        ephemeral:
          true,
      });

      return;
    }

    const result =
      sql.clearWarnings.run(
        interaction.guildId,
        user.id,
      );

    await interaction.reply({
      embeds: [
        successEmbed(
          'warnings cleared',
          `removed **${result.changes}** warning(s) from ${user}.`,
        ),
      ],

      ephemeral:
        true,
    });

    await logEvent(
      'warnings cleared',
      `${staff.user.tag} cleared ${result.changes} warning(s) from ${user.tag}.`,
    );

    return;
  }

  // ==========================================================================
  // CLEAR MESSAGES
  // ==========================================================================

  if (
    name ===
    'clear'
  ) {
    const staff =
      await requireStaff(
        interaction,
      );

    if (!staff) {
      return;
    }

    const amount =
      interaction.options
        .getInteger(
          'amount',
        );

    if (
      !interaction.channel
        ?.isTextBased() ||
      typeof interaction.channel
        .bulkDelete !==
        'function'
    ) {
      await interaction.reply({
        content:
          'message clearing is not supported in this channel.',

        ephemeral:
          true,
      });

      return;
    }

    const deleted =
      await interaction.channel
        .bulkDelete(
          amount,
          true,
        );

    await interaction.reply({
      content:
        `deleted **${deleted.size}** message(s).`,

      ephemeral:
        true,
    });

    await logEvent(
      'messages cleared',
      `${staff.user.tag} deleted ${deleted.size} messages in ${interaction.channel}.`,
    );

    return;
  }

  // ==========================================================================
  // TIMEOUT
  // ==========================================================================

  if (
    name ===
    'timeout'
  ) {
    const staff =
      await requireStaff(
        interaction,
      );

    if (!staff) {
      return;
    }

    const user =
      interaction.options
        .getUser(
          'user',
        );

    const minutes =
      interaction.options
        .getInteger(
          'minutes',
        );

    const reason =
      interaction.options
        .getString(
          'reason',
        ) ||
      'No reason provided';

    const target =
      await interaction.guild.members
        .fetch(
          user.id,
        )
        .catch(() => null);

    if (!target) {
      await interaction.reply({
        content:
          'that member is not in the server.',

        ephemeral:
          true,
      });

      return;
    }

    if (
      !await canModerateTarget(
        staff,
        target,
      )
    ) {
      await interaction.reply({
        content:
          'you cannot moderate that member.',

        ephemeral:
          true,
      });

      return;
    }

    if (
      !target.moderatable
    ) {
      await interaction.reply({
        content:
          'I cannot timeout that member. check bot role hierarchy.',

        ephemeral:
          true,
      });

      return;
    }

    await target.timeout(
      minutes *
      60_000,
      reason,
    );

    await interaction.reply({
      embeds: [
        successEmbed(
          'member timed out',
          [
            `${user}`,
            '',
            `duration: **${minutes}m**`,
            `reason: ${truncate(
              reason,
              900,
            )}`,
          ].join('\n'),
        ),
      ],

      ephemeral:
        true,
    });

    await user.send({
      embeds: [
        baseEmbed()
          .setTitle(
            '⚠ timeout // kvsarchive',
          )
          .setDescription(
            [
              `duration: **${minutes} minutes**`,
              '',
              `reason: ${reason}`,
            ].join('\n'),
          ),
      ],
    }).catch(() => null);

    await logEvent(
      'timeout',
      `${staff.user.tag} timed out ${user.tag} for ${minutes}m.`,
      [
        {
          name:
            'reason',

          value:
            truncate(
              reason,
            ),
        },
      ],
    );

    return;
  }

  // ==========================================================================
  // UNTIMEOUT
  // ==========================================================================

  if (
    name ===
    'untimeout'
  ) {
    const staff =
      await requireStaff(
        interaction,
      );

    if (!staff) {
      return;
    }

    const user =
      interaction.options
        .getUser(
          'user',
        );

    const reason =
      interaction.options
        .getString(
          'reason',
        ) ||
      'Timeout removed';

    const target =
      await interaction.guild.members
        .fetch(
          user.id,
        )
        .catch(() => null);

    if (!target) {
      await interaction.reply({
        content:
          'that member is not in the server.',

        ephemeral:
          true,
      });

      return;
    }

    if (
      !await canModerateTarget(
        staff,
        target,
      )
    ) {
      await interaction.reply({
        content:
          'you cannot moderate that member.',

        ephemeral:
          true,
      });

      return;
    }

    if (
      !target.moderatable
    ) {
      await interaction.reply({
        content:
          'I cannot modify that member.',

        ephemeral:
          true,
      });

      return;
    }

    await target.timeout(
      null,
      reason,
    );

    await interaction.reply({
      embeds: [
        successEmbed(
          'timeout removed',
          `${user} can talk again.`,
        ),
      ],

      ephemeral:
        true,
    });

    await logEvent(
      'timeout removed',
      `${staff.user.tag} removed ${user.tag}'s timeout.`,
    );

    return;
  }

  // ==========================================================================
  // KICK
  // ==========================================================================

  if (
    name ===
    'kick'
  ) {
    const staff =
      await requireStaff(
        interaction,
      );

    if (!staff) {
      return;
    }

    const user =
      interaction.options
        .getUser(
          'user',
        );

    const reason =
      interaction.options
        .getString(
          'reason',
        ) ||
      'No reason provided';

    const target =
      await interaction.guild.members
        .fetch(
          user.id,
        )
        .catch(() => null);

    if (!target) {
      await interaction.reply({
        content:
          'that member is not in the server.',

        ephemeral:
          true,
      });

      return;
    }

    if (
      !await canModerateTarget(
        staff,
        target,
      )
    ) {
      await interaction.reply({
        content:
          'you cannot moderate that member.',

        ephemeral:
          true,
      });

      return;
    }

    if (
      !target.kickable
    ) {
      await interaction.reply({
        content:
          'I cannot kick that member. check bot hierarchy.',

        ephemeral:
          true,
      });

      return;
    }

    await user.send({
      embeds: [
        baseEmbed()
          .setTitle(
            '⛧ removed // kvsarchive',
          )
          .setDescription(
            `reason: ${reason}`,
          ),
      ],
    }).catch(() => null);

    await target.kick(
      reason,
    );

    await interaction.reply({
      embeds: [
        successEmbed(
          'member kicked',
          `${user.tag} was removed.`,
        ),
      ],

      ephemeral:
        true,
    });

    await logEvent(
      'kick',
      `${staff.user.tag} kicked ${user.tag}.`,
      [
        {
          name:
            'reason',

          value:
            truncate(
              reason,
            ),
        },
      ],
    );

    return;
  }

  // ==========================================================================
  // BAN
  // ==========================================================================

  if (
    name ===
    'ban'
  ) {
    const staff =
      await requireStaff(
        interaction,
      );

    if (!staff) {
      return;
    }

    const user =
      interaction.options
        .getUser(
          'user',
        );

    const reason =
      interaction.options
        .getString(
          'reason',
        ) ||
      'No reason provided';

    const deleteHours =
      interaction.options
        .getInteger(
          'delete_hours',
        ) ||
      0;

    const target =
      await interaction.guild.members
        .fetch(
          user.id,
        )
        .catch(() => null);

    if (target) {
      if (
        !await canModerateTarget(
          staff,
          target,
        )
      ) {
        await interaction.reply({
          content:
            'you cannot moderate that member.',

          ephemeral:
            true,
        });

        return;
      }

      if (
        !target.bannable
      ) {
        await interaction.reply({
          content:
            'I cannot ban that member. check bot hierarchy.',

          ephemeral:
            true,
        });

        return;
      }
    }

    await user.send({
      embeds: [
        baseEmbed()
          .setTitle(
            '⛧ banned // kvsarchive',
          )
          .setDescription(
            `reason: ${reason}`,
          ),
      ],
    }).catch(() => null);

    await interaction.guild.members.ban(
      user.id,
      {
        deleteMessageSeconds:
          Math.min(
            deleteHours *
            3600,
            604800,
          ),

        reason:
          `${reason} | by ${staff.user.tag}`,
      },
    );

    await interaction.reply({
      embeds: [
        successEmbed(
          'member banned',
          `${user.tag} was banned.`,
        ),
      ],

      ephemeral:
        true,
    });

    await logEvent(
      'ban',
      `${staff.user.tag} banned ${user.tag} (${user.id}).`,
      [
        {
          name:
            'reason',

          value:
            truncate(
              reason,
            ),
        },
      ],
    );

    return;
  }

  // ==========================================================================
  // UNBAN
  // ==========================================================================

  if (
    name ===
    'unban'
  ) {
    const staff =
      await requireStaff(
        interaction,
      );

    if (!staff) {
      return;
    }

    const userId =
      interaction.options
        .getString(
          'userid',
        )
        .trim();

    const reason =
      interaction.options
        .getString(
          'reason',
        ) ||
      'Unbanned by staff';

    if (
      !/^\d{17,20}$/.test(
        userId,
      )
    ) {
      await interaction.reply({
        content:
          'that does not look like a valid Discord user ID.',

        ephemeral:
          true,
      });

      return;
    }

    const ban =
      await interaction.guild.bans
        .fetch(
          userId,
        )
        .catch(() => null);

    if (!ban) {
      await interaction.reply({
        content:
          'that user is not banned.',

        ephemeral:
          true,
      });

      return;
    }

    await interaction.guild.members
      .unban(
        userId,
        `${reason} | by ${staff.user.tag}`,
      );

    await interaction.reply({
      embeds: [
        successEmbed(
          'user unbanned',
          `${ban.user.tag} (\`${userId}\`) was unbanned.`,
        ),
      ],

      ephemeral:
        true,
    });

    await logEvent(
      'unban',
      `${staff.user.tag} unbanned ${ban.user.tag} (${userId}).`,
      [
        {
          name:
            'reason',

          value:
            truncate(
              reason,
            ),
        },
      ],
    );

    return;
  }

  // ==========================================================================
  // SLOWMODE
  // ==========================================================================

  if (
    name ===
    'slowmode'
  ) {
    const staff =
      await requireStaff(
        interaction,
      );

    if (!staff) {
      return;
    }

    const seconds =
      interaction.options
        .getInteger(
          'seconds',
        );

    const channel =
      interaction.options
        .getChannel(
          'channel',
        ) ||
      interaction.channel;

    if (
      !channel?.isTextBased() ||
      typeof channel
        .setRateLimitPerUser !==
        'function'
    ) {
      await interaction.reply({
        content:
          'choose a normal text channel.',

        ephemeral:
          true,
      });

      return;
    }

    // ------------------------------------------------------------------------
    // SPECIAL MEDIA CHANNEL PROTECTION
    // ------------------------------------------------------------------------

    if (
      [
        CONFIG.CHANNELS.PFP,
        CONFIG.CHANNELS.BANNER,
      ].includes(
        channel.id,
      ) &&
      seconds >
      0
    ) {
      await interaction.reply({
        embeds: [
          errorEmbed(
            [
              'do not use Discord native slowmode in pfp/banner.',
              '',
              'those channels use the bot-managed **5 minute cooldown** so the media-poster role can safely bypass it.',
              '',
              'leave native slowmode at **0** there.',
            ].join('\n'),
          ),
        ],

        ephemeral:
          true,
      });

      return;
    }

    await channel.setRateLimitPerUser(
      seconds,
      `Changed by ${staff.user.tag}`,
    );

    await interaction.reply({
      embeds: [
        successEmbed(
          'slowmode updated',
          `${channel} → **${seconds}s**`,
        ),
      ],

      ephemeral:
        true,
    });

    await logEvent(
      'slowmode changed',
      `${staff.user.tag} changed ${channel} slowmode to ${seconds}s.`,
    );

    return;
  }

  // ==========================================================================
  // LOCK / UNLOCK
  // ==========================================================================

  if (
    name ===
      'lock' ||
    name ===
      'unlock'
  ) {
    const staff =
      await requireStaff(
        interaction,
      );

    if (!staff) {
      return;
    }

    const channel =
      interaction.options
        .getChannel(
          'channel',
        ) ||
      interaction.channel;

    if (
      !channel?.isTextBased()
    ) {
      await interaction.reply({
        content:
          'choose a text channel.',

        ephemeral:
          true,
      });

      return;
    }

    const locked =
      name ===
      'lock';

    await channel.permissionOverwrites.edit(
      CONFIG.ROLES.MEMBER,
      {
        SendMessages:
          locked
            ? false
            : null,
      },
      {
        reason:
          `${locked ? 'Locked' : 'Unlocked'} by ${staff.user.tag}`,
      },
    );

    await interaction.reply({
      embeds: [
        successEmbed(
          locked
            ? 'channel locked'
            : 'channel unlocked',

          `${channel}`,
        ),
      ],

      ephemeral:
        true,
    });

    await logEvent(
      locked
        ? 'channel locked'
        : 'channel unlocked',

      `${staff.user.tag} ${locked ? 'locked' : 'unlocked'} ${channel}.`,
    );

    return;
  }

  // ==========================================================================
  // NICK
  // ==========================================================================

  if (
    name ===
    'nick'
  ) {
    const staff =
      await requireStaff(
        interaction,
      );

    if (!staff) {
      return;
    }

    const user =
      interaction.options
        .getUser(
          'user',
        );

    const nickname =
      interaction.options
        .getString(
          'nickname',
        );

    const target =
      await interaction.guild.members
        .fetch(
          user.id,
        )
        .catch(() => null);

    if (!target) {
      await interaction.reply({
        content:
          'that member is not in the server.',

        ephemeral:
          true,
      });

      return;
    }

    if (
      !await canModerateTarget(
        staff,
        target,
      )
    ) {
      await interaction.reply({
        content:
          'you cannot manage that member.',

        ephemeral:
          true,
      });

      return;
    }

    if (
      !target.manageable
    ) {
      await interaction.reply({
        content:
          'I cannot change that nickname. check bot hierarchy.',

        ephemeral:
          true,
      });

      return;
    }

    await target.setNickname(
      nickname ||
      null,
      `Changed by ${staff.user.tag}`,
    );

    await interaction.reply({
      embeds: [
        successEmbed(
          'nickname updated',
          nickname
            ? `${user} → **${nickname}**`
            : `${user}'s nickname was cleared.`,
        ),
      ],

      ephemeral:
        true,
    });

    return;
  }

  // ==========================================================================
  // PSA
  // ==========================================================================

  if (
    name ===
    'psa'
  ) {
    const management =
      await requireManagement(
        interaction,
      );

    if (!management) {
      return;
    }

    const text =
      interaction.options
        .getString(
          'message',
        );

    const title =
      interaction.options
        .getString(
          'title',
        ) ||
      'PSA';

    const channel =
      await interaction.guild.channels
        .fetch(
          CONFIG.CHANNELS.PSA,
        )
        .catch(() => null);

    if (
      !channel?.isTextBased()
    ) {
      await interaction.reply({
        content:
          'configured PSA channel could not be found.',

        ephemeral:
          true,
      });

      return;
    }

    await channel.send({
      embeds: [
        baseEmbed()
          .setTitle(
            `⚠ ${title}`,
          )
          .setDescription(
            text,
          )
          .setFooter({
            text:
              `posted by ${interaction.user.username}`,
          }),
      ],
    });

    await interaction.reply({
      content:
        `PSA posted in ${channel}.`,

      ephemeral:
        true,
    });

    await logEvent(
      'psa posted',
      `${interaction.user.tag} posted a PSA in ${channel}.`,
    );

    return;
  }

  // ==========================================================================
  // OWNER: SETUP
  // ==========================================================================

  if (
    name ===
    'setup'
  ) {
    if (
      !await requireOwner(
        interaction,
      )
    ) {
      return;
    }

    const panel =
      interaction.options
        .getString(
          'panel',
        );

    await interaction.deferReply({
      ephemeral:
        true,
    });

    const tasks = [];

    if (
      panel ===
        'all' ||
      panel ===
        'verify'
    ) {
      tasks.push({
        channelId:
          CONFIG.CHANNELS.VERIFY,

        payload:
          verifyPanel(),

        name:
          'verification',
      });
    }

    if (
      panel ===
        'all' ||
      panel ===
        'tickets'
    ) {
      tasks.push({
        channelId:
          CONFIG.CHANNELS.TICKETS,

        payload:
          ticketPanel(),

        name:
          'tickets',
      });
    }

    if (
      panel ===
        'all' ||
      panel ===
        'clubs'
    ) {
      tasks.push({
        channelId:
          CONFIG.CHANNELS.PRIVATE_CLUB_CMDS,

        payload:
          clubPanel(),

        name:
          'private clubs',
      });
    }

    if (
      panel ===
        'all' ||
      panel ===
        'info'
    ) {
      tasks.push({
        channelId:
          CONFIG.CHANNELS.SPECIALTY_INFO,

        payload:
          specialtyInfoPanel(),

        name:
          'specialty info',
      });
    }

    const completed = [];
    const failed = [];

    for (
      const task
      of tasks
    ) {
      const channel =
        await interaction.guild.channels
          .fetch(
            task.channelId,
          )
          .catch(() => null);

      if (
        !channel?.isTextBased()
      ) {
        failed.push(
          task.name,
        );

        continue;
      }

      try {
        await channel.send(
          task.payload,
        );

        completed.push(
          task.name,
        );
      } catch {
        failed.push(
          task.name,
        );
      }
    }

    const response = [
      `posted: ${
        completed.length
          ? completed.join(', ')
          : 'none'
      }`,
    ];

    if (
      failed.length
    ) {
      response.push(
        `failed: ${failed.join(', ')}`,
      );
    }

    await interaction.editReply({
      embeds: [
        successEmbed(
          'setup complete',
          response.join('\n'),
        ),
      ],
    });

    await logEvent(
      'owner setup',
      `${interaction.user.tag} ran /setup ${panel}.`,
    );

    return;
  }

  // ==========================================================================
  // OWNER: STAFF APPLICATION POST
  // ==========================================================================

  if (
    name ===
    'staffapppost'
  ) {
    if (
      !await requireOwner(
        interaction,
      )
    ) {
      return;
    }

    const channel =
      await interaction.guild.channels
        .fetch(
          CONFIG.CHANNELS.TICKETS,
        )
        .catch(() => null);

    if (
      !channel?.isTextBased()
    ) {
      await interaction.reply({
        content:
          'tickets channel could not be found.',

        ephemeral:
          true,
      });

      return;
    }

    await channel.send(
      staffApplicationPanel(),
    );

    await interaction.reply({
      embeds: [
        successEmbed(
          'applications opened',
          `staff application panel posted in ${channel}.`,
        ),
      ],

      ephemeral:
        true,
    });

    await logEvent(
      'staff applications opened',
      `${interaction.user.tag} posted the staff application panel.`,
    );

    return;
  }

  // ==========================================================================
  // OWNER: TEST
  // ==========================================================================

  if (
    name ===
    'test'
  ) {
    if (
      !await requireOwner(
        interaction,
      )
    ) {
      return;
    }

    const type =
      interaction.options
        .getString(
          'type',
        );

    const channel =
      await interaction.guild.channels
        .fetch(
          CONFIG.CHANNELS.TEST,
        )
        .catch(() => null);

    if (
      !channel?.isTextBased()
    ) {
      await interaction.reply({
        content:
          'configured test channel could not be found.',

        ephemeral:
          true,
      });

      return;
    }

    // ------------------------------------------------------------------------
    // WELCOME
    // ------------------------------------------------------------------------

    if (
      type ===
      'welcome'
    ) {
      const member =
        await interaction.guild.members
          .fetch(
            interaction.user.id,
          );

      await channel.send({
        content:
          `${interaction.user}`,

        embeds: [
          welcomeEmbed(
            member,
          ),
        ],
      });
    }

    // ------------------------------------------------------------------------
    // VERIFY PANEL
    // ------------------------------------------------------------------------

    if (
      type ===
      'verify'
    ) {
      await channel.send(
        verifyPanel(),
      );
    }

    // ------------------------------------------------------------------------
    // TICKET PANEL
    // ------------------------------------------------------------------------

    if (
      type ===
      'tickets'
    ) {
      await channel.send(
        ticketPanel(),
      );
    }

    // ------------------------------------------------------------------------
    // CLUB PANEL
    // ------------------------------------------------------------------------

    if (
      type ===
      'clubs'
    ) {
      await channel.send(
        clubPanel(),
      );
    }

    // ------------------------------------------------------------------------
    // INFO PANEL
    // ------------------------------------------------------------------------

    if (
      type ===
      'info'
    ) {
      await channel.send(
        specialtyInfoPanel(),
      );
    }

    // ------------------------------------------------------------------------
    // STAFF APPLICATION
    // ------------------------------------------------------------------------

    if (
      type ===
      'staffapp'
    ) {
      await channel.send(
        staffApplicationPanel(),
      );
    }

    // ------------------------------------------------------------------------
    // CAPTCHA
    // ------------------------------------------------------------------------

    if (
      type ===
      'captcha'
    ) {
      const code =
        verificationCode();

      const png =
        renderCaptcha(
          code,
        );

      await channel.send({
        content:
          `test captcha answer: ||${code}||`,

        files: [
          new AttachmentBuilder(
            png,
            {
              name:
                'captcha-test.png',
            },
          ),
        ],
      });
    }

    await interaction.reply({
      content:
        `sent **${type}** test to ${channel}.`,

      ephemeral:
        true,
    });

    return;
  }

  // ==========================================================================
  // OWNER: XP CONTROL
  // ==========================================================================

  if (
    name ===
    'xp'
  ) {
    if (
      !await requireOwner(
        interaction,
      )
    ) {
      return;
    }

    const subcommand =
      interaction.options
        .getSubcommand();

    const user =
      interaction.options
        .getUser(
          'user',
        );

    const amount =
      interaction.options
        .getInteger(
          'amount',
        );

    sql.ensureUser.run(
      user.id,
    );

    const before =
      sql.getUser.get(
        user.id,
      );

    // ------------------------------------------------------------------------
    // ADD
    // ------------------------------------------------------------------------

    if (
      subcommand ===
      'add'
    ) {
      ownerXpSql.add.run(
        amount,
        user.id,
      );
    }

    // ------------------------------------------------------------------------
    // REMOVE
    // ------------------------------------------------------------------------

    if (
      subcommand ===
      'remove'
    ) {
      ownerXpSql.remove.run(
        amount,
        amount,
        user.id,
      );
    }

    // ------------------------------------------------------------------------
    // SET
    // ------------------------------------------------------------------------

    if (
      subcommand ===
      'set'
    ) {
      ownerXpSql.set.run(
        amount,
        user.id,
      );
    }

    const after =
      sql.getUser.get(
        user.id,
      );

    const oldLevel =
      levelFromXp(
        before.xp,
      );

    const newLevel =
      levelFromXp(
        after.xp,
      );

    const member =
      await interaction.guild.members
        .fetch(
          user.id,
        )
        .catch(() => null);

    if (member) {
      await syncManualXpRoles(
        member,
        newLevel,
      );
    }

    await interaction.reply({
      embeds: [
        successEmbed(
          'xp updated',
          [
            `${user}`,
            '',
            `before: **${before.xp.toLocaleString()} XP** · lvl ${oldLevel}`,
            `after: **${after.xp.toLocaleString()} XP** · lvl ${newLevel}`,
          ].join('\n'),
        ),
      ],

      ephemeral:
        true,
    });

    await logEvent(
      'owner xp change',
      [
        `${interaction.user.tag} used /xp ${subcommand} on ${user.tag}.`,
        `amount: ${amount}`,
        `before: ${before.xp}`,
        `after: ${after.xp}`,
      ].join('\n'),
    );

    return;
  }

  // ==========================================================================
  // OWNER: SYNC ALL LEVEL ROLES
  // ==========================================================================

  if (
    name ===
    'synclevelroles'
  ) {
    if (
      !await requireOwner(
        interaction,
      )
    ) {
      return;
    }

    await interaction.deferReply({
      ephemeral:
        true,
    });

    const result =
      await resyncAllLevelRoles(
        interaction.guild,
      );

    await interaction.editReply({
      embeds: [
        successEmbed(
          'level roles synced',
          [
            `members processed: **${result.processed}**`,
            `members changed: **${result.changed}**`,
          ].join('\n'),
        ),
      ],
    });

    return;
  }

  // ==========================================================================
  // OWNER: SAY
  // ==========================================================================

  if (
    name ===
    'say'
  ) {
    if (
      !await requireOwner(
        interaction,
      )
    ) {
      return;
    }

    const channel =
      interaction.options
        .getChannel(
          'channel',
        );

    const message =
      interaction.options
        .getString(
          'message',
        );

    if (
      !channel?.isTextBased()
    ) {
      await interaction.reply({
        content:
          'choose a text channel.',

        ephemeral:
          true,
      });

      return;
    }

    await channel.send({
      content:
        message,

      allowedMentions: {
        parse: [
          'users',
          'roles',
        ],
      },
    });

    await interaction.reply({
      content:
        `sent in ${channel}.`,

      ephemeral:
        true,
    });

    return;
  }

  // ==========================================================================
  // OWNER: CUSTOM EMBED
  // ==========================================================================

  if (
    name ===
    'embedpost'
  ) {
    if (
      !await requireOwner(
        interaction,
      )
    ) {
      return;
    }

    const channel =
      interaction.options
        .getChannel(
          'channel',
        );

    const title =
      interaction.options
        .getString(
          'title',
        );

    const description =
      interaction.options
        .getString(
          'description',
        );

    if (
      !channel?.isTextBased()
    ) {
      await interaction.reply({
        content:
          'choose a text channel.',

        ephemeral:
          true,
      });

      return;
    }

    await channel.send({
      embeds: [
        baseEmbed()
          .setTitle(
            title,
          )
          .setDescription(
            description,
          ),
      ],
    });

    await interaction.reply({
      content:
        `embed posted in ${channel}.`,

      ephemeral:
        true,
    });

    return;
  }

  // ==========================================================================
  // UNKNOWN
  // ==========================================================================

  await interaction.reply({
    content:
      'that command exists but has no handler.',

    ephemeral:
      true,
  });
}

// ============================================================================
// ERROR HANDLING
// ============================================================================

process.on(
  'unhandledRejection',
  (error) => {
    console.error(
      '[unhandledRejection]',
      error,
    );
  },
);

process.on(
  'uncaughtException',
  (error) => {
    console.error(
      '[uncaughtException]',
      error,
    );
  },
);

// ============================================================================
// GRACEFUL SHUTDOWN
// ============================================================================

let shuttingDown =
  false;

async function shutdown(
  signal,
) {
  if (
    shuttingDown
  ) {
    return;
  }

  shuttingDown =
    true;

  console.log(
    `[shutdown] received ${signal}`,
  );

  try {
    db.pragma(
      'wal_checkpoint(TRUNCATE)',
    );
  } catch {}

  try {
    db.close();
  } catch {}

  try {
    client.destroy();
  } catch {}

  console.log(
    '[shutdown] complete',
  );

  process.exit(
    0,
  );
}

process.on(
  'SIGINT',
  () => {
    shutdown(
      'SIGINT',
    );
  },
);

process.on(
  'SIGTERM',
  () => {
    shutdown(
      'SIGTERM',
    );
  },
);

// ============================================================================
// TOKEN CHECK
// ============================================================================

if (
  !process.env.DISCORD_TOKEN
) {
  console.error(
    '',
  );

  console.error(
    '============================================================',
  );

  console.error(
    'kvsarchive startup failed',
  );

  console.error(
    'DISCORD_TOKEN is missing from your .env file.',
  );

  console.error(
    '',
  );

  console.error(
    'your .env should contain:',
  );

  console.error(
    'DISCORD_TOKEN=YOUR_TOKEN_HERE',
  );

  console.error(
    '============================================================',
  );

  console.error(
    '',
  );

  process.exit(
    1,
  );
}

// ============================================================================
// LOGIN
// ============================================================================

console.log(
  '============================================================',
);

console.log(
  'kvsarchive',
);

console.log(
  'starting archive systems...',
);

console.log(
  `guild: ${CONFIG.GUILD_ID}`,
);

console.log(
  `owner whitelist: ${CONFIG.OWNER_IDS.join(', ')}`,
);

console.log(
  '============================================================',
);

client.login(
  process.env.DISCORD_TOKEN,
);