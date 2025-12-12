import { Vec2 } from '../core/Vec2';

export class Lane {
    constructor(
        public id: string,
        public points: Vec2[],
        public width: number = 40,
        public speedLimit: number = 10,
        public nextLanes: string[] = [] // IDs of connected lanes
    ) { }

    // Get direction vector at a normalized progress t (0 to 1) along the lane segment
    // For simplicity, we can assume linear interpolation between points or just find the segment
    getHeadingAt(index: number): Vec2 {
        if (index >= this.points.length - 1) {
            return this.points[this.points.length - 1].sub(this.points[this.points.length - 2]).normalize();
        }
        return this.points[index + 1].sub(this.points[index]).normalize();
    }

    getCenter(): Vec2 {
        // Approximate center
        const midInfo = this.getPointAtDistance(this.getLength() / 2);
        return midInfo.point;
    }

    getLength(): number {
        let len = 0;
        for (let i = 0; i < this.points.length - 1; i++) {
            len += this.points[i].dist(this.points[i + 1]);
        }
        return len;
    }

    // Returns point and heading at specific distance from start
    getPointAtDistance(dist: number): { point: Vec2, heading: Vec2, index: number } {
        let currentDist = 0;
        for (let i = 0; i < this.points.length - 1; i++) {
            const segLen = this.points[i].dist(this.points[i + 1]);
            if (currentDist + segLen >= dist) {
                const t = (dist - currentDist) / segLen;
                const p = this.points[i].add(this.points[i + 1].sub(this.points[i]).mul(t));
                const h = this.points[i + 1].sub(this.points[i]).normalize();
                return { point: p, heading: h, index: i };
            }
            currentDist += segLen;
        }
        // Cap at end
        const last = this.points[this.points.length - 1];
        const heading = this.points[this.points.length - 1].sub(this.points[this.points.length - 2]).normalize();
        return { point: last, heading, index: this.points.length - 2 };
    }

    getProjectedPoint(pos: Vec2): { point: Vec2, distanceAlong: number, t: number, segmentIndex: number } {
        let bestDist2 = Number.POSITIVE_INFINITY;
        let bestPoint = this.points[0];
        let bestAlong = 0;
        let accumulated = 0;
        let bestT = 0;
        let bestIndex = 0;

        for (let i = 0; i < this.points.length - 1; i++) {
            const a = this.points[i];
            const b = this.points[i + 1];
            const ab = b.sub(a);
            const abLen = ab.mag();
            const denom = ab.dot(ab) || 1;
            const t = Math.max(0, Math.min(1, pos.sub(a).dot(ab) / denom));
            const proj = a.add(ab.mul(t));
            const dist2 = pos.sub(proj).magSq();
            const along = accumulated + abLen * t;

            if (dist2 < bestDist2) {
                bestDist2 = dist2;
                bestPoint = proj;
                bestAlong = along;
                bestT = t;
                bestIndex = i;
            }
            accumulated += abLen;
        }

        return { point: bestPoint, distanceAlong: bestAlong, t: bestT, segmentIndex: bestIndex };
    }
}
