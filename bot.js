const {
  Client, GatewayIntentBits, Partials,
  EmbedBuilder, AttachmentBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle,
  ChannelSelectMenuBuilder, StringSelectMenuBuilder,
  PermissionsBitField, PermissionFlagsBits,
  ChannelType, MessageFlags,
} = require('discord.js');
require('dotenv').config();
const { generateCode, generateCaptchaImage } = require('./captcha');
const fs   = require('fs');
const path = require('path');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel, Partials.Message],
});

const SESSIONS_DIR = './sessions';

// guildSessions: Map<guildId, Map<userId, session>>
// guildConfigs:  Map<guildId, { honeypotChannelId, modLogChannelId, verificationCategoryId, action }>
// setupSessions: Map<userId-guildId, temp setup state>
const guildSessions = new Map();
const guildConfigs  = new Map();
const setupSessions = new Map();
let incidentCounter = Math.floor(Math.random() * 20) + 1;

// ─── Persistence ──────────────────────────────────────────────────────────────

function getGuildDir(guildId) {
  return path.join(SESSIONS_DIR, guildId);
}

function getSessions(guildId) {
  if (!guildSessions.has(guildId)) guildSessions.set(guildId, new Map());
  return guildSessions.get(guildId);
}

function saveGuildSessions(guildId) {
  const sessions = guildSessions.get(guildId);
  if (!sessions) return;
  try {
    const dir = getGuildDir(guildId);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'sessions.json'), JSON.stringify([...sessions.entries()], null, 2));
  } catch (err) {
    console.error(`Failed to save sessions for guild ${guildId}:`, err);
  }
}

function saveGuildConfig(guildId) {
  const config = guildConfigs.get(guildId);
  if (!config) return;
  try {
    const dir = getGuildDir(guildId);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(config, null, 2));
  } catch (err) {
    console.error(`Failed to save config for guild ${guildId}:`, err);
  }
}

function loadGuildConfig(guildId) {
  try {
    const file = path.join(getGuildDir(guildId), 'config.json');
    if (!fs.existsSync(file)) return null;
    const config = JSON.parse(fs.readFileSync(file, 'utf8'));
    guildConfigs.set(guildId, config);
    return config;
  } catch (err) {
    console.error(`Failed to load config for guild ${guildId}:`, err);
    return null;
  }
}

function loadGuildSessions(guildId) {
  try {
    const file = path.join(getGuildDir(guildId), 'sessions.json');
    if (!fs.existsSync(file)) return;
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    const map  = new Map();
    for (const [userId, session] of data) map.set(userId, session);
    guildSessions.set(guildId, map);
    console.log(`📂 Loaded ${map.size} session(s) for guild ${guildId}`);
  } catch (err) {
    console.error(`Failed to load sessions for guild ${guildId}:`, err);
  }
}

function loadAllGuilds() {
  if (!fs.existsSync(SESSIONS_DIR)) return;
  const dirs = fs.readdirSync(SESSIONS_DIR, { withFileTypes: true }).filter(d => d.isDirectory());
  for (const entry of dirs) {
    loadGuildConfig(entry.name);
    loadGuildSessions(entry.name);
  }
  console.log(`📂 Loaded data for ${dirs.length} guild(s)`);
}

function getSessionForUser(userId) {
  for (const [guildId, sessions] of guildSessions) {
    if (sessions.has(userId)) return { guildId, sessions, session: sessions.get(userId) };
  }
  return null;
}

// Returns the session that owns the given private channel ID
function findSessionByPrivateChannel(channelId) {
  for (const [guildId, sessions] of guildSessions) {
    for (const [userId, session] of sessions) {
      if (session.privateChannelId === channelId) return { guildId, userId, sessions, session };
    }
  }
  return null;
}

// ─── Setup form ───────────────────────────────────────────────────────────────

const ACTION_LABELS = { softban: 'Softban (kick)', ban: 'Ban', disabled: 'Disabled' };

function buildSetupEmbed(state, guildName) {
  return new EmbedBuilder()
    .setTitle('🍯 Honeypot')
    .setColor(0x5865f2)
    .setDescription(
      '-# ⚠️ This form will be submitted to Honeypot. Do not share passwords or other sensitive information.\n\n' +
      'Use the menus below to configure, then click **Submit**.\n' +
      'Channels left unset will be **auto-created**. Action is required.'
    )
    .addFields(
      { name: 'Honeypot Channel',        value: state.honeypotChannelId      ? `<#${state.honeypotChannelId}>`      : '*auto-create*',    inline: true },
      { name: 'Log Channel',             value: state.modLogChannelId        ? `<#${state.modLogChannelId}>`        : '*auto-create*',    inline: true },
      { name: 'Verification Category',   value: state.verificationCategoryId ? `<#${state.verificationCategoryId}>` : '*auto-create*',    inline: true },
      { name: 'Action *',                value: state.action ? ACTION_LABELS[state.action] : '*not selected*',       inline: true },
    )
    .setFooter({ text: guildName });
}

