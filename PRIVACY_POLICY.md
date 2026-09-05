# Privacy Policy

**Effective date:** September 5, 2026

This Privacy Policy explains what data the Honeypot Discord Bot ("the Bot") collects, why, and how it is protected. By adding the Bot to a Discord server ("Server") or interacting with it, you agree to the practices described here.

## 1. What the Bot does

The Bot is an anti-scam "honeypot" tool for Discord servers. It posts a decoy channel designed to attract spam/scam accounts; when a suspicious account interacts with it, the Bot challenges the account with a captcha and, depending on the outcome and the Server's configuration, may warn, mute, softban, or ban that account and notify the Server's moderators.

## 2. Data we collect

To operate, the Bot stores the following per Server, in a private directory on the host running the Bot:

- **Discord user ID** of any account that triggers the honeypot
- **Discord username/tag**, used only in real-time moderator notifications (not persisted to disk)
- **Server (guild) ID and name**
- **A randomly generated verification code** and the number of attempts made to solve it
- **An internal incident number**, and internal Discord channel/role IDs created for the verification flow
- **Server configuration**: the channel/category/role IDs and moderation action an admin selects via `/honeypot-setup`

The content of the message that triggered the honeypot is relayed once, in real time, to that Server's own moderator-log channel (configured by the Server's admins) so moderators can review it. This message content is **not** written to any file or database by the Bot.

## 3. What we do NOT collect

The Bot does not collect or store: email addresses, IP addresses, payment information, message history unrelated to a honeypot trigger, or any data from accounts that never interact with the honeypot channel.

## 4. How data is stored and protected

All persisted per-server data (session and configuration files) is encrypted at rest using AES-256-GCM before being written to disk, with a unique authentication tag per file. Only the Bot's host process holds the decryption key. Data is never sold, and is not shared with any third party — the only party who can see honeypot trigger details is the Server's own moderators, via that Server's own mod-log channel.

## 5. Data retention

Per-server data is retained for as long as the Bot remains in that Server, so it can track repeat offenders and avoid re-processing already-verified accounts. If a Server removes the Bot, its data may be deleted on request (see Contact, below). An individual user may also request deletion of their own record by contacting us.

## 6. Children's privacy

The Bot is not directed at children under 13 and does not knowingly collect data from them beyond the Discord user ID any interacting account would generate. Discord itself requires users to meet its own minimum age requirements; see [Discord's Terms of Service](https://discord.com/terms).

## 7. Your rights

You may request access to, or deletion of, any data the Bot holds about your Discord account by reaching out through the contact method below. We will act on verified requests within a reasonable time.

## 8. Changes to this policy

We may update this policy as the Bot's functionality changes. Material changes will be reflected in this document with an updated effective date.

## 9. Contact

For questions about this policy or to request data access/deletion, open an issue at:
`https://github.com/<your-github-username>/HoneypotDiscordBot/issues`

*(Replace `<your-github-username>` with your actual GitHub username/org once this repo is published.)*
