# MDT 병합 원본(Gaepo 4-dong) → 기존 UI 급전 파이프라인 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `data/lte+mdt(개포4동_계약번호 추가).xlsx`(영문 스키마, GNSS 내장)를 기존 MMT 대시보드(`?source=MDT`)가 그대로 렌더할 수 있는 `public/mdt-data.json` + 가상 기지국 Master로 변환한다.

**Architecture:** UI 코드는 한 줄도 수정하지 않는다. 리포의 기존 패턴(streaming xlsx reader → 22필드 튜플 → 정적 JSON)을 따르는 신규 Python 추출기 3개 모듈을 추가한다. GNSS 유효 행(8.2%)은 좌표를 직접 사용하고, 셀별 중위 좌표로 가상 기지국 Master을 부트스트랩해 GNSS 없는 91.8%는 기존 추정 엔진(RSRP 링)과 adaptive 다변측정의 입력으로 삼는다.

**Tech Stack:** Python 3 표준라이트버리만(zipfile/ElementTree/unittest — 리포 규칙), React 19/vinext(수정 없음), oxlint/node 테스트(회귀용, 수정 없음).

**Spec:** `SOURCE_ANALYSIS_1차.md` §8(원본 프로파일 + 스키마 불일치 결론)과 `docs/location-estimation.md`, `docs/adaptive-positioning.md`.

## Global Constraints

- Python 스크립트는 표준라이트버리만 사용(pip 설치 금지) — README §1 규칙.
- 원본 `data/`, 생성 `public/*.json`, `.env*` 는 git 커밋 금지(이미 `.gitignore` 대상). 단 생성되는 `data/BaseStation/virtual_base_station.csv`도 `data/` 아래라 커밋되지 않음 — 정상.
- `app/`, `components/`, `lib/`, 기존 `scripts/extract_*.py`, `scripts/base_station_master.py` 수정 금지(기존 UI 재사용이 요구사항).
- 원본 파일은 Excel이 로킹 중일 수 있어 **읽기 전용 streaming**만 사용할 것(쓰기/이동 금지). `vite.config.ts`가 `data/**` 워칭을 제외하도록 수정済み.
- 모든 스크립트 실행은 리포 루트(`package.json` 위치)에서, `py -3`(없으면 `python`).
- Node ≥ 22.13, 테스트: `node scripts/test-location-estimation.cjs`는 항상 초록 유지.
- 각 태스크 끝커밋: `git add` 개별 파일 + conventional message.

## Review Focus

스펙이 침묵했지만 사람사용자가 가장 먼저 부딪힐 입력/조건 — 각 줄은 지정된 태스크의 테스트로 고정한다.

1. **`0.0` GNSS 플레이스홀더가 좌표로 취급되면 지도가 바다에 뜸** — 0 이하 좌표는 반드시 무좌표로 낙차(T-3 `test_zero_placeholder_rejected`).
2. **같은 초 중복 MDT 행(md_cnt>1)** — `findPoorEpisodes`는 second 단조 순서를 가정한 gap 로직; 부차정렬 키로 순서가 안정해야 함(T-2 `test_same_second_rows_stable_order`).
3. **EARFCN 표 밖 값(dlearfcn=475 등)** — 변환 실패 시 원시 값을 그대로 싥여 `frequencyEncoding:"lte-earfcn"`에 맡기고 엔진 경고 경로로 흡수(T-2 `test_frequency_passthrough`).
4. **계약 9,534개 = JSON 용적/드롭다운 성능** — 용적 가드(80MB 초과 시 계약 최소샘플 필터)와 실파일 종단 로드 확인(T-5).
5. **좌표계 미결정 시나리오** — T-3 결정 게이트 통과 실패 시 전체 파이프라인은 "지도 없는 시계열 모드"로 강등하고 사용자에게 좌표계 확인을 요청(T-3 `test_projection_decision_gate`).

---

## 파일 구성

