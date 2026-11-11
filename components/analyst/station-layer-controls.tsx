'use client';
import type {StationLayerState} from './use-candidate-station-layer';
import styles from './station-layer-controls.module.css';
interface Props{layer:StationLayerState;shown:number;related:number}
export function StationLayerControls({layer,shown,related}:Props){
  const {options,setOptions,status,error}=layer;
  const update=(v:Partial<typeof options>)=>setOptions({...options,...v});
  return <div className={styles.controls} aria-label="기지국 표시 설정">
    <label>기지국 범위
      <select aria-label="기지국 표시 범위" value={options.range} onChange={e=>update({range:e.target.value as typeof options.range})}>
        <option value="inside">후보 원 내부</option><option value="near">주변 500m</option><option value="off">숨김</option>
      </select>
    </label>
    <label>통신 방식
      <select aria-label="기지국 통신 방식" value={options.rat} onChange={e=>update({rat:e.target.value as typeof options.rat})}>
        <option value="LTE">LTE</option><option value="NR">5G</option><option value="all">모두</option>
      </select>
    </label>
    <label className={styles.check}><input type="checkbox" checked={options.highlightRelated} onChange={e=>update({highlightRelated:e.target.checked})}/>선택 근사점의 측위 기지국 강조</label>
    <span className={styles.count} role="status" title={error??'같은 좌표의 등록 셀은 하나의 타워 아이콘으로 묶습니다.'}>
      {status==='off'?'기지국 숨김':status==='loading'?'인벤토리 불러오는 중':status==='error'?'기지국 자료 오류':`기지국 위치 ${shown.toLocaleString('ko-KR')}곳 · 측위 연계 ${related}곳`}
    </span>
  </div>;
}
