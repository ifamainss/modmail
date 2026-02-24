const { createTicket, addMessageToTicket, closeTicket } = require('../utils/modmail');
const Ticket = require('../schemas/Ticket');
const Config = require('../schemas/Config');
const ConfigManager = require('../utils/configManager');
const config = require('../config/config');
const logger = require('../utils/logger');
const moment = require('moment');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

module.exports = {
  name: 'messageCreate',
  async execute(message, client) {
    // Ignore messages from bots
    if (message.author.bot) return;

    // Handle DM messages (potential tickets)
    if (message.channel.isDMBased()) {
      // Check if the message is a command
      if (message.content.startsWith(config.prefix)) {
        // Extract the command and handle it
        const args = message.content.slice(config.prefix.length).trim().split(/ +/);
        const commandName = args.shift().toLowerCase();

        // Handle DM commands (like listing active tickets)
        if (commandName === 'tickets' || commandName === 'list') {
          await handleListTicketsCommand(message, client);
          return;
        }
        
        return;
      }

      // Try to add to existing ticket first
      const added = await addMessageToTicket(message, client, false);
      
      // If message was added to an existing ticket, we're done
      if (added) return;
      
      // Otherwise, create a new ticket
      await createTicket(message, client);
      
      return;
    }

    // Handle guild messages
    // Check if the message is in a modmail channel
    const isModmailChannel = message.channel.name.startsWith('modmail-');
    if (isModmailChannel) {
      // Get the server configuration
      const guildConfig = await Config.findOne({ guildId: message.guild.id });
      
      if (!guildConfig) {
        logger.error(`No configuration found for guild ${message.guild.id}`);
        return message.reply('Error: Bot has not been set up. Please ask an administrator to run the /setup command.');
      }
      
      // Check if the user has staff role
      const staffRoleId = guildConfig.staffRoleId;
      const hasStaffRole = message.member.roles.cache.has(staffRoleId);
      
      if (!hasStaffRole) {
        return message.reply(`You do not have permission to use this channel. You need the <@&${staffRoleId}> role.`);
      }

     // If it's a command, handle it
if (message.content.startsWith(config.prefix)) 
  const args = message.content.slice(config.prefix.length).trim().split(/ +/);
  const commandName = args.shift().toLowerCase();

  // CLOSE COMMAND (keep your existing close logic here)
  if (commandName === 'close') {
    // keep everything that was already inside your close command
    // DO NOT delete that code
    // just leave it exactly how it was
  }

  // REPLY COMMAND
 // Only allow reply command to forward messages
if (message.content.startsWith(config.prefix + 'reply')) {
  const args = message.content.slice((config.prefix + 'reply').length).trim();
  
  if (!args) {
    return message.reply('Please provide a message to send.');
  }

  message.content = args;
  await addMessageToTicket(message, client, true);
  await message.delete().catch(() => {});
}

return;
}

// If it's not a command, allow staff discussion only
return;
          // Extract the channel ID from the channel name
          const channelName = message.channel.name;
          
          // Verify this is actually a modmail channel with correct format
          if (!channelName.startsWith('modmail-')) {
            return message.reply('This command can only be used in ModMail ticket channels.');
          }
          
          // Check if this ticket exists in the database before proceeding
          const existingTicket = await Ticket.findOne({
            channelId: message.channel.id,
            closed: false
          });
          
          if (!existingTicket) {
            return message.reply('Error: This channel is not an active ticket or the ticket could not be found in the database.');
          }
          
          // Get the reason if provided
          const reason = args.join(' ') || 'No reason provided';
          
          // Check if confirmation is required in config
          const closeConfirmation = await ConfigManager.getSetting(
            message.guild.id,
            'settings.tickets.closeConfirmation',
            true
          );
          
          // Get the configured embed color
          const embedColor = await ConfigManager.getSetting(
            message.guild.id, 
            'settings.appearance.embedColor',
            config.embedColor
          );
          
          if (closeConfirmation) {
            // Create confirmation buttons
            const confirmButton = new ButtonBuilder()
              .setCustomId('confirm_close')
              .setLabel('Close Ticket')
              .setStyle(ButtonStyle.Danger);
              
            const cancelButton = new ButtonBuilder()
              .setCustomId('cancel_close')
              .setLabel('Cancel')
              .setStyle(ButtonStyle.Secondary);
              
            const row = new ActionRowBuilder()
              .addComponents(confirmButton, cancelButton);
              
            // Send confirmation message
            const confirmEmbed = new EmbedBuilder()
              .setColor(embedColor)
              .setTitle('Close Ticket?')
              .setDescription(`Are you sure you want to close this ticket?\n\n**Reason:** ${reason}`)
              .setFooter({ text: `${config.footer} • This confirmation will expire in 30 seconds` })
              .setTimestamp();
              
            const response = await message.reply({
              embeds: [confirmEmbed],
              components: [row],
              fetchReply: true
            });
            
            // Create a collector for button interactions with a shorter timeout
            const collector = response.createMessageComponentCollector({
              filter: i => i.user.id === message.author.id,
              time: 30000,
              max: 1 // Only collect one interaction
            });
            
            // Set a flag to track if the interaction has been handled
            let interactionHandled = false;
            
            // Handle collected interactions
            collector.on('collect', async (interaction) => {
              // Prevent handling the same interaction multiple times
              if (interactionHandled) return;
              interactionHandled = true;
              
              try {
                // First, disable the buttons to prevent further clicks
                const disabledRow = new ActionRowBuilder().addComponents(
                  ButtonBuilder.from(confirmButton).setDisabled(true),
                  ButtonBuilder.from(cancelButton).setDisabled(true)
                );
                
                // Update the message with disabled buttons first
                await interaction.update({
                  components: [disabledRow]
                }).catch(err => {
                  logger.error('Failed to disable buttons:', err);
                });
                
                // Then handle the specific button click
                if (interaction.customId === 'confirm_close') {
                  // Send a new message about closing instead of updating the interaction
                  await message.channel.send('Closing ticket...').catch(() => {});
                  
                  try {
                    const result = await closeTicket(
                      message.channel, 
                      client, 
                      message.author, 
                      reason
                    );
                    
                    if (!result.success) {
                      if (result.alreadyClosed) {
                        await message.channel.send("This ticket has already been closed by someone else.").catch(() => {});
                      } else {
                        await message.channel.send(`Error: ${result.error}`).catch(() => {});
                      }
                    } else if (result.duplicateClose) {
                      // This is a duplicate close attempt by the same user - don't show an error
                      await message.channel.send("Continuing with ticket closure...").catch(() => {});
                    }
                  } catch (error) {
                    logger.error('Error closing ticket:', error);
                    try {
                      if (message.channel) {
                        await message.channel.send('An error occurred while closing the ticket.').catch(() => {});
                      }
                    } catch (err) {
                      // Silently fail if channel is gone
                    }
                  }
                } else if (interaction.customId === 'cancel_close') {
                  // Send a new message instead of updating the interaction
                  await message.channel.send('Ticket close canceled.').catch(() => {});
                }
              } catch (error) {
                logger.error('Error handling button interaction:', error);
                try {
                  // Attempt to send a follow-up message if interaction handling fails
                  await message.channel.send(
                    interaction.customId === 'confirm_close' 
                      ? 'Attempting to close the ticket...' 
                      : 'Ticket close canceled.'
                  ).catch(() => {});
                  
                  // If it was a confirm, still try to close the ticket
                  if (interaction.customId === 'confirm_close') {
                    await closeTicket(message.channel, client, message.author, reason).catch(err => {
                      logger.error('Error in fallback ticket close:', err);
                    });
                  }
                } catch (followUpError) {
                  logger.error('Error sending follow-up message:', followUpError);
                }
              }
            });
            
            // Handle when the collector ends (timeout or max collected)
            collector.on('end', async (collected) => {
              // Only handle timeout case if no interaction was collected
              if (collected.size === 0 && !interactionHandled) {
                try {
                  // Edit the original message
                  await response.edit({
                    content: 'Ticket close canceled - confirmation timed out.',
                    embeds: [],
                    components: []
                  }).catch(() => {});
                } catch (error) {
                  logger.error('Error editing timeout message:', error);
                  // Try to send a new message if edit fails
                  await message.channel.send('Ticket close canceled - confirmation timed out.').catch(() => {});
                }
              }
            });
          } else {
            // If no confirmation required, close the ticket directly
            try {
              const closeMsg = await message.reply('Closing ticket...');
              
              const result = await closeTicket(
                message.channel, 
                client, 
                message.author, 
                reason
              );
              
              if (!result.success) {
                // Check if it's already closed (race condition)
                if (result.alreadyClosed) {
                  await message.channel.send("This ticket has already been closed by someone else.").catch(() => {});
                } else {
                  await message.channel.send(`Error: ${result.error}`).catch(() => {});
                }
              } else if (result.duplicateClose) {
                // This is a duplicate close attempt by the same user - don't show an error
                await message.channel.send("Continuing with ticket closure...").catch(() => {});
              }
            } catch (error) {
              logger.error('Error directly closing ticket:', error);
              try {
                if (message.channel) {
                  await message.channel.send('An error occurred while closing the ticket.').catch(() => {});
                }
              } catch (err) {
                // Silently fail if channel is gone
              }
            }
          }
          return;
        }
        
        return;
      }

            // Handle reply command
      if (message.content.startsWith(config.prefix)) {
        const args = message.content.slice(config.prefix.length).trim().split(/ +/);
        const commandName = args.shift().toLowerCase();

        if (commandName === 'reply') {
          if (args.length === 0) {
            return message.reply('Please provide a message to send.');
          }

          // Temporarily modify the message content to only contain the reply text
          message.content = args.join(' ');

          await addMessageToTicket(message, client, true);

          // Optional: delete the staff command message
          await message.delete().catch(() => {});
        }

        return;
      }

      // If it's not a command, do nothing (staff discussion allowed)
      return;
    }

    // Handle regular commands in the guild
    if (!message.content.startsWith(config.prefix)) return;

    const args = message.content.slice(config.prefix.length).trim().split(/ +/);
    const commandName = args.shift().toLowerCase();

    // Look for command in the commands collection
    const command = client.commands.get(commandName);

    if (!command) return;

    // Execute the command
    try {
      await command.execute(message, args, client);
    } catch (error) {
      logger.error(`Error executing command ${commandName}:`, error);
      message.reply('There was an error trying to execute that command!');
    }
  }
};