| 파일 | 책임 |
| --- | --- |
| Create `scripts/mdt_merged_source.py` | 원본 스트리밍 리더 + 필드 정규화(스키마 어댑터의 하단) |
| Create `scripts/gnss_utm.py` | UTM→WGS84 역투영 + 좌표계 후보/결정 상수 |
| Create `scripts/extract_mdt_merged.py` | 그룹화·점수·튜플 빌드 + Master 부트스트랩 + JSON 실행(main 게이트) |
| Create `scripts/test_mdt_merged.py` | T-1,2,4의 unittest(픽스처 xlsx 빌더 내장) |
| Create `scripts/test_gnss_utm.py` | T-3의 unittest |
| Modify `package.json` | `data:mdt-merged` 스크립트 추가 |
| Create `data/BaseStation/virtual_base_station.csv` | (실행 산출물, `.gitignore` 대상) |
| Create `public/mdt-data.json` | (실행 산출물) |

---

### Task 1: 원본 스트리밍 리더 — `mdt_merged_source.py`

**Files:**
- Create: `scripts/mdt_merged_source.py`
- Test: `scripts/test_mdt_merged.py`

**Interfaces:**
- Consumes: 원본 xlsx 경로
- Produces:
  - `read_merged_rows(path: Path) -> Iterator[dict[str, str | None]]` — 헤더이름 키, `''`/`'NULL'` → `None` 정규화
  - `parse_timestamp(yyyymmddhhmmss: str | None) -> datetime | None`
  - `second_of_day(at: datetime) -> float` — 초정 24표시는 `%86400` 클램프

- [x] **Step 1: 픽스처 빌더 + 실패하는 테스트 작성** — `scripts/test_mdt_merged.py` 상단에 공용 헬퍼 `make_xlsx(sheets: list[list[list[str]]]) -> bytes`를 작성(zipfile + inline string sheet XML, sharedStrings 불필요). 테스트:

```python
class TestReader(unittest.TestCase):
    def test_headers_and_null_normalization(self):
        data = make_xlsx([[["base_date", "rsrp", "pci"], ["20260915", "NULL", "447"]]])
        (row,) = list(read_merged_rows(BytesIO(data)))
        self.assertEqual(row["base_date"], "20260915")
        self.assertIsNone(row["rsrp"])   # 'NULL' 문자열 → None
        self.assertEqual(row["pci"], "447")
        self.assertNotIn("ghost_col", row)

    def test_midnight_24h_and_bad_stamp(self):
        self.assertEqual(second_of_day(parse_timestamp("20260915235959")), 23*3600+59*60+59)
        self.assertIsNone(parse_timestamp("202609151630"))      # 불완 → None
        self.assertIsNone(parse_timestamp(None))
        # 24시 표기(있을 경우)는 다음날 00시로 넘기지 않고 %86400
        self.assertEqual(second_of_day(parse_timestamp("20260916000000")), 0.0)
```

- [x] **Step 2: 실행해 실패 확인** — Run: `py -3 scripts/test_mdt_merged.py TestReader -v` → ImportError 실패 기대.
- [x] **Step 3: `mdt_merged_source.py` 구현** — `read_merged_rows`는 리포 기존 `extract_mdt_data.read_rows`와 동일한 iterparse 방식(행마다 `row.clear()`). 단 시트 대상은 `xl/worksheets/sheet1.xml` 단일, 헤더 행은 첫 행. sharedStrings 지원 유지.
- [x] **Step 4: 테스트 통과** — Run: `py -3 scripts/test_mdt_merged.py TestReader -v` → PASS.
- [x] **Step 5: 커밋** — `git add scripts/mdt_merged_source.py scripts/test_mdt_merged.py && git commit -m "feat: stream raw lte+mdt workbook rows with null normalization"`.

### Task 2: 데이터셋 변환 코어 — `extract_mdt_merged.build_dataset`

**Files:**
- Create: `scripts/extract_mdt_merged.py`
- Test: `scripts/test_mdt_merged.py`

