import {
  CommandPermissionLevel,
  CustomCommandSource,
  CustomCommandStatus,
  Player,
  system,
  world,
} from "@minecraft/server";
import { FormCancelationReason, ModalFormData } from "@minecraft/server-ui";

const MINI_NUKE = "thecoberto:mini_nuke";
const NAPALM_BOMB = "thecoberto:napalm_bomb";

// Mini-Nuke: one huge blast.
const MINI_NUKE_RADIUS = 20;

// Napalm Bomb: a small blast that sets everything nearby on fire.
const NAPALM_BLAST_RADIUS = 4;
const NAPALM_FIRE_RADIUS = 8;      // how far the flames reach, in blocks
const NAPALM_FIRE_CHANCE = 0.6;    // share of the ground inside that radius that catches fire
const NAPALM_BURN_SECONDS = 10;    // how long mobs and players inside the radius burn

// World settings, changed in game with /thecoberto:fatman. Both start on, like 1.0.0.
const SETTINGS = {
  breakBlocks: { key: "thecoberto:break_blocks", label: "Explosions break blocks" },
  startFires: { key: "thecoberto:start_fires", label: "Napalm Bombs start fires" },
};

function isOn(setting) {
  return world.getDynamicProperty(setting.key) !== false;
}

// --- Launcher sounds -----------------------------------------------------------
// The launcher is a bow under the hood, so the game plays the bow "twang" when it
// fires. That sound is stopped here and replaced with heavier launcher sounds.

const FAT_MAN = "thecoberto:fat_man";
const FULL_CHARGE_TICKS = 20; // matches max_draw_duration (1 second) in items/fat_man.json
const BOW_SOUND = "random.bow";

// Pending "fully loaded" sounds, by player id, so they can be cancelled on release.
const chargeTimers = new Map();

world.afterEvents.itemStartUse.subscribe(({ itemStack, source }) => {
  if (itemStack?.typeId !== FAT_MAN) return;
  cancelChargeTimer(source);

  // Loading: a heavy mechanical clunk as the Mini-Nuke goes in.
  playAt(source, "crossbow.loading.start", 0.6, 1.0);

  // Fully loaded: a lock-in click so you know it's at full power.
  const timer = system.runTimeout(() => {
    chargeTimers.delete(source.id);
    playAt(source, "crossbow.loading.end", 0.55, 1.0);
    playAt(source, "random.click", 0.5, 0.8);
  }, FULL_CHARGE_TICKS);
  chargeTimers.set(source.id, timer);
});

world.afterEvents.itemStopUse.subscribe(({ itemStack, source }) => {
  if (itemStack?.typeId === FAT_MAN) cancelChargeTimer(source);
});

world.afterEvents.itemReleaseUse.subscribe(({ itemStack, source }) => {
  if (itemStack?.typeId !== FAT_MAN) return;
  cancelChargeTimer(source);

  try {
    // Cut off the bow sound for everyone close enough to have heard it.
    source.runCommand(`stopsound @a[r=48] ${BOW_SOUND}`);
    source.runCommand("camerashake add @s 0.35 0.25 rotational");
  } catch {}

  // Launch: a deep thump, a rocket whoosh, and an echo rolling off.
  playAt(source, "mob.ghast.fireball", 0.55, 2.0);
  playAt(source, "firework.launch", 0.5, 2.0);
  playAt(source, "thecoberto.effect.gun.echo", 0.8, 2.0);
  muzzleBlast(source);
});

function cancelChargeTimer(player) {
  const timer = chargeTimers.get(player.id);
  if (timer === undefined) return;
  system.clearRun(timer);
  chargeTimers.delete(player.id);
}

// Plays a sound at the player so everyone nearby hears it.
function playAt(player, sound, pitch, volume) {
  try {
    player.dimension.playSound(sound, player.location, { pitch, volume });
  } catch {} // Player left or the chunk unloaded.
}

// Smoke and flame puffing out of the front of the launcher.
function muzzleBlast(player) {
  try {
    const head = player.getHeadLocation();
    const dir = player.getViewDirection();
    for (let i = 0; i < 6; i++) {
      const d = 1.2 + i * 0.25;
      const at = {
        x: head.x + dir.x * d + (Math.random() - 0.5) * 0.3,
        y: head.y + dir.y * d - 0.2 + (Math.random() - 0.5) * 0.3,
        z: head.z + dir.z * d + (Math.random() - 0.5) * 0.3,
      };
      player.dimension.spawnParticle("minecraft:basic_smoke_particle", at);
      if (i < 3) player.dimension.spawnParticle("minecraft:basic_flame_particle", at);
    }
  } catch {}
}

// --- Detonation --------------------------------------------------------------

world.afterEvents.projectileHitBlock.subscribe((event) => detonate(event));
world.afterEvents.projectileHitEntity.subscribe((event) => detonate(event));

function detonate({ projectile, dimension, location, source }) {
  let type;
  try {
    type = projectile.typeId;
  } catch {
    return; // The projectile is already gone.
  }
  if (type !== MINI_NUKE && type !== NAPALM_BOMB) return;

  // Remove the projectile right away so a bounce can't set it off twice.
  try {
    projectile.remove();
  } catch {}

  const options = {
    breaksBlocks: isOn(SETTINGS.breakBlocks),
    causesFire: isOn(SETTINGS.startFires),
    source,
  };

  if (type === MINI_NUKE) {
    // No fire: the nuke is all blast. Fire is the Napalm Bomb's job.
    dimension.createExplosion(location, MINI_NUKE_RADIUS, { ...options, causesFire: false });
    mushroomCloud(dimension, location);
    return;
  }

  dimension.createExplosion(location, NAPALM_BLAST_RADIUS, options);
  burnEntities(dimension, location);
  if (options.causesFire) spreadFire(dimension, location);
}

