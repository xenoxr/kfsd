import { Entity } from '../entities/Entity';
import { Rect } from '../core/Rect';

export class Collision {
    static check(a: Entity, b: Entity): boolean {
        const r1 = a.getBounds();
        const r2 = b.getBounds();
        return r1.intersects(r2);
    }

    static checkList(target: Entity, others: Entity[]): Entity | null {
        for (const other of others) {
            if (target === other) continue;
            if (this.check(target, other)) {
                return other;
            }
        }
        return null;
    }
}
