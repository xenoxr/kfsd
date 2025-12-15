import { Entity } from './Entity';
import { Vec2 } from '../core/Vec2';
import { Lane } from '../world/Lane';
import { World } from '../world/World';
import { TrafficLightState } from '../world/Intersection';
import { LaneLabeler } from '../world/LaneLabeler';

export class Vehicle extends Entity {
    public speed: number = 0;
    public maxSpeed: number = 50; // pixels/sec (50 to ensure rock solid stability for hours)
    public acceleration: number = 40; // reduced for smoother turns
    public braking: number = 300;
    public maxSteerAngle: number = Math.PI / 4;
    public wheelBase: number = 20;

    // AI State
    public currentLaneId: string | null = null;

    // Overtaking Logic State
    public stuckTimer: number = 0;
    public isOvertaking: boolean = false;
    public isReversing: boolean = false;
    public reverseTimer: number = 0;
    public overtakeTargetId: number | string | null = null;
    public lateralOffset: number = 0;

    // Debug logs
    private decisionLogs: string[] = [];
    private lastLogTime: number = 0;

    public events: string[] = [];
    public addEvent(msg: string) {
        this.events.push(`[${this.id}] ${msg}`);
        // Keep buffer small (flushed every frame ideally, but safe cap)
        if (this.events.length > 10) this.events.shift();
    }

    public log(msg: string) {
        // Forward critical logs to events
        if (msg.includes('OVERTAKE') || msg.includes('Collision') || msg.includes('DRIFT')) {
            this.addEvent(msg);
        }

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
        if (throttle !== 0) {
            this.speed += this.acceleration * throttle * dt;
        }
        if (brake > 0) {
            // Braking always opposes movement direction
            if (this.speed > 0) this.speed -= this.braking * brake * dt;
            else if (this.speed < 0) this.speed += this.braking * brake * dt;

            // Snap to 0 if close
            if (Math.abs(this.speed) < 1) this.speed = 0;
        }

        // Friction / Drag (Simple damping)
        this.speed *= 0.99;

        // Clamp speed (Allow reverse up to -20)
        this.speed = Math.max(-20, Math.min(this.speed, this.maxSpeed));
    }

    // ... (Lines 120-??? are constrainToLane, skipping) ...
    // Note: Since I cannot see where constraintToLane ends and followLane P-Controller begins in this view,
    // I will target the P-Controller block separately in a second edit or using a wider context if possible.
    // Wait, the Instruction asked to Update P-Controller too.
    // P-Controller is further down (around line 585). 
    // I can't do both in one 'replace_file_content' if they are far apart.
    // I will do Physics first.

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

        // SMOOTH LATERAL OFFSET (LERP)
        // Handled in specific state blocks (Overtake vs Normal)
        // Default to relaxing back to 0 if not overtaking
        if (!this.isOvertaking) {
            this.lateralOffset += (0 - this.lateralOffset) * 0.1;
        }

        // Lookahead Logic
        // Lookahead Logic
        // Normal: dependent on speed (min 30, max 100). coeff 1.2 (Tightened from 1.5 for better cornering)
        // Overtaking: Reverted to 40px
        let lookaheadDist = Math.max(30, Math.min(100, this.speed * 1.2));
        if (this.isOvertaking) {
            lookaheadDist = 40;
        }

        // Final target calculation
        // Use the (potentially clamped) lookaheadDist
        const finalTargetInfo = this.getPointAhead(world, lane, closest.distanceAlong + lookaheadDist);
        const targetPoint = finalTargetInfo.point;

        const target = targetPoint;

        // Apply Lateral Offset (e.g. for Overtaking)
        let steeringTarget = target;
        if (this.lateralOffset !== 0) {
            const leftNormal = Vec2.fromAngle(this.heading - Math.PI / 2);
            steeringTarget = target.add(leftNormal.mul(this.lateralOffset));
        }

        // Calculate steering to target
        const toTarget = steeringTarget.sub(this.pos);

        // Angle diff
        const desiredAngle = toTarget.angle();
        let angleDiff = desiredAngle - this.heading;