/**
 * Handle the list tickets command in DMs
 * @param {Object} message - The message object
 * @param {Object} client - The Discord client
 */
async function handleListTicketsCommand(message, client) {
  try {
    // Find all active tickets for this user
    const activeTickets = await Ticket.find({
      userId: message.author.id,
      closed: false
    }).sort({ createdAt: -1 });
    
    if (activeTickets.length === 0) {
      return message.reply("You don't have any active tickets. Just send me a message to create a new one!");
    }
    
    // Create a list of active tickets
    let ticketList = `You have ${activeTickets.length} active ticket(s):\n\n`;
    
    for (const ticket of activeTickets) {
      const guild = client.guilds.cache.get(ticket.guildId);
      const guildName = guild ? guild.name : 'Unknown Server';
      
      const createdAt = moment(ticket.createdAt).format('MMM D, YYYY [at] h:mm A');
      
      ticketList += `• Server: **${guildName}**\n`;
      ticketList += `  Created: ${createdAt}\n`;
      
      if (ticket.topic) {
        ticketList += `  Topic: ${ticket.topic}\n`;
      }
      
      ticketList += '\n';
    }
    
    ticketList += 'To continue an existing conversation, just reply to this message with any text.';
    ticketList += '\nTo start a new ticket, please specify the server if you are in multiple servers with this bot.';
    
    await message.reply(ticketList);
  } catch (error) {
    logger.error('Error listing tickets:', error);
    await message.reply('There was an error retrieving your tickets. Please try again later.');
  }
} 
