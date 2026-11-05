# VoLTE 실제 불량 위치·원인 분석: 원본 감사 및 GNSS 홀드아웃 진단 (2026-11-04)

## 결론과 배포 판정
**완료가 아닌 검증 단계.** 이 프로젝트에서 SIP CDR/MDT 데이터의 통화 품질 불량 구간 발생시각과 독립적인 현장 GNSS 정답을 결합한 검증은 아직 존재하지 않는다. 따라서 현행 RSRP 거리 모델 및 속도 외삽을 정밀 불량 위치 모델로 채택하지 않는다. BYE 셀의 사이트 좌표는 UE 위치가 아니다. 120km/h·250m 이동 영역은 시나리오 상한이며 90% 신뢰영역이 아니다.

## 1단계: 실제 원본 스키마와 감사
- `data/MDT_New/261026_1030_SIP_Call_All_1 (개포동 전체)_전달용_v1.xlsx` / `전체_Raw`: 184,277 데이터 행, 143개 컬럼. 2026-10-26~30 분석대상 184,232행(시작일자 10/25 42건, 날짜 유효하지 않은 3건 제외). 전체 파일 MOS<3 1,404행, 분석 기간 MOS<3 1,403행.
- `data/MDT_New/261026_1030_VoLTE+MDT_강남구 개포동_전달용.xlsx` / `result`: 541,811 이벤트, 39개 컬럼. 숫자 RSRP 326,730, SINR 290,006, rtcp_mos 327,683. 비어 있지 않은 GNSS X/Y 326,745는 326,745개의 **유효 GNSS fix를 의미하지 않음**. 필드별 'NULL'/0/고정값, 변환 및 원본 품질 검사가 별도로 필요하다.
- `data/BaseStation/수도권_LTE_261103.xlsx`: 87,562 데이터 행, `cell_id,LTERU_ID,latitude,longitude`; 유효 87,322, 이상 240(기존 품질 보고 및 소스 확인). CDR의 Cell 단독 매칭을 신뢰하면 안 된다. RU+Cell 고유쌍 우선.
- 원본 CDR의 RTP Tx/Rx Jitter, Packetloss, RTT, RTP Loss CNT는 통화 요약값이며 각각 발생 구간을 지시하지 않는다.
- 원본 MDT의 `rtcp_mos`는 이벤트 숫자지만 통화별 MOS(v5)과 동일 산식·시계열 갱신 여부는 입증되지 않았다. `outputs/mdt-event-mos-audit.json` 검토: 27,758 그룹 중 MOS 있는 12,338그룹, 그룹 내 MOS 값 변화가 검출되지 않아 불량 onset을 추정하지 않는다. 별도 원본 RTCP/RTP pcap 확인되지 않음.
- `outputs/radio-original-source-audit.json`에는 원본 스키마 감사가 기록됨. 초기 스크립트는 `cdr` 키가 비고 `sip_cdr` 키에 결과가 담기는 구조이므로 소비 코드에서 명시할 것.
- 시간: CDR datetime과 MDT `occ_dt` 간 KST/시계 드리프트 검증 필요. `END TIME`은 실제 BYE 패킷 수신시각이라고 단정 불가. GNSS 원본 X/Y는 현재 import 시 EPSG:5179로 설정하나, 측정자/장비 제공 좌표계 및 정확도 필드가 원본에 없다.

