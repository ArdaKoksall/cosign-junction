# Contributing to Cosign

Start with the [developer setup](docs/architecture/developer-setup.md). The [Junction demo](README.md#run-the-junction-demo) and [verification guide](validation/README.md#credential-free-verification) use simulated supplier data and can run without provider API keys.

- For an ordinary bug, [open an issue](https://github.com/ArdaKoksall/cosign-junction/issues/new) with reproduction steps, what you expected, and the version or commit you used. Follow the [security policy](SECURITY.md) for vulnerabilities.
- Keep pull requests focused. Explain what changed and why, and list the checks you ran. For UI changes, add a screenshot when it helps review.
- Write documentation, identifiers, and comments in English. Keep user interface copy available in English and Finnish.
- Use synthetic data in examples and tests. Keep `.env` files, credentials, buyer records, and organizer-provided supplier datasets out of commits and issue attachments.
