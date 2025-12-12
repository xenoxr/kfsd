import { Entity } from './Entity';
import { Vec2 } from '../core/Vec2';
import { Lane } from '../world/Lane';
import { World } from '../world/World';
import { TrafficLightState } from '../world/Intersection';
import { LaneLabeler } from '../world/LaneLabeler';

export class Vehicle extends Entity {
    public speed: number = 0;
    public maxSpeed: number = 100; // pixels/sec (reduced from 200)
    public acceleration: number = 60; // reduced from 100
    public braking: number = 300;
    public maxSteerAngle: number = Math.PI / 4;
    public wheelBase: number = 20;

    // AI State
    public currentLaneId: string | null = null;

    // Debug logs
    private decisionLogs: string[] = [];
    private lastLogTime: number = 0;

    public log(msg: string) {
        // Anti-spam: Deduplicate sequential messages of the same type
        const type = msg.split(':')[0]; // e.g., "DRIFT", "Turn"
        if (this.decisionLogs.length > 0) {
            const lastMsg = this.decisionLogs[this.decisionLogs.length - 1];
            if (lastMsg.startsWith(type)) {
                // Replace the last message with the new one (shows latest state)
                // Optionally add a count, but just showing latest value is cleaner for "Drift"
                this.decisionLogs[this.decisionLogs.length - 1] = msg + " (updating)";
                return;
            }
        }

        this.decisionLogs.push(msg);
        if (this.decisionLogs.length > 15) this.decisionLogs.shift();
    }

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

    // Check constraints - moved to World.ts to ensure access to map data

