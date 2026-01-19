# Claude Execution Plans (ExecPlans)

This document describes the requirements for an execution plan ("ExecPlan"), a design document that a coding agent can follow to deliver a working feature or system change. Treat the reader as a complete beginner to this repository: they have only the current working tree and the single ExecPlan file you provide. There is no memory of prior plans and no external context.

---

## CRITICAL: Planning Sessions vs Implementation Sessions

**This section defines the fundamental workflow for ExecPlans and must be followed exactly.**

ExecPlans are created and executed in separate sessions with distinct purposes:

### Planning Session (This Session)

The planning session produces ONE deliverable: **a complete ExecPlan saved as a Markdown file**.

In a planning session, you must:

1. Research the codebase thoroughly
2. Identify all files, modules, and dependencies relevant to the task
3. Design the solution architecture
4. Break the work into milestones sized for single-session execution
5. Write the complete ExecPlan following this specification
6. **Save the ExecPlan as a `.md` file** (e.g., `execplans/feature-name.md`)

In a planning session, you must **NOT**:

- Write any production code
- Modify any source files
- Run implementation commands
- Begin any milestone work
- Ask "shall I proceed with implementation?"

**The planning session ends when the ExecPlan file is saved.** A new, separate session will be created to execute each milestone.

### Implementation Session (Separate Session)

Each milestone is executed in its own fresh session. The implementing agent:

- Receives only the ExecPlan file and the codebase
- Has no memory of the planning session
- Executes exactly one milestone per session
- Updates the ExecPlan's living document sections as work proceeds
- Does not prompt for "next steps" — simply completes the milestone

---

## Milestone Design for Single-Session Execution

**Each milestone must be completable within a single context window.** This is a hard constraint that affects how you structure work.

### Milestone Sizing Guidelines

A well-sized milestone typically includes:

- 3–8 files to create or modify
- 1–3 new functions or modules to implement
- A clear, verifiable outcome achievable in one session
- All context needed to execute without referencing other milestones

A milestone is **too large** if it:

- Requires modifying more than 10 files
- Introduces multiple complex systems simultaneously
- Cannot be described completely in 500–800 words
- Has acceptance criteria that depend on completing "most of" something

A milestone is **too small** if it:

- Only creates stub files without meaningful implementation
- Cannot be independently verified
- Exists purely as setup for the "real" milestone

### Milestone Independence

Each milestone must be executable by an agent with **zero memory** of prior milestones. This means:

- Repeat all relevant context within each milestone description
- State the exact current state of files at milestone start
- Never say "as established in Milestone 1" — restate what was established
- Include the specific function signatures, types, and paths needed
- Describe what to verify from prior milestones before beginning

### Milestone Boundaries

Good milestone boundaries occur at:

- Natural verification points (tests pass, server starts, endpoint responds)
- Interface boundaries (trait defined, then implemented separately)
- Layer boundaries (data layer complete, then API layer in next milestone)
- Risk boundaries (prototype validates approach, then full implementation)

---

## How to Use ExecPlans and PLANS.md

**When authoring an ExecPlan (planning session):**

Follow PLANS.md to the letter. If it is not in your context, refresh your memory by reading the entire PLANS.md file. Be thorough in reading (and re-reading) source material to produce an accurate specification. Start from the skeleton and flesh it out as you do your research. **Your only output is the saved ExecPlan file — do not begin implementation.**

**When implementing an ExecPlan (implementation session):**

Do not prompt the user for "next steps"; simply proceed through the current milestone. Keep all living document sections up to date. Add or split entries in the Progress list at every stopping point to affirmatively state progress made and next steps. Resolve ambiguities autonomously. Commit frequently. **Stop at the end of the current milestone.**

**When discussing an ExecPlan:**

Record decisions in the Decision Log for posterity. It should be unambiguously clear why any change to the specification was made. ExecPlans are living documents, and it should always be possible to restart from only the ExecPlan and no other work.

**When researching a design with challenging requirements or significant unknowns:**

Use milestones to implement proof of concepts, "toy implementations", and similar artifacts that validate whether the user's proposal is feasible. Read the source code of libraries by finding or acquiring them, research deeply, and include prototypes to guide a fuller implementation.

---

## Requirements

### Non-Negotiable Requirements

- Every ExecPlan must be fully self-contained. Self-contained means that in its current form it contains all knowledge and instructions needed for a novice to succeed.
- Every ExecPlan is a living document. Contributors are required to revise it as progress is made, as discoveries occur, and as design decisions are finalized. Each revision must remain fully self-contained.
- Every ExecPlan must enable a complete novice to implement the feature end-to-end without prior knowledge of this repo.
- Every ExecPlan must produce a demonstrably working behavior, not merely code changes to "meet a definition".
- Every ExecPlan must define every term of art in plain language or not use it.
- **Every milestone must be completable within a single context window by an agent with no prior memory.**

