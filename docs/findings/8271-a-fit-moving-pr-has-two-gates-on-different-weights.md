---
title: A PR that moves the fit is judged on two different weight vectors
discoveredBy: 8271
status: draft
confidence: high
---

**What is wrong.** `land:ready` regenerates locally with the whole `bot:refit`, so its sentinels read the refit weights. The queue's `check:lane --regenerate-derived` on a runner runs only `bot:refit [pins]`, so its sentinels read the committed weights. A test pinned to a fitted weight sees two values.

**Evidence.** PR #8307 moved `latentCreatureDiscount` from 0.5945 to 0.6259. `creatureAiValueCalibration.bot.test.ts` at tolerance 1 went red on `land:ready` with the old overrides and red on the lane with the re-derived ones.

**What stands for now.** The overrides sit between the two vectors and the tolerance is 4. A fit that moves the discount by more than about 0.04 reopens the deadlock. An override that followed the fitted discount by itself would end the class.

**The lane also misses what the refit reds.** The draft refits, but it runs only the bot files its cost budget admits. PR #8307's refit took `latent.recursion` off its prior for the first time: `opValuers.bot.test.ts` pinned the literal `140` and red the lane, while `ownPermanentRemoval.bot.test.ts`, out of the lane's budget, compared a fitted price with `toBe` and went red by one rounding error only in a whole bot-suite run on the refit tree. Nothing but batch health would have caught that one, after the merge.
