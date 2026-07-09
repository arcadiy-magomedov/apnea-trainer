import type { MicrocycleTemplate } from '../models/types';
export interface IcsExporter {
  build(times: string[], template: MicrocycleTemplate, startDate: number): string;
}
