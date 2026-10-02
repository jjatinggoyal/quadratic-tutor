# Simulated session: struggling

> Low confidence; often doesn't know, asks basic questions, improves slowly.

> **teach** · 3817 ms — New session: starting with the first topic, "Standard form and recognising a quadratic", using strategy "Definition and the degree test".

**Tutor (0):** A quadratic equation is written in standard form: a x squared plus b x plus c equals zero, with a not zero. The quick test is this: after simplifying, the highest power of x must be exactly two. Here is a tiny example. In two x squared plus three x minus five equals zero, a is two, b is three, and c is minus five. Now, your turn. Is x squared minus 3 x plus 2 equals 0 a quadratic equation?

**Student** _[wrong, actually wrong]_: Um, maybe no, because it has x and not x squared?

> **reteach** ✗ · 4812 ms — Student answered "no", but the answer is yes. Likely misconception: degree_confusion. Strategy "Definition and the degree test" didn't land, so re-teaching with "Side-by-side: quadratic or not" (it targets degree_confusion) and checking again with a fresh question (re-teach 1/2).

**Tutor (1):** No worries. Let us compare side by side. In the one you missed, x squared is already there, so the highest power is two. That makes it quadratic. It also matches the standard form exactly. A common mix-up is noticing the x term and forgetting the x squared term. Here, a is one, so it is definitely not zero. The key test is only the highest power after simplifying. Now, your turn. Is x times x plus 1, plus 8, equals x plus 2 times x minus 2, a quadratic equation?

**Student** _[correct, actually right]_: Um, yes maybe? If I simplify, left side is x squared plus x plus 8 and right side is x squared minus 4, so the x squared cancels. Then it is not quadratic, I think no.

> **next_check** ✓ · 3538 ms — Student answered "no", which matches the key (no). 1/2 correct in a row — one more check before calling it mastered.

**Tutor (2):** Yes, that was right. You expanded both sides, noticed the x squared terms cancel, and correctly concluded the equation becomes linear, not quadratic. Here's another one. Is x cubed minus 4 x squared minus x plus 1 equals x minus 2 whole cubed, a quadratic equation?

**Student** _[wrong, actually right]_: Um, yes, because there is x squared in it, so I think it is quadratic.

> **advance** ✓ · 3458 ms — Student answered "yes", which matches the key (yes). 2/2 correct in a row → "Standard form and recognising a quadratic" mastered. Next: "What a root is; checking a root by substitution".

**Tutor (3):** Excellent work. Now a root is a value of x that makes the left side become zero. To check, we substitute that value for x. If the result is exactly zero, it is a root. If not, it is not a root. Watch how one value works and another does not. Now, your turn. Is x equals 2 a root of x squared minus 5 x plus 6 equals 0?

**Student** _[correct, actually right]_: Um yes, I think so. Putting x is 2 gives four minus ten plus six, and that is zero, so yes.

> **next_check** ✓ · 2989 ms — Student answered "yes", which matches the key (yes). 1/2 correct in a row — one more check before calling it mastered.

**Tutor (4):** Yes, correct. You substituted two into the left side and showed it becomes zero, which is exactly how we confirm a root. Here's another one. Is x equals minus 1 a root of x squared plus 2 x minus 3 equals 0?

**Student** _[wrong, actually right]_: Um no, because minus 1 squared is minus 1, then plus 2 times minus 1 is minus 2, and minus 3, so it is not zero.

> **advance** ✓ · 4152 ms — Student answered "no", which matches the key (no). 2/2 correct in a row → "What a root is; checking a root by substitution" mastered. Next: "Solving by factorisation".

**Tutor (5):** Brilliant work, you have mastered checking roots. Now we solve quadratics by factorisation: split the middle term using two numbers whose product is a c and whose sum is b, then group, factor, and use the zero product rule. Now, your turn. Solve x squared minus 5 x plus 6 equals 0 by factorisation. What are the roots?

**Student** _[correct, actually right]_: Um, the factors are x minus 2 and x minus 3, so x minus 2 equals zero or x minus 3 equals zero. So the roots are 2 and 3.

> **next_check** ✓ · 2844 ms — Student answered "2, 3", which matches the key (2, 3). 1/2 correct in a row — one more check before calling it mastered.

**Tutor (6):** Exactly right. You factored it as x minus 2 and x minus 3, then used the zero product rule to get roots 2 and 3. Here's another one. Solve x squared plus x minus 12 equals 0 by factorisation. What are the roots?

