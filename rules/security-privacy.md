# Security And Privacy Rules

## Purpose

Define how AI agents should handle frontend security, privacy, secrets, authentication state, third-party code, and browser storage without weakening production safeguards.

## Source Priority

Use the shared precedence in [Rule Governance](./governance.md). Prefer project security requirements, backend contracts, platform controls, and version-matched framework guidance before generic frontend patterns.

## References

- OWASP Top 10: https://owasp.org/www-project-top-ten/
- OWASP Content Security Policy Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Content_Security_Policy_Cheat_Sheet.html
- OWASP HTML5 Security Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/HTML5_Security_Cheat_Sheet.html
- MDN Content-Security-Policy: https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy
- MDN Cookies Guide: https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Cookies
- MDN Set-Cookie: https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie
- MDN Web Storage API: https://developer.mozilla.org/en-US/docs/Web/API/Web_Storage_API

## Core Rules

- **MUST**: Classify security and privacy regressions by demonstrated impact. Treat credential exposure, authorization bypass, exploitable injection, material personal-data leakage, or equivalent high-impact regressions as Critical review issues.
- **MUST**: Do not expose secrets, tokens, private keys, or privileged internal identifiers to client bundles.
- **MUST**: Collect, render, transmit, and persist only the data required for the user-visible workflow.
- **MUST**: Treat all client input, URL state, storage, and cross-window messages as untrusted.
- **SHOULD**: Prefer platform and framework protections over custom client-side security logic.
- **MUST**: Do not claim frontend-only checks enforce authorization.

## Authentication And Session Rules

- **SHOULD**: Prefer server-managed sessions or other backend-approved auth flows over browser-managed token handling.
- **MUST**: Do not store session identifiers, refresh tokens, or other sensitive credentials in JavaScript-accessible browser storage, including `localStorage` and `sessionStorage`.
- **MUST**: If cookies are used for sensitive session state, prefer backend-managed `HttpOnly`, `Secure`, and appropriate `SameSite` settings.
- **MUST**: Do not weaken auth UX by exposing sensitive account state in unauthenticated pages, client logs, or URL parameters.
- **MUST**: Re-auth, confirmation, or explicit intent checks should remain in place for destructive or high-risk actions when the product requires them.

## Storage And Data Minimization Rules

- **MUST**: Do not persist sensitive user data in browser storage unless the product requirement, threat model, and retention need are explicit.
- **SHOULD**: Prefer in-memory state when persistence is unnecessary.
- **SHOULD**: For approved non-sensitive values, prefer `sessionStorage` over `localStorage` when tab-scoped persistence is sufficient.
- **MUST**: Clear cached sensitive data when sign-out, account switch, or permission downgrade occurs.
- **MUST**: Do not duplicate the same sensitive payload across multiple client caches without a concrete need.

## Rendering And Injection Rules

- **MUST**: Do not introduce `dangerouslySetInnerHTML`, raw HTML insertion, or code evaluation without a documented trusted-content boundary.
- **MUST**: Escape or sanitize untrusted rich text at the approved boundary before rendering.
- **MUST**: Validate target origin in `postMessage` flows. Do not use `*` for sensitive communication.
- **MUST**: Treat query strings, hash state, CMS fields, and third-party payloads as untrusted input.
- **MUST**: Do not build security decisions on obscured client state, hidden fields, or disabled controls.

## Network And Third-Party Rules

- **SHOULD**: Prefer same-origin or explicitly approved origins for API and asset access.
- **MUST**: Do not broaden CORS, credential, or embedded third-party access from the frontend without a clear product and security reason.
- **SHOULD**: Minimize third-party scripts, pixels, chat widgets, and SDKs. Each added script increases privacy and supply-chain risk.
- **MUST**: Load third-party code only where needed and document the business purpose when it handles user data.
- **MUST**: Avoid sending unnecessary user identifiers, secrets, or sensitive form values to analytics and logging tools.

## Security Headers And Browser Controls

- **MUST**: Preserve or strengthen existing CSP, iframe sandboxing, referrer, and related security controls when changing document structure or script loading.
- **MUST**: Do not recommend inline scripts, wildcard script sources, or broad CSP exceptions unless required and approved.
- **MUST**: Flag changes that would break `HttpOnly` cookie benefits by moving sensitive state into JavaScript-accessible storage.
- **SHOULD**: Consider clickjacking, mixed-content, and cross-origin embedding implications when changing auth or payment flows.

## Change Requirements

- **MUST**: Treat exposed secrets, sensitive storage misuse, unsafe HTML injection, or broken auth assumptions as blocking issues.
- **SHOULD**: Document privacy-sensitive data flows when adding analytics, session persistence, third-party embeds, or user recording.
- **SHOULD**: Minimize personally identifiable information in logs, telemetry, and client error reports.
- **MAY**: Use browser persistence for non-sensitive preferences when it does not weaken auth, privacy, or data integrity.
- **MUST**: Explain why a risk is acceptable when the requested UX requires storing or transmitting sensitive client data.

## Verification

Report:

- Security-relevant data that now reaches the browser, storage, logs, or third-party services
- Browser storage, cookie, CSP, or embed behavior changed by the task
- What was verified by code inspection, tests, or local runtime
- Remaining assumptions that depend on backend policy or deployment configuration

Do not claim authorization, privacy compliance, or CSP effectiveness without checking the relevant project configuration.

## AI Agent Checklist

- Did I expose any secret, token, credential, or internal-only field to the client?
- Did I store sensitive data in JavaScript-accessible browser storage, URLs, logs, or analytics payloads?
- Did I add raw HTML rendering, code evaluation, or cross-window messaging?
- Did I add or widen third-party scripts, embeds, or cross-origin requests?
- Did I preserve existing cookie, CSP, and server-enforced auth boundaries?
- Is the smallest safer alternative already available in the project or framework?
