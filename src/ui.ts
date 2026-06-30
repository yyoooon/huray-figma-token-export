import { buildPutBody, contentsUrl } from './github';
import { diffTokens, formatPrBody } from './diff';

const $ = (id: string) => document.getElementById(id) as HTMLInputElement;
const setStatus = (s: string) => ((document.getElementById('status') as HTMLElement).textContent = s);
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

// GitHub Contents API content(개행 섞인 base64, UTF-8) → 문자열
function decodeB64(b64: string): string {
  const bin = atob(b64.replace(/\n/g, ''));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
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

async function doPush(tokens: unknown): Promise<void> {
  refreshDerived(); // 푸시 시점 시각으로 branch 타임스탬프 갱신
  saveSettings();
  const owner = $('owner').value;
  const repo = $('repo').value;
  const project = $('project').value.trim();
  const branch = $('branch').value;
  const path = $('path').value;
  const pat = $('pat').value;
  const api = `https://api.github.com/repos/${owner}/${repo}`;
  const url = contentsUrl(owner, repo, path);
  const headers = { Authorization: `Bearer ${pat}`, Accept: 'application/vnd.github+json' };
  const message = `[수정] ${project} 토큰 갱신`;
  try {
    setStatus('기본 브랜치 확인 중…');
    const repoRes = await fetch(api, { headers });
    if (!repoRes.ok) return setStatus(`레포 접근 실패: ${repoRes.status} (PAT·owner·repo 확인)`);
    const base = (await repoRes.json()).default_branch;

    // base 의 기존 파일 → sha(덮어쓰기용) + 이전 내용(변경 비교용)
    setStatus('변경 비교 중…');
    const fileRes = await fetch(`${url}?ref=${base}`, { headers });
    let sha: string | undefined;
    let oldJson: Record<string, unknown> = {};
    if (fileRes.ok) {
      const f = await fileRes.json();
      sha = f.sha;
      try {
        oldJson = JSON.parse(decodeB64(f.content));
      } catch {
        oldJson = {};
      }
    }

    // 변경이 없으면 브랜치·PR 만들지 않고 일찍 종료 (빈 브랜치/빈 PR 방지)
    const diff = diffTokens(oldJson, tokens as Record<string, unknown>);
    if (!diff.added.length && !diff.changed.length && !diff.removed.length) {
      return setStatus('변경 없음 — 푸시하지 않음 (허브와 동일)');
    }
    const prBody = formatPrBody(diff, project);

    // 브랜치를 base 최신 커밋에 맞춘다.
    // - 없으면 생성, 있으면 force-reset(머지/방치된 옛 브랜치도 깨끗하게 다시 시작).
    const baseRef = await fetch(`${api}/git/ref/heads/${base}`, { headers });
    const baseSha = (await baseRef.json()).object.sha;
    const mkRef = await fetch(`${api}/git/refs`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: baseSha }),
    });
    if (mkRef.status === 422) {
      const reset = await fetch(`${api}/git/refs/heads/${branch}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ sha: baseSha, force: true }),
      });
      if (!reset.ok) return setStatus(`브랜치 리셋 실패: ${reset.status} ${await reset.text()}`);
    } else if (!mkRef.ok) {
      return setStatus(`브랜치 생성 실패: ${mkRef.status} ${await mkRef.text()}`);
    }

    setStatus('푸시 중…');
    const put = await fetch(url, {
      method: 'PUT',
      headers,
      body: JSON.stringify(buildPutBody({ json: tokens, message, branch, sha })),
    });
    if (!put.ok) return setStatus(`푸시 실패: ${put.status} ${await put.text()}`);

    setStatus('PR 생성 중…');
    const prRes = await fetch(`${api}/pulls`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ title: message, head: branch, base, body: prBody }),
    });
    if (prRes.ok) {
      const pr = await prRes.json();
      setStatus(`PR #${pr.number} 생성 완료 ✓ (브라우저에서 열림)`);
      window.open(pr.html_url, '_blank');
      return;
    }
    // 422 = 그 브랜치로 이미 열린 PR 존재 → 방금 푸시로 그 PR이 갱신됨. 찾아서 안내.
    if (prRes.status === 422) {
      const list = await fetch(`${api}/pulls?head=${owner}:${branch}&state=open`, { headers });
      const open = list.ok ? await list.json() : [];
      if (open.length) {
        setStatus(`기존 PR #${open[0].number} 업데이트됨 ✓ (브라우저에서 열림)`);
        window.open(open[0].html_url, '_blank');
        return;
      }
    }
    setStatus(`푸시 완료, PR 실패: ${prRes.status} ${await prRes.text()}`);
  } catch (err) {
    setStatus(`에러: ${String(err)}`);
  }
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
};
