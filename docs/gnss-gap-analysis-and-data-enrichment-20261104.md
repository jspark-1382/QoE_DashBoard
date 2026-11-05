# GNSS 누락 원인 분석 및 데이터 전용 근거 보강 결과 (2026-11-04)

## 요구 범위

- 기존 QoE 대시보드/화면은 그대로 유지한다. 새 페이지를 추가하지 않는다.
- 원본 Excel과 기존 CDR/MDT JSON의 GNSS 좌표 및 MOS를 수정하지 않는다.
- GNSS 누락 행에 가능한 **별도 위치 근거 데이터**만 생성한다.
- 시각 또는 셀/기지국 정보로 단말 위치가 확정되지 않는 경우 UE 위치 필드를 반드시 null로 둔다.

## 원본 전체 조사

소스: `data/MDT_New/261026_1030_VoLTE+MDT_강남구 개포동_전달용.xlsx`; `outputs/gnss-gap-supplement/557c39d2c6a9a5b4c69b/raw-source-audit.json` 기록.

| 전체 원본 MDT 행 | GNSS 양수 좌표쌍 | GNSS (0,0) | GNSS 둘 다 미제공 |
|---:|---:|---:|---:|
| 541,811 | 42,344 | 284,401 | 215,066 |

GNSS 양수 X/Y가 있다고 해서 장비 수준 정확도가 검증되었다는 뜻은 아니다. 원본의 `M2` 보고 유형 211,975행은 X/Y 모두 누락되어 있다. `M1` 보고 326,265행 중 283,949행은 X/Y가 `0,0`이고 42,316행만 양수이다. `gnss_metric_id=0.0_0.0`은 양수 GNSS 관측을 의미하지 않는다. 누락 자체를 약전계/간섭으로 단정할 수는 없다.

CDR 184,232통화 중 기존 원본 연결 결과 MDT 4,290건이 유일매칭, 638건이 복수 후보, 179,304건은 매칭되지 않는다. **원본 전체 42,344 양수 GNSS 행을 GNSS 없는 CDR에 임의로 매칭하면 안 된다.** CDR과 MDT 공통 계약/시각/셀/통화 ID의 독립 검증이 필요하다.

## 기존 CDR 연계 MDT 데이터 현황

`public/voice-1030.json` manifest의 실제 데이터 파티션 기준:

| 항목 | 행수 |
|---|---:|
| CDR 연계 MDT 샘플 | 93,312 |
| GNSS 위경도 유효 | 3,595 |
| GNSS (0,0) | 47,918 |
| GNSS X/Y 모두 누락 | 41,799 |
| 위치 보강 대상 | 89,717 |

메타데이터에는 샘플마다 정확한 RU/Cell, 관측시각, RSRP/SINR 등이 포함될 수 있지만, 이는 GPS 측정 결과와 독립적으로 검토해야 한다.

## 새 데이터 보강 결과

위치 근거 생성 스크립트: `scripts/enrich_missing_gnss_evidence.py`.

결과 위치: `outputs/gnss-gap-supplement/557c39d2c6a9a5b4c69b/`.

- `YYYY-MM-DD.jsonl` 5개: GNSS 누락 행마다 원본 파티션 경로/Call ID/샘플 번호 키로 별도 근거 레코드 저장
- `summary.json`: 데이터 건수·일자별 근거 건수·원본 리비전·누락 사유
- `raw-source-audit.json`: 원본 Excel 전체 실측 좌표 필드의 누락/0값 집계

| 증거 종류 | 보강 행수 | 엄격한 해석 |
|---|---:|---|
| 동일 통화의 180초 이내 실제 이전 GNSS | 6,292 | GNSS 측정 당시 위치; 해당 이벤트의 실제 위치 아님 |
| 정확한 RU+Cell 고유 매핑의 MDT 셀 사이트 | 76,138 | 기지국 사이트 위치; 단말 위치 아님 |
| 유일 CDR 종료 Cell의 기지국 사이트 | 22,167 | CDR 종료 사이트 참고; 해당 MDT 이벤트 위치 아님 |
| 위 세 근거 모두 없음 | 11,399 | 위치 근거 미확인 |

세 가지 근거 종류는 서로 중복 가능하다. GNSS 결측 행 89,717개 중 최소 한 종류의 근거가 존재하는 행은 78,318개이다. **새 단말 위치 좌표를 확정한 행은 0개**이다.

`uePosition=null`, `calibratedPositionUncertaintyM=null`, `isQualityImpairmentLocation=false`를 강제한다. 본 보강은 GNSS를 생성하지 않고 원본 MOS를 변경하지 않는다. GNSS 참조의 `250m+120km/h×경과시간`은 검증된 정확도가 아닌 이동 가능 영역에 관한 가정이다.

## 위치 복원/원인 확정이 막힌 이유

1. `M2`와 일부 이벤트에는 GNSS 값 자체가 제공되지 않는다.
2. `M1`도 다수가 `0,0`을 기록한다. 이는 실제 관측이 아니다.
3. 전체 소스 양수 좌표쌍 42,344개 중 기존 CDR-연계 데이터에 3,595개만 포함되므로 원본-연결 범위를 개선할 여지가 있으나, 연결되지 않은 통화에 무단 결합할 수 없다.
4. RU+Cell 유일 매핑을 거친 기지국 좌표는 UE 좌표가 아니다.
5. RSRP 기반 추정은 독립 GNSS 변경점 보류 검증에서 149통화 중 엄격한 무선 추정 채택 0건. `outputs/position-gnss-change-holdout.json`에 기준선·RSRP 후보 오차 보고.
6. 종단 CDR MOS는 저하 발생 시각이 아니므로 GNSS 누락 행에 저MOS 실제 발생 위치를 임의로 부여할 수 없다.

## 검증 명령

```powershell
python scripts/audit_gnss_raw_completeness.py
python scripts/enrich_missing_gnss_evidence.py
python scripts/validate_gnss_gap_supplement.py
python -m unittest scripts/tests/test_enrich_missing_gnss_evidence.py -v
node --test scripts/tests/voice-multiday-ui.test.cjs
```

검증 결과: 데이터 출력 89,717행 고유키·미래 GNSS 미사용·기지국과 단말 좌표 구분·합계 검증 통과, 신규 Python 단위 테스트 7개 통과, 기존 날짜별 UI 데이터 검사 2개 통과.

이 보강 결과는 **기존 JSON을 훼손하지 않기 위해 별도 JSONL 데이터로 저장**했다. 기존 화면에서 데이터를 표시하거나 원본 좌표 결측을 덮어쓰는 작업은 하지 않았다. 불필요하게 생성했던 `app/radio-investigation/page.tsx`와 관련 전용 UI 컴포넌트/CSS의 **소스는 제거**했다. 현재 구동 중인 기존 빌드 산출물의 라우트 제거는 안전한 차기 배포에 반영되어야 하며, 기존 운영 미리보기 빌드 자체는 이번 작업에서 다시 생성하지 않았다.
