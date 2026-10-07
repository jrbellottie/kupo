import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildInWsl, distLinux } from "./dist-linux.mjs";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

test("WSL shell script uses LF line endings for bash", () => {
  const script = readFileSync(new URL("./dist-linux-wsl.sh", import.meta.url), "utf8");
  assert.equal(script.includes("\r"), false, "CRLF makes bash interpret pipefail with a trailing carriage return");
  assert.ok(script.startsWith("#!/usr/bin/env bash\n"));
});

test("Windows routes through WSL with paths containing spaces passed as arguments", () => {
  const calls = [];
  distLinux({
    platform: "win32", root: "E:\\my kupo",
    run: (command, args, options) => {
      calls.push({ command, args, options });
      return { status: 0, stdout: "/mnt/e/my kupo\n" };
    },
  });
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].args, ["--exec", "wslpath", "-a", "-u", "E:\\my kupo"]);
  assert.deepEqual(calls[1].args, [
    "--exec", "bash", "-l", "/mnt/e/my kupo/scripts/dist-linux-wsl.sh", "/mnt/e/my kupo",
  ]);
  assert.ok(calls.every(({ command }) => command === "wsl.exe"));
});

test("missing WSL gives setup instructions without starting a build", () => {
  let calls = 0;
  assert.throws(() => distLinux({
    platform: "win32",
    run: () => { calls++; return { status: 1, stderr: "WSL not installed" }; },
  }), /wsl --install -d Ubuntu.*Linux Node.js 22/s);
  assert.equal(calls, 1);
});

test("WSL build failures propagate", () => {
  assert.throws(() => distLinux({
    platform: "win32",
    run: (_command, args) => args.includes("wslpath")
      ? { status: 0, stdout: "/mnt/e/kupo\n" } : { status: 9 },
  }), /exit 9/);
});

test("native Linux retains icon, build, and AppImage packaging steps", () => {
  const calls = [];
  distLinux({
    platform: "linux", root: "/source",
    run: (command, args, options) => { calls.push({ command, args, options }); return { status: 0 }; },
  });
  assert.deepEqual(calls.map(({ args }) => args), [
    ["run", "icons"], ["run", "build"],
    ["exec", "--", "electron-builder", "--config", "electron-builder.json5",
      "--linux", "AppImage", "--x64", "--publish", "never"],
  ]);
  assert.ok(calls.every(({ command, options }) => command === "npm" && options.cwd === "/source"));
});

test("a failed native step stops subsequent packaging steps", () => {
  let calls = 0;
  assert.throws(() => distLinux({
    platform: "linux", run: () => { calls++; return { status: 2 }; },
  }), /exit 2/);
  assert.equal(calls, 1);
});

test("unsupported hosts fail explicitly", () => {
  assert.throws(() => distLinux({ platform: "darwin" }), /requires Linux or Windows with WSL/);
});

for (const fail of [false, true]) {
  test(`WSL staging isolates Windows files and cleans up after ${fail ? "failure" : "success"}`, () => {
    const source = mkdtempSync(path.join(tmpdir(), "kupo-packaging-test-"));
    let workspace;
    try {
      const files = [
        "src/app.ts", "public/icon.svg", "electron/main.ts", "index.html", "package-lock.json",
        "tsconfig.json", "tsconfig.node.json", "vite.config.ts", "electron-builder.json5",
        "scripts/make-icons.mjs", "scripts/dist-linux.mjs",
        "node_modules/windows-only", "dist/windows-only", "build/icon.ico",
        "release/windows.exe", ".env",
      ];
      for (const file of files) {
        mkdirSync(path.dirname(path.join(source, file)), { recursive: true });
        writeFileSync(path.join(source, file), "original");
      }
      writeFileSync(path.join(source, "package.json"), JSON.stringify({ version: "1.2.3" }));
      const calls = [];
      const run = (_command, args, { cwd }) => {
        workspace = cwd;
        calls.push(args);
        assert.notEqual(cwd, source);
        assert.equal(existsSync(path.join(cwd, "node_modules", "windows-only")), false);
        assert.equal(existsSync(path.join(cwd, ".env")), false);
        assert.equal(readFileSync(path.join(cwd, "src", "app.ts"), "utf8"), "original");
        if (fail) return { status: 1 };
        if (args.includes("electron-builder")) {
          const output = path.join(cwd, "release", "1.2.3");
          mkdirSync(output, { recursive: true });
          writeFileSync(path.join(output, "Kupo-Linux-1.2.3.AppImage"), "linux artifact");
        }
        return { status: 0 };
      };
      if (fail) {
        assert.throws(() => buildInWsl(source, run), /exit 1/);
        assert.equal(calls.length, 1);
        assert.equal(existsSync(path.join(source, "release", "1.2.3")), false);
      } else {
        buildInWsl(source, run);
        assert.deepEqual(calls[0], ["ci"]);
        assert.equal(calls.length, 4);
        assert.equal(readFileSync(path.join(source, "release", "1.2.3", "Kupo-Linux-1.2.3.AppImage"), "utf8"), "linux artifact");
      }
      assert.equal(existsSync(workspace), false);
      for (const file of files) assert.equal(readFileSync(path.join(source, file), "utf8"), "original");
    } finally {
      rmSync(source, { recursive: true, force: true });
    }
  });
}

test("npm entry points keep Windows packaging unchanged", () => {
  assert.equal(pkg.scripts["dist:linux"], "node scripts/dist-linux.mjs");
  assert.equal(pkg.scripts["dist:win"], "npm run build && electron-builder --win");
});
