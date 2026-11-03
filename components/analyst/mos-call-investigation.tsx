'use client';

import { useMemo } from 'react';
import Link from './document-link';
import type { AnalystCall, AnalystSample } from '../../lib/analyst/types';
import { evaluateCallEvidence } from '../../lib/mos/call-evidence';
import styles from './mos-call-investigation.module.css';

type Props = {call: AnalystCall; samples: AnalystSample[]};
const titles = {POOR:'불량',WARNING:'주의',GOOD:'양호',UNAVAILABLE:'미평가'};
const num = (v: number) => v.toLocaleString('ko-KR');

export function MosCallInvestigation({call, samples}: Props) {
  const result = useMemo(() => evaluateCallEvidence(call, samples), [call, samples]);
  return (
    <section className={styles.panel} aria-label="통화별 MOS 원인 근거 분석">
      <div className={styles.heading}>
        <div>
          <h3>통화별 MOS 원인 근거 분석</h3>
          <p>RTCP MOS(v5)와 SIP CDR 전송 지표, 연결된 MDT 무선 관측을 함께 확인합니다.</p>
        </div>
        <span className={[styles.grade, styles[result.grade.toLowerCase()]].join(' ')}>{titles[result.grade]}</span>
      </div>
      <div className={styles.topGrid}>
        <div className={styles.score}>
          <span>원본 RTCP MOS(v5)</span>
          <strong>{result.mos == null ? '—' : result.mos.toFixed(3)}</strong>
          <small>불량 &lt; 3.0 · 주의 &lt; 3.5 · 양호 ≥ 3.5</small>
        </div>
        <div className={styles.score}>
          <span>검토할 관측 항목</span>
          <strong>{num(result.countAttention)}<small> / {num(result.evidence.length)}</small></strong>
          <small>0 초과 손실 기록 / 무선 탐색 기준</small>
        </div>
        <div className={styles.score}>
          <span>MDT 관측 연결</span>
          <strong>{num(result.sampleCount)}<small>건</small></strong>
          <small>{result.matchingLabel}</small>
        </div>
      </div>
      <output className={styles.note}>
        <strong>{result.conclusion}</strong>
        <p>손실·지터 원본의 정확한 단위와 허용치는 검증 전입니다. RSRP −105 dBm, SINR 0 dB는 탐색용 임시 기준이며 통계적·인과적 결론이 아닙니다.</p>
      </output>
      <div className={styles.columns}>
        <div>
          <h4>CDR 전송 품질 지표</h4>
          <div className={styles.metrics}>
            {result.evidence.filter((row) => !['rsrp','sinr'].includes(row.key)).map((row) => (
              <div className={styles.metric} key={row.key}>
                <div><span>{row.label}</span><strong>{row.value}</strong></div>
                <small className={row.tone === 'attention' ? styles.attention : ''}>{row.description}</small>
              </div>
            ))}
          </div>
        </div>
        <div>
          <h4>MDT 무선품질 관측</h4>
          <div className={styles.metrics}>
            {result.evidence.filter((row) => ['rsrp','sinr'].includes(row.key)).map((row) => (
              <div className={styles.metric} key={row.key}>
                <div><span>{row.label}</span><strong>{row.value}</strong></div>
                <small className={row.tone === 'attention' ? styles.attention : ''}>{row.description}</small>
              </div>
            ))}
          </div>
          <p className={styles.radioNote}>
            {result.hasRadio
              ? '고객 통화 내 MDT 샘플의 최솟값을 계산했습니다. 기지국 연결은 고객번호·시각 단독 후보이며 최종 식별자 검증이 필요합니다.'
              : '연계할 수 있는 MDT 무선 샘플이 없어 MOS 저하와 무선 관측을 대조할 수 없습니다.'}
          </p>
          <Link className={styles.labLink} href="/mos-lab">MOS 모델 비교 연구 화면</Link>
        </div>
      </div>
    </section>
  );
}
