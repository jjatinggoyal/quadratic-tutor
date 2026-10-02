// Tiny evaluator for the simple LaTeX equations the curriculum uses
// ("2x^2 - 7x + 3 = 0", "x(x+1) + 8 = (x+2)(x-2)", "3x^2 - 4\sqrt{3}\,x + 4 = 0").
// Used by the curriculum lint (to verify answer keys) and by the engine's
// answer-leak guard. Returns null for anything it doesn't understand.

export function equationFn(latex: string): ((x: number) => number) | null {
  let s = latex
    .replace(/\\,|\s/g, "")
    .replace(/\\sqrt\{([^}]*)\}/g, "S($1)")
    .replace(/\^/g, "**");
  s = s.replace(/(\d)(?=[xS(])/g, "$1*").replace(/\)(?=[\dxS(])/g, ")*").replace(/x(?=[\dS(])/g, "x*");
  const sides = s.split("=");
  if (sides.length !== 2 || !sides[0] || !sides[1] || /[^\dx+\-*/().S]/.test(sides.join(""))) return null;
  try {
    const fn = new Function("x", "S", `return (${sides[0]}) - (${sides[1]});`) as (x: number, S: (n: number) => number) => number;
    const f = (x: number) => fn(x, Math.sqrt);
    return Number.isFinite(f(0.5)) ? f : null;
  } catch {
    return null;
  }
}

/** a, b, c of lhs - rhs, sampled at -1, 0, 1 (exact when the degree is at most 2). */
export function quadraticCoefficients(f: (x: number) => number) {
  const c = f(0);
  const p = f(1);
  const m = f(-1);
  return { a: (p + m) / 2 - c, b: (p - m) / 2, c };
}

/**
 * True if two equations are the same quadratic up to signs and scaling,
 * e.g. x^2 - 5x + 6 = 0 and x^2 + 5x + 6 = 0: close enough to give the answer away.
 */
export function nearDuplicate(latexA: string, latexB: string): boolean {
  const fa = equationFn(latexA);
  const fb = equationFn(latexB);
  if (!fa || !fb) return false;
  const norm = (f: (x: number) => number) => {
    const { a, b, c } = quadraticCoefficients(f);
    const k = Math.abs(a) > 1e-9 ? Math.abs(a) : 1;
    return [Math.abs(a) / k, Math.abs(b) / k, Math.abs(c) / k];
  };
  const [x, y] = [norm(fa), norm(fb)];
  if (x[0] < 1e-9) return false; // not a quadratic
  return x.every((v, i) => Math.abs(v - y[i]) < 1e-6);
}
