---
name: ui-design-research
description: >
  Research-driven UI design decision-making. Use when facing UI/UX design choices,
  information layout challenges, or needing to decide how to display complex data.
  Triggers: (1) UI design decisions with multiple valid approaches,
  (2) information overload or layout consolidation needs,
  (3) "how should we display X?" or "how do other products handle Y?" questions,
  (4) progress indicators, steppers, navigation, form design decisions,
  (5) when the user says the design feels "broken", "too much", or "messy",
  (6) when uncertain about the best way to organize or present information in UI
---

# UI Design Research

Research other products and UX best practices before making UI design decisions.

## Workflow

### 1. Define the Design Problem

Identify:

- What information needs to be displayed?
- What are the constraints (space, mobile, context)?
- What is the user's goal at this point in the flow?

### 2. Research

Run 2-3 WebSearch queries **in parallel**:

- `"[UI pattern name] UX best practices [current year]"`
- `"[specific pattern] design pattern [variant]"`
- `"[well-known product] [feature] design"`

Prioritize results from: Nielsen Norman Group, Material Design, PatternFly, Mobbin, Eleken, Designmodo.

Use WebFetch on promising results for detail. If 403, use additional WebSearch.

### 3. Synthesize

Extract from research:

- **Common patterns** — what most products do
- **Anti-patterns** — what to avoid
- **Constraints** — e.g., "max 2 hierarchy levels", "5-7 items for dot steppers"
- **Mobile considerations**

Present as an Insight block before proposing changes.

### 4. Apply

1. Select the best-fit pattern for the constraints
2. Adapt to the project's design language (existing colors, spacing, components)
3. Implement incrementally

### 5. Verify

Take browser screenshots after implementation. Compare before/after.

## Quick Reference

See [references/research-strategies.md](references/research-strategies.md) for search query templates and common UI pattern categories.
