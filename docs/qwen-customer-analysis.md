# Qwen 고객·통화 분석

## 사용 방법

고객 선별 화면에서 고객을 선택하고, **고객·통화 상세** 왼쪽의 **AI 분석**을 누릅니다.
기존 차트는 **고객 현황** 탭에 있으며, **AI 분석** 탭에서 진행 상태와 결과를 확인합니다.

분석 화면은 다음 순서로 구성됩니다.

1. 분석 대상 고객·기간·매일 시간 범위
2. 전체 통화의 결정론 통계
3. Qwen의 잠정 판단, 원인 가설, 다음 점검 항목
4. E01~E08 집계 근거
5. 대표 근거 통화와 판단 한계

E01 등의 버튼은 해당 집계 근거로 이동합니다. 고객 선택은 바뀌지 않습니다.
**근거 통화 → 상세**는 원래 통화 화면을 새 탭으로 엽니다.
**통화 분석**은 같은 고객의 해당 통화 1건을 분석합니다. 상단에 통화 분석임을 표시합니다.
작은 화면에서는 우측 상단 확대 버튼으로 분석 내용을 크게 볼 수 있습니다.

고객·기간·시간·자료 버전이 바뀌면 이전 분석 세션을 종료합니다. 늦게 도착한 이전 고객의 응답은 새 고객에게 표시하지 않습니다.
고객 현황과 AI 분석 탭만 전환하면 같은 대상의 진행 중 분석은 유지됩니다.

## Qwen 서버 설정

프로젝트 루트의 **.env**에 설정합니다. 이미 사용하는 **.env.local**의 지도 설정은 유지합니다.

```dotenv
# /v1까지 포함합니다. 아래 주소는 예시이며 실제 서버 주소로 바꿉니다.
QWEN_BASE_URL=http://192.168.0.20:8000/v1
QWEN_MODEL=실제_서빙_모델_ID

# 인증을 요구할 때만 토큰을 입력합니다. Bearer 접두사는 넣지 않습니다.
QWEN_API_KEY=

QWEN_TIMEOUT_MS=180000
QWEN_MAX_TOKENS=4096
QWEN_TEMPERATURE=0.2
QWEN_JSON_MODE=false
QWEN_EXTRA_BODY_JSON={}
QWEN_CANDIDATE_EXTRA_BODY_JSON={}
```

실제 사용할 서버 주소·모델·인증 옵션은 프로젝트의 .env에 입력합니다. 현재 적용 여부는 화면의 설정 확인과 연결 확인으로 확인할 수 있습니다.
필수 값은 **QWEN_BASE_URL, QWEN_MODEL**입니다. 모델명은 서버 `GET /v1/models`에 등록된 ID와 정확히 일치해야 합니다.
집 서버에 접근 가능한 주소를 사용합니다. 분석 요청은 브라우저가 아니라 **이 Windows PC의 Node 서버**에서 보냅니다.

설정은 새 요청마다 다시 읽습니다. .env를 저장하고 **설정 다시 확인 → 연결 확인 → AI 분석** 순서로 실행합니다.
우선순위는 **실행 프로세스 환경 변수 > .env.local > .env**입니다. 다른 파일에 같은 QWEN 항목이 있으면 .env보다 우선합니다.
QWEN 설정에 VITE_ 접두사를 붙이지 않습니다. API 키와 서버 URL은 브라우저 응답이나 번들로 전달하지 않습니다.
.env는 기존 .gitignore 규칙으로 제외됩니다.

| 항목 | 의미 | 기본값 |
| --- | --- | --- |
| QWEN_BASE_URL | OpenAI 호환 API의 /v1 기준 주소 | 미설정 |
| QWEN_MODEL | 정확한 서빙 모델 ID | 미설정 |
| QWEN_API_KEY | 선택적 Bearer 인증 토큰 | 없음 |
| QWEN_TIMEOUT_MS | Qwen 응답 제한 시간, 1,000~600,000ms | 180000 |
| QWEN_MAX_TOKENS | 최대 출력 토큰, 128~32768 | 4096 |
| QWEN_TEMPERATURE | 생성 온도, 0~2 | 0.2 |
| QWEN_JSON_MODE | response_format: json_object 사용 여부 | false |
| QWEN_EXTRA_BODY_JSON | 고객·후보 분석의 공통 추가 요청 옵션 | {} |
| QWEN_CANDIDATE_EXTRA_BODY_JSON | 후보 분석 요청에만 적용하는 추가 옵션 | {} |

QWEN_JSON_MODE는 해당 서빙 엔진이 지원할 때만 true로 바꿉니다.
기본 상태에서도 최종 답변을 JSON으로 요청하고 서버에서 구조를 검증합니다.

Qwen thinking 설정은 서빙 엔진·모델에 따라 다릅니다. 필요할 때만 해당 엔진에서 지원하는 옵션을 추가합니다.

