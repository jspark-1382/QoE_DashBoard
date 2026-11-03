import type { AnalystCall, AnalystSample } from '../analyst/types';

export type MosGrade = 'POOR' | 'WARNING' | 'GOOD' | 'UNAVAILABLE';
export type EvidenceTone = 'observed' | 'attention' | 'unknown';
export type Evidence = {
  key: string;
  label: string;
  value: string;
  description: string;
  tone: EvidenceTone;
};

export function mosGrade(value: number | null | undefined): MosGrade {
  if (value == null || !Number.isFinite(value) || value < 1 || value > 5)
    return 'UNAVAILABLE';
  if (value < 3) return 'POOR';
  if (value < 3.5) return 'WARNING';
  return 'GOOD';
}

const shown = (v: number | null | undefined, decimals = 2) =>
  v == null || !Number.isFinite(v) ? '미제공' : Number(v.toFixed(decimals)).toLocaleString('ko-KR');

export function evaluateCallEvidence(call: AnalystCall, samples: AnalystSample[]) {
  const mos = call.mosV5Original ?? call.mos;
  const grade = mosGrade(mos);
  const rtp = call.rtp;
  const rows = samples.filter((s) => s.callId === call.id && s.inCallWindow);
  const matching = call.matchStatus === 'MATCHED';
  const enoughRadio = matching && rows.some((s) => s.rsrp != null || s.sinr != null);
  const evidence: Evidence[] = [];
  const add = (key: string, label: string, value: number | null | undefined, description: string, tone: EvidenceTone) => {
    evidence.push({ key, label, value: shown(value), description, tone: value == null ? 'unknown' : tone });
  };
  for (const [key, label, value] of [
    ['txJitter', 'Audio Tx Jitter', rtp?.txJitter],
    ['rxJitter', 'Audio Rx Jitter', rtp?.rxJitter],
  ] as const) {
    add(key, label, value, value == null ? 'CDR 기록 없음' : 'CDR 원본 수치 · 단위 및 허용 기준 미검증', 'observed');
  }
  for (const [key, label, value] of [
    ['txPacketLoss', 'Audio Tx Packet Loss', rtp?.txPacketLoss],
    ['rxPacketLoss', 'Audio Rx Packet Loss', rtp?.rxPacketLoss],
    ['txLossCount', 'RTP Tx Loss Count', rtp?.txLossCount],
    ['rxLossCount', 'RTP Rx Loss Count', rtp?.rxLossCount],
  ] as const) {
    add(key, label, value,
      value == null ? 'CDR 기록 없음' :
      value > 0 ? '0 초과 값 관측 · 단위 및 발생 구간 추가 확인 필요' : '0으로 기록됨',
      value != null && value > 0 ? 'attention' : 'observed');
  }
  const numeric = <K extends 'rsrp' | 'sinr'>(key: K) => rows.flatMap(
    (s) => s[key] == null ? [] : [s[key] as number],
  );
  const rsrp = enoughRadio ? numeric('rsrp') : [];
  const sinr = enoughRadio ? numeric('sinr') : [];
  const minRsrp = rsrp.length ? Math.min(...rsrp) : null;
  const minSinr = sinr.length ? Math.min(...sinr) : null;
  evidence.push({
    key: 'rsrp', label: '최저 RSRP', value: minRsrp == null ? '미제공' : shown(minRsrp) + ' dBm',
    description: minRsrp == null ? '검증된 연결 구간의 RSRP 관측 없음' :
      minRsrp <= -105 ? '탐색 기준 −105 dBm 이하 관측 · 저MOS 직접 원인 확정 불가' : '탐색 기준 −105 dBm 초과',
    tone: minRsrp == null ? 'unknown' : minRsrp <= -105 ? 'attention' : 'observed',
  }, {
    key: 'sinr', label: '최저 SINR', value: minSinr == null ? '미제공' : shown(minSinr) + ' dB',
    description: minSinr == null ? '검증된 연결 구간의 SINR 관측 없음' :
      minSinr <= 0 ? '탐색 기준 0 dB 이하 관측 · 저MOS 직접 원인 확정 불가' : '탐색 기준 0 dB 초과',
    tone: minSinr == null ? 'unknown' : minSinr <= 0 ? 'attention' : 'observed',
  });
  const countAttention = evidence.filter((item) => item.tone === 'attention').length;
  const matchingLabel = matching ? '계약·시각 단독 후보 (신원 확인 미완료)' :
    call.matchStatus === 'AMBIGUOUS' ? '복수 후보 · MDT 미연결' :
      'MDT 미매칭 · 무선 원인 보류';
  return {
    grade, mos, evidence, countAttention,
    sampleCount: matching ? rows.length : 0,
    matchingLabel,
    hasRadio: enoughRadio,
    // It is intentionally called 'observations', never a confirmed root cause.
    conclusion: grade === 'UNAVAILABLE'
      ? '원본 MOS가 없어 통화 품질 등급을 판정할 수 없습니다.'
      : countAttention > 0
        ? '추가 검토할 관측 근거가 있습니다. MOS 저하의 원인을 확정할 수는 없습니다.'
        : '현재 확보된 지표에서 주목할 관측이 확인되지 않았습니다. 원인 없음으로 해석하지 마세요.',
  };
}
