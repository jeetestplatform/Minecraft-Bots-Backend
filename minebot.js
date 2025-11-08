const mineflayer = require('mineflayer');
const { Vec3 } = require('vec3');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const { GoalBlock, GoalNear, GoalXZ, GoalY, GoalInvert, GoalFollow } = goals;

/**
 * Bot State Management Object
 * Manages all bot states to prevent overlaps and ensure smooth operation
 */
const botState = {
  isMining: false,           // Status for general area mining
  isCollectingItems: false,  // Status for item collection
  isInCombat: false,         // Status for combat engagement
  isCollectingFood: false,   // Status for food collection
  isMiningCoal: false,       // Status for coal mining
  isMiningIron: false,       // Status for iron mining
  stopRequested: false,      // Global stop flag for all tasks
  currentTask: null,         // Details of the current task
  safePosition: null,        // Last known safe position for recovery
  inventoryFull: false,      // Flag for full inventory
  isProcessingCommand: false // Lock for command processing
};

/**
 * Updates a state variable and logs the change
 * @param {string} key - State key to update
 * @param {*} value - New value for the key
 */
function setState(key, value) {
  botState[key] = value;
  logDebug(`State updated: ${key} = ${value}`);
}

/**
 * Retrieves the current value of a state variable
 * @param {string} key - State key to retrieve
 * @returns {*} Current value of the key
 */
function getState(key) {
  return botState[key];
}

/**
 * Initializes the Mineflayer bot with server connection details
 */
const bot = mineflayer.createBot({
  host: 'iitpkunofficial.aternos.me',   // Server host (update if different)
  port: 27449,                    // Server port (update if different)
  username: 'MineBot',            // Bot's username
  version: '1.21.1',              // Pinned Minecraft version
  hideErrors: false,              // Show all errors for debugging
  checkTimeoutInterval: 120000,   // Increase to check connection every 2 minutes
  keepAlive: true,                // Keep connection alive
  respawn: true                   // Automatically respawn on death
});

// Loads the pathfinder plugin for advanced navigation capabilities
bot.loadPlugin(pathfinder);

// Global Configuration Variables
let reconnectAttempts = 0;         // Counter for reconnection attempts
const MAX_RECONNECT_ATTEMPTS = 15; // Increased max attempts
let miningTask = null;             // Current mining task coordinates
let miningQueue = [];              // Queue of blocks to mine
const REACH_DISTANCE = 5;          // Maximum reach distance for mining (blocks)
let pathfinderInitialized = false; // Tracks if pathfinder is initialized
let lastProgressUpdate = 0;        // Timestamp of last progress update
let lastFoodReport = {             // Tracks collected food items
  beef: 0,
  porkchop: 0,
  mutton: 0,
  chicken: 0,
  rabbit: 0
};
let lastOreReport = {              // Tracks collected ore counts
  coal: 0,
  iron: 0
};
const SEARCH_RADIUS = 128;         // Search radius for resources (blocks)

/**
 * Calculates the Euclidean distance between two 3D positions
 * @param {Vec3} pos1 - First position
 * @param {Vec3} pos2 - Second position
 * @returns {number} Distance between the two positions
 */
function distanceTo(pos1, pos2) {
  try {
    const dx = pos1.x - pos2.x;
    const dy = pos1.y - pos2.y;
    const dz = pos1.z - pos2.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  } catch (err) {
    logDebug('Distance calculation error: ' + err.message);
    return Infinity; // Return a safe default on error
  }
}

/**
 * Checks if a position is within the current mining area with a buffer zone
 * @param {Vec3} pos - Position to check
 * @returns {boolean} True if within mining area, false otherwise
 */
function isInMiningArea(pos) {
  if (!miningTask) {
    logDebug('No mining task defined for area check');
    return true; // Default to true if no task
  }
  try {
    const buffer = 5; // Buffer zone around mining area
    return pos.x >= miningTask.start.x - buffer &&
           pos.x <= miningTask.end.x + buffer &&
           pos.y >= miningTask.start.y - buffer &&
           pos.y <= miningTask.end.y + buffer &&
           pos.z >= miningTask.start.z - buffer &&
           pos.z <= miningTask.end.z + buffer;
  } catch (err) {
    logDebug('Mining area check error: ' + err.message);
    return false;
  }
}

/**
 * Pauses execution for a specified number of milliseconds
 * @param {number} ms - Milliseconds to wait
 * @returns {Promise} Resolves after the specified delay
 */
function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Sends a message to the server chat
 * @param {string} message - Message to send
 */
function chat(message) {
  try {
    bot.chat(message);
    console.log(`Bot said: ${message}`);
  } catch (err) {
    console.error('Chat error:', err);
    logDebug('Failed to send chat message: ' + err.message);
  }
}

/**
 * Logs a debug message with a timestamp for diagnostics
 * @param {string} message - Message to log
 */
function logDebug(message) {
  const now = new Date().toISOString();
  console.log(`[${now}] DEBUG: ${message}`);
}

/**
 * Retrieves the best available pickaxe from the inventory
 * @returns {Object|null} Best pickaxe item or null if none available
 */
function getBestPickaxe() {
  const pickPriority = [
    'netherite_pickaxe',
    'diamond_pickaxe',
    'iron_pickaxe',
    'stone_pickaxe',
    'wooden_pickaxe',
    'golden_pickaxe'
  ];
  try {
    const inventory = bot.inventory.items();
    for (const type of pickPriority) {
      const pick = inventory.find(item => item.name === type);
      if (pick) {
        logDebug(`Found pickaxe: ${pick.name}`);
        return pick;
      }
    }
    logDebug('No pickaxe found in inventory');
    return null;
  } catch (err) {
    logDebug('Pickaxe retrieval error: ' + err.message);
    return null;
  }
}

/**
 * Determines the best tool for a given block type based on efficiency
 * @param {string} blockType - Type of block to mine
 * @returns {Object|null} Best tool for the block or null if none
 */
