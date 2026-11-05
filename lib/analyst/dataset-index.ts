import type {AnalystDataset, SourceCustomer, SourceDay} from './types';

/** Build once per loaded dataset; maps reference the original records. */
export function indexDataset(dataset: AnalystDataset): {
  customersById: ReadonlyMap<string, SourceCustomer>;
  daysByCustomer: ReadonlyMap<string, ReadonlyMap<string, SourceDay>>;
} {
  const customersById=new Map<string,SourceCustomer>();
  const daysByCustomer=new Map<string,Map<string,SourceDay>>();
  // Keep Array.find's first-match behavior even for duplicate source metadata.
  for(const customer of dataset.customers)
    if(!customersById.has(customer.id))customersById.set(customer.id,customer);
  for(const day of dataset.days){
    let dates=daysByCustomer.get(day.customerId);
    if(!dates){dates=new Map();daysByCustomer.set(day.customerId,dates);}
    if(!dates.has(day.date))dates.set(day.date,day);
  }
  return {customersById,daysByCustomer};
}
