import {summarizeCandidateTopTenCoverage,type CandidateTopTenCustomer,type CandidateTopTenMatch,type CandidateTopTenMember} from '../../lib/analyst/candidate-top-ten';
import styles from './candidate-top-ten-members.module.css';

export function CandidateTopTenMembers({customers}:{customers:readonly CandidateTopTenMember[]}){
 return <span className={styles.members} aria-label="포함된 TOP10 고객">
  {customers.length?customers.map(customer=><span className={styles.member} data-inclusion={customer.memberCalls>0?'calls':'range'} key={customer.id}
   data-top-customer-id={customer.id} data-top-customer-rank={customer.rank}
   data-top-customer-member-calls={customer.memberCalls} data-top-customer-within-range={customer.withinRange?'true':'false'}
   title={customer.memberCalls>0?'후보 구성 통화가 있는 고객':'고객현황 대표 위치가 후보 원 안에 있어 포함한 고객'}>
   TOP {customer.rank} · {customer.number} · {customer.memberCalls>0?`후보 통화 ${customer.memberCalls}건`:'원 범위 내'}
  </span>):<span className={styles.emptyMember}>TOP10 고객 미포함</span>}
 </span>;
}

export function CandidateTopTenCoverage({customers,matches}:{customers:readonly CandidateTopTenCustomer[];matches:readonly CandidateTopTenMatch[]}){
 const {included,unmatched}=summarizeCandidateTopTenCoverage(customers,matches);
 const regionIds=new Set(matches.filter(match=>match.customers.length).map(match=>match.candidateId));
 return <section className={styles.coverage} aria-label="TOP10 고객 포함 현황">
  <output className={styles.summary}>후보 지역 {regionIds.size}곳 · TOP10 고객 {customers.length}명 중 {included.length}명 포함 · {unmatched.length}명 미포함</output>
 </section>;
}
