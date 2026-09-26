# AniClaw

**An AI coding assistant for your terminal and Telegram.**

AniClaw helps you understand a codebase, turn a goal into an implementation plan, and prepare code changes for review. Built with TypeScript and Bun, this version uses **OpenRouter** to connect to language models and keeps file changes and shell commands staged until you approve them.
<img width="1203" height="644" alt="Screenshot 2026-09-27 0157582" src="https://github.com/user-attachments/assets/bc381fde-ad08-43f1-a98e-f047671d3f47" />
## Features

- **Ask Mode** — explore the codebase and optionally save terminal answers as Markdown.
- **Plan Mode** — research a goal, generate up to 15 steps, and choose which steps to execute.
- **Agent Mode** — inspect files and prepare changes for a concrete development task.
- **CLI and Telegram** — work interactively in a terminal or send commands to your bot.
- **Approval workflow** — review diffs and accept or reject staged operations.
- **Workspace tools** — read, list, search, and analyze project files; stage file creation, edits, deletion, and folders.
- **Shell commands** — queue commands to run after approval.
- **Optional web research** — search and scrape using Firecrawl in supported modes.
- **Local skills** — discover and read `SKILL.md` instructions.
- **Rate-limit recovery** — respect supported OpenRouter retry delays with one bounded retry.

## Quick start

### 1. Install dependencies

