const mineflayer = require('mineflayer');
const { Vec3 } = require('vec3');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const { GoalBlock, GoalNear, GoalXZ, GoalY, GoalInvert, GoalFollow } = goals;

const botState = {
  isMining: false,
  isCollectingItems: false,
  isInCombat: false,
  isCollectingFood: false,
  isMiningCoal: false,
  isMiningIron: false,
  stopRequested: false,
  currentTask: null,
  safePosition: null,
  inventoryFull: false,
  isProcessingCommand: false
};

function setState(key, value) {
  botState[key] = value;
  logDebug(`State updated: ${key} = ${value}`);
}

function getState(key) {
  return botState[key];
}

const bot = mineflayer.createBot({
  host: 'iitpkunofficial.aternos.me',
  port: 27449,
  username: 'MineBot',
  version: '1.21.1',
  hideErrors: false,
  checkTimeoutInterval: 60000,
  keepAlive: true,
  respawn: true
});

bot.loadPlugin(pathfinder);

let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;
let miningTask = null;
let miningQueue = [];
const REACH_DISTANCE = 5;
let pathfinderInitialized = false;
let lastProgressUpdate = 0;
let lastFoodReport = {
  beef: 0,
  porkchop: 0,
  mutton: 0,
  chicken: 0,
  rabbit: 0
};
let lastOreReport = {
  coal: 0,
  iron: 0
};
const SEARCH_RADIUS = 128;

function distanceTo(pos1, pos2) {
  try {
    const dx = pos1.x - pos2.x;
    const dy = pos1.y - pos2.y;
    const dz = pos1.z - pos2.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  } catch (err) {
    logDebug('Distance calculation error: ' + err.message);
    return Infinity;
  }
}

