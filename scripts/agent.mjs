// Installs or removes the per-user LaunchAgent that keeps Dockmaster running.
// Records absolute paths at install time because launchd provides a minimal
// environment (no nvm, no homebrew PATH).

import { execFileSync } from "child_process";
import { createRequire } from "module";
import fs from "fs";
import os from "os";
import path from "path";

const LABEL = "com.dockmaster.app";

function repoRoot() {
  return path.resolve(import.meta.dirname, "..");
}

function plistPath() {
  return path.join(os.homedir(), "Library", "LaunchAgents", `${LABEL}.plist`);
}

function logsDir() {
  const configured = process.env.DOCKMASTER_DATA_DIR || "~/.dockmaster";
  const dir = configured.startsWith("~")
    ? path.join(os.homedir(), configured.slice(1))
    : configured;
  return path.join(dir, "logs");
}

function nextBin() {
  const require = createRequire(import.meta.url);
  return require.resolve("next/dist/bin/next");
}

function plistXml() {
  const logs = logsDir();
  fs.mkdirSync(logs, { recursive: true });
  const args = [
    process.execPath,
    nextBin(),
    "start",
    "-H",
    "127.0.0.1",
  ];
  const port = process.env.PORT || "4310";
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${args.map((a) => `    <string>${esc(a)}</string>`).join("\n")}
  </array>
  <key>WorkingDirectory</key><string>${esc(repoRoot())}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PORT</key><string>${esc(port)}</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ProcessType</key><string>Background</string>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>${esc(path.join(logs, "Dockmaster.log"))}</string>
  <key>StandardErrorPath</key><string>${esc(path.join(logs, "Dockmaster.error.log"))}</string>
</dict>
</plist>
`;
}

function domain() {
  return `gui/${process.getuid()}`;
}

function bootout() {
  try {
    execFileSync("/bin/launchctl", ["bootout", `${domain()}/${LABEL}`], { stdio: "ignore" });
  } catch {
    // Not loaded; nothing to do.
  }
}

function install() {
  if (!fs.existsSync(path.join(repoRoot(), ".next", "BUILD_ID"))) {
    console.error("No production build found. Run `npm run build` first.");
    process.exit(1);
  }
  const file = plistPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, plistXml());
  bootout();
  try {
    execFileSync("/bin/launchctl", ["bootstrap", domain(), file], { stdio: "pipe" });
  } catch (err) {
    console.error(`launchctl bootstrap failed: ${err.stderr || err.message}`);
    process.exit(1);
  }
  const port = process.env.PORT || "4310";
  console.log(`Installed ${LABEL} at ${file}`);
  console.log(`Open http://localhost:${port}`);
}

function uninstall() {
  bootout();
  const file = plistPath();
  if (fs.existsSync(file)) {
    fs.unlinkSync(file);
    console.log(`Removed ${file}`);
  } else {
    console.log("Dockmaster was not installed.");
  }
  console.log(`Logs were left in ${logsDir()}.`);
}

const command = process.argv[2];
if (command === "install") install();
else if (command === "uninstall") uninstall();
else {
  console.error("Usage: node scripts/agent.mjs install|uninstall");
  process.exit(1);
}
