# Security Policy

## Supported version

Only the latest version on `main` is supported.

## Reporting

Please use GitHub private vulnerability reporting when available. Do not publish credentials, private repository data, personal information, or exploit details in a public issue.

## Scope

The default fixture demo is local-only and deterministic. Version 0.3 also
contains an explicitly selected adapter for unauthenticated GitHub public
repository metadata.

The GitHub adapter:

- accepts only normalized `owner/repo` identifiers or canonical HTTPS URLs on
  `github.com` and `api.github.com`;
- reconstructs a fixed `GET https://api.github.com/repos/{owner}/{repo}` URL,
  rejects redirects, and exposes no generic request or write method;
- does not read environment credentials or send authorization headers;
- enforces caller cancellation, a bounded timeout, a bounded response size,
  public-repository identity checks, and runtime response-shape validation.

It does not read source code or README content, access private repositories,
implement production caching/backoff, or provide a production availability
guarantee. Public GitHub metadata is untrusted external input and should be
escaped by any downstream renderer.
