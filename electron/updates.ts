const releasePage = 'https://github.com/Mohamed-Eltelb/yap-yap/releases';

export async function checkForUpdate(current: string) {
  const response = await fetch('https://api.github.com/repos/Mohamed-Eltelb/yap-yap/releases/latest', {
    headers: { Accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(8000),
  });
  if (response.status === 404) return { message: 'No public release is available to check.' };
  if (!response.ok) throw new Error('Release check failed');

  const { tag_name: tag } = await response.json() as { tag_name?: string };
  const parse = (version: string) => /^v?(\d+)\.(\d+)\.(\d+)$/.exec(version)?.slice(1).map(Number);
  const latest = typeof tag === 'string' && parse(tag);
  const installed = parse(current);
  if (!latest || !installed) throw new Error('Could not read the release version');
  const difference = latest.map((part, index) => part - installed[index]).find((part) => part !== 0) ?? 0;
  return difference > 0
    ? { message: `Yap Yap v${latest.join('.')} is available.`, url: releasePage }
    : { message: `Yap Yap v${current} is up to date.` };
}
