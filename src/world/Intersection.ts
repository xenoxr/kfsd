import { Crosswalk, PedestrianSignal } from './Crosswalk';
import type { CrossingDirection } from './Crosswalk';
import { Vec2 } from '../core/Vec2';

export enum TrafficLightState {
    RED,
    GREEN,
    YELLOW,
    LEFT_ARROW  // 좌회전 화살표 신호
}

export class Intersection {
    public trafficLights: Map<string, TrafficLightState> = new Map(); // laneId -> State
    public timer: number = 0;

    // Configuration for cycles
    // Simple approach: A list of "Green Groups".
    // Group 0 Green -> Yellow -> Red -> Group 1 Green -> ...
    public greenGroups: string[][] = []; // [ ['lane1', 'lane2'], ['lane3', 'lane4'] ]
    public leftTurnGroups: string[][] = []; // 각 greenGroup에 대응하는 좌회전 차선들
    public currentGroupIndex: number = 0;
    public state: 'LeftArrow' | 'LeftYellow' | 'Green' | 'GreenLeft' | 'Yellow' | 'RedAll' = 'RedAll';
    public leftTurnOnly: boolean = false; // 직진 신호 없이 좌회전 신호만 운영

    // Direction each green group controls: 'EW' for east-west traffic, 'NS' for north-south traffic
    public greenGroupDirections: CrossingDirection[] = [];

    public leftArrowDuration: number = 3.0; // 좌회전 신호 시간 (직좌 동시신호 시간으로 사용)
    public greenDuration: number = 5.0; // seconds (직진 단독 신호 시간)
    public yellowDuration: number = 2.0;
    public redClearanceDuration: number = 1.0;

    constructor(
        public id: string,
        public center: Vec2,
        public connectedLanes: string[], // Inbound lanes
        public crosswalks: Crosswalk[] = []
    ) { }

    // MapLoader에서 greenGroups 설정 후 호출
    initialize() {
        if (this.greenGroups.length === 0) return;

        const firstLeftTurnLanes = this.leftTurnGroups[0] || [];

        if (this.leftTurnOnly && firstLeftTurnLanes.length > 0) {
            // 좌회전 전용 교차로 (T자형 등): 좌회전 -> 황색 -> 적색
            this.state = 'LeftArrow';
            this.timer = 0;
            this.setGroupState(this.greenGroups[0], TrafficLightState.RED);
            this.setGroupState(firstLeftTurnLanes, TrafficLightState.LEFT_ARROW);
            this.setCrosswalks(PedestrianSignal.STOP);
        } else {
            // 일반 교차로 (사거리 등): 적색 -> 직진 -> 직좌 -> 황색 -> 적색
            this.state = 'Green';
            this.timer = 0;
            // 직진 녹색
            this.setGroupState(this.greenGroups[0], TrafficLightState.GREEN);
            // 좌회전 적색 (Initial phase is Straight only)
            if (firstLeftTurnLanes.length > 0) {
                this.setGroupState(firstLeftTurnLanes, TrafficLightState.RED);
            }

            // 횡단보도 신호 업데이트
            this.updateCrosswalkSignals();
        }
    }

