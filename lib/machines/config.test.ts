import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, it, expect, vi } from "vitest";
import { changeMachine, readMachines } from "./config";
import { readSettings } from "@/lib/settings";
let dir: string;
const config = {
  name: "Homelab",
  destination: "homelab",
  nodePath: "/node",
  companionPath: "/companion",
  scanRoot: "/dev",
};
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "dm-machines-"));
  vi.stubEnv("DOCKMASTER_DATA_DIR", dir);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await fs.rm(dir, { recursive: true, force: true });
});
it("preserves module settings and stable identity across edits and removal", async () => {
  await fs.writeFile(
    path.join(dir, "settings.json"),
    JSON.stringify({ modules: { ports: false, logbook: true } }),
  );
  const [saved] = await changeMachine(config);
  expect(saved.id).not.toBe("local");
  await changeMachine({ ...saved, name: "Renamed", destination: "new-host" });
  expect((await readMachines())[0]).toMatchObject({
    id: saved.id,
    name: "Renamed",
    destination: "new-host",
  });
  expect((await readSettings()).modules).toMatchObject({
    ports: false,
    logbook: true,
  });
  expect((await fs.stat(path.join(dir, "machines.json"))).mode & 0o777).toBe(
    0o600,
  );
  await changeMachine(saved.id, true);
  expect(await readMachines()).toEqual([]);
});
it("serializes simultaneous saves without losing machines", async () => {
  await Promise.all([
    changeMachine(config),
    changeMachine({ ...config, name: "Second" }),
  ]);
  expect(await readMachines()).toHaveLength(2);
});
it("does not silently replace corrupt configuration", async () => {
  await fs.writeFile(path.join(dir, "machines.json"), "invalid");
  await expect(changeMachine(config)).rejects.toThrow();
  expect(await fs.readFile(path.join(dir, "machines.json"), "utf8")).toBe(
    "invalid",
  );
});
