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
    public state: 'LeftArrow' | 'LeftYellow' | 'Green' | 'Yellow' | 'RedAll' = 'RedAll';

    // Direction each green group controls: 'EW' for east-west traffic, 'NS' for north-south traffic
    public greenGroupDirections: CrossingDirection[] = [];

    public leftArrowDuration: number = 3.0; // 좌회전 신호 시간
    public greenDuration: number = 5.0; // seconds
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

        // 첫 그룹의 좌회전 차선 확인
        const firstLeftTurnLanes = this.leftTurnGroups[0] || [];

        if (firstLeftTurnLanes.length > 0) {
            // 좌회전 신호부터 시작
            this.state = 'LeftArrow';
            this.timer = 0;
            // 직진은 빨간불 (먼저 설정)
            this.setGroupState(this.greenGroups[0], TrafficLightState.RED);
            // 좌회전 화살표 (나중에 설정하여 덮어씀)
            this.setGroupState(firstLeftTurnLanes, TrafficLightState.LEFT_ARROW);
            this.setCrosswalks(PedestrianSignal.STOP);
        } else {
            // 좌회전 없으면 직진 녹색
            this.state = 'Green';
            this.timer = 0;
            this.setGroupState(this.greenGroups[0], TrafficLightState.GREEN);
        }
    }

    update(dt: number) {
        this.timer += dt;

        if (this.greenGroups.length === 0) return;

        const currentLeftTurnLanes = this.leftTurnGroups[this.currentGroupIndex] || [];
        const hasLeftTurn = currentLeftTurnLanes.length > 0;

        switch (this.state) {
            case 'LeftArrow':
                // 좌회전 신호 → 좌회전 황색 → 직진 녹색
                if (this.timer >= this.leftArrowDuration) {
                    this.state = 'LeftYellow';
                    this.timer = 0;
                    this.setGroupState(currentLeftTurnLanes, TrafficLightState.YELLOW);
                }
                break;

            case 'LeftYellow':
                // 좌회전 황색 → 직진 녹색
                if (this.timer >= this.yellowDuration) {
                    this.state = 'Green';
                    this.timer = 0;
                    this.setGroupState(currentLeftTurnLanes, TrafficLightState.RED);
                    this.setGroupState(this.greenGroups[this.currentGroupIndex], TrafficLightState.GREEN);
                }
                break;

            case 'Green':
                if (this.timer >= this.greenDuration) {
                    this.state = 'Yellow';
                    this.timer = 0;
                    this.setGroupState(this.greenGroups[this.currentGroupIndex], TrafficLightState.YELLOW);

                    // All crosswalks turn STOP during yellow/transition
                    this.setCrosswalks(PedestrianSignal.STOP);
                }
                break;

            case 'Yellow':
                if (this.timer >= this.yellowDuration) {
                    this.state = 'RedAll';
                    this.timer = 0;
                    this.setGroupState(this.greenGroups[this.currentGroupIndex], TrafficLightState.RED);
                }
                break;

            case 'RedAll':
                if (this.timer >= this.redClearanceDuration) {
                    // Next group
                    this.currentGroupIndex = (this.currentGroupIndex + 1) % this.greenGroups.length;

                    const nextLeftTurnLanes = this.leftTurnGroups[this.currentGroupIndex] || [];
                    const nextHasLeftTurn = nextLeftTurnLanes.length > 0;

                    if (nextHasLeftTurn) {
                        // 좌회전 신호부터 시작
                        this.state = 'LeftArrow';
                        this.timer = 0;
                        // 직진은 빨간불 (먼저 설정)
                        this.setGroupState(this.greenGroups[this.currentGroupIndex], TrafficLightState.RED);
                        // 좌회전 화살표 (나중에 설정하여 덮어씀)
                        this.setGroupState(nextLeftTurnLanes, TrafficLightState.LEFT_ARROW);
                        // 좌회전 중에는 횡단보도 정지
                        this.setCrosswalks(PedestrianSignal.STOP);
                    } else {
                        // 좌회전 없으면 바로 직진 녹색
                        this.state = 'Green';
                        this.timer = 0;
                        this.setGroupState(this.greenGroups[this.currentGroupIndex], TrafficLightState.GREEN);
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
