import { Entity } from './Entity';
import { Vec2 } from '../core/Vec2';
import { PedestrianSignal } from '../world/Crosswalk';
import type { World } from '../world/World';

export enum PedState {
    IDLE,
    WALKING,
    WAITING,
    CROSSING
}

export class Pedestrian extends Entity {
    public walkSpeed: number = 30;
    public state: PedState = PedState.WALKING;
    public waypoints: Vec2[] = [];
    public currentWaypointIndex: number = 0;
    public waitingAtCrosswalk: string | null = null; // ID of crosswalk we're waiting at

    constructor(x: number, y: number) {
        super(x, y, 10, 10);
    }

    update(dt: number, world?: World) {
        if (this.state === PedState.WAITING && world) {
            // Check if signal changed to WALK
            if (this.waitingAtCrosswalk) {
                const cw = world.crosswalks.get(this.waitingAtCrosswalk);
                if (cw && cw.signal === PedestrianSignal.WALK) {
                    this.state = PedState.CROSSING;
                    this.waitingAtCrosswalk = null;
                }
            }
        }

        if (this.state === PedState.WALKING || this.state === PedState.CROSSING) {
            this.followWaypoints(dt, world);
        }
    }

    followWaypoints(dt: number, world?: World) {
        if (this.currentWaypointIndex >= this.waypoints.length) return;

        const target = this.waypoints[this.currentWaypointIndex];
        const toTarget = target.sub(this.pos);
        const dist = toTarget.mag();

        if (dist < 5) {
            this.currentWaypointIndex++;
            // Finished crossing, back to walking
            if (this.state === PedState.CROSSING) {
                this.state = PedState.WALKING;
            }
            return;
        }

        // Check if we're about to enter a crosswalk and need to wait
        if (world && this.state === PedState.WALKING) {
            const nearbyCrosswalk = this.findNearbyCrosswalk(world, target);
            if (nearbyCrosswalk && nearbyCrosswalk.signal === PedestrianSignal.STOP) {
                // Need to wait at this crosswalk
                this.state = PedState.WAITING;
                this.waitingAtCrosswalk = nearbyCrosswalk.id;
                this.vel = new Vec2(0, 0);
                return;
            }
        }

        const dir = toTarget.normalize();
        this.vel = dir.mul(this.walkSpeed);
        this.pos = this.pos.add(this.vel.mul(dt));
        this.heading = dir.angle();
    }

    // Find a crosswalk that is between current position and target
    private findNearbyCrosswalk(world: World, target: Vec2) {
        const checkRadius = 30; // Distance to check for crosswalks

        for (const cw of world.crosswalks.values()) {
            const cwCenter = cw.center;
            const toCrosswalk = cwCenter.sub(this.pos);
            const distToCrosswalk = toCrosswalk.mag();

            // Only check crosswalks that are ahead of us and close
            if (distToCrosswalk < checkRadius && distToCrosswalk > 5) {
                // Check if the crosswalk is roughly in the direction we're heading
                const toTarget = target.sub(this.pos).normalize();
                const toCwNorm = toCrosswalk.normalize();
                const dotProduct = toTarget.dot(toCwNorm);

                // If crosswalk is ahead of us (dot product > 0.5)
                if (dotProduct > 0.5) {
                    return cw;
                }
            }
        }
        return null;
    }
}