function isInMiningArea(pos) {
  if (!miningTask) {
    logDebug('No mining task defined for area check');
    return true;
  }
  try {
    const buffer = 5;
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

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function chat(message) {
  try {
    bot.chat(message);
    console.log(`Bot said: ${message}`);
  } catch (err) {
    console.error('Chat error:', err);
    logDebug('Failed to send chat message: ' + err.message);
  }
}

function logDebug(message) {
  const now = new Date().toISOString();
  console.log(`[${now}] DEBUG: ${message}`);
}

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

function getBestTool(blockType) {
  const pickaxeBlocks = [
    'stone', 'cobblestone', 'granite', 'diorite', 'andesite', 'deepslate',
    'ore', 'coal_ore', 'iron_ore', 'gold_ore', 'diamond_ore', 'emerald_ore',
    'redstone_ore', 'lapis_ore', 'copper_ore', 'quartz_ore', 'ancient_debris',
    'obsidian', 'crying_obsidian', 'netherrack', 'basalt', 'blackstone',
    'end_stone', 'brick', 'terracotta', 'concrete'
  ];
  const shovelBlocks = [
    'dirt', 'grass_block', 'podzol', 'mycelium', 'soul_sand', 'soul_soil',
    'sand', 'red_sand', 'gravel', 'clay', 'snow', 'snow_block', 'farmland',
    'mud', 'mud_block'
  ];

  try {
    const inventory = bot.inventory.items();
    if (pickaxeBlocks.some(type => blockType.includes(type))) {
      const pick = getBestPickaxe();
      if (pick) return pick;
    }

    if (shovelBlocks.some(type => blockType.includes(type))) {
      const shovelPriority = [
        'netherite_shovel', 'diamond_shovel', 'iron_shovel',
        'stone_shovel', 'wooden_shovel', 'golden_shovel'
      ];
      for (const type of shovelPriority) {
        const shovel = inventory.find(item => item.name === type);
        if (shovel) {
          logDebug(`Found shovel for ${blockType}: ${shovel.name}`);
          return shovel;
        }
      }
      logDebug(`No shovel found for ${blockType}, falling back to pickaxe`);
      return getBestPickaxe();
    }

    logDebug(`Defaulting to pickaxe for ${blockType}`);
    return getBestPickaxe();
  } catch (err) {
    logDebug('Tool selection error: ' + err.message);
    return null;
  }
}

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

async function equipBestToolOrWeapon(type) {
  const item = type === 'tool' ? getBestTool('stone') : getBestWeapon();
  if (!item) {
    logDebug(`No ${type} available to equip`);
    requestTools(type);
    return false;
  }

  try {
    await bot.equip(item, 'hand');
    logDebug(`Successfully equipped ${type}: ${item.name}`);
    return true;
  } catch (err) {
    logDebug(`Error equipping ${type}: ${err.message}`);
    await wait(500);
    return await equipBestToolOrWeapon(type);
  }
}

function checkTools() {
  try {
    const hasTools = !!getBestPickaxe() || !!getBestTool('dirt');
    logDebug(`Tool check: ${hasTools ? 'Tools available' : 'No tools found'}`);
    return hasTools;
  } catch (err) {
    logDebug('Tool check error: ' + err.message);
    return false;
  }
}

async function ensureTools(type = 'tool') {
  if (checkTools()) {
    logDebug(`${type}s are available`);
    return true;
  }

  chat(`Chaitanya1290, I need ${type}s to continue!`);
  logDebug(`Waiting for ${type}s from player`);

  return new Promise(resolve => {
    const checkInterval = setInterval(() => {
      if (checkTools() || getState('stopRequested')) {
        clearInterval(checkInterval);
        logDebug(`Tool wait resolved: ${checkTools() ? 'Tools received' : 'Stopped'}`);
        resolve(checkTools());
      }
    }, 5000);
  });
}

function requestTools(type) {
  try {
    chat(`Hey Chaitanya1290, please drop some ${type}s for me!`);
    logDebug(`Requested ${type}s from Chaitanya1290`);
  } catch (err) {
    logDebug('Tool request error: ' + err.message);
  }
}

function setupPathfinder() {
  if (pathfinderInitialized) {
    logDebug('Pathfinder already initialized');
    return;
  }

  try {
    const movements = new Movements(bot);
    movements.allowSprinting = true;
    movements.canDig = true;
    movements.allow1by1towers = true;
    movements.allowParkour = true;
    movements.dontCreateFlow = true;
    movements.allowFreeMotion = true;
    movements.maxDropDown = 4;

    movements.scafoldingBlocks = bot.inventory.items().filter(item =>
      ['dirt', 'cobblestone', 'stone', 'sand'].includes(item.name)
    );

    bot.pathfinder.setMovements(movements);
    pathfinderInitialized = true;
    logDebug('Pathfinder initialized with professional settings');
  } catch (err) {
    logDebug('Pathfinder setup error: ' + err.message);
    pathfinderInitialized = false;
    setTimeout(() => setupPathfinder(), 5000);
  }
}

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

    queue.sort((a, b) => distanceTo(bot.entity.position, a) - distanceTo(bot.entity.position, b));
    logDebug(`Mining queue constructed with ${queue.length} blocks`);
    return queue;
  } catch (err) {
    logDebug('Queue building error: ' + err.message);
    return [];
  }
}

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

async function mineBlock(position) {
  const block = bot.blockAt(position);

  if (!block) {
    logDebug(`No block found at (${position.x}, ${position.y}, ${position.z})`);
    return true;
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
      logDebug('No suitable tool found for mining');
      throw new Error('No suitable tool available');
    }

    await equipBestToolOrWeapon('tool');
    await bot.lookAt(position.plus(new Vec3(0.5, 0.5, 0.5)));

    logDebug(`Mining ${block.name} at (${position.x}, ${position.y}, ${position.z}) with ${tool.name}`);
    await bot.dig(block, true);

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
        await wait(300);
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

      if (completedBlocks % 5 === 0) {
        logDebug('Periodic item collection triggered');
        await collectNearbyItems();
      }

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
          await wait(200);
          await clearCombatObstacles();
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

async function collectFood() {
  if (getState('isCollectingFood')) {
    logDebug('Already collecting food, skipping');
    return;
  }
  setState('isCollectingFood', true);

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

function generateFoodReport() {
  try {
    const items = Object.entries(lastFoodReport)
      .filter(([_, count]) => count > 0)
      .map(([food, count]) => `${count} ${food}`)
      .join(', ');
    const report = items || 'No food collected yet';
    logDebug(`Food report)