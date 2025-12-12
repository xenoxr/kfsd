import { World } from '../world/World';
import { Lane } from '../world/Lane';
import { Road } from '../world/Road';
import { Intersection } from '../world/Intersection';
import { Crosswalk } from '../world/Crosswalk';
import { Sidewalk } from '../world/Sidewalk';
import { Vec2 } from '../core/Vec2';
import { Rect } from '../core/Rect';
import type { CrossingDirection } from '../world/Crosswalk';

interface MapData {
    lanes: {
        id: string;
        points: { x: number, y: number }[];
        width: number;
        nextLanes: string[]; // IDs
    }[];
    intersections: {
        id: string;
        center: { x: number, y: number };
        lanes: string[];
        greenGroups?: string[][];
        greenGroupDirections?: CrossingDirection[];
        leftTurnGroups?: string[][];  // 각 greenGroup에 대응하는 좌회전 차선들
    }[];
    crosswalks?: {
        id: string;
        x: number; y: number; width: number; height: number;
        intersectionId: string;
        crossingDirection?: CrossingDirection;
    }[];
    sidewalks?: {
        id: string;
        points: { x: number, y: number }[];
        width: number;
        connectedCrosswalks?: string[];
    }[];
    markings?: {
        points: { x: number, y: number }[];
        style: 'solid' | 'dashed' | 'double-solid';
        color: 'white' | 'yellow';
        width: number;
    }[];
}

export class MapLoader {
    static load(world: World, data: MapData) {
        // Load Lanes
        for (const l of data.lanes) {
            const points = l.points.map(p => new Vec2(p.x, p.y));
            const lane = new Lane(l.id, points, l.width, 30, l.nextLanes);
            world.addLane(lane);
        }

        // Load Crosswalks
        const crosswalksByIntersection: Map<string, Crosswalk[]> = new Map();
        if (data.crosswalks) {
            for (const cwData of data.crosswalks) {
                const rect = new Rect(cwData.x, cwData.y, cwData.width, cwData.height);
                // Determine crossing direction: if width > height, it crosses a vertical (NS) road
                const crossingDirection: CrossingDirection = cwData.crossingDirection ||
                    (cwData.width > cwData.height ? 'NS' : 'EW');
                const cw = new Crosswalk(cwData.id, rect, cwData.intersectionId, undefined, crossingDirection);

                if (!crosswalksByIntersection.has(cwData.intersectionId)) {
                    crosswalksByIntersection.set(cwData.intersectionId, []);
                }
                crosswalksByIntersection.get(cwData.intersectionId)!.push(cw);

                world.crosswalks.set(cw.id, cw);
            }
        }

        // Load Intersections
        for (const i of data.intersections) {
            const center = new Vec2(i.center.x, i.center.y);
            // Get associated crosswalks
            const connectedCrosswalks = crosswalksByIntersection.get(i.id) || [];

            const intersection = new Intersection(i.id, center, i.lanes, connectedCrosswalks);
            world.intersections.set(i.id, intersection);

            // Set up traffic light groups
            if (i.greenGroups && i.greenGroups.length > 0) {
                // Use explicit green groups from map data
                intersection.greenGroups = i.greenGroups;
                intersection.greenGroupDirections = i.greenGroupDirections || [];

                // Load left turn groups if defined
                if (i.leftTurnGroups) {
                    intersection.leftTurnGroups = i.leftTurnGroups;
                } else {
                    // Auto-generate: inner lanes (_in suffix) as left turn lanes
                    intersection.leftTurnGroups = intersection.greenGroups.map(group =>
                        group.filter(laneId => laneId.endsWith('_in'))
                    );
                }
            } else if (i.lanes.length > 0) {
                // Auto-generate groups based on lane names
                // EW lanes: horizontal traffic (east-west direction)
                // - main_e*, main_w* (main horizontal roads)
                // - outer_north*, outer_south* (outer loop horizontal segments)
                const ewLanes = i.lanes.filter(id =>
                    id.includes('main_e') || id.includes('main_w') ||
                    id.includes('outer_north') || id.includes('outer_south'));

                // NS lanes: vertical traffic (north-south direction)
                // - northbound*, southbound* (vertical connectors)
                // - outer_east*, outer_west* (outer loop vertical segments)
                const nsLanes = i.lanes.filter(id =>
                    id.includes('northbound') || id.includes('southbound') ||
                    id.includes('outer_east') || id.includes('outer_west'));

                if (ewLanes.length > 0 && nsLanes.length > 0) {
                    intersection.greenGroups = [ewLanes, nsLanes];
                    intersection.greenGroupDirections = ['EW', 'NS'];
                    // 좌회전 차선: 내부 차선(_in)만 좌회전 가능
                    intersection.leftTurnGroups = [
                        ewLanes.filter(id => id.endsWith('_in')),
                        nsLanes.filter(id => id.endsWith('_in'))
                    ];
                } else if (ewLanes.length > 0) {
                    intersection.greenGroups = [ewLanes];
                    intersection.greenGroupDirections = ['EW'];
                    intersection.leftTurnGroups = [ewLanes.filter(id => id.endsWith('_in'))];
                } else if (nsLanes.length > 0) {
                    intersection.greenGroups = [nsLanes];
                    intersection.greenGroupDirections = ['NS'];
                    intersection.leftTurnGroups = [nsLanes.filter(id => id.endsWith('_in'))];
                } else {
                    // Fallback: split lanes in half with both directions
                    const half = Math.ceil(i.lanes.length / 2);
                    const group1 = i.lanes.slice(0, half);
                    const group2 = i.lanes.slice(half);
                    if (group2.length > 0) {
                        intersection.greenGroups = [group1, group2];
                        intersection.greenGroupDirections = ['EW', 'NS'];
                        intersection.leftTurnGroups = [
                            group1.filter(id => id.endsWith('_in')),
                            group2.filter(id => id.endsWith('_in'))
                        ];
                    } else {
                        intersection.greenGroups = [group1];
                        intersection.greenGroupDirections = ['EW'];
                        intersection.leftTurnGroups = [group1.filter(id => id.endsWith('_in'))];
                    }
                }
            }

            // 초기 신호 상태 설정
            intersection.initialize();
        }

        // Load Markings
        if (data.markings) {
            world.markings = data.markings;
        }

        // Load Sidewalks
        if (data.sidewalks) {
            for (const sw of data.sidewalks) {
                const points = sw.points.map(p => new Vec2(p.x, p.y));
                const sidewalk = new Sidewalk(sw.id, points, sw.width, sw.connectedCrosswalks || []);
                world.sidewalks.set(sw.id, sidewalk);
            }
        }
    }
}