        // Normalize angle -PI to PI
        while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
        while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

        // Debug when making a big turn toward another lane
        if (Math.abs(angleDiff) > 0.6 && finalTargetInfo.lane.id !== lane.id) {
            // ... (logging)
        }

        // Steer Logic
        let steer = 0;
        if (this.isReversing) {
            // FORCE STRAIGHT while backing up to avoid J-turns/Spinning
            steer = 0;
            angleDiff = 0; // For debug display
            this.lateralOffset = 0; // Reset offset logic immediately
        } else {
            steer = Math.max(-1, Math.min(1, angleDiff * 2.5));
        }

        // Adjust speed based on turn
        let desiredSpeed = lane.speedLimit || this.maxSpeed;

        // More aggressive slowdown on turns (Squared curve)
        // Previous: Linear. New: Squared for sharper slowdown on sharp turns.
        const turnRatio = Math.abs(angleDiff) / (Math.PI / 2);
        const turnFactor = Math.max(0.2, (1 - turnRatio) * (1 - turnRatio));

        if (Math.abs(angleDiff) > 0.1 && !this.isOvertaking) { // Don't slow down if Overtaking!
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
                    const stateLabel = state === undefined ? 'N/A' : TrafficLightState[state];
                    this.log(`SignalPass: ${intersection.id} ${stateLabel} ${LaneLabeler.format(world, this.currentLaneId)}`);
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

        const SAFE_GAP = 240; // Maintain ~240px gap (Doubled)
        const CRITICAL_GAP = 80; // Panic stop distance (Doubled)
        const MIN_BUFFER = 30;   // Extra buffer beyond physics stop distance (Doubled)

        let forceBrake = false;

        if (vehicleAhead) {
            // EXEMPTION: If we are overtaking THIS vehicle, or Reversing, IGNORE Emergency Stop
            const isTarget = this.isOvertaking && this.overtakeTargetId === vehicleAhead.id;

            if (!this.isReversing && !isTarget) {
                const relativeSpeed = this.speed - vehicleAhead.speed;
                const stoppingDistance = (this.speed * this.speed) / (2 * this.braking) + MIN_BUFFER;
                const gap = minDistToVehicle;

                // 1. Emergency Stop (Not enough room to stop)
                if (gap < stoppingDistance) {
                    desiredSpeed = 0;
                    forceBrake = true;
                    this.log(`EmergencyStop: gap ${gap.toFixed(0)} < stopDist ${stoppingDistance.toFixed(0)}`);
                }

                // 2. TTC Guard (Closing fast)
                if (relativeSpeed > 1 && gap > 0) {
                    const ttc = gap / relativeSpeed;
                    if (ttc < 1.2) {
                        desiredSpeed = 0;
                        forceBrake = true;
                        this.log(`TTC Stop: ${ttc.toFixed(2)}s, gap ${gap.toFixed(0)}`);
                    }
                }

                // 3. Safe Distance Maintenance (Adjust speed)
                if (minDistToVehicle < SAFE_GAP && !forceBrake) {
                    const speedFactor = Math.max(0, (minDistToVehicle - CRITICAL_GAP) / (SAFE_GAP - CRITICAL_GAP));
                    desiredSpeed = Math.min(desiredSpeed, vehicleAhead.speed * 0.9 + (this.maxSpeed * 0.1));
                    desiredSpeed *= speedFactor;
                    this.log(`SafeDist: Gap ${minDistToVehicle.toFixed(0)} | TargetSpd: ${desiredSpeed.toFixed(0)}`);
                }
            } else {
                if (isTarget) this.log(`EmergencyStop Ignored (Overtaking Target ${vehicleAhead.id})`);
            }
        }

        // --- FRONT CORRIDOR CHECK (catch cross-lane targets that are directly ahead) ---
        // If any vehicle sits in a narrow corridor in front of us (same heading direction), treat as obstacle.
        const headingVec = Vec2.fromAngle(this.heading).normalize();
        const MAX_FRONT_CHECK = 160; // pixels
        const CORRIDOR_HALF_WIDTH = this.width * 0.45; // Narrower tolerance (was 0.6) to allow grazing

        // --- PRE-CALCULATE BLOCKING VEHICLE ---
        let blockingVehicle: Vehicle | null = null;

        for (const other of world.vehicles) {
            if (other === this) continue;

            const rel = other.pos.sub(this.pos);
            const forwardDist = rel.dot(headingVec);
            if (forwardDist <= 0 || forwardDist > MAX_FRONT_CHECK) continue;

            const lateral = Math.abs(rel.cross(headingVec));

            const otherHeadingVec = Vec2.fromAngle(other.heading);
            const isOncoming = headingVec.dot(otherHeadingVec) < -0.5;
            const tolerance = isOncoming ? (this.width * 0.3) : CORRIDOR_HALF_WIDTH;

            if (lateral > tolerance) continue;

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
                blockingVehicle = other; // Capture blocking vehicle causing emergency brake
                desiredSpeed = 0;
                forceBrake = true;
                // If we're already overlapping, zero speed immediately to stop pushing
                // BUT allow Reversing 
                // AND allow Overtaking (if overlapping with the target we are passing)
                const isPassingTarget = this.isOvertaking && this.overtakeTargetId === other.id;
                if (bumperGap < 0 && !this.isReversing && !isPassingTarget) {
                    this.speed = 0;
                    this.vel = Vec2.zero();
                }
                break;
            }
        }

