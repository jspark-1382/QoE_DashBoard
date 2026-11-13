'use client';

import {useEffect, useState} from 'react';
import type {CandidateAnalysisJob} from '../../lib/analyst/candidate-ai-analysis';
import type {CandidateCallInsight} from '../../lib/analyst/candidate-call-insight';
import type {CandidateCallObservations} from '../../lib/analyst/candidate-call-pot-relation';
import {SharedRequestCache} from '../../lib/analyst/request-cache';
import {voiceQuery} from '../../lib/analyst/server-query';

const cache = new SharedRequestCache<CandidateCallObservations>(16, 120_000);
type ObservationState = {status:'loading' | 'available' | 'unavailable'; observations?: CandidateCallObservations};

/** Load only the selected original call, and exclude a prior call's measurements while switching. */
export function useCandidateCallObservations(job?: CandidateAnalysisJob | null, insight?: CandidateCallInsight | null): ObservationState {
  const sourceRevision = job?.evidence?.sourceRevision;
  const callId = insight?.call.id;
  const callDate = insight?.call.date;
  const key = sourceRevision && callId && callDate ? JSON.stringify([sourceRevision,callId,callDate]) : '';
  const [result,setResult] = useState<(ObservationState & {key:string}) | null>(null);
  useEffect(() => {
    if (!key || !callDate || !callId || !sourceRevision) return;
    const controller = new AbortController();
    cache.get(key, async signal => {
      const data = await voiceQuery<CandidateCallObservations>('call-observations',{sourceRevision,callId,callDate},signal);
      if (data.callId !== callId || data.callDate !== callDate || !Array.isArray(data.samples)) throw new Error('원본 통화 확인 실패');
      return data;
    },controller.signal).then(observations => {
      if (!controller.signal.aborted) setResult({key,status:'available',observations});
    }).catch(() => {
      if (!controller.signal.aborted) setResult({key,status:'unavailable'});
    });
    return () => controller.abort();
  },[key,sourceRevision,callId,callDate]);
  if (!key) return {status:'unavailable'};
  return result?.key === key ? result : {status:'loading'};
}