// A column of smoke and blasts that rises over a few seconds and spreads into a cap.
function mushroomCloud(dimension, center) {
  const STEPS = 12;
  for (let i = 0; i < STEPS; i++) {
    system.runTimeout(() => {
      const y = center.y + 2 + i * 2;
      const spread = i < STEPS - 3 ? 1.5 : 4 + (i - (STEPS - 3)) * 3; // stem, then cap
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2 + i;
        const at = { x: center.x + Math.cos(a) * spread, y, z: center.z + Math.sin(a) * spread };
        try {
          dimension.spawnParticle(i % 3 === 0 ? "minecraft:huge_explosion_emitter" : "minecraft:large_explosion", at);
          dimension.spawnParticle("minecraft:knockback_roar_particle", at);
        } catch {} // Unloaded chunk or above build height.
      }
    }, i * 4);
  }
}

// Everything alive near the blast catches fire, even with fires turned off,
// because burning mobs doesn't damage the world.
function burnEntities(dimension, center) {
  const entities = dimension.getEntities({
    location: center,
    maxDistance: NAPALM_FIRE_RADIUS,
    excludeTypes: ["minecraft:item", "minecraft:xp_orb"],
  });
  for (const entity of entities) {
    try {
      entity.setOnFire(NAPALM_BURN_SECONDS, true);
    } catch {}
  }
}

// Covers the ground around the blast in fire. It waits a moment so the blast
// doesn't snuff it out, then keeps re-lighting the same spots for a while,
// because fire on grass, dirt or stone otherwise burns out in a second or two.
const NAPALM_FIRE_DELAY_TICKS = 3;
const NAPALM_RELIGHT_TICKS = 10;

function spreadFire(dimension, center) {
  const cx = Math.floor(center.x);
  const cy = Math.floor(center.y);
  const cz = Math.floor(center.z);
  const r = NAPALM_FIRE_RADIUS;

  const columns = [];
  for (let dx = -r; dx <= r; dx++) {
    for (let dz = -r; dz <= r; dz++) {
      if (dx * dx + dz * dz > r * r || Math.random() > NAPALM_FIRE_CHANCE) continue;
      columns.push({ x: cx + dx, z: cz + dz });
    }
  }

  const relights = Math.ceil((NAPALM_BURN_SECONDS * 20) / NAPALM_RELIGHT_TICKS);
  for (let i = 0; i <= relights; i++) {
    system.runTimeout(() => {
      for (const { x, z } of columns) placeFireOnGround(dimension, x, cy, z);
    }, NAPALM_FIRE_DELAY_TICKS + i * NAPALM_RELIGHT_TICKS);
  }
}

// Finds the ground near height y and puts fire on top of it. The blast may
// have dug a crater, so it looks a little further down.
function placeFireOnGround(dimension, x, y, z) {
  try {
    for (let fy = y + 3; fy >= y - 6; fy--) {
      const block = dimension.getBlock({ x, y: fy, z });
      if (!block) continue;
      if (block.typeId === "minecraft:fire") return; // still burning
      if (!block.isAir) continue;
      const below = block.below();
      if (below && !below.isAir && !below.isLiquid) {
        block.setType("minecraft:fire");
        return;
      }
    }
  } catch {
    // Unloaded chunk or outside the world.
  }
}

// --- Settings ------------------------------------------------------------------

system.beforeEvents.startup.subscribe(({ customCommandRegistry }) => {
  customCommandRegistry.registerCommand(
    {
      name: "thecoberto:fatman",
      description: "Choose whether Fat Man explosions break blocks and start fires",
      permissionLevel: CommandPermissionLevel.GameDirectors, // operators only
      cheatsRequired: false,
    },
    (origin) => {
      const player = origin.sourceEntity;
      if (origin.sourceType !== CustomCommandSource.Entity || !(player instanceof Player)) {
        return {
          status: CustomCommandStatus.Failure,
          message: "Run /thecoberto:fatman from in-game chat to open the settings.",
        };
      }
      // Forms can't be opened from inside a command, so open it next tick.
      system.run(() => showSettings(player));
      return { status: CustomCommandStatus.Success };
    }
  );
});

async function showSettings(player) {
  const form = new ModalFormData()
    .title("Fat Man Settings")
    .toggle(SETTINGS.breakBlocks.label, { defaultValue: isOn(SETTINGS.breakBlocks) })
    .toggle(SETTINGS.startFires.label, { defaultValue: isOn(SETTINGS.startFires) })
    .submitButton("Save");

  // The chat screen is still open right after a command, which blocks forms.
  // Keep trying for a few seconds until it closes.
  let response;
  for (let attempt = 0; attempt < 20; attempt++) {
    response = await form.show(player);
    if (response.cancelationReason !== FormCancelationReason.UserBusy) break;
    await system.waitTicks(5);
  }
  if (!response || response.canceled) return;

  const [breakBlocks, startFires] = response.formValues;
  world.setDynamicProperty(SETTINGS.breakBlocks.key, breakBlocks === true);
  world.setDynamicProperty(SETTINGS.startFires.key, startFires === true);

  const onOff = (value) => (value ? "§aon§r" : "§coff§r");
  world.sendMessage(
    `§6Fat Man:§r ${player.name} changed the settings. Breaking blocks ${onOff(breakBlocks)}, fires ${onOff(startFires)}.`
  );
}
