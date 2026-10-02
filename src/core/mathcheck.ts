// Tiny evaluator for the simple LaTeX equations the curriculum uses
// ("2x^2 - 7x + 3 = 0", "x(x+1) + 8 = (x+2)(x-2)", "3x^2 - 4\sqrt{3}\,x + 4 = 0",
// "-x^2 + 5x - 6 = 0"). Used by the curriculum lint (to verify answer keys) and
// by the engine's answer-leak guard. Returns null for anything it doesn't understand.
//
// It is a real parser, not string evaluation: Cloudflare Workers forbid
// `new Function`/`eval`, so an evaluator built on them silently fails in production.

type Expr = (x: number) => number;

export function equationFn(latex: string): ((x: number) => number) | null {
  const sides = latex
    .replace(/\\,|\\;|\\!|\\quad|\s/g, "")
    .replace(/\\left|\\right/g, "")
    .replace(/\\cdot|\\times/g, "*")
    .split("=");
  if (sides.length !== 2) return null;
  const lhs = parse(sides[0]);
  const rhs = parse(sides[1]);
  if (!lhs || !rhs) return null;
  const f = (x: number) => lhs(x) - rhs(x);
  return Number.isFinite(f(0.5)) ? f : null;
}

/**
 * Recursive-descent parser:
 *   sum     := product (("+" | "-") product)*
 *   product := unary (("*" | "/")? unary)*        -- juxtaposition is multiplication: 2x, x(x+1), (x+2)(x-2)
 *   unary   := "-" unary | power
 *   power   := atom ("^" (digit | "{" sum "}"))?
 *   atom    := number | "x" | "(" sum ")" | "\sqrt{" sum "}" | "\frac{" sum "}{" sum "}"
 * Note -x^2 parses as -(x^2), as in maths.
 */
function parse(src: string): Expr | null {
  let i = 0;
  const peek = () => src[i];
  const eat = (s: string) => (src.startsWith(s, i) ? ((i += s.length), true) : false);

  function sum(): Expr | null {
    let left = product();
    while (left && (peek() === "+" || peek() === "-")) {
      const op = src[i++];
      const right = product();
      if (!right) return null;
      const l = left;
      left = op === "+" ? (x) => l(x) + right(x) : (x) => l(x) - right(x);
    }
    return left;
  }

  function product(): Expr | null {
    let left = unary();
    while (left) {
      if (peek() === "*" || peek() === "/") {
        const op = src[i++];
        const right = unary();
        if (!right) return null;
        const l = left;
        left = op === "*" ? (x) => l(x) * right(x) : (x) => l(x) / right(x);
      } else if (peek() !== undefined && /[\dx(\\]/.test(peek()!)) {
        const right = unary();
        if (!right) return null;
        const l = left;
        left = (x) => l(x) * right(x);
      } else break;
    }
    return left;
  }

  function unary(): Expr | null {
    if (eat("-")) {
      const e = unary();
      return e ? (x) => -e(x) : null;
    }
    if (eat("+")) return unary();
    return power();
  }

  function power(): Expr | null {
    const base = atom();
    if (!base || !eat("^")) return base;
    let exp: Expr | null;
    if (eat("{")) {
      exp = sum();
      if (!eat("}")) return null;
    } else {
      const m = src.slice(i).match(/^\d/);
      if (!m) return null;
      i += 1;
      const n = Number(m[0]);
      exp = () => n;
    }
    if (!exp) return null;
    const e = exp;
    return (x) => Math.pow(base(x), e(x));
  }

  function atom(): Expr | null {
    const num = src.slice(i).match(/^\d+(\.\d+)?/);
    if (num) {
      i += num[0].length;
      const n = Number(num[0]);
      return () => n;
    }
    if (eat("x")) return (x) => x;
    if (eat("(")) {
      const e = sum();
      return e && eat(")") ? e : null;
    }
    if (eat("\\sqrt{")) {
      const e = sum();
      return e && eat("}") ? (x) => Math.sqrt(e(x)) : null;
    }
    if (eat("\\frac{") || eat("\\dfrac{") || eat("\\tfrac{")) {
      const n = sum();
      if (!n || !eat("}{")) return null;
      const d = sum();
      return d && eat("}") ? (x) => n(x) / d(x) : null;
    }
    return null;
  }

  const e = sum();
  return e && i === src.length ? e : null;
}

/** a, b, c of lhs - rhs, sampled at -1, 0, 1 (exact when the degree is at most 2). */
export function quadraticCoefficients(f: (x: number) => number) {
  const c = f(0);
  const p = f(1);
  const m = f(-1);
  return { a: (p + m) / 2 - c, b: (p - m) / 2, c };
}

/**
 * True if two equations are close enough that teaching with one gives away the
 * other: the same quadratic up to scaling (2x^2 - 10x + 12 vs x^2 - 5x + 6), or
 * its mirror with b negated (x^2 + 5x + 6 vs x^2 - 5x + 6), whose roots are the
 * same numbers with the signs flipped. Different roots (x^2 - 5x - 6) are fine.
 */
export function nearDuplicate(latexA: string, latexB: string): boolean {
  const fa = equationFn(latexA);
  const fb = equationFn(latexB);
  if (!fa || !fb) return false;
  const norm = (f: (x: number) => number) => {
    const { a, b, c } = quadraticCoefficients(f);
    return Math.abs(a) < 1e-9 ? null : [1, b / a, c / a];
  };
  const x = norm(fa);
  const y = norm(fb);
  if (!x || !y) return false;
  const same = (u: number[], v: number[]) => u.every((n, i) => Math.abs(n - v[i]) < 1e-6);
  return same(x, y) || same(x, [y[0], -y[1], y[2]]);
}
