export type CalloutAnchor = {id:string; x:number; y:number; direction:string; width:number};
type Rect = {left:number; top:number; width:number; height:number};

/** Place labels in viewport pixels. Leaders keep every label tied to its actual
 * grid even when several adjacent 25m cells share a few pixels at low zoom. */
export function layoutCandidateCallouts(anchors: CalloutAnchor[], width:number, height:number,
    markers: {x:number;y:number}[] = [], obstacles: Rect[] = []) {
  const occupied = [...obstacles];
  const overlap = (a:Rect, b:Rect) => Math.max(0,Math.min(a.left+a.width,b.left+b.width)-Math.max(a.left,b.left))
    * Math.max(0,Math.min(a.top+a.height,b.top+b.height)-Math.max(a.top,b.top));
  return anchors.filter(p => p.x >= 0 && p.x < width && p.y >= 0 && p.y < height).map(p => {
    const w = Math.min(p.width, Math.max(1,width-12)), h = 26;
    const west = [-w-17,-h/2], east = [17,-h/2], north = [-w/2,-h-17], south = [-w/2,17];
    const preferred = p.direction === '북쪽' ? north : p.direction === '동쪽' ? east :
      p.direction === '남쪽' ? south : p.direction === '서쪽' ? west : [-w-19,17];
    const choices = [preferred, west, east, north, south, [-w-19,-h-16], [19,-h-16], [-w-19,16], [19,16]];
    // Try progressively larger offsets only if a nearby label would obscure
    // another label or numbered grid. Keep absolute distance as a tiebreaker.
    let best: Rect | undefined, bestCost = Infinity;
    for (const reach of [0,30,62,94]) {
      for (const [i,[dx,dy]] of choices.entries()) {
        const x = p.x + dx + Math.sign(dx+w/2)*reach, y = p.y + dy + Math.sign(dy+h/2)*reach;
        const rect = {left:Math.max(6,Math.min(width-w-6,x)),top:Math.max(6,Math.min(height-h-6,y)),width:w,height:h};
        const penalty = occupied.reduce((n,other)=>n+overlap(rect,other),0) * 100 +
          markers.reduce((n,m)=>n+overlap(rect,{left:m.x-9,top:m.y-9,width:18,height:18}),0)*3;
        const cost = penalty + reach + i*.35 + Math.abs(rect.left-x) + Math.abs(rect.top-y);
        if (cost < bestCost) {best = rect; bestCost = cost;}
      }
    }
    const rect = best!;
    occupied.push({left:rect.left-3,top:rect.top-3,width:w+6,height:h+6});
    const lineX = Math.max(rect.left, Math.min(rect.left+w,p.x));
    const lineY = Math.max(rect.top, Math.min(rect.top+h,p.y));
    return {...p,...rect,lineX,lineY};
  });
}