function getBestTool(blockType) {
  const efficiencyMap = {
    // Blocks best mined with shovels (fastest)
    shovel: [
      'dirt', 'grass_block', 'podzol', 'mycelium', 'soul_sand', 'soul_soil',
      'sand', 'red_sand', 'gravel', 'clay', 'snow', 'snow_block', 'farmland',
      'mud', 'mud_block'
    ],
    // Blocks best mined with pickaxes (fastest)
    pickaxe: [
      'stone', 'cobblestone', 'granite', 'diorite', 'andesite', 'deepslate',
      'ore', 'coal_ore', 'iron_ore', 'gold_ore', 'diamond_ore', 'emerald_ore',
      'redstone_ore', 'lapis_ore', 'copper_ore', 'quartz_ore', 'ancient_debris',
      'obsidian', 'crying_obsidian', 'netherrack', 'basalt', 'blackstone',
      'end_stone', 'brick', 'terracotta', 'concrete'
    ],
    // Blocks best mined with hoes (fastest)
    hoe: [
      'hay_block', 'sponge', 'wet_sponge', 'leaves', 'vine', 'nether_wart_block',
      'warped_wart_block', 'shroomlight'
    ]
  };

  try {
    const inventory = bot.inventory.items();

    // Check which tool category is most efficient for this block
    let toolCategory = 'pickaxe'; // Default to pickaxe if no match
    if (efficiencyMap.shovel.some(type => blockType.includes(type))) {
      toolCategory = 'shovel';
    } else if (efficiencyMap.hoe.some(type => blockType.includes(type))) {
      toolCategory = 'hoe';
    }

    // Define priority lists for each tool type
    const toolPriorities = {
      pickaxe: [
        'netherite_pickaxe', 'diamond_pickaxe', 'iron_pickaxe',
        'stone_pickaxe', 'wooden_pickaxe', 'golden_pickaxe'
      ],
      shovel: [
        'netherite_shovel', 'diamond_shovel', 'iron_shovel',
        'stone_shovel', 'wooden_shovel', 'golden_shovel'
      ],
      hoe: [
        'netherite_hoe', 'diamond_hoe', 'iron_hoe',
        'stone_hoe', 'wooden_hoe', 'golden_hoe'
      ]
    };

    // Find the best tool in the inventory for the determined category
    for (const toolName of toolPriorities[toolCategory]) {
      const tool = inventory.find(item => item.name === toolName);
      if (tool) {
        logDebug(`Found efficient ${toolCategory} for ${blockType}: ${tool.name}`);
        return tool;
      }
    }

    // If no specific tool is found, fall back to any available tool
    for (const category in toolPriorities) {
      for (const toolName of toolPriorities[category]) {
        const fallbackTool = inventory.find(item => item.name === toolName);
        if (fallbackTool) {
          logDebug(`No optimal tool found, falling back to: ${fallbackTool.name}`);
          return fallbackTool;
        }
      }
    }

    logDebug(`No tools found for ${blockType}, requesting tools`);
    return null;

  } catch (err) {
    logDebug('Tool selection error: ' + err.message);
    return null;
  }
}

/**
 * Retrieves the best available weapon from the inventory
 * @returns {Object|null} Best weapon or null if none available
 */
function getBestWeapon() {
  const weaponPriority = [
    'netherite_sword', 'diamond_sword', 'iron_sword', 'stone_sword', 'wooden_sword',
    'netherite_axe', 'diamond_axe', 'iron_axe', 'stone_axe', 'wooden_axe',
    'golden_sword', 'golden_axe'
  ];
  try {
    const inventory = bot.inventory.items();
    for (const type of weaponPriority) {
      const weapon = inventory.find(item => item.name === type);
      if (weapon) {
        logDebug(`Found weapon: ${weapon.name}`);
        return weapon;
      }
    }
    logDebug('No weapon found, falling back to pickaxe');
    return getBestPickaxe();
  } catch (err) {
    logDebug('Weapon retrieval error: ' + err.message);
    return null;
  }
}

/**
 * Equips the best tool or weapon for the task
 * @param {string} type - 'tool' or 'weapon'
 * @returns {Promise<boolean>} True if equipped successfully, false otherwise
 */
async function equipBestToolOrWeapon(type) {
  const item = type === 'tool' ? getBestTool('stone') : getBestWeapon();
  if (!item) {
    logDebug(`No ${type} available to equip`);
    await requestTools(type);
    return false;
  }

  try {
    await bot.equip(item, 'hand');
    logDebug(`Successfully equipped ${type}: ${item.name}`);
    return true;
  } catch (err) {
    logDebug(`Error equipping ${type}: ${err.message}`);
    await wait(1000); // Increased wait time
    return await equipBestToolOrWeapon(type); // Retry with longer delay
  }
}

/**
 * Checks if the bot has any usable tools in its inventory
 * @returns {boolean} True if tools are available, false otherwise
 */
function checkTools() {
  try {
    const inventory = bot.inventory.items();
    const hasTools = inventory.some(item => 
      item.name.includes('pickaxe') || 
      item.name.includes('shovel') || 
      item.name.includes('hoe')
    );
    logDebug(`Tool check: ${hasTools ? 'Tools available' : 'No tools found'}`);
    return hasTools;
  } catch (err) {
    logDebug('Tool check error: ' + err.message);
    return false;
  }
}

/**
 * Ensures the bot has the necessary tools, requesting if needed
 * @param {string} type - Type of tool ('tool' or 'weapon')
 * @returns {Promise<boolean>} True if tools are ready, false if stopped
 */
async function ensureTools(type = 'tool') {
  let attempts = 0;
  const MAX_ATTEMPTS = 12; // Increased to check every 10 seconds for 2 minutes

  while (attempts < MAX_ATTEMPTS && !getState('stopRequested')) {
    if (checkTools()) {
      logDebug(`${type}s are available after ${attempts} attempts`);
      return true;
    }

    chat(`Chaitanya1290, I need ${type}s to continue! Please drop them near me.`);
    logDebug(`Waiting for ${type}s from player, attempt ${attempts + 1} of ${MAX_ATTEMPTS}`);

    await wait(10000); // Wait 10 seconds between checks
    attempts++;
  }

  if (getState('stopRequested')) {
    logDebug('Tool request aborted due to stop request');
    return false;
  }

  logDebug('Failed to acquire tools after maximum attempts');
  chat('Could not acquire tools! Operation aborted.');
  return false;
}

/**
 * Requests tools or weapons from a player
 * @param {string} type - Type of item to request ('tool' or 'weapon')
 */
function requestTools(type) {
  try {
    chat(`Hey Chaitanya1290, please drop some ${type}s for me near my location!`);
    logDebug(`Requested ${type}s from Chaitanya1290`);
  } catch (err) {
    logDebug('Tool request error: ' + err.message);
  }
}

/**
 * Sets up the pathfinder with professional-grade settings for navigation
 */
function setupPathfinder() {
  if (pathfinderInitialized) {
    logDebug('Pathfinder already initialized');
    return;
  }

  try {
    const movements = new Movements(bot);
    movements.allowSprinting = true;      // Enables sprinting for faster movement
    movements.canDig = true;              // Allows digging through obstacles
    movements.allow1by1towers = true;     // Permits building single-block towers
    movements.allowParkour = true;        // Enables jumping over gaps
    movements.dontCreateFlow = true;      // Prevents water/lava flow creation
    movements.allowFreeMotion = true;     // Allows free movement in open areas
    movements.maxDropDown = 4;            // Allows safe drops up to 4 blocks

    // Adds available scaffolding blocks from inventory
    movements.scafoldingBlocks = bot.inventory.items().filter(item =>
      ['dirt', 'cobblestone', 'stone', 'sand'].includes(item.name)
    );

    bot.pathfinder.setMovements(movements);
    pathfinderInitialized = true;
    logDebug('Pathfinder initialized with professional settings');
  } catch (err) {
    logDebug('Pathfinder setup error: ' + err.message);
    pathfinderInitialized = false;
    setTimeout(() => setupPathfinder(), 5000); // Retry after 5 seconds
  }
}

