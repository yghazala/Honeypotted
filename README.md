# 🍯 Honeypot Discord Bot

A self-hosted Discord security bot that automatically detects and quarantines compromised accounts using a honeypot channel trap and image-based captcha verification.

## How it works

1. A **honeypot channel** is placed in your server — fully visible and writeable, but serving no legitimate purpose.
2. When a user (or more likely, a hijacked account running a spam bot) sends a message there, the bot **immediately quarantines** them.
3. A **captcha challenge** is sent via DM, or via a private server channel if DMs are closed.
4. If the user solves the captcha → restrictions lifted. If they fail 5 times → kicked or banned (your choice).
5. Everything is logged to a private **mod log channel**.

---

## Features

- **Multi-server** — one bot instance serves unlimited servers, each with isolated config and sessions
- **Interactive setup** — `/honeypot-setup` opens a form to pick or auto-create all channels
- **Image captcha** — noise lines, random rotation, multiple colors; accepted via button modal **or** typed directly in chat
- **DM or private channel** — gracefully falls back to a server-side private channel if DMs are closed
- **Three action modes** — Softban (kick), Ban, or Disabled (log only)
- **Auto-recreate** — honeypot channel, mod log, verification category, and active session channels are automatically recreated if deleted
- **Persistent sessions** — survives bot restarts; active quarantines resume
- **Admin commands** — `/honeypot-setup` to configure, `/session-delete` to manually clear a stuck session

---

## Requirements

- **Node.js 18 or higher**
- A **Discord application** with a bot token ([create one here](https://discord.com/developers/applications))
- The following **Privileged Gateway Intents** enabled on your bot:
  - `SERVER MEMBERS INTENT`
  - `MESSAGE CONTENT INTENT`

---

## Installation

### 1. Clone the repository

```bash
git clone https://github.com/yghazala/honeypot-discord-bot.git
cd honeypot-discord-bot
```

### 2. Install dependencies

```bash
npm install
```

> **Note:** The `canvas` package compiles a native binary. If installation fails, make sure you have build tools installed:
> - **Windows:** `npm install --global windows-build-tools` (run as Administrator) or install [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)
> - **Linux/macOS:** `sudo apt install build-essential libcairo2-dev` / `brew install pkg-config cairo`

### 3. Create your Discord application

1. Go to [https://discord.com/developers/applications](https://discord.com/developers/applications)
2. Click **New Application**, give it a name
3. Go to **Bot** → click **Add Bot**
4. Under **Privileged Gateway Intents**, enable:
   - **Server Members Intent**
   - **Message Content Intent**
5. Copy your **Bot Token** (you'll need it in step 4)
6. Go to **General Information** and copy your **Application ID**

### 4. Configure environment variables

```bash
cp .env.example .env
```

Open `.env` and fill in your values:

```env
DISCORD_TOKEN=your_bot_token_here
CLIENT_ID=your_application_id_here
```

### 5. Invite the bot to your server

Build the invite URL using your Application ID:

```
https://discord.com/api/oauth2/authorize?client_id=YOUR_CLIENT_ID&permissions=1099780189206&scope=bot%20applications.commands
```

Replace `YOUR_CLIENT_ID` with your actual Application ID. The permissions integer includes:

| Permission | Reason |
|---|---|
| Manage Channels | Create/delete verification channels and category |
| Manage Roles | Create/delete per-user quarantine roles |
| Kick Members | Softban action on captcha failure |
| Ban Members | Ban action on captcha failure |
| Moderate Members | Apply timeout for DM-based quarantine |
| Manage Messages | Delete honeypot trigger messages |
| Send Messages | Post captcha and status messages |
| Embed Links | Rich embed support |
| Attach Files | Send captcha images |
| View Channel + Read History | Read channels to post and monitor |

### 6. Register slash commands

```bash
node register-commands.js
```

This clears any old commands from all servers and registers the new global commands (`/honeypot-setup` and `/session-delete`). Global commands propagate to all servers within **up to 1 hour**.

> For immediate availability during testing: after running the script, kick the bot from your test server and re-invite it.

### 7. Start the bot

```bash
# Production
npm start

# Development (auto-restart on file changes)
npm run dev
```

### 8. Configure each server

In any server where you want the honeypot active, run:

```
/honeypot-setup
```

An interactive form will open:

| Field | Description |
|---|---|
| Honeypot Channel | The trap channel (leave empty to auto-create `#honeypot`) |
| Log Channel | Where mod events are posted (leave empty to auto-create `#honeypot-logs`) |
| Verification Category | Category for private verification channels (leave empty to auto-create `Verification`) |
| Action | What happens on captcha failure (see below) |

**Action options:**

| Option | Behaviour |
|---|---|
| **Softban (kick)** | Full quarantine + captcha flow. Kicks on 5 failed attempts. |
| **Ban** | Full quarantine + captcha flow. Permanently bans on 5 failed attempts. |
| **Disabled** | Log only — no quarantine, no captcha, no enforcement. |

---

## Commands

| Command | Description | Permission |
|---|---|---|
| `/honeypot-setup` | Open the configuration form | Administrator |
| `/session-delete <user>` | Force-clear a user's stuck session and lift all restrictions | Administrator |

---

## File structure

```
honeypot-discord-bot/
├── bot.js                  # Main bot logic
├── captcha.js              # Captcha image generation
├── register-commands.js    # One-time command registration script
├── package.json
├── .env                    # Your secrets (not committed)
├── .env.example            # Template
└── sessions/               # Auto-created; one folder per server
    └── {guild_id}/
        ├── config.json     # Channel IDs and action setting
        └── sessions.json   # Active quarantine sessions
```

---

## Issues

If there are any issues, open a issue in the github repository.

---