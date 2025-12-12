import { Rect } from '../core/Rect';
import { Vec2 } from '../core/Vec2';

export enum PedestrianSignal {
    WALK = 'WALK',
    STOP = 'STOP'
}

// crossing direction indicates which road the pedestrian crosses
// 'NS' means the crosswalk crosses a north-south road (pedestrian walks east-west)
// 'EW' means the crosswalk crosses an east-west road (pedestrian walks north-south)
export type CrossingDirection = 'NS' | 'EW';

export class Crosswalk {
    constructor(
        public id: string,
        public area: Rect, // Simplified as a generic rect for now
        public intersectionId: string,
        public signal: PedestrianSignal = PedestrianSignal.STOP,
        public crossingDirection: CrossingDirection = 'EW' // default: crosses east-west road
    ) { }

    get center(): Vec2 {
        return this.area.center;
    }
}