/**
 * Navigates the bot to a specified position with obstacle handling
 * @param {Vec3} position - Target position to reach
 * @param {Object} options - Navigation options (maxRetries, range)
 * @returns {Promise<boolean>} True if position reached, false otherwise
 */
async function goToPosition(position, options = {}) {
  const maxRetries = options.maxRetries || 5;
  const range = options.range || 2;
  let retries = 0;

  while (retries < maxRetries && !getState('stopRequested')) {
    try {
      logDebug(`Navigating to (${position.x}, ${position.y}, ${position.z}), attempt ${retries + 1} of ${maxRetries}`);
      await bot.pathfinder.goto(new GoalNear(position.x, position.y, position.z, range));
      setState('safePosition', bot.entity.position.clone());
      logDebug('Successfully reached target position');
      return true;
    } catch (err) {
      retries++;
      logDebug(`Navigation attempt ${retries} failed: ${err.message}`);

      if (retries < maxRetries) {
        logDebug('Attempting to handle navigation obstacle');
        await handleNavigationObstacle(position);
        await wait(1000);
      } else {
        logDebug('Maximum retries reached, attempting recovery');
        const recovered = await handleFallRecovery();
        return recovered;
      }
    }
  }
  logDebug('Navigation aborted due to stop request or failure');
  return false;
}

/**
 * Handles obstacles encountered during navigation
 * @param {Vec3} targetPos - Target position being navigated to
 */
async function handleNavigationObstacle(targetPos) {
  try {
    const currentPos = bot.entity.position;
    const direction = targetPos.minus(currentPos).normalize();
    const jumpPos = currentPos.plus(direction.scaled(2)).setY(currentPos.y + 1.6);

    logDebug('Attempting to jump over obstacle');
    await bot.setControlState('jump', true);
    await wait(200);
    await bot.setControlState('jump', false);
    await goToPosition(jumpPos, { range: 1, maxRetries: 2 });

    const blockBelow = bot.blockAt(currentPos.offset(0, -1, 0));
    if (blockBelow && blockBelow.diggable && blockBelow.boundingBox !== 'empty') {
      logDebug(`Digging block below at (${blockBelow.position.x}, ${blockBelow.position.y}, ${blockBelow.position.z})`);
      await bot.dig(blockBelow);
      await wait(300);
    }
  } catch (err) {
    logDebug('Obstacle handling failed: ' + err.message);
  }
}

/**
 * Builds a queue of blocks to mine within the specified area
 * @returns {Promise<Vec3[]>} Array of block positions to mine
 */
async function buildMiningQueue() {
  if (!miningTask) {
    logDebug('No mining task defined for queue building');
    return [];
  }

  const queue = [];
  const volumeSize = 
    (miningTask.end.x - miningTask.start.x + 1) * 
    (miningTask.end.y - miningTask.start.y + 1) * 
    (miningTask.end.z - miningTask.start.z + 1);

  logDebug(`Building mining queue for volume of ${volumeSize} blocks`);

  try {
    for (let y = miningTask.end.y; y >= miningTask.start.y; y--) {
      for (let x = miningTask.start.x; x <= miningTask.end.x; x++) {
        for (let z = miningTask.start.z; z <= miningTask.end.z; z++) {
          const pos = new Vec3(x, y, z);
          const block = bot.blockAt(pos);
          if (block && block.diggable && !['air', 'water', 'lava'].includes(block.name)) {
            queue.push(pos);
            logDebug(`Added block at (${pos.x}, ${pos.y}, ${pos.z}) to queue`);
          }
        }
      }
    }

    // Sort queue by proximity to bot for efficient mining
    queue.sort((a, b) => distanceTo(bot.entity.position, a) - distanceTo(bot.entity.position, b));
    logDebug(`Mining queue constructed with ${queue.length} blocks`);
    return queue;
  } catch (err) {
    logDebug('Queue building error: ' + err.message);
    return [];
  }
}

/**
 * Navigates the bot to the mining area using multiple entry points
 * @returns {Promise<boolean>} True if area reached, false otherwise
 */
async function navigateToMiningArea() {
  if (!miningTask) {
    logDebug('No mining task defined for navigation');
    return false;
  }

  const entryPoints = [
    new Vec3(
      Math.floor((miningTask.start.x + miningTask.end.x) / 2),
      miningTask.end.y + 2,
      Math.floor((miningTask.start.z + miningTask.end.z) / 2)
    ),
    new Vec3(
      miningTask.start.x - 2,
      Math.floor((miningTask.start.y + miningTask.end.y) / 2),
      miningTask.start.z - 2
    ),
    new Vec3(
      miningTask.end.x + 2,
      Math.floor((miningTask.start.y + miningTask.end.y) / 2),
      miningTask.end.z + 2
    )
  ];

  try {
    for (const entry of entryPoints) {
      logDebug(`Attempting to navigate to entry point (${entry.x}, ${entry.y}, ${entry.z})`);
      if (await goToPosition(entry, { range: 5, maxRetries: 3 })) {
        logDebug('Successfully reached mining area entry point');
        return true;
      }
      if (getState('stopRequested')) {
        logDebug('Navigation stopped by request');
        return false;
      }
    }

    const center = new Vec3(
      Math.floor((miningTask.start.x + miningTask.end.x) / 2),
      Math.floor((miningTask.start.y + miningTask.end.y) / 2),
      Math.floor((miningTask.start.z + miningTask.end.z) / 2)
    );
    logDebug(`Falling back to center position (${center.x}, ${center.y}, ${center.z})`);
    const success = await goToPosition(center, { range: 10, maxRetries: 3 });
    if (success) {
      logDebug('Reached mining area center');
      return true;
    }
    logDebug('Failed to navigate to mining area');
    return false;
  } catch (err) {
    logDebug('Mining area navigation error: ' + err.message);
    return false;
  }
}

/**
 * Mines a single block with professional precision and obstacle handling
 * @param {Vec3} position - Position of the block to mine
 * @returns {Promise<boolean>} True if mined successfully, false otherwise
 */