function buildSetupComponents(state) {
  const honeypotSelect = new ChannelSelectMenuBuilder()
    .setCustomId('hp_setup_honeypot')
    .setPlaceholder('Honeypot Channel (optional — auto-creates if empty)')
    .setChannelTypes(ChannelType.GuildText)
    .setMinValues(0)
    .setMaxValues(1);
  if (state.honeypotChannelId) honeypotSelect.setDefaultChannels([state.honeypotChannelId]);

  const modlogSelect = new ChannelSelectMenuBuilder()
    .setCustomId('hp_setup_modlog')
    .setPlaceholder('Log Channel (optional — auto-creates if empty)')
    .setChannelTypes(ChannelType.GuildText)
    .setMinValues(0)
    .setMaxValues(1);
  if (state.modLogChannelId) modlogSelect.setDefaultChannels([state.modLogChannelId]);

  const categorySelect = new ChannelSelectMenuBuilder()
    .setCustomId('hp_setup_category')
    .setPlaceholder('Verification Category (optional — auto-creates if empty)')
    .setChannelTypes(ChannelType.GuildCategory)
    .setMinValues(0)
    .setMaxValues(1);
  if (state.verificationCategoryId) categorySelect.setDefaultChannels([state.verificationCategoryId]);

  return [
    new ActionRowBuilder().addComponents(honeypotSelect),
    new ActionRowBuilder().addComponents(modlogSelect),
    new ActionRowBuilder().addComponents(categorySelect),
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('hp_setup_action')
        .setPlaceholder('Action *')
        .addOptions([
          { label: 'Softban (kick)', value: 'softban', description: 'Quarantine + captcha. Kicks on failure.',           emoji: '👢', default: state.action === 'softban'  },
          { label: 'Ban',            value: 'ban',     description: 'Quarantine + captcha. Permanently bans on failure.', emoji: '🔨', default: state.action === 'ban'      },
          { label: 'Disabled',       value: 'disabled',description: 'Log only. No quarantine or enforcement.',            emoji: '🔕', default: state.action === 'disabled' },
        ])
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('hp_setup_submit').setLabel('Submit').setStyle(ButtonStyle.Primary).setDisabled(!state.action),
      new ButtonBuilder().setCustomId('hp_setup_cancel').setLabel('Cancel').setStyle(ButtonStyle.Secondary),
    ),
  ];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function tsDeadline() {
  const unix = Math.floor((Date.now() + 7 * 24 * 60 * 60 * 1000) / 1000);
  return `<t:${unix}:F> (<t:${unix}:R>)`;
}

function makeAttachment(code) {
  return new AttachmentBuilder(generateCaptchaImage(code), { name: 'captcha.png' });
}

function freshCode(session, resetAttempts = false) {
  session.code = generateCode(5);
  if (resetAttempts) session.attempts = 0;
  return session;
}

async function cleanupOrphanedVerificationChannels(guild) {
  const sessions    = getSessions(guild.id);
  const activeChans = new Set([...sessions.values()].map(s => s.privateChannelId).filter(Boolean));
  const activeRoles = new Set([...sessions.values()].map(s => s.privateRoleId).filter(Boolean));

  for (const [, channel] of guild.channels.cache) {
    if (channel.name.startsWith('verify-') && !activeChans.has(channel.id)) {
      try { await channel.delete('Orphaned verification channel'); } catch {}
    }
  }
  for (const [, role] of guild.roles.cache) {
    if (role.name.startsWith('block-') && !activeRoles.has(role.id)) {
      try { await role.delete('Orphaned verification role'); } catch {}
    }
  }
}

// ─── Embeds ───────────────────────────────────────────────────────────────────

function warningEmbed(guildName, incidentId, detectedMsg) {
  return new EmbedBuilder()
    .setColor(0xcc0000)
    .setTitle('Security Warning: Account possibly compromised')
    .setDescription(
      'Our systems detected a message from your account in an internal security channel. ' +
      'Your account has been placed in a security quarantine as a precaution. ' +
      'You temporarily cannot send messages.'
    )
    .addFields(
      { name: 'Incident ID', value: String(incidentId), inline: true },
      { name: 'Deadline',    value: tsDeadline(),        inline: true },
      { name: 'What you can do now', value:
        '1. Change your Discord password\n' +
        '2. Enable 2FA\n' +
        '3. Remove suspicious apps/extensions\n' +
        '4. Then click **Yes, account secured** or type the captcha code directly\n' +
        '5. Complete the captcha to be unblocked'
      },
      { name: 'Important if you click "Ignore"', value:
        'If you ignore this, the security quarantine stays active and your account remains restricted.'
      },
      { name: 'Detected Message', value: detectedMsg.slice(0, 100) || '(empty)' },
    )
    .setFooter({ text: `Server: ${guildName}` })
    .setTimestamp();
}

function warningButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('hp_secured').setLabel('Yes, account secured').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('hp_tips').setLabel('Security Tips').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('hp_ignore').setLabel('Ignore').setStyle(ButtonStyle.Danger),
  );
}

function captchaEmbed(session, guildName) {
  return new EmbedBuilder()
    .setColor(0x2b2d31)
    .setTitle('Security Check Required')
    .setDescription(
      'Solve the captcha below to regain access.\n' +
      '**Click the button** or **type the code directly in this chat**.'
    )
    .addFields(
      { name: 'Valid for',          value: 'Until solved',               inline: true },
      { name: 'Remaining attempts', value: String(5 - session.attempts), inline: true },
    )
    .setImage('attachment://captcha.png')
    .setFooter({ text: `Server: ${guildName}` })
    .setTimestamp();
}

function captchaButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('hp_captcha_enter').setLabel('Enter Captcha').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('hp_captcha_new').setLabel('New Captcha').setStyle(ButtonStyle.Secondary),
  );
}

function unlockedEmbed() {
  return new EmbedBuilder()
    .setColor(0x00cc66)
    .setTitle('Account Unlocked')
    .setDescription('Captcha correct. Your security quarantine has been lifted.')
    .setTimestamp();
}

function tipsEmbed() {
  return new EmbedBuilder()
    .setColor(0x4d96ff)
    .setTitle('Security Tips')
    .setDescription(
      '**How to secure your Discord account:**\n\n' +
      '🔑 **Change your password** → Settings → My Account → Change Password\n\n' +
      '📱 **Enable 2FA** → Settings → My Account → Enable Two-Factor Auth\n\n' +
      '🔌 **Remove suspicious apps** → Settings → Authorized Apps\n\n' +
      '📧 **Check your email** for suspicious login notifications from Discord\n\n' +
      '🚫 **Never click unknown links** in Discord — they can steal your account token\n\n' +
      'Once secured, click **Yes, account secured** to proceed.'
    );
}

// ─── Guild ops ────────────────────────────────────────────────────────────────

