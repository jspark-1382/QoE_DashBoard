import {qualityCustomerSelectionIds,type QualityCustomerFilter,type QualityCustomerRow} from './quality-customer-picker';
import type {VoiceScope} from './server-query';

export interface ServerCustomerSelection {
  customerIds:string[];count:number;withoutCalls:number;
  totalCalls:number;poorCalls:number;locatedCalls:number;unlocatedCalls:number;
  single?:QualityCustomerRow|null;
}
export interface ServerCustomerPickerResult {
  sourceRevision:string;rows:QualityCustomerRow[];total:number;page:number;pages:number;
  selection?:ServerCustomerSelection;
}
/** This drawer always searches the base date/time population, independently of map filters. */
export function serverCustomerPickerRequest(scope:VoiceScope,query:string,filter:QualityCustomerFilter,page:number,
  selectedIds:readonly string[],selectedOnly:boolean) {
  return {scope:{dateStart:scope.dateStart,dateEnd:scope.dateEnd,from:scope.from,to:scope.to},
    query,filter,page,pageSize:25,selectedIds:qualityCustomerSelectionIds(selectedIds),selectedOnly};
}
