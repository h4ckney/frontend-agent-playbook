# Design System And Styling Rules

## Purpose

Define how AI agents should extend frontend visuals using the project's existing design system, tokens, components, styling stack, responsive conventions, and accessibility requirements without creating visual drift or unnecessary infrastructure.

## Source Priority

Use the shared precedence in [Rule Governance](./governance.md). Project-owned design specifications, tokens, components, CSS architecture, accessibility targets, and product behavior outrank generic design-system preferences.

## References

- Design Tokens Format Module 2025.10: https://www.w3.org/community/reports/design-tokens/CG-FINAL-format-20251028/
- MDN CSS Custom Properties: https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Cascading_variables/Using_custom_properties
- MDN `prefers-reduced-motion`: https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/%40media/prefers-reduced-motion
- MDN `forced-colors`: https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/%40media/forced-colors
- WAI-ARIA Authoring Practices Guide: https://www.w3.org/WAI/ARIA/apg/

## Applicability

- **SHOULD**: Load this rule when a task changes shared visual primitives, tokens, component variants, themes, responsive behavior, motion, focus styling, or the project's styling architecture.
- **SHOULD**: Load this rule when repeated visual drift or one-off values indicate an ownership problem.
- **SHOULD**: Do not load this rule for every isolated CSS correction; require a shared-system decision, a user-visible consistency risk, or an explicit design requirement.

## Existing System First

- **MUST**: Inspect the existing styling stack, token sources, shared components, theme providers, breakpoint conventions, and visual-test setup before adding a new pattern.
- **SHOULD**: Reuse an existing component, variant, token, utility, or composition pattern when it satisfies the required behavior.
- **MUST**: Do not introduce a new CSS framework, component library, CSS-in-JS runtime, token pipeline, or theme layer for a narrow feature without explicit approval and demonstrated need.
- **SHOULD**: Preserve the repository's current styling ownership boundaries instead of mixing CSS Modules, utility classes, CSS-in-JS, inline styles, and global CSS arbitrarily.
- **SHOULD**: Record an information gap when the design source or component owner cannot be verified; do not invent a new visual standard from nearby code alone.

## Tokens And Themes

- **SHOULD**: Use existing semantic tokens for color, typography, spacing, radius, elevation, motion, and layout when available.
- **SHOULD**: Prefer semantic intent such as text, surface, border, success, or danger over copying raw values into shared components.
- **MUST**: Do not change a foundational token to fix one component without checking all consumers and theme variants.
- **SHOULD**: Add a token only when the value represents a reusable design decision; do not create tokens for every one-off measurement.
- **SHOULD**: Keep token aliases and theme overrides traceable to one owned source instead of duplicating transformed values across CSS, JavaScript, and design files.
- **MUST**: Do not claim conformance with the Design Tokens Community Group format unless the repository actually adopts and validates that format.
- **SHOULD**: Test light, dark, high-contrast, brand, or other supported themes only when the project defines them.

## Components And Variants

- **MUST**: Preserve semantic HTML, keyboard behavior, focus handling, accessible names, and disabled or pending semantics when styling shared components.
- **SHOULD**: Model variants around stable product intent rather than individual page names or arbitrary visual combinations.
- **SHOULD**: Avoid boolean-prop combinations that produce invalid or visually contradictory states; use an explicit variant model when combinations are constrained.
- **SHOULD**: Prefer composition for optional structure and bounded variants for repeated visual states.
- **MUST**: Do not bypass a shared component solely to match a screenshot when the component owns required behavior or accessibility.
- **SHOULD**: Keep component APIs small enough that consumers cannot override every internal style without an explicit escape hatch.
- **SHOULD**: Add or change a shared primitive only when its broader consumer impact can be inspected and verified.

## Layout And Responsive Behavior

- **SHOULD**: Follow existing container, grid, spacing, and breakpoint conventions before introducing new layout constants.
- **SHOULD**: Choose responsive behavior from content and product requirements rather than named device models.
- **MUST**: Keep content operable under supported text zoom, viewport narrowing, localization expansion, and dynamic user content.
- **SHOULD**: Use stable layout constraints such as grid tracks, flex constraints, aspect ratio, and min/max sizing when dynamic content could cause shifting or overlap.
- **MUST**: Do not hide required content or actions at smaller viewports without an approved alternative path.
- **SHOULD**: Avoid fixed heights for text-bearing regions unless overflow and localization behavior are deliberately handled.

## Styling And User Preferences

- **MUST**: Keep visible focus indicators and supported forced-color behavior usable.
- **MUST**: Respect reduced-motion preferences for non-essential animation and provide an equivalent understandable state change.
- **SHOULD**: Keep color contrast, target size, focus order, and status communication aligned with [Accessibility Rules](./accessibility.md).
- **SHOULD**: Use logical CSS properties when the project supports right-to-left layouts or direction-independent components.
- **MUST**: Do not encode meaning through color, motion, or position alone.
- **SHOULD**: Avoid global selectors and specificity escalation when a local project-supported scope can express the change.

## Escape Hatches

- **SHOULD**: Use an existing escape hatch before inventing another override mechanism.
- **MUST**: Scope an escape hatch to the smallest consumer and document the unmet system need when it bypasses tokens, variants, or component ownership.
- **MUST**: Do not use `!important`, arbitrary values, deep selectors, or internal DOM targeting as a default integration strategy.
- **SHOULD**: Give repeated escape-hatch usage an owner and review trigger; repetition may indicate a missing variant or an incorrectly scoped component.
- **MAY**: Keep a one-off style local when promoting it into the shared system would add more API and maintenance cost than value.

## Testing

- **SHOULD**: Use focused component or visual checks for shared primitives, variants, responsive states, and supported themes when the project has an established layer.
- **SHOULD**: Test keyboard focus, zoom or text expansion, reduced motion, and forced colors when the change affects those behaviors.
- **SHOULD**: Add visual regression coverage only when repeated drift or shared-component blast radius justifies its maintenance cost.
- **SHOULD**: Keep screenshot baselines deterministic and review meaningful visual differences instead of accepting broad baseline updates.
- **MAY**: Use focused manual comparison for isolated low-risk styling when automation would be disproportionate.

## Avoid Over-engineering

- **MUST**: Do not create a design system because a project has repeated colors or components; identify an ownership and reuse need first.
- **SHOULD**: Do not migrate stable styling architecture during an unrelated feature.
- **SHOULD**: Prefer a local correction over a new token, variant, or primitive when the decision is not reusable.
- **SHOULD**: Do not add a documentation site, token transformer, or visual-test service without repeated need and separate approval.
- **SHOULD**: Avoid enforcing personal visual preferences that are not present in product requirements or the existing system.

## Verification

Report:

- Existing design-system and styling sources inspected
- Tokens, components, variants, themes, and breakpoints reused or changed
- Responsive, zoom, localization, focus, motion, and forced-color behavior verified
- Escape hatches introduced and why existing APIs were insufficient
- Visual, component, accessibility, and manual checks run
- Unverified design ownership or downstream consumer risk

Do not claim system consistency from one screenshot or one component. Verify the owned source and representative consumers.

## AI Agent Checklist

- Did I inspect the existing design system and styling stack first?
- Did I reuse semantic tokens and components where they fit?
- Could a shared token or primitive change break unrelated consumers?
- Are variants bounded and semantically meaningful?
- Does the layout survive narrow viewports, text expansion, and localization?
- Are focus, reduced motion, forced colors, and contrast preserved?
- Is every escape hatch scoped and justified?
- Did I avoid creating system infrastructure for a one-off need?
