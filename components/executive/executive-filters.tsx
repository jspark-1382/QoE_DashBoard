'use client';

import { useState } from 'react';
import { CalendarDays, ChevronDown, MapPin, Radio, UserRoundSearch, Waves } from 'lucide-react';
import type { ExecutiveCustomer } from '@/lib/executive';

interface Props {
  customers: ExecutiveCustomer[];
  customerId: string;
  date: string;
  dates: string[];
  site: string;
  sites: string[];
  source: '실측' | 'MDT';
  onSourceChange: (source: '실측' | 'MDT') => void;
  onCustomerChange: (id: string) => void;
  onDateChange: (date: string) => void;
  onSiteChange: (site: string) => void;
}

function FilterField({ label, icon, primary = false, children }: { label: string; icon: React.ReactNode; primary?: boolean; children: React.ReactNode }) {
  return <label className={`exec-filter ${primary ? 'primary' : ''}`}>
    <span className="exec-filter-icon">{icon}</span>
    <span className="exec-filter-copy"><small>{label}{primary && <em>주 필터</em>}</small>{children}</span>
    <ChevronDown className="exec-filter-chevron" />
  </label>;
}

export function ExecutiveFilters({ customers, customerId, date, dates, site, sites, source, onSourceChange, onCustomerChange, onDateChange, onSiteChange }: Props) {
  const customer = customers.find(item => item.id === customerId);
  const [gnssFirst, setGnssFirst] = useState(false);
  const hasGnss = customers.some(item => item.gnssSampleCount != null);
  const noCoord = (item: ExecutiveCustomer) => item.gnssSampleCount == null ? null : Math.round(100 * (1 - item.gnssSampleCount / Math.max(1, item.sampleCount)));
  const ordered = gnssFirst ? [...customers].sort((a, b) => (noCoord(a) ?? 101) - (noCoord(b) ?? 101)) : customers;
  return <section className="exec-filter-bar" aria-label="고객 일자 분석 필터">
    <FilterField label="고객 선택" icon={<UserRoundSearch />} primary>
      <select aria-label="고객 선택" value={customerId} onChange={event => onCustomerChange(event.target.value)}>
        {ordered.map(item => <option value={item.id} key={item.id}>{item.displayName}{noCoord(item) == null ? '' : ` · 좌표 없음 ${noCoord(item)}%`}</option>)}
      </select>
      <b>{customer ? `${customer.displayName} · ${customer.maskedPhone}${noCoord(customer) == null ? '' : ` · 좌표 없음 ${noCoord(customer)}%`}` : '데이터 없음'}{hasGnss && <button type="button" onMouseDown={event => event.preventDefault()} onClick={event => { event.preventDefault(); setGnssFirst(value => !value); }} style={{ marginLeft: 6, border: '1px solid #2f76c8', borderRadius: 4, background: gnssFirst ? '#276ebd' : 'transparent', color: gnssFirst ? '#fff' : '#79aef9', fontSize: 6, padding: '1px 4px' }}>좌표 많은 순</button>}</b>
    </FilterField>
    <FilterField label="일자 선택" icon={<CalendarDays />} primary>
      <select aria-label="일자 선택" value={date} onChange={event => onDateChange(event.target.value)}>
        {dates.map(item => <option value={item} key={item}>{item}</option>)}
      </select>
      <b>{customer?.dates.includes(date) ? '측정 데이터 있음' : '해당 고객 데이터 없음'}</b>
    </FilterField>
    <FilterField label="지역/사이트" icon={<MapPin />}>
      <select aria-label="지역 또는 사이트" value={site} onChange={event => onSiteChange(event.target.value)}>
        <option value="ALL">전체 지역</option>
        {sites.map(item => <option value={item} key={item}>{item}</option>)}
      </select>
      <b>{site === 'ALL' ? '선택 일자 전체' : site}</b>
    </FilterField>
    <FilterField label="서비스" icon={<Waves />}>
      <select aria-label="서비스" value="Voice" disabled><option>Voice</option></select>
      <b>{source === 'MDT' ? 'MDT 통화 기록 · MOS 없음' : 'MOS 실측 서비스'}</b>
    </FilterField>
    <FilterField label="데이터 구분" icon={<Radio />}>
      <select aria-label="MDT 또는 실측" value={source} onChange={event => onSourceChange(event.target.value as '실측' | 'MDT')}>
        <option value="실측">실측</option><option value="MDT">MDT</option>
      </select>
      <b>{source === 'MDT' ? 'MDT 이벤트 기반' : '단말 실측 데이터'}</b>
    </FilterField>
  </section>;
}
