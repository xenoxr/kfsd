export class Vec2 {
    constructor(public x: number, public y: number) { }

    add(v: Vec2): Vec2 {
        return new Vec2(this.x + v.x, this.y + v.y);
    }

    sub(v: Vec2): Vec2 {
        return new Vec2(this.x - v.x, this.y - v.y);
    }

    mul(s: number): Vec2 {
        return new Vec2(this.x * s, this.y * s);
    }

    div(s: number): Vec2 {
        return new Vec2(this.x / s, this.y / s);
    }

    mag(): number {
        return Math.sqrt(this.x * this.x + this.y * this.y);
    }

    magSq(): number {
        return this.x * this.x + this.y * this.y;
    }

    normalize(): Vec2 {
        const m = this.mag();
        if (m === 0) return new Vec2(0, 0);
        return this.div(m);
    }

    dist(v: Vec2): number {
        return this.sub(v).mag();
    }

    dot(v: Vec2): number {
        return this.x * v.x + this.y * v.y;
    }

    cross(v: Vec2): number {
        return this.x * v.y - this.y * v.x;
    }

    angle(): number {
        return Math.atan2(this.y, this.x);
    }

    rotate(angle: number): Vec2 {
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        return new Vec2(
            this.x * cos - this.y * sin,
            this.x * sin + this.y * cos
        );
    }

    lerp(v: Vec2, t: number): Vec2 {
        return new Vec2(
            this.x + (v.x - this.x) * t,
            this.y + (v.y - this.y) * t
        );
    }

    clone(): Vec2 {
        return new Vec2(this.x, this.y);
    }

    static zero(): Vec2 {
        return new Vec2(0, 0);
    }

    static fromAngle(angle: number): Vec2 {
        return new Vec2(Math.cos(angle), Math.sin(angle));
    }
}
