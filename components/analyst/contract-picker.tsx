'use client';
/* oxlint-disable jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions -- Native dialog owns Escape and focus containment; this handler only detects pointer clicks on its backdrop. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { contractPage } from '../../lib/analyst/contract-picker';
import type {
  AnalystDataset,
  AnalystSource,
  SourceCustomer,
} from '../../lib/analyst/types';
import styles from './contract-picker.module.css';
interface Props {
  dataset: AnalystDataset;
  source: AnalystSource;
  date: string;
  selectedId: string | null;
  onSelect: (customer: SourceCustomer) => void;
}
const count = (value: number | undefined) =>
  value === undefined ? '미제공' : value.toLocaleString();
export function ContractPicker({
  dataset,
  source,
  date,
  selectedId,
  onSelect,
}: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [query, setQuery] = useState('');
  const [missingGnss, setMissingGnss] = useState(false);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState<25 | 50>(25);
  const result = useMemo(
    () =>
      contractPage(
        dataset,
        date,
        query,
        source === 'MDT' && missingGnss,
        page,
        pageSize,
      ),
    [dataset, date, query, source, missingGnss, page, pageSize],
  );
  const close = () => {
    dialog.current?.close();
  };
  // A source/date replacement must never leave an old selection list active.
  useEffect(() => {
    dialog.current?.close();
  }, [source, date, dataset]);
  return (
    <>
      <button
        ref={trigger}
        aria-label="계약 목록 / 계약 선택"
        className={styles.trigger}
        onClick={() => {
          setQuery('');
          setMissingGnss(false);
          setPage(0);
          dialog.current?.showModal();
        }}
      >
        계약 목록
      </button>
      <dialog
        ref={dialog}
        className={styles.dialog}
        aria-labelledby="contract-picker-title"
        onClose={() => trigger.current?.focus()}
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            const bounds = event.currentTarget.getBoundingClientRect();
            if (
              event.clientX < bounds.left ||
              event.clientX > bounds.right ||
              event.clientY < bounds.top ||
              event.clientY > bounds.bottom
            )
              close();
          }
        }}
      >
        <div className={styles.header}>
          <h2 id="contract-picker-title">계약 선택</h2>
          <button onClick={close} aria-label="계약 목록 닫기">
            닫기
          </button>
        </div>
        <p>
          {source} · {date} · 해당 일자의 계약 목록
        </p>
        <label className={styles.search}>
          계약번호 / 고객 검색
          <input
            autoFocus
            value={query}
            placeholder="전체 목록 또는 원본 번호 일부 입력"
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(0);
            }}
          />
        </label>
        <div className={styles.filters}>
          {source === 'MDT' && (
            <label>
              <input
                type="checkbox"
                checked={missingGnss}
                onChange={(event) => {
                  setMissingGnss(event.target.checked);
                  setPage(0);
                }}
              />{' '}
              GNSS 없는 계약만 (0건 확인)
            </label>
          )}
          <label>
            페이지당{' '}
            <select
              value={pageSize}
              onChange={(event) => {
                setPageSize(Number(event.target.value) as 25 | 50);
                setPage(0);
              }}
            >
              <option value={25}>25개</option>
              <option value={50}>50개</option>
            </select>
          </label>
        </div>
        <output className={styles.resultCount}>
          {result.total.toLocaleString()}개 계약 · 통화 / 관측 / GNSS는 해당
          일자 기준, 미제공은 0건과 다릅니다.
        </output>
        <div className={styles.table}>
          <table>
            <thead>
              <tr>
                <th>원본 계약번호 / 고객</th>
                <th>통화</th>
                <th>관측</th>
                <th>GNSS</th>
                <th>선택</th>
              </tr>
            </thead>
            <tbody>
              {result.rows.map((row) => (
                <tr
                  key={row.customer.id}
                  aria-selected={selectedId === row.customer.id}
                >
                  <td>
                    <strong>
                      {row.customer.sourceContractId ?? '계약번호 미제공'}
                    </strong>
                    <small>{row.customer.displayName}</small>
                    {selectedId === row.customer.id && <span>현재 선택</span>}
                  </td>
                  <td>{count(row.callCount)}</td>
                  <td>{count(row.sampleCount)}</td>
                  <td>{count(row.gnssSampleCount)}</td>
                  <td>
                    <button
                      aria-label={`${row.customer.sourceContractId ?? row.customer.displayName} 선택`}
                      onClick={() => {
                        onSelect(row.customer);
                        close();
                      }}
                    >
                      선택
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!result.total && <p>조건에 맞는 계약이 없습니다.</p>}
        </div>
        <div className={styles.footer}>
          <button
            disabled={result.page === 0}
            onClick={() => setPage(result.page - 1)}
          >
            이전
          </button>
          <span>
            {result.pages ? result.page + 1 : 0} / {result.pages} 페이지
          </span>
          <button
            disabled={result.page + 1 >= result.pages}
            onClick={() => setPage(result.page + 1)}
          >
            다음
          </button>
          <button onClick={close}>취소</button>
        </div>
      </dialog>
    </>
  );
}
