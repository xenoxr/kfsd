import { Entity } from './Entity';
import { Vec2 } from '../core/Vec2';
import { Lane } from '../world/Lane';
import { World } from '../world/World';
import { TrafficLightState } from '../world/Intersection';

export class Vehicle extends Entity {
    public speed: number = 0;
    public maxSpeed: number = 200; // pixels/sec
    public acceleration: number = 100;
    public braking: number = 300;
    public maxSteerAngle: number = Math.PI / 4;
    public wheelBase: number = 20;

    // AI State
    public currentLaneId: string | null = null;
    public targetSpeed: number = 0;
    public distanceToStop: number = -1; // -1 if no stop needed

    public isPlayerControlled: boolean = false;

    constructor(x: number, y: number, width: number, height: number, type: 'car' | 'bike' = 'car') {
        super(x, y, width, height);
        if (type === 'bike') {
            this.maxSpeed = 250;
            this.acceleration = 150;
        }
    }

    update(dt: number) {
        // 1. AI Logic (if not controlled by RL/Player directly, for now assume simple AI built-in)
        // In a real structure, we might separate Controller from Body.
        // Here we mix slightly for speed.

        // Physics Update
        this.updatePhysics(dt);
    }

    applyControl(steerInput: number, throttle: number, brake: number, dt: number) {
        // steerInput: -1 to 1
        // throttle: 0 to 1
        // brake: 0 to 1

        const steerAngle = steerInput * this.maxSteerAngle;

        // Ackermann-ish Kinematics
        // Front wheel position
        const frontWheel = this.pos.add(Vec2.fromAngle(this.heading).mul(this.wheelBase / 2));
        const backWheel = this.pos.add(Vec2.fromAngle(this.heading).mul(-this.wheelBase / 2));

        backWheel.x += this.speed * dt * Math.cos(this.heading);
        backWheel.y += this.speed * dt * Math.sin(this.heading);

        frontWheel.x += this.speed * dt * Math.cos(this.heading + steerAngle);
        frontWheel.y += this.speed * dt * Math.sin(this.heading + steerAngle);

        // New heading and pos
        const newHeading = Math.atan2(frontWheel.y - backWheel.y, frontWheel.x - backWheel.x);

        this.pos = frontWheel.add(backWheel).div(2);
        this.heading = newHeading;
        this.vel = Vec2.fromAngle(this.heading).mul(this.speed);

        // Speed change
        if (throttle > 0) {
            this.speed += this.acceleration * throttle * dt;
        }
        if (brake > 0) {
            this.speed -= this.braking * brake * dt;
        }

        // Friction / Drag
        this.speed *= 0.99;

        this.speed = Math.max(0, Math.min(this.speed, this.maxSpeed));
    }