**Interfaces:**
- Consumes: `read_merged_rows`, `parse_timestamp`, `second_of_day` (T-1)
- Produces:
  - `call_key(row: dict) -> tuple[str, str, str]` — `(base_date, svc_cont_id, svc_ctgry_st_hhmiss or "")`
  - `score_records(records: list[dict]) -> float | None` — 기존 `extract_mdt_data.score`와 동일 공식: 각 필드 `(rsrp,-120,-70) (rsrq,-20,-5) (nsinr,-5,25)`에 `1+4*clamp((mean-low)/(high-low))`, part 평균을 2자리 라운드
  - `build_dataset(rows: Iterable[dict], coords: Callable[[dict], tuple[float, float] | None], site_name: str = "개포4동") -> dict` — ExecutiveDataset 전체(dict). 튜플 순서는 기존 `sampleFields`와 정확히 동일: `second,time,lat,lon,site,areaType,floorCode,floorName,rat,pci,rsrp,rsrq,sinr,mos,jitter,delay,qoe,cause,morphology,callId,ci,mdt`
  - 상수: `POOR_QOE_THRESHOLD=2.5`, `SITE="개포4동"`, 고객 `maskedPhone=f"계약 {sha256(svc_cont_id)[:4]}"`, `displayName="측정 계약 NN"`, `id=sha256[:16]`, `rat="LTE"`, `areaType`: `out_in_div_cd "1"→"indoor"` 아니면 `"outdoor"`, `morphology="측정구역"`, `cause="healthy"`, `mos/jitter/delay=None`, `mdt={"timestamp","baseStationId"(mdt_equip_cd), "cellId"(mdt_cell_id), "frequency"(dlearfcn 원시 EARFCN), "streamId"(sha256(svc_cont_id)[:16])}`
  - `meta`: `source="MDT"`, `poorQoeThreshold=2.5`, `qoeBasis="call-radio-estimate"`, `frequencyEncoding="lte-earfcn"`, `fixedLocation=False`, `callMeta={callId: {"start": svc_ctgry_st_hhmiss, "end": svc_ctgry_fns_hhmiss}}`(6자리면 `HH:MM:SS` 서식화), `classification={"measured":["rsrp","rsrq","sinr"],"derived":["QoE"],"estimated":["location"]}`, `sampleFields` 위 순서, `sourceFiles/sourceRows` 실측정치.

- [x] **Step 1: 실패하는 테스트 작성** ( 픽스처 행 dict 직접 생성):

```python
def sample_row(**over):
    base = {"base_date": "20260915", "svc_cont_id": "111", "rqt_timestamp": "20260915100000",
            "mdt_cell_id": "C1", "mdt_equip_cd": "E1", "dlearfcn": "1550", "pci": "447",
            "rsrp": "-80.0", "rsrq": "-10.0", "nsinr": "7.0", "out_in_div_cd": "0",
            "svc_ctgry_st_hhmiss": "163051", "svc_ctgry_fns_hhmiss": "163353"}
    return {**base, **over}

class TestBuildDataset(unittest.TestCase):
    coords = staticmethod(lambda row: (37.5, 127.05) if row["rsrp"] else (37.5001, 127.0501))

    def test_good_and_bad_contract(self):
        rows = ([sample_row()] * 5 +
                [sample_row(svc_cont_id="222", rsrp="-118.0", rsrq="-19.0", nsinr="-4.0")] * 5)
        ds = build_dataset(rows, self.coords)
        # 직접 검증: 좋은 계약의 call QoE는 3 이상, 나쁜 계약은 2.5 미만
        call_qoe = {(s[19]): s[16] for d in ds["days"] for s in d["samples"]}
        self.assertTrue(any(v >= 3.0 for v in call_qoe.values()))
        self.assertTrue(any(v < 2.5 for v in call_qoe.values()))
        for d in ds["days"]:
            for s in d["samples"]:
                self.assertEqual(len(s), 22)
                self.assertEqual(s[4], "개포4동"); self.assertEqual(s[8], "LTE")
                self.assertIn(s[5], ("indoor", "outdoor")); self.assertTrue(s[19] and s[20])

    def test_same_second_rows_stable_order(self):
        rows = [sample_row() for _ in range(50)]
        ds = build_dataset(rows, self.coords)
        secs = [s[0] for d in ds["days"] for s in d["samples"]]
        self.assertEqual(secs, sorted(secs))  # 부차정렬 키(입력 순) 유지
        self.assertEqual(len(secs), 50)       # 중복 초 행 유실 없음

    def test_frequency_passthrough(self):
        rows = [sample_row(dlearfcn="475")]
        ds = build_dataset(rows, self.coords)
        self.assertEqual(ds["days"][0]["samples"][0][21]["frequency"], 475.0)
        self.assertEqual(ds["meta"]["frequencyEncoding"], "lte-earfcn")
```