**Student** _[wrong, actually wrong]_: Um maybe it is x plus 3 and x minus 4, so the roots are minus 3 and 4.

> **reteach** ✗ · 4002 ms — Student answered "-3, 4", but the answer is -4, 3. Likely misconception: root_sign_flip. Strategy "Split the middle term" didn't land, so re-teaching with "Why the sign flips" (it targets root_sign_flip) and checking again with a fresh question (re-teach 1/2).

**Tutor (7):** You found the correct factors. Nice start. The only slip was the sign when turning factors into roots. From x plus 4 equals zero, x must be minus 4. From x minus 3 equals zero, x is 3. The sign flips because we move the number to the other side to make zero. A quick check helps: minus 4 works in the original equation, and 3 works too. So the roots are minus 4 and 3. Now, your turn. Solve x squared minus 3 x minus 10 equals 0 by factorisation. What are the roots?

**Student** _[correct, actually right]_: Um, the factors are x minus 5 and x plus 2, so x minus 5 equals zero or x plus 2 equals zero. So the roots are 5 and minus 2.

> **next_check** ✓ · 3594 ms — Student answered "5, -2", which matches the key (5, -2). 1/2 correct in a row — one more check before calling it mastered.

**Tutor (8):** Yes, correct. You factored it as x minus 5 and x plus 2, then set each factor to zero to get 5 and minus 2. Here's another one. Solve 2 x squared minus 7 x plus 3 equals 0 by factorisation. What are the roots?

**Student** _[question]_: Um, how do I split the middle term for this one, maybe?

> **answer_question** · 4812 ms — Student asked a question; answering it and keeping the same question open. Progress unchanged.

**Tutor (9):** Yes. For a quadratic with a number before x squared, first multiply that number by the constant term. Then find two numbers whose product is that result and whose sum is the middle coefficient. Those two numbers let you split the middle term. After that, group the terms in pairs and factor each group. So, back to our question. Solve 2 x squared minus 7 x plus 3 equals 0 by factorisation. What are the roots?

**Student** _[question]_: Um, do I split minus 7 x into minus 6 x and minus x, or how does that work?

> **answer_question** · 4804 ms — Student asked a question; answering it and keeping the same question open. Progress unchanged.

**Tutor (10):** Yes, that is the idea. First use a times c. Here that means two times three, so the product is six. Now we need two numbers that add to minus seven and multiply to plus six. A positive product with a negative sum means both numbers must be negative. So minus six and minus one work. That is why the middle term can be split that way before grouping. So, back to our question. Solve 2 x squared minus 7 x plus 3 equals 0 by factorisation. What are the roots?

**Student** _[dont_know]_: Um, I don’t know, sorry. I don’t understand this one.

> **reteach** · 4866 ms — Student said they don't know. Strategy "Why the sign flips" didn't land, so re-teaching with "Factor-pair table" and checking again with a fresh question (re-teach 2/2).

**Tutor (11):** No problem. Let’s use a factor pair table. Here a times c is six. List factor pairs of six: one and six, two and three. We need a sum of minus seven, so use minus one and minus six. Split the middle term, then group. That gives two x squared minus x minus six x plus three, then factor to get two x minus one and x minus three. Set each factor to zero. So the roots are one by two and three. Now, your turn. Solve 6 x squared minus x minus 2 equals 0 by factorisation. What are the roots?

**Student** _[wrong, actually wrong]_: Um, maybe the roots are 2 and minus 1? I think so.

> **move_on_flagged** ✗ · 4942 ms — Student answered "2, -1", but the answer is 2/3, -1/2. Likely misconception: non_monic_split. Already re-taught 2 times with different strategies; flagging "Solving by factorisation" for review instead of looping, and moving on. Next: "The quadratic formula".

**Tutor (12):** That was a tough one, and it is okay. The correct factors are three x minus two and two x plus one, so the roots are two by three and minus one by two. We will revisit factorisation later. Now we move to the quadratic formula. Use three steps every time: identify a, b, c, find b squared minus 4 a c, then substitute carefully. Watch the sign of b. Minus b means the opposite sign. Also, the whole top is divided by 2 a. Now, your turn. Use the quadratic formula to solve 2 x squared minus 7 x plus 3 equals 0. What are the roots?

**Student** _[dont_know]_: Um, I don’t know, I don’t understand this one.

