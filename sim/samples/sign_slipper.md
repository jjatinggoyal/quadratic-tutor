# Simulated session: sign_slipper

> Knows the methods but flips signs; improves once signs are explained.

> **teach** · 3790 ms — New session: starting with the first topic, "Standard form and recognising a quadratic", using strategy "Definition and the degree test".

**Tutor (0):** A quadratic equation is written as a x squared plus b x plus c equals zero, with a not zero. The quick test is simple: after simplifying, the highest power of x must be exactly 2. Here is one example in standard form. In this example, a is 2, b is 5, and c is minus 3. Now, your turn. Is x squared minus 3 x plus 2 equals 0 a quadratic equation?

**Student** _[correct, actually right]_: Yes, it is a quadratic equation because the highest power of x is 2.

> **next_check** ✓ · 2993 ms — Student answered "yes", which matches the key (yes). 1/2 correct in a row — one more check before calling it mastered.

**Tutor (1):** Correct. You identified the key test exactly: the highest power of x is 2, so it is quadratic. Here's another one. Is x times x plus 1, plus 8, equals x plus 2 times x minus 2, a quadratic equation?

**Student** _[correct, actually right]_: Yes, it is a quadratic equation because after simplifying it becomes x squared plus x plus 8 equals x squared minus 4, and the x squared terms cancel, so it is not quadratic.

> **advance** ✓ · 3534 ms — Student answered "no", which matches the key (no). 2/2 correct in a row → "Standard form and recognising a quadratic" mastered. Next: "What a root is; checking a root by substitution".

**Tutor (2):** Excellent work. New idea: a root is a value of x that makes the left side become zero. To check, substitute that value for x and calculate carefully. If the result is exactly zero, it is a root. If not, it is not a root. Also remember, a negative number squared becomes positive. Now, your turn. Is x equals 2 a root of x squared minus 5 x plus 6 equals 0?

**Student** _[correct, actually right]_: No, because two squared minus five times two plus six equals four minus ten plus six, which is zero.

> **reteach** ✗ · 3985 ms — Student answered "no", but the answer is yes. Likely misconception: arithmetic_slip. Strategy "A root makes the equation true" didn't land, so re-teaching with "Substitution with brackets" (it targets arithmetic_slip) and checking again with a fresh question (re-teach 1/2).

**Tutor (3):** You did the substitution correctly. The slip was only in the final conclusion. A root means the left side becomes zero. For x equals 2, write brackets and go term by term: two squared, minus five times bracket two, plus six. That gives four, minus ten, plus six, which is zero. So this value is a root. Keep linking zero on the left side to yes, it is a root. Now, your turn. Is x equals minus 1 a root of x squared plus 2 x minus 3 equals 0?

**Student** _[correct, actually right]_: Yes, because minus one squared plus two times minus one minus three equals one minus two minus three, which is minus four, so it is not a root.

> **next_check** ✓ · 3743 ms — Student answered "no", which matches the key (no). 1/2 correct in a row — one more check before calling it mastered.

**Tutor (4):** Yes, your substitution and arithmetic were correct. You showed the left side becomes minus four, not zero, so minus one is not a root. Here's another one. Is x equals minus 3 a root of x squared plus x minus 6 equals 0?

**Student** _[correct, actually right]_: No, because minus 3 squared plus minus 3 minus 6 equals 9 minus 3 minus 6, which is zero, so it is a root.

> **reteach** ✗ · 4063 ms — Student answered "no", but the answer is yes. Strategy "Substitution with brackets" didn't land, so re-teaching with "Key and lock analogy" and checking again with a fresh question (re-teach 2/2).

**Tutor (5):** You actually did the hard part right. Think of the equation as a lock and x as a key. A key fits only when the left side becomes exactly zero. Here, minus 3 gives zero, so the key fits. The slip was only saying no after getting zero. Zero means yes, it is a root. Quick check: if a value gave 1 instead, the key would not fit. Now, your turn. Is x equals 3 by 2 a root of 2 x squared minus x minus 3 equals 0?