vLLM의 해당 chat template이 enable_thinking을 지원하는 경우:

```dotenv
QWEN_EXTRA_BODY_JSON={"chat_template_kwargs":{"enable_thinking":false}}
```

Ollama의 해당 모델이 reasoning_effort를 지원하는 경우:

```dotenv
QWEN_EXTRA_BODY_JSON={"reasoning_effort":"none"}
```

추가 옵션은 chat_template_kwargs(enable_thinking, thinking_budget), reasoning_effort,
top_p, top_k, min_p, repetition_penalty, presence_penalty, frequency_penalty, seed만 허용합니다.
model/messages/stream/response_format을 추가 옵션에서 덮어쓸 수 없습니다.

연결 확인은 /models와 모델 ID를 확인하는 검사입니다. 실제 추론 성공은 분석 실행으로 확인해야 합니다.
모델 목록 API를 제공하지 않는 서버에서는 연결 확인에 안내가 나오며, 분석 요청은 별도로 실행할 수 있습니다.

공식 호환 API 참고:

- https://qwen.readthedocs.io/en/latest/deployment/vllm.html
- https://docs.ollama.com/api/openai-compatibility

## 분석 기준과 모델 입력

전체 통계는 현재 음성 SQLite 자료를 **읽기 전용**으로 조회합니다.

- 선택 고객과 선택 날짜 범위, 각 날짜의 선택 시간 범위에 해당하는 모든 통화
- 마지막 분의 59초와 소수 초 포함
- 위치·MDT가 없는 통화 포함
- 원본 MOS, 저장된 보정 QoE, SIP Drop을 별도 집계
- 저품질: 저장된 보정 QoE < 3.0
- 저품질 비율의 분모: QoE가 평가된 통화
- Drop의 분모: 전체 통화. MOS가 없는 Drop도 포함

원본 통계 정책이나 군집화 알고리즘은 이 기능에서 바꾸지 않습니다.

상세 radio/RTP는 최대 32건의 대표 통화를 사용합니다. 저QoE 최대 16건, Drop 최대 8건, 정상 비교 최대 8건을 우선 선택하고 중복 제거 후 최대 32건까지 채웁니다.
이 표본은 무작위 표본이 아닙니다. 전체 통계와 상세 표본 수를 화면에 구분해서 표시합니다.
동일한 원본 상세 reader를 사용해 통화 매칭된 RSRP/SINR과 숫자형 RTP 지표를 읽으며, 결측을 0이나 정상으로 치환하지 않습니다.

Qwen에는 집계 근거와 분석 범위만 보냅니다. 고객 ID·계약번호·원본 통화 ID·좌표·원본 JSON은 보내지 않습니다.
Cell은 대표 Cell 01 등의 별칭을 사용합니다. 화면의 셀별 집계에서 실제 Cell ID와 대응을 확인할 수 있습니다.

통계 숫자는 로컬 계산 값을 표시하고, Qwen은 해당 근거의 해석과 추가 확인 항목을 작성합니다.
모델 입력의 summary와 byCell에는 화면과 동일하게 소수 첫째 자리로 계산한 poorRatePercent(0~100)를 제공합니다. 원시 poorRate(0~1)도 유지하며, 정상적인 백분율 표기가 근거 누락으로 거절되지 않도록 합니다.
Drop 집계를 전체 시그널링 성공 여부로 확대하거나, 같은 건수인 셀·위치 집계를 동일 통화 집합으로 연결하지 않도록 해석 지침을 적용합니다. 입력에 없는 무선 등급 기준이나 평균만으로 심각도를 단정하지 않도록 구분합니다.
최종 message.content의 JSON 구조, 길이, 근거 ID, 평가 값, 근거에 없는 숫자를 검사합니다.
reasoning_content/reasoning은 사용자 결과로 표시하지 않습니다.
검사는 모든 문장의 사실성이나 인과를 증명하지 않습니다. 결과의 원인 가설은 확인된 관측 근거와 함께 검토해야 합니다.

## 현재 범위

이 버전은 고객 본인의 선택 범위 및 개별 통화 분석입니다.

- 다른 고객의 같은 시간·장소·Cell 대조군은 아직 포함하지 않습니다.
- 저하 순간의 정밀 시간 정합, 핸드오버 구간 분석은 아직 수행하지 않습니다.
- BYE 대표 위치나 추정 위치를 정확한 품질 저하 위치로 취급하지 않습니다.
- 셀 집중이나 표본 평균 차이만으로 기지국 원인 또는 설정 변경값을 확정하지 않습니다.
- 서버 재시작 시 메모리의 분석 결과는 사라집니다. 결과 저장·이력 비교는 이번 구현 범위에 포함하지 않습니다.

## 서버 동작

개발 Vite 서버와 로컬 preview 서버에 같은 handler를 연결했습니다.

