# 개선 2안 — 전체 기간 조사 후보 기본화 / 후속 평가 모드 분리
검증일: 2026-11-08
Windows 프로젝트: QoE_Metrics

## 변경 목적 및 UI
- 기본값 `전체 기간 후보 분석 (기본)`: 선택 기간의 모든 저MOS 관측을 모델 산정에 투입한다. 마지막 날을 검증일로 빼지 않는다.
- 선택값 `알고리즘 성능 검증 (기간 분리)`: 최소 3일 이상에서 마지막 날을 후속 평가일로 분리하고 발견기간으로만 후보를 생성한다. 검증일 신규 고객 재관측은 후보별 참고 근거이며, 모델 성능/무선 원인 확정과는 다르다.
- 1~2일 기간은 별도 후속 평가가 불가능하여 성능 검증 버튼 비활성화. 하루 기간은 여러 날짜 반복 조건에 의해 후보 0곳이 정상이다.
- 둘 다 동일한 원본 소스 버전, 승인된 GNSS/엄격 3-Site, 고유 CDR↔MDT 연결, 저MOS 1≤MOS<3으로 구성하며 고유 고객≥3명, 관측일≥2일 조건을 유지한다.
- 기본 화면의 '후속 평가'는 **미실시**로 표기해 '신규 고객 재관측 0명'을 검증 실패로 오인하지 않게 수정했다. 7단계 가상 시뮬레이터는 실제 후보와 독립.
- 선택 모델: DBSCAN, HDBSCAN, ST-DBSCAN, Adaptive KDE, Spatial Scan, Bayesian Empirical Bayes(탐색용). 두 모드 모두 동일 6개 모델 지원.

## 전체 기간 및 후속 평가 후보 수 (2026-10-26~30)
| 모델 | 전체 기간 기본 | 마지막 날 분리 성능 검증 |
| --- | ---: | ---: |
| DBSCAN | 8 | 7 |
| HDBSCAN | 20(표시 상한) | 16 |
| ST-DBSCAN | 7 | 5 |
| Adaptive KDE | 18 | 15 |
| Spatial Scan | 20(표시 상한) | 17 |
| Bayesian empirical | 20(표시 상한) | 20(표시 상한) |

숫자가 많다고 성능이 좋은 모델이 아니며, 후보 범위/추정 가정이 달라 1:1 성능 순위로 비교하지 않는다.
Spatial Scan과 Bayesian은 MOS 평가 가능 전체 130,940건 중 위치 확보 저MOS 131/1,403, 나머지 294/129,537의 심한 선택 편향 때문에 위치 확보 부분집합의 탐색 결과일 뿐 망 전체 위험률/공식 유의성 결과가 아니다. Bayesian도 BYM2 공간계층모형이 아닌 가중 Beta-Binomial 경험적 근사다.
여기서 '성능 검증' 모드는 미래 평가일에 새 고객 저MOS가 관측됐는지를 표시하는 구조다. 정식 Precision/Recall, RF 원인 검증, 비용/재현율이 확정됐다는 의미가 아니므로 임원 보고 시 구분할 것.

## 데이터 생성 및 버전 격리
- 신규 `scripts/build-quality-full-period.py`: 읽기 전용 기존 원본 `public/quality-improvement/<revision>/evidence` + `public/analyst-overview/MDT`에서 15개 전체 기간별 승인 위치 저MOS를 수집. 기존 `scripts/voice_improvement_1.py::_candidates`를 그대로 호출하여 Haversine DBSCAN 알고리즘은 동일하다. 완전 검증 모드는 종전 산출 파일 그대로 보존.
- 신규 `public/quality-improvement-full/index.json` 및 `<revision>/full-<기존scopeKey>/summary.json`, 실제 후보 상세 및 observations(15개 기간). 새 namespace+scopeKey를 사용해 기간별 보고서를 구분.
- 수정 `scripts/build-quality-model-alternatives.py --analysis-mode all`: 5개 대안 모델을 **전체 기간**으로 재계산, 기존 `public/quality-models` 손대지 않고 `public/quality-models-full` 신규 경로에 저장. validationPoints 빈 리스트, validationStatus=not-applicable. `--analysis-mode evaluation`은 종전 호환용이나 실행해서 기존 데이터 덮어쓰기 하지 않음.
- 기존 후속 평가: `public/quality-improvement`, `public/quality-models` 데이터 원본 및 색상·KPI 유지.
- `lib/analyst/quality-improvement-candidates.ts`, `lib/analyst/quality-model-alternatives.ts`: 모드별 데이터 출처 분리, 원본 revision·기간·scopeKey·고객/통화 무결성 검증.
- `components/analyst/quality-improvement-candidate-panel.tsx`: 기본 모드 버튼, 3일 미만 성능 검증 비활성화, 모드별 모든 후보와 상세 로드 연결.
- `components/analyst/quality-two-candidate-workspace.tsx`, `quality-two-customer-evidence.tsx`, `quality-two-algorithm-guide.tsx`, `lib/analyst/quality-two-candidate-view-model.ts`: 전체 기간에는 반복 관측·범위 검토·별도 평가 미실시 표기.
- `components/analyst/quality-model-alternative-workspace.tsx`, `quality-model-simulator.tsx`, `quality-model-alternative.module.css`: 5개 대안의 모드별 후보, 통화 증거 및 조사 원, 전체 기간/평가 분리 용어와 선택기.
- `scripts/serve-quality-full-period-preview.cjs`: 127.0.0.1:3016, `outputs/quality-improvement-two-deploy/stage-full-period-20261108/dist`. 사전 QA에 포트 3019 사용. `.env.local` 빌드 환경 포함으로 VWorld 지도 보존.
- 롤백 빌드 `stage-model-simulators-20261107/dist` 및 기존 배포 스크립트 보존. 3001/3014 서버 및 원본 SIP/RTCP/MDT/GNSS 파일 변경 없음.

## 검증
- Python 원본 DBSCAN 테스트 15개 통과, 대안 모델 합성 테스트 6개 통과.
- Node 산출물 정합성 및 과거 결과 회귀 테스트 통과. 모든 15개 기간의 전체 후보 구성 Call ID/고유 고객/날짜/MOS 조건, 별도 평가자료 누수 여부, 전체/검증 namespace/sourceRevision 체크. 5일 DBSCAN 8 vs 7, ST-DBSCAN 7 vs 5.
- TypeScript `tsc --noEmit --incremental false`, oxlint 통과. Vinext 독립 프로덕션 빌드 성공.
- Edge/Playwright 임시 3019 및 최종 3016 실제 브라우저 검사: 기본 8 ↔ 후속 평가 7 전환; 대안 5개 모델 각각 예상 후보 개수와 모델별 지도·통화 근거 연결, 후보 8까지 고객별 상세 펼치기, 모델 전체화면 가상 시뮬레이터/ESC, 모바일 390px 가로 넘침 없음, 1일 기간 검증 버튼 비활성화 확인.
- 3016 VWorld 타일 응답 HTTP 200, 오류 응답 0건, JS pageerror 0건. 전체/평가 데이터 index HTTP 200.
- 테스트 파일 `scripts/tests/quality-full-period.test.cjs`, `scripts/tests/quality-full-period.browser.cjs`, `scripts/tests/quality-full-period-evidence.browser.cjs`.
- 사용자 시간 필터가 15개 사전 생성 범위(00:00~23:59) 외라면 생성되지 않은 조건으로 표시; 근거 없는 다른 범위 결과 대체 금지.
- 한계: 후보 중심은 저MOS 순간의 확정 위치가 아니며, 현장 RF·SCAN·이동성 증거 검증 필요.