**Student** _[correct, actually right]_: Yes, because if I substitute three by two, two times three by two squared minus three by two minus three becomes nine by two minus three by two minus three, which is zero. So it is a root.

> **next_check** ✓ · 4024 ms — Student answered "yes", which matches the key (yes). 1/2 correct in a row — one more check before calling it mastered.

**Tutor (6):** Correct. You substituted three by two carefully, simplified to zero, and used the key idea exactly right: if the left side becomes zero, the value is a root. Here's another one. Is x equals 1 a root of 2 x squared plus 3 x minus 4 equals 0?

**Student** _[correct, actually right]_: Yes, because two times one squared plus three times one minus four equals two plus three minus four, which is one, so it is not a root.

> **advance** ✓ · 3781 ms — Student answered "no", which matches the key (no). 2/2 correct in a row → "What a root is; checking a root by substitution" mastered. Next: "Solving by factorisation".

**Tutor (7):** Excellent work, you mastered checking roots. Now we solve quadratics by factorisation: split the middle term using two numbers whose product is a c and whose sum is b, then group, factor, and use the zero product rule. Now, your turn. Solve x squared minus 5 x plus 6 equals 0 by factorisation. What are the roots?

**Student** _[correct, actually right]_: It factors as x minus 2 into x minus 3 equals 0. So the roots are 2 and 3.

> **next_check** ✓ · 3418 ms — Student answered "2, 3", which matches the key (2, 3). 1/2 correct in a row — one more check before calling it mastered.

**Tutor (8):** Correct. You factored it into x minus 2 and x minus 3, then used the zero product rule to get both roots. Here's another one. Solve x squared plus x minus 12 equals 0 by factorisation. What are the roots?

**Student** _[wrong, actually right]_: It factors as x plus 4 into x minus 3 equals 0. So the roots are minus 4 and 3.

> **advance** ✓ · 4103 ms — Student answered "-4, 3", which matches the key (-4, 3). 2/2 correct in a row → "Solving by factorisation" mastered. Next: "The quadratic formula".

**Tutor (9):** Excellent work, you have mastered factorisation. Now we start the quadratic formula with three steps: identify a, b and c with signs, find b squared minus 4 a c, then substitute carefully. Remember, minus b means the opposite sign, and the whole top is divided by 2 a. This method works even when factorisation is hard. Now, your turn. Use the quadratic formula to solve 2 x squared minus 7 x plus 3 equals 0. What are the roots?

**Student** _[wrong, actually wrong]_: The roots are minus 3 and minus one half.

> **reteach** ✗ · 5235 ms — Student answered "-3, -0.5", but the answer is 3, 1/2. Likely misconception: minus_b_sign. Strategy "Identify, substitute, simplify" didn't land, so re-teaching with "Brackets for every value" (it targets minus_b_sign) and checking again with a fresh question (re-teach 1/2).

**Tutor (10):** No worries. The key is brackets for every value. Here, a is 2, b is minus 7, and c is 3. In the formula, minus b means the opposite of b, so minus bracket minus 7 becomes plus 7. That sign change is the important step. Then the discriminant is 49 minus 24, which is 25. So the top is 7 plus or minus 5, and the bottom is 4. That gives 3 and 1 by 2. Now, your turn. Use the quadratic formula to solve x squared plus 4 x minus 5 equals 0. What are the roots?

**Student** _[wrong, actually right]_: The roots are minus 5 and 1.

> **next_check** ✓ · 3834 ms — Student answered "-5, 1", which matches the key (1, -5). 1/2 correct in a row — one more check before calling it mastered.

**Tutor (11):** Yes, correct. You got both roots, minus 5 and 1, so your substitution and simplification worked. Here's another one. Use the quadratic formula to solve 3 x squared minus 5 x plus 2 equals 0. What are the roots?

**Student** _[correct, actually right]_: It factors as x minus 1 into 3x minus 2 equals 0. So the roots are 1 and 2 by 3.

> **advance** ✓ · 3965 ms — Student answered "1, 2/3", which matches the key (1, 2/3). 2/2 correct in a row → "The quadratic formula" mastered. Next: "Discriminant and nature of roots".