> **reteach** · 4244 ms — Student said they don't know. Strategy "Identify, substitute, simplify" didn't land, so re-teaching with "Brackets for every value" and checking again with a fresh question (re-teach 1/2).

**Tutor (13):** That is okay. Let us do this with brackets for every value. Here, a is two, b is minus seven, and c is three. So minus b becomes minus bracket minus seven bracket, which is plus seven. Then b squared is bracket minus seven bracket squared, which is forty nine. The discriminant is twenty five, so root twenty five is five. Now the whole top goes over four. That gives seven plus or minus five over four, so the roots are three and one by two. Now, your turn. Use the quadratic formula to solve x squared plus 4 x minus 5 equals 0. What are the roots?

**Student** _[dont_know]_: Um, I don’t know, I don’t understand this one.

> **reteach** · 4473 ms — Student said they don't know. Strategy "Brackets for every value" didn't land, so re-teaching with "Cross-check with factorisation" and checking again with a fresh question (re-teach 2/2).

**Tutor (14):** No problem. Let us cross-check this one with factorisation, so the formula feels trustworthy. Here, a is one, b is four, c is minus five. The discriminant is thirty six, so root thirty six is six. Then x is minus four plus or minus six, all over two. That gives one and minus five. Check: x plus five and x minus one also multiply to this quadratic, so the same roots appear. The formula and factorisation agree. Now, your turn. Use the quadratic formula to solve 3 x squared minus 5 x plus 2 equals 0. What are the roots?

**Student** _[wrong, actually wrong]_: Um, maybe the roots are 2 and 1 by 3.

> **move_on_flagged** ✗ · 4536 ms — Student answered "2, 1/3", but the answer is 1, 2/3. Likely misconception: partial_division. Already re-taught 2 times with different strategies; flagging "The quadratic formula" for review instead of looping, and moving on. Next: "Discriminant and nature of roots".

**Tutor (15):** You were very close. The small slip was dividing by six. From five plus or minus one over six, we get six over six, which is one, and four over six, which is two by three. We will revisit the quadratic formula later. Now for the new idea: use the discriminant, D equals b squared minus 4 a c. If D is positive, roots are two distinct real. If zero, two equal real. If negative, not real. Now, your turn. What is the nature of the roots of 2 x squared minus 3 x plus 5 equals 0?

**Student** _[correct, actually right]_: Um, I think the discriminant is negative, so the roots are not real.

> **next_check** ✓ · 3593 ms — Student answered "no real", which matches the key (No real roots). 1/2 correct in a row — one more check before calling it mastered.

**Tutor (16):** Yes, correct. You used the negative discriminant to conclude there are no real roots. Here's another one. What is the nature of the roots of x squared minus 4 x plus 4 equals 0?

**Student** _[correct, actually right]_: Um, the discriminant is zero, so the roots are equal real roots, maybe?

> **advance** ✓ · 4320 ms — Student answered "two equal", which matches the key (Two equal real roots). 2/2 correct in a row → "Discriminant and nature of roots" mastered. Next: "Word problems".

**Tutor (17):** Excellent work mastering discriminant questions. Now we start word problems: let x be one integer, write the next as x plus 1, make the equation from the product, solve the quadratic, and keep only roots that fit the story. Now, your turn. The product of two consecutive positive integers is 306. What are the two integers?

**Student** _[question]_: Um, should I first make the equation with x times x plus 1 equals 306?

> **answer_question** · 4214 ms — Student asked a question; answering it and keeping the same question open. Progress unchanged.

**Tutor (18):** Yes, that setup is the right idea. If one integer is x, the next consecutive integer is x plus 1. Since their product is 306, multiplying those two expressions gives the equation. We use product because the story says one number times the next number. After that, move 306 to one side and solve the quadratic, then keep only the positive whole-number value that fits the context. So, back to our question. The product of two consecutive positive integers is 306. What are the two integers?

**Student** _[question]_: Um, why do we use the product here, and not addition?

> **answer_question** · 4152 ms — Student asked a question; answering it and keeping the same question open. Progress unchanged.

**Tutor (19):** We use product because the situation talks about two numbers making a total by multiplying, not by joining into a sum. For consecutive integers, the numbers are x and x plus 1. If the story says their product is some number, both numbers must be factors of that number. Addition would describe a sum statement, which is a different relationship. So, back to our question. The product of two consecutive positive integers is 306. What are the two integers?

