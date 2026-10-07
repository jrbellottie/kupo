import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const buildInputs = [
  "src", "public", "electron", "index.html", "package.json", "package-lock.json",
  "tsconfig.json", "tsconfig.node.json", "vite.config.ts", "electron-builder.json5",
  "scripts/make-icons.mjs", "scripts/dist-linux.mjs",
];

function execute(run, command, args, options = {}) {
  const result = run(command, args, { stdio: "inherit", ...options });
  if (result.error) throw new Error(`Could not start ${command}: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(`${command} failed (${result.signal ?? `exit ${result.status}`}).`);
  }
  return result;
}

function buildLinux(root, run) {
  execute(run, "npm", ["run", "icons"], { cwd: root });
  execute(run, "npm", ["run", "build"], { cwd: root });
  execute(run, "npm", [
    "exec", "--", "electron-builder", "--config", "electron-builder.json5",
    "--linux", "AppImage", "--x64", "--publish", "never",
  ], { cwd: root });
}

export function buildInWsl(source, run = spawnSync) {
  const workspace = mkdtempSync(path.join(tmpdir(), "kupo-appimage-"));
  try {
    for (const input of buildInputs) {
      const destination = path.join(workspace, input);
      mkdirSync(path.dirname(destination), { recursive: true });
      cpSync(path.join(source, input), destination, { recursive: true });
    }
    execute(run, "npm", ["ci"], { cwd: workspace });
    buildLinux(workspace, run);

    const { version } = JSON.parse(readFileSync(path.join(workspace, "package.json"), "utf8"));
    const filename = `Kupo-Linux-${version}.AppImage`;
    const output = path.join(source, "release", version);
    mkdirSync(output, { recursive: true });
    cpSync(path.join(workspace, "release", version, filename), path.join(output, filename));
    console.log(`AppImage copied to ${path.join(output, filename)}`);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
}

export function distLinux({ platform = process.platform, root = projectRoot, run = spawnSync } = {}) {
  if (platform === "linux") {
    buildLinux(root, run);
    return;
  }
  if (platform !== "win32") {
    throw new Error("AppImage packaging requires Linux or Windows with WSL. You can also use the Build AppImage GitHub Actions workflow.");
  }

  console.log("Building the Linux AppImage through the default WSL distribution.");
  const result = run("wsl.exe", ["--exec", "wslpath", "-a", "-u", root], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error || result.status !== 0) {
    const details = result.error?.message ?? `${result.stderr ?? ""}${result.stdout ?? ""}`.replaceAll("\0", "").trim();
    throw new Error(
      `WSL is unavailable. In an administrator PowerShell, run wsl --install -d Ubuntu, ` +
      `restart if requested, and complete Ubuntu's first-run setup. Install Linux Node.js 22 in WSL, ` +
      `then retry npm run dist:linux.\n${details}`
    );
  }
  const source = result.stdout.trim();
  if (!source.startsWith("/")) throw new Error(`WSL returned an invalid source path: ${source}`);
  execute(run, "wsl.exe", [
    "--exec", "bash", "-l", `${source.replace(/\/$/, "")}/scripts/dist-linux-wsl.sh`, source,
  ]);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    if (process.argv[2] === "--wsl-build") {
      if (process.platform !== "linux" || !process.argv[3]) {
        throw new Error("--wsl-build requires Linux and a source directory.");
      }
      buildInWsl(process.argv[3]);
    } else {
      distLinux();
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