    update(dt: number) {
        this.timer += dt;

        if (this.greenGroups.length === 0) return;

        const currentLeftTurnLanes = this.leftTurnGroups[this.currentGroupIndex] || [];
        const hasLeftTurn = currentLeftTurnLanes.length > 0;

        switch (this.state) {
            // --- Left Turn Only Mode States ---
            case 'LeftArrow':
                // 좌회전 신호 (직진 금지) -> 좌회전 황색
                if (this.timer >= this.leftArrowDuration) {
                    this.state = 'LeftYellow';
                    this.timer = 0;
                    this.setGroupState(currentLeftTurnLanes, TrafficLightState.YELLOW);
                }
                break;

            case 'LeftYellow':
                // 좌회전 황색 -> 적색
                if (this.timer >= this.yellowDuration) {
                    this.state = 'RedAll';
                    this.timer = 0;
                    this.setGroupState(currentLeftTurnLanes, TrafficLightState.RED);
                }
                break;

            // --- Standard Mode States (Straight First) ---
            case 'Green': // Straight Only
                if (this.timer >= this.greenDuration) {
                    if (hasLeftTurn && !this.leftTurnOnly) {
                        // 직진 -> 직좌 (Straight + Left)
                        this.state = 'GreenLeft';
                        this.timer = 0;
                        this.setGroupState(currentLeftTurnLanes, TrafficLightState.LEFT_ARROW);
                    } else {
                        // 좌회전 차선이 없으면 바로 황색
                        this.state = 'Yellow';
                        this.timer = 0;
                        this.setGroupState(this.greenGroups[this.currentGroupIndex], TrafficLightState.YELLOW);
                        this.setCrosswalks(PedestrianSignal.STOP);
                    }
                }
                break;

            case 'GreenLeft': // Straight + Left Arrow
                if (this.timer >= this.leftArrowDuration) {
                    // 직좌 -> 황색 (전체 황색)
                    this.state = 'Yellow';
                    this.timer = 0;
                    // 직진과 좌회전 모두 황색으로 변경
                    this.setGroupState(this.greenGroups[this.currentGroupIndex], TrafficLightState.YELLOW);
                    if (hasLeftTurn) {
                        this.setGroupState(currentLeftTurnLanes, TrafficLightState.YELLOW);
                    }
                    this.setCrosswalks(PedestrianSignal.STOP);
                }
                break;

            case 'Yellow':
                if (this.timer >= this.yellowDuration) {
                    this.state = 'RedAll';
                    this.timer = 0;
                    // 직진과 좌회전 모두 적색으로 변경
                    this.setGroupState(this.greenGroups[this.currentGroupIndex], TrafficLightState.RED);
                    if (hasLeftTurn) {
                        this.setGroupState(currentLeftTurnLanes, TrafficLightState.RED);
                    }
                }
                break;

            case 'RedAll':
                if (this.timer >= this.redClearanceDuration) {
                    // Next group
                    this.currentGroupIndex = (this.currentGroupIndex + 1) % this.greenGroups.length;

                    const nextLeftTurnLanes = this.leftTurnGroups[this.currentGroupIndex] || [];
                    const nextHasLeftTurn = nextLeftTurnLanes.length > 0;

                    if (this.leftTurnOnly && nextHasLeftTurn) {
                        // 좌회전 전용 모드
                        this.state = 'LeftArrow';
                        this.timer = 0;
                        this.setGroupState(this.greenGroups[this.currentGroupIndex], TrafficLightState.RED);
                        this.setGroupState(nextLeftTurnLanes, TrafficLightState.LEFT_ARROW);
                        this.setCrosswalks(PedestrianSignal.STOP);
                    } else {
                        // 일반 모드: 적색 -> 직진
                        this.state = 'Green';
                        this.timer = 0;
                        this.setGroupState(this.greenGroups[this.currentGroupIndex], TrafficLightState.GREEN);
                        // 좌회전 차선은 적색 유지 (직좌에서 켜짐)
                        if (nextHasLeftTurn) {
                            this.setGroupState(nextLeftTurnLanes, TrafficLightState.RED);
                        }
                        // Update crosswalk signals based on which direction is now green
                        this.updateCrosswalkSignals();
                    }
                }
                break;
        }
    }

    private setGroupState(lanes: string[], state: TrafficLightState) {
        for (const laneId of lanes) {
            this.trafficLights.set(laneId, state);
        }
    }

    private setCrosswalks(signal: PedestrianSignal) {
        for (const cw of this.crosswalks) {
            cw.signal = signal;
        }
    }

    // Update crosswalk signals based on current green group direction
    // When EW traffic is green, EW crosswalks get WALK (pedestrians walk parallel to EW traffic, crossing NS roads)
    // When NS traffic is green, NS crosswalks get WALK (pedestrians walk parallel to NS traffic, crossing EW roads)
    private updateCrosswalkSignals() {
        const currentDirection = this.greenGroupDirections[this.currentGroupIndex];

        if (!currentDirection) {
            // Fallback: all crosswalks STOP during green for safety
            this.setCrosswalks(PedestrianSignal.STOP);
            return;
        }

        for (const cw of this.crosswalks) {
            // Crosswalks that are PARALLEL to the green traffic direction get WALK
            // EW traffic green → EW crosswalks WALK (pedestrians crossing NS roads)
            // NS traffic green → NS crosswalks WALK (pedestrians crossing EW roads)
            if (currentDirection === cw.crossingDirection) {
                cw.signal = PedestrianSignal.WALK;
            } else {
                cw.signal = PedestrianSignal.STOP;
            }
        }
    }
}
