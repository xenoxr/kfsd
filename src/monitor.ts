
import { WebSocketServer } from 'ws';

const wss = new WebSocketServer({ port: 8081 });

console.log('Waiting for simulation to connect on ws://localhost:8081...');

wss.on('connection', ws => {
    console.log('Simulation Connected!');

    ws.on('message', message => {
        try {
            const data = JSON.parse(message.toString());
            if (data.type === 'status') {
                logStatus(data.payload);
            }
        } catch (e) {
            console.error('Invalid message:', e);
        }
    });

    ws.on('close', () => {
        console.log('Simulation Disconnected');
    });
});

const globalEventLog: string[] = [];
function logStatus(payload: any) {
    const { time, vehicles, fps, events } = payload;

    // Append new events
    if (events && events.length > 0) {
        // Add timestamp to events
        const timestamped = events.map((e: string) => `[${time.toFixed(1)}s] ${e}`);
        globalEventLog.push(...timestamped);
        // Keep last 20
        while (globalEventLog.length > 20) globalEventLog.shift();
    }

    // Clear console for fresh update (optional)
    console.clear();
    console.log(`=== LIVE SIMULATION | Time: ${time.toFixed(1)}s | FPS: ${fps} ===`);

    // Convert generic object to table format
    const tableData = vehicles.map((v: any) => ({
        ID: v.id,
        Lane: v.lane,
        Speed: v.speed,
        Heading: v.heading,
        Action: v.action
    }));

    console.table(tableData);

    console.log('\n=== EVENT HISTORY ===');
    if (globalEventLog.length === 0) {
        console.log('(No critical events yet)');
    } else {
        globalEventLog.forEach(log => console.log(log));
    }
}