## 2/4단계: 기존 GNSS 기준선 보류 진단
- `python scripts/gnss_holdout_diagnostic.py` => `outputs/gnss-holdout-diagnostic.json`. 원본 Excel의 가공 프로젝트 GNSS 좌표(기존 추출기를 거침)를 사용한다. **원본 GNSS 정답의 독립측량 검증은 아님.**
- 동일 통화 내 마지막 fix 보류. 미래 관측 입력 금지. 1초/3m 이내 준중복 fix 제거, 최근 fix부터 5~180초 후 목표를 평가.
- 후보 304건. 최근 GNSS 유지: p50 0m / p90 11.07m. BYE 기지국 68건: p50 115.10m / p90 363.92m. 서로 표본이 다르므로 직접적인 모델 우열 아님.
- 10/26~28 개발 날짜, 10/29~30 시험 날짜. 고객·Cell도 겹치지 않는 엄격 시험 24통화. 이중 9통화만 이전 GNSS 두 점의 물리적으로 가능한 속도를 이용한 외삽 가능. 동일 9통화에서 최근 GNSS 유지 p50 0m/p90 5.06m, 속도 외삽 p50 0m/p90 4.83m. 9통화만으로 효과 주장 불가. 개선 모델 미채택.
- GNSS p50 0m는 정지/반복 좌표 및 동일 GNSS 원천의 상관성이 크다는 경고다. 이 값이 실제 위치 정밀도 0m라는 의미가 절대 아님.
- 공간 불확실성: GNSS 장비 정확도 부재 및 독립 캘리브레이션 자료 부재로 90% 영역 포함률 평가 불가; 출력 JSON에는 null.
- 기존 RSRP 다변측량 모델/시계열 융합 모델은 **동일 홀드아웃에 타깃 GNSS를 완전히 마스킹한 재실행이 이루어지지 않아 정확도 비교 미완료**.
- 기존 문서에 있는 RSRP→거리 오차 중앙값 521m(2,679쌍)는 UE-기지국 거리 추정에 대한 검토로, UE 위치 추정 오차와 다르며 독립 고객·일자·셀 검증도 아니다.

## 3단계: 안전한 개선 진단 모듈
- `scripts/gnss_holdout_diagnostic.py`: 홀드아웃 평가, 시간순 검증, 비현실적 이동속도 거부, 원본 GNSS 좌표 별도 가림, 엄격 분리, 거리오차 p50/p90/범위 적중률, GNSS 가정 이동영역 포함률(신뢰구간으로 표시 금지), 개인정보/좌표 없는 집계.
- `scripts/tests/test_gnss_holdout_diagnostic.py`: 6개 안전성 및 수학 테스트 통과. `node --test scripts/tests/gnss-reference-fusion.test.cjs scripts/tests/position-review.test.cjs`: 기존 9개 테스트 통과.
- `components/analyst/radio-investigation.tsx`: manifest JSON 타입, NULL 위치 가드, 기존 지도 타입 정합성 수정. `npx.cmd tsc --noEmit --incremental false` 통과.

## 5단계: 현장 점검 지원의 현재 범위
- `public/radio-investigation/summary.json` 및 5개 날짜 파티션 생성 확인. `app/radio-investigation/`에서 사용. 1,403개 저MOS 통화를 표본으로 진단 후보 생성. 신호/손실/단말/코어 원인 확정 기능 아님.
- MDT 그룹의 MOS가 시간상 달라졌다는 증거가 없으므로 저하 발생 시간은 null이어야 한다.
- 후보 셀: 종료셀별 저MOS 건수는 진단 우선순위로만 사용. 셀 용량·정상 통화 모집단/전체 지역 표본 편향이 검증되지 않은 행정동 불량률을 산출하지 않는다.
- 현장 필요자료: GNSS 수신시각·정확도/속도/좌표계 명세, RTP/RTCP XR의 방향별 시각별 손실/버스트/지터/RTT/코덱, RRC HO/RLF 기록, PRB 점유·스케줄링·간섭, RU 섹터 안테나/주파수/출력, 공통 시간 오차, 별도 실측 위치 정답. 패킷 손실 온셋과 MDT/HO 이벤트 동기화 후 실제 현장 원인 검증 필요.

## 재현 명령
```powershell
python scripts/audit_radio_original_sources.py
python scripts/audit_mdt_event_mos.py
python scripts/gnss_holdout_diagnostic.py
python -m unittest scripts/tests/test_gnss_holdout_diagnostic.py -v
node --test scripts/tests/gnss-reference-fusion.test.cjs scripts/tests/position-review.test.cjs
npx.cmd tsc --noEmit --incremental false
```
원본 Excel은 변경하지 않았으며 개인 식별자와 좌표 원시 리스트를 새 진단 보고서에 쓰지 않는다.
