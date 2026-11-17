# fat-man

**Rocket Launcher** is a Minecraft Bedrock add-on with the **Fat Man** launcher and two kinds of ammo.

Requires Minecraft Bedrock **1.21.100** or newer. No experiments needed.

## Ammo

| Ammo | What it does |
| --- | --- |
| **Mini-Nuke** | One huge explosion (radius 20) with a mushroom cloud. Never starts fires. |
| **Napalm Bomb** | A small blast (radius 4), then sets every mob and player within 8 blocks on fire and covers the ground in flames. |

To choose which ammo to fire, hold it in your offhand. Otherwise the launcher uses whichever ammo it finds in your inventory.

## Settings

Operators can run `/thecoberto:fatman` in chat to open the settings:

- **Explosions break blocks:** turn off to keep explosions from damaging the world.
- **Napalm Bombs start fires:** turn off to stop Napalm Bombs from setting blocks on fire. Napalm still sets mobs and players on fire. (Mini-Nukes never start fires.)

Both are on by default. The settings are saved in the world, apply to everyone, and are announced in chat when changed.

## Building

Use `package.ps1` from [bedrock-tools](https://github.com/TheCoberto/bedrock-tools), cloned next to this repo:

```powershell
powershell -ExecutionPolicy Bypass -File ..\bedrock-tools\package.ps1
```
