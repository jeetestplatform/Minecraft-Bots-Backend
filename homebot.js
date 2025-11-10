const mineflayer = require('mineflayer')

// Create a bot instance
let bot = null;
let temporaryLeaveInProgress = false;
let reconnectAttempts = 0;
const maxReconnectAttempts = 10;
// AFK prevention interval handle
let afkInterval = null;
// Head rotation interval handle for AFK prevention
let headRotationInterval = null;
// tiny wait helper
function wait(ms){ return new Promise(res => setTimeout(res, ms)); }

// Function to create and connect bot
function createAndConnectBot() {
  bot = mineflayer.createBot({
    host: 'iitpkunofficial.aternos.me',
    port: 27449,
    username: 'HomeBot',
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

    // Start periodic AFK prevention jiggle every 5 minutes
    if (!afkInterval) {
      const tap = async (dir, ms=300) => { try { bot.setControlState(dir, true); await wait(ms); bot.setControlState(dir, false); await wait(120); } catch (_) {} };
      afkInterval = setInterval(async () => {
        try {
          // forward, back, right, left (~1 block each)
          await tap('forward', 300);
          await tap('back', 300);
          await tap('right', 300);
          await tap('left', 300);
        } catch (e) {
          console.log('AFK jiggle error:', e?.message || e);
        }
      }, 300000); // 5 minutes
      console.log('AFK prevention interval started');
    }

    // Start periodic head rotation every 1 minute to prevent AFK detection
    if (!headRotationInterval) {
      headRotationInterval = setInterval(async () => {
        try {
          const currentYaw = bot.entity.yaw;
          const currentPitch = bot.entity.pitch;
          
          // Look left
          await bot.look(currentYaw + Math.PI / 2, currentPitch, true);
          await wait(250);
          
          // Look right
          await bot.look(currentYaw - Math.PI / 2, currentPitch, true);
          await wait(250);
          
          // Look up
          await bot.look(currentYaw, -Math.PI / 4, true);
          await wait(250);
          
          // Look down
          await bot.look(currentYaw, Math.PI / 4, true);
          await wait(250);
          
          // Return to original position
          await bot.look(currentYaw, currentPitch, true);
        } catch (e) {
          console.log('Head rotation error:', e?.message || e);
        }
      }, 60000); // 1 minute
      console.log('Head rotation interval started');
    }
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
    if (username === '.Vikram8515' && normalizedMessage === 'teleport me to home') {
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
    // Handle teleport me to home from any other player
    else if (normalizedMessage === 'teleport me to home') {
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
      console.log(`Teleport request matched for ${username}. Sending /tpahere...`);
      try {
        bot.chat(`/tpahere ${username}`);
        console.log(`Successfully sent /tpahere request to ${username}`);
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
        console.log(`Successfully sent /tpahere request to ${username}`);
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
        console.log(`Successfully sent /tpahere request to ${username}`);
        setTimeout(() => {
          bot.chat('/tpcancel');
          console.log('Sent /tpcancel to clear pending TPA request');
        }, 20000);
      } catch (err) {
        console.log('Error sending /tpahere:', err.message);
      }
    } else if (normalizedMessage === 'homebot teleport here' || normalizedMessage === 'homebot teleport here') {
      console.log(`Teleport request matched from ${username}. Sending /tpa...`);
      try {
        bot.chat(`/tpa ${username}`);
        console.log(`Successfully sent /tpa request to ${username}`);
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
      console.log(`No match. Expected commands: "hey homebot, tp me", "homebot teleport here", "teleport me to home", or "hey homebot, tp vikram". Got: "${normalizedMessage}"`);
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
    // Clear AFK intervals on disconnect to avoid duplicates
    if (afkInterval) { clearInterval(afkInterval); afkInterval = null; }
     if (headRotationInterval) { clearInterval(headRotationInterval); headRotationInterval = null; }
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