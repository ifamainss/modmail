const { ActivityType } = require('discord.js');
const config = require('../config/config');
const logger = require('../utils/logger');

module.exports = {
  name: 'ready',
  once: true,
  execute(client) {
    // Log that the bot is online
    logger.info(`Ready! Logged in as ${client.user.tag}`);
    logger.info('ModMail bot created by Izzy | Coders Planet');
    
    // Set bot status - something clearer about DMing to create tickets
    client.user.setPresence({
      activities: [{ 
        name: 'Playing tag with Cacucu',
        type: ActivityType.Custom 
      }],
      status: 'online'
    });

    // Check for required environment variables
    const requiredEnvVars = [
      'TOKEN', 
      'MONGODB_URI', 
      'CLIENT_ID'
    ];

    const missingEnvVars = requiredEnvVars.filter(varName => !process.env[varName]);
    
    if (missingEnvVars.length > 0) {
      logger.warn(`Missing required environment variables: ${missingEnvVars.join(', ')}`);
    }
    
    // Display credit banner in console
    console.log(`
╔═══════════════════════════════════════════════════════════════╗
║                                                               ║
║   ModMail Bot is now online!                                  ║
║                                                               ║
║   Created by: Izzy | Coders Planet                            ║
║   Discord: https://discord.gg/codersplanet                    ║
║                                                               ║
║   Serving ${client.guilds.cache.size} servers and ${client.users.cache.size} users                      ║
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝
    `);
    
    // Set the status again after a short delay to ensure it sticks
    setTimeout(() => {
      client.user.setPresence({
        activities: [{ 
          name: 'Playing tag with Cacucu',
          type: ActivityType.Playing
        }],
        status: 'online'
      });
    }, 10000);
  }
}; 
