import { Lane } from './Lane';

export class Road {
    constructor(
        public id: string,
        public lanes: Lane[]
    ) { }
}
