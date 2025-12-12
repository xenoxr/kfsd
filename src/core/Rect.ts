import { Vec2 } from './Vec2';

export class Rect {
    constructor(
        public x: number,
        public y: number,
        public width: number,
        public height: number
    ) { }

    get center(): Vec2 {
        return new Vec2(this.x + this.width / 2, this.y + this.height / 2);
    }

    contains(p: Vec2): boolean {
        return (
            p.x >= this.x &&
            p.x <= this.x + this.width &&
            p.y >= this.y &&
            p.y <= this.y + this.height
        );
    }

    intersects(other: Rect): boolean {
        return (
            this.x < other.x + other.width &&
            this.x + this.width > other.x &&
            this.y < other.y + other.height &&
            this.y + this.height > other.y
        );
    }
}
