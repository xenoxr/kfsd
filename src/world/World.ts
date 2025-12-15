import { Lane } from './Lane';
import { Road } from './Road';
import { Intersection } from './Intersection';
import { Crosswalk } from './Crosswalk';
import { Sidewalk } from './Sidewalk';
import { Vehicle } from '../entities/Vehicle';
import { Pedestrian } from '../entities/Pedestrian';
import { Collision } from '../sim/Collision';
import { Vec2 } from '../core/Vec2';
import type { Marking } from './Marking';

export class World {
    public lanes: Map<string, Lane> = new Map();
    public roads: Map<string, Road> = new Map();
    public intersections: Map<string, Intersection> = new Map();
    public crosswalks: Map<string, Crosswalk> = new Map();
    public sidewalks: Map<string, Sidewalk> = new Map();
    public markings: Marking[] = [];

    public vehicles: Vehicle[] = [];
    public pedestrians: Pedestrian[] = [];

    constructor() { }

    update(dt: number) {
        // 1. Update Traffic Lights
        for (const intersection of this.intersections.values()) {
            intersection.update(dt);
        }

        // 2. Update Pedestrians
        for (const ped of this.pedestrians) {
            ped.update(dt, this);

            // Simple collision with vehicles (ped dies?)
            const hit = Collision.checkList(ped, this.vehicles);
            if (hit) {
                ped.dead = true;
                // console.log('Pedestrian hit!');
            }
        }

        // 3. Update Vehicles
        for (const veh of this.vehicles) {
            if (!veh.isPlayerControlled) {
                veh.followLane(this, dt); // AI driving
            }

            // NOTE: Do NOT implement "Invisible Walls" or physics constraints (constrainToLane).
            // The AI/RL must learn to stay in lane by itself. 
            // Drifting is allowed; detection logic must handle it.

            veh.update(dt); // Physics

            // Car-Car collision
            const hit = Collision.checkList(veh, this.vehicles);
            if (hit) {
                // Soft resolve: bleed some speed, then push vehicles apart to avoid infinite overlap
                veh.speed = Math.min(veh.speed, hit.speed) * 0.5;
                veh.vel = Vec2.fromAngle(veh.heading).mul(veh.speed);

                // Minimal positional separation along the smallest overlap axis
                const dx = veh.pos.x - hit.pos.x;
                const dy = veh.pos.y - hit.pos.y;
                const overlapX = (veh.width + hit.width) / 2 - Math.abs(dx);
                const overlapY = (veh.height + hit.height) / 2 - Math.abs(dy);
                if (overlapX > 0 && overlapY > 0) {
                    if (overlapX < overlapY) {
                        const push = (overlapX / 2) + 1;
                        const dir = dx >= 0 ? 1 : -1;
                        veh.pos.x += dir * push;
                        hit.pos.x -= dir * push;
                    } else {
                        const push = (overlapY / 2) + 1;
                        const dir = dy >= 0 ? 1 : -1;
                        veh.pos.y += dir * push;
                        hit.pos.y -= dir * push;
                    }
                }

                if (veh.addEvent) veh.addEvent(`Collision: with ${hit.id}, speed damped+separated`);
            }
        }

        // 4. Cleanup
        this.vehicles = this.vehicles.filter(v => !v.dead);
        this.pedestrians = this.pedestrians.filter(p => !p.dead);
    }

    addLane(lane: Lane) {
        this.lanes.set(lane.id, lane);
    }

    getLane(id: string): Lane | undefined {
        return this.lanes.get(id);
    }
}
