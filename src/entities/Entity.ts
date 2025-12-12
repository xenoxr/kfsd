import { Vec2 } from '../core/Vec2';
import { Rect } from '../core/Rect';

export abstract class Entity {
    public pos: Vec2;
    public vel: Vec2 = new Vec2(0, 0);
    public heading: number = 0; // Radians, 0 = East
    public width: number;
    public height: number;
    public dead: boolean = false;
    public id: number;
    private static nextId: number = 1;
    private logs: string[] = [];

    constructor(x: number, y: number, width: number, height: number, heading: number = 0) {
        this.id = Entity.nextId++;
        this.pos = new Vec2(x, y);
        this.width = width;
        this.height = height;
        this.heading = heading;
    }

    abstract update(dt: number): void;

    getBounds(): Rect {
        // Axis aligned bounding box approximation for SAT phase 1
        // For proper rotation, we'd need a Polygon class, but Rect is fine for Broadphase
        return new Rect(
            this.pos.x - this.width / 2,
            this.pos.y - this.height / 2,
            this.width,
            this.height
        );
    }
}