        // --- OVERTAKE LOGIC ---
        // Unified Blocker: Check both EmergencyBrake blocker AND ACC blocker
        // If we are stopped by ACC, we are also "stuck"
        const effectiveBlocker = blockingVehicle || vehicleAhead;

        // 1. Stuck Detection
        // Increment timer if we are effectively stopped (< 10 speed)
        // If Overtaking: Count stuck if WE are stopped
        // If Normal: Count stuck if WE are stopped AND (Blocker stopped OR Emergency Brake Active)
        const selfStuck = this.speed < 10;
        const blockerStuck = effectiveBlocker && effectiveBlocker.speed < 10;

        // FIX: Added 'forceBrake' check. If we are emergency braking, we are stuck.
        if ((this.isOvertaking && selfStuck) || (selfStuck && (forceBrake || (effectiveBlocker && blockerStuck)))) {
            this.stuckTimer += dt;
        } else {
            this.stuckTimer = 0;
        }

        // 1.5 Reverse Logic (Unstick)
        // Trigger if stuck for > 4.0s (General)
        // OR Trigger IMMEDIATELY (>0.5s) if physically touching (Gap <= 0)
        const isTouching = minDistToVehicle <= 0;
        if (!this.isReversing && (this.stuckTimer > 4.0 || (isTouching && this.stuckTimer > 0.5))) {
            this.isReversing = true;
            this.reverseTimer = 0;
            this.stuckTimer = 0;
            const reason = isTouching ? "Gap<=0" : "Timer>4s";
            this.addEvent(`REVERSE: Stuck (${reason}). Backing up.`);
            console.log(`[Veh ${this.id}] STUCK (${reason}). Initiating Reverse.`);
        }

        if (this.isReversing) {
            this.reverseTimer += dt;
            desiredSpeed = -15; // Back up slowly
            forceBrake = false; // Override Emergency Stop

            // End Reverse
            if (this.reverseTimer > 1.5) {
                this.isReversing = false;
                this.addEvent("REVERSE COMPLETE. Retrying.");
            }
        }

        // 2.5 Overtake Abort
        // Reduced to 3.0s (was 5.0s) for faster reaction
        if (this.isOvertaking && this.stuckTimer > 3.0) {
            this.isOvertaking = false;
            // CRITICAL FIX: Trigger Reverse immediately to break "Abort -> Restart" loop
            this.isReversing = true;
            this.reverseTimer = 0;
            this.stuckTimer = 0;

            this.addEvent("OVERTAKE ABORTED: Stuck. Reversing.");
            console.log(`[Veh ${this.id}] Overtake ABORTED (Stuck > 3s) -> REVERSING`);
        }

