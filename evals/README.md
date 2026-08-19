# Skill evals

The CLI has hundreds of tests. Until these, the seven skills had none — nothing
proved that `flow-status` wins *"show me every epic"* and loses *"what should I do
next"* to `flow-next`. That gap sits on this tool's stated first risk: **a skill
nobody triggers is a skill that does not exist**, however good its prose is.

## What runs

| Tier | Checks |
|---|---|
| 1. Anatomy | frontmatter, `name` matches the directory, description budget, a `## Verification` section, one case file per skill |
| 2. Trigger & routing | a prompt ranks its owner first; a prompt owned by another skill does not win; no two descriptions near-collide |

Both are deterministic, zero-dependency, and run through
`test/skill-evals.test.js` inside the existing `npm test`. `node
scripts/skill-evals.js` prints the same results; `--min-rank1 80` exits non-zero
under the floor. Nothing here ships to npm.

The 500-line ceiling on a skill body is **not** checked here —
`test/ceremony.test.js` owns it, and an invariant enforced twice drifts.

## Case format

One file per skill, `evals/cases/<skill-name>.json`:

```json
{
  "skill": "flow-ship",
  "trigger": {
    "positive": [{ "prompt": "open a pull request for this branch", "top_k": 1 }],
    "negative": [{ "prompt": "review it properly before it goes out", "owner": "flow-review" }]
  }
}
```

- `positive` — how a user actually asks. `top_k` defaults to 3; tighten to 1 for the
  signature request. Minimum 3.
- `negative` — a prompt belonging to a **different** skill, which this one must not
  win. Minimum 2. Always name the `owner`: without it the assertion passes vacuously
  whenever the prompt matches nothing. With it, the runner also asserts the owner
  outranks this skill.

**Do not paraphrase the description into a prompt.** That is writing the eval around
the answer. Write how a user talks; if a realistic prompt cannot rank, that is a
finding about the description.

## What tier 2 can and cannot tell you

Stemmed TF-IDF over `name` + `description` — nothing from the skill body, because the
body is not in context when the agent decides. It cannot judge meaning. It catches the
two failure modes that dominate real trigger bugs:

- a description missing the words users say — `flow-run` never said "permissions", so
  a prompt about permissions went to `flow-status` on the word "story";
- a description broad enough to swallow a neighbour's prompts.

A tier-2 failure almost always means **fix the description, not the eval**. Stopwords
include a fixed list of filler adverbs (*actually, just, now, really, sure*), decided
once as a property of English and never extended in response to a failing prompt —
tuning the tokenizer until a prompt passes is weakening a test until it goes green.

## The floor

The run prints a **rank-1 rate**: the share of positive prompts whose owner ranks
*first*, not merely inside `top_k`. Baseline **86.4%**; CI enforces **80%**, leaving
headroom so one unrelated description edit does not turn CI red. Raise it as routing
improves; never lower it to make a regression pass. A falling rate means descriptions
are drifting toward each other, which is what this tier exists to see.

Collisions error at 75% pairwise description similarity, warn at 50%. Nothing warns
today.

## What deliberately does not run

A **behavioural tier** — run an agent through each skill on a fixture repo and grade
the transcript — is the obvious third step and is not built: token-priced,
non-deterministic, and unrunnable in CI without flaking or being ignored. Seven skills
over one workflow do not justify it. Revisit only if a skill regresses in a way tiers
1 and 2 could not have caught.

## Prior art

The three-tier framing, the positive/negative case shape, and the `owner` field are
adapted from [addyosmani/agent-skills](https://github.com/addyosmani/agent-skills),
which builds on Anthropic's skill-creator. The scoring is this repo's own — ~150 lines
of TF-IDF instead of a dependency.

## Adding a skill

Add `evals/cases/<name>.json` in the same commit. Tier 1 fails without it.