Purpose and intent come first. Begin by explaining, in a few sentences, why the work matters from a user's perspective: what someone can do after this change that they could not do before, and how to see it working. Then guide the reader through the exact steps to achieve that outcome, including what to edit, what to run, and what they should observe.

The agent executing your plan can list files, read files, search, run the project, and run tests. It does not know any prior context and cannot infer what you meant from earlier milestones. Repeat any assumption you rely on. Do not point to external blogs or docs; if knowledge is required, embed it in the plan itself in your own words. If an ExecPlan builds upon a prior ExecPlan and that file is checked in, incorporate it by reference. If it is not, you must include all relevant context from that plan.

---

## Formatting

Format and envelope are simple and strict. When writing an ExecPlan to a Markdown (.md) file where the content of the file is only the single ExecPlan, write it as standard Markdown without wrapping triple backticks.

When you need to show commands, transcripts, diffs, or code within the ExecPlan, present them as indented blocks (four spaces) or fenced code blocks with appropriate language tags. Use two newlines after every heading. Use `#`, `##`, and so on for heading hierarchy. Use correct syntax for ordered and unordered lists.

Write in plain prose. Prefer sentences over lists. Avoid checklists, tables, and long enumerations unless brevity would obscure meaning. Checklists are permitted only in the `Progress` section, where they are mandatory. Narrative sections must remain prose-first.

---

## Guidelines

Self-containment and plain language are paramount. If you introduce a phrase that is not ordinary English ("daemon", "middleware", "RPC gateway", "filter graph"), define it immediately and remind the reader how it manifests in this repository (for example, by naming the files or commands where it appears). Do not say "as defined previously" or "according to the architecture doc." Include the needed explanation here, even if you repeat yourself.

Avoid common failure modes. Do not rely on undefined jargon. Do not describe "the letter of a feature" so narrowly that the resulting code compiles but does nothing meaningful. Do not outsource key decisions to the reader. When ambiguity exists, resolve it in the plan itself and explain why you chose that path. Err on the side of over-explaining user-visible effects and under-specifying incidental implementation details.

Anchor the plan with observable outcomes. State what the user can do after implementation, the commands to run, and the outputs they should see. Acceptance should be phrased as behavior a human can verify ("after starting the server, navigating to http://localhost:8080/health returns HTTP 200 with body OK") rather than internal attributes ("added a HealthCheck struct"). If a change is internal, explain how its impact can still be demonstrated (for example, by running tests that fail before and pass after, and by showing a scenario that uses the new behavior).

Specify repository context explicitly. Name files with full repository-relative paths, name functions and modules precisely, and describe where new files should be created. If touching multiple areas, include a short orientation paragraph that explains how those parts fit together so a novice can navigate confidently. When running commands, show the working directory and exact command line. When outcomes depend on environment, state the assumptions and provide alternatives when reasonable.

Be idempotent and safe. Write the steps so they can be run multiple times without causing damage or drift. If a step can fail halfway, include how to retry or adapt. If a migration or destructive operation is necessary, spell out backups or safe fallbacks. Prefer additive, testable changes that can be validated as you go.

Validation is not optional. Include instructions to run tests, to start the system if applicable, and to observe it doing something useful. Describe comprehensive testing for any new features or capabilities. Include expected outputs and error messages so a novice can tell success from failure. Where possible, show how to prove that the change is effective beyond compilation (for example, through a small end-to-end scenario, a CLI invocation, or an HTTP request/response transcript). State the exact test commands appropriate to the project's toolchain and how to interpret their results.

Capture evidence. When your steps produce terminal output, short diffs, or logs, include them as indented examples. Keep them concise and focused on what proves success. If you need to include a patch, prefer file-scoped diffs or small excerpts that a reader can recreate by following your instructions rather than pasting large blobs.

---

## Milestones

Milestones are the unit of work for implementation sessions. Each milestone must be independently executable by an agent starting fresh with only this ExecPlan and the codebase.

### Milestone Structure

Each milestone must include:

1. **Goal Statement**: A brief paragraph describing the scope and what will exist at the end that did not exist before.

2. **Prerequisites**: The exact state required before starting. What files must exist? What tests must pass? What prior milestone outcomes must be verified?

3. **Context Recap**: All information needed to execute this milestone, restated even if it appeared in earlier milestones. Include relevant file paths, function signatures, type definitions, and architectural decisions.

4. **Work Description**: Prose describing the sequence of edits and additions. For each edit, name the file and location (function, module) and what to insert or change.

5. **Commands and Verification**: The exact commands to run, expected outputs, and acceptance criteria phrased as observable behavior.

6. **Completion Criteria**: How to know the milestone is done. What tests pass? What behavior is observable? What should the implementing agent do upon completion (update Progress, commit, stop)?

### Milestone Narrative

Keep milestones readable as a story: goal, work, result, proof. Progress and milestones are distinct: milestones tell the story, progress tracks granular work. Both must exist. Never abbreviate a milestone merely for the sake of brevity; do not leave out details that could be crucial to a future implementation.

