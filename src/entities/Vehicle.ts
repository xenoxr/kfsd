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
    public reverseCooldown: number = 0; // Cooldown timer after reverse ends
    public reverseSteerBias: number = 0; // Steering bias while reversing (helps create escape angle)
    public postReverseStraightTimer: number = 0; // Keep straight right after reverse
    public overtakeTargetId: number | string | null = null;
    public lateralOffset: number = 0;
    public currentSteer: number = 0; // Current steering angle for logging

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

    // Pure Pursuit-like lane following
    followLane(world: World, dt: number) {
        if (!this.currentLaneId) return;
        let lane = world.getLane(this.currentLaneId);
        if (!lane) {
            // Try to find nearest lane if lost?
            return;
        }

        // Decrease reverse cooldown timer
        if (this.reverseCooldown > 0) {
            this.reverseCooldown -= dt;
            if (this.reverseCooldown < 0) this.reverseCooldown = 0;
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
        // Shorter lookahead for better cornering control
        // Normal: 0.8x speed (min 25, max 80)
        // Overtaking: 50px for wider arc
        let lookaheadDist = Math.max(25, Math.min(80, this.speed * 0.8));
        if (this.isOvertaking) {
            lookaheadDist = 50;
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
            // Build escape angle while backing up so we don't drive straight back into the blocker
            steer = this.reverseSteerBias;
            this.lateralOffset += (18 - this.lateralOffset) * 0.3; // push laterally for a wider exit
            angleDiff = 0; // For debug display
        } else if (this.postReverseStraightTimer > 0) {
            // After reverse, force straight for a moment to avoid over-rotating forward
            this.postReverseStraightTimer -= dt;
            if (this.postReverseStraightTimer < 0) this.postReverseStraightTimer = 0;
            steer = 0;
            angleDiff = 0;
        } else {
            // Higher steering gain (3.5) for more responsive cornering
            steer = Math.max(-1, Math.min(1, angleDiff * 3.5));
        }

        // Adjust speed based on turn
        let desiredSpeed = lane.speedLimit || this.maxSpeed;

        // Aggressive cornering slowdown to prevent lane departure
        // Cubic curve for very sharp slowdown on sharp turns
        const turnRatio = Math.abs(angleDiff) / (Math.PI / 2);
        const turnFactor = Math.max(0.15, Math.pow(1 - turnRatio, 3));

        // CRITICAL: Apply turn slowdown ALWAYS (even when overtaking)
        if (Math.abs(angleDiff) > 0.08) { // Earlier slowdown threshold
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

        const SAFE_GAP = 120; // Maintain ~120px gap (reduced for tighter following)
        const CRITICAL_GAP = 40; // Panic stop distance
        const MIN_BUFFER = 20;   // Extra buffer beyond physics stop distance

        let forceBrake = false;

        if (vehicleAhead) {
            // EXEMPTION: If we are overtaking THIS vehicle, or Reversing, IGNORE Emergency Stop
            const isTarget = this.isOvertaking && this.overtakeTargetId === vehicleAhead.id;

            // CRITICAL: Also skip if in reverseCooldown to allow forward movement after reverse
            if (!this.isReversing && !isTarget && this.reverseCooldown <= 0) {
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
        const MAX_FRONT_CHECK = 140; // pixels - slightly reduced range
        const CORRIDOR_HALF_WIDTH = this.width * 0.5; // Balanced tolerance for realistic collision detection

        // --- PRE-CALCULATE BLOCKING VEHICLE ---
        let blockingVehicle: Vehicle | null = null;

        // CRITICAL: Skip front obstacle check if reversing OR in reverseCooldown
        // This allows the vehicle to move forward and correct its heading after reverse
        if (!this.isReversing && this.reverseCooldown <= 0) {
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
        } // End of if (!this.isReversing) for Front Corridor Check

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
        // CRITICAL: Don't increment stuckTimer during reverseCooldown to prevent immediate re-stuck
        if (this.reverseCooldown <= 0 && this.postReverseStraightTimer <= 0) {
            if ((this.isOvertaking && selfStuck) || (selfStuck && (forceBrake || (effectiveBlocker && blockerStuck)))) {
                this.stuckTimer += dt;
            } else {
                this.stuckTimer = 0;
            }
        }

        // 1.5 Reverse Logic (Unstick)
        // Trigger if stuck for > 3.0s (General) - faster reaction
        // OR Trigger IMMEDIATELY (>0.3s) if physically touching (Gap <= 0)
        const isTouching = minDistToVehicle <= 0;
        if (!this.isReversing && this.postReverseStraightTimer <= 0 && (this.stuckTimer > 3.0 || (isTouching && this.stuckTimer > 0.3))) {
            this.isReversing = true;
            this.reverseTimer = 0;
            this.stuckTimer = 0;
            // Bias steering while reversing to build an escape angle (prefer left/overtake side)
            if (lane) {
                const myProj = lane.getProjectedPoint(this.pos);
                const laneDir = lane.getHeadingAt(myProj.segmentIndex);
                const leftNormal = new Vec2(-laneDir.y, laneDir.x);
                const signedOffset = this.pos.sub(myProj.point).dot(leftNormal); // + means left of center
                // Use aggressive steer to reach ~45°+ yaw change
                this.reverseSteerBias = signedOffset > lane.width * 0.3 ? -0.65 : 0.85;
            } else {
                this.reverseSteerBias = 0.85;
            }
            const reason = isTouching ? "Gap<=0" : "Timer>3s";
            this.addEvent(`REVERSE: Stuck (${reason}). Backing up.`);
            console.log(`[Veh ${this.id}] STUCK (${reason}). Initiating Reverse.`);
        }

        if (this.isReversing) {
            this.reverseTimer += dt;
            desiredSpeed = -20; // Back up a bit faster
            forceBrake = false; // Override Emergency Stop

            // End Reverse - shorter duration for quicker recovery
            if (this.reverseTimer > 1.2) {
                this.isReversing = false;
                this.reverseCooldown = 3.0; // longer cooldown to allow forward movement
                this.postReverseStraightTimer = 2.0; // Go straight briefly after backing up
                this.addEvent("REVERSE COMPLETE. Retrying.");
            }
        }

        // 2.5 Overtake Abort
        // Fast abort (2.5s) to prevent prolonged stuck state
        if (this.isOvertaking && this.stuckTimer > 2.5) {
            this.isOvertaking = false;
            // CRITICAL FIX: Trigger Reverse immediately to break "Abort -> Restart" loop
            this.isReversing = true;
            this.reverseTimer = 0;
            this.stuckTimer = 0;

            this.addEvent("OVERTAKE ABORTED: Stuck. Reversing.");
            console.log(`[Veh ${this.id}] Overtake ABORTED (Stuck > 2.5s) -> REVERSING`);
        }

        // 2.6 Abort overtake if in sharp corner (angle > 0.5 rad ~ 28 degrees)
        if (this.isOvertaking && Math.abs(angleDiff) > 0.5) {
            this.isOvertaking = false;
            this.lateralOffset = 0;
            this.stuckTimer = 0; // Reset to retry later on straight
            this.addEvent(`OVERTAKE ABORTED: Sharp corner (${angleDiff.toFixed(2)})`);
            console.log(`[Veh ${this.id}] Overtake ABORTED (Sharp Corner: ${angleDiff.toFixed(2)})`);
        }

        // 2. Start Overtake
        // Only start if: stuck + not in corner (angleDiff < 0.4 rad ~ 23 degrees)
        if (this.stuckTimer > 1.5 && !this.isOvertaking && !this.isReversing && effectiveBlocker && Math.abs(angleDiff) < 0.4) {
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
            // DYNAMIC Lateral Offset: Based on target vehicle position and lane boundaries
            let targetOffset = 30.0; // Default offset

            // Find target vehicle
            let target = effectiveBlocker;
            if (!target && this.overtakeTargetId) {
                target = world.vehicles.find(v => v.id === this.overtakeTargetId) || null;
            }

            if (target && lane) {
                // Calculate target's lateral position from lane centerline
                const targetProj = lane.getProjectedPoint(target.pos);
                const targetToCenter = target.pos.sub(targetProj.point);
                const targetLateralDist = targetToCenter.mag();

                // Calculate my lateral position
                const myProj = lane.getProjectedPoint(this.pos);
                const myToCenter = this.pos.sub(myProj.point);
                const myLateralDist = myToCenter.mag();

                // Calculate required offset to clear target (car width + safety margin)
                const clearanceNeeded = this.width + 5; // 5px safety margin

                // Determine target offset based on target position
                // If target is close to center, we need more offset
                // Allow deep centerline crossing: up to ~1 lane width to the left (but protect sidewalk/right side)
                const maxLeftOffset = lane.width * 1.0; // full lane shift to enter oncoming lane
                const clearanceOffset = clearanceNeeded + targetLateralDist;
                targetOffset = Math.min(clearanceOffset, maxLeftOffset);

                // BOUNDARY CHECK: Ensure we don't drift into sidewalk on the right even while leaning left
                const laneDirection = lane.getHeadingAt(myProj.segmentIndex);
                const leftNormal = new Vec2(-laneDirection.y, laneDirection.x); // Perpendicular to lane, pointing left
                const projectedPos = myProj.point.add(leftNormal.mul(targetOffset));
                const projectedToCenter = projectedPos.sub(myProj.point);
                const projectedLateralDist = projectedToCenter.mag();

                // Keep right-side margin tight, but allow large left offsets for overtaking
                const safeRightLimit = lane.width * 0.48;
                if (targetOffset < 0 && projectedLateralDist > safeRightLimit) {
                    targetOffset = safeRightLimit - myLateralDist;
                    this.log(`Overtake: Right boundary limit ${targetOffset.toFixed(1)}`);
                } else if (targetOffset > maxLeftOffset) {
                    targetOffset = maxLeftOffset;
                    this.log(`Overtake: Max left offset ${targetOffset.toFixed(1)}`);
                }

                // Reduce in corners for safety
                if (Math.abs(angleDiff) > 0.3) {
                    targetOffset *= 0.7; // 30% reduction in sharp corners
                }
            }

            this.lateralOffset += (targetOffset - this.lateralOffset) * 0.15; // Smooth transition

            // DYNAMIC Lookahead: Increase in corners for smoother arc
            // Straight (angle < 0.2): 50px
            // Corner (angle >= 0.2): up to 100px for wider, smoother arc
            let overtakeLookahead = 50;
            if (Math.abs(angleDiff) > 0.2) {
                overtakeLookahead = Math.min(100, 50 + Math.abs(angleDiff) * 120);
            }

            // SAFETY FIRST: Only ignore emergency brake for the SPECIFIC target vehicle
            // For all other obstacles, respect emergency stop
            if (effectiveBlocker && effectiveBlocker.id === this.overtakeTargetId) {
                // Allow passing the target, but reduce speed if too close
                if (minDistToVehicle < 30 && minDistToVehicle > 0) {
                    desiredSpeed = Math.min(desiredSpeed, this.maxSpeed * 0.7);
                } else {
                    desiredSpeed = this.maxSpeed * 0.8; // Slightly slower for safety
                }
                // Don't force brake for target vehicle
                if (forceBrake && vehicleAhead === effectiveBlocker) {
                    forceBrake = false;
                }
            }
            // For non-target obstacles, keep forceBrake = true (respect emergency stop)

            // Check completion
            let overtakeTarget = null;
            if (this.overtakeTargetId) overtakeTarget = world.vehicles.find(v => v.id === this.overtakeTargetId);

            if (!overtakeTarget) {
                this.isOvertaking = false;
                // this.lateralOffset = 0; // Handled by LERP
                console.log(`[Veh ${this.id}] Overtake Cancelled (Target Lost)`);
            } else {
                const rel = overtakeTarget.pos.sub(this.pos);
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

        this.currentSteer = steer; // Store for logging
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
