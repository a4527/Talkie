export const apiErrorMessages: Record<string, string> = {
  WAIT_30_SECONDS: "마지막 요청 후 30초가 지나면 다시 요청할 수 있습니다.",
  SYNTHETIC_EMAIL_REQUIRED: "현재 로컬 시험에서는 example.test 같은 .test 주소를 사용해 주세요.",
  INVALID_EMAIL: "이메일 주소를 확인해 주세요.",
  SERVICE_UNAVAILABLE: "현재 요청을 처리할 수 없습니다.", LOGIN_REQUIRED: "로그인이 필요합니다.",
  INVALID_LINK: "유효한 인증 링크가 아닙니다.", EXPIRED_LINK: "인증 링크가 만료됐습니다.", USED_LINK: "이미 사용한 인증 링크입니다.",
  REPLACED_LINK: "새 요청으로 이전 링크가 무효화됐습니다.", LOGOUT_FIRST: "다른 계정으로 로그인돼 있습니다. 먼저 로그아웃해 주세요.",
  ORIGINAL_BROWSER_REQUIRED: "탈퇴 요청을 시작한 브라우저에서 확인해 주세요.", CONFIRM_DELETE_FIRST: "탈퇴 전에 이메일 본인 확인이 필요합니다.",
  ALREADY_CONNECTED: "다른 탭이나 기기에서 대화가 진행 중입니다. 기존 연결이 중단된 뒤 이어갈 수 있습니다.",
  LEARNING_MODE_CONFLICT: "다른 방식의 학습이 중단돼 있습니다. 기존 학습 화면에서 이어서 하거나 종료해 주세요.",
  SESSION_CLOSING: "이전 대화를 정리하고 있습니다. 잠시 후 다시 시작해 주세요.",
};