Install [Bun](https://bun.sh), open a terminal in the AniClaw folder, and run:

```sh
bun install
```

### 2. Create your environment file

Create `.env` in the project root:

```dotenv
# Required for all AI modes
OPENROUTER_API_KEY=your_openrouter_api_key
OPENROUTER_DEFAULT_MODEL=your_openrouter_model_id

# Optional: Firecrawl web search and scraping
FIRECRAWL_API_KEY=

# Required only for Telegram mode
TELEGRAM_BOT_TOKEN=
TELEGRAM_OWNER_ID=

# Optional: extra skill directories separated by semicolons
SKILLS_DIRS=
```

Obtain your key from [OpenRouter](https://openrouter.ai) and replace `your_openrouter_model_id` with a model ID from its model catalog. Choose a model that supports tool calling; Agent and Plan modes depend on it.

| Variable | Purpose |
| --- | --- |
| `OPENROUTER_API_KEY` | Authenticates requests to OpenRouter |
| `OPENROUTER_DEFAULT_MODEL` | Selects the model for Ask, Plan, and Agent modes |
| `FIRECRAWL_API_KEY` | Enables Firecrawl-backed web research |
| `TELEGRAM_BOT_TOKEN` | Authenticates your Telegram bot |
| `TELEGRAM_OWNER_ID` | Numeric chat ID allowed to control the bot |
| `SKILLS_DIRS` | Additional directories to search for skill files |

This version connects through **OpenRouter**, not directly to Google Gemini. A Google AI Studio key is not a substitute for an OpenRouter key. `GOOGLE_GENERATIVE_AI_*` settings are not read by this version.

Keep API keys private. The project excludes `.env` through `.gitignore`.

### 3. Start AniClaw

```sh
bun index.ts wakeup
```

Choose **CLI** or **Telegram**. In CLI mode, select a working mode and describe your task.

## Use the `aniclaw` command

Register the package from the AniClaw project folder:

```sh
bun link
```

With Bun's executable directory on your `PATH`, you can launch it with:

```sh
aniclaw wakeup
```

If you move or rename the project folder, run `bun link` again from the new location. Direct execution with `bun index.ts wakeup` remains available from the project folder.

### Work in another directory

AniClaw uses the **current working directory** as its workspace. Global command registration does not automatically load credentials from the installation folder.

To work on another project while explicitly loading AniClaw's `.env`, use an absolute path. For example, in PowerShell:

```powershell
cd "C:\Projects\my-website"
bun --env-file="C:\Tools\AniClaw\.env" "C:\Tools\AniClaw\index.ts" wakeup
```

Replace `C:\Tools\AniClaw` with your installation directory. This example keeps `C:\Projects\my-website` as the workspace.

## Working modes

| Mode | Best for | Example request |
| --- | --- | --- |
| Ask | Understanding code and architecture | “Explain how the approval flow works.” |
| Plan | Breaking a larger goal into selectable steps | “Plan a responsive landing page in a landingpage folder.” |
| Agent | Preparing a specific code change | “Update README.md to match the current project.” |

### Ask

Ask Mode researches your question using workspace tools and displays an answer. The terminal interface can save that answer to a new `.md` file after confirmation and approval.

### Plan

1. Describe your goal.
2. AniClaw researches the workspace without modifying it.
3. It formats and validates a plan containing 1–15 steps.
4. Select the steps you want to execute.
5. In the terminal, confirm execution; in Telegram, press **Proceed**.
6. Review the staged changes before applying them.

Research and plan formatting use separate model requests. Invalid plan output receives one formatting retry.

### Agent

Describe a concrete task. The agent can inspect the project and stage file changes, folders, deletions, and shell commands. Its final response is followed by the approval workflow when changes are pending.

## Review changes before applying

```text
Task → Workspace research → Staged changes → Your review → Apply approved operations
```

The CLI offers:

- **Approve and apply all**
- **Review one by one**, including file diffs
- **Cancel**

Telegram offers **Show Diff**, **Accept All**, and **Reject All**.

Approved shell commands run with your local user's permissions. The approval system is not an operating-system sandbox. Inspect commands as well as file diffs before applying them.

Workspace tools exclude common dependency, build, Git, log, and `.env` paths by default. Text-file reads are limited to 1 MiB. Configuration lives in `modes/agent/types.ts`.

## Telegram setup

1. Create a bot through [BotFather](https://t.me/BotFather).
2. Set `TELEGRAM_BOT_TOKEN` in `.env`.
3. Set `TELEGRAM_OWNER_ID` to your numeric private-chat ID.
4. Open a private conversation with the bot and send `/start` so it can message you.
5. Launch AniClaw from the desired workspace and choose **Telegram**.

The authorization check compares the incoming **chat ID** with `TELEGRAM_OWNER_ID`. Use a private chat for this setup.

| Command | Action |
| --- | --- |
| `/start` | Show the welcome message |
| `/ask <question>` | Ask about the codebase |
| `/agent <task>` | Prepare changes for a task |
| `/plan <goal>` | Generate a selectable implementation plan |

```text
/ask How is this project organized?
/agent Improve the README installation instructions.
/plan Add a contact form to the landing page.
```

The bot runs on your computer and operates on its local workspace. Keep the process running while using Telegram. Press `Ctrl+C` in the terminal to stop it.

## Web research and local skills

Set `FIRECRAWL_API_KEY` for Firecrawl-backed search and scraping. Plan mode and Telegram research flows include web tools when the key is present. Terminal Ask mode exposes web tools regardless of that setting, so calls to Firecrawl still require a valid key when used.

Skill discovery searches:

- Directories in `SKILLS_DIRS`, separated by semicolons.
- `~/.cursor/skills-cursor`
- `~/.claude/skills`

The skill tools read local instructions; they do not install plugins.

## Troubleshooting

| Problem | What to check |
| --- | --- |
| `OPENROUTER_API_KEY is missing` | Set the variable and ensure the intended `.env` is loaded. |
| `OPENROUTER_DEFAULT_MODEL is missing` | Supply an OpenRouter model ID. |
| HTTP 401 or an authentication error | Check that the key belongs to OpenRouter and is valid. |
| Model unavailable or unsupported tools | Check the model ID, account access, and tool-calling support. |
| `aniclaw` cannot find its entry point | Run `bun link` again from the current installation folder. |
| Telegram does not respond | Check the token, owner chat ID, private-chat setup, and running bot process. |
| Plan JSON is invalid | Use a clearer task or a model that reliably follows JSON instructions. |

### Rate limits

One task can require multiple model requests. When OpenRouter returns HTTP 429, AniClaw reads supported `Retry-After` or reset information, waits, and retries the failing model request once. If no usable reset information is present, the fallback wait is 60 seconds. Delays over 65 seconds are not waited out automatically.

If the retry fails, check your provider's usage and quota. A retry does not increase your allowance or restart previously executed tools.

**This restored version does not include proactive request pacing.** Avoid running multiple tasks against a constrained quota. Restarting the app does not reset provider-side limits.

## Project structure

```text
AniClaw/
├── index.ts                  # CLI entry point and wakeup command
├── ai/
│   ├── ai.config.ts          # OpenRouter model configuration
│   ├── index.ts              # Model helper export
│   └── rate-limit.ts         # Bounded retry handling
├── modes/
│   ├── cli.ts                # CLI mode selection
│   ├── ask/                  # Questions and Markdown export
│   ├── agent/                # Tools, staging, diffs, and approval
│   ├── plan/                 # Research, JSON validation, and execution
│   └── telegram/             # Bot handlers and interactive sessions
├── tui/                      # Terminal banner and Markdown rendering
├── tests/                    # Regression tests
├── package.json
└── README.md
```

## Development

```sh
# Run regression tests
bun test

# Check TypeScript
bunx tsc --noEmit

# Inspect available CLI commands
bun index.ts --help
```

Tests cover plan parsing, execution and approval paths, Telegram plan interactions, configuration validation, and rate-limit handling. They use mocked model responses; they do not validate live API credentials or provider quotas.

## Current limitations

- Plans, staged operations, and Telegram sessions are held in memory; restarting loses unfinished work.
- There is no persistent task history, resume command, or automatic rollback.
- Shell commands execute after approval, so the agent does not receive their output during its generation loop.
- Some API failures in Ask and Agent flows may surface as terminal errors rather than recoverable prompts.
- Telegram messages and diff previews may be truncated.
- There is no built-in provider selector or user-level credential setup command.

## Built with

TypeScript · Bun · Vercel AI SDK · OpenRouter · Clack · Telegraf · Firecrawl · Zod · Chalk · Figlet
