/**
 * Минимальная проверка robots.txt: группы User-agent, правила Disallow/Allow по префиксу
 * (побеждает самое длинное совпадение). Поддерживается '*' и '$' в правилах.
 */
export function isAllowedByRobots(robotsTxt: string, userAgent: string, path: string): boolean {
  const ua = userAgent.toLowerCase();
  type Group = { agents: string[]; rules: { allow: boolean; pattern: string }[] };
  const groups: Group[] = [];
  let current: Group | null = null;
  let lastWasAgent = false;

  for (const rawLine of robotsTxt.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (key === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if ((key === 'disallow' || key === 'allow') && current) {
      lastWasAgent = false;
      if (key === 'disallow' && value === '') continue;
      current.rules.push({ allow: key === 'allow', pattern: value });
    } else {
      lastWasAgent = false;
    }
  }

  const specific = groups.filter((g) => g.agents.some((a) => a !== '*' && ua.includes(a)));
  const chosen = specific.length ? specific : groups.filter((g) => g.agents.includes('*'));
  const rules = chosen.flatMap((g) => g.rules);

  let best: { allow: boolean; len: number } | null = null;
  for (const r of rules) {
    if (matches(r.pattern, path) && (!best || r.pattern.length > best.len || (r.pattern.length === best.len && r.allow)))
      best = { allow: r.allow, len: r.pattern.length };
  }
  return best ? best.allow : true;
}

function matches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith('$');
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const re = new RegExp('^' + body.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + (anchored ? '$' : ''));
  return re.test(path);
}