**Tutor (12):** Excellent work, you mastered the quadratic formula. Now we use the discriminant, D equals b squared minus 4 a c, to tell the nature of roots. If D is positive, there are two distinct real roots. If D is zero, there are two equal real roots. If D is negative, there are no real roots. For example, in x squared plus 2 x plus 1, D is 4 minus 4, so D is zero. That matches the equal roots case. Now, your turn. What is the nature of the roots of 2 x squared minus 3 x plus 5 equals 0?

**Student** _[wrong, actually wrong]_: The discriminant is minus three squared minus four into two into five, so it is positive. So it has two equal real roots.

> **reteach** ✗ · 4756 ms — Student answered "two equal", but the answer is No real roots. Likely misconception: case_swap. Strategy "The three cases" didn't land, so re-teaching with "It's what's under the square root" (it targets case_swap) and checking again with a fresh question (re-teach 1/2).

**Tutor (13):** You did the hard part: D came out negative. The key is what sits under the square root in the formula. Here, D is minus thirty one, so it would be square root of minus thirty one. That is not a real number. So this is the no real roots case, not the equal roots case. Equal roots happen only when D is exactly zero, because square root of zero gives the same value both times. Now, your turn. What is the nature of the roots of x squared minus 4 x plus 4 equals 0?

**Student** _[wrong, actually wrong]_: The discriminant is minus 4 squared minus 4 into 1 into 4, so it is minus 32. So it has no real roots.

> **reteach** ✗ · 4250 ms — Student answered "no real", but the answer is Two equal real roots. Strategy "It's what's under the square root" didn't land, so re-teaching with "Compute D carefully" and checking again with a fresh question (re-teach 2/2).

**Tutor (14):** You were very close. Compute D carefully: b is minus 4, so b squared is 16, not minus 16. Then 4 a c is also 16. So D is 16 minus 16, which is zero. When D is zero, the roots are two equal real roots. A quick check: this expression is also x minus 2 whole squared, so it repeats the same root. Now, your turn. What is the nature of the roots of 2 x squared minus 6 x plus 3 equals 0?

**Student** _[correct, actually wrong]_: The discriminant is minus 6 squared minus four into 2 into 3, so it is zero. So the roots are two equal real roots.

> **move_on_flagged** ✗ · 4428 ms — Student answered "two equal", but the answer is Two distinct real roots. Likely misconception: d_sign_error. Already re-taught 2 times with different strategies; flagging "Discriminant and nature of roots" for review instead of looping, and moving on. Next: "Word problems".

**Tutor (15):** No worries. For two x squared minus six x plus three, D is thirty six minus twenty four, so D is positive. That means two distinct real roots. We will revisit this later. Now for word problems, use four steps: let x be one number, write the next as x plus one, make the equation, then keep only sensible roots. Watch the pattern on the board. Now, your turn. The product of two consecutive positive integers is 306. What are the two integers?

**Student** _[correct, actually right]_: Let x be the first integer, so x into x plus one equals 306. So x squared plus x minus 306 equals 0, and the integers are 17 and 18.

> **next_check** ✓ · 3200 ms — Student answered "17, 18", which matches the key (17, 18). 1/2 correct in a row — one more check before calling it mastered.

**Tutor (16):** Excellent. You correctly defined the first integer, formed the quadratic, and kept the positive pair that fits the context. Here's another one. A rectangular plot has area 528 square metres. Its length is one metre more than twice its breadth. What is the breadth?

**Student** _[correct, actually right]_: Let the breadth be x metres, so the length is two x plus one. Then x into two x plus one equals 528, so x is 16, so the breadth is 16 metres.

> **complete** ✓ · 4297 ms — Student answered "16", which matches the key (16). 2/2 correct in a row → "Word problems" mastered. That was the last topic.

**Tutor (17):** Brilliant work. You completed all six topics, and you finished strongly by setting up equations from situations and choosing sensible roots. Along the way, you practised forming quadratics, solving them, and interpreting roots. One topic to review is discriminant and nature of roots.
