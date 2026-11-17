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
  startFires: { key: "thecoberto:start_fires", label: "Explosions start fires" },
};

function isOn(setting) {
  return world.getDynamicProperty(setting.key) !== false;
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
    dimension.createExplosion(location, MINI_NUKE_RADIUS, options);
    return;
  }

  dimension.createExplosion(location, NAPALM_BLAST_RADIUS, options);
  burnEntities(dimension, location);
  if (options.causesFire) spreadFire(dimension, location);
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

// Covers the ground around the blast in fire.
function spreadFire(dimension, center) {
  const cx = Math.floor(center.x);
  const cy = Math.floor(center.y);
  const cz = Math.floor(center.z);
  const r = NAPALM_FIRE_RADIUS;

  for (let dx = -r; dx <= r; dx++) {
    for (let dz = -r; dz <= r; dz++) {
      if (dx * dx + dz * dz > r * r || Math.random() > NAPALM_FIRE_CHANCE) continue;
      placeFireOnGround(dimension, cx + dx, cy, cz + dz);
    }
  }
}

// Finds the ground near height y and puts fire on top of it.
function placeFireOnGround(dimension, x, y, z) {
  try {
    for (let fy = y + 3; fy >= y - 4; fy--) {
      const block = dimension.getBlock({ x, y: fy, z });
      if (!block?.isAir) continue;
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
