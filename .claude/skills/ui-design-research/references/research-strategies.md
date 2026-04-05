# Research Strategies

## Search Query Templates

### By UI Pattern

| Pattern          | Query Example                                                   |
| ---------------- | --------------------------------------------------------------- |
| Progress/Stepper | `"multi-step form wizard progress indicator UX best practices"` |
| Navigation       | `"nested navigation hierarchy mobile UX pattern"`               |
| Data Display     | `"data table card view dashboard layout best practices"`        |
| Forms            | `"long form UX chunking progressive disclosure design"`         |
| Onboarding       | `"onboarding wizard checklist design pattern SaaS"`             |
| Empty States     | `"empty state design pattern engagement"`                       |
| Filters          | `"faceted search filter UI pattern ecommerce"`                  |
| Notifications    | `"notification center badge design pattern"`                    |

### By Well-Known Product

Combine product name + feature for concrete examples:

- Airbnb: onboarding, search, listing creation
- Linear: issue tracking, project views, keyboard navigation
- Notion: page structure, sidebar, nested content
- Stripe: dashboard, form design, checkout flow
- Figma: toolbar, panel layout, contextual menus

### By Constraint

- `"[pattern] compact mobile"` — mobile-first variants
- `"[pattern] hierarchical nested"` — multi-level structures
- `"[pattern] many items scalable"` — handling large datasets

## Common UI Pattern Categories

### Progress & Status

- **Segmented progress bar**: Major phases as segments, proportional widths
- **Dot stepper**: Up to 5-7 steps with labels, horizontal dots + lines
- **Compact bar + counter**: For 8+ steps, thin bar with "Step 3/11" text
- **Breadcrumb stepper**: Clickable, for non-linear flows

**Key rule**: Max 2 hierarchy levels. 3+ layers overwhelm users.

### Information Density

- **Progressive disclosure**: Show summary, expand for detail
- **Inline badges**: Replace standalone lines with small indicators (e.g., "AI" badge)
- **Contextual switching**: Show different detail levels based on context (v-if/v-else)
- **Collapsible sections**: For optional detail

### Layout

- **Card layout**: For items with mixed content types
- **Split view**: List + detail for master-detail patterns
- **Timeline**: For chronological or sequential data
- **Tabs**: For same-level categories (max 5-6 tabs)

## Evaluation Criteria

When choosing between patterns, consider:

1. **Information priority** — What must be visible vs. available on demand?
2. **Step count** — Dots for 3-7 items, bars for 8+, pagination for 20+
3. **Mobile** — Compact variants exist? Touch targets sufficient?
4. **Consistency** — Does it match existing patterns in the product?
5. **Cognitive load** — Can a user understand their position at a glance?
