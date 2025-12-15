
import { World } from './world/World';
import { MapLoader } from './world/MapLoader';
import { Vehicle } from './entities/Vehicle';
import { Pedestrian } from './entities/Pedestrian';
import { Vec2 } from './core/Vec2';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

// ESM dirname workaround
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runHeadless() {
    console.log("Initializing Headless World...");
    const world = new World();

    // 1. Load Map
    // Assuming running from project root, map is in public/map.json
    // Adjust path if needed.
    const mapPath = path.resolve(process.cwd(), 'public', 'map.json');
    console.log(`Loading map from ${mapPath}...`);

    if (!fs.existsSync(mapPath)) {
        console.error("Map file not found!");
        process.exit(1);
    }

    const mapDataRaw = fs.readFileSync(mapPath, 'utf-8');
    const mapData = JSON.parse(mapDataRaw);
    MapLoader.load(world, mapData);
    console.log(`Map loaded. Lanes: ${world.lanes.size}, Intersections: ${world.intersections.size}`);

    // 2. Spawn Vehicles (Copied from main.ts)
    // Spawn Ego Car on the outer north loop (inner lane for easier driving?), heading East
    const ego = new Vehicle(140, 195, 20, 10, 'car');
    ego.heading = 0;
    ego.currentLaneId = 'outer_north_in';
    ego.isPlayerControlled = false; // Disable player control for AI debugging
    ego.id = 999; // Explicit ID for ego
    world.vehicles.push(ego);

    // Spawn NPC on the eastbound inner (left-hand traffic: south side of road)
    const npc1 = new Vehicle(150, 365, 20, 10, 'car');
    npc1.heading = 0;
    npc1.currentLaneId = 'main_e1_in';
    world.vehicles.push(npc1);

    // Spawn NPC on eastbound outer (left-hand traffic: further south)
    const npc4 = new Vehicle(180, 395, 20, 10, 'car');
    npc4.heading = 0;
    npc4.currentLaneId = 'main_e1_out';
    world.vehicles.push(npc4);

    // Spawn NPC on the outer south loop, heading West
    const npc2 = new Vehicle(820, 505, 20, 10, 'car');
    npc2.heading = Math.PI;
    npc2.currentLaneId = 'outer_south_in';
    world.vehicles.push(npc2);

    // Spawn NPC on westbound outer (left-hand traffic: north side of road)
    const npc5 = new Vehicle(400, 305, 20, 10, 'car');
    npc5.heading = Math.PI;
    npc5.currentLaneId = 'main_w1_out';
    world.vehicles.push(npc5);

    // Spawn NPC on right vertical connector heading North
    const npc3 = new Vehicle(695, 450, 20, 10, 'car');
    npc3.heading = -Math.PI / 2; // North
    npc3.currentLaneId = 'northbound_right_bottom_in';
    world.vehicles.push(npc3);

    console.log(`Spawned ${world.vehicles.length} vehicles.`);

    // 3. Simulation Loop
    const dt = 1 / 60; // 60 FPS step
    let frame = 0;
    let time = 0;
    const MAX_FRAMES = 3600 * 60; // Run for up to 1 hour sim time

    console.log("Starting Stress Test (Normal Speed for precision)...");

    while (frame < MAX_FRAMES) {
        // Update
        world.update(dt);

        frame++;
        time += dt;

        // Check for collisions (speed becomes 0 if 'dead' or hit logic triggered in World.ts)
        // World.ts: if (hit) { veh.speed = 0; }
        // We can check if multiple cars are stopped at the same position or close by?
        // Or better: Let's check overlap directly since World doesn't expose 'hit' flag publicy on vehicle easily (it sets speed=0).
        // Actually, let's detect if speed drops to 0 AND distance to another car is < width/2.

        // Snapshot at specific problematic time
        if (Math.abs(time - 35.0) < dt) {
            console.log(`\n=== SNAPSHOT at 35s ===`);
            logStatus(world, time, frame);
        }

        // Logic to detect "Mass Stop" (Deadlock?)
        const stoppedCars = world.vehicles.filter(v => v.speed < 0.1);
        if (stoppedCars.length === world.vehicles.length && frame > 600) {
            console.error(`\n!!! ALL CARS STOPPED at ${time.toFixed(2)}s !!!`);
            logStatus(world, time, frame);
            // Check for collisions
            // Simple overlap check
            for (let i = 0; i < world.vehicles.length; i++) {
                for (let j = i + 1; j < world.vehicles.length; j++) {
                    const v1 = world.vehicles[i];
                    const v2 = world.vehicles[j];
                    if (v1.pos.dist(v2.pos) < (v1.width + v2.width) / 2 * 0.8) {
                        console.error(`Collision detected: ${v1.id} <-> ${v2.id} at ${v1.pos.x.toFixed(0)},${v1.pos.y.toFixed(0)}`);
                    }
                }
            }
            process.exit(1);
        }

        // Check for violations
        for (const v of world.vehicles) {
            const logs = v.getDebugInfo();
            if (logs.includes("WRONG WAY")) {
                console.error(`\n!!! VIOLATION DETECTED at ${time.toFixed(2)}s (Frame ${frame}) !!!`);
                console.error(v.getDebugInfo());
                console.log(`Pos: ${v.pos.x.toFixed(1)}, ${v.pos.y.toFixed(1)}`);
                console.log(`Lane: ${v.currentLaneId}`);
                console.log(`Heading: ${v.heading.toFixed(2)} rad`);
                process.exit(1);
            }
        }

        // Log every second
        if (frame % 60 === 0) {
            // process.stdout.write(`\rSim Time: ${time.toFixed(1)}s (Stopped: ${stoppedCars.length}/${world.vehicles.length})...`);
        }
    }
    console.log("No violations found after 1 hour of sim time.");
}

/*
    setInterval(() => {
        // Update
        world.update(dt);

        frame++;
        time += dt;

        // Log every 60 frames (approx 1 sec)
        if (frame % 60 === 0) {
            logStatus(world, time, frame);
        }

    }, 1000 * dt); // Real-time speed (remove/lower delay for hyper-lapse)
*/

function logStatus(world: World, time: number, frame: number) {
    // Clear terminal (optional, might flicker)
    // console.clear(); 
    console.log(`\n=== Sim Time: ${time.toFixed(1)}s (Frame ${frame}) ===`);

    // Create a compact table for vehicles
    const tableData = world.vehicles.map(v => {
        // Helper to extract decision from logs
        // Assuming logs format "Type: Value..."
        const debugInfo = v.getDebugInfo().split('\n');
        const latestLog = debugInfo.length > 1 ? debugInfo[debugInfo.length - 1].trim().replace('> ', '') : '-';

        return {
            ID: v.id,
            Lane: v.currentLaneId,
            Speed: v.speed.toFixed(1),
            Heading: (v.heading * 180 / Math.PI).toFixed(1) + '°',
            Action: latestLog.substring(0, 50) // Truncate for table
        };
    });

    console.table(tableData);

    // Traffic Light Status (optional)
    // Only show active/interesting ones?
    // const activeLights = Array.from(world.intersections.values())
    //    .map(i => ({ id: i.id, state: i.currentPhaseIndex }));
    // console.log("Intersections:", activeLights.length);
}

runHeadless().catch(console.error);
