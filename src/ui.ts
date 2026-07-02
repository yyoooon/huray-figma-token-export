import { pushTokens } from './push';

const $ = (id: string) => document.getElementById(id) as HTMLInputElement;
const setStatus = (s: string): void => {
  (document.getElementById('status') as HTMLElement).textContent = s;
};
const post = (type: string, extra: Record<string, unknown> = {}) =>
  parent.postMessage({ pluginMessage: { type, ...extra } }, '*');

// branch/path 는 project 에서 파생하므로 저장 대상이 아니다.
// pat 은 편의상 저장하지만 clientStorage 평문 — 공유 PC 주의.
const SETTING_IDS = ['owner', 'repo', 'project', 'pat'] as const;
// export 결과를 어디로 보낼지 — 다운로드(Export 버튼) vs 푸시(Push 버튼).
let pendingIntent: 'download' | 'push' = 'download';

// YYYYMMDD (하루 1 브랜치 — 같은 날 재푸시는 같은 브랜치를 재사용·갱신)
function dateStamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

// project → branch/path 파생. 허브 관례: {project}/tokens.json.
function deriveBranch(project: string): string {
  return project ? `fix/${project}-token-${dateStamp()}` : '';
}
function derivePath(project: string): string {
  return project ? `${project}/tokens.json` : 'tokens.json';
}
function refreshDerived(): void {
  const project = $('project').value.trim();
  $('branch').value = deriveBranch(project);
  $('path').value = derivePath(project);
}

function download(name: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
}

function saveSettings() {
  const settings: Record<string, string> = {};
  for (const k of SETTING_IDS) settings[k] = $(k).value;
  post('save-settings', { settings });
}

// 설정 복원
post('load-settings');

// 프로젝트 이름 입력 시 branch/path 자동 채움
$('project').addEventListener('input', refreshDerived);

document.getElementById('export')?.addEventListener('click', () => {
  pendingIntent = 'download';
  post('export');
});

// Push = 즉석에서 토큰 추출(다운로드 X) → 브랜치 생성 → PUT → PR.
document.getElementById('push')?.addEventListener('click', () => {
  if (!$('project').value.trim()) return setStatus('프로젝트 이름을 입력하세요');
  if (!$('pat').value) return setStatus('GitHub PAT를 입력하세요');
  pendingIntent = 'push';
  setStatus('토큰 추출 중…');
  post('export'); // 결과는 result 핸들러에서 doPush 로 흘러간다(파일 다운로드 없음)
});

// GitHub 흐름은 push.ts(테스트되는 순수 로직)에 있다. 여기선 DOM 값 읽어 넘기고 결과만 표시.
async function doPush(tokens: unknown): Promise<void> {
  refreshDerived(); // 푸시 시점 시각으로 branch 타임스탬프 갱신
  saveSettings();
  const res = await pushTokens(
    {
      owner: $('owner').value,
      repo: $('repo').value,
      project: $('project').value.trim(),
      branch: $('branch').value,
      path: $('path').value,
      pat: $('pat').value,
      tokens,
    },
    { fetch, onStatus: setStatus },
  );
  setStatus(res.message);
  if (res.prUrl) window.open(res.prUrl, '_blank');
}

onmessage = (e: MessageEvent) => {
  const msg = e.data.pluginMessage;
  if (msg?.type === 'settings') {
    for (const k of SETTING_IDS) if (msg.settings[k]) $(k).value = msg.settings[k];
    refreshDerived();
  }
  if (msg?.type === 'result') {
    if (pendingIntent === 'push') {
      void doPush(msg.tokens);
    } else {
      download('tokens.json', msg.tokens);
      setStatus('tokens.json 다운로드됨');
    }
  }
  // 추출·변환 실패(code.ts에서 전달) — 이미 사람이 읽을 문구로 옴.
  if (msg?.type === 'error') {
    setStatus(msg.message);
  }
};
