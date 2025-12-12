import { World } from '../world/World';
import { Vehicle } from '../entities/Vehicle';
import { Vec2 } from '../core/Vec2';

export class Renderer {
    public canvas: HTMLCanvasElement;
    public ctx: CanvasRenderingContext2D;
    public cameraPos: Vec2 = new Vec2(0, 0);
    public zoom: number = 1.0;

    constructor(canvasId: string) {
        this.canvas = document.getElementById(canvasId) as HTMLCanvasElement;
        if (!this.canvas) {
            throw new Error(`Canvas ${canvasId} not found`);
        }
        this.ctx = this.canvas.getContext('2d')!;
        this.resize();
        window.addEventListener('resize', () => this.resize());
    }

    resize() {
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
    }

    render(world: World, target?: { pos: Vec2 }) {
        if (target) {
            // Smoothly follow target? For now, hard lock.
            this.cameraPos = target.pos;
        }

        const ctx = this.ctx;
        ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        ctx.save();
        // Camera Transform
        ctx.translate(this.canvas.width / 2, this.canvas.height / 2);
        ctx.scale(this.zoom, this.zoom);
        ctx.translate(-this.cameraPos.x, -this.cameraPos.y);

        // Draw Sidewalks (before roads so they appear behind)
        for (const sidewalk of world.sidewalks.values()) {
            ctx.beginPath();
            ctx.strokeStyle = '#C4A77D'; // Tan/beige color for sidewalk
            ctx.lineWidth = sidewalk.width;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';

            if (sidewalk.points.length > 0) {
                ctx.moveTo(sidewalk.points[0].x, sidewalk.points[0].y);
                for (let i = 1; i < sidewalk.points.length; i++) {
                    ctx.lineTo(sidewalk.points[i].x, sidewalk.points[i].y);
                }
            }
            ctx.stroke();
        }

        // Draw Lanes
        ctx.lineWidth = 1;
        for (const lane of world.lanes.values()) {
            // Draw road surface
            ctx.beginPath();
            ctx.strokeStyle = '#555';
            ctx.lineWidth = lane.width;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';

            if (lane.points.length > 0) {
                ctx.moveTo(lane.points[0].x, lane.points[0].y);
                for (let i = 1; i < lane.points.length; i++) {
                    ctx.lineTo(lane.points[i].x, lane.points[i].y);
                }
            }
            ctx.stroke();

            // Draw center/lane markings - REMOVED per user feedback (was drawing in center of lane)
            // We now rely on 'markings' layer for all lines.
            /*
            ctx.beginPath();
            ctx.strokeStyle = '#BBB'; // White dashed
            ctx.lineWidth = 2;
            ctx.setLineDash([10, 10]);

            if (lane.points.length > 0) {
                ctx.moveTo(lane.points[0].x, lane.points[0].y);
                for (let i = 1; i < lane.points.length; i++) {
                    ctx.lineTo(lane.points[i].x, lane.points[i].y);
                }
            }
            ctx.stroke();
            ctx.setLineDash([]);
            */
        }

        // Draw Custom Markings
        if (world.markings) {
            for (const marking of world.markings) {
                ctx.beginPath();
                ctx.lineWidth = marking.width;
                ctx.lineCap = 'butt';
                ctx.lineJoin = 'round';
                ctx.strokeStyle = marking.color === 'yellow' ? '#FFD700' : '#FFF';

                if (marking.style === 'dashed') {
                    ctx.setLineDash([15, 15]);
                } else {
                    ctx.setLineDash([]);
                }

                if (marking.points.length > 0) {
                    ctx.moveTo(marking.points[0].x, marking.points[0].y);
                    for (let i = 1; i < marking.points.length; i++) {
                        ctx.lineTo(marking.points[i].x, marking.points[i].y);
                    }
                    ctx.stroke();

                    if (marking.style === 'double-solid') {
                        // Simple double line effect: draw a thinner black line in the middle?
                        // Or just draw the yellow line.
                        // Let's implement a simple offset if we can, but without normals it's hard.
                        // For now, single thick yellow line.
                    }
                }
                ctx.setLineDash([]);
            }
        }

        // Draw Crosswalks
        for (const cw of world.crosswalks.values()) {
            const r = cw.area;

            // Draw stripes based on orientation
            ctx.fillStyle = '#EEEEEE'; // White stripes - set for each crosswalk
            const stripeWidth = 4;
            const gap = 6;

            if (r.width > r.height) {
                // Horizontal Crosswalk (crossing vertical road) -> Vertical Stripes
                for (let x = r.x - r.width / 2; x < r.x + r.width / 2; x += (stripeWidth + gap)) {
                    ctx.fillRect(x, r.y - r.height / 2, stripeWidth, r.height);
                }
            } else {
                // Vertical Crosswalk (crossing horizontal road) -> Horizontal Stripes
                for (let y = r.y - r.height / 2; y < r.y + r.height / 2; y += (stripeWidth + gap)) {
                    ctx.fillRect(r.x - r.width / 2, y, r.width, stripeWidth);
                }
            }

            // Draw pedestrian signal indicators on BOTH ends of crosswalk
            const signalSize = 10;
            const signalPositions: { x: number, y: number }[] = [];

            if (r.width > r.height) {
                // Horizontal crosswalk: signals at left and right sides
                signalPositions.push({ x: r.x - r.width / 2 - 12, y: r.y });
                signalPositions.push({ x: r.x + r.width / 2 + 12, y: r.y });
            } else {
                // Vertical crosswalk: signals at top and bottom
                signalPositions.push({ x: r.x, y: r.y - r.height / 2 - 12 });
                signalPositions.push({ x: r.x, y: r.y + r.height / 2 + 12 });
            }

            for (const pos of signalPositions) {
                // Draw signal background (dark box)
                ctx.fillStyle = '#222';
                ctx.fillRect(pos.x - signalSize / 2 - 2, pos.y - signalSize / 2 - 2, signalSize + 4, signalSize + 4);

                // Draw signal light
                if (cw.signal === 'WALK') {
                    ctx.fillStyle = '#00FF00'; // Green for WALK
                } else {
                    ctx.fillStyle = '#FF0000'; // Red for STOP
                }
                ctx.beginPath();
                ctx.arc(pos.x, pos.y, signalSize / 2, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        // Draw Intersections (Traffic Lights)
        for (const intersection of world.intersections.values()) {
            const center = intersection.center;

            // Draw Light Dots per connected lane?
            // Simplified: Draw one big light at center for debug
            /*
            ctx.fillStyle = intersection.state === 'Green' ? '#0F0' : 
                            intersection.state === 'Red' ? '#F00' : '#FF0';
            ctx.beginPath();
            ctx.arc(center.x, center.y, 10, 0, Math.PI * 2);
            ctx.fill();
            */

            // Better: Draw colored lines at lane ends
            for (const [laneId, state] of intersection.trafficLights) {
                const lane = world.getLane(laneId);
                if (lane) {
                    // Draw light at end of lane
                    const end = lane.points[lane.points.length - 1];

                    // LEFT_ARROW (state === 3) - 좌회전 화살표 신호
                    if (state === 3) {
                        // 화살표 배경 (검정 원)
                        ctx.fillStyle = '#000';
                        ctx.beginPath();
                        ctx.arc(end.x, end.y, 10, 0, Math.PI * 2);
                        ctx.fill();

                        // 녹색 좌회전 화살표 그리기
                        ctx.save();
                        ctx.translate(end.x, end.y);

                        // 차선 방향 계산 (마지막 두 점 사용)
                        let laneAngle = 0;
                        if (lane.points.length >= 2) {
                            const prev = lane.points[lane.points.length - 2];
                            laneAngle = Math.atan2(end.y - prev.y, end.x - prev.x);
                        }
                        ctx.rotate(laneAngle);

                        // 화살표 그리기 (왼쪽 방향)
                        ctx.strokeStyle = '#00FF00';
                        ctx.fillStyle = '#00FF00';
                        ctx.lineWidth = 2;

                        // 화살표 몸체 (살짝 굽은 선)
                        ctx.beginPath();
                        ctx.moveTo(4, 0);    // 시작점 (오른쪽)
                        ctx.quadraticCurveTo(-2, 0, -4, -5); // 왼쪽 위로 곡선
                        ctx.stroke();

                        // 화살표 머리 (삼각형)
                        ctx.beginPath();
                        ctx.moveTo(-4, -5);  // 화살표 끝점
                        ctx.lineTo(-7, -2);  // 왼쪽 아래
                        ctx.lineTo(-1, -3);  // 오른쪽
                        ctx.closePath();
                        ctx.fill();

                        ctx.restore();
                    } else {
                        // 일반 신호등 (원형)
                        ctx.fillStyle = state === 0 ? '#F00' : state === 1 ? '#0F0' : '#FF0';
                        ctx.beginPath();
                        ctx.arc(end.x, end.y, 8, 0, Math.PI * 2);
                        ctx.fill();
                    }
                }
            }
        }

        // Draw Vehicles
        for (const veh of world.vehicles) {
            ctx.save();
            ctx.translate(veh.pos.x, veh.pos.y);
            ctx.rotate(veh.heading);

            ctx.fillStyle = 'blue';
            // if (target && veh === target.pos) {/* Hack check if it's the target vehicle? */ }
            // Better: Check ID or passing flag. 
            // Since we don't have IDs on entities in render easily, let's use the 'target' param passed to render!
            // Wait, target object is {pos: Vec2}, not the entity itself.
            // Let's rely on checking if it's the camera target (usually ego)

            if (target && veh.pos === target.pos) { // Object reference equality might fail if target is a copy, but Main passes reference.
                ctx.fillStyle = '#00FF00'; // Green for Ego
            } else if (veh.maxSpeed > 220) {
                ctx.fillStyle = 'orange'; // bike
            } else {
                ctx.fillStyle = 'blue'; // NPC
            }

            ctx.fillRect(-veh.width / 2, -veh.height / 2, veh.width, veh.height);

            // Headlights / Direction
            ctx.fillStyle = 'yellow';
            ctx.fillRect(veh.width / 2 - 2, -veh.height / 2 + 2, 2, 5);
            ctx.fillRect(veh.width / 2 - 2, veh.height / 2 - 7, 2, 5);

            ctx.restore();
        }

        // Draw Pedestrians
        ctx.fillStyle = 'magenta';
        for (const ped of world.pedestrians) {
            ctx.beginPath();
            ctx.arc(ped.pos.x, ped.pos.y, 5, 0, Math.PI * 2);
            ctx.fill();
        }

        ctx.restore();
    }
}
