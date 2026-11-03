# Security policy

## Supported version

Security fixes target the latest version on `main`. This project is a deployed
application, not a published npm package.

## Reporting a vulnerability

Use [GitHub's private vulnerability reporting](https://github.com/luberan/ip-info/security/advisories/new).
Do not post exploit details, credentials, or visitor information in a public issue.

Include the affected commit, expected and actual behavior, a minimal reproduction,
and the security impact. Use synthetic data or public example addresses; never
include real visitor addresses, IPinfo tokens, or Cloudflare credentials.

If a credential has been exposed, revoke or rotate it immediately. Deleting a
commit or closing an alert does not invalidate a leaked credential.

## Automated checks

CI, CodeQL, dependency review, Dependabot, and Scorecard complement manual review;
they do not guarantee that the application is free of vulnerabilities.

Production secrets belong in Cloudflare Worker runtime settings, never in the
repository or GitHub Actions. CI and runtime smoke tests need no production token.
Direct pushes to `main` remain allowed, so review failed checks and security alerts
before publishing changes. GitHub checks do not gate Cloudflare deployments.
