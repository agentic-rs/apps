# Repository instructions

- The assistant manages Git commits in this repository.
- Maintain all official Apell apps together on `main`; each app keeps its own package and stable applet ID.
- Use the canonical icons in `shared/assets` and the shared Apell theme. Refresh host artwork and color tokens with `bun run sync:brand` instead of creating separate app branding.
- For future Apell host changes, use a dedicated Git worktree of the sibling Apell repository. Keep applet and host commits in their respective repositories.
- Never commit personal information, including usernames, email addresses, hostnames, personal absolute paths, or identifying IP addresses. Git commit author names and emails are the exception. Never commit secrets, recordings, downloaded models, or local environment files.
- Prefer 2-space indentation and prioritize code quality over minimizing changes.
- During planning, consider alternatives, challenge assumptions, and ask questions when context is unclear.
- When asked why, classify the suspected issue, explain whether it is acceptable, and suggest a better approach when needed.
- When changing a representative case, check whether similar code needs the same change.
- Prefer Rust, TypeScript over JavaScript, and Bun over Python except for scientific computing.
- Use snake_case for TypeScript fields that may be serialized; this does not apply to type or function names.
- Never use OpenAI Sites or OpenAI-managed hosting. Keep websites local unless the user explicitly names and approves a hosting provider.
- Never use computer use to manipulate Chrome.
