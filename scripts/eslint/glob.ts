const SPECIAL = /[.+^$()|[\]\\]/;

function convert(glob: string): string {
  let out = '';
  let i = 0;
  while (i < glob.length) {
    const char = glob.charAt(i);
    if (char === '*' && glob.charAt(i + 1) === '*') {
      if (glob.charAt(i + 2) === '/') {
        out += '(?:.*/)?';
        i += 3;
      } else {
        out += '.*';
        i += 2;
      }
    } else if (char === '*') {
      out += '[^/]*';
      i += 1;
    } else if (char === '?') {
      out += '[^/]';
      i += 1;
    } else if (char === '{') {
      const close = glob.indexOf('}', i);
      if (close === -1) {
        out += '\\{';
        i += 1;
      } else {
        const options = glob.slice(i + 1, close).split(',');
        out += `(?:${options.map(convert).join('|')})`;
        i = close + 1;
      }
    } else {
      out += SPECIAL.test(char) || char === '}' ? `\\${char}` : char;
      i += 1;
    }
  }
  return out;
}

/**
 * A regular expression for a path glob, anchored at both ends: `**` crosses folders, `*` and `?`
 * stay inside one segment, `{a,b}` is a choice. Paths use `/` separators.
 */
export function globToRegExp(glob: string): RegExp {
  return new RegExp(`^${convert(glob)}$`);
}
