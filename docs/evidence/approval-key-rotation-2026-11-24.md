# 승인 키 교체·폐기 검증

[운영 절차](../approval-key-rotation.md) · [CLI 훈련 결과](approval-key-rotation-2026-11-24/recovery-drill.json) · [회귀 테스트](../../analysis/approval-key-rotation.test.mjs)

- 원격 witness의 커밋 직후 이관 CLI를 종료했다. 재시작 후 같은 체크포인트를 완료했고, 기존 승인 원문, 정책 revision 및 digest, TUF 도메인 데이터와 하한이 동일했다.
- 이전 요청을 재제출하거나 폐기 키를 사용해 현재 요청에 새로 서명해도 적용이 거절됐다. 같은 키를 새 ID로 재등록하는 시도도 차단했다. 다른 기존 owner와 security가 충분한 경우 폐기 대상 키 없이 제거할 수 있었다.
- 새 키의 소유 증명이나 정족수가 빠진 원격 전이, TUF 하한 변조, 충돌 응답, 동시 재시도, 만료된 미게시 요청을 검사했다. 이미 게시된 동일 전이만 만료 이후 로컬에서 확정할 수 있다.
- 로컬 Node 24.22.3에서 전체 422개(교체 전용 15개 포함), CLI 훈련 4단계, Markdown 100개 검사를 통과했다.
- 검증한 범위는 임시 승인 키, 테스트 TUF 데이터, HTTPS witness 및 로컬 SQLite다. 실제 조직의 키 배포와 폐기, 비상 정족수 복구, 운영 장애 시간 측정은 별도다.
