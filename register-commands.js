const { REST, Routes, SlashCommandBuilder } = require('discord.js');
require('dotenv').config();

const commands = [
  new SlashCommandBuilder()
    .setName('honeypot-setup')
    .setDescription('Configure the honeypot for this server (admins only)'),

  new SlashCommandBuilder()
    .setName('session-delete')
    .setDescription('Force-delete a user\'s honeypot session to clear errors (admins only)')
    .addUserOption(opt =>
      opt.setName('user')
         .setDescription('The user whose session to delete')
         .setRequired(true)
    ),
].map(c => c.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    const clientId = process.env.CLIENT_ID;

    // 1. Wipe existing global commands
    console.log('Clearing global commands...');
    await rest.put(Routes.applicationCommands(clientId), { body: [] });
    console.log('  ✅ Global commands cleared');

    // 2. Wipe guild-specific commands from every server the bot is in
    console.log('Clearing guild-specific commands from all servers...');
    const guilds = await rest.get(Routes.userGuilds());
    for (const guild of guilds) {
      try {
        await rest.put(Routes.applicationGuildCommands(clientId, guild.id), { body: [] });
        console.log(`  ✅ Cleared: ${guild.name} (${guild.id})`);
      } catch (err) {
        console.error(`  ❌ Failed for ${guild.id}:`, err.message);
      }
    }

    // 3. Register the new global commands
    console.log('Registering new global commands...');
    await rest.put(Routes.applicationCommands(clientId), { body: commands });
    console.log('  ✅ Registered: /honeypot-setup, /session-delete');

    console.log('\n✅ Done! Commands will appear in all servers within ~1 hour.');
    console.log('   For instant testing, kick and re-invite the bot to your test server.');
  } catch (err) {
    console.error('Registration failed:', err);
  }
})();