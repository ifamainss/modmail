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
    if (message.author.bot) return;

    if (message.channel.isDMBased()) {
      if (message.content.startsWith(config.prefix)) {
        const args = message.content.slice(config.prefix.length).trim().split(/ +/);
        const commandName = args.shift().toLowerCase();

        if (['tickets', 'list'].includes(commandName)) {
          await handleListTicketsCommand(message, client);
          return;
        }

        return;
      }

      const added = await addMessageToTicket(message, client, false);
      if (added) return;

      await createTicket(message, client);
      return;
    }

    const isModmailChannel = message.channel.name.startsWith('modmail-');
    if (isModmailChannel) {
      const guildConfig = await Config.findOne({ guildId: message.guild.id });

      if (!guildConfig) {
        logger.error(`No configuration found for guild ${message.guild.id}`);
        return message.reply('Error: Bot has not been set up. Please ask an administrator to run the /setup command.');
      }

      const staffRoleId = guildConfig.staffRoleId;
      const hasStaffRole = message.member.roles.cache.has(staffRoleId);
      if (!hasStaffRole) {
        return message.reply(`You do not have permission to use this channel. You need the <@&${staffRoleId}> role.`);
      }

      if (message.content.startsWith(config.prefix)) {
        const args = message.content.slice(config.prefix.length).trim().split(/ +/);
        const commandName = args.shift().toLowerCase();

        if (commandName === 'close') {
          const channelName = message.channel.name;
          if (!channelName.startsWith('modmail-')) {
            return message.reply('This command can only be used in ModMail ticket channels.');
          }
          //forward messages
           if (commandName === 'reply') {
          const channelName = message.channel.name;
          if (!channelName.startsWith('modmail-')) {
            return message.reply('This command can only be used in ModMail ticket channels.');

          const existingTicket = await Ticket.findOne({
            channelId: message.channel.id,
            closed: false
          });

          if (!existingTicket) {
            return message.reply('Error: This channel is not an active ticket or the ticket could not be found in the database.');
          }

          const reason = args.join(' ') || 'No reason provided';

          const closeConfirmation = await ConfigManager.getSetting(
            message.guild.id,
            'settings.tickets.closeConfirmation',
            true
          );

          const embedColor = await ConfigManager.getSetting(
            message.guild.id,
            'settings.appearance.embedColor',
            config.embedColor
          );

          if (closeConfirmation) {
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

            const confirmEmbed = new EmbedBuilder()
              .setColor(embedColor)
              .setTitle('Close Ticket?')
              .setDescription(`Are you sure you want to close this ticket?\n\n**Reason:** ${reason}`)
              .setFooter({ text: `${config.footer} • This confirmation will expire in 30 seconds` })
              .setTimestamp();

            try {
              const response = await message.reply({
                embeds: [confirmEmbed],
                components: [row],
                fetchReply: true
              });

              const collector = response.createMessageComponentCollector({
                filter: i => i.user.id === message.author.id,
                time: 30000,
                max: 1
              });

              let interactionHandled = false;

              collector.on('collect', async (interaction) => {
                if (interactionHandled) return;
                interactionHandled = true;

                try {
                  const disabledRow = new ActionRowBuilder().addComponents(
                    ButtonBuilder.from(confirmButton).setDisabled(true),
                    ButtonBuilder.from(cancelButton).setDisabled(true)
                  );

                  await interaction.update({
                    components: [disabledRow]
                  }).catch(err => {
                    logger.error('Failed to disable buttons:', err);
                  });

                  if (interaction.customId === 'confirm_close') {
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
                        await message.channel.send("Continuing with ticket closure...").catch(() => {});
                      }
                    } catch (error) {
                      logger.error('Error closing ticket:', error);
                      try {
                        if (message.channel) {
                          await message.channel.send('An error occurred while closing the ticket.').catch(() => {});
                        }
                      } catch (err) { }
                    }
                  } else if (interaction.customId === 'cancel_close') {
                    await message.channel.send('Ticket close canceled.').catch(() => {});
                  }
                } catch (error) {
                  logger.error('Error handling button interaction:', error);
                  try {
                    await message.channel.send(
                      interaction.customId === 'confirm_close' ? 'Attempting to close the ticket...' : 'Ticket close canceled.'
                    ).catch(() => {});

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

              collector.on('end', async (collected) => {
                if (collected.size === 0 && !interactionHandled) {
                  try {
                    await response.edit({ content: 'Ticket close canceled - confirmation timed out.', embeds: [], components: [] }).catch(() => {});
                  } catch (error) {
                    logger.error('Error editing timeout message:', error);
                    await message.channel.send('Ticket close canceled - confirmation timed out.').catch(() => {});
                  }
                }
              });
            } catch (error) {
              logger.error("Error sending or handling confirmation message:", error);
            }
          } else {
            try {
              const closeMsg = await message.reply('Closing ticket...');
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
                await message.channel.send("Continuing with ticket closure...").catch(() => {});
              }
            } catch (error) {
              logger.error('Error directly closing ticket:', error);
              try {
                if (message.channel) {
                  await message.channel.send('An error occurred while closing the ticket.').catch(() => {});
                }
              } catch (err) { }
            }
          }
          return;
        }
        return;
      }
      await addMessageToTicket(message, client, true);
      return;
    }

    if (!message.content.startsWith(config.prefix)) return;
    const args = message.content.slice(config.prefix.length).trim().split(/ +/);
    const commandName = args.shift().toLowerCase();

    const command = client.commands.get(commandName);
    if (!command) return;

    try {
      await command.execute(message, args, client);
    } catch (error) {
      logger.error(`Error executing command ${commandName}:`, error);
      message.reply('There was an error trying to execute that command!');
    }
  }
};

async function handleListTicketsCommand(message, client) {
  try {
    const activeTickets = await Ticket.find({ userId: message.author.id, closed: false }).sort({ createdAt: -1 });

    if (activeTickets.length === 0) {
      return message.reply("You don't have any active tickets. Just send me a message to create a new one!");
    }

    let ticketList = `You have ${activeTickets.length} active ticket(s):\n\n`;

    for (const ticket of activeTickets) {
      const guild = client.guilds.cache.get(ticket.guildId);
      const guildName = guild ? guild.name : 'Unknown Server';
      const createdAt = moment(ticket.createdAt).format('MMM D, YYYY [at] h:mm A');

      ticketList += `• Server: **${guildName}**\n`;
      ticketList += `Created: ${createdAt}\n`;
      if (ticket.topic) {
        ticketList += `Topic: ${ticket.topic}\n`;
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
