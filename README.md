# Studyverse

함께 공부하는 3D 온라인 독서실입니다. 브라우저에서 접속해 둥근 캐릭터로 라운지·열람실·스터디룸을 돌아다니고,
자리에 앉으면 서버가 공부 시간을 세어 줍니다. PC 데스크톱 브라우저 전용입니다.

## 준비

- Node.js 24 이상 (DB는 내장 `node:sqlite`를 써서 네이티브 빌드가 필요 없습니다)
- npm

```bash
npm install
```

## 실행

### 개발 모드

```bash
npm run dev
```

서버(포트 3000, 코드가 바뀌면 다시 시작)와 Vite 개발 서버(포트 5173)가 함께 뜹니다.
브라우저에서 http://localhost:5173 을 엽니다. Vite가 `/socket.io` 요청을 3000번 서버로 넘겨 줍니다.

### 배포 모드

```bash
npm run build
npm start
```

`npm run build`는 클라이언트 타입 검사 후 `client/dist`를 만듭니다. `npm start`로 띄운 서버가 그 파일을 함께 제공하므로
http://localhost:3000 하나로 접속합니다. Ctrl+C로 끄면 앉아 있던 사람들의 공부 시간을 저장하고 종료합니다.

## 환경 변수

| 이름 | 기본값 | 설명 |
|---|---|---|
| `PORT` | `3000` | 서버 포트 |
| `STUDYVERSE_DB` | `data/studyverse.db` | SQLite DB 파일 경로 (폴더가 없으면 만듭니다) |
| `STUDYVERSE_ADMIN_KEY` | (없음) | 관리 명령에 필요한 키. 설정하지 않으면 관리 명령을 쓸 수 없습니다 |

## 관리 명령

공개 기록판에 부적절한 닉네임이 올라왔을 때 DB 파일을 직접 고치지 않고 처리합니다. 서버와 같은 DB를 보도록
`STUDYVERSE_DB`를 맞춰 주세요.

```bash
STUDYVERSE_ADMIN_KEY=비밀키 npm run admin -- --key 비밀키 today
```

| 명령 | 하는 일 |
|---|---|
| `today` | 오늘(한국 시간 기준)의 기록 보기 |
| `hide <anonId>` | 랭킹(기록판 TOP 5)에서 숨기기 |
| `unhide <anonId>` | 숨김 해제 |
| `rename <anonId> <닉네임>` | 닉네임 변경 |
| `delete <anonId> [YYYY-MM-DD]` | 기록 삭제 (날짜를 생략하면 그 사람의 전체 기록) |

`anonId`는 각 브라우저가 만든 익명 ID입니다(브라우저 localStorage의 `studyverse.profile.v1`).

## 테스트

```bash
npm test
```

`shared`, `server`, `client`의 모든 테스트(vitest)를 실행합니다.

## 개발용 도구

- **3D 미리보기**: 개발 모드에서 http://localhost:5173/preview.html — 서버 없이 건물과 아바타 모습을 확인합니다
  (1/2 낮·밤, 3~7 구역 어둡게, F 내 캐릭터 시점, WASD 이동).
- **시각 강제**: 주소 뒤에 `?hour=21`을 붙이면 PC 시각 대신 그 시각으로 낮/밤 테마를 정합니다(0~23).

## 조작

- WASD(또는 방향키) 이동, 마우스 드래그로 카메라 회전, 휠로 확대/축소
- E: 가까이 있는 것과 상호작용 (앉기·일어나기·인사·음료·라디오·기록판). 앉아 있을 때 이동 키를 누르면 일어납니다.
- 메뉴에서는 숫자 키로 고르고 Esc로 닫습니다.

## 소리와 음원 라이선스

라운지 라디오의 소리(로파이 / 빗소리 / 카페 소음)는 모두 Web Audio API로 브라우저에서 직접 합성합니다.
음원 파일은 쓰지 않으므로 따로 기록할 라이선스가 없습니다.

| 소리 | 출처 | 라이선스 |
|---|---|---|
| 로파이 | 코드로 합성 (`client/src/audio/radio.ts`) | 해당 없음 |
| 빗소리 | 코드로 합성 | 해당 없음 |
| 카페 소음 | 코드로 합성 | 해당 없음 |

나중에 외부 음원을 추가하면 이 표에 출처와 라이선스를 적어 주세요.