async function mineBlock(position) {
  const block = bot.blockAt(position);

  if (!block) {
    logDebug(`No block found at (${position.x}, ${position.y}, ${position.z})`);
    return true; // Block might already be mined
  }

  if (!block.diggable || ['air', 'water', 'lava'].includes(block.name)) {
    logDebug(`Block at (${position.x}, ${position.y}, ${position.z}) is not diggable: ${block.name}`);
    return true;
  }

  if (!await ensureTools('tool')) {
    chat('Cannot mine without tools!');
    logDebug('Mining aborted due to lack of tools');
    return false;
  }

  const distance = distanceTo(bot.entity.position, position);
  if (distance > REACH_DISTANCE) {
    logDebug(`Block at (${position.x}, ${position.y}, ${position.z}) out of reach: ${distance} blocks`);
    const approachPos = position.offset(
      Math.sign(position.x - bot.entity.position.x),
      0,
      Math.sign(position.z - bot.entity.position.z)
    );
    if (!await goToPosition(approachPos, { range: 1, maxRetries: 4 })) {
      logDebug('Failed to approach block for mining');
      return false;
    }
  }

  try {
    const tool = getBestTool(block.name);
    if (!tool) {
      logDebug(`No suitable tool found for ${block.name}, requesting tools`);
      await requestTools('tool');
      return false;
    }

    await equipBestToolOrWeapon('tool');
    await bot.lookAt(position.plus(new Vec3(0.5, 0.5, 0.5)));

    logDebug(`Mining ${block.name} at (${position.x}, ${position.y}, ${position.z}) with ${tool.name}`);
    await bot.dig(block, true); // Force dig for efficiency

    setState('safePosition', bot.entity.position.clone());
    logDebug(`Successfully mined ${block.name}`);
    return true;
  } catch (err) {
    logDebug(`Mining error at (${position.x}, ${position.y}, ${position.z}): ${err.message}`);
    if (err.message.includes('no block') || err.message.includes('already air')) {
      logDebug('Block was already mined or removed');
      return true;
    }
    return false;
  }
}

/**
 * Collects nearby dropped items with efficiency
 */
async function collectNearbyItems() {
  if (getState('isCollectingItems')) {
    logDebug('Already collecting items, skipping');
    return;
  }
  setState('isCollectingItems', true);

  try {
    const items = Object.values(bot.entities).filter(e =>
      e.type === 'object' &&
      e.objectType === 'Item' &&
      distanceTo(bot.entity.position, e.position) < 15
    );

    if (!items.length) {
      logDebug('No items found within collection range');
      return;
    }

    logDebug(`Found ${items.length} items to collect`);
    for (const item of items.sort((a, b) =>
      distanceTo(bot.entity.position, a.position) - distanceTo(bot.entity.position, b.position))) {
      if (getState('stopRequested')) {
        logDebug('Item collection stopped by request');
        break;
      }

      logDebug(`Collecting item at (${item.position.x.toFixed(2)}, ${item.position.y.toFixed(2)}, ${item.position.z.toFixed(2)})`);
      const success = await goToPosition(item.position, { range: 1, maxRetries: 3 });
      if (success) {
        await wait(300); // Wait for item pickup
        logDebug(`Collected item at (${item.position.x}, ${item.position.y}, ${item.position.z})`);
      } else {
        logDebug(`Failed to reach item at (${item.position.x}, ${item.position.y}, ${item.position.z})`);
      }
    }
    logDebug('Item collection process completed');
  } catch (err) {
    logDebug('Item collection error: ' + err.message);
  } finally {
    setState('isCollectingItems', false);
  }
}

/**
 * Mines a specified area with professional efficiency and obstacle handling
 */
async function mineArea() {
  if (getState('isMining')) {
    logDebug('Already performing a mining task');
    chat('Already mining! Stop current task first.');
    return;
  }
  setState('isMining', true);
  setState('stopRequested', false);

  try {
    logDebug('Starting area mining operation');
    setupPathfinder();

    const reachedArea = await navigateToMiningArea();
    if (!reachedArea) {
      chat('Failed to reach mining area! Check coordinates or path.');
      logDebug('Area navigation failed');
      return;
    }

    miningQueue = await buildMiningQueue();
    if (miningQueue.length === 0) {
      chat('No blocks to mine in the specified area!');
      logDebug('Mining queue is empty');
      return;
    }

    chat(`Commencing pro-level mining of ${miningQueue.length} blocks...`);
    logDebug(`Mining operation started with ${miningQueue.length} blocks`);

    let completedBlocks = 0;
    const startTime = Date.now();

    for (const position of miningQueue) {
      if (getState('stopRequested')) {
        logDebug('Mining operation stopped by request');
        break;
      }

      // Collect items periodically to keep inventory manageable
      if (completedBlocks % 5 === 0) {
        logDebug('Periodic item collection triggered');
        await collectNearbyItems();
      }

      // Check if bot has strayed from mining area
      if (!isInMiningArea(bot.entity.position)) {
        logDebug('Bot detected outside mining area');
        const recovered = await handleFallRecovery();
        if (!recovered) {
          chat('Cannot recover to mining area! Aborting.');
          break;
        }
      }

      let blockMined = false;
      for (let attempt = 0; attempt < 4 && !blockMined && !getState('stopRequested'); attempt++) {
        logDebug(`Mining attempt ${attempt + 1} for block at (${position.x}, ${position.y}, ${position.z})`);
        blockMined = await mineBlock(position);
        if (!blockMined) {
          logDebug(`Mining attempt ${attempt + 1} failed, handling mobs and retrying`);
          await dealWithMobs();
          await wait(500);
        }
      }

      if (blockMined) {
        completedBlocks++;
        const progressPercent = Math.floor((completedBlocks / miningQueue.length) * 100);
        if (progressPercent % 10 === 0 || Date.now() - lastProgressUpdate > 20000) {
          chat(`Mining progress: ${progressPercent}% (${completedBlocks}/${miningQueue.length} blocks)`);
          lastProgressUpdate = Date.now();
          logDebug(`Progress update: ${progressPercent}% complete`);
        }
      } else {
        logDebug(`Failed to mine block at (${position.x}, ${position.y}, ${position.z}) after retries`);
      }
    }

    // Final item collection after mining
    logDebug('Performing final item collection');
    await collectNearbyItems();

    const timeElapsed = (Date.now() - startTime) / 1000;
    const blocksPerMinute = Math.round((completedBlocks / timeElapsed) * 60);

    if (getState('stopRequested')) {
      chat(`Mining stopped: ${completedBlocks}/${miningQueue.length} blocks completed (${blocksPerMinute} blocks/min)`);
    } else {
      chat(`Mining finished: ${completedBlocks} blocks mined in ${Math.round(timeElapsed / 60)} minutes (${blocksPerMinute} blocks/min)`);
    }
    logDebug('Area mining operation completed');
  } catch (err) {
    console.error('Mining area error:', err);
    chat('Mining operation failed! Check console for details.');
    logDebug('Mining area error: ' + err.message);
  } finally {
    setState('isMining', false);
    setState('stopRequested', false);
    miningQueue = [];
    logDebug('Mining state reset');
  }
}

