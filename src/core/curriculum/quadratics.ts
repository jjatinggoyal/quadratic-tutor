import type { Curriculum } from "../types";

// NCERT Class 10, Chapter 4 (Quadratic Equations).
//
// The curriculum is data, not prompt text. Every check item carries a machine-
// checkable answer so grading never depends on the LLM's judgement, and every
// strategy carries a canned fallback script so the tutor can keep teaching
// when the LLM is down.
//
// IDs are stable and stored in the database. Never reuse an ID for different
// content; add a new one and bump `version` instead (see DESIGN.md, Iterability).

export const quadratics: Curriculum = {
  id: "ncert10-quadratics",
  version: "2026-09-28.4",
  title: "Quadratic Equations (NCERT Class 10)",
  subconcepts: [
    // ------------------------------------------------------------------
    {
      id: "standard_form",
      title: "Standard form and recognising a quadratic",
      objective:
        "Recognise a quadratic equation and write it in the form ax^2 + bx + c = 0 with a ≠ 0, simplifying first when needed.",
      keyFacts: [
        "A quadratic equation can be written as ax^2 + bx + c = 0 where a, b, c are real numbers and a ≠ 0.",
        "The highest power of x must be exactly 2 after simplifying both sides.",
        "Always expand and move everything to one side before deciding: an x^2 term can cancel out, leaving a linear equation.",
        "When moving a term across the equals sign, its sign changes.",
      ],
      strategies: [
        {
          id: "definition",
          name: "Definition and the degree test",
          targets: ["a_zero_ok", "degree_confusion"],
          guidance:
            "State the standard form ax^2 + bx + c = 0 with a ≠ 0. Show one clear quadratic, label a, b and c on the board, and say the test is: highest power of x is exactly 2.",
          fallback: {
            speech:
              "A quadratic equation is any equation that can be written as a x squared plus b x plus c equals zero, where a is not zero. The key test is: after simplifying, the highest power of x is exactly two. In 2 x squared plus 5 x minus 3 equals 0, a is 2, b is 5, and c is minus 3.",
            board: [
              { kind: "math", content: "ax^2 + bx + c = 0,\\quad a \\neq 0" },
              { kind: "math", content: "2x^2 + 5x - 3 = 0 \\;\\Rightarrow\\; a=2,\\ b=5,\\ c=-3" },
            ],
          },
        },
        {
          id: "rearrange_steps",
          name: "Rearrange step by step",
          targets: ["sign_when_moving"],
          guidance:
            "Take an equation that is NOT already in standard form (terms on both sides, brackets). Expand, move everything to the left, collect like terms, then read off a, b, c. Stress that you must simplify before judging.",
          fallback: {
            speech:
              "Let's rearrange step by step. Take 4 x squared equals 3 minus 7 x. Move everything to the left side: 4 x squared plus 7 x minus 3 equals 0. Now it's in standard form, so a is 4, b is 7, and c is minus 3. Always move everything to one side before reading the coefficients.",
            board: [
              { kind: "math", content: "4x^2 = 3 - 7x" },
              { kind: "math", content: "4x^2 + 7x - 3 = 0" },
              { kind: "math", content: "a=4,\\ b=7,\\ c=-3" },
            ],
          },
        },
        {
          id: "contrast_pairs",
          name: "Side-by-side: quadratic or not",
          targets: ["no_simplify", "degree_confusion"],
          guidance:
            "Show a pair of look-alike equations: one where x^2 survives simplification and one where the x^2 terms cancel (e.g. x(x-3) = x^2 + 5 becomes -3x - 5 = 0). Ask what makes the difference.",
          fallback: {
            speech:
              "Look at x times x minus 3 equals x squared plus 5. Both sides have x squared. When we expand and simplify, the x squared terms cancel and we get minus 3 x minus 5 equals 0. That's linear, not quadratic. The x squared has to survive after simplifying.",
            board: [
              { kind: "math", content: "x(x-3) = x^2 + 5" },
              { kind: "math", content: "x^2 - 3x = x^2 + 5" },
              { kind: "math", content: "-3x - 5 = 0 \\quad \\text{(linear, not quadratic)}" },
            ],
          },
        },
      ],
      misconceptions: [
        { id: "no_simplify", description: "Judges by appearance without expanding; misses that x^2 terms cancel (or that x^3 terms cancel)." },
        { id: "a_zero_ok", description: "Thinks a can be 0 in a quadratic." },
        { id: "sign_when_moving", description: "Forgets to change the sign when moving a term to the other side." },
        { id: "degree_confusion", description: "Treats any equation containing x^2 as quadratic, or any x^3 as not quadratic, regardless of simplification." },
      ],
      checks: [
        {
          id: "sf_is_quad_basic",
          text: "Is this a quadratic equation?",
          math: "x^2 - 3x + 2 = 0",
          spoken: "Is x squared minus 3 x plus 2 equals 0 a quadratic equation?",
          answer: { type: "yes_no", value: true },
          solution: "Yes. It is already in the form ax^2 + bx + c = 0 with a = 1, b = -3, c = 2, and a ≠ 0.",
        },
        {
          id: "sf_cancel_linear",
          text: "Is this a quadratic equation?",
          math: "x(x+1) + 8 = (x+2)(x-2)",
          spoken: "Is x times x plus 1, plus 8, equals x plus 2 times x minus 2, a quadratic equation?",
          answer: { type: "yes_no", value: false },
          solution: "No. Expanding gives x^2 + x + 8 = x^2 - 4, so x + 12 = 0, which is linear.",
        },
        {
          id: "sf_cubic_cancels",
          text: "Is this a quadratic equation?",
          math: "x^3 - 4x^2 - x + 1 = (x-2)^3",
          spoken: "Is x cubed minus 4 x squared minus x plus 1 equals x minus 2 whole cubed, a quadratic equation?",
          answer: { type: "yes_no", value: true },
          solution: "Yes. (x-2)^3 = x^3 - 6x^2 + 12x - 8. Subtracting, the x^3 terms cancel: 2x^2 - 13x + 9 = 0, which is quadratic.",
        },
        {
          id: "sf_find_b",
          text: "Write in the form ax² + bx + c = 0 with a > 0. What is b?",
          math: "3x^2 = 5x - 2",
          spoken: "Write 3 x squared equals 5 x minus 2 in standard form, with a positive. What is the value of b?",
          answer: { type: "number", value: "-5" },
          solution: "Move everything left: 3x^2 - 5x + 2 = 0, so a = 3, b = -5, c = 2.",
        },
        {
          id: "sf_find_c",
          text: "Write in the form ax² + bx + c = 0 with a > 0. What is c?",
          math: "x(2x+3) = x^2 + 1",
          spoken: "Write x times 2 x plus 3 equals x squared plus 1 in standard form, with a positive. What is the value of c?",
          answer: { type: "number", value: "-1" },
          solution: "Expand: 2x^2 + 3x = x^2 + 1, so x^2 + 3x - 1 = 0. c = -1.",
        },
      ],
      mastery: { correctInARow: 2, maxReteaches: 2 },
    },

    // ------------------------------------------------------------------
    {
      id: "roots",
      title: "What a root is; checking a root by substitution",
      objective:
        "Understand that a root is a value of x that makes the equation true, and check a candidate root by substituting it.",
      keyFacts: [
        "A real number α is a root of ax^2 + bx + c = 0 if aα^2 + bα + c = 0.",
        "To check a root, substitute it for x and see whether the left side comes out to exactly 0.",
        "A quadratic equation has at most two roots.",
        "Squaring a negative number gives a positive number: (-3)^2 = 9.",
      ],
      strategies: [
        {
          id: "definition",
          name: "A root makes the equation true",
          targets: ["root_vs_coefficient", "close_enough"],
          guidance:
            "Define a root as a value of x that makes the left side equal zero. Substitute one value that works and one that doesn't, side by side on the board.",
          fallback: {
            speech:
              "A root is a value of x that makes the equation true. For x squared minus 7 x plus 12 equals 0, try x equals 3: 9 minus 21 plus 12 is 0, so 3 is a root. Try x equals 1: 1 minus 7 plus 12 is 6, not 0, so 1 is not a root.",
            board: [
              { kind: "math", content: "x^2 - 7x + 12 = 0" },
              { kind: "math", content: "x=3:\\ 9 - 21 + 12 = 0 \\;\\checkmark" },
              { kind: "math", content: "x=1:\\ 1 - 7 + 12 = 6 \\neq 0 \\;\\times" },
            ],
          },
        },
        {
          id: "careful_substitution",
          name: "Substitution with brackets",
          targets: ["negative_square", "arithmetic_slip"],
          guidance:
            "Show a substitution with a NEGATIVE value, writing the value in brackets, e.g. x = -4 in x^2 + 2x - 8: (-4)^2 + 2(-4) - 8. Emphasise that (-4)^2 = +16. Go term by term.",
          fallback: {
            speech:
              "When you substitute, put the value in brackets. Is minus 4 a root of x squared plus 2 x minus 8 equals 0? Minus 4 in brackets, squared, is plus 16. Then 2 times minus 4 is minus 8, then minus 8 again. 16 minus 8 minus 8 is 0, so yes, minus 4 is a root.",
            board: [
              { kind: "math", content: "x^2 + 2x - 8 = 0,\\quad x = -4" },
              { kind: "math", content: "(-4)^2 + 2(-4) - 8" },
              { kind: "math", content: "= 16 - 8 - 8 = 0 \\;\\checkmark" },
            ],
          },
        },
        {
          id: "key_and_lock",
          name: "Key and lock analogy",
          targets: ["close_enough"],
          guidance:
            "Use the analogy: the equation is a lock and each candidate x is a key; the key fits only if the left side turns into exactly 0. Anything other than 0, even 1, means it doesn't fit. Then do one quick numeric example.",
          fallback: {
            speech:
              "Think of the equation as a lock and each value of x as a key. The key fits only if the left side becomes exactly zero. For 3 x squared minus 2 x minus 2 equals 0, try x equals 1: 3 minus 2 minus 2 is minus 1. Close, but not zero, so 1 is not a root.",
            board: [
              { kind: "math", content: "3x^2 - 2x - 2 = 0,\\quad x = 1" },
              { kind: "math", content: "3 - 2 - 2 = -1 \\neq 0 \\;\\Rightarrow\\; \\text{not a root}" },
            ],
          },
        },
      ],
      misconceptions: [
        { id: "negative_square", description: "Squares a negative number to get a negative, e.g. (-3)^2 = -9." },
        { id: "close_enough", description: "Accepts a non-zero result as 'close enough' or misreads what the result should be." },
        { id: "arithmetic_slip", description: "Makes a basic arithmetic error during substitution." },
        { id: "root_vs_coefficient", description: "Confuses a root with a coefficient (a, b or c)." },
      ],
      checks: [
        {
          id: "rt_neg_one_no",
          text: "Is x = −1 a root of this equation?",
          math: "x^2 + 2x - 3 = 0",
          spoken: "Is x equals minus 1 a root of x squared plus 2 x minus 3 equals 0?",
          answer: { type: "yes_no", value: false },
          solution: "(-1)^2 + 2(-1) - 3 = 1 - 2 - 3 = -4 ≠ 0, so no.",
        },
        {
          id: "rt_two_yes",
          text: "Is x = 2 a root of this equation?",
          math: "x^2 - 5x + 6 = 0",
          spoken: "Is x equals 2 a root of x squared minus 5 x plus 6 equals 0?",
          answer: { type: "yes_no", value: true },
          solution: "4 - 10 + 6 = 0, so yes.",
        },
        {
          id: "rt_neg_three_yes",
          text: "Is x = −3 a root of this equation?",
          math: "x^2 + x - 6 = 0",
          spoken: "Is x equals minus 3 a root of x squared plus x minus 6 equals 0?",
          answer: { type: "yes_no", value: true },
          solution: "(-3)^2 + (-3) - 6 = 9 - 3 - 6 = 0, so yes.",
        },
        {
          id: "rt_fraction_yes",
          text: "Is x = 3/2 a root of this equation?",
          math: "2x^2 - x - 3 = 0",
          spoken: "Is x equals 3 by 2 a root of 2 x squared minus x minus 3 equals 0?",
          answer: { type: "yes_no", value: true },
          solution: "2(9/4) - 3/2 - 3 = 9/2 - 3/2 - 3 = 3 - 3 = 0, so yes.",
        },
        {
          id: "rt_one_no",
          text: "Is x = 1 a root of this equation?",
          math: "2x^2 + 3x - 4 = 0",
          spoken: "Is x equals 1 a root of 2 x squared plus 3 x minus 4 equals 0?",
          answer: { type: "yes_no", value: false },
          solution: "2 + 3 - 4 = 1 ≠ 0, so no.",
        },
      ],
      mastery: { correctInARow: 2, maxReteaches: 2 },
    },

    // ------------------------------------------------------------------
    {
      id: "factorisation",
      title: "Solving by factorisation",
      objective:
        "Solve ax^2 + bx + c = 0 by splitting the middle term into two factors and setting each factor to zero.",
      keyFacts: [
        "Find two numbers whose product is a·c and whose sum is b, and use them to split the middle term.",
        "Group and factor to get (px + q)(rx + s) = 0.",
        "If a product is zero, one of the factors is zero, so solve px + q = 0 and rx + s = 0 separately.",
        "The root from the factor (x - 3) is x = +3: the sign flips.",
      ],
      strategies: [
        {
          id: "split_middle",
          name: "Split the middle term",
          targets: ["one_root_only"],
          guidance:
            "Walk through splitting the middle term on a simple monic example: product = ac, sum = b, rewrite, group, factor, set each factor to zero. Write each step as its own board line.",
          fallback: {
            speech:
              "To solve x squared minus 7 x plus 10 equals 0, find two numbers that multiply to 10 and add to minus 7. Those are minus 2 and minus 5. So it factors as x minus 2 times x minus 5 equals 0. Either x minus 2 is 0 or x minus 5 is 0, so x is 2 or 5.",
            board: [
              { kind: "math", content: "x^2 - 7x + 10 = 0" },
              { kind: "text", content: "Product 10, sum −7 → −2 and −5" },
              { kind: "math", content: "(x-2)(x-5) = 0" },
              { kind: "math", content: "x = 2 \\ \\text{or}\\ x = 5" },
            ],
          },
        },
        {
          id: "factor_pair_table",
          name: "Factor-pair table",
          targets: ["wrong_pair", "non_monic_split"],
          guidance:
            "Make a small table listing factor pairs of a·c and their sums, and circle the pair that gives b. Use a non-monic example like 3x^2 - 7x + 2. Then finish the factorisation.",
          fallback: {
            speech:
              "Let's use a table. For 3 x squared minus 7 x plus 2, a times c is 6. We need a pair that multiplies to 6 and adds to minus 7. Minus 1 and minus 6 works. Split: 3 x squared minus x minus 6 x plus 2. Group to get 3 x minus 1 times x minus 2. So x is one third or 2.",
            board: [
              { kind: "math", content: "3x^2 - 7x + 2 = 0,\\quad ac = 6" },
              { kind: "text", content: "Pairs of 6: (−1,−6) sum −7 ✓   (−2,−3) sum −5" },
              { kind: "math", content: "3x^2 - x - 6x + 2 = x(3x-1) - 2(3x-1)" },
              { kind: "math", content: "(3x-1)(x-2)=0 \\Rightarrow x = \\tfrac13,\\ 2" },
            ],
          },
        },
        {
          id: "sign_check",
          name: "Why the sign flips",
          targets: ["root_sign_flip"],
          guidance:
            "Focus on the zero-product step and signs: (x + 5) = 0 means x = -5, not +5. Verify each root by substituting back into the original equation, so the student sees why.",
          fallback: {
            speech:
              "Focus on the last step. If x plus 5 times x minus 2 equals 0, then x plus 5 is 0, which means x is minus 5. And x minus 2 is 0 means x is plus 2. The sign flips. Check in x squared plus 3 x minus 10: minus 5 squared is 25, minus 15 is 10, minus 10 is 0. It works.",
            board: [
              { kind: "math", content: "x^2 + 3x - 10 = (x+5)(x-2) = 0" },
              { kind: "math", content: "x + 5 = 0 \\Rightarrow x = -5" },
              { kind: "math", content: "x - 2 = 0 \\Rightarrow x = 2" },
              { kind: "math", content: "\\text{check: } 25 - 15 - 10 = 0 \\;\\checkmark" },
            ],
          },
        },
      ],
      misconceptions: [
        { id: "root_sign_flip", description: "Takes roots with the wrong sign, e.g. (x-2)(x-3) = 0 gives x = -2, -3." },
        { id: "wrong_pair", description: "Chooses a pair that matches only the product or only the sum." },
        { id: "one_root_only", description: "Gives only one of the two roots." },
        { id: "non_monic_split", description: "With a ≠ 1, uses product c instead of a·c, or forgets to divide by the leading coefficient." },
      ],
      checks: [
        {
          id: "fa_monic_neg",
          text: "Solve by factorisation.",
          math: "x^2 - 3x - 10 = 0",
          spoken: "Solve x squared minus 3 x minus 10 equals 0 by factorisation. What are the roots?",
          answer: { type: "number_set", values: ["5", "-2"] },
          solution: "Pair -5 and 2: (x-5)(x+2) = 0, so x = 5 or x = -2.",
        },
        {
          id: "fa_monic_pos",
          text: "Solve by factorisation.",
          math: "x^2 - 5x + 6 = 0",
          spoken: "Solve x squared minus 5 x plus 6 equals 0 by factorisation. What are the roots?",
          answer: { type: "number_set", values: ["2", "3"] },
          solution: "(x-2)(x-3) = 0, so x = 2 or x = 3.",
        },
        {
          id: "fa_monic_mixed",
          text: "Solve by factorisation.",
          math: "x^2 + x - 12 = 0",
          spoken: "Solve x squared plus x minus 12 equals 0 by factorisation. What are the roots?",
          answer: { type: "number_set", values: ["-4", "3"] },
          solution: "Pair 4 and -3 (product -12, sum 1): (x+4)(x-3) = 0, so x = -4 or x = 3.",
        },
        {
          id: "fa_nonmonic",
          text: "Solve by factorisation.",
          math: "2x^2 - 7x + 3 = 0",
          spoken: "Solve 2 x squared minus 7 x plus 3 equals 0 by factorisation. What are the roots?",
          answer: { type: "number_set", values: ["1/2", "3"] },
          solution: "ac = 6, pair -1 and -6: 2x^2 - x - 6x + 3 = (2x-1)(x-3) = 0, so x = 1/2 or x = 3.",
        },
        {
          id: "fa_nonmonic_mixed",
          text: "Solve by factorisation.",
          math: "6x^2 - x - 2 = 0",
          spoken: "Solve 6 x squared minus x minus 2 equals 0 by factorisation. What are the roots?",
          answer: { type: "number_set", values: ["2/3", "-1/2"] },
          solution: "ac = -12, pair -4 and 3: 6x^2 - 4x + 3x - 2 = (3x-2)(2x+1) = 0, so x = 2/3 or x = -1/2.",
        },
      ],
      mastery: { correctInARow: 2, maxReteaches: 2 },
    },

    // ------------------------------------------------------------------
    {
      id: "quadratic_formula",
      title: "The quadratic formula",
      objective: "Solve any quadratic with x = (-b ± √(b² - 4ac)) / 2a, identifying a, b, c correctly.",
      keyFacts: [
        "For ax^2 + bx + c = 0 with b^2 - 4ac ≥ 0, x = (-b ± √(b^2 - 4ac)) / (2a).",
        "Identify a, b and c with their signs, from standard form, before substituting.",
        "-b means the opposite of b: if b = -7 then -b = +7.",
        "The whole numerator, not just the square root, is divided by 2a.",
        "Where it comes from (completing the square): divide by a to get x^2 + (b/a)x = -c/a; add (b/2a)^2 to both sides to get (x + b/2a)^2 = (b^2 - 4ac)/4a^2; take square roots: x + b/2a = ±√(b^2 - 4ac)/2a; so x = -b/2a ± √(b^2 - 4ac)/2a. The -b appears because b/2a is moved to the other side.",
      ],
      strategies: [
        {
          id: "plug_in_steps",
          name: "Identify, substitute, simplify",
          targets: ["abc_misidentified", "partial_division"],
          guidance:
            "Three explicit steps on the board: (1) write a, b, c; (2) compute b^2 - 4ac; (3) substitute into the formula and split into + and - cases.",
          fallback: {
            speech:
              "The formula is x equals minus b, plus or minus the square root of b squared minus 4 a c, all over 2 a. For x squared minus 3 x minus 4, a is 1, b is minus 3, c is minus 4. b squared minus 4 a c is 9 plus 16, which is 25. So x is 3 plus or minus 5, over 2. That's 4, or minus 1.",
            board: [
              { kind: "math", content: "x = \\dfrac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}" },
              { kind: "math", content: "x^2 - 3x - 4 = 0:\\ a=1,\\ b=-3,\\ c=-4" },
              { kind: "math", content: "b^2 - 4ac = 9 + 16 = 25" },
              { kind: "math", content: "x = \\dfrac{3 \\pm 5}{2} = 4,\\ -1" },
            ],
          },
        },
        {
          id: "bracket_signs",
          name: "Brackets for every value",
          targets: ["minus_b_sign", "discriminant_arith"],
          guidance:
            "Focus on sign errors: substitute every value in brackets, e.g. -(-3) and (-3)^2, and show why -b becomes positive when b is negative. Use an example with negative b and negative c.",
          fallback: {
            speech:
              "Put every value in brackets. For 2 x squared plus 3 x minus 2, a is 2, b is 3, c is minus 2. b squared minus 4 a c is 9 minus 4 times 2 times minus 2, which is 9 plus 16, so 25. x is minus 3 plus or minus 5, over 4. That's one half, or minus 2.",
            board: [
              { kind: "math", content: "2x^2 + 3x - 2 = 0:\\ a=2,\\ b=3,\\ c=-2" },
              { kind: "math", content: "(3)^2 - 4(2)(-2) = 9 + 16 = 25" },
              { kind: "math", content: "x = \\dfrac{-3 \\pm 5}{4} = \\tfrac12,\\ -2" },
            ],
          },
        },
        {
          id: "check_by_factoring",
          name: "Cross-check with factorisation",
          targets: [],
          guidance:
            "Solve an easy factorable equation with the formula, then show factorisation gives the same answer, so the formula feels trustworthy. Point out the formula works even when factorising is hard.",
          fallback: {
            speech:
              "Let's check the formula against factorisation. For 2 x squared minus 5 x plus 2, b squared minus 4 a c is 25 minus 16, which is 9. So x is 5 plus or minus 3, over 4. That's 2, or one half. Factorising gives 2 x minus 1 times x minus 2, the same roots.",
            board: [
              { kind: "math", content: "2x^2 - 5x + 2 = 0" },
              { kind: "math", content: "x = \\dfrac{5 \\pm \\sqrt{9}}{4} = 2,\\ \\tfrac12" },
              { kind: "math", content: "(2x-1)(x-2) = 0 \\;\\checkmark" },
            ],
          },
        },
      ],
      misconceptions: [
        { id: "minus_b_sign", description: "Uses b instead of -b, or mishandles -b when b is negative." },
        { id: "partial_division", description: "Divides only the square-root term by 2a, or divides by a instead of 2a." },
        { id: "discriminant_arith", description: "Arithmetic or sign error inside b^2 - 4ac (especially when c < 0)." },
        { id: "abc_misidentified", description: "Reads a, b, c with wrong signs or from a non-standard-form equation." },
      ],
      checks: [
        {
          id: "qf_basic",
          text: "Solve using the quadratic formula.",
          math: "2x^2 - 7x + 3 = 0",
          spoken: "Use the quadratic formula to solve 2 x squared minus 7 x plus 3 equals 0. What are the roots?",
          answer: { type: "number_set", values: ["3", "1/2"] },
          solution: "a=2, b=-7, c=3; b^2-4ac = 49-24 = 25; x = (7 ± 5)/4 = 3 or 1/2.",
        },
        {
          id: "qf_neg_c",
          text: "Solve using the quadratic formula.",
          math: "x^2 + 4x - 5 = 0",
          spoken: "Use the quadratic formula to solve x squared plus 4 x minus 5 equals 0. What are the roots?",
          answer: { type: "number_set", values: ["1", "-5"] },
          solution: "a=1, b=4, c=-5; b^2-4ac = 16+20 = 36; x = (-4 ± 6)/2 = 1 or -5.",
        },
        {
          id: "qf_thirds",
          text: "Solve using the quadratic formula.",
          math: "3x^2 - 5x + 2 = 0",
          spoken: "Use the quadratic formula to solve 3 x squared minus 5 x plus 2 equals 0. What are the roots?",
          answer: { type: "number_set", values: ["1", "2/3"] },
          solution: "a=3, b=-5, c=2; b^2-4ac = 25-24 = 1; x = (5 ± 1)/6 = 1 or 2/3.",
        },
        {
          id: "qf_mixed",
          text: "Solve using the quadratic formula.",
          math: "2x^2 + x - 6 = 0",
          spoken: "Use the quadratic formula to solve 2 x squared plus x minus 6 equals 0. What are the roots?",
          answer: { type: "number_set", values: ["3/2", "-2"] },
          solution: "a=2, b=1, c=-6; b^2-4ac = 1+48 = 49; x = (-1 ± 7)/4 = 3/2 or -2.",
        },
        {
          id: "qf_repeated",
          text: "Solve using the quadratic formula.",
          math: "x^2 - 6x + 9 = 0",
          spoken: "Use the quadratic formula to solve x squared minus 6 x plus 9 equals 0. What is the root?",
          answer: { type: "number_set", values: ["3"] },
          solution: "a=1, b=-6, c=9; b^2-4ac = 36-36 = 0; x = 6/2 = 3 (a repeated root).",
        },
      ],
      mastery: { correctInARow: 2, maxReteaches: 2 },
    },

    // ------------------------------------------------------------------
    {
      id: "discriminant",
      title: "Discriminant and nature of roots",
      objective:
        "Compute D = b^2 - 4ac and use its sign to decide whether the roots are two distinct real, two equal real, or not real.",
      keyFacts: [
        "The discriminant is D = b^2 - 4ac.",
        "D > 0: two distinct real roots.",
        "D = 0: two equal real roots (one repeated root).",
        "D < 0: no real roots.",
      ],
      strategies: [
        {
          id: "three_cases",
          name: "The three cases",
          targets: ["case_swap", "zero_means_none"],
          guidance:
            "Write D = b^2 - 4ac and a three-row table (D > 0, D = 0, D < 0) with the nature of roots. Compute D for one example and point at the matching row.",
          fallback: {
            speech:
              "The discriminant is b squared minus 4 a c. If it's positive, there are two different real roots. If it's zero, there are two equal roots. If it's negative, there are no real roots. For x squared plus 2 x plus 5, it's 4 minus 20, which is minus 16. That's negative, so no real roots.",
            board: [
              { kind: "math", content: "D = b^2 - 4ac" },
              { kind: "text", content: "D > 0: two distinct real · D = 0: two equal real · D < 0: no real roots" },
              { kind: "math", content: "x^2 + 2x + 5:\\ D = 4 - 20 = -16 < 0" },
            ],
          },
        },
        {
          id: "inside_the_root",
          name: "It's what's under the square root",
          targets: ["case_swap", "zero_means_none"],
          guidance:
            "Connect D to the formula: D sits under the square root in x = (-b ± √D)/2a. ±√D gives two values when D > 0, the same value twice when D = 0, and no real square root when D < 0.",
          fallback: {
            speech:
              "Look at the formula: minus b plus or minus the square root of D, over 2 a. If D is positive, plus root D and minus root D give two different answers. If D is zero, both give the same answer. If D is negative, there is no real square root, so there are no real roots.",
            board: [
              { kind: "math", content: "x = \\dfrac{-b \\pm \\sqrt{D}}{2a}" },
              { kind: "text", content: "√D real & non-zero → 2 roots; √0 = 0 → 1 repeated root; √(negative) → none" },
            ],
          },
        },
        {
          id: "careful_d",
          name: "Compute D carefully",
          targets: ["d_sign_error", "b_not_squared"],
          guidance:
            "Focus on computing D correctly with signs: write b, a, c in brackets and show that -4ac becomes + when a·c is negative. Do one example where c is negative and one where D = 0.",
          fallback: {
            speech:
              "Let's compute D carefully. For x squared plus 5 x minus 6, a is 1, b is 5, c is minus 6. D is 5 squared minus 4 times 1 times minus 6. That's 25 plus 24, which is 49. Positive, so two distinct real roots. Watch the sign when c is negative.",
            board: [
              { kind: "math", content: "x^2 + 5x - 6:\\ D = (5)^2 - 4(1)(-6)" },
              { kind: "math", content: "= 25 + 24 = 49 > 0" },
            ],
          },
        },
      ],
      misconceptions: [
        { id: "d_sign_error", description: "Sign error in -4ac, especially when a·c is negative." },
        { id: "case_swap", description: "Mixes up the cases, e.g. thinks negative D means two roots." },
        { id: "zero_means_none", description: "Thinks D = 0 means no roots." },
        { id: "b_not_squared", description: "Uses b instead of b^2." },
      ],
      checks: [
        {
          id: "dc_negative",
          text: "What is the nature of the roots?",
          math: "2x^2 - 3x + 5 = 0",
          spoken: "What is the nature of the roots of 2 x squared minus 3 x plus 5 equals 0?",
          answer: {
            type: "choice",
            options: natureOptions(),
            value: "no_real",
          },
          solution: "D = 9 - 40 = -31 < 0, so there are no real roots.",
        },
        {
          id: "dc_zero",
          text: "What is the nature of the roots?",
          math: "x^2 - 4x + 4 = 0",
          spoken: "What is the nature of the roots of x squared minus 4 x plus 4 equals 0?",
          answer: { type: "choice", options: natureOptions(), value: "two_equal" },
          solution: "D = 16 - 16 = 0, so there are two equal real roots.",
        },
        {
          id: "dc_positive",
          text: "What is the nature of the roots?",
          math: "2x^2 - 6x + 3 = 0",
          spoken: "What is the nature of the roots of 2 x squared minus 6 x plus 3 equals 0?",
          answer: { type: "choice", options: natureOptions(), value: "two_distinct" },
          solution: "D = 36 - 24 = 12 > 0, so there are two distinct real roots.",
        },
        {
          id: "dc_value",
          text: "What is the value of the discriminant?",
          math: "x^2 + 3x - 4 = 0",
          spoken: "What is the discriminant of x squared plus 3 x minus 4 equals 0?",
          answer: { type: "number", value: "25" },
          solution: "D = 9 - 4(1)(-4) = 9 + 16 = 25.",
        },
        {
          id: "dc_root3",
          text: "What is the nature of the roots?",
          math: "3x^2 - 4\\sqrt{3}\\,x + 4 = 0",
          spoken: "What is the nature of the roots of 3 x squared minus 4 root 3 x plus 4 equals 0?",
          answer: { type: "choice", options: natureOptions(), value: "two_equal" },
          solution: "D = (4√3)^2 - 4(3)(4) = 48 - 48 = 0, so there are two equal real roots.",
        },
        {
          id: "dc_no_real_simple",
          text: "What is the nature of the roots?",
          math: "x^2 + x + 1 = 0",
          spoken: "What is the nature of the roots of x squared plus x plus 1 equals 0?",
          answer: { type: "choice", options: natureOptions(), value: "no_real" },
          solution: "D = 1 - 4 = -3 < 0, so there are no real roots.",
        },
      ],
      mastery: { correctInARow: 2, maxReteaches: 2 },
    },

    // ------------------------------------------------------------------
    {
      id: "word_problems",
      title: "Word problems",
      objective:
        "Translate a situation into a quadratic equation, solve it, and keep only the roots that make sense in context.",
      keyFacts: [
        "Choose what x stands for and write it down.",
        "Express every other quantity in terms of x, then form the equation.",
        "Solve the quadratic by factorisation or the formula.",
        "Reject roots that don't make sense (negative lengths, non-integers when integers are asked for).",
      ],
      strategies: [
        {
          id: "let_x_be",
          name: "Let x be…",
          targets: ["wrong_equation", "stops_at_equation"],
          guidance:
            "Model the four steps on one problem (e.g. consecutive integers with product 132): let x be…, express the other quantity, form the equation, solve, then check the context.",
          fallback: {
            speech:
              "Four steps. One: let x be the smaller integer, so the next is x plus 1. Two: their product is 132, so x times x plus 1 equals 132. Three: x squared plus x minus 132 equals 0, which factors as x plus 12 times x minus 11. Four: we need positive integers, so x is 11, and the numbers are 11 and 12.",
            board: [
              { kind: "text", content: "Let x = smaller integer; next = x + 1" },
              { kind: "math", content: "x(x+1) = 132 \\Rightarrow x^2 + x - 132 = 0" },
              { kind: "math", content: "(x+12)(x-11) = 0" },
              { kind: "text", content: "Positive → x = 11; integers are 11 and 12" },
            ],
          },
        },
        {
          id: "picture_it",
          name: "Draw it first",
          targets: ["wrong_equation", "keeps_invalid_root"],
          guidance:
            "For a geometry problem (e.g. a rectangle whose length is 3 more than its breadth, area 40), describe a labelled sketch on the board with sides in terms of x, then form the equation from area or Pythagoras. Reject the negative root explicitly.",
          fallback: {
            speech:
              "Draw it first. A rectangle has breadth x and length x plus 3, and its area is 40. So x times x plus 3 equals 40. That gives x squared plus 3 x minus 40 equals 0, so x plus 8 times x minus 5 is 0. A length can't be negative, so the breadth is 5 and the length is 8.",
            board: [
              { kind: "text", content: "Breadth = x, length = x + 3, area = 40" },
              { kind: "math", content: "x(x+3) = 40" },
              { kind: "math", content: "x^2 + 3x - 40 = 0 \\Rightarrow (x+8)(x-5) = 0" },
              { kind: "text", content: "Length > 0 → breadth 5, length 8" },
            ],
          },
        },
        {
          id: "check_in_story",
          name: "Check the answer in the story",
          targets: ["keeps_invalid_root", "stops_at_equation", "algebra_slip"],
          guidance:
            "Emphasise the final step: plug the answer back into the original words (not the equation) to verify, and discard roots that fail the story's conditions.",
          fallback: {
            speech:
              "Always check the answer against the story. If the sum of two numbers is 15 and their product is 56, we get x squared minus 15 x plus 56 equals 0, so x is 7 or 8. Check: 7 plus 8 is 15, and 7 times 8 is 56. The numbers are 7 and 8.",
            board: [
              { kind: "math", content: "x(15 - x) = 56 \\Rightarrow x^2 - 15x + 56 = 0" },
              { kind: "math", content: "(x-7)(x-8) = 0" },
              { kind: "text", content: "Check: 7 + 8 = 15 ✓   7 × 8 = 56 ✓" },
            ],
          },
        },
      ],
      misconceptions: [
        { id: "wrong_equation", description: "Forms the wrong equation from the words." },
        { id: "keeps_invalid_root", description: "Keeps a root that doesn't fit the context (negative length, negative when positive asked)." },
        { id: "stops_at_equation", description: "Forms or solves the equation but doesn't answer the actual question asked." },
        { id: "algebra_slip", description: "Sets up correctly but makes an algebra or arithmetic slip." },
      ],
      checks: [
        {
          id: "wp_consecutive",
          text: "The product of two consecutive positive integers is 306. Find the integers.",
          spoken: "The product of two consecutive positive integers is 306. What are the two integers?",
          answer: { type: "number_set", values: ["17", "18"] },
          solution: "x(x+1) = 306 → x^2 + x - 306 = 0 → (x+18)(x-17) = 0 → x = 17 (positive), so 17 and 18.",
        },
        {
          id: "wp_rectangle",
          text: "A rectangular plot has area 528 m². Its length is one metre more than twice its breadth. Find the breadth.",
          spoken: "A rectangular plot has area 528 square metres. Its length is one metre more than twice its breadth. What is the breadth?",
          answer: { type: "number", value: "16" },
          solution: "b(2b+1) = 528 → 2b^2 + b - 528 = 0 → D = 4225, √D = 65 → b = (-1 + 65)/4 = 16 m (reject negative).",
        },
        {
          id: "wp_triangle",
          text: "The altitude of a right triangle is 7 cm less than its base. The hypotenuse is 13 cm. Find the base.",
          spoken: "The altitude of a right triangle is 7 centimetres less than its base, and the hypotenuse is 13 centimetres. What is the base?",
          answer: { type: "number", value: "12" },
          solution: "x^2 + (x-7)^2 = 169 → x^2 - 7x - 60 = 0 → (x-12)(x+5) = 0 → base = 12 cm.",
        },
        {
          id: "wp_sum_product",
          text: "Find two numbers whose sum is 27 and product is 182.",
          spoken: "Find two numbers whose sum is 27 and whose product is 182.",
          answer: { type: "number_set", values: ["13", "14"] },
          solution: "x(27-x) = 182 → x^2 - 27x + 182 = 0 → (x-13)(x-14) = 0 → 13 and 14.",
        },
        {
          id: "wp_reciprocal",
          text: "The sum of a number and its reciprocal is 10/3. Find both possible values of the number.",
          spoken: "The sum of a number and its reciprocal is 10 by 3. What are the two possible values of the number?",
          answer: { type: "number_set", values: ["3", "1/3"] },
          solution: "x + 1/x = 10/3 → 3x^2 - 10x + 3 = 0 → (3x-1)(x-3) = 0 → x = 3 or 1/3.",
        },
      ],
      mastery: { correctInARow: 2, maxReteaches: 2 },
    },
  ],
};

function natureOptions() {
  return [
    { id: "two_distinct", label: "Two distinct real roots" },
    { id: "two_equal", label: "Two equal real roots" },
    { id: "no_real", label: "No real roots" },
  ];
}
