# Claude Guard

A simple security wrapper for Claude CLI that automatically blocks dangerous commands.

## What it does

```bash
npm install -g claude-guard
claude-guard "help me debug this code"  # Same as claude, but safer
```

Instead of Claude running `rm -rf /` or reading your SSH keys, Claude Guard automatically blocks dangerous operations while allowing normal development tasks.

## What this IS and ISN'T

### ✅ Good for:
- **Basic safety**: Prevents `rm -rf /`, credential theft, obvious disasters
- **Development teams**: Simple pattern-based blocking without complex setup  
- **Drop-in replacement**: Use `claude-guard` exactly like `claude`
- **Zero configuration**: Works out of the box with sensible defaults

### ❌ NOT for:
- **Enterprise security**: This is not enterprise-grade protection
- **Determined attackers**: Basic pattern matching, not AI security analysis
- **Compliance**: No central management, audit trails, or enterprise features
- **Perfect security**: Can be bypassed by someone who really wants to

**Perfect for**: Small teams wanting basic safety rails  
**Not suitable for**: Enterprise security requirements

## Quick comparison

| Tool | Approach | Best for |
|------|----------|----------|
| `claude` | No protection | Trusted environments |
| `claude-guard` | Basic pattern blocking | Development teams |
| Enterprise tools | Full security suite | Regulated industries |

## Installation

```bash
# 1. Install Claude CLI first
npm install -g @anthropic-ai/claude-code

# 2. Install Claude Guard
npm install -g claude-guard

# 3. Use it exactly like claude
claude-guard "explain this error"
```

---

## Features & Configuration

### Command aliases
```bash
claude-guard @test     # Runs "run all tests in this project"
claude-guard @build    # Runs "build the project for production"  
claude-guard @deploy   # Runs "deploy to production server"
```

### Audit tools
```bash
claude-guard --audit-tail        # Show last 10 commands
claude-guard --verify-integrity  # Check for tampering
```

### Configuration
```bash
claude-guard --config-init   # Create config file
claude-guard --list-aliases  # Show all aliases
```

### ⚡ NEW: Claude Settings Integration
Claude Guard now supports Claude's native settings.json format! Use your existing `.claude/settings.json` files directly:

```json
{
  "permissions": {
    "allow": [
      "Bash(git *)",
      "Bash(npm *)", 
      "Read(*)",
      "Edit(*)"
    ],
    "deny": [
      "Bash(rm -rf /*)",
      "Bash(sudo rm -rf /*)"
    ]
  }
}
```

**Benefits:**
- **Standards Compliance**: Uses Claude's official settings format
- **Layered Security**: Claude rules + additional guard patterns  
- **Easy Migration**: Existing `.claude/settings.json` files work immediately
- **Backwards Compatible**: Guard-only mode preserved

Enable in `~/.claude/guard/config.json`:
```json
{
  "policies": {
    "useClaudeSettings": true,
    "claudeSettingsFirst": true
  }
}
```

For comprehensive configuration, check out [claude-settings](https://github.com/dwillitzer/claude-settings) which provides 900+ curated development tool patterns.

## 🛡️ Security Approach

### Default Allowed Actions
- **Development tools**: npm, yarn, pip, cargo, go build
- **Version control**: git commands, git operations  
- **Containers**: docker run, docker build, docker-compose
- **File operations**: reading files, listing directories
- **Safe utilities**: curl, wget (to known safe domains)

### Default Blocked Actions  
- **System destruction**: `rm -rf /`, `sudo rm`, `mkfs`, `format`
- **Credential access**: Reading `/etc/passwd`, SSH keys, environment secrets
- **Network attacks**: Port scanning, suspicious downloads
- **Privilege escalation**: Unauthorized sudo, system modifications

### Warning Actions
- **Package installs**: npm/pip/gem installs (warns but allows)
- **Git repository operations**: In repository root (warns about destructive commands)
- **System tools**: Some system utilities that could be misused

## 📋 Example Usage

### Basic Commands
```bash
# Analyze code (same as Claude CLI)
claude-guard "explain this function"

# Debug assistance  
claude-guard "help me fix this error: TypeError: Cannot read property"

# Code generation
claude-guard "create a REST API endpoint for user authentication"
```

### Using Command Aliases
```bash
claude-guard @test     # Runs "run all tests in this project"
claude-guard @lint     # Runs "check code quality and style issues"  
claude-guard @build    # Runs "build the project for production"
claude-guard @deploy   # Runs "deploy to production server"
```

### Security & Audit Tools
```bash
# View recent command history
claude-guard --audit-tail

# Search for specific commands
claude-guard --audit-search "npm"

# Verify file integrity 
claude-guard --verify-integrity

# View help and options
claude-guard --help
```

## ⚙️ Advanced Configuration

Create `~/.claude/guard/config.json` for custom patterns:

```json
{
  "version": "2.0",
  "policies": {
    "blockedPaths": ["/etc/**", "/System/**", "/usr/**"],
    "blockedCommands": ["rm -rf /", "sudo *", "dd if=*", "mkfs*"],
    "warnCommands": ["npm install", "pip install", "gem install"]
  },
  "audit": {
    "enabled": true,
    "maxDays": 30
  },
  "aliases": {
    "@test": "run all tests in this project",
    "@lint": "check code quality and style issues",
    "@build": "build the project for production",
    "@deploy": "deploy to production server",
    "@docs": "generate documentation for this project"
  }
}
```

## 🔍 Command Line Options

```bash
claude-guard --help              # Show help information
claude-guard --version           # Show version number
claude-guard --config            # Show config file location
claude-guard --config-init       # Create example config file
claude-guard --list-aliases      # Show all configured aliases
claude-guard --audit-tail        # Show last 10 audit entries
claude-guard --audit-search TERM # Search audit logs
claude-guard --verify-integrity  # Check file integrity
```

## ⚠️ Important Notes

- **Not enterprise-grade**: This is a basic pattern-based security tool
- **No central management**: Configuration is local to each machine  
- **Requires Claude CLI**: Must install `@anthropic-ai/claude-code` separately
- **Community support**: Use GitHub issues for questions and bug reports

## Credits

This tool is a community-built security wrapper for [Claude CLI](https://github.com/anthropics/claude-code) by Anthropic.

- **Claude CLI**: © Anthropic PBC - The AI assistant this tool wraps
- **Claude Guard Community**: MIT License (wrapper functionality only)

## Disclaimer

Claude Guard is an independent community project and is not affiliated with, endorsed by, or sponsored by Anthropic PBC. Claude CLI must be installed separately from Anthropic.

## License

MIT License - See LICENSE file for details.
