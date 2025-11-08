  const mineflayer = require('mineflayer')

  // Flag to track if temporary leave is in progress
  let temporaryLeaveInProgress = false;
  let tempLeaveTimeout = null;

  function createBot() {
    const bot = mineflayer.createBot({
      host: 'iitpkunofficial.aternos.me',
      port: 27449,
      username: 'NewHomeBot',
      version: 'auto'
    })

    let reconnectAttempts = 0;
    const maxReconnectAttempts = 10;

    bot.once('login', () => {
      console.log('Bot logged in successfully')
      reconnectAttempts = 0;
      // Reset temporary leave flag on successful login
      temporaryLeaveInProgress = false;
      // Clear any pending timeouts to prevent duplicate reconnections
      if (tempLeaveTimeout) {
        clearTimeout(tempLeaveTimeout);
        tempLeaveTimeout = null;
      }
    })

    bot.on('spawn', () => {
      console.log('Bot has spawned successfully!')
      bot.chat('Hello! I am a bot. Say "hey bot, tp me" to teleport to me.')

      setTimeout(() => {
        try {
          bot.chat('/tp MyBot 100 64 200');
          console.log('Sent /tp command to move bot to X: 100, Y: 64, Z: 200');
        } catch (err) {
          console.error('Error sending /tp command:', err);
        }
      }, 1000)

      bot.setControlState('forward', true)
      setTimeout(() => {
        bot.setControlState('forward', false)
        console.log('Bot stopped moving.')
      }, 2000)
    })

    bot.on('chat', (username, message) => {
      if (username === bot.username) return;

      console.log(`[CHAT DEBUG] Received message from: "${username}" with content: "${message}"`);
      const normalizedMessage = message.toLowerCase().trim();

      // Handle temporary exit and rejoin functionality
      if (normalizedMessage === 'all bot leave' && !temporaryLeaveInProgress) {
        console.log('[LEAVE REQUEST] Received request to leave the server temporarily');
        bot.chat('Leaving server for 30 seconds. Will be right back!');
        
        // Set flag to prevent recursive leave/join cycles
        temporaryLeaveInProgress = true;
        
        setTimeout(() => {
          console.log('Leaving server temporarily...');
          bot.quit();
          
          // Increased wait time to 30 seconds to avoid throttling
          tempLeaveTimeout = setTimeout(() => {
            console.log('Rejoining server after temporary leave...');
            createBot();
          }, 30000); // Increased from 10000 to 30000 ms
        }, 1000);
        
        return;
      }

      // Handle "teleport me" command
      if (normalizedMessage === 'teleport me') {
        console.log(`[TELEPORT DEBUG] Player requested teleport: "${username}"`);
        
        // CRITICAL FIX: Special case for .Vikram8515
        if (username.includes('Vikram')) {
          console.log('[TELEPORT] Detected Vikram user, using hardcoded username');
          // Directly send the command with the hardcoded username
          bot.chat('/tpahere .Vikram8515');
          console.log('[TELEPORT] Sent hardcoded teleport command: /tpahere .Vikram8515');
        } else {
          // For all other players, use their username from the chat event
          console.log(`[TELEPORT] Using chat username: "${username}"`);
          bot.chat(`/tpahere ${username}`);
          console.log(`[TELEPORT] Sent command: /tpahere ${username}`);
        }
        
        // Set a timeout to cancel any pending teleport request
        setTimeout(() => {
          bot.chat('/tpcancel');
          console.log('[TELEPORT] Sent /tpcancel to clear pending request');
        }, 20000);
        
        return;
      }
      
      // Handle other commands
      if (normalizedMessage === 'hey bot, tp me') {
        handleTeleport(bot, username, 'Chaitanya1290');
      } else if (normalizedMessage === 'bot tp me') {
        handleTeleport(bot, username, 'Sujal1002');
      } else if (normalizedMessage === 'teleport here') {
        handleTeleportHere(bot, 'Chaitanya1290');
      }
    })

    function handleTeleport(bot, requester, target) {
      try {
        bot.chat(`/tpahere ${target}`);
        console.log(`Sent /tpahere request to ${target} for ${requester}`);
        setTimeout(() => {
          try {
            bot.chat('/tpcancel');
            console.log('Sent /tpcancel to clear pending TPA request');
          } catch (err) {
            console.error('Error sending tpcancel command:', err);
          }
        }, 20000);
      } catch (err) {
        console.error(`Error in teleport to ${target}:`, err);
      }
    }

    function handleTeleportHere(bot, playerUsername) {
      try {
        bot.chat(`/tpa ${playerUsername}`);
        console.log(`Sent /tpa request to ${playerUsername}`);
        
        setTimeout(() => {
          try {
            bot.chat('/tpcancel');
            console.log('Sent /tpcancel to clear pending TPA request');
          } catch (err) {
            console.error('Error sending tpcancel command:', err);
          }
        }, 20000);
      } catch (err) {
        console.error(`Error in teleport to ${playerUsername}:`, err);
      }
    }

    bot.on('entitySpawn', (entity) => {
      try {
        console.log(`Entity spawned: ${entity.type || 'unknown'}, ID: ${entity.id || 'unknown'}`);
      } catch (err) {
        console.error('Error in entitySpawn:', err);
      }
    })

    bot.on('entityUpdate', (entity) => {
      // Kept empty as in original code
    })

    bot.on('error', (err) => {
      console.error('Bot error:', err);
      if (err.code === 'ECONNRESET') {
        console.log('Connection reset. Possible reasons:');
        console.log('- Server anti-bot measures');
        console.log('- Network issues');
        console.log('- Version mismatch');
      }
    })

    bot.on('end', (reason) => {
      // Only attempt auto-reconnect if NOT in temporary leave mode
      if (!temporaryLeaveInProgress) {
        console.log('Bot disconnected. Reason:', reason);
        if (reconnectAttempts < maxReconnectAttempts) {
          reconnectAttempts++;
          console.log(`Reconnect attempt ${reconnectAttempts}/${maxReconnectAttempts}...`);
          setTimeout(() => {
            createBot(); // Create new bot instance instead of reusing old one
          }, 5000);
        } else {
          console.log('Max reconnect attempts reached. Stopping bot.');
          process.exit(1);
        }
      } else {
        console.log('Bot disconnected for temporary leave. Waiting to rejoin...');
        // We don't need to do anything here as the rejoin is handled by the timeout set earlier
      }
    })

    bot.on('kicked', (reason, loggedIn) => {
      console.log('Bot was kicked. Reason:', reason);
      console.log('Was logged in?', loggedIn);
      
      // Handle connection throttling specifically
      if (reason.includes('throttled') && temporaryLeaveInProgress) {
        console.log('Connection throttled during temporary leave. Extending wait time...');
        
        // Clear the existing timeout if it exists
        if (tempLeaveTimeout) {
          clearTimeout(tempLeaveTimeout);
        }
        
        // Set a new timeout with additional wait time (60 seconds total from now)
        tempLeaveTimeout = setTimeout(() => {
          console.log('Retrying connection after throttle cooldown...');
          createBot();
        }, 60000); // 60 seconds wait after being throttled
      }
    })

    return bot;
  }

  // Initial bot creation
  createBot();

  // Global error handling
  process.on('uncaughtException', (err) => {
    console.error('Unhandled exception:', err);
    // Don't exit process to prevent crashes
  });