/**
 * Recovers the bot from falls or being stuck during mining
 * @returns {Promise<boolean>} True if recovery successful, false otherwise
 */
async function handleFallRecovery() {
  logDebug('Initiating fall recovery procedure');

  let recoveryPosition = getState('safePosition');
  if (!recoveryPosition) {
    if (miningTask) {
      recoveryPosition = new Vec3(
        Math.floor((miningTask.start.x + miningTask.end.x) / 2),
        miningTask.end.y + 3,
        Math.floor((miningTask.start.z + miningTask.end.z) / 2)
      );
    } else {
      recoveryPosition = bot.entity.position.clone().offset(0, 2, 0);
    }
    logDebug(`No safe position, using fallback: (${recoveryPosition.x}, ${recoveryPosition.y}, ${recoveryPosition.z})`);
  }

  try {
    chat('I’ve fallen or stuck! Attempting recovery...');
    const success = await goToPosition(recoveryPosition, { maxRetries: 5, range: 3 });
    if (success) {
      chat('Recovery successful! Back on track.');
      logDebug('Fall recovery completed successfully');
      return true;
    } else {
      chat('Failed to recover! Please teleport me manually.');
      logDebug('Fall recovery failed after retries');
      return false;
    }
  } catch (err) {
    logDebug('Fall recovery error: ' + err.message);
    chat('Recovery attempt failed! Need assistance.');
    return false;
  }
}

/**
 * Engages and defeats nearby hostile mobs with pro-level combat skills
 */
async function dealWithMobs() {
  if (getState('isInCombat')) {
    logDebug('Already engaged in combat, skipping');
    return;
  }
  setState('isInCombat', true);

  try {
    const hostileMobs = Object.values(bot.entities).filter(entity =>
      entity.type === 'mob' &&
      ['zombie', 'skeleton', 'spider', 'creeper', 'enderman', 'witch', 'slime', 'cave_spider', 'silverfish'].includes(entity.name) &&
      distanceTo(bot.entity.position, entity.position) < 20
    );

    if (hostileMobs.length === 0) {
      logDebug('No hostile mobs detected within range');
      return;
    }

    const savedPosition = bot.entity.position.clone();
    chat(`Engaging ${hostileMobs.length} hostile mobs with precision!`);
    logDebug(`Combat initiated against ${hostileMobs.length} mobs`);

    const equipped = await equipBestToolOrWeapon('weapon');
    if (!equipped) {
      logDebug('No weapon equipped, proceeding with caution');
    }

    for (const mob of hostileMobs.sort((a, b) =>
      distanceTo(bot.entity.position, a.position) - distanceTo(bot.entity.position, b.position))) {
      if (!mob.isValid || getState('stopRequested')) {
        logDebug('Mob invalid or combat stopped');
        break;
      }

      logDebug(`Targeting ${mob.name} at (${mob.position.x}, ${mob.position.y}, ${mob.position.z})`);
      try {
        const reached = await goToPosition(mob.position, { range: 2, maxRetries: 3 });
        if (!reached) {
          logDebug(`Failed to reach ${mob.name}`);
          continue;
        }

        while (mob.isValid && distanceTo(bot.entity.position, mob.position) < 3 && !getState('stopRequested')) {
          await bot.lookAt(mob.position.offset(0, mob.height * 0.8, 0));
          if (bot.entity.onGround) {
            await bot.attack(mob);
            logDebug(`Attacked ${mob.name}`);
          }
          await wait(200); // Fast attack rate for pro combat
          await clearCombatObstacles(); // Clear any obstructing blocks
        }
        logDebug(`${mob.name} defeated or lost track`);
      } catch (err) {
        logDebug(`Combat error with ${mob.name}: ${err.message}`);
      }
    }

    const returned = await goToPosition(savedPosition, { range: 2, maxRetries: 3 });
    if (returned) {
      chat('All hostiles neutralized! Resuming tasks.');
      logDebug('Returned to original position after combat');
    } else {
      chat('Combat done, but couldn’t return to original spot.');
      logDebug('Failed to return after combat');
    }
  } catch (err) {
    logDebug('Combat handling error: ' + err.message);
    chat('Error during combat! Check console.');
  } finally {
    setState('isInCombat', false);
    logDebug('Combat state reset');
  }
}

/**
 * Clears obstacles that impede combat movement
 */
async function clearCombatObstacles() {
  try {
    const blockAhead = bot.blockAt(bot.entity.position.offset(bot.entity.velocity.x, -1, bot.entity.velocity.z));
    if (blockAhead && blockAhead.diggable && blockAhead.boundingBox !== 'empty') {
      logDebug(`Clearing combat obstacle at (${blockAhead.position.x}, ${blockAhead.position.y}, ${blockAhead.position.z})`);
      await bot.dig(blockAhead);
      await wait(300);
    }
  } catch (err) {
    logDebug('Combat obstacle clearing error: ' + err.message);
  }
}

/**
 * Collects food by hunting animals within a radius
 */