async function applyTimeout(member) {
  try {
    await member.timeout(7 * 24 * 60 * 60 * 1000, 'Honeypot triggered — DM captcha pending');
  } catch (err) {
    console.error('Timeout restriction failed:', err.message);
  }
}

async function removeTimeout(member) {
  try {
    if (member.communicationDisabledUntilTimestamp && member.communicationDisabledUntilTimestamp > Date.now()) {
      await member.timeout(null, 'Quarantine lifted');
    }
  } catch {}
}

async function muteInAllChannels(guild, userId, exceptChannelId = null) {
  const textChannels = guild.channels.cache.filter(ch => ch.isTextBased());
  for (const [, channel] of textChannels) {
    if (channel.id === exceptChannelId) continue;
    try {
      await channel.permissionOverwrites.create(userId, {
        SendMessages: false,
        AddReactions: false,
      }, { reason: 'Honeypot server-wide chat quarantine' });
    } catch {}
  }
}

async function unmuteInAllChannels(guild, userId) {
  const textChannels = guild.channels.cache.filter(ch => ch.isTextBased());
  for (const [, channel] of textChannels) {
    try {
      const overwrite = channel.permissionOverwrites.cache.get(userId);
      if (overwrite) await overwrite.delete('Quarantine lifted');
    } catch {}
  }
}

async function createPrivateChannel(guild, user) {
  const config   = guildConfigs.get(guild.id);
  const category = config?.verificationCategoryId
    ? (guild.channels.cache.get(config.verificationCategoryId) ?? null)
    : null;

  const userRole = await guild.roles.create({
    name: `block-${user.username}-${user.id.slice(-4)}`,
    reason: 'Honeypot: private verification access',
    permissions: [],
  });

  const member = await guild.members.fetch(user.id);
  await member.roles.add(userRole);

  const channel = await guild.channels.create({
    name:   `verify-${user.username}`,
    type:   ChannelType.GuildText,
    parent: category,
    permissionOverwrites: [
      { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      {
        id: userRole.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.UseApplicationCommands,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.AttachFiles,
          PermissionFlagsBits.EmbedLinks,
        ],
      },
      {
        id: guild.members.me.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ManageMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.AttachFiles,
          PermissionFlagsBits.EmbedLinks,
        ],
      },
    ],
    reason: `Honeypot: private verification for ${user.tag}`,
  });

  return { channel, userRole };
}

async function cleanupPrivateChannel(guild, session) {
  if (session.privateChannelId) {
    try {
      const ch = guild.channels.cache.get(session.privateChannelId);
      if (ch) await ch.delete('Verification complete');
    } catch {}
  }
  if (session.privateRoleId) {
    try {
      const role = guild.roles.cache.get(session.privateRoleId);
      if (role) await role.delete('Verification complete');
    } catch {}
  }
}

async function modLog(guild, embed) {
  const config = guildConfigs.get(guild.id);
  if (!config?.modLogChannelId) return;
  try {
    const ch = guild.channels.cache.get(config.modLogChannelId);
    if (ch) await ch.send({ embeds: [embed] });
  } catch {}
}

async function purgeRecentMessages(guild, userId, session, withinMs = 5 * 60 * 1000) {
  const config = guildConfigs.get(guild.id);
  const cutoff = Date.now() - withinMs;
  const skipChannels = new Set([
    config?.honeypotChannelId,
    session?.privateChannelId,
  ].filter(Boolean));

  const textChannels = guild.channels.cache.filter(
    ch => ch.isTextBased() && ch.viewable && !skipChannels.has(ch.id)
  );

  for (const [, channel] of textChannels) {
    try {
      const messages = await channel.messages.fetch({ limit: 100 });
      const toDelete  = messages.filter(m => m.author.id === userId && m.createdTimestamp > cutoff);
      if (toDelete.size === 0) continue;
      if (toDelete.size === 1) {
        await toDelete.first().delete();
      } else {
        await channel.bulkDelete(toDelete, true);
      }
    } catch {}
  }
}

async function restoreMember(guild, user, session) {
  const member = await guild.members.fetch(user.id);
  await removeTimeout(member);
  await unmuteInAllChannels(guild, user.id);
  await modLog(guild, new EmbedBuilder()
    .setTitle('✅ Honeypot: Captcha Passed')
    .setColor(0x00cc66)
    .addFields(
      { name: 'User',   value: `${user.tag} (${user.id})`, inline: true },
      { name: 'Status', value: session.usingDM ? 'Timeout removed' : 'Server overrides & channel deleted', inline: true }
    )
    .setTimestamp()
  );
}

async function sendWarning(target, session, detectedMsg, userId) {
  await target.send({
    content: userId ? `<@${userId}>` : undefined,
    embeds: [warningEmbed(session.guildName, session.incidentId, detectedMsg)],
    components: [warningButtons()],
  });
}

// ─── Channel creation ─────────────────────────────────────────────────────────

async function createHoneypotChannel(guild) {
  return guild.channels.create({
    name: 'honeypot',
    type: ChannelType.GuildText,
    permissionOverwrites: [
      {
        id: guild.roles.everyone.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.AttachFiles,
          PermissionFlagsBits.EmbedLinks,
          PermissionFlagsBits.UseExternalEmojis,
        ],
      },
      {
        id: guild.members.me.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ManageMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.AttachFiles,
          PermissionFlagsBits.EmbedLinks,
        ],
      },
    ],
    reason: 'Honeypot: auto-created trap channel',
  });
}

async function createModLogChannel(guild) {
  return guild.channels.create({
    name: 'honeypot-logs',
    type: ChannelType.GuildText,
    permissionOverwrites: [
      { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      {
        id: guild.members.me.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.AttachFiles,
          PermissionFlagsBits.EmbedLinks,
        ],
      },
    ],
    reason: 'Honeypot: auto-created mod log channel',
  });
}

