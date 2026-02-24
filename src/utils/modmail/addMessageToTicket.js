const { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ComponentType } = require('discord.js');
const Ticket = require('../../schemas/Ticket');
const Config = require('../../schemas/Config');
const ConfigManager = require('../configManager');
const config = require('../../config/config');
const logger = require('../logger');
const moment = require('moment');

/**
 * Add a message to an existing ticket
 * @param {Object} message - The message object
 * @param {Object} client - The Discord client
 * @param {boolean} isStaff - Whether the message is from staff or user
 * @returns {Promise<boolean>} Success status
 */
async function addMessageToTicket(message, client, isStaff = false) {
  try {
    if (isStaff) {
      // Handle staff message in a ticket channel
      
      // Get the ticket from database
      const ticket = await Ticket.findOne({
        channelId: message.channel.id,
        closed: false
      });
      
      if (!ticket) {
        return message.reply('This channel is not an active ticket or the ticket could not be found in the database.');
      }
      
      // Get the user and guild
      const user = await client.users.fetch(ticket.userId).catch(() => null);
      const guild = client.guilds.cache.get(ticket.guildId);
      
      if (!user) {
        return message.reply('The user associated with this ticket could not be found.');
      }
      
      if (!guild) {
        return message.reply('The guild associated with this ticket could not be found.');
      }
      
      // Get guild configuration
      const guildConfig = await Config.findOne({ guildId: guild.id });
      if (!guildConfig) {
        return message.reply('Could not find configuration for this guild.');
      }
      
      // Get the configured embed color
      const embedColor = await ConfigManager.getSetting(
        guild.id, 
        'settings.appearance.embedColor',
        config.embedColor
      );
      
      // Get the staff response message template
      const responseMessage = await ConfigManager.getSetting(
        guild.id,
        'settings.messages.responseMessage',
        ''
      );
      
      // Check if we should use timestamps
      const useTimestamps = await ConfigManager.getSetting(
        guild.id,
        'settings.appearance.useTimestamps',
        true
      );
      
      // Create embed to send to user
      const userEmbed = new EmbedBuilder()
        .setColor(embedColor)
        .setAuthor({
          name: message.author.tag,
          iconURL: message.author.displayAvatarURL()
        })
        .setDescription(`${responseMessage}\n\n${message.content || '*No message content*'}`)
        .setFooter({ text: config.footer });
      
      // Add timestamp if enabled
      if (useTimestamps) {
        userEmbed.setTimestamp();
      }
      
      // Handle attachments
      const files = [];
      
      if (message.attachments.size > 0) {
        userEmbed.addFields({
          name: 'Attachments',
          value: message.attachments.map(a => `[${a.name}](${a.url})`).join('\n')
        });
        
        // Add attachments to files array
        message.attachments.forEach(attachment => {
          files.push(attachment.url);
        });
      }
      
      // Send message to user
      await user.send({
        embeds: [userEmbed],
        files: files
      }).catch(error => {
        logger.error(`Error sending message to user ${user.tag}:`, error);
        return message.reply('Failed to send message to the user. They may have DMs disabled or have blocked the bot.');
      });
      
      // Add message to ticket in database
      ticket.messages.push({
        content: message.content,
        author: message.author.tag,
        authorId: message.author.id,
        attachments: message.attachments.map(a => a.url),
        isStaff: true,
        timestamp: Date.now()
      });
      
      // Update last message timestamp
      ticket.lastMessage = Date.now();
      
      await ticket.save();
      
      // Add reaction to confirm message was sent
      await message.react('✅');
      
      return true;
    } else {
      // Handle user message in DM
      
      // Find all active tickets for this user
      const tickets = await Ticket.find({
        userId: message.author.id,
        closed: false
      });
      
      if (tickets.length === 0) {
        return false; // Return false to allow createTicket to be called
      }
      
      let selectedTicket;
      
      // If user has multiple tickets, let them select which one to respond to
      if (tickets.length > 1) {
        const ticketOptions = [];
        
        for (const ticket of tickets) {
          const guild = client.guilds.cache.get(ticket.guildId);
          if (!guild) continue;
          
          ticketOptions.push({
            label: `Ticket in ${guild.name}`,
            description: `Created ${moment(ticket.createdAt).fromNow()}`,
            value: ticket._id.toString(),
            emoji: '📩'
          });
        }
        
        // Get the configured embed color
        let embedColor = config.embedColor;
        try {
          const firstGuild = client.guilds.cache.get(tickets[0].guildId);
          if (firstGuild) {
            embedColor = await ConfigManager.getSetting(
              firstGuild.id, 
              'settings.appearance.embedColor',
              config.embedColor
            );
          }
        } catch (error) {
          logger.error('Error getting embed color:', error);
        }
        
        const row = new ActionRowBuilder()
          .addComponents(
            new StringSelectMenuBuilder()
              .setCustomId('ticket_select')
              .setPlaceholder('Select a ticket')
              .addOptions(ticketOptions)
          );
        
        const selectEmbed = new EmbedBuilder()
          .setColor(embedColor)
          .setTitle('Select a Ticket')
          .setDescription('You have multiple active tickets. Please select which ticket you want to respond to.')
          .setFooter({ text: config.footer })
          .setTimestamp();
        
        const selectMessage = await message.reply({
          embeds: [selectEmbed],
          components: [row]
        });
        
        try {
          // Wait for user selection
          const response = await selectMessage.awaitMessageComponent({
            componentType: ComponentType.StringSelect,
            time: 60000
          });
          
          const selectedTicketId = response.values[0];
          selectedTicket = tickets.find(t => t._id.toString() === selectedTicketId);
          
          if (!selectedTicket) {
            return message.reply('Error: Invalid ticket selection. Please try again.');
          }
          
          // Acknowledge the selection
          await response.update({
            content: 'Sending your message...',
            embeds: [],
            components: []
          });
        } catch (error) {
          if (error.code === 'INTERACTION_COLLECTOR_ERROR') {
            return message.reply('Ticket selection timed out. Please try again.');
          } else {
            logger.error('Error with ticket selection:', error);
            return message.reply('There was an error processing your selection. Please try again.');
          }
        }
      } else {
        // If user has only one ticket, use that
        selectedTicket = tickets[0];
      }
      
      // Get the guild and channel for the selected ticket
      const guild = client.guilds.cache.get(selectedTicket.guildId);
      const channel = guild?.channels.cache.get(selectedTicket.channelId);
      
      if (!guild || !channel) {
        logger.error(`Guild or channel not found for ticket ${selectedTicket._id}`);
        return message.reply('Error: The channel or server for this ticket could not be found. Please contact administrators.');
      }
      
      // Get guild configuration
      const guildConfig = await Config.findOne({ guildId: guild.id });
      if (!guildConfig) {
        return message.reply('Could not find configuration for this guild.');
      }
      
      // Get the configured embed color
      const embedColor = await ConfigManager.getSetting(
        guild.id, 
        'settings.appearance.embedColor',
        config.embedColor
      );
      
      // Create embed to send to the staff channel
      const staffEmbed = new EmbedBuilder()
        .setColor(embedColor)
        .setAuthor({
          name: message.author.tag,
          iconURL: message.author.displayAvatarURL()
        })
        .setDescription(message.content || '*No message content*')
        .setFooter({ text: `User ID: ${message.author.id} • ${config.footer}` })
        .setTimestamp();
      
      // Handle attachments
      const files = [];
      
      if (message.attachments.size > 0) {
        staffEmbed.addFields({
          name: 'Attachments',
          value: message.attachments.map(a => `[${a.name}](${a.url})`).join('\n')
        });
        
        // Add attachments to files array
        message.attachments.forEach(attachment => {
          files.push(attachment.url);
        });
      }
      
      // Send message to the staff channel
      await channel.send({
        embeds: [staffEmbed],
        files: files
      }).catch(error => {
        logger.error(`Error sending message to channel ${channel.id}:`, error);
        return message.reply('Failed to send your message to the staff. Please try again later.');
      });
      
      // Add message to ticket in database
      selectedTicket.messages.push({
        content: message.content,
        author: message.author.tag,
        authorId: message.author.id,
        attachments: message.attachments.map(a => a.url),
        isStaff: false,
        timestamp: Date.now()
      });
      
      // Update last message timestamp
      selectedTicket.lastMessage = Date.now();
      
      await selectedTicket.save();
      
      // Add reaction to confirm message was sent
      await message.react('✅');
      
      return true;
    }
  } catch (error) {
    logger.error('Error adding message to ticket:', error);
    
    if (message.channel.type === 1) { // DM Channel
      message.reply('There was an error processing your message. Please try again later or contact an administrator.');
    } else {
      message.reply('There was an error sending your message to the user. Please try again later.');
    }
    
    return false;
  }
}

module.exports = addMessageToTicket; 