    public constrainToLane(lane: Lane) {
        // Enforce hard boundaries so vehicles never cross center or into sidewalk
        const proj = lane.getProjectedPoint(this.pos);

        // Calculate vehicle's "offset" from the lane centerline
        // Vector from projected point to vehicle position
        const toVehicle = this.pos.sub(proj.point);
        const dist = toVehicle.mag();

        // Lane half-width - Half car width (assuming car width is around 20 for safety margin)
        const safeHalfWidth = (lane.width / 2) - 8;

        if (dist > safeHalfWidth && dist > 0.001) {
            // Need to push back
            // Direction to push is -toVehicle
            const correction = toVehicle.normalize().mul(safeHalfWidth - dist);
            this.pos = this.pos.add(correction);

            // Also kill velocity component perpendicular to lane to prevent "bouncing" against the invisible wall
            // Lane direction at projection
            const laneDir = lane.getHeadingAt(proj.segmentIndex);

            // Project velocity onto lane direction
            const vDotL = this.vel.dot(laneDir);
            this.vel = laneDir.mul(vDotL);
        }
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
        const closest = lane.getProjectedPoint(this.pos);

        // --- Error Logging ---
        // 1. Cross-Track Error (Drift)
        const drift = this.pos.sub(closest.point).mag();
        if (drift > lane.width * 0.4) {
            this.log(`DRIFT: ${drift.toFixed(1)}px (Width:${lane.width})`);
        }

        // 2. Wrong Way Detection
        const laneDir = lane.getHeadingAt(closest.segmentIndex);
        const vehDir = new Vec2(Math.cos(this.heading), Math.sin(this.heading));
        const dot = vehDir.dot(laneDir);
        if (dot < -0.2) {
            this.log(`WRONG WAY! dot:${dot.toFixed(2)}`);
        }
        // ---------------------

        // Lane Switch Logic: move to next lane just before reaching the end to avoid spinning
        const distToEnd = lane.getLength() - closest.distanceAlong;
        if (distToEnd < 20 && lane.nextLanes.length > 0) {
            const nextId = lane.nextLanes[0];
            if (world.getLane(nextId)) {
                const reason = `switch@${distToEnd.toFixed(1)}`
                    + ` heading:${this.heading.toFixed(2)}`
                    + ` pos(${this.pos.x.toFixed(0)},${this.pos.y.toFixed(0)})`
                    + ` speed:${this.speed.toFixed(1)}`;
                const fromLabel = LaneLabeler.format(world, this.currentLaneId);
                const toLabel = LaneLabeler.format(world, nextId);
                this.log(`Switched Lane: ${fromLabel} -> ${toLabel} ${reason}`);
                this.currentLaneId = nextId;
                // No teleport/snap; downstream logic will naturally converge to the lane
            }
        }

        // 2. Lookahead along lane distance (extend into next lane if needed)
        let lookaheadDist = 80 + this.speed * 0.15;
        // If we're about to enter a new lane, don't look too far into it to avoid cutting across
        const rawTarget = this.getPointAhead(world, lane, closest.distanceAlong + lookaheadDist);
        if (rawTarget.lane.id !== lane.id) {
            const cappedLook = Math.max(20, Math.min(lookaheadDist, distToEnd + 15));
            if (cappedLook !== lookaheadDist) {
                const fromLabel = LaneLabeler.format(world, lane.id);
                const toLabel = LaneLabeler.format(world, rawTarget.lane.id);
                this.log(`LookaheadClamp: ${fromLabel} -> ${toLabel} raw:${lookaheadDist.toFixed(1)} cap:${cappedLook.toFixed(1)} dEnd:${distToEnd.toFixed(1)} pos(${this.pos.x.toFixed(0)},${this.pos.y.toFixed(0)}) tgt(${rawTarget.point.x.toFixed(0)},${rawTarget.point.y.toFixed(0)})`);
                lookaheadDist = cappedLook;
            }
        }
        const targetInfo = this.getPointAhead(world, lane, closest.distanceAlong + lookaheadDist);

        // Anchor steering to current lane when not right at the end to avoid cutting diagonally
        let targetLane = lane;
        let targetPoint = lane.getPointAtDistance(Math.min(lane.getLength(), closest.distanceAlong + lookaheadDist)).point;
        if (distToEnd < 30 && targetInfo.lane.id !== lane.id) {
            targetLane = targetInfo.lane;
            targetPoint = targetInfo.point;
            const fromLabel = LaneLabeler.format(world, lane.id);
            const toLabel = LaneLabeler.format(world, targetInfo.lane.id);
            this.log(`LookaheadLane: ${fromLabel} -> ${toLabel} dEnd:${distToEnd.toFixed(1)} look:${lookaheadDist.toFixed(1)} pos(${this.pos.x.toFixed(0)},${this.pos.y.toFixed(0)}) tgt(${targetPoint.x.toFixed(0)},${targetPoint.y.toFixed(0)})`);
        }
        const target = targetPoint;

        // Calculate steering to target
        const toTarget = target.sub(this.pos);

        // Angle diff
        const desiredAngle = toTarget.angle();
        let angleDiff = desiredAngle - this.heading;

        // Normalize angle -PI to PI
        while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
        while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

        // Debug when making a big turn toward another lane
        if (Math.abs(angleDiff) > 0.6 && targetInfo.lane.id !== lane.id) {
            const fromLabel = LaneLabeler.format(world, lane.id);
            const toLabel = LaneLabeler.format(world, targetInfo.lane.id);
            this.log(`TurnCmd: ${fromLabel} -> ${toLabel} ang:${angleDiff.toFixed(2)} heading:${this.heading.toFixed(2)} tgt(${target.x.toFixed(0)},${target.y.toFixed(0)}) pos(${this.pos.x.toFixed(0)},${this.pos.y.toFixed(0)})`);
        }

        const steer = Math.max(-1, Math.min(1, angleDiff * 2.5));

        // Adjust speed based on turn
        let desiredSpeed = lane.speedLimit || this.maxSpeed;

        // More aggressive slowdown on turns
        // if angleDiff is 0.5 rad (~30 deg), slow to 40%
        // if angleDiff is 1.0 rad (~60 deg), slow to 20%
        const turnFactor = Math.max(0.2, 1 - (Math.abs(angleDiff) / (Math.PI / 2)));
        if (Math.abs(angleDiff) > 0.1) {
            desiredSpeed *= turnFactor;
            this.log(`Turn: angle ${angleDiff.toFixed(2)}, slowFactor ${turnFactor.toFixed(2)}`);
        }

        // Traffic Light Check
        // Find intersection at end of lane (reuse 'lane' already retrieved above)
        for (const intersection of world.intersections.values()) {
            // Rough check: is this lane incoming to this intersection?
            if (intersection.connectedLanes.includes(this.currentLaneId!)) {
                // Skip small intersections (e.g., 삼거리/커브) that shouldn't enforce signals
                if (intersection.connectedLanes.length < 6) {
                    this.log(`SignalSkip: ${intersection.id} small(${intersection.connectedLanes.length})`);
                    continue;
                }

                // Determine if this lane actually approaches the intersection center (skip outbound lanes)
                const laneStart = lane.points[0];
                const laneEnd = lane.points[lane.points.length - 1];
                const distStartToIntersection = laneStart.dist(intersection.center);
                const distEndToIntersection = laneEnd.dist(intersection.center);

                // Only apply lights if lane end is closer to the intersection than its start and close enough
                if (distEndToIntersection > distStartToIntersection || distEndToIntersection > 80) {
                    this.log(`SignalSkip: ${intersection.id} outbound/dist ${distEndToIntersection.toFixed(0)} ${LaneLabeler.format(world, this.currentLaneId)}`);
                    continue;
                }

                // Check signal
                const state = intersection.trafficLights.get(this.currentLaneId!);
                if (state !== undefined && state !== TrafficLightState.GREEN) { // RED or YELLOW
                    // Calculate distance to end of current lane (stop line)
                    if (lane) {
                        const closest = lane.getProjectedPoint(this.pos);
                        const distToEnd = lane.getLength() - closest.distanceAlong;
                        this.log(`Signal:${TrafficLightState[state]} d${distToEnd.toFixed(0)} ${LaneLabeler.format(world, this.currentLaneId)}`);

                        // Stop configuration
                        const stopDistance = 40;
                        const slowDownDistance = 150;

                        if (distToEnd < slowDownDistance) {
                            // Gradual slowdown based on distance
                            const slowFactor = Math.max(0, (distToEnd - stopDistance) / (slowDownDistance - stopDistance));
                            desiredSpeed = desiredSpeed * slowFactor;
                        }
                        if (distToEnd < stopDistance) {
                            desiredSpeed = 0;
                            this.log(`Red Light: dist ${distToEnd.toFixed(0)} ${LaneLabeler.format(world, this.currentLaneId)}`);
                        }
                    }
                } else {
                    this.log(`SignalPass: ${intersection.id} ${TrafficLightState[state] || state} ${LaneLabeler.format(world, this.currentLaneId)}`);
                }
            }
        }

        // --- SAFE DISTANCE LOGIC (ACC - Adaptive Cruise Control) ---
        // Scan for vehicles directly ahead in the same lane
        let minDistToVehicle = Infinity;
        let vehicleAhead: Vehicle | null = null;
        const myHalfLength = this.width / 2;

        const myProj = lane.getProjectedPoint(this.pos);

        for (const other of world.vehicles) {
            if (other === this) continue;
            // Simple check: Must be in same lane (or very close to it)
            // Ideally check if 'other' is on the path we are following. 
            // For now, strict lane ID check is a good start. 
            // We also handle the case where the car ahead just switched to next lane but is still "ahead" physically? 
            // Stick to lane ID for now.
            if (other.currentLaneId === this.currentLaneId) {
                const otherProj = lane.getProjectedPoint(other.pos);
                const otherHalfLength = other.width / 2;
                // Check if ahead
                if (otherProj.distanceAlong > myProj.distanceAlong) {
                    const centerDist = otherProj.distanceAlong - myProj.distanceAlong;
                    // Convert center distance to bumper-to-bumper gap
                    const bumperGap = centerDist - (myHalfLength + otherHalfLength);
                    if (bumperGap < minDistToVehicle) {
                        minDistToVehicle = bumperGap;
                        vehicleAhead = other;
                    }
                }
            }
        }

        const SAFE_GAP = 120; // Maintain ~120px gap
        const CRITICAL_GAP = 40; // Panic stop distance (fallback)
        const MIN_BUFFER = 15;   // Extra buffer beyond physics stop distance

        let forceBrake = false;

        if (vehicleAhead) {
            const relativeSpeed = this.speed - vehicleAhead.speed;
            const stoppingDistance = (this.speed * this.speed) / (2 * this.braking) + MIN_BUFFER;
            const gap = minDistToVehicle;

            // If we don't have enough room to stop with current speed, trigger hard brake immediately.
            if (gap < stoppingDistance) {
                desiredSpeed = 0;
                forceBrake = true;
                this.log(`EmergencyStop: gap ${gap.toFixed(0)} < stopDist ${stoppingDistance.toFixed(0)}`);
            }

            // Time-to-collision guard when we're closing in fast.
            if (relativeSpeed > 1 && gap > 0) {
                const ttc = gap / relativeSpeed;
                if (ttc < 1.2) { // seconds to impact
                    desiredSpeed = 0;
                    forceBrake = true;
                    this.log(`TTC Stop: ${ttc.toFixed(2)}s, gap ${gap.toFixed(0)}`);
                }
            }

            // Adjust speed
            if (minDistToVehicle < SAFE_GAP && !forceBrake) {
                const speedFactor = Math.max(0, (minDistToVehicle - CRITICAL_GAP) / (SAFE_GAP - CRITICAL_GAP));
                desiredSpeed = Math.min(desiredSpeed, vehicleAhead.speed * 0.9 + (this.maxSpeed * 0.1)); // Match speed, bias slightly lower
                desiredSpeed *= speedFactor;

                this.log(`SafeDist: Gap ${minDistToVehicle.toFixed(0)} | TargetSpd: ${desiredSpeed.toFixed(0)}`);
            }
        }

        // --- FRONT CORRIDOR CHECK (catch cross-lane targets that are directly ahead) ---
        // If any vehicle sits in a narrow corridor in front of us (same heading direction), treat as obstacle.
        const headingVec = Vec2.fromAngle(this.heading).normalize();
        const MAX_FRONT_CHECK = 160; // pixels
        const CORRIDOR_HALF_WIDTH = this.width * 0.6; // lateral tolerance

        for (const other of world.vehicles) {
            if (other === this) continue;

            const rel = other.pos.sub(this.pos);
            const forwardDist = rel.dot(headingVec);
            if (forwardDist <= 0 || forwardDist > MAX_FRONT_CHECK) continue; // behind or too far

            // Lateral offset from heading line (using 2D cross magnitude)
            const lateral = Math.abs(rel.cross(headingVec));
            if (lateral > CORRIDOR_HALF_WIDTH) continue;

            const otherHalfLength = other.width / 2;
            const bumperGap = forwardDist - (myHalfLength + otherHalfLength);

            const myForwardSpeed = this.vel.dot(headingVec);
            const otherForwardSpeed = other.vel.dot(headingVec);
            const closingSpeed = myForwardSpeed - otherForwardSpeed;

            const stoppingDistance = (Math.max(0, myForwardSpeed) ** 2) / (2 * this.braking) + MIN_BUFFER;
            let corridorBrake = false;

            if (bumperGap < stoppingDistance) {
                corridorBrake = true;
            }

            if (closingSpeed > 1 && bumperGap > 0) {
                const ttc = bumperGap / closingSpeed;
                if (ttc < 1.0) corridorBrake = true;
                if (corridorBrake) {
                    this.log(`FrontObstacle: gap ${bumperGap.toFixed(0)} ttc ${ttc.toFixed(2)}`);
                }
            } else if (corridorBrake) {
                this.log(`FrontObstacle: gap ${bumperGap.toFixed(0)} stopDist ${stoppingDistance.toFixed(0)}`);
            }

            if (corridorBrake) {
                desiredSpeed = 0;
                forceBrake = true;
                // If we're already overlapping, zero speed immediately to stop pushing
                if (bumperGap < 0) {
                    this.speed = 0;
                    this.vel = Vec2.zero();
                }
                break;
            }
        }
        // -----------------------------------------------------------

        // Simple P-Controller for speed
        let throttle = 0;
        let brake = 0;
        if (forceBrake) {
            // Stop movement immediately this frame
            this.speed = Math.min(this.speed, Math.max(0, desiredSpeed));
            this.vel = Vec2.zero();
            throttle = 0;
            brake = 1.0;
        } else {
            if (this.speed < desiredSpeed) throttle = 1.0;
            else if (this.speed > desiredSpeed) brake = 1.0;
        }

        this.applyControl(steer, throttle, brake, dt);

        // If we planned to force stop, ensure speed does not exceed desiredSpeed (protect against dt/brake lag)
        if (forceBrake && this.speed > desiredSpeed) {
            this.speed = desiredSpeed;
            this.vel = Vec2.fromAngle(this.heading).mul(this.speed);
        }
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

    public getDebugInfo(): string {
        const header = `[veh_${this.id}] Lane:${this.currentLaneId || 'N/A'} Spd:${Math.round(this.speed)}/${this.maxSpeed}`;
        if (this.decisionLogs.length === 0) return header;
        return header + '\n  > ' + this.decisionLogs.join('\n  > ');
    }
}