async function collectFood() {
  if (!getState('isCollectingFood')) {
    logDebug('Food collection not active, aborting');
    return;
  }

  try {
    setupPathfinder();
    chat('Starting food hunt with pro-level skill...');
    logDebug('Food collection initiated');

    lastFoodReport = { beef: 0, porkchop: 0, mutton: 0, chicken: 0, rabbit: 0 };
    const animalFoodMap = {
      'cow': 'beef',
      'pig': 'porkchop',
      'sheep': 'mutton',
      'chicken': 'chicken',
      'rabbit': 'rabbit'
    };

    const equipped = await ensureTools('weapon');
    if (!equipped) {
      chat('Need a weapon to hunt food!');
      logDebug('Food collection aborted due to no weapon');
      return;
    }

    let huntingTime = 0;
    const HUNTING_TIMEOUT = 10 * 60 * 1000; // 10-minute timeout
    const startTime = Date.now();
    let lastReportTime = 0;

    while (getState('isCollectingFood') && huntingTime < HUNTING_TIMEOUT) {
      const animals = findEntitiesInRadius(Object.keys(animalFoodMap), SEARCH_RADIUS);
      if (animals.length === 0) {
        logDebug('No animals found, exploring new area');
        const randomOffset = new Vec3(
          Math.random() * 40 - 20,
          0,
          Math.random() * 40 - 20
        );
        const explorePos = bot.entity.position.clone().add(randomOffset);
        explorePos.y = bot.entity.position.y;
        await goToPosition(explorePos, { range: 5, maxRetries: 3 });
        await wait(1000);
      } else {
        logDebug(`Found ${animals.length} animals to hunt`);
        for (const animal of animals.sort((a, b) =>
          distanceTo(bot.entity.position, a.position) - distanceTo(bot.entity.position, b.position))) {
          if (!getState('isCollectingFood')) {
            logDebug('Food collection stopped during loop');
            break;
          }

          const animalType = Object.keys(animalFoodMap).find(type => animal.name.includes(type));
          if (!animalType) {
            logDebug(`Unknown animal type: ${animal.name}`);
            continue;
          }

          logDebug(`Hunting ${animalType} at (${animal.position.x}, ${animal.position.y}, ${animal.position.z})`);
          const reached = await goToPosition(animal.position, { range: 2, maxRetries: 3 });
          if (!reached) {
            logDebug(`Failed to reach ${animalType}`);
            continue;
          }

          await equipBestToolOrWeapon('weapon');
          while (animal.isValid && distanceTo(bot.entity.position, animal.position) < 3 && getState('isCollectingFood')) {
            await bot.lookAt(animal.position.offset(0, animal.height * 0.8, 0));
            if (bot.entity.onGround) {
              await bot.attack(animal);
              logDebug(`Attacked ${animalType}`);
              break; // Only attack once
            }
            await wait(200);
          }

          if (!animal.isValid) {
            logDebug(`${animalType} killed successfully`);
            await wait(400); // Wait for drops
            await collectNearbyItems();
            lastFoodReport[animalFoodMap[animalType]]++;
            if (Date.now() - lastReportTime > 30000) {
              chat(`Food collected: ${generateFoodReport()}`);
              lastReportTime = Date.now();
              logDebug('Food collection progress reported');
            }
          }
        }
      }

      huntingTime = Date.now() - startTime;
      logDebug(`Hunting time elapsed: ${huntingTime / 1000} seconds`);
    }

    chat(`Food collection complete: ${generateFoodReport()}`);
    logDebug('Food collection process finished');
  } catch (err) {
    logDebug('Food collection error: ' + err.message);
    chat('Food collection failed! Check console.');
  } finally {
    setState('isCollectingFood', false);
    logDebug('Food collection state reset');
  }
}

async function mineSpecificOre(oreName) {
  const stateKey = oreName === 'coal' ? 'isMiningCoal' : 'isMiningIron';
  if (!getState(stateKey)) {
    logDebug(`${oreName} mining not active`);
    return;
  }

  try {
    setupPathfinder();
    chat(`Starting ${oreName} ore mining with pro efficiency...`);
    logDebug(`${oreName} mining operation initiated`);

    lastOreReport[oreName] = 0;
    const equipped = await ensureTools('tool');
    if (!equipped) {
      chat(`Need tools to mine ${oreName}!`);
      logDebug(`${oreName} mining aborted due to no tools`);
      return;
    }

    let miningTime = 0;
    const MINING_TIMEOUT = 15 * 60 * 1000; // 15-minute timeout
    const startTime = Date.now();
    let lastReportTime = 0;

    while (getState(stateKey) && miningTime < MINING_TIMEOUT) {
      const oreType = oreName === 'coal' ? 'coal_ore' : 'iron_ore';
      const ores = await findOreVeins(oreType, 50);
      if (ores.length === 0) {
        logDebug(`No ${oreName} ore found within range`);
        chat(`No ${oreName} ore nearby, exploring...`);
        const explorePos = bot.entity.position.clone().offset(
          Math.random() * 64 - 32,
          Math.random() * 32 - 16,
          Math.random() * 64 - 32
        );
        await goToPosition(explorePos, { range: 10, maxRetries: 3 });
        await wait(1500);
      } else {
        logDebug(`Found ${ores.length} ${oreName} ore blocks`);
        for (const ore of ores) {
          if (!getState(stateKey)) {
            logDebug(`${oreName} mining stopped during loop`);
            break;
          }

          logDebug(`Targeting ${oreName} ore at (${ore.position.x}, ${ore.position.y}, ${ore.position.z})`);
          const reached = await goToPosition(ore.position, { range: 3, maxRetries: 4 });
          if (!reached) {
            logDebug(`Failed to reach ${oreName} ore`);
            continue;
          }

          const mined = await mineBlock(ore.position);
          if (mined) {
            lastOreReport[oreName]++;
            logDebug(`Mined ${oreName} ore, total: ${lastOreReport[oreName]}`);
            if (lastOreReport[oreName] % 5 === 0) {
              await collectNearbyItems();
              logDebug('Collected items after mining 5 ores');
            }
            if (lastOreReport[oreName] % 10 === 0 || Date.now() - lastReportTime > 30000) {
              chat(`Mined ${lastOreReport[oreName]} ${oreName} ore so far!`);
              lastReportTime = Date.now();
              logDebug(`${oreName} mining progress reported`);
            }
          }
          await dealWithMobs(); // Handle any mobs interrupting mining
        }
      }

      miningTime = Date.now() - startTime;
      logDebug(`${oreName} mining time elapsed: ${miningTime / 1000} seconds`);
    }

    chat(`${oreName} mining completed: ${lastOreReport[oreName]} ores collected!`);
    logDebug(`${oreName} mining operation finished`);
  } catch (err) {
    logDebug(`${oreName} mining error: ${err.message}`);
    chat(`${oreName} mining failed! Check console for details.`);
  } finally {
    setState(stateKey, false);
    logDebug(`${oreName} mining state reset`);
  }
}

/**
 * Finds ore veins within a specified radius
 * @param {string} oreType - Type of ore to search for (e.g., 'coal_ore', 'iron_ore')
 * @param {number} maxCount - Maximum number of ore blocks to find
 * @returns {Promise<Object[]>} Array of ore block objects
 */
async function findOreVeins(oreType, maxCount = 50) {
  const blocks = [];
  const startPosition = bot.entity.position.clone();

  try {
    logDebug(`Searching for ${oreType} veins within ${SEARCH_RADIUS} blocks`);
    for (let x = -SEARCH_RADIUS; x <= SEARCH_RADIUS; x += 4) {
      for (let y = -SEARCH_RADIUS / 2; y <= SEARCH_RADIUS / 2; y += 4) {
        for (let z = -SEARCH_RADIUS; z <= SEARCH_RADIUS; z += 4) {
          if (blocks.length >= maxCount) break;

          const pos = startPosition.offset(x, y, z);
          const block = bot.blockAt(pos);
          if (block && block.name.includes(oreType)) {
            blocks.push(block);
            logDebug(`Found ${oreType} at (${pos.x}, ${pos.y}, ${pos.z})`);
          }
        }
      }
    }

    blocks.sort((a, b) => distanceTo(bot.entity.position, a.position) - distanceTo(bot.entity.position, b.position));
    logDebug(`Located ${blocks.length} ${oreType} blocks`);
    return blocks;
  } catch (err) {
    logDebug('Ore vein search error: ' + err.message);
    return [];
  }
}

