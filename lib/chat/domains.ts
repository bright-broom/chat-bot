// 検索・出典に使ってよいドメインの判定

/** 検索エンジンに渡すドメイン指定（ドメイン自身とサブドメインの両方） */
export function includeDomains(allowed: readonly string[]): string[] {
  return allowed.flatMap((d) => [d, `*.${d}`]);
}

/** URL が許可ドメイン（またはそのサブドメイン）か */
export function isAllowedUrl(url: string, allowed: readonly string[]): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return allowed.some((d) => host === d || host.endsWith(`.${d}`));
}

/** 出典 URL は http(s) のみ・Markdown を壊す文字を含まない形にして返す */
export function safeCitationUrl(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return u.href.replace(/\(/g, "%28").replace(/\)/g, "%29");
  } catch {
    return null;
  }
}
