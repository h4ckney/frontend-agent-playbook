# Accessibility Rules

## Purpose

Define how AI agents should preserve keyboard access, focus behavior, semantics, accessible names, understandable forms, and perceivable content in frontend changes.

## Source Priority

Use the shared precedence in [Rule Governance](./governance.md). Follow the accessibility target required by the project, product, or jurisdiction. Use WCAG 2.2 and WAI-ARIA APG as technical references without claiming legal compliance from automated checks alone.

## References

- W3C WCAG overview: https://www.w3.org/WAI/standards-guidelines/wcag/
- WCAG 2.2: https://www.w3.org/TR/WCAG22/
- WAI-ARIA Authoring Practices Guide: https://www.w3.org/WAI/ARIA/apg/
- APG keyboard interface guidance: https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/
- APG accessible names and descriptions: https://www.w3.org/WAI/ARIA/apg/practices/names-and-descriptions/
- APG patterns: https://www.w3.org/WAI/ARIA/apg/patterns/

## Core Rules

- **SHOULD**: Prefer native semantic HTML before adding ARIA roles, states, or keyboard behavior.
- **MUST**: Give every interactive control an accessible name that communicates its purpose.
- **SHOULD**: Prefer visible text labels and native labeling elements over invisible ARIA labels when practical.
- **MUST**: Preserve logical heading, landmark, list, table, and form structure.
- **MUST**: Do not rely on color, position, shape, hover, sound, or animation alone to communicate meaning.
- **MUST**: Keep critical content and functionality available to keyboard and assistive-technology users.

## Keyboard And Focus

- **MUST**: Make all interactive functionality operable with a keyboard.
- **MUST**: Preserve a visible focus indicator and a predictable focus order.
- **MUST**: Use native controls for standard interactions. Custom ARIA widgets must implement the keyboard behavior defined by the matching APG pattern.
- **MUST**: Move focus only when the interaction requires it, such as opening a modal or recovering from a removed focused element.
- **MUST**: Restore focus to a logical trigger or next action when closing temporary UI.
- **MUST**: Do not use positive `tabIndex` values to repair source-order problems.

## Forms And Validation

- **MUST**: Associate controls with persistent labels; do not use placeholders as the only label.
- **MUST**: Connect instructions and error messages to the affected control.
- **MUST**: Identify invalid fields in text and expose invalid state programmatically.
- **MUST**: Preserve user input after validation errors unless security or product requirements prevent it.
- **MUST**: Make required state, format expectations, and recovery actions understandable before or when an error occurs.

## Dynamic UI

- **MUST**: Use established APG patterns for dialogs, menus, tabs, comboboxes, listboxes, disclosures, and other composite widgets.
- **MUST**: Expose changing state such as expanded, selected, checked, pressed, busy, and invalid when native semantics do not provide it.
- **MUST**: Announce important asynchronous results or errors when they are not otherwise discoverable, without making routine updates excessively verbose.
- **MUST**: Support reduced-motion preferences and avoid unnecessary motion that blocks task completion.
- **MUST**: Keep dialogs labeled, focus-contained while modal, and dismissible through expected keyboard interaction unless dismissal would be unsafe.

## Visual And Media Content

- **MUST**: Provide useful alternative text for informative images and empty alternative text for decorative images.
- **MUST**: Preserve text readability and the project's required contrast target across interaction states.
- **MUST**: Do not hide information or controls at text zoom, browser zoom, or responsive breakpoints without an equivalent path.
- **MUST**: Provide captions, transcripts, or other alternatives when required by the media and project accessibility target.

## Testing And Verification

- **SHOULD**: Use [Testing Rules](./testing.md) to choose proportionate coverage.
- **SHOULD**: Prefer role, label, and visible-text queries in component tests.
- **SHOULD**: Run available automated accessibility checks, but do not treat them as proof of full conformance.
- **SHOULD**: Manually verify keyboard flow, visible focus, dialog focus behavior, form errors, and accessible names when affected.
- **SHOULD**: Test representative screen-reader behavior for custom widgets or critical workflows when the project has the capability.
- **SHOULD**: Report the accessibility target, checks performed, untested assistive technologies, and remaining risk.

## AI Agent Checklist

- Did I preserve native semantics and accessible names?
- Can the workflow be completed with a keyboard and visible focus?
- Are focus changes intentional and reversible?
- Are form labels, instructions, errors, and recovery paths connected?
- Does dynamic state reach assistive technologies without excessive announcements?
- Did I avoid claiming compliance from linting or automated scans alone?

## Examples

Bad:

```tsx
<div className="save" onClick={onSave}>Save</div>
```

Good:

```tsx
<button type="button" className="save" onClick={onSave}>
  Save
</button>
```

Bad:

```tsx
<input placeholder="Email" />
```

Good:

```tsx
<label htmlFor="email">Email</label>
<input id="email" name="email" type="email" />
```