/**
 * Drops all items from the bot’s inventory
 */
async function dropInventory() {
  try {
    chat('Dropping all inventory items with pro efficiency...');
    logDebug('Starting inventory drop operation');

    const items = bot.inventory.items().filter(item =>
      !['pickaxe', 'shovel', 'hoe', 'sword', 'axe'].some(type => item.name.includes(type))
    );
    if (items.length === 0) {
      chat('Inventory is already empty of non-essential items!');
      logDebug('No items to drop');
      return;
    }

    for (const item of items) {
      logDebug(`Dropping item: ${item.name} (${item.count})`);
      await bot.tossStack(item);
      await wait(200);
    }

    chat('Inventory fully dropped (kept tools and weapons)!');
    logDebug('Inventory drop completed');
  } catch (err) {
    logDebug('Inventory drop error: ' + err.message);
    chat('Failed to drop inventory! Check console.');
  }
}

/**
 * Drops excess items to free up inventory space
 */
async function dropExcessItems() {
  try {
    const items = bot.inventory.items().filter(item =>
      !['pickaxe', 'shovel', 'hoe', 'sword', 'axe'].some(type => item.name.includes(type))
    );
    if (items.length <= bot.inventory.maxSlots - 10) {
      logDebug('No excess items to drop');
      return;
    }

    chat('Dropping excess items to manage inventory...');
    logDebug('Starting excess item drop');

    for (const item of items.slice(0, items.length - 10)) {
      logDebug(`Tossing excess item: ${item.name} (${item.count})`);
      await bot.tossStack(item);
      await wait(200);
    }

    chat('Excess items dropped successfully!');
    setState('inventoryFull', false);
    logDebug('Excess item drop completed');
  } catch (err) {
    logDebug('Excess item drop error: ' + err.message);
  }
}

// Event Handlers
/**
 * Handles the bot spawning into the world
 */
bot.on('spawn', () => {
  logDebug('Bot spawned into the world');
  setupPathfinder();
  chat('Spawned and ready to dominate!');
  chat('Commands: "!mine x1 y1 z1 x2 y2 z2", "!collect food", "!stop collect food", "!mine coal", "!stop mine coal", "!mine iron", "!stop mine iron", "!stop mining", "!drop inventory"');
  chat('Extras: "hey mine bot, tp me", "minebot teleport here", "where are you"');
});

/**
 * Handles physics ticks for continuous monitoring and actions
 */
let mobCheckCounter = 0;
const MOB_CHECK_FREQUENCY = 20;
bot.on('physicsTick', () => {
  try {
    // Check for falls during mining
    if (getState('isMining') && bot.entity.position.y < (miningTask?.start.y - 10)) {
      logDebug('Detected fall below mining area');
      handleFallRecovery().catch(err => logDebug('Fall recovery error: ' + err.message));
    }

    // Periodic mob check
    if (++mobCheckCounter >= MOB_CHECK_FREQUENCY) {
      mobCheckCounter = 0;
      if (!getState('isInCombat') && (getState('isMining') || getState('isCollectingFood') || getState('isMiningCoal') || getState('isMiningIron'))) {
        const mobs = Object.values(bot.entities).filter(entity =>
          entity.type === 'mob' &&
          ['zombie', 'skeleton', 'spider', 'creeper', 'enderman', 'witch', 'slime', 'cave_spider', 'silverfish'].includes(entity.name) &&
          distanceTo(bot.entity.position, entity.position) < 25
        );
        if (mobs.length > 0) {
          logDebug(`Detected ${mobs.length} hostile mobs nearby`);
          dealWithMobs().catch(err => logDebug('Mob check combat error: ' + err.message));
        }
      }
    }

    // Monitor health and hunger
    if (bot.entity.health < 15 || bot.entity.food < 10) {
      chat('Warning: Low health or hunger! Please assist.');
      logDebug(`Health: ${bot.entity.health}, Food: ${bot.entity.food}`);
    }

    // Manage inventory space
    const inventory = bot.inventory.items();
    if (inventory.length >= bot.inventory.maxSlots - 5) { // Reduced threshold to keep more space
      setState('inventoryFull', true);
      logDebug('Inventory nearly full, triggering drop');
      dropExcessItems().catch(err => logDebug('Excess drop error: ' + err.message));
    }
  } catch (err) {
    logDebug('Physics tick error: ' + err.message);
  }
});

/**
 * Handles entity spawn events, particularly hostile mobs
 */
bot.on('entitySpawn', (entity) => {
  try {
    if (entity.type === 'mob' &&
        ['zombie', 'skeleton', 'spider', 'creeper', 'enderman', 'witch', 'slime', 'cave_spider', 'silverfish'].includes(entity.name) &&
        distanceTo(bot.entity.position, entity.position) < 25 &&
        !getState('isInCombat')) {
      logDebug(`Hostile ${entity.name} spawned at (${entity.position.x}, ${entity.position.y}, ${entity.position.z})`);
      dealWithMobs().catch(err => logDebug('Entity spawn combat error: ' + err.message));
    }
  } catch (err) {
    logDebug('Entity spawn event error: ' + err.message);
  }
});

/**
 * Handles item drop events to trigger collection
 */
bot.on('itemDrop', (entity) => {
  try {
    if (distanceTo(bot.entity.position, entity.position) < 15 && !getState('isCollectingItems')) {
      logDebug(`Item dropped nearby: ${entity.name} at (${entity.position.x}, ${entity.position.y}, ${entity.position.z})`);
      setTimeout(() => {
        collectNearbyItems().catch(err => logDebug('Item drop collection error: ' + err.message));
      }, 500);
    }
  } catch (err) {
    logDebug('Item drop event error: ' + err.message);
  }
});

/**
 * Handles item break events to re-equip tools or weapons
 */
bot.on('itemBreak', (item) => {
  try {
    logDebug(`Item broke: ${item.name}`);
    if (item.name.includes('pickaxe') || item.name.includes('shovel') || item.name.includes('hoe')) {
      equipBestToolOrWeapon('tool').catch(err => logDebug('Tool re-equip error: ' + err.message));
    } else if (item.name.includes('sword') || item.name.includes('axe')) {
      equipBestToolOrWeapon('weapon').catch(err => logDebug('Weapon re-equip error: ' + err.message));
    }
  } catch (err) {
    logDebug('Item break event error: ' + err.message);
  }
});

/**
 * Handles chat commands from players
 */
