PHARMACOPOLA Monitor 1.0.2 for Mac

- Fixes the app staying in the Dock (bouncing, pale icon) without opening a window on some Macs:
  removes a private WebKit setting, uses the current activation API on macOS 14+, declares the
  application class explicitly.
- Writes a launch log to ~/Library/Logs/PHARMACOPOLA-Monitor.log to help diagnose problems.
- Tested on macOS 14, 15 and 26, including a launch through Finder/LaunchServices.

Install or update: `curl -fsSL https://jurajgre-72.github.io/pharma-monitor/install-mac.sh | bash`
