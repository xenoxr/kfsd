
export interface Marking {
    points: { x: number, y: number }[];
    style: 'solid' | 'dashed' | 'double-solid';
    color: 'white' | 'yellow';
    width: number;
}
