import type {CustomerQoeCall} from './customer-qoe-timeline';

export function customerQoeMapFocus(call:CustomerQoeCall|null) {
  const location=call?.location;
  if(!call||!location||!Number.isFinite(location.lat)||!Number.isFinite(location.lon)
    ||location.lat<33||location.lat>39||location.lon<124||location.lon>132
    ||!['gnss','bye-cell'].includes(location.evidence))return null;
  return {
    lat:location.lat,lon:location.lon,evidence:location.evidence,
    title:'그래프에서 선택한 통화',
    lines:[call.date+' '+call.start,
      'QoE '+(call.qoe===null?'미평가':call.qoe.toFixed(2))+(call.drop?' · SIP Drop':''),
      'BYE Cell '+(call.cell||'미확인'),
      location.evidence==='gnss'?'GPS 실측 위치':'BYE 기지국 참고 위치 · 단말 실측 위치 아님'],
  };
}
