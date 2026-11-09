import type { AnalystOverview } from './types';

export type MosBand = 'poor' | 'fair' | 'good';
export interface ProposalBand {
  id: MosBand;
  label: string;
  count: number;
  percentage: number;
  color: string;
  range: string;
}
export interface ProposalHourly {
  hour: number;
  poor: number;
  fair: number;
  good: number;
  unavailable: number;
  evaluated: number;
  total: number;
}
export interface ProposalGradeStats {
  evaluated: number;
  unavailable: number;
  mean: number | null;
  bands: ProposalBand[];
  hours: ProposalHourly[];
}
function minute(value: string): number | null {
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) return null;
  const [h, m] = value.split(':').map(Number);
  return h * 60 + m;
}
export function calculateProposalGrades(
  overview: AnalystOverview,
  from: string,
  to: string,
): ProposalGradeStats {
  const start = minute(from);
  const end = minute(to);
  const counts = { poor: 0, fair: 0, good: 0 };
  const hours: ProposalHourly[] = Array.from({length:24}, (_,hour)=>({
    hour, poor:0, fair:0, good:0, unavailable:0, evaluated:0, total:0,
  }));
  let sum = 0, evaluated = 0, unavailable = 0;
  if (start !== null && end !== null && start <= end) {
    for (const call of overview.calls) {
      const callMinute = Math.floor(call.startSecond / 60);
      if (callMinute < start || callMinute > end) continue;
      const hour = hours[Math.floor(call.startSecond/3600)];
      if (!hour) continue;
      hour.total++;
      const mos = call.mos;
      if (typeof mos !== 'number' || !Number.isFinite(mos) || mos < 1 || mos > 5) {
        hour.unavailable++;
        unavailable++;
        continue;
      }
      const band: MosBand = mos < 3 ? 'poor' : mos < 3.5 ? 'fair' : 'good';
      counts[band]++;
      hour[band]++;
      hour.evaluated++;
      evaluated++;
      sum += mos;
    }
  }
  const make = (id: MosBand, label: string, range: string, color: string): ProposalBand => ({
    id,label,range,color,count:counts[id],percentage:evaluated?100*counts[id]/evaluated:0,
  });
  return {
    evaluated, unavailable, mean:evaluated?sum/evaluated:null,
    bands:[
      make('poor','불량','QoE < 3.0','#e35d64'),
      make('fair','보통','3.0 ≤ QoE < 3.5','#efa93b'),
      make('good','양호','QoE ≥ 3.5','#279d78'),
    ],
    hours,
  };
}
