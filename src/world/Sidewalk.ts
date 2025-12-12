import { Vec2 } from '../core/Vec2';

export class Sidewalk {
    constructor(
        public id: string,
        public points: Vec2[],
        public width: number = 20,
        public connectedCrosswalks: string[] = []
    ) { }

    // Get total length of sidewalk
    get length(): number {
        let total = 0;
        for (let i = 1; i < this.points.length; i++) {
            total += this.points[i].dist(this.points[i - 1]);
        }
        return total;
    }

    // Get point at specific distance along the sidewalk
    getPointAtDistance(distance: number): Vec2 {
        let remaining = distance;
        for (let i = 1; i < this.points.length; i++) {
            const segLen = this.points[i].dist(this.points[i - 1]);
            if (remaining <= segLen) {
                const t = remaining / segLen;
                return this.points[i - 1].lerp(this.points[i], t);
            }
            remaining -= segLen;
        }
        return this.points[this.points.length - 1];
    }

    // Get closest point index
    getClosestPointIndex(pos: Vec2): number {
        let minDist = Infinity;
        let minIdx = 0;
        for (let i = 0; i < this.points.length; i++) {
            const d = pos.dist(this.points[i]);
            if (d < minDist) {
                minDist = d;
                minIdx = i;
            }
        }
        return minIdx;
    }
}