**Student** _[question]_: Um, how do I know which factor pair of 306 is consecutive and positive?

> **answer_question** · 5224 ms — Student asked a question; answering it and keeping the same question open. Progress unchanged.

**Tutor (20):** Because consecutive numbers differ by one. So you need two positive factors of 306 that are very close together. Start near the square root of 306, since close factors sit around there. Twenty four squared is 576, sorry, that is too high, so think around seventeen because seventeen squared is 289. Then test nearby pairs: seventeen and eighteen, then eighteen and nineteen, until the product matches. So, back to our question. The product of two consecutive positive integers is 306. What are the two integers?

**Student** _[wrong, actually wrong]_: Um, maybe 17 and 19? Because 17 times 19 is 306, I think.

> **reteach** ✗ · 4715 ms — Student answered "17, 19", but the answer is 17, 18. Likely misconception: algebra_slip. Strategy "Let x be…" didn't land, so re-teaching with "Check the answer in the story" (it targets algebra_slip) and checking again with a fresh question (re-teach 1/2).

**Tutor (21):** Nice try. The quickest check is the story check. Consecutive positive integers must be one apart, and their product must be 306. Seventeen and nineteen are not consecutive, and their product is 323, not 306. From the factorised step, x is 17 or minus 18. The story says positive integers, so keep x as 17. Then the two integers are 17 and 18. Always plug back into the words: consecutive, positive, and product 306. Now, your turn. A rectangular plot has area 528 square metres. Its length is one metre more than twice its breadth. What is the breadth?

**Student** _[correct, actually wrong]_: Um, let the breadth be x. Then length is two x plus one, so x into two x plus one equals 528, maybe?

> **clarify** · 3931 ms — Couldn't make out an answer; asking the student to try again. Progress unchanged.

**Tutor (22):** I heard breadth as x and area as x times two x plus one. That setup looks right. Please give just the final breadth, and finish solving carefully. So, back to our question. A rectangular plot has area 528 square metres. Its length is one metre more than twice its breadth. What is the breadth?

**Student** _[wrong, actually wrong]_: Um, I think the breadth is 24.

> **reteach** ✗ · 4800 ms — Student answered "24", but the answer is 16. Likely misconception: algebra_slip. Strategy "Check the answer in the story" didn't land, so re-teaching with "Draw it first" and checking again with a fresh question (re-teach 2/2).

**Tutor (23):** You set up the rectangle correctly. Now draw it and solve calmly. Breadth is b, length is two b plus one, so area gives b into two b plus one equals 528. The slip was in solving the quadratic. Using the formula, b squared minus 4 a c becomes 1 plus 4224, so the square root is 65. Then b is minus 1 plus 65, all by 4, which gives 16. The negative value is rejected because a breadth cannot be negative. Now, your turn. The altitude of a right triangle is 7 centimetres less than its base, and the hypotenuse is 13 centimetres. What is the base?

**Student** _[correct, actually right]_: Um, let the base be x, then altitude is x minus 7. So x squared plus x minus 7 whole squared is 13 squared, and I think x comes out as 12.

> **next_check** ✓ · 3790 ms — Student answered "12", which matches the key (12). 1/2 correct in a row — one more check before calling it mastered.

**Tutor (24):** Yes, correct. You chose the base as x, wrote altitude as x minus 7, and kept the sensible positive root for the base. Here's another one. Find two numbers whose sum is 27 and whose product is 182.

**Student** _[question]_: Um, how do I start this one? Should I use x and 27 minus x, maybe?

> **answer_question** · 4009 ms — Student asked a question; answering it and keeping the same question open. Progress unchanged.

**Tutor (25):** Yes, that is a good start. Use one number as x. Since their sum must stay 27, the other becomes 27 minus x. Then use the product condition, because product means multiply the two numbers. That gives one quadratic in x. After solving, check both numbers still make sense in the story. So, back to our question. Find two numbers whose sum is 27 and whose product is 182.

**Student** _[dont_know]_: Um, I don't know, I don't understand this one.

> **complete** · 3917 ms — Student said they don't know. Already re-taught 2 times with different strategies; flagging "Word problems" for review instead of looping, and moving on. That was the last topic.

**Tutor (26):** Wonderful effort today. You completed all six topics and practised forming equations, factorising, using the quadratic formula, and applying quadratics to geometry and number situations. We will keep three topics for review: solving by factorisation, the quadratic formula, and word problems, and that is completely okay.
