export type StageTone = 'blue' | 'ok' | 'warn' | 'bad' | 'muted' | 'info' | 'purple';

export const STAGES = ['pending', 'arrived', 'opd', 'admitted', 'procedure', 'discharged', 'lost'] as const;

/** Colour of a referral's stage pill. */
export function stageTone(status: string): StageTone {
  switch (status) {
    case 'arrived': case 'opd': return 'info';
    case 'admitted': case 'procedure': return 'purple';
    case 'discharged': return 'ok';
    case 'lost': return 'bad';
    default: return 'warn';
  }
}

/** Which of the 5 tracker steps (sent, arrived, OPD, admitted, discharged) a stage has reached. */
export function stageStep(status: string): number {
  switch (status) {
    case 'arrived': return 1;
    case 'opd': return 2;
    case 'admitted': case 'procedure': return 3;
    case 'discharged': return 4;
    default: return 0;
  }
}
