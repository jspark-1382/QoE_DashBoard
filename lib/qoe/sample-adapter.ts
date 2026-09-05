import type { QoeDataAdapter, QoeSnapshot } from './types';

const hours = Array.from({ length: 12 }, (_, i) => 12 + i);
const series = (pci: number) => hours.map((hour, index) => {
  const congested = hour >= 17 && hour <= 20;
  const offset = pci === 102 ? 0 : pci === 104 ? .35 : -.15;
  return {
    hour,
    qoe: +(4.05 - index * .14 - (congested ? .9 : 0) + (hour > 20 ? .9 : 0) + offset).toFixed(1),
    throughput: +(28 + Math.sin(index * .8) * 6 - (congested ? 14 : 0) + offset * 8).toFixed(1),
    load: Math.round(42 + index * 2 + (congested ? 28 : 0) - (hour > 20 ? 25 : 0)),
  };
});

export const sampleSnapshot: QoeSnapshot = {
  cells: [
    { pci:101,x:20,y:36,qoe:3.9,mos:4.0,rsrp:-91,sinr:11,load:54,users:83,cause:'coverage' },
    { pci:102,x:48,y:49,qoe:2.1,mos:2.1,rsrp:-86,sinr:16,load:78,users:127,cause:'capacity' },
    { pci:103,x:70,y:25,qoe:3.2,mos:3.3,rsrp:-95,sinr:8,load:64,users:94,cause:'interference' },
    { pci:104,x:82,y:63,qoe:3.7,mos:3.8,rsrp:-88,sinr:14,load:49,users:62,cause:'mobility' },
  ],
  services: [
    { key:'web',label:'Web',score:4.2,color:'#a8b4c8',hint:'페이지 로딩 안정' },
    { key:'video',label:'YouTube',score:2.8,color:'#ff274d',hint:'버퍼링 증가' },
    { key:'voice',label:'VoIP',score:3.6,color:'#377dea',hint:'통화품질 보통' },
    { key:'gaming',label:'Gaming',score:2.5,color:'#ad4ed9',hint:'지연시간 증가' },
  ],
  timeSeries: { 101:series(101),102:series(102),103:series(103),104:series(104) },
  rootCauses: [
    { key:'coverage',label:'Coverage 문제',rule:'RSRP 낮음',probability:38 },
    { key:'interference',label:'Interference 의심',rule:'RSRP 정상 + SINR 낮음',probability:54 },
    { key:'capacity',label:'Capacity 의심',rule:'Radio 정상 + Throughput 낮음',probability:87 },
    { key:'mobility',label:'Mobility / HO 문제',rule:'PCI 빈번 변경',probability:43 },
    { key:'core',label:'Core / App / Server 문제',rule:'Radio 정상 + MOS 낮음',probability:29 },
  ],
  journey: [
    {time:'10:01',location:'강남역',pci:101,rsrp:-82,sinr:18,mos:4.3,qoe:4.4,event:'-',x:10},
    {time:'10:02',location:'강남역',pci:101,rsrp:-91,sinr:11,mos:3.9,qoe:3.8,event:'-',x:30},
    {time:'10:03',location:'삼성역',pci:102,rsrp:-105,sinr:3,mos:2.7,qoe:2.5,event:'HO 발생',x:51},
    {time:'10:04',location:'삼성역',pci:102,rsrp:-110,sinr:1,mos:1.9,qoe:1.8,event:'품질 저하',x:73},
    {time:'10:05',location:'종합운동장',pci:103,rsrp:-95,sinr:8,mos:3.1,qoe:3.0,event:'-',x:93},
  ],
  voc: [
    {quote:'“유튜브 영상이 자주 끊겨요.”',meta:'20대 / 서울 송파구 / 오후 7시 23분',severity:'critical'},
    {quote:'“게임이 너무 렉 걸려요.”',meta:'10대 / 서울 잠실역 근처 / 오후 7시 35분',severity:'normal'},
    {quote:'“통화 중에 목소리가 끊겨요.”',meta:'30대 / 서울 삼성동 / 오후 7시 40분',severity:'normal'},
  ],
  recommendations: [
    {text:'PCI 102 셀 부하 현황 확인',selected:true},
    {text:'혼잡 시간대(18–20시) 용량 증설 검토',selected:true},
    {text:'인접 셀 간 부하 분산 (리밸런싱)',selected:false},
    {text:'특정 서비스(QoS) 트래픽 제어 검토',selected:false},
    {text:'지속 모니터링 및 재발 방지',selected:false},
  ],
};

export class SampleQoeAdapter implements QoeDataAdapter {
  readonly sourceName = 'MOS + PCI 샘플';
  async loadSnapshot() { return sampleSnapshot; }
}
