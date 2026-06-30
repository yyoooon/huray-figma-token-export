export function contentsUrl(owner: string, repo: string, path: string): string {
  return `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
}

// btoa는 UTF-8 직접 처리 못 함 → encodeURIComponent 경유로 안전 인코딩.
function toBase64(str: string): string {
  return btoa(
    encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, (_, h) =>
      String.fromCharCode(parseInt(h, 16)),
    ),
  );
}

export function buildPutBody(opts: {
  json: unknown;
  message: string;
  branch: string;
  sha?: string;
}): { message: string; content: string; branch: string; sha?: string } {
  const content = toBase64(JSON.stringify(opts.json, null, 2));
  const body: { message: string; content: string; branch: string; sha?: string } = {
    message: opts.message,
    content,
    branch: opts.branch,
  };
  if (opts.sha) body.sha = opts.sha;
  return body;
}