| API | 기능 |
| --- | --- |
| GET /qoe/api/analysis/config | 설정 상태, 모델명, 누락 항목 |
| POST /qoe/api/analysis/connection | 모델 목록 연결 확인 |
| POST /qoe/api/analysis/jobs | 고객/통화 분석 시작, 작업 ID 즉시 반환 |
| GET /qoe/api/analysis/jobs/:id | 작업 상태와 결과 |
| DELETE /qoe/api/analysis/jobs/:id | 분석 취소 |

queued → collecting → analyzing → completed 순서이며 failed/cancelled를 별도로 처리합니다.
진행률 숫자를 추정해서 표시하지 않습니다.
비동기 작업 ID를 조회하므로 기존 localhost 3001 전달 서버의 60초 제한 동안 긴 요청 하나를 유지하지 않습니다.

기본 동시 분석 2개, 대기 6개, 결과 최대 40개·30분 메모리 보관입니다.
취소는 근거 worker와 Qwen HTTP 요청을 중단합니다. Qwen 서버 내부 GPU 작업의 즉각 중단 여부는 해당 엔진의 동작에 따릅니다.
오류 시 근거 집계가 이미 끝났으면 근거는 확인할 수 있으나 AI 분석 완료로 표시하지 않습니다.

## 개발 검증과 실행

```powershell
npm.cmd run test:qwen-analysis
npm.cmd run test:voice-query
node node_modules/typescript/bin/tsc --noEmit --incremental false
npm.cmd run build:local
```

이미 실행 중인 로컬 preview는 새 빌드를 반영하도록 프로젝트 preview 프로세스를 재시작합니다.
일상적인 실행은 기존 `scripts/start-qoe.ps1 -NoBrowser`를 사용합니다.
UI만 변경한 경우 원본 자료 전체를 다시 생성할 필요는 없습니다. `npm run local`은 prelocal에서 data:all을 실행하므로 단순 UI 재실행과 구분합니다.

테스트는 임시 SQLite, 실제 production worker, 로컬 HTTP 모의 Qwen 서버를 사용합니다.
2026-11-12에는 사용자가 입력한 실제 .env 설정으로 qwen3.8-flash-next의 고객 전체 분석과 선택 통화 1건 분석을 검증했습니다. 최종 실행은 각각 약 58.0초·50.8초에 완료됐고, 근거 이동·확대·대상 유지·결과 표시를 확인했습니다.
이번 검증 중 백분율 근거 누락과 빼기식을 음수로 오인하는 문제를 수정했으며, 분석 자동 테스트 35개가 통과했습니다.
상세 결과와 실제 화면 기록은 outputs/qwen-analysis-dev/live-verification-20261112.md에 있습니다. 원인 가설과 셀 편중에 관한 자연어 해석은 추가 근거와 함께 검토해야 합니다.

### 후보 분석 전용 옵션

`QWEN_CANDIDATE_EXTRA_BODY_JSON`은 개선 후보 분석에만 적용합니다. 미설정 또는 `{}`이면 기존 요청 옵션을 유지합니다. 공통 `QWEN_EXTRA_BODY_JSON` 위에 후보 옵션을 최상위 키 단위로 덮어쓰며, 고객·통화 분석 요청에는 후보 옵션을 적용하지 않습니다.

`chat_template_kwargs`도 객체 전체를 교체합니다. 예를 들어 공통 옵션에 `enable_thinking: true, thinking_budget: 512`가 있어도 후보 옵션을 `{"chat_template_kwargs":{"enable_thinking":false}}`로 지정하면 후보 요청에는 `enable_thinking: false`만 전달되고 전역 `thinking_budget`은 상속되지 않습니다. 후보 요청에 필요한 중첩 설정은 같은 객체에 명시합니다.

SGLang 또는 vLLM에서 사용하는 모델의 chat template이 해당 스위치를 지원하면 다음처럼 후보의 구조화 리포트만 non-thinking으로 요청할 수 있습니다. 실제 엔진·모델 지원을 확인하고 사용합니다.

```dotenv
QWEN_CANDIDATE_EXTRA_BODY_JSON={"chat_template_kwargs":{"enable_thinking":false}}
```

이 옵션은 출력 토큰 한도를 변경하지 않습니다. 실제 전송값은 후보 팝업 상단 **AI 입력·응답 확인 → 전송 옵션·사본 식별값**에서 확인합니다. 모델에 보낸 최종 옵션을 작업 재사용 키에도 포함하므로, 유효 옵션이 바뀐 새 분석 요청은 이전 설정의 완료 결과를 재사용하지 않습니다. 이미 열린 결과는 재분석을 눌러 새 요청을 생성합니다.

공통·후보 옵션은 같은 허용 키 검증을 사용합니다. `messages`, `model`, `stream`, `max_tokens`, 주소·인증 항목 등 보호 필드는 추가 옵션으로 바꿀 수 없습니다. 설정 우선순위는 다른 QWEN 항목과 같습니다.
