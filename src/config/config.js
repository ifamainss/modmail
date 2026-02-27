module.exports = {
  prefix: process.env.PREFIX || '=',
  embedColor: '##94f7f1', // Blue
  footer: 'Made by @childeetos',
  statusMessages: {
    online: 'Playing tag with Cacucu',
    idle: 'Playing tag with Cacucu'
  },
  cooldowns: {
    commands: 3, // cooldown in seconds for normal commands
    newTicket: 60, // cooldown in seconds for creating a new ticket
    ticketMessage: 2, // cooldown in seconds between messages in an existing ticket
    staffResponse: 1 // cooldown in seconds for staff responses
  },
  ticketSettings: {
    closeConfirmation: true, // require confirmation before closing a ticket
    transcripts: true, // save ticket transcripts
    logsEnabled: true, // enable logging in a designated channel
    maxOpenTickets: 3, // maximum number of open tickets per user
    autoClose: {
      enabled: true, // automatically close inactive tickets
      inactiveHours: 72 // close tickets inactive for this many hours
    }
  },
  credits: {
    name: '@childeetos',
    website: 'https://discord.gg/Z6sttGGjtY'
  }
}; 