async function createVerificationCategory(guild) {
  return guild.channels.create({
    name: 'Verification',
    type: ChannelType.GuildCategory,
    permissionOverwrites: [
      { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      {
        id: guild.members.me.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.ManageChannels,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.AttachFiles,
          PermissionFlagsBits.EmbedLinks,
        ],
      },
    ],
    reason: 'Honeypot: auto-created verification category',
  });
}

async function postHoneypotStatus(channel) {
  try {
    const recent = await channel.messages.fetch({ limit: 50 });
    const old    = recent.filter(m => m.author.id === client.user.id);
    for (const [, m] of old) { try { await m.delete(); } catch {} }

    const statusEmbed = new EmbedBuilder()
      .setColor(0xcc0000)
      .setAuthor({ name: 'Security Honeypot' })
      .setTitle('⚠️ DO NOT SEND MESSAGES IN THIS CHANNEL! ⚠️')
      .setDescription(
        '🚨 **YOU WILL BE QUARANTINED!** 🚨\n\n' +
        'This channel is a security honeypot used to detect compromised accounts.\n\n' +
        '**EVERY** message triggers an **automatic security quarantine**.\n\n' +
        'If you want to know why this channel exists, click **Learn More**.'
      )
      .addFields({ name: 'Honeypot active! Last started', value: `<t:${Math.floor(Date.now() / 1000)}:F>` })
      .setFooter({ text: 'Any message sent here results in an immediate restriction.' })
      .setTimestamp();

    await channel.send({
      embeds:     [statusEmbed],
      components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('hp_learn_more').setLabel('Learn More').setStyle(ButtonStyle.Secondary)
      )],
    });
    console.log(`📋 Honeypot status posted in #${channel.name} (${channel.guild?.name})`);
  } catch (err) {
    console.error('Failed to post honeypot status:', err.message);
  }
}

// ─── Captcha typed-input handler (shared by private channel + DM paths) ───────

async function handleCaptchaTyped(userId, rawInput, replyChannel) {
  const result = getSessionForUser(userId);
  if (!result) return;
  const { guildId, sessions, session } = result;

  const input    = rawInput.trim().toUpperCase();
  const expected = session.code.toUpperCase();

  if (input === expected) {
    sessions.delete(userId);
    saveGuildSessions(guildId);

    let guild;
    try {
      guild = await client.guilds.fetch(guildId);
      const user = await client.users.fetch(userId);
      await restoreMember(guild, user, session);
    } catch (err) {
      console.error('Restore failed:', err.message);
      await replyChannel.send({ content: '✅ Correct! But couldn\'t restore you automatically — contact a moderator.' }).catch(() => {});
      return;
    }

    await replyChannel.send({ embeds: [unlockedEmbed()] }).catch(() => {});

    if (!session.usingDM) {
      await new Promise(r => setTimeout(r, 10_000));
      await cleanupPrivateChannel(guild, session);
    }
    return;
  }

  // Wrong answer
  session.attempts += 1;
  sessions.set(userId, session);
  saveGuildSessions(guildId);

  if (session.attempts >= 5) {
    sessions.delete(userId);
    saveGuildSessions(guildId);

    const guildConfig = guildConfigs.get(guildId);
    const isBan       = guildConfig?.action === 'ban';
    let guild;

    try {
      guild = await client.guilds.fetch(guildId);
      await modLog(guild, new EmbedBuilder()
        .setTitle(`❌ Honeypot: Max Attempts — ${isBan ? 'Banned' : 'Kicked'}`)
        .setColor(0xff0000)
        .addFields(
          { name: 'User',            value: `<@${userId}> (${userId})`,                          inline: true },
          { name: 'Failed Attempts', value: '5',                                                  inline: true },
          { name: 'Action',          value: isBan ? 'Permanently banned' : 'Kicked (10s delay)', inline: true }
        )
        .setTimestamp()
      );
    } catch {}

    await replyChannel.send({
      content: isBan
        ? '❌ **Too many failed attempts.** You will be **permanently banned** in 10s.\n\n> If this wasn\'t you, change your password and enable 2FA immediately.'
        : '❌ **Too many failed attempts.** You will be **kicked** in 10s. You can rejoin later.\n\n> If this wasn\'t you, change your password and enable 2FA immediately.',
    }).catch(() => {});

    await new Promise(r => setTimeout(r, 10_000));

    try {
      if (guild) {
        const member = await guild.members.fetch(userId).catch(() => null);
        if (member) {
          await removeTimeout(member);
          if (isBan) {
            if (member.bannable) await member.ban({ reason: 'Honeypot: Exceeded maximum captcha attempts.', deleteMessageSeconds: 3600 });
          } else {
            if (member.kickable) await member.kick('Honeypot: Exceeded maximum captcha attempts.');
          }
        }
        if (!isBan) await unmuteInAllChannels(guild, userId);
        await cleanupPrivateChannel(guild, session);
      }
    } catch (err) {
      console.error('Failed to enforce action after max attempts:', err.message);
    }
    return;
  }

  freshCode(session);
  sessions.set(userId, session);
  saveGuildSessions(guildId);

  const remaining = 5 - session.attempts;
  await replyChannel.send({
    content:    `❌ Wrong code. **${remaining} attempt(s) remaining.** Here's a new captcha:`,
    embeds:     [captchaEmbed(session, session.guildName)],
    files:      [makeAttachment(session.code)],
    components: [captchaButtons()],
  }).catch(() => {});
}

// ─── Ready ────────────────────────────────────────────────────────────────────

