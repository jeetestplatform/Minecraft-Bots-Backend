const mineflayer = require('mineflayer')

// Create a bot instance
let bot = null;
let temporaryLeaveInProgress = false;
let reconnectAttempts = 0;
const maxReconnectAttempts = 10;

// Function to create and connect bot
function createAndConnectBot() {
  bot = mineflayer.createBot({
    host: 'iitpkunofficial.aternos.me',
    port: 27449,
    username: 'NetherBot',
    version: '1.21.8'
  });
  
  setupBotHandlers();
}

// Setup all bot event handlers
function setupBotHandlers() {
  bot.once('login', () => {
    console.log('Bot logged in successfully')
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
    if (normalizedMessage === 'teleport me to nether') {
      console.log(`Home teleport request from ${username}. Sending /tpahere...`);
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
    else if (normalizedMessage === 'hey homebot, tp vikram') {
      console.log(`Teleport request matched for ${username}. Sending /tpahere...`);
      try {
        bot.chat(`/tpahere ${username}`);
        console.log('Successfully sent /tpahere request');
        setTimeout(() => {
          bot.chat('/tpcancel');
          console.log('Sent /tpcancel to clear pending TPA request');
        }, 20000);
      } catch (err) {
        console.log('Error sending /tpahere:', err.message);
      }
    }
    else if (normalizedMessage === 'hey homebot, tp me') {
      console.log(`Teleport request matched from ${username}. Sending /tpahere...`);
      try {
        bot.chat(`/tpahere ${username}`);
        console.log('Successfully sent /tpahere request');
        setTimeout(() => {
          bot.chat('/tpcancel');
          console.log('Sent /tpcancel to clear pending TPA request');
        }, 20000);
      } catch (err) {
        console.log('Error sending /tpahere:', err.message);
      }
    } else if (normalizedMessage === 'hey homebot, tp sujal') {
      console.log(`Teleport request matched from ${username}. Sending /tpahere...`);
      try {
        bot.chat(`/tpahere ${username}`);
        console.log('Successfully sent /tpahere request');
        setTimeout(() => {
          bot.chat('/tpcancel');
          console.log('Sent /tpcancel to clear pending TPA request');
        }, 20000);
      } catch (err) {
        console.log('Error sending /tpahere:', err.message);
      }
    } else if (normalizedMessage === 'netherbot teleport here' || normalizedMessage === 'netherbot teleport here') {
      console.log(`Teleport request matched from ${username}. Sending /tpa...`);
      try {
        bot.chat(`/tpa ${username}`);
        console.log('Successfully sent /tpa request');
        setTimeout(() => {
          bot.chat('/tpcancel');
          console.log('Sent /tpcancel to clear pending TPA request');
        }, 20000);
      } catch (err) {
        console.log('Error sending /tpa:', err.message);
      }
    } else if (normalizedMessage.includes('you have already sent') && normalizedMessage.includes('teleport request')) {
      console.log('Detected pending TPA request. Canceling it...');
      bot.chat('/tpcancel');
      console.log('Sent /tpcancel to clear existing request');
    } else {
      console.log(`No match. Expected commands: "hey homebot, tp me", "nehterbot teleport here", "teleport me to nether", or "hey homebot, tp vikram". Got: "${normalizedMessage}"`);
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