bot.on('chat', async (username, message) => {
  if (username === bot.username) return;

  const cmd = message.toLowerCase().trim();
  logDebug(`Chat command received from ${username}: ${cmd}`);

  if (cmd === '!stop mining') {
    setState('stopRequested', true);
    bot.pathfinder.setGoal(null);
    chat('Stopping all operations immediately!');
    logDebug('Global stop command executed');
    Object.keys(botState).forEach(key => key.startsWith('is') && setState(key, false));
    return;
  }

  if (getState('isProcessingCommand')) {
    chat('Currently processing a command! Use "!stop mining" or wait.');
    logDebug('Command processing lock active');
    return;
  }

  setState('isProcessingCommand', true);

  try {
    if (cmd.startsWith('!mine ') && !cmd.includes('coal') && !cmd.includes('iron')) {
      logDebug('Processing area mining command');
      const coords = cmd.split(' ').slice(1).map(Number);
      if (coords.length === 6 && coords.every(n => !isNaN(n))) {
        const [x1, y1, z1, x2, y2, z2] = coords;
        miningTask = {
          start: new Vec3(Math.min(x1, x2), Math.min(y1, y2), Math.min(z1, z2)),
          end: new Vec3(Math.max(x1, x2), Math.max(y1, y2), Math.max(z1, z2))
        };

        const volume = (miningTask.end.x - miningTask.start.x + 1) *
                       (miningTask.end.y - miningTask.start.y + 1) *
                       (miningTask.end.z - miningTask.start.z + 1);
        if (volume > 20000) {
          chat('Mining area too large! Limit to 20,000 blocks.');
          logDebug('Area mining rejected: volume exceeds 20,000');
          return;
        }

        chat(`Starting area mining from (${miningTask.start.x}, ${miningTask.start.y}, ${miningTask.start.z}) to (${miningTask.end.x}, ${miningTask.end.y}, ${miningTask.end.z})`);
        logDebug('Area mining command accepted');
        if (await ensureTools('tool')) {
          await mineArea();
        } else {
          chat('Cannot start mining without tools!');
          logDebug('Area mining aborted: no tools');
        }
      } else {
        chat('Invalid coordinates! Use: !mine x1 y1 z1 x2 y2 z2');
        logDebug('Invalid area mining command format');
      }
    } else if (cmd === '!collect food') {
      if (!getState('isCollectingFood')) {
        setState('isCollectingFood', true);
        chat('Starting food collection now!');
        logDebug('Food collection command triggered');
        collectFood().catch(err => {
          logDebug('Food collection error in promise: ' + err.message);
        }).finally(() => setState('isCollectingFood', false));
      } else {
        chat('Already collecting food!');
        logDebug('Food collection already active');
      }
    } else if (cmd === '!stop collect food') {
      setState('isCollectingFood', false);
      chat('Food collection stopped.');
      logDebug('Food collection stop command executed');
    } else if (cmd === '!mine coal') {
      if (!getState('isMiningCoal')) {
        setState('isMiningCoal', true);
        chat('Starting coal mining operation!');
        logDebug('Coal mining command triggered');
        mineSpecificOre('coal').catch(err => {
          logDebug('Coal mining error in promise: ' + err.message);
        }).finally(() => setState('isMiningCoal', false));
      } else {
        chat('Already mining coal!');
        logDebug('Coal mining already active');
      }
    } else if (cmd === '!stop mine coal') {
      setState('isMiningCoal', false);
      chat('Coal mining stopped.');
      logDebug('Coal mining stop command executed');
    } else if (cmd === '!mine iron') {
      if (!getState('isMiningIron')) {
        setState('isMiningIron', true);
        chat('Starting iron mining operation!');
        logDebug('Iron mining command triggered');
        mineSpecificOre('iron').catch(err => {
          logDebug('Iron mining error in promise: ' + err.message);
        }).finally(() => setState('isMiningIron', false));
      } else {
        chat('Already mining iron!');
        logDebug('Iron mining already active');
      }
    } else if (cmd === '!stop mine iron') {
      setState('isMiningIron', false);
      chat('Iron mining stopped.');
      logDebug('Iron mining stop command executed');
    } else if (cmd === '!drop inventory') {
      logDebug('Drop inventory command received');
      await dropInventory();
    } else if (cmd === 'hey mine bot, tp me') {
      chat('/tpahere Chaitanya1290');
      setTimeout(() => chat('/tpcancel'), 20000);
      logDebug('Teleport request sent to Chaitanya1290');
    } else if (cmd === 'minebot teleport here') {
      chat('/tpa Chaitanya1290');
      setTimeout(() => chat('/tpcancel'), 20000);
      logDebug('Teleport request sent to bot location');
    } else if (cmd === 'where are you') {
      const pos = bot.entity.position;
      chat(`I’m at (${Math.floor(pos.x)}, ${Math.floor(pos.y)}, ${Math.floor(pos.z)})`);
      logDebug(`Reported position: (${pos.x}, ${pos.y}, ${pos.z})`);
    } else {
      chat('Unknown command! Check available commands on spawn.');
      logDebug('Unrecognized command received');
    }
  } catch (err) {
    console.error('Chat command error:', err);
    chat('Command execution failed! Check console.');
    logDebug('Chat command processing error: ' + err.message);
  } finally {
    setState('isProcessingCommand', false);
    logDebug('Command processing lock released');
  }
});

/**
 * Handles successful login to the server
 */
bot.once('login', () => {
  logDebug('Bot successfully logged into the server');
  reconnectAttempts = 0;
});

/**
 * Handles errors occurring within the bot
 */
bot.on('error', (err) => {
  console.error('Bot error:', err);
  logDebug('Bot error occurred: ' + err.message);
  setState('isProcessingCommand', false);
  if (!bot.connected) {
    logDebug('Attempting to reconnect after error');
    setTimeout(() => bot.connect(), 10000); // Increased reconnect delay
  }
});

/**
 * Handles disconnection from the server
 */
bot.on('end', (reason) => {
  logDebug(`Bot disconnected: ${reason}`);
  setState('isProcessingCommand', false);
  if (reconnectAttempts++ < MAX_RECONNECT_ATTEMPTS) {
    logDebug(`Reconnection attempt ${reconnectAttempts} of ${MAX_RECONNECT_ATTEMPTS}`);
    setTimeout(() => {
      logDebug('Reconnecting...');
      bot.connect();
    }, 10000); // Increased reconnect delay
  } else {
    logDebug('Maximum reconnection attempts reached, stopping');
    chat('Failed to reconnect after multiple attempts. Please restart me manually.');
  }
});

/**
 * Handles unhandled promise rejections
 */
process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err);
  logDebug('Unhandled promise rejection: ' + err.message);
});

/**
 * Handles uncaught exceptions to prevent crashes
 */
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  logDebug('Uncaught exception: ' + err.message);
  setState('isProcessingCommand', false);
  if (!bot.connected) {
    logDebug('Reconnecting after uncaught exception');
    setTimeout(() => bot.connect(), 10000); // Increased reconnect delay
  }
});