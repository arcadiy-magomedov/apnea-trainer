import { describe, it, expect } from 'vitest';
import { generateMaxTable, generatePlanForDay } from './tableGenerator';

describe('generateMaxTable', () => {
  it('is a single open-ended round referencing max', () => {
    const plan = generateMaxTable(200);
    expect(plan.type).toBe('MAX');
    expect(plan.rounds).toHaveLength(1);
    expect(plan.rounds[0].targetHoldSec).toBe(200);
    expect(plan.rounds[0].restBeforeSec).toBe(0);
  });
});

describe('generatePlanForDay', () => {
  it('maps day types to plans and returns null for REST', () => {
    expect(generatePlanForDay('CO2', 200, 0)?.type).toBe('CO2');
    expect(generatePlanForDay('O2', 200, 0)?.type).toBe('O2');
    expect(generatePlanForDay('MAX', 200, 0)?.type).toBe('MAX');
    expect(generatePlanForDay('REST', 200, 0)).toBeNull();
  });
});
