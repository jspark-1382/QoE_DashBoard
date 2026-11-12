import {SharedRequestCache} from './request-cache';

// Candidate artifacts are immutable within a source revision. Reuse only
// validated results, with bounded lifetime/entry count and independent aborts.
const resources=new SharedRequestCache<unknown>(24,60_000);
export function candidateResource<T>(key:string,loader:(signal:AbortSignal)=>Promise<T>,signal?:AbortSignal):Promise<T>{
  return resources.get(key,loader,signal) as Promise<T>;
}
