const { createTicket, addMessageToTicket, closeTicket } = require('../utils/modmail');
const Ticket = require('../schemas/Ticket');
const Config = require('../schemas/Config');
const config = require('../config/config');
const logger = require('../utils/logger');
const moment = require('moment');
const { EmbedBuilder } = require('discord.js');

// ===============================
// SUBSCRIPTION SYSTEM (IN MEMORY)
// ===============================
const ticketSubscriptions = new Map();

module.exports = {
  name: 'messageCreate',
  async execute(message, client) {

    if (message.author.bot) return;

    const prefix = config.prefix;

    // =====================================================
    // USER DM
    // =====================================================
    if (message.channel.isDMBased()) {

      // Commands in DM
      if (message.content.startsWith(prefix)) {
        const args = message.content.slice(prefix.length).trim().split(/ +/);
        const command = args.shift()?.toLowerCase();

        if (command === 'tickets' || command === 'list') {
          return handleListTicketsCommand(message, client);
        }

        return;
      }

      // Add message to existing ticket
      const added = await addMessageToTicket(message, client, false);

      if (added) {

        // Find active ticket
        const ticket = await Ticket.findOne({
          userId: message.author.id,
          closed: false
        });

        if (ticket) {
          const subscribers = ticketSubscriptions.get(ticket.channelId);

          if (subscribers && subscribers.size > 0) {

            const channel = client.channels.cache.get(ticket.channelId);

            if (channel) {
              const mentions = [...subscribers].map(id => `<@${id}>`).join(' ');
              channel.send(`📩 New reply from user ${mentions}`);
            }
          }
        }

        return;
      }

      // Or create new ticket
      return createTicket(message, client);
    }

    // =====================================================
    // STAFF TICKET CHANNEL
    // =====================================================
    if (!message.channel.name?.startsWith('modmail-')) return;

    const guildConfig = await Config.findOne({ guildId: message.guild.id });
    if (!guildConfig) return;

    const staffRoleId = guildConfig.staffRoleId;

    // Only staff
    if (!message.member.roles.cache.has(staffRoleId)) return;

    // Only react to prefix commands
    if (!message.content.startsWith(prefix)) return;

    const args = message.content.slice(prefix.length).trim().split(/ +/);
    const command = args.shift()?.toLowerCase();

    // =====================================================
    // CLOSE
    // =====================================================
    if (command === 'close') {

      const ticket = await Ticket.findOne({
        channelId: message.channel.id,
        closed: false
      });

      if (!ticket) {
        return message.reply('This is not an active ticket.');
      }

      const reason = args.join(' ') || 'No reason provided';

      try {
        await message.reply('Closing ticket...');
        await closeTicket(message.channel, client, message.author, reason);
      } catch (err) {
        logger.error(err);
        message.reply('Error closing ticket.');
      }

      return;
    }

    // =====================================================
    // REPLY (EMBED - IGUAL QUE ANTES)
    // =====================================================
    if (command === 'reply') {

      const content = args.join(' ');
      if (!content) {
        return message.reply('Please provide a message to send.');
      }

      const ticket = await Ticket.findOne({
        channelId: message.channel.id,
        closed: false
      });

      if (!ticket) {
        return message.reply('This is not an active ticket.');
      }

      try {
        const user = await client.users.fetch(ticket.userId);

        const embed = new EmbedBuilder()
          .setColor(config.embedColor || '#ED4245')
          .setAuthor({
            name: message.guild.name + " Staff",
            iconURL: message.guild.iconURL({ dynamic: true })
          })
          .setDescription(content)
          .setFooter({ text: config.footer || 'Staff Reply' })
          .setTimestamp();

        await user.send({ embeds: [embed] });

        await message.react('✅');

      } catch (error) {
        logger.error('Error sending embed:', error);
        await message.reply('Could not send message to user.');
      }

      return;
    }

    // =====================================================
    // SUBSCRIBE
    // =====================================================
    if (command === 'sub') {

      const ticket = await Ticket.findOne({
        channelId: message.channel.id,
        closed: false
      });

      if (!ticket) {
        return message.reply('This is not an active ticket.');
      }

      const channelId = message.channel.id;

      if (!ticketSubscriptions.has(channelId)) {
        ticketSubscriptions.set(channelId, new Set());
      }

      const subscribers = ticketSubscriptions.get(channelId);

      if (subscribers.has(message.author.id)) {
        return message.reply('You are already subscribed to this ticket.');
      }

      subscribers.add(message.author.id);

      return message.reply('✅ You are now subscribed to this ticket.');
    }

    return;
  }
};

// =====================================================
// LIST TICKETS (DM)
// =====================================================
async function handleListTicketsCommand(message, client) {
  try {
    const activeTickets = await Ticket.find({
      userId: message.author.id,
      closed: false
    }).sort({ createdAt: -1 });

    if (!activeTickets.length) {
      return message.reply("You don't have any active tickets.");
    }

    let text = `You have ${activeTickets.length} active ticket(s):\n\n`;

    for (const ticket of activeTickets) {
      const guild = client.guilds.cache.get(ticket.guildId);
      const guildName = guild ? guild.name : 'Unknown Server';
      const created = moment(ticket.createdAt).format('MMM D YYYY, h:mm A');

      text += `• **${guildName}**\nCreated: ${created}\n\n`;
    }

    message.reply(text);

  } catch (error) {
    logger.error(error);
    message.reply('Error retrieving tickets.');
  }
}
