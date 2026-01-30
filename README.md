# Planner
개인 일정/메모를 관리하는 웹 앱입니다. (Vite + React + Supabase)

## Features
- 리스트/달력으로 일정 확인
- 탭(카테고리)별 일정/메모 관리

## Local 실행
1) 루트에 `.env` 생성 (`.env.example` 참고)
2) 아래 환경변수 설정
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
3) 실행: `npm install` → `npm run dev`

## Deploy (Vercel)
배포 사이트에서 “Supabase 연결 필요” 화면이 뜨면, Vercel 프로젝트 환경변수가 비어있는 상태입니다.

Vercel Dashboard → Project → Settings → Environment Variables에 아래 2개를 추가하세요.
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

추가 후 Redeploy 하면 정상 동작합니다.

## Deploy URL
`https://planner-sigma-self.vercel.app`
