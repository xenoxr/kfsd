import { Lane } from './Lane';
import { Road } from './Road';
import { Intersection } from './Intersection';
import { Crosswalk } from './Crosswalk';
import { Sidewalk } from './Sidewalk';
import { Vehicle } from '../entities/Vehicle';
import { Pedestrian } from '../entities/Pedestrian';
import { Collision } from '../sim/Collision';
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
            veh.update(dt); // Physics

            // Car-Car collision
            const hit = Collision.checkList(veh, this.vehicles);
            if (hit) {
                // Simple resolution: stop?
                veh.speed = 0;
                // console.log('Car crash!');
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