        // 2. Start Overtake
        if (this.stuckTimer > 2.0 && !this.isOvertaking && !this.isReversing && effectiveBlocker) { // Reduced to 2.0s
            // Check Safety (Opposite Lane)
            // RHT: Overtake on Left (Centerline). Scan Left (+30px from Left Normal).
            let isSafe = true;
            const leftNormal = Vec2.fromAngle(this.heading - Math.PI / 2);
            const checkPos = this.pos.add(leftNormal.mul(30)); // Scan LEFT (Oncoming Lane)

            for (const other of world.vehicles) {
                if (other === this || other === effectiveBlocker) continue;
                const rel = other.pos.sub(this.pos);
                const fwd = rel.dot(headingVec);
                // Check if in front (-50 to 300)
                if (fwd > -50 && fwd < 300) {
                    // Check lateral relative to the CHECK PATH
                    const lat = Math.abs(other.pos.sub(checkPos).cross(headingVec));
                    if (lat < 20) { // If occupied
                        isSafe = false;
                        this.log(`Overtake Blocked by ${other.id}`);
                        break;
                    }
                }
            }

            if (isSafe) {
                this.isOvertaking = true;
                this.overtakeTargetId = effectiveBlocker.id;
                // this.stuckTimer = 0; // Keep counting
                this.log("OVERTAKE START: Steer Left, ignore blockers.");
                console.log(`[Veh ${this.id}] OVERTAKE START against ${effectiveBlocker.id} (Gap: ${minDistToVehicle.toFixed(1)})`);
            }
            // If unsafe, do NOT reset stuckTimer. Let it grow to 8.0 to trigger Reverse.
        }

        // 3. Execute Overtake
        if (this.isOvertaking) {
            // Apply Lateral Offset (Steer Left for RHT)
            // LERP to 30px (Reverted from 50px as requested)
            const targetOffset = 30.0;
            this.lateralOffset += (targetOffset - this.lateralOffset) * 0.1; // Smooth transition

            // Override Lookahead for smoother, wider arc
            // Was 30, increased to 80 to make the turn "Bigger/Rounder"
            const overtakeLookahead = 80;

            // --- USER REQUEST: "Eliminate Emergency Stop" ---
            // If overtaking, we forcefully DISABLE braking to allow full maneuverability.
            // We rely on the initial 'isSafe' check for safety.
            forceBrake = false;
            desiredSpeed = this.maxSpeed; // Maintain speed

            // Ignore FrontObstacle brake IF it is the target
            if (effectiveBlocker && effectiveBlocker.id === this.overtakeTargetId) {
                // redundant with forceBrake=false above, but keeping for clarity
                forceBrake = false;
            }
            // ... (rest of completion logic) ...

            if (vehicleAhead && vehicleAhead.id === this.overtakeTargetId) {
                desiredSpeed = this.maxSpeed;
            }

            // Check completion
            let target = null;
            if (this.overtakeTargetId) target = world.vehicles.find(v => v.id === this.overtakeTargetId);

            if (!target) {
                this.isOvertaking = false;
                // this.lateralOffset = 0; // Handled by LERP
                console.log(`[Veh ${this.id}] Overtake Cancelled (Target Lost)`);
            } else {
                const rel = target.pos.sub(this.pos);
                const fwd = rel.dot(headingVec);

                // If we passed them (they are behind by > car length + margin)
                if (fwd < - (this.width * 2.0)) { // Wait until fully past
                    this.isOvertaking = false;
                    // this.lateralOffset = 0; // Handled by LERP
                    this.log("Overtake Complete. Merging back.");
                    console.log(`[Veh ${this.id}] Overtake Complete`);
                }
            }
        } else {
            // this.lateralOffset = 0; // Handled by LERP
        }

