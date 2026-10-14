// Glob matching for test-runner scopes and config globs, over repo-relative posix paths.

/** Minimal glob → RegExp: `**`, `*`, `?`, `[..]`, `{a,b}` and the extglobs `?(…) *(…) +(…) @(…)`. */
export function globToRegExp(glob: string): RegExp {
  let source = '';
  const groups: string[] = [];
  for (let index = 0; index < glob.length; index++) {
    const char = glob[index]!;
    const next = glob[index + 1];
    if ('?*+@'.includes(char) && next === '(') {
      groups.push(char === '@' ? ')' : `)${char}`);
      source += '(?:';
      index++;
    } else if (char === ')' && groups.length) source += groups.pop();
    else if (char === '|' && groups.length) source += '|';
    else if (char === '*' && next === '*') {
      source += glob[index + 2] === '/' ? '(?:.*/)?' : '.*';
      index += glob[index + 2] === '/' ? 2 : 1;
    } else if (char === '*') source += '[^/]*';
    else if (char === '?') source += '[^/]';
    else if (char === '{') {
      groups.push(')');
      source += '(?:';
    } else if (char === '}' && groups.length) source += groups.pop();
    else if (char === ',' && groups.length) source += '|';
    else if (char === '[') {
      const close = glob.indexOf(']', index);
      source += glob.slice(index, close + 1);
      index = close;
    } else source += char.replace(/[.^$()|\\]/g, '\\$&');
  }
  return new RegExp(`^${source}$`);
}
