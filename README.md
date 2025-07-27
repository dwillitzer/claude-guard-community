# Claude Guard Community Edition

A lightweight security wrapper for Claude CLI that adds basic pattern-based protection.

## Features

- ✅ Command blocking patterns
- ✅ Path blocking patterns  
- ✅ Warning for potentially dangerous commands
- ✅ Command aliases (@test, @build, etc.)
- ✅ Audit log viewing and search
- ✅ Git repository safety warnings
- ✅ Simple JSON configuration
- ✅ Config initialization helper
- ✅ Zero dependencies (pure Node.js)

## Installation

First, install Claude CLI:
```bash
npm install -g @anthropic-ai/claude-code
```

Then install Claude Guard:
```bash
npm install -g claude-guard
```

## Usage

Simply replace `claude` with `claude-guard`:

```bash
# Instead of:
claude "Write a hello world program"

# Use:
claude-guard "Write a hello world program"
```

## New Features

### Command Aliases
Use `@` prefix for quick commands:
```bash
claude-guard @test     # Runs "run all tests in this project"
claude-guard @lint     # Runs "check code quality and style issues"
claude-guard @build    # Runs "build the project for production"
```

### Audit Log Tools
```bash
claude-guard --audit-tail              # Show last 10 commands
claude-guard --audit-search "npm"      # Search audit history
```

### Config Management
```bash
claude-guard --config-init             # Create example config
claude-guard --list-aliases            # Show all aliases
claude-guard --verify-integrity        # Check file integrity
```

## Configuration

Edit `~/.claude-guard/config.json`:

```json
{
  "version": "2.0",
  "policies": {
    "blockedPaths": ["/etc/**", "/System/**"],
    "blockedCommands": ["rm -rf /", "sudo rm"],
    "warnCommands": ["npm install", "pip install"]
  },
  "audit": {
    "enabled": true,
    "maxDays": 30
  },
  "aliases": {
    "@test": "run all tests in this project",
    "@lint": "check code quality and style issues",
    "@build": "build the project for production",
    "@deploy": "deploy to production server"
  }
}
```

## Credits

This tool is a community-built security wrapper for [Claude CLI](https://github.com/anthropics/claude-code) by Anthropic.

- **Claude CLI**: © Anthropic PBC - The AI assistant this tool wraps
- **Claude Guard Community**: MIT License (wrapper functionality only)

## Disclaimer

Claude Guard is an independent community project and is not affiliated with, endorsed by, or sponsored by Anthropic PBC. Claude CLI must be installed separately from Anthropic.

## License

MIT License - See LICENSE file for details.