        // --- APPLY LATERAL OFFSET TO STEERING TARGET ---
        if (this.lateralOffset !== 0) {
            const leftNormal = Vec2.fromAngle(this.heading - Math.PI / 2);
            const offsetVec = leftNormal.mul(this.lateralOffset);

            // Apply to existing targetPoint?
            // Need to retrieve the steering target used by followLane.
            // Since we cannot easily modify the calculated 'target' variable from Lines 190-210 here (scope issue),
            // We rely on the fact that this block runs, sets 'lateralOffset', and the NEXT frame's followLane
            // will use 'this.lateralOffset' in its calculation.

            // WAIT! The previous fix modified lines 206-210 to USE 'this.lateralOffset'.
            // So setting it here is correct for the NEXT frame.
            // But to ensure sharp turn immediately, we might want to Override 'Lookahead' logic?
            // "Lookahead" logic is at line 180.
            // I should override lookaheadDist property? No it's a local const.
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
            // FIX: Handle Reverse Speed (Negative Desired Speed)
            if (desiredSpeed < -0.1) {
                // Reverse Logic: Apply negative throttle to go backward
                if (this.speed > desiredSpeed) throttle = -1.0;
                else if (this.speed < desiredSpeed) throttle = 0; // Coast if going too fast in reverse
            } else {
                // Forward Logic
                if (this.speed < desiredSpeed) throttle = 1.0;
                else if (this.speed > desiredSpeed) brake = 1.0;
            }
        }

        this.applyControl(steer, throttle, brake, dt);

        // If we planned to force stop, ensure speed does not exceed desiredSpeed (protect against dt/brake lag)
        if (forceBrake && this.speed > desiredSpeed) {
            this.speed = desiredSpeed;
            this.vel = Vec2.fromAngle(this.heading).mul(this.speed);
        }

        // PHYSICAL CONSTRAINT: REMOVED per User Request ("Don't use hardcode/dumb logic")
        // We rely purely on Steering Logic (Lookahead/TurnFactor) to stay in lane.
        // if (!this.isOvertaking && !this.isReversing) {
        //    this.constrainToLane(lane);
        // }
    }

    private getPointAhead(world: World, lane: Lane, distanceAhead: number): { point: Vec2, lane: Lane } {
        let remaining = distanceAhead;
        let currentLane: Lane | undefined = lane;
        // Need to track where we are on the current lane to handle offsets correctly for the *first* step?
        // No, distanceAhead is absolute distance from vehicle pos.
        // But the loop subtracts 'len'. This 'len' is remaining length of current lane?
        // Ah, the original code looked wrong or assumed something.
        // Original: const len = currentLane.getLength(); if (remaining <= len) ... remaining -= len;
        // This assumes 'distanceAhead' passed to it was ALREADY relative to start of 'lane'?
        // Let's check call site.
        // Call site: getPointAhead(world, lane, closest.distanceAlong + lookaheadDist);
        // So passed arg is "Distance from Start of 'lane'".
        // So yes, logic is: Is target on this lane? (dist < len).
        // If not, remaining = dist - len (i.e. distance into next lane).
        // So my offset logic should apply when switching.

        while (currentLane) {
            const len = currentLane.getLength();
            if (remaining <= len) {
                const info = currentLane.getPointAtDistance(remaining);
                return { point: info.point, lane: currentLane };
            }

            // Moving to next lane
            remaining -= len; // This is distance "past end of currentLane"

            if (currentLane.nextLanes.length === 0) break;
            const next = world.getLane(currentLane.nextLanes[0]);
            if (!next) break;

            // Check for discontinuity (T-junction merge)
            const currentEnd = currentLane.points[currentLane.points.length - 1];
            const nextStart = next.points[0];

            // If the jump is large (> 5px), assume we are entering 'next' at a specific projected point
            // rather than at the start (distance 0).
            if (currentEnd.dist(nextStart) > 5) {
                const proj = next.getProjectedPoint(currentEnd);
                // "remaining" is how much we want to travel BEYOND the merge point.
                // The merge point is at 'proj.distanceAlong' on the new lane.
                // So target distance on new lane is proj.distanceAlong + remaining.
                remaining += proj.distanceAlong;
            }

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
        const header = `[veh_${this.id}] Lane:${this.currentLaneId || 'N/A'} Spd:${Math.round(this.speed)}/${this.maxSpeed} T:${this.stuckTimer.toFixed(1)}`;
        if (this.decisionLogs.length === 0) return header;
        return header + '\n  > ' + this.decisionLogs.join('\n  > ');
    }
}
