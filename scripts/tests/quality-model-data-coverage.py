import json,pathlib
base=pathlib.Path("public/analyst-overview/MDT")
evidence=pathlib.Path("public/quality-improvement/79840583bdb8e36221c2/evidence")
stats=[]
allpo=[]
for d in range(26,31):
 date=f"2026-10-{d}"
 a=json.loads((base/(date+".json")).read_text(encoding="utf8"))
 e=json.loads((evidence/(date+".json")).read_text(encoding="utf8"))
 accepted={r["callId"]:r for r in e["records"] if r.get("status")=="accepted" and r.get("mdtLinkStatus")=="unique"}
 pp=nn=p=n=0
 for c in a["calls"]:
  m=c.get("mos")
  if not isinstance(m,(int,float)) or not 1<=m<=5:continue
  poor=m<3
  key=c["id"] if c["id"].startswith(date+":") else date+":"+c["id"]
  if poor:
   p+=1;pp+=key in accepted
   if key in accepted:allpo.append((date,key,c,accepted[key]))
  else:
   n+=1;nn+=key in accepted
 stats.append(dict(date=date,accepted=len(accepted),poor=p,poorLocated=pp,normal=n,normalLocated=nn))
print(json.dumps(stats,ensure_ascii=False))
print("poor located",len(allpo),"coordinates unique",len(set((r["lat"],r["lon"]) for _,_,_,r in allpo)))
print("first 2",[(d,k,c.get("customerId"),c.get("startSecond"),r.get("observedAt")) for d,k,c,r in allpo[:2]])