client.once('ready', async () => {
  console.log(`✅ Honeypot bot online: ${client.user.tag}`);
  loadAllGuilds();

  for (const [guildId, config] of guildConfigs) {
    try {
      const guild = await client.guilds.fetch(guildId).catch(() => null);
      if (!guild) continue;

      const sessions = getSessions(guildId);
      let changed = false;
      for (const [userId] of sessions) {
        const member = await guild.members.fetch(userId).catch(() => null);
        if (!member) { sessions.delete(userId); changed = true; }
      }
      if (changed) saveGuildSessions(guildId);

      await cleanupOrphanedVerificationChannels(guild);

      if (config.honeypotChannelId) {
        const channel = guild.channels.cache.get(config.honeypotChannelId);
        if (channel) await postHoneypotStatus(channel);
      }
    } catch (err) {
      console.error(`Ready: failed for guild ${guildId}:`, err.message);
    }
  }
});

// ─── Guild join ───────────────────────────────────────────────────────────────

client.on('guildCreate', async (guild) => {
  console.log(`📥 Joined guild: ${guild.name} (${guild.id})`);
  try {
    const owner = await guild.fetchOwner();
    await owner.send({
      embeds: [new EmbedBuilder()
        .setTitle('🍯 Honeypot Bot — Setup Required')
        .setColor(0xffcc00)
        .setDescription(
          `Thanks for adding Honeypot Bot to **${guild.name}**!\n\n` +
          '**Before running `/honeypot-setup`, do this first:**\n' +
          '1. Open **Server Settings → Roles**\n' +
          '2. Drag the **Honeypot** role to the **top** of the list (above all member roles)\n\n' +
          'The bot can only timeout, kick, or ban members whose highest role sits below its own. ' +
          'If the role is left at the bottom, quarantine enforcement will silently fail.\n\n' +
          'Once the role is moved up, run `/honeypot-setup` to finish configuring.'
        )
      ],
    });
  } catch {}
});

// ─── Auto-recreate deleted channels ──────────────────────────────────────────

client.on('channelDelete', async (channel) => {
  if (!channel.guild) return;
  const config = guildConfigs.get(channel.guild.id);
  if (!config) return;

  // Honeypot channel deleted → recreate
  if (channel.id === config.honeypotChannelId) {
    try {
      const newChannel = await createHoneypotChannel(channel.guild);
      config.honeypotChannelId = newChannel.id;
      saveGuildConfig(channel.guild.id);
      await postHoneypotStatus(newChannel);
      console.log(`♻️ Recreated honeypot channel in ${channel.guild.name}`);
    } catch (err) {
      console.error('Failed to recreate honeypot channel:', err.message);
    }
    return;
  }

  // Mod log channel deleted → recreate
  if (config.modLogChannelId && channel.id === config.modLogChannelId) {
    try {
      const newChannel = await createModLogChannel(channel.guild);
      config.modLogChannelId = newChannel.id;
      saveGuildConfig(channel.guild.id);
      console.log(`♻️ Recreated mod log channel in ${channel.guild.name}`);
    } catch (err) {
      console.error('Failed to recreate mod log channel:', err.message);
    }
    return;
  }

  // Verification category deleted → recreate
  if (config.verificationCategoryId && channel.id === config.verificationCategoryId) {
    try {
      const newCat = await createVerificationCategory(channel.guild);
      config.verificationCategoryId = newCat.id;
      saveGuildConfig(channel.guild.id);
      console.log(`♻️ Recreated verification category in ${channel.guild.name}`);
    } catch (err) {
      console.error('Failed to recreate verification category:', err.message);
    }
    return;
  }

  // Private verification channel deleted → recreate if session still active
  const pvResult = findSessionByPrivateChannel(channel.id);
  if (!pvResult) return;
  const { guildId, userId, sessions, session } = pvResult;
  if (session.usingDM) return;

  try {
    const guild    = channel.guild;
    const user     = await client.users.fetch(userId);
    const category = config.verificationCategoryId
      ? (guild.channels.cache.get(config.verificationCategoryId) ?? null)
      : null;

    // Reuse existing role if it still exists, otherwise create new role+channel
    const existingRole = guild.roles.cache.get(session.privateRoleId);
    let newChannel;

    if (existingRole) {
      newChannel = await guild.channels.create({
        name:   `verify-${user.username}`,
        type:   ChannelType.GuildText,
        parent: category,
        permissionOverwrites: [
          { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
          {
            id: existingRole.id,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.UseApplicationCommands,
              PermissionFlagsBits.ReadMessageHistory,
              PermissionFlagsBits.AttachFiles,
              PermissionFlagsBits.EmbedLinks,
            ],
          },
          {
            id: guild.members.me.id,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.ManageMessages,
              PermissionFlagsBits.ReadMessageHistory,
              PermissionFlagsBits.AttachFiles,
              PermissionFlagsBits.EmbedLinks,
            ],
          },
        ],
        reason: `Honeypot: recreated verification channel for ${user.tag}`,
      });
      session.privateChannelId = newChannel.id;
    } else {
      const created = await createPrivateChannel(guild, user);
      newChannel               = created.channel;
      session.privateChannelId = created.channel.id;
      session.privateRoleId    = created.userRole.id;
    }

    sessions.set(userId, session);
    saveGuildSessions(guildId);

    await newChannel.send({
      content:    `<@${userId}> Your verification channel was recreated. Please complete the captcha to regain access.`,
      embeds:     [captchaEmbed(session, session.guildName)],
      files:      [makeAttachment(session.code)],
      components: [captchaButtons()],
    });

    console.log(`♻️ Recreated private channel for user ${userId} in ${guild.name}`);
  } catch (err) {
    console.error(`Failed to recreate private channel for user ${userId}:`, err.message);
  }
});

