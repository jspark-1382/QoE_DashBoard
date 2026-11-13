export interface ConsecutiveBlock {
  timestamp:number|null;
  total:number;
  poor:number;
}

/** Classify adjacency across every possible order within equal start times.
 * Healthy and unscored calls both break a run. Multiplicity is preserved;
 * grouping equal timestamps never merges distinct source call records.
 */
export function classifyConsecutiveBlocks(input:readonly ConsecutiveBlock[]):boolean|null {
  const grouped=new Map<number,{total:number;poor:number}>();
  let total=0,poor=0,unknownTime=false;
  for(const block of input){
    if(!Number.isSafeInteger(block.total)||!Number.isSafeInteger(block.poor)||
       block.total<0||block.poor<0||block.poor>block.total)
      throw new RangeError('Invalid consecutive-call block counts');
    if(!block.total)continue;
    total+=block.total;poor+=block.poor;
    if(block.timestamp===null||!Number.isFinite(block.timestamp)){
      unknownTime=true;
      continue;
    }
    const value=grouped.get(block.timestamp)??{total:0,poor:0};
    value.total+=block.total;value.poor+=block.poor;grouped.set(block.timestamp,value);
  }
  if(poor<2)return false;
  // Even arbitrary chronology cannot separate all poor calls with too few breakers.
  if(poor>total-poor+1)return true;
  if(unknownTime)return null;

  let previousCanBePoor=false,possibleRun=false;
  // Possible last values for arrangements that have not contained a run:
  // bit 1 = nonpoor, bit 2 = poor. Start with a nonpoor sentinel.
  let noRunEnds=1;
  for(const [,block] of [...grouped].sort(([a],[b])=>a-b)){
    const p=block.poor,b=block.total-p;
    possibleRun=possibleRun||p>=2||(previousCanBePoor&&p>0);
    previousCanBePoor=p>0;
    let nextEnds=0;
    for(let first=0;first<=1;first++)for(let last=0;last<=1;last++){
      // A poor first value requires a nonpoor end in the preceding block.
      if(first&&!(noRunEnds&1))continue;
      let feasible:boolean;
      if(block.total===1)feasible=first===last&&first===(p?1:0);
      else if(!b)feasible=false;
      else{
        // Nonpoor calls provide b+1 isolated poor slots. Chosen nonpoor
        // endpoints close their outer slots; poor endpoints occupy theirs.
        feasible=first+last<=p&&p<=b-1+first+last;
      }
      if(feasible)nextEnds|=1<<last;
    }
    noRunEnds=nextEnds;
    if(!noRunEnds)return true;
  }
  return possibleRun?null:false;
}
