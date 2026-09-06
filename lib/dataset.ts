export type DatasetMetric = 'qoe' | 'rsrp' | 'rsrq' | 'sinr' | 'mos';
export type RatFilter = 'ALL' | 'LTE' | 'NR5G';

export interface LocationSummary { name: string; samples: number }
export interface HeatPoint { lat:number;lon:number;pci:number;count:number;rat:'LTE'|'NR5G';location:string;qoe:number|null;rsrp:number|null;rsrq:number|null;sinr:number|null;mos:number|null }
export interface PciSummary { rat:'LTE'|'NR5G';pci:number;samples:number;mosSamples:number;location:string;lat:number;lon:number;qoe:number;rsrp:number|null;rsrq:number|null;sinr:number|null;mos:number|null;poorRate:number }
export interface HourPoint { hour:number;samples:number;qoe:number;rsrp:number|null;sinr:number|null;mos:number|null }
export interface JourneySample { time:string;location:string;lat:number;lon:number;rat:'LTE'|'NR5G';pci:number;rsrp:number|null;rsrq:number|null;sinr:number|null;mos:number|null;qoe:number;cause:string }
export interface ServiceEstimate { key:string;label:string;score:number;basis:string }

export interface QoeDataset {
  meta:{source:string;sheet:string;totalRows:number;validGeoRows:number;measurementDate:string;locations:LocationSummary[];center:{lat:number;lon:number};ratCounts:Record<string,number>;mosSamples:number};
  kpis:{overallQoe:number;averageRsrp:number;averageSinr:number;averageMos:number|null;poorSamples:number;uniquePci:number;causeCounts:Record<string,number>};
  services:ServiceEstimate[];
  heatPoints:HeatPoint[];
  pciSummary:PciSummary[];
  hourly:HourPoint[];
  journey:JourneySample[];
}
