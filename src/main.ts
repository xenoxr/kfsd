import { World } from './world/World';
import { Renderer } from './render/Renderer';
import { MapLoader } from './world/MapLoader';
import { Vehicle } from './entities/Vehicle';
import { Pedestrian } from './entities/Pedestrian';
import { RLInterface } from './rl/Interface';
import './style.css';
import { Vec2 } from './core/Vec2';

async function main() {
    const world = new World();
    const renderer = new Renderer('app');

    // Load Map
    try {
        const resp = await fetch('/map.json');
        const data = await resp.json();
        MapLoader.load(world, data);
    } catch (e) {
        console.error('Failed to load map:', e);
    }

    // Spawn Ego Car on the outer north loop (inner lane for easier driving?), heading East
    const ego = new Vehicle(140, 195, 20, 10, 'car');
    ego.heading = 0;
    ego.currentLaneId = 'outer_north_in';
    ego.isPlayerControlled = true; // Manual Control Only
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

    // Spawn Pedestrians on Sidewalks
    const spawnPedestriansOnSidewalks = () => {
        // Get all sidewalk points for connected paths around intersections
        const westIntersectionPath = [
            new Vec2(240, 270),  // Left top
            new Vec2(260, 270),
            new Vec2(380, 270),
            new Vec2(400, 270),  // Right top
            new Vec2(400, 350),
            new Vec2(400, 435),  // Right bottom
            new Vec2(380, 435),
            new Vec2(260, 435),
            new Vec2(240, 435),  // Left bottom
            new Vec2(240, 350),
            new Vec2(240, 270)   // Back to start
        ];

        const eastIntersectionPath = [
            new Vec2(600, 270),  // Left top
            new Vec2(680, 270),
            new Vec2(760, 270),  // Right top
            new Vec2(760, 350),
            new Vec2(760, 435),  // Right bottom
            new Vec2(680, 435),
            new Vec2(600, 435),  // Left bottom
            new Vec2(600, 350),
            new Vec2(600, 270)   // Back to start
        ];

        // Middle connection path (between two intersections)
        const middlePath = [
            new Vec2(400, 270),
            new Vec2(500, 270),
            new Vec2(600, 270),
            new Vec2(600, 435),
            new Vec2(500, 435),
            new Vec2(400, 435),
            new Vec2(400, 270)
        ];

        // Outer loop path
        const outerLoopPath = [
            new Vec2(40, 140),
            new Vec2(260, 140),
            new Vec2(380, 140),
            new Vec2(620, 140),
            new Vec2(740, 140),
            new Vec2(960, 140),
            new Vec2(960, 280),
            new Vec2(960, 420),
            new Vec2(960, 560),
            new Vec2(740, 560),
            new Vec2(620, 560),
            new Vec2(380, 560),
            new Vec2(260, 560),
            new Vec2(40, 560),
            new Vec2(40, 420),
            new Vec2(40, 280),
            new Vec2(40, 140)
        ];

        const spawnOnPath = (count: number, path: Vec2[]) => {
            for (let i = 0; i < count; i++) {
                const startIndex = Math.floor(Math.random() * path.length);
                const startPos = path[startIndex];
                const p = new Pedestrian(
                    startPos.x + (Math.random() - 0.5) * 8,
                    startPos.y + (Math.random() - 0.5) * 8
                );

                // Build waypoints starting from random position
                p.waypoints = [];
                for (let j = 0; j < path.length; j++) {
                    p.waypoints.push(path[(startIndex + j) % path.length]);
                }
                // Loop back for continuous walking
                for (let j = 0; j < path.length; j++) {
                    p.waypoints.push(path[(startIndex + j) % path.length]);
                }

                world.pedestrians.push(p);
            }
        };

        // Spawn pedestrians on different paths
        spawnOnPath(6, westIntersectionPath);
        spawnOnPath(6, eastIntersectionPath);
        spawnOnPath(4, middlePath);
        spawnOnPath(6, outerLoopPath);
    };

    spawnPedestriansOnSidewalks();

    // Debug Overlay & Remote Monitor
    const debugPanel = document.getElementById('debug-panel');

    // Setup WebSocket for Remote CLI Monitoring
    let ws: WebSocket | null = null;
    let wsConnected = false;

    function connectWs() {
        // Use hostname from the browser URL to allow remote connections (e.g., SSH/LAN)
        const host = window.location.hostname;
        ws = new WebSocket(`ws://${host}:8081`);
        ws.onopen = () => {
            console.log('Connected to CLI Monitor');
            wsConnected = true;
        };
        ws.onclose = () => {
            wsConnected = false;
            // Retry after 2s
            setTimeout(connectWs, 2000);
        };
        ws.onerror = () => {
            // console.warn('CLI Monitor not found (run npm run monitor)');
        };
    }
    connectWs(); // Start connection attempt

    let lastTime = performance.now();
    let isPaused = false;
    let latestDebugText = '';
    let frameCount = 0;

    // Input Handling
    const keys: { [key: string]: boolean } = {};
    window.addEventListener('keydown', e => {
        keys[e.key] = true;
        if (e.key === ' ') {
            isPaused = !isPaused;
        }
    });
    window.addEventListener('keyup', e => keys[e.key] = false);

    // Existing copyText function...
    async function copyText(text: string): Promise<boolean> {
        // Prefer async clipboard if available and in secure context
        if (navigator.clipboard && window.isSecureContext) {
            try {
                await navigator.clipboard.writeText(text);
                return true;
            } catch (err) {
                console.warn('Async clipboard failed, falling back', err);
            }
        }

        // Fallback: temporary textarea + execCommand
        try {
            const textarea = document.createElement('textarea');
            textarea.value = text;
            textarea.style.position = 'fixed';
            textarea.style.opacity = '0';
            textarea.style.left = '-9999px';
            document.body.appendChild(textarea);
            textarea.focus();
            textarea.select();
            const ok = document.execCommand('copy');
            document.body.removeChild(textarea);
            return ok;
        } catch (err) {
            console.error('Legacy copy failed', err);
            return false;
        }
    }

    const debugCopyBtn = document.getElementById('debug-copy');
    if (debugCopyBtn) {
        debugCopyBtn.addEventListener('click', async () => {
            if (!latestDebugText) return;
            try {
                const ok = await copyText(latestDebugText);
                const prev = debugCopyBtn.innerText;
                debugCopyBtn.innerText = ok ? 'Copied' : 'Copy failed';
                setTimeout(() => debugCopyBtn.innerText = prev, 800);
            } catch (err) {
                console.error('Clipboard copy failed', err);
            }
        });
    }

    function loop(now: number) {
        const dt = (now - lastTime) / 1000;
        lastTime = now;
        frameCount++;

        if (!isPaused) {
            // Manual Control for Ego (Override RL)
            let steer = 0;
            let throttle = 0;
            let brake = 0;

            if (keys['ArrowLeft']) steer = -1;
            if (keys['ArrowRight']) steer = 1;
            if (keys['ArrowUp']) throttle = 1;
            if (keys['ArrowDown']) brake = 1;

            // Apply Actions
            ego.applyControl(steer, throttle, brake, dt);

            // Update World
            world.update(dt);
        }

        // Render
        renderer.render(world, ego);

        // Debug Overlay
        if (debugPanel) {
            let debugText = `Time: ${(now / 1000).toFixed(1)}s\n`;
            debugText += `FPS: ${(1 / dt).toFixed(0)}\n`;
            debugText += `Ego: ${ego.getDebugInfo()}\n\n`;

            world.vehicles.forEach(v => {
                if (v !== ego) {
                    debugText += `${v.getDebugInfo()}\n`;
                }
            });
            debugPanel.innerText = debugText;
            latestDebugText = debugText;
        }

        // Send data to CLI Monitor (every 30 frames = 0.5s)
        if (wsConnected && ws && ws.readyState === WebSocket.OPEN && frameCount % 30 === 0) {
            // Collect events from checking vehicles
            const allEvents: string[] = [];

            const vehiclesPayload = world.vehicles.map(v => {
                // Collect events
                if (v.events.length > 0) {
                    allEvents.push(...v.events);
                    v.events = []; // Clear buffer
                }

                const info = v.getDebugInfo().split('\n');
                const log = info.length > 1 ? info[info.length - 1].trim().replace('> ', '') : '-';
                return {
                    id: v.id,
                    lane: v.currentLaneId,
                    speed: v.speed.toFixed(1),
                    heading: (v.heading * 180 / Math.PI).toFixed(1) + '°',
                    action: log.substring(0, 50) + (allEvents.length > 0 ? ' [!]' : '')
                };
            });

            const payload = {
                type: 'status',
                payload: {
                    time: now / 1000,
                    fps: (1 / dt).toFixed(0),
                    vehicles: vehiclesPayload,
                    events: allEvents
                }
            };
            ws.send(JSON.stringify(payload));
        }

        requestAnimationFrame(loop);
    }

    requestAnimationFrame(loop);
}

main();