// ─── Message events ───────────────────────────────────────────────────────────

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  // ── DM: accept captcha answer typed directly ──
  if (!message.guild) {
    const result = getSessionForUser(message.author.id);
    if (result?.session.usingDM) {
      await handleCaptchaTyped(message.author.id, message.content, message.channel);
    }
    return;
  }

  // ── Private verification channel: accept captcha answer typed directly ──
  const pvResult = findSessionByPrivateChannel(message.channel.id);
  if (pvResult) {
    if (pvResult.userId !== message.author.id) return;
    try { await message.delete(); } catch {}
    await handleCaptchaTyped(message.author.id, message.content, message.channel);
    return;
  }

  // ── Honeypot trigger ──
  const config = guildConfigs.get(message.guild.id);
  if (!config?.honeypotChannelId) return;
  if (message.channel.id !== config.honeypotChannelId) return;

  const sessions = getSessions(message.guild.id);

  if (sessions.has(message.author.id)) {
    try { await message.delete(); } catch {}
    return;
  }

  console.log(`🍯 Honeypot triggered by ${message.author.tag} (${message.author.id}) in ${message.guild.name}`);
  const detectedMsg = message.content || '(empty)';
  try { await message.delete(); } catch {}

  if (config.action === 'disabled') {
    await modLog(message.guild, new EmbedBuilder()
      .setTitle('🍯 Honeypot Triggered — Log Only')
      .setColor(0xffcc00)
      .addFields(
        { name: 'User',    value: `${message.author.tag} (${message.author.id})`, inline: true },
        { name: 'Message', value: detectedMsg.slice(0, 500) }
      )
      .setTimestamp()
    );
    return;
  }

  let member;
  try {
    member = await message.guild.members.fetch(message.author.id);
  } catch (err) {
    return console.error('Failed to fetch member:', err.message);
  }

  const session = {
    code:             generateCode(5),
    guildId:          message.guild.id,
    guildName:        message.guild.name,
    attempts:         0,
    incidentId:       incidentCounter++,
    usingDM:          false,
    privateChannelId: null,
    privateRoleId:    null,
  };

  sessions.set(message.author.id, session);
  purgeRecentMessages(message.guild, message.author.id, session).catch(() => {});

  let dmOpen = false;
  try {
    const dm = await message.author.createDM();
    await sendWarning(dm, session, detectedMsg, message.author.id);
    dmOpen = true;
    session.usingDM = true;
    console.log(`📨 Warning sent via DM to ${message.author.tag}`);
    await applyTimeout(member);
  } catch {
    console.log(`📭 DMs closed for ${message.author.tag} — establishing absolute channel-level mute`);
  }

  if (!dmOpen) {
    try {
      const { channel, userRole } = await createPrivateChannel(message.guild, message.author);
      session.privateChannelId = channel.id;
      session.privateRoleId    = userRole.id;
      await muteInAllChannels(message.guild, message.author.id, channel.id);
      await sendWarning(channel, session, detectedMsg, message.author.id);
      console.log(`📺 Private channel created: #${channel.name}`);
    } catch (err) {
      console.error('Private channel fallback failed:', err.message);
    }
  }

  saveGuildSessions(message.guild.id);

  await modLog(message.guild, new EmbedBuilder()
    .setTitle('🍯 Honeypot Triggered')
    .setColor(0xffcc00)
    .addFields(
      { name: 'User',     value: `${message.author.tag} (${message.author.id})`, inline: true },
      { name: 'Delivery', value: dmOpen ? '✅ DM (Timed Out)' : `📺 <#${session.privateChannelId}> (Absolute Muted)`, inline: true },
      { name: 'Message',  value: detectedMsg.slice(0, 500) }
    )
    .setTimestamp()
  );
});

// ─── Interactions ─────────────────────────────────────────────────────────────

