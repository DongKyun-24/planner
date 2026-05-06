# Planner Web Docs

이 폴더는 웹 작업할 때 기준을 다시 찾기 쉽게 만드는 문서 묶음입니다.

## 문서 역할

`PRODUCT_RULES.md`
- 사용자에게 보여야 하는 동작 규칙입니다.

`REGRESSION_CHECKLIST.md`
- 수정 후 무엇을 눌러보고 확인해야 하는지 적는 테스트 문서입니다.

`DECISIONS.md`
- 왜 그렇게 정했는지 기록하는 문서입니다.

`ACCEPTED_NOTES.md`
- 작업하다가 "이 정도면 됐다" 하고 넘어간 것과 그 이유를 적는 문서입니다.

`CURRENT_STATUS.md`
- 지금까지 구현되어 동작하는 것과 다음 작업 후보를 짧게 정리한 문서입니다.

`CODE_SPLIT_RULES.md`
- 파일을 어떤 기준으로 역할 단위로 나눌지 적는 문서입니다.

## 읽는 순서

1. `PRODUCT_RULES.md`
2. `REGRESSION_CHECKLIST.md`
3. `DECISIONS.md`
4. `ACCEPTED_NOTES.md`
5. `CURRENT_STATUS.md`
6. `CODE_SPLIT_RULES.md`

## 언제 업데이트하나

- 동작 규칙이나 UX 기준이 바뀌면 `PRODUCT_RULES.md`
- 같은 버그가 다시 터질 것 같으면 `REGRESSION_CHECKLIST.md`
- 중요한 선택을 했으면 `DECISIONS.md`
- 화면 보고 "이제 됐다" 하고 멈춘 이유를 남기려면 `ACCEPTED_NOTES.md`
- 지금까지 된 기능을 짧게 정리하려면 `CURRENT_STATUS.md`
- 파일을 나누거나 나눌 계획을 정리하면 `CODE_SPLIT_RULES.md`