    // Pure Pursuit-like lane following
    followLane(world: World, dt: number) {
        if (!this.currentLaneId) return;
        let lane = world.getLane(this.currentLaneId);
        if (!lane) {
            // Try to find nearest lane if lost?
            return;
        }

        // 1. Find nearest point on current lane (segment projection, not just vertices)
        const closest = this.getClosestPointOnLane(lane);

        // 2. Lookahead along lane distance (extend into next lane if needed)
        const lookaheadDist = 80 + this.speed * 0.15;
        const targetInfo = this.getPointAhead(world, lane, closest.distanceAlong + lookaheadDist);
        const target = targetInfo.point;

        // Lane Switch Logic: move to next lane just before reaching the end to avoid spinning
        const distToEnd = lane.getLength() - closest.distanceAlong;
        if (distToEnd < 20 && lane.nextLanes.length > 0) {
            const nextId = lane.nextLanes[0];
            if (world.getLane(nextId)) {
                this.currentLaneId = nextId;
            }
        }

        // Calculate steering to target
        const toTarget = target.sub(this.pos);

        // Angle diff
        const desiredAngle = toTarget.angle();
        let angleDiff = desiredAngle - this.heading;

        // Normalize angle -PI to PI
        while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
        while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

        const steer = Math.max(-1, Math.min(1, angleDiff * 2.5));

        // Adjust speed based on turn
        let desiredSpeed = lane.speedLimit || this.maxSpeed;
        if (Math.abs(angleDiff) > 0.5) desiredSpeed *= 0.5;

        // Traffic Light Check
        // Find intersection at end of lane (reuse 'lane' already retrieved above)
        for (const intersection of world.intersections.values()) {
            // Rough check: is this lane incoming to this intersection?
            if (intersection.connectedLanes.includes(this.currentLaneId!)) {
                // Check signal
                const state = intersection.trafficLights.get(this.currentLaneId!);
                if (state !== undefined && state !== TrafficLightState.GREEN) { // RED or YELLOW
                    // Calculate distance to end of current lane (stop line)
                    if (lane) {
                        const closest = this.getClosestPointOnLane(lane);
                        const distToEnd = lane.getLength() - closest.distanceAlong;

                        // Stop distance configuration
                        const stopDistance = 40; // Stop 40 pixels before end of lane
                        const slowDownDistance = 150; // Start slowing down 150 pixels before

                        if (distToEnd < slowDownDistance) {
                            // Gradual slowdown based on distance
                            const slowFactor = Math.max(0, (distToEnd - stopDistance) / (slowDownDistance - stopDistance));
                            desiredSpeed = desiredSpeed * slowFactor;
                        }
                        if (distToEnd < stopDistance) {
                            desiredSpeed = 0;
                        }
                    }
                }
            }
        }

        // Simple P-Controller for speed
        let throttle = 0;
        let brake = 0;
        if (this.speed < desiredSpeed) throttle = 1.0;
        else if (this.speed > desiredSpeed) brake = 1.0;

        this.applyControl(steer, throttle, brake, dt);
    }

    private getClosestPointOnLane(lane: Lane): { point: Vec2, distanceAlong: number } {
        let bestDist2 = Number.POSITIVE_INFINITY;
        let bestPoint = lane.points[0];
        let bestAlong = 0;
        let accumulated = 0;

        for (let i = 0; i < lane.points.length - 1; i++) {
            const a = lane.points[i];
            const b = lane.points[i + 1];
            const ab = b.sub(a);
            const abLen = ab.mag();
            const denom = ab.dot(ab) || 1; // avoid div by zero on zero-length segments
            const t = Math.max(0, Math.min(1, this.pos.sub(a).dot(ab) / denom));
            const proj = a.add(ab.mul(t));
            const dist2 = this.pos.sub(proj).magSq();
            const along = accumulated + abLen * t;
            if (dist2 < bestDist2) {
                bestDist2 = dist2;
                bestPoint = proj;
                bestAlong = along;
            }
            accumulated += abLen;
        }

        return { point: bestPoint, distanceAlong: bestAlong };
    }

    private getPointAhead(world: World, lane: Lane, distanceAhead: number): { point: Vec2, lane: Lane } {
        let remaining = distanceAhead;
        let currentLane: Lane | undefined = lane;

        while (currentLane) {
            const len = currentLane.getLength();
            if (remaining <= len) {
                const info = currentLane.getPointAtDistance(remaining);
                return { point: info.point, lane: currentLane };
            }
            remaining -= len;
            if (currentLane.nextLanes.length === 0) break;
            const next = world.getLane(currentLane.nextLanes[0]);
            if (!next) break;
            currentLane = next;
        }

        // Fallback to end of last lane reached
        const lastPoint = currentLane ? currentLane.points[currentLane.points.length - 1] : lane.points[lane.points.length - 1];
        return { point: lastPoint, lane: currentLane || lane };
    }

    private updatePhysics(dt: number) {
        // Logic handled in applyControl usually, or separate integration
        // If AI is controlling, it calls applyControl.
    }
}
