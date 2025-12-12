import { Vec2 } from '../core/Vec2';
import { World } from './World';
import { Lane } from './Lane';

type LaneLabel = { road: string, dir?: string, laneNo: string };

export class LaneLabeler {
    private static cache: WeakMap<World, Map<string, LaneLabel>> = new WeakMap();

    private static parseRoadDir(laneId: string): { road: string, dir?: string } {
        const mapping: { regex: RegExp, name: string }[] = [
            { regex: /^main_[ew]\d_/i, name: 'Central Ave' },
            { regex: /^main_[ew]\d$/i, name: 'Central Ave' },
            { regex: /^outer_north/i, name: 'Ring N' },
            { regex: /^outer_south/i, name: 'Ring S' },
            { regex: /^outer_east/i, name: 'Ring E' },
            { regex: /^outer_west/i, name: 'Ring W' },
            { regex: /^southbound_right/i, name: 'Right Connector S' },
            { regex: /^southbound_left/i, name: 'Left Connector S' },
            { regex: /^northbound_right/i, name: 'Right Connector N' },
            { regex: /^northbound_left/i, name: 'Left Connector N' }
        ];

        let road = 'Road';
        for (const m of mapping) {
            if (m.regex.test(laneId)) {
                road = m.name;
                break;
            }
        }

        let dir: string | undefined;
        if (/[_]e/.test(laneId) || /east/i.test(laneId)) dir = 'E';
        else if (/[_]w/.test(laneId) || /west/i.test(laneId)) dir = 'W';
        else if (/[_]n/.test(laneId) || /north/i.test(laneId)) dir = 'N';
        else if (/[_]s/.test(laneId) || /south/i.test(laneId)) dir = 'S';

        return { road, dir };
    }

    private static build(world: World): Map<string, LaneLabel> {
        const labels = new Map<string, LaneLabel>();
        const groups = new Map<string, { lane: Lane, offset: number }[]>();

        for (const lane of world.lanes.values()) {
            const { road, dir } = this.parseRoadDir(lane.id);
            const key = `${road}|${dir || ''}`;

            const mid = lane.getPointAtDistance(lane.getLength() / 2);
            const heading = lane.getHeadingAt(mid.index);
            const normal = new Vec2(-heading.y, heading.x); // perpendicular for ordering lanes side-by-side
            const offset = mid.point.dot(normal);

            if (!groups.has(key)) groups.set(key, []);
            groups.get(key)!.push({ lane, offset });
        }

        for (const group of groups.values()) {
            group.sort((a, b) => a.offset - b.offset);
            group.forEach((entry, idx) => {
                const { road, dir } = this.parseRoadDir(entry.lane.id);
                labels.set(entry.lane.id, { road, dir, laneNo: String(idx + 1) });
            });
        }

        return labels;
    }

    static getLabels(world: World): Map<string, LaneLabel> {
        const cached = this.cache.get(world);
        if (cached) return cached;
        const built = this.build(world);
        this.cache.set(world, built);
        return built;
    }

    static format(world: World, laneId: string | null | undefined): string {
        if (!laneId) return 'N/A';
        const label = this.getLabels(world).get(laneId);
        if (!label) return laneId;
        const prefix = label.dir ? `${label.dir}` : 'L';
        return `${label.road} ${prefix}${label.laneNo}`;
    }
}
