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

## Repository protections

The [Protect main history ruleset](https://github.com/luberan/ip-info/rules/28230748)
blocks force-pushes and deletion of `main` for all actors, with no bypass
exceptions. Maintainers can push fast-forward updates directly. Pull requests,
independent approvals and passing status checks are optional. Review failed
checks and security alerts before publishing changes. Cloudflare Workers Builds
deploys independently of the GitHub check results.

GitHub Actions requires action references to use a full-length commit SHA.
When updating an action, pin the exact commit in the workflow. The default
`GITHUB_TOKEN` has read-only permissions and cannot approve pull requests.
The Scorecard job requests `security-events: write` to upload findings from
trusted runs. Pull request workflows use read-only permissions.

## Accepted Scorecard recommendations

The repository-posture findings below are explicitly accepted recommendations,
not fixed application vulnerabilities. Their code-scanning alerts are closed as
accepted findings with an individual explanation. Scorecard, CodeQL, dependency
review, and all existing checks remain enabled; no queries or results are filtered
to conceal these decisions. Full Scorecard results remain available in GitHub.

| Check | Accepted reason | Reassessment |
| --- | --- | --- |
| [Branch protection](https://github.com/luberan/ip-info/security/code-scanning/11) | The ruleset protects `main` against history rewrites and deletion. The project keeps direct fast-forward pushes available and treats status checks as advisory. | Revisit if the project adopts mandatory PRs or required status checks. |
| [Fuzzing](https://github.com/luberan/ip-info/security/code-scanning/12) | No recognized external fuzzer integration is currently present. Unit and runtime smoke tests exist, but are not claimed to be fuzzing. | Revisit when parsing/input risk or project scope justifies a real fuzzing integration. |
| [Code review](https://github.com/luberan/ip-info/security/code-scanning/13) | Independent approvals are not mandatory, and past changesets have no such approvals. Review history cannot be retroactively fabricated. | Revisit if mandatory independent review becomes part of the project workflow. |
| [Maintained](https://github.com/luberan/ip-info/security/code-scanning/14) | Scorecard flags a repository younger than 90 days. Repository age is not an actionable code defect. | Reassess after the repository is at least 90 days old; do not manufacture activity for a score. |
| [OpenSSF Best Practices badge](https://github.com/luberan/ip-info/security/code-scanning/15) | No badge or certification is currently claimed. Adding an unearned badge would misrepresent the project. | Revisit after actually completing the applicable criteria and registration. |

These decisions do not waive investigation of new application vulnerabilities,
dependency advisories, or credential leaks. Reopen an accepted finding if its
assumptions change.