- [x] **Step 2: 실행해 실패 확인** — `py -3 scripts/test_mdt_merged.py TestBuildDataset -v` → 실패.
- [x] **Step 3: `build_dataset` 구현** — 그룹화: `defaultdict(list)` on `call_key`; 그룹은 `(timestamp, 입력 index)` 병합정렬. 무측정(`rsrp/rsrq/nsinr` 전 None) 그룹은 `unscoredCalls` 카운트 후 유실. 샘플 키는 `(base_date)` 단일 일자면 `days` 1개, 일자별 `"key": f"{customer_id}:{date}"`. 고객 일자는 계약별 날짜 집합. 좌표는 `coords(row)` 결과, None이면 `(37.5, 127.05)` 폴백(현실은 T-4의 셀 중심 제공 — T-2에서는 시그니처 확정을 위해 인자주入).
- [x] **Step 4: 테스트 통과** → PASS.
- [x] **Step 5: 커밋** — `git commit -m "feat: convert merged lte+mdt rows into ExecutiveDataset tuples"`.

### Task 3: 좌표계 결정 + 역투영 — `gnss_utm.py`

**Files:**
- Create: `scripts/gnss_utm.py`
- Test: `scripts/test_gnss_utm.py`
- Reference(throwaway, 리포 밖): `_analysis/probe_projection.py`

**Interfaces:**
- Produces:
  - `CANDIDATES: dict[str, dict]` — 각 항목 `{a, f, k0, lon0, fe, fn}`. 초기 후보(리포트 §8.2 실측 x≈960,230 y≈1,941,498, 대상 개포4동 37.49N/127.06E 기준):
    1. `utm52-fe1e6-fn0` (a=6378137, f=1/298.257223563, k0=0.9996, lon0=127.5, fe=1_000_000, fn=0)
    2. `utm52-fe1e6-fn500k` (동일, fn=500_000)
    3. `utm52-bessel-fe1e6-fn0` (bessel a=6377397.155 f=1/299.1528128)
    4. `utm52-wgs84-fe2e6-fn500k` (EPSG:5186 정석값)
    5. `utm53-wgs84-fe2e6-fn500k` (lon0=128.5)
  - `to_latlon(x: float, y: float, name: str) -> tuple[float, float] | None` — 표준 Transverse Mercator 역투영(stdlib 수학, 수렴 반복). `x<=0 or y<=0 → None`.
  - `CHOSEN: str` — 게이트 통과 후보명. 없으면 `""`.
  - `korea_bbox(lat, lon) -> bool` — `33<=lat<=39 and 124<=lon<=132`.

- [x] **Step 1: 실패하는 테스트 작성**:

```python
class TestGnss(unittest.TestCase):
    def test_zero_placeholder_rejected(self):
        self.assertIsNone(to_latlon(0.0, 0.0, "utm52-fe1e6-fn0"))
        self.assertIsNone(to_latlon(-1.0, 1_941_498.0, "utm52-fe1e6-fn0"))

    def test_projection_decision_gate(self):
        # 프로브 결과 기록값으로 CHOSEN 확정. 게이트 기준:
        #  (a) 표본 500행에서 95% 이상이 korea_bbox
        #  (b) 동일 mdt_cell_id 내 최대 편차 ≤ 500m
        #  통과 후보가 CHOSEN과 일치해야 함; CHOSEN이 "" 이면 파이프라인은
        #  좌표 없는 시계열 모드로 강등하며 이 테스트는 스킵 사유를 실패 메시지로 드러낸다.
        self.assertNotEqual(CHOSEN, "", "좌표계 미결정 — 원본 공급처에 EPSG 확인 필요")
        pts = [to_latlon(x, y, CHOSEN) for x, y in REAL_SAMPLE_PAIRS]  # 표본 고정 시드
        in_kr = [p for p in pts if p and korea_bbox(*p)]
        self.assertGreaterEqual(len(in_kr) / len([p for p in pts if p]), 0.95)
```

