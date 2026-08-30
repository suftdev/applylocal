# ApplyLocal Privacy

ApplyLocal is a single-user local application. Candidate configuration, registered evidence, run state, and application records are stored under the local ApplyLocal data directory.

ApplyLocal reads only evidence sources that the user explicitly registers. Directory indexing excludes common dependency, build, Git, and environment-file paths. The application never reads browser cookie files or password stores.

Selected evidence excerpts and the current job or form observation are sent to the configured model provider. The provider may retain or process that data under its own terms.

API keys are read from the configured environment variable and are not written to `state.json`. Browser credentials remain in the dedicated persistent browser profile.

Application traces must not contain passwords, cookies, MFA codes, CAPTCHA values, government identifiers, or raw browser storage. Review local state before sharing diagnostics.

Delete the local ApplyLocal data directory to remove local configuration, evidence indexes, runs, attention items, and application records. Deleting the browser profile separately removes its login sessions.
