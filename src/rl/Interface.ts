import { World } from '../world/World';
import { Vehicle } from '../entities/Vehicle';
import { Vec2 } from '../core/Vec2';
import { Collision } from '../sim/Collision';

export interface Observation {
    ego: { x: number, y: number, vx: number, vy: number, heading: number, speed: number };
    laneDist: number; // Dist to center of lane
    trafficLightState: number; // -1 none, 0 red, 1 green, 2 yellow
    nearestVehDist: number;
    nearestPedDist: number;
}

export interface Action {
    steer: number; // -1 to 1
    throttle: number; // 0 to 1
    brake: number; // 0 to 1
}

export class RLInterface {
    static getObservation(world: World, agentId: string): Observation {
        const ego = world.vehicles.find(v => (v as any).id === agentId); // Assuming id property added or we wrap
        // For this prototype, we'll assume the FIRST vehicle is the agent if not found, 
        // or we're passing the object directly in a real engine.
        // Let's assume vehicle matching by some ID we assign.

        // Fallback if no specific ID system is strict yet
        const agent = ego || world.vehicles[0];
        if (!agent) {
            return { ego: { x: 0, y: 0, vx: 0, vy: 0, heading: 0, speed: 0 }, laneDist: 0, trafficLightState: -1, nearestVehDist: 9999, nearestPedDist: 9999 };
        }

        // 1. Ego State
        const egoState = {
            x: agent.pos.x,
            y: agent.pos.y,
            vx: agent.vel.x,
            vy: agent.vel.y,
            heading: agent.heading,
            speed: agent.speed
        };

        // 2. Lane Dist
        let laneDist = 0;
        if (agent.currentLaneId) {
            const lane = world.getLane(agent.currentLaneId);
            if (lane) {
                // Approx dist to center
                // Simplified: just distance to nearest point
                const { point } = lane.getPointAtDistance(0); // This is wrong, need projection.
                // Skipping complex projection for MVP.
                laneDist = 0;
            }
        }

        // 3. Traffic Light
        let tlState = -1;
        // Find nearest intersection ahead
        // ...

        // 4. Nearest Neighbors
        let minVehDist = 9999;
        for (const v of world.vehicles) {
            if (v === agent) continue;
            const d = agent.pos.dist(v.pos);
            if (d < minVehDist) minVehDist = d;
        }

        let minPedDist = 9999;
        for (const p of world.pedestrians) {
            const d = agent.pos.dist(p.pos);
            if (d < minPedDist) minPedDist = d;
        }

        return {
            ego: egoState,
            laneDist,
            trafficLightState: tlState,
            nearestVehDist: minVehDist,
            nearestPedDist: minPedDist
        };
    }

    static applyAction(world: World, agentId: string, action: Action, dt: number) {
        const agent = world.vehicles[0]; // Simplified: Agent is P0
        if (agent) {
            agent.applyControl(action.steer, action.throttle, action.brake, dt);
        }
    }
}