- [x] **Step 2: 실행해 실패 확인.**
- [x] **Step 3: 프로브 실행(좌표계 결정)** — `_analysis/probe_projection.py`로 원본 표본 2,000행(1% 샘플, 0제외)을 5개 후보로 역투영, 후보별 bbox 비율·셀별 편차를 프린트. 기준 통과 후보를 `CHOSEN`과 테스트의 `REAL_SAMPLE_PAIRS`(표본 좌표 500쌍 하드코드)에 기록. 통과 후보 없으면 `CHOSEN=""` 유지 후 사용자에게 좌표계 질문(리포트 §8 갱신) — 이후 태스크는 `coords=None` 주입으로 진행(지도 제외 시계열만 활성).
- [x] **Step 4: `to_latlon` 구현** (Snyder식 역투영 반복식 ~40줄).
- [x] **Step 5: 테스트 통과** → PASS(또는 게이트 스킵 사유 명시 실패를 사용자에게 보고).
- [x] **Step 6: 커밋** — `git commit -m "feat: utm inverse projection with empirically chosen korea zone candidate"`.

### Task 4: 셀 중심 부트스트랩 + Master CSV + main 배선 — `extract_mdt_merged.py`

**Files:**
- Modify: `scripts/extract_mdt_merged.py`
- Test: `scripts/test_mdt_merged.py`
- 산출: `data/BaseStation/virtual_base_station.csv`, `public/mdt-data.json`

**Interfaces:**
- Consumes: T-1 리더, T-2 `build_dataset`, T-3 `to_latlon/CHOSEN`, 기존 `base_station_master.load_master` (회귀 검증용, 수정 없음)
- Produces:
  - `cell_centroids(pairs: Iterable[tuple[str, float, float]]) -> dict[str, tuple[float, float]]` — cellId별 중위 lat/lon, 표본 <3 인 셀 제외
  - `write_master_csv(centroids, meta_by_cell: dict[str, dict], path: Path) -> None` — **legacy 헤더** `base_station_id,cell_id,frequency,pci,latitude,longitude,is_virtual` (load_master legacy 분기), `is_virtual=true`, frequency는 dlearfcn 원시(모드값)
  - `main()` — argparse(`--src data/*.xlsx`, `--out public/mdt-data.json`, `--master data/BaseStation/virtual_base_station.csv`): rows→유효 GNSS 좌표 쌍→centroids→CSV→`coords` 콜백(cell centroid 폴백, 최종 폴백 전체 중심)→`build_dataset`→meta에 `baseStations`= load_master(생성CSV) 결과 주입→JSON 실행. 요약 JSON 출력이 `extract_mdt_data.py`와 동일 키 + `gnss_valid_rows`.

- [x] **Step 1: 실패하는 테스트 작성**:

```python
class TestBootstrap(unittest.TestCase):
    def test_median_and_min_count(self):
        rows = [("C1", 37.50, 127.05), ("C1", 37.51, 127.05), ("C1", 37.52, 127.06),
                ("C2", 37.40, 127.10), ("C2", 37.41, 127.10)]   # C2는 2행 → 제외
        self.assertEqual(set(cell_centroids(rows)), {"C1"})
        lat, lon = cell_centroids(rows)["C1"]
        self.assertAlmostEqual(lat, 37.51, delta=1e-9)

    def test_generated_csv_loads_with_legacy_loader(self):
        centroids = {"C1": (37.51, 127.05)}
        meta = {"C1": {"baseStationId": "E1", "frequency": 1550, "pci": 447}}
        out = Path(tempfile.mkdtemp()) / "m.csv"
        write_master_csv(centroids, meta, out)
        stations, errors = load_master(out)
        self.assertEqual(errors, [])
        self.assertEqual(stations[0]["cellId"], "C1")
        self.assertTrue(stations[0]["isVirtual"])
```