Each milestone must be independently verifiable and incrementally implement the overall goal of the execution plan.

---

## Prototyping Milestones and Parallel Implementations

It is acceptable — and often encouraged — to include explicit prototyping milestones when they de-risk a larger change. Examples: adding a low-level operator to a dependency to validate feasibility, or exploring two composition orders while measuring optimizer effects. Keep prototypes additive and testable. Clearly label the scope as "prototyping"; describe how to run and observe results; and state the criteria for promoting or discarding the prototype.

Prefer additive code changes followed by subtractions that keep tests passing. Parallel implementations (e.g., keeping an adapter alongside an older path during migration) are fine when they reduce risk or enable tests to continue passing during a large migration. Describe how to validate both paths and how to retire one safely with tests. When working with multiple new libraries or feature areas, consider creating spikes that evaluate the feasibility of these features independently of one another, proving that the external library performs as expected and implements the features we need in isolation.

---

## Living Document Sections

ExecPlans must contain and maintain the following sections. These are not optional.

### Progress

Use a list with checkboxes to summarize granular steps. Every stopping point must be documented here, even if it requires splitting a partially completed task into two ("done" vs. "remaining"). This section must always reflect the actual current state of the work. Use timestamps to measure rates of progress.

### Surprises & Discoveries

Document unexpected behaviors, bugs, optimizations, or insights discovered during implementation. Provide concise evidence.

### Decision Log

Record every decision made while working on the plan, including the decision, rationale, and date/author.

### Outcomes & Retrospective

Summarize outcomes, gaps, and lessons learned at major milestones or at completion. Compare the result against the original purpose.

---

## Skeleton of a Good ExecPlan

The following skeleton should be used as the starting point for every ExecPlan. Copy it and flesh it out during research.

```
# <Short, action-oriented description>

This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective must be kept up to date as work proceeds.

Reference: This document is maintained in accordance with PLANS.md at <path-to-PLANS.md>.

## Purpose / Big Picture

Explain in a few sentences what someone gains after this change and how they can see it working. State the user-visible behavior you will enable.

## Progress

Use a list with checkboxes to summarize granular steps. Every stopping point must be documented here.

- [ ] Milestone 1: <brief description>
- [ ] Milestone 2: <brief description>
- [ ] (etc.)

## Surprises & Discoveries

Document unexpected behaviors, bugs, optimizations, or insights discovered during implementation.

(To be populated during implementation.)

## Decision Log

Record every decision made while working on the plan.

(To be populated during planning and implementation.)

## Outcomes & Retrospective

Summarize outcomes, gaps, and lessons learned at major milestones or at completion.

(To be populated during and after implementation.)

## Context and Orientation

Describe the current state relevant to this task as if the reader knows nothing. Name the key files and modules by full path. Define any non-obvious term you will use. Do not refer to prior plans.

## Milestone 1: <Descriptive Name>

### Goal

<Brief paragraph: what exists at the end of this milestone that did not exist before?>

### Prerequisites

<What must be true before starting? Files that must exist, tests that must pass, etc.>

### Context for This Milestone

<All information needed to execute this milestone. Restate relevant context even if it appeared elsewhere. Include file paths, signatures, types, architectural decisions.>

### Work

<Prose describing the sequence of edits. For each edit, name the file and location and what to change.>

### Commands and Verification

<Exact commands to run, working directory, expected output. How to verify success.>

### Completion Criteria

<How to know you're done. What to do upon completion: update Progress, commit, stop.>

## Milestone 2: <Descriptive Name>

<Same structure as Milestone 1. Remember: this milestone will be executed by an agent with no memory of Milestone 1's execution. Restate all necessary context.>

## Interfaces and Dependencies

Be prescriptive. Name the libraries, modules, and services to use and why. Specify the types, traits/interfaces, and function signatures that must exist at the end of the plan.

## Idempotence and Recovery

If steps can be repeated safely, say so. If a step is risky, provide a safe retry or rollback path.

## Artifacts and Notes

Include the most important transcripts, diffs, or snippets as indented examples. Keep them concise and focused on what proves success.
```

---

## Final Checklist for Planning Sessions

Before saving your ExecPlan, verify:

- [ ] The plan is saved as a Markdown file (not presented in chat)
- [ ] No production code has been written
- [ ] Each milestone is completable in a single context window (3–8 files, clear scope)
- [ ] Each milestone restates all context needed for independent execution
- [ ] Each milestone has explicit prerequisites and completion criteria
- [ ] All terms of art are defined where first used
- [ ] All file paths are repository-relative and complete
- [ ] Acceptance criteria are phrased as observable behavior
- [ ] The Progress section lists all milestones as unchecked items

**After saving the ExecPlan file, the planning session is complete. Do not begin implementation.**

---

## Revision History

When you revise a plan, write a note at the bottom describing the change and the reason why. ExecPlans must describe not just the what but the why for almost everything.