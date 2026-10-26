'use client';

import { UsersRound, Repeat2, PhoneOff } from 'lucide-react';
import type {
  OverviewAnalytics,
  ExperienceGroup,
} from '../../lib/analyst/overview-analytics';
import styles from './customer-experience.module.css';

interface Props {
  analytics: OverviewAnalytics;
  selectedGroup: ExperienceGroup | null;
  onGroupSelect: (group: ExperienceGroup | null) => void;
}
const appearances = {
  affected: {
    label: '저품질 경험 계약',
    icon: UsersRound,
    color: '#a344d4',
    background: '#f6eafa',
    subtitle: '1회 이상',
  },
  repeat: {
    label: '반복 불량 계약',
    icon: Repeat2,
    color: '#ee9636',
    background: '#fff3e4',
    subtitle: '2회 이상',
  },
  consecutive: {
    label: '연속 불량 계약',
    icon: PhoneOff,
    color: '#e65a69',
    background: '#fdecef',
    subtitle: '2회 이상 연속',
  },
};

export function CustomerExperience({
  analytics,
  selectedGroup,
  onGroupSelect,
}: Props) {
  return (
    <section className={styles.panel} aria-label="고객 체감 품질">
      <header className={styles.heading}>
        <h3>고객 체감 품질</h3>
        <span>고유 계약 기준</span>
      </header>
      <div className={styles.tiles}>
        {analytics.experience.map((group) => {
          const appearance = appearances[group.id];
          const Icon = appearance.icon;
          const maximum = Math.max(1, ...(group.hourly ?? []));
          const available = group.count !== null;
          const value = available
            ? `${group.count!.toLocaleString('ko-KR')}계약`
            : '미제공';
          const rate =
            group.percent === null ? '—' : `${group.percent.toFixed(1)}%`;
          return (
            <button
              key={group.id}
              type="button"
              className={styles.tile}
              data-experience-group={group.id}
              aria-label={`${appearance.label} (${appearance.subtitle}), ${value}, ${rate}${available ? ', 조사 조건 선택' : ', 통화 순서 확인 필요'}`}
              aria-pressed={selectedGroup === group.id}
              disabled={!available}
              title={
                available
                  ? `${group.total.toLocaleString('ko-KR')}개 계약 중 ${value} · 시간 내 조건 충족 계약 수 (시간 간 중복 가능)`
                  : '정확한 통화 순서를 확인할 수 없어 연속 불량을 집계하지 않습니다.'
              }
              onClick={() =>
                onGroupSelect(selectedGroup === group.id ? null : group.id)
              }
            >
              <span
                className={styles.icon}
                style={{
                  color: appearance.color,
                  backgroundColor: appearance.background,
                }}
              >
                <Icon size={19} strokeWidth={2.2} aria-hidden="true" />
              </span>
              <span className={styles.details}>
                <span className={styles.label}>
                  {appearance.label} <small>({appearance.subtitle})</small>
                </span>
                <span className={styles.value}>
                  {value}
                  <small>{rate}</small>
                </span>
              </span>
              {group.hourly !== null && available ? (
                <svg
                  className={styles.spark}
                  data-hourly-series={group.id}
                  viewBox="0 0 96 32"
                  preserveAspectRatio="none"
                  aria-label={`${group.label}, 00시부터 23시 시간 내 조건 충족 계약 수`}
                >
                  <title>{`${group.label}, 00시부터 23시 시간 내 조건 충족 계약 수`}</title>
                  {group.hourly.map((amount, hour) => {
                    const height = (amount / maximum) * 29;
                    return (
                      <rect
                        key={hour}
                        x={hour * 4 + 0.5}
                        y={31 - height}
                        width="3"
                        height={height}
                        fill={appearance.color}
                        opacity={amount === maximum ? 1 : 0.65}
                      >
                        <title>{`${String(hour).padStart(2, '0')}시 · ${amount.toLocaleString('ko-KR')}계약 · 시간 내 조건 충족`}</title>
                      </rect>
                    );
                  })}
                  <path
                    d="M0 31.5H96"
                    stroke={appearance.color}
                    strokeOpacity=".2"
                  />
                </svg>
              ) : (
                <span className={styles.unavailable}>
                  {available ? '시각 확인 필요' : '순서 확인 필요'}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <p className={styles.note}>집단 간 중복 · 미니 막대: 시간 내 집계</p>
    </section>
  );
}