- [x] **Step 2: 실패 확인.** - [x] **Step 3: 구현 + main 배선** — `coords` 콜백: `to_latlon` 실패/미좌표 → `centroids.get(cellId)` → 전체 중심. CSV는 UTF-8 BOM 없이(`utf-8-sig` 디코딩과 호환), 소수는 6자리.
- [x] **Step 4: 테스트 통과.**
- [x] **Step 5: 회귀** — `py -3 scripts/test_base_station_master.py` 및 `node scripts/test-location-estimation.cjs` PASS 확인.
- [x] **Step 6: 커밋** — `git commit -m "feat: bootstrap virtual base station master from gnss cell centroids"`.

### Task 5: 실파일 종단 실행 + 용적/성능 가드 + UI 확인

**Files:**
- Modify: `package.json` — `"data:mdt-merged": "py -3 scripts/extract_mdt_merged.py"` 추가, `data:all`에는 추가하지 않음(원본 스키마가 달라 기존 `data:mdt`와 혼용 불가)
- Modify: `scripts/extract_mdt_merged.py` — 상수 `MAX_JSON_BYTES=80_000_000`, `MIN_SAMPLES_PER_CONTRACT=50` (초과 시 계약 필터 후 재생성, 로그에 제외 계약 수)

**Interfaces:**
- Consumes: T-1~4 전부
- Produces: 실데이터 `public/mdt-data.json`, 확인된 성능 수치

- [x] **Step 1: 실파일 추출 실행** — `py -3 scripts/extract_mdt_merged.py` → 요약 JSON 출력(rows≈599k, gnss_valid≈49k, events≈597k, unscored, stations) 및 `public/mdt-data.json` 생성 확인.
- [x] **Step 2: 용적 가드 검증** — `Get-Item public/mdt-data.json` 크기가 80MB 초과면 계약 필터 상수 적용 재실행; 크기·계약 수를 로그에 기록.
- [x] **Step 3: UI 종단 확인(dev 서버 실행 중)** — `http://localhost:3000/qoe/?source=MDT` 에서 ① 로딩 오류 없음 ② KPI/통화 테이블/시계열 렌더 ③ 지도 마커가 개포4동(또는 결정된 좌표계 결과 위치)에 표시 ④ 추정 설정에서 주파수 형식을 "LTE EARFCN" 선택 시 링/휴거가 GNSS 무좌표 행 위에 렌더. Playwright로 스냅샷 1장 저장(`qa-adaptive-map.cjs` 참고, 산출물 커밋 금지).
- [x] **Step 4: 회귀 테스트 전부 PASS** — `node scripts/test-location-estimation.cjs`, `py -3 scripts/test_mdt_merged.py -v`, `py -3 scripts/test_gnss_utm.py -v`, `npm run lint`(신규 파일 무오류 기준).
- [x] **Step 5: 커밋** — `git commit -m "feat: wire mdt-merged extraction with size guard and e2e verification"`.

### Task 6: 문서 갱신

**Files:**
- Modify: `README.md` — "MDT 병합 원본(영문 스키마)" 섹션: 파일명 규칙, 실행 명령(`py -3 scripts/extract_mdt_merged.py`), 생성 Master 설명, EARFCN 선택 안내
- Modify: `SOURCE_ANALYSIS_1차.md`(워크스페이스 루트) — 결정된 좌표계·실측 수치 반영

- [x] **Step 1: README/리포트 반영** - [x] **Step 2: 커밋** — `git commit -m "docs: document merged mdt ingestion"`.

---

## 커밋 순자(요약)

T1 reader → T2 tuples → T3 projection → T4 bootstrap/main → T5 wiring/e2e → T6 docs. 각 태스크는 독립 커밋이며 각각 되돌림 가능.
