const mineflayer = require('mineflayer')

// Create a bot instance
let bot = null;
let temporaryLeaveInProgress = false;
let reconnectAttempts = 0;
const maxReconnectAttempts = 10;

// Function to create and connect bot
function createAndConnectBot() {
  bot = mineflayer.createBot({
    host: 'peacemp01.aternos.me',
    port: 23506,
    username: 'XPFarmBot',
    version: '1.21.5' // Fallback to 1.21.4
  });
  
  setupBotHandlers();
}

// Setup all bot event handlers
function setupBotHandlers() {
  bot.once('login', () => {
    console.log(`Connected with protocol version: ${bot.protocolVersion}`);
    console.log('Bot logged in successfully');
    reconnectAttempts = 0; // Reset on successful login
    temporaryLeaveInProgress = false;
  })

  bot.on('spawn', () => {
    console.log('Bot has spawned successfully!')
    bot.chat('Hello! I am a bot. Say "hey homebot, tp me" to teleport to me.')

    setTimeout(() => {
      try {
        bot.chat('/tp HomeBot 100 64 200');
        console.log('Sent /tp command to move bot to X: 100, Y: 64, Z: 200');
      } catch (err) {
        console.log('Error sending /tp command:', err.message);
      }
    }, 1000)

    bot.setControlState('forward', true)
    setTimeout(() => {
      bot.setControlState('forward', false)
      console.log('Bot stopped moving.')
    }, 2000)
  })

  bot.on('chat', (username, message) => {
    if (username === bot.username) return
    console.log(`[Chat Received] Username: "${username}", Raw Message: "${message}"`);

    const normalizedMessage = message.toLowerCase().trim();
    console.log(`[Chat Normalized] "${normalizedMessage}"`);

    // Handle temporary exit and rejoin functionality
    if (normalizedMessage === 'all bot leave' && !temporaryLeaveInProgress) {
      console.log('[LEAVE REQUEST] Received request to leave the server temporarily');
      bot.chat('Leaving server for 10 seconds. Will be right back!');
      
      // Set flag to prevent recursive leave/join
      temporaryLeaveInProgress = true;
      
      setTimeout(() => {
        console.log('Leaving server temporarily...');
        
        // Disconnect the bot
        bot.quit();
        
        // Set timeout to rejoin after 10 seconds
        setTimeout(() => {
          if (temporaryLeaveInProgress) {
            console.log('Rejoining server after temporary leave...');
            createAndConnectBot();
          }
        }, 10000);
      }, 1000);
      
      return;
    }

    // Special handling for .Vikram8515
    if (username === '.Vikram8515' && normalizedMessage === 'teleport me to xpfarm') {
      console.log(`Special case: Home teleport request from .Vikram8515. Sending direct /tpahere...`);
      try {
        // Use explicit username for .Vikram8515
        bot.chat('/tpahere .Vikram8515');
        console.log('Successfully sent /tpahere request to .Vikram8515 (explicit username)');
        setTimeout(() => {
          bot.chat('/tpcancel');
          console.log('Sent /tpcancel to clear pending TPA request');
        }, 20000);
      } catch (err) {
        console.log('Error sending /tpahere to .Vikram8515:', err.message);
      }
    }
    // Handle teleport me to xpfarm from any other player
    else if (normalizedMessage === 'teleport me to xpfarm') {
      console.log(`Home teleport request from ${username}. Sending /tpahere to ${username}...`);
      try {
        bot.chat(`/tpahere ${username}`);
        console.log(`Successfully sent /tpahere request to ${username}`);
        setTimeout(() => {
          bot.chat('/tpcancel');
          console.log('Sent /tpcancel to clear pending TPA request');
        }, 20000);
      } catch (err) {
        console.log(`Error sending /tpahere to ${username}:`, err.message);
      }
    } 
    // Add specific support for .Vikram8515 with another command
    else if (normalizedMessage === 'hey homebot, tp vikram') {
      console.log(`Teleport request matched for Vikram. Sending /tpahere to .Vikram8515...`);
      try {
        bot.chat('/tpahere .Vikram8515');
        console.log('Successfully sent /tpahere request to .Vikram8515');
        setTimeout(() => {
          bot.chat('/tpcancel');
          console.log('Sent /tpcancel to clear pending TPA request');
        }, 20000);
      } catch (err) {
        console.log('Error sending /tpahere:', err.message);
      }
    }
    else if (normalizedMessage === 'hey homebot, tp me') {
      console.log(`Teleport request matched from ${username}. Sending /tpahere to Chaitanya1290...`);
      try {
        bot.chat('/tpahere Chaitanya1290');
        console.log('Successfully sent /tpahere request to Chaitanya1290');
        setTimeout(() => {
          bot.chat('/tpcancel');
          console.log('Sent /tpcancel to clear pending TPA request');
        }, 20000);
      } catch (err) {
        console.log('Error sending /tpahere:', err.message);
      }
    } else if (normalizedMessage === 'hey homebot, tp sujal') {
      console.log(`Teleport request matched from ${username}. Sending /tpahere to Sujal1002...`);
      try {
        bot.chat('/tpahere Sujal1002');
        console.log('Successfully sent /tpahere request to Sujal1002');
        setTimeout(() => {
          bot.chat('/tpcancel');
          console.log('Sent /tpcancel to clear pending TPA request');
        }, 20000);
      } catch (err) {
        console.log('Error sending /tpahere:', err.message);
      }
    } else if (normalizedMessage === 'xpfarmbot teleport here' || normalizedMessage === 'xpfarmbot teleport here') {
      console.log(`Teleport request matched from ${username}. Sending /tpa to Chaitanya1290...`);
      try {
        bot.chat('/tpa Chaitanya1290');
        console.log('Successfully sent /tpa request to Chaitanya1290');
        setTimeout(() => {
          bot.chat('/tpcancel');
          console.log('Sent /tpcancel to clear pending TPA request');
        }, 20000);
      } catch (err) {
        console.log('Error sending /tpa:', err.message);
      }
    } else if (normalizedMessage.includes('you have already sent chaitanya1290 a teleport request')) {
      console.log('Detected pending TPA request. Canceling it...');
      bot.chat('/tpcancel');
      console.log('Sent /tpcancel to clear existing request');
      setTimeout(() => {
        bot.chat('/tpahere Chaitanya1290');
        console.log('Retried /tpahere request to Chaitanya1290');
      }, 1000);
    } else {
      console.log(`No match. Expected commands: "hey homebot, tp me", "xpfarmbot teleport here", "teleport me to xpfarm", or "hey homebot, tp vikram". Got: "${normalizedMessage}"`);
    }
  })

  // Debug a username-related issue by logging player list
  bot.on('playerJoined', (player) => {
    console.log(`Player joined: ${player.username}`);
    // Log all players currently online
    console.log('Current players:', Object.keys(bot.players));
  })

  bot.on('entitySpawn', (entity) => {
    try {
      if (entity && typeof entity === 'object') {
        console.log(`Entity spawned: ${entity.type || 'unknown'}, ID: ${entity.id || 'unknown'}`);
      } else {
        console.log('Invalid entity data in spawn event');
      }
    } catch (err) {
      console.log('Error in entitySpawn:', err.message);
    }
  })

  bot.on('entityUpdate', (entity) => {
    try {
      if (entity && entity.position) {
        // Minimal processing
      }
    } catch (err) {
      console.log('Error in entityUpdate:', err.message);
    }
  })

  bot.on('error', (err) => {
    console.log('Bot error:', err.message || err)
    if (err.code === 'ECONNRESET') {
      console.log('Connection reset. Possible reasons:');
      console.log('- Server anti-bot measures.');
      console.log('- Network issues.');
      console.log('- Version mismatch.');
    }
  })

  bot.on('end', (reason) => {
    // Only attempt normal reconnect if not in temporary leave mode
    if (!temporaryLeaveInProgress) {
      console.log('Bot disconnected. Reason:', reason)
      if (reconnectAttempts < maxReconnectAttempts) {
        reconnectAttempts++;
        console.log(`Reconnect attempt ${reconnectAttempts}/${maxReconnectAttempts}...`);
        setTimeout(() => {
          createAndConnectBot();
        }, 5000)
      } else {
        console.log('Max reconnect attempts reached. Stopping bot.');
        process.exit(1); // Exit gracefully
      }
    } else {
      console.log('Bot disconnected for temporary leave. Waiting to rejoin...');
    }
  })

  bot.on('kicked', (reason, loggedIn) => {
    console.log('Bot was kicked. Reason:', reason)
    console.log('Was the bot logged in?', loggedIn)
  })
}

// Initial creation and connection
createAndConnectBot();

// Global error handling
process.on('uncaughtException', (err) => {
  console.log('Unhandled exception:', err.message);
});