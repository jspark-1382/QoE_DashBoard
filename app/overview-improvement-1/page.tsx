import { redirect } from 'next/navigation';

/** Old experiment bookmarks open the existing quality overview. */
export default async function ImprovementBookmark({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}) {
  const params=await searchParams, query=new URLSearchParams();
  for(const [key,value] of Object.entries(params)) {
    if(key==='view'||key==='variant'||value===undefined)continue;
    for(const item of Array.isArray(value)?value:[value])query.append(key,item);
  }
  query.set('variant','improvement1');
  redirect('/?'+query.toString());
}