client.on('interactionCreate', async (interaction) => {

  // ── Setup form ────────────────────────────────────────────────────────────

  if (interaction.isChannelSelectMenu() && interaction.customId === 'hp_setup_honeypot') {
    const key   = `${interaction.user.id}-${interaction.guild.id}`;
    const state = setupSessions.get(key);
    if (!state) return interaction.reply({ content: '⚙️ Setup session expired. Run `/honeypot-setup` again.', flags: MessageFlags.Ephemeral });
    state.honeypotChannelId = interaction.values[0] ?? null;
    return interaction.update({ embeds: [buildSetupEmbed(state, interaction.guild.name)], components: buildSetupComponents(state) });
  }

  if (interaction.isChannelSelectMenu() && interaction.customId === 'hp_setup_modlog') {
    const key   = `${interaction.user.id}-${interaction.guild.id}`;
    const state = setupSessions.get(key);
    if (!state) return interaction.reply({ content: '⚙️ Setup session expired. Run `/honeypot-setup` again.', flags: MessageFlags.Ephemeral });
    state.modLogChannelId = interaction.values[0] ?? null;
    return interaction.update({ embeds: [buildSetupEmbed(state, interaction.guild.name)], components: buildSetupComponents(state) });
  }

  if (interaction.isChannelSelectMenu() && interaction.customId === 'hp_setup_category') {
    const key   = `${interaction.user.id}-${interaction.guild.id}`;
    const state = setupSessions.get(key);
    if (!state) return interaction.reply({ content: '⚙️ Setup session expired. Run `/honeypot-setup` again.', flags: MessageFlags.Ephemeral });
    state.verificationCategoryId = interaction.values[0] ?? null;
    return interaction.update({ embeds: [buildSetupEmbed(state, interaction.guild.name)], components: buildSetupComponents(state) });
  }

  if (interaction.isStringSelectMenu() && interaction.customId === 'hp_setup_action') {
    const key   = `${interaction.user.id}-${interaction.guild.id}`;
    const state = setupSessions.get(key);
    if (!state) return interaction.reply({ content: '⚙️ Setup session expired. Run `/honeypot-setup` again.', flags: MessageFlags.Ephemeral });
    state.action = interaction.values[0];
    return interaction.update({ embeds: [buildSetupEmbed(state, interaction.guild.name)], components: buildSetupComponents(state) });
  }

  if (interaction.isButton() && interaction.customId === 'hp_setup_cancel') {
    setupSessions.delete(`${interaction.user.id}-${interaction.guild.id}`);
    return interaction.update({ content: '❌ Setup cancelled.', embeds: [], components: [] });
  }

  if (interaction.isButton() && interaction.customId === 'hp_setup_submit') {
    const key   = `${interaction.user.id}-${interaction.guild.id}`;
    const state = setupSessions.get(key);
    if (!state?.action) return interaction.reply({ content: '❌ Please select an action before submitting.', flags: MessageFlags.Ephemeral });

    setupSessions.delete(key);
    await interaction.deferUpdate();

    try {
      const honeypotChannel = state.honeypotChannelId
        ? interaction.guild.channels.cache.get(state.honeypotChannelId)
        : await createHoneypotChannel(interaction.guild);

      const modlogChannel = state.modLogChannelId
        ? interaction.guild.channels.cache.get(state.modLogChannelId)
        : await createModLogChannel(interaction.guild);

      const verificationCategory = state.verificationCategoryId
        ? interaction.guild.channels.cache.get(state.verificationCategoryId)
        : await createVerificationCategory(interaction.guild);

      const config = {
        honeypotChannelId:      honeypotChannel.id,
        modLogChannelId:        modlogChannel.id,
        verificationCategoryId: verificationCategory.id,
        action:                 state.action,
      };

      guildConfigs.set(interaction.guild.id, config);
      saveGuildConfig(interaction.guild.id);
      if (!guildSessions.has(interaction.guild.id)) guildSessions.set(interaction.guild.id, new Map());

      await postHoneypotStatus(honeypotChannel);

      const tag = (existing) => existing ? '' : ' *(auto-created)*';

      // Warn if the bot's role isn't near the top — enforcement silently fails otherwise
      const botRole    = interaction.guild.members.me.roles.botRole;
      const botPos     = botRole?.position ?? 0;
      const memberRoles = interaction.guild.roles.cache.filter(
        r => !r.managed && r.id !== interaction.guild.roles.everyone.id
      );
      const highestMemberPos = memberRoles.size
        ? Math.max(...memberRoles.map(r => r.position))
        : 0;
      const roleWarning = (botPos < highestMemberPos)
        ? `\n\n⚠️ **Role position warning:** The bot's role is not at the top of the role list. Go to **Server Settings → Roles** and drag **${botRole?.name ?? 'Honeypot'}** above all member roles, otherwise timeouts, kicks, and bans will fail silently.`
        : '';

      return interaction.editReply({
        content:
          `✅ Honeypot configured!\n` +
          `• Honeypot channel: <#${honeypotChannel.id}>${tag(state.honeypotChannelId)}\n` +
          `• Log channel: <#${modlogChannel.id}>${tag(state.modLogChannelId)}\n` +
          `• Verification category: **${verificationCategory.name}**${tag(state.verificationCategoryId)}\n` +
          `• Action: **${ACTION_LABELS[config.action]}**` +
          roleWarning,
        embeds:     [],
        components: [],
      });
    } catch (err) {
      console.error('Setup submit failed:', err);
      return interaction.editReply({ content: `❌ Setup failed: ${err.message}`, embeds: [], components: [] });
    }
  }

  // ── Captcha flow buttons ──────────────────────────────────────────────────

  if (interaction.isButton() && interaction.customId === 'hp_secured') {
    const result = getSessionForUser(interaction.user.id);
    if (!result) return interaction.reply({ content: '✅ No active quarantine found.', flags: MessageFlags.Ephemeral });
    const { session } = result;
    return interaction.reply({
      embeds:     [captchaEmbed(session, session.guildName)],
      files:      [makeAttachment(session.code)],
      components: [captchaButtons()],
    });
  }

  if (interaction.isButton() && interaction.customId === 'hp_learn_more') {
    return interaction.reply({
      embeds: [new EmbedBuilder()
        .setColor(0x4d96ff)
        .setTitle('ℹ️ Why does this channel exist?')
        .setDescription(
          'This channel is a **security honeypot** — it exists to catch compromised Discord accounts.\n\n' +
          'Malicious bots and scripts that have hijacked accounts often spam every channel they can find. ' +
          'By placing a channel that looks normal but serves no purpose, we can instantly detect and quarantine any account that sends a message here.\n\n' +
          '**Legitimate users should never need to type in this channel.** ' +
          'If your account sent a message here without your knowledge, it may be compromised — change your password and enable 2FA immediately.'
        )
        .setFooter({ text: 'This message is only visible to you.' })
      ],
      flags: MessageFlags.Ephemeral,
    });
  }

  if (interaction.isButton() && interaction.customId === 'hp_tips') {
    return interaction.reply({ embeds: [tipsEmbed()], flags: MessageFlags.Ephemeral });
  }

  if (interaction.isButton() && interaction.customId === 'hp_ignore') {
    return interaction.reply({
      content: '⚠️ You chose to ignore the warning. Your account remains quarantined. You can still click **Yes, account secured** at any time to begin verification.',
      flags: MessageFlags.Ephemeral,
    });
  }

  if (interaction.isButton() && interaction.customId === 'hp_captcha_enter') {
    const result = getSessionForUser(interaction.user.id);
    if (!result) return interaction.reply({ content: '✅ No active session.', flags: MessageFlags.Ephemeral });

    const modal = new ModalBuilder().setCustomId('hp_modal').setTitle('Enter Captcha');
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('hp_code')
          .setLabel('Code from the captcha image')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('e.g. A7K3Q')
          .setRequired(true)
          .setMinLength(1)
          .setMaxLength(10)
      )
    );
    return interaction.showModal(modal);
  }

  if (interaction.isButton() && interaction.customId === 'hp_captcha_new') {
    const result = getSessionForUser(interaction.user.id);
    if (!result) return interaction.reply({ content: '✅ No active session.', flags: MessageFlags.Ephemeral });
    const { guildId, sessions, session } = result;

    freshCode(session);
    sessions.set(interaction.user.id, session);
    saveGuildSessions(guildId);

    return interaction.update({
      embeds:     [captchaEmbed(session, session.guildName)],
      files:      [makeAttachment(session.code)],
      components: [captchaButtons()],
    });
  }

  // ── Modal submit ──────────────────────────────────────────────────────────

  if (interaction.isModalSubmit() && interaction.customId === 'hp_modal') {
    const result = getSessionForUser(interaction.user.id);
    if (!result) return interaction.reply({ content: '✅ No active session.', flags: MessageFlags.Ephemeral });
    const { guildId, sessions, session } = result;

    const input    = interaction.fields.getTextInputValue('hp_code').trim().toUpperCase();
    const expected = session.code.toUpperCase();

    if (input === expected) {
      sessions.delete(interaction.user.id);
      saveGuildSessions(guildId);

      let guild;
      try {
        guild = await client.guilds.fetch(guildId);
        await restoreMember(guild, interaction.user, session);
      } catch (err) {
        console.error('Restore failed:', err.message);
        return interaction.reply({ content: '✅ Correct! But couldn\'t restore you automatically — contact a moderator.', flags: MessageFlags.Ephemeral });
      }

      await interaction.reply({ embeds: [unlockedEmbed()] });

      if (!session.usingDM) {
        await new Promise(r => setTimeout(r, 10_000));
        await cleanupPrivateChannel(guild, session);
      }
      return;
    }

    // Wrong answer
    session.attempts += 1;
    sessions.set(interaction.user.id, session);
    saveGuildSessions(guildId);

    if (session.attempts >= 5) {
      sessions.delete(interaction.user.id);
      saveGuildSessions(guildId);

      const guildConfig = guildConfigs.get(guildId);
      const isBan       = guildConfig?.action === 'ban';
      let guild;

      try {
        guild = await client.guilds.fetch(guildId);
        await modLog(guild, new EmbedBuilder()
          .setTitle(`❌ Honeypot: Max Attempts — ${isBan ? 'Banned' : 'Kicked'}`)
          .setColor(0xff0000)
          .addFields(
            { name: 'User',            value: `${interaction.user.tag} (${interaction.user.id})`, inline: true },
            { name: 'Failed Attempts', value: '5',                                                inline: true },
            { name: 'Action',          value: isBan ? 'Permanently banned' : 'Kicked (10s delay)', inline: true }
          )
          .setTimestamp()
        );
      } catch (err) {
        console.error('Failed to log max attempts:', err.message);
      }

      await interaction.reply({
        content: isBan
          ? '❌ **Too many failed attempts.** You will be **permanently banned** in 10s.\n\n> If this wasn\'t you, change your password and enable 2FA immediately.'
          : '❌ **Too many failed attempts.** You will be **kicked** in 10s. You can rejoin later.\n\n> If this wasn\'t you, change your password and enable 2FA immediately.',
        flags: MessageFlags.Ephemeral,
      });

      await new Promise(r => setTimeout(r, 10_000));

      try {
        if (guild) {
          const member = await guild.members.fetch(interaction.user.id).catch(() => null);
          if (member) {
            await removeTimeout(member);
            if (isBan) {
              if (member.bannable) await member.ban({ reason: 'Honeypot: Exceeded maximum captcha attempts.', deleteMessageSeconds: 3600 });
            } else {
              if (member.kickable) await member.kick('Honeypot: Exceeded maximum captcha attempts.');
            }
          }
          if (!isBan) await unmuteInAllChannels(guild, interaction.user.id);
          await cleanupPrivateChannel(guild, session);
        }
      } catch (err) {
        console.error('Failed to enforce action after max attempts:', err.message);
      }
      return;
    }

    freshCode(session);
    sessions.set(interaction.user.id, session);
    saveGuildSessions(guildId);

    const remaining = 5 - session.attempts;
    return interaction.reply({
      content:    `❌ Wrong code. **${remaining} attempt(s) remaining.** Here's a new captcha:`,
      embeds:     [captchaEmbed(session, session.guildName)],
      files:      [makeAttachment(session.code)],
      components: [captchaButtons()],
      flags:      MessageFlags.Ephemeral,
    });
  }

  // ── Slash commands ────────────────────────────────────────────────────────

  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'honeypot-setup') {
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return interaction.reply({ content: '❌ Admins only.', flags: MessageFlags.Ephemeral });
    }

    const existing = guildConfigs.get(interaction.guild.id) ?? {};
    const state = {
      honeypotChannelId:      existing.honeypotChannelId      ?? null,
      modLogChannelId:        existing.modLogChannelId        ?? null,
      verificationCategoryId: existing.verificationCategoryId ?? null,
      action:                 existing.action                 ?? null,
    };

    setupSessions.set(`${interaction.user.id}-${interaction.guild.id}`, state);

    return interaction.reply({
      embeds:     [buildSetupEmbed(state, interaction.guild.name)],
      components: buildSetupComponents(state),
      flags:      MessageFlags.Ephemeral,
    });
  }

  if (interaction.commandName === 'session-delete') {
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return interaction.reply({ content: '❌ Admins only.', flags: MessageFlags.Ephemeral });
    }

    const target   = interaction.options.getUser('user');
    const sessions = getSessions(interaction.guild.id);
    const session  = sessions.get(target.id);

    if (!session) {
      return interaction.reply({ content: `❌ No active session for ${target.tag} in this server.`, flags: MessageFlags.Ephemeral });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    sessions.delete(target.id);
    saveGuildSessions(interaction.guild.id);

    try {
      const member = await interaction.guild.members.fetch(target.id).catch(() => null);
      if (member) {
        await removeTimeout(member);
        await unmuteInAllChannels(interaction.guild, target.id);
      }
      await cleanupPrivateChannel(interaction.guild, session);
    } catch (err) {
      console.error('Session delete cleanup error:', err.message);
    }

    return interaction.editReply({
      content: `✅ Session deleted for **${target.tag}**. All quarantine restrictions have been lifted.`,
    });
  }
});

client.login(process.env.DISCORD_TOKEN);