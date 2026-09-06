'use client';

import { CalendarDays, ChevronDown, MapPin, Radio, UserRoundSearch, Waves } from 'lucide-react';
import type { ExecutiveCustomer } from '@/lib/executive';

interface Props {
  customers: ExecutiveCustomer[];
  customerId: string;
  date: string;
  dates: string[];
  site: string;
  sites: string[];
  rat: string;
  rats: string[];
  onCustomerChange: (id: string) => void;
  onDateChange: (date: string) => void;
  onSiteChange: (site: string) => void;
  onRatChange: (rat: string) => void;
}

function FilterField({ label, icon, primary = false, children }: { label: string; icon: React.ReactNode; primary?: boolean; children: React.ReactNode }) {
  return <label className={`exec-filter ${primary ? 'primary' : ''}`}>
    <span className="exec-filter-icon">{icon}</span>
    <span className="exec-filter-copy"><small>{label}{primary && <em>주 필터</em>}</small>{children}</span>
    <ChevronDown className="exec-filter-chevron" />
  </label>;
}

export function ExecutiveFilters({ customers, customerId, date, dates, site, sites, rat, rats, onCustomerChange, onDateChange, onSiteChange, onRatChange }: Props) {
  const customer = customers.find(item => item.id === customerId);
  return <section className="exec-filter-bar" aria-label="고객 일자 분석 필터">
    <FilterField label="고객 선택" icon={<UserRoundSearch />} primary>
      <select aria-label="고객 선택" value={customerId} onChange={event => onCustomerChange(event.target.value)}>
        {customers.map(item => <option value={item.id} key={item.id}>{item.displayName}</option>)}
      </select>
      <b>{customer ? `${customer.displayName} · ${customer.maskedPhone}` : '데이터 없음'}</b>
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
      <b>MOS 실측 서비스</b>
    </FilterField>
    <FilterField label="RAT" icon={<Radio />}>
      <select aria-label="RAT" value={rat} onChange={event => onRatChange(event.target.value)}>
        <option value="ALL">전체 RAT</option>
        {rats.map(item => <option value={item} key={item}>{item === 'NR5G' ? '5G' : item}</option>)}
      </select>
      <b>{rat === 'ALL' ? 'LTE + 5G' : rat === 'NR5G' ? '5G' : rat}</b>
    </FilterField>
  </section>;
}
