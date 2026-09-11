import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { dataDir, ensureDataDir } from "@/lib/settings";
import { record } from "./protocol";
export type RemoteMachine = {
  id: string;
  name: string;
  destination: string;
  nodePath: string;
  companionPath: string;
  scanRoot: string;
};
export type Machine = { id: string; name: string } & Partial<
  Omit<RemoteMachine, "id" | "name">
>;
export const LOCAL: Machine = { id: "local", name: "This Mac" };
export function validateMachine(value: unknown): RemoteMachine {
  if (!record(value)) throw new Error("Invalid machine configuration.");
  const { name, destination, nodePath, companionPath, scanRoot } = value;
  if (typeof name !== "string" || !name.trim() || name.length > 80)
    throw new Error("Provide a display name (up to 80 characters).");
  if (
    typeof destination !== "string" ||
    destination.length > 255 ||
    !/^(?:[a-zA-Z0-9_][a-zA-Z0-9_.-]*@)?[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(
      destination,
    )
  )
    throw new Error("Use an SSH alias or user@hostname, without options.");
  for (const p of [nodePath, companionPath, scanRoot])
    if (
      typeof p !== "string" ||
      !p.startsWith("/") ||
      p.length > 1024 ||
      /[\x00-\x1f\x7f]/.test(p)
    )
      throw new Error(
        "Node, companion and scan root must be absolute paths without control characters.",
      );
  const id = value.id === undefined ? randomUUID() : value.id;
  if (
    typeof id !== "string" ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id)
  )
    throw new Error("Invalid machine ID.");
  return {
    id,
    name: name.trim(),
    destination,
    nodePath: nodePath as string,
    companionPath: companionPath as string,
    scanRoot: scanRoot as string,
  };
}
export async function readMachines(): Promise<RemoteMachine[]> {
  try {
    const parsed: unknown = JSON.parse(
      await fs.readFile(path.join(dataDir(), "machines.json"), "utf8"),
    );
    if (!Array.isArray(parsed) || parsed.length > 20)
      throw new Error("Invalid machines file.");
    const machines = parsed.map(validateMachine);
    if (new Set(machines.map((m) => m.id)).size !== machines.length)
      throw new Error("Duplicate machine IDs in configuration.");
    return machines;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
}
let writing: Promise<unknown> = Promise.resolve();
export function changeMachine(
  value: unknown,
  remove = false,
): Promise<RemoteMachine[]> {
  const task = writing
    .catch(() => {})
    .then(async () => {
      const all = await readMachines();
      let next: RemoteMachine[];
      if (remove) {
        if (typeof value !== "string" || value === "local")
          throw new Error("Invalid machine ID.");
        next = all.filter((m) => m.id !== value);
      } else {
        const m = validateMachine(value);
        if (all.length >= 20 && !all.some((x) => x.id === m.id))
          throw new Error("Limit of 20 remote machines.");
        next = [...all.filter((x) => x.id !== m.id), m];
      }
      await ensureDataDir();
      const file = path.join(dataDir(), "machines.json");
      await fs.writeFile(file + ".tmp", JSON.stringify(next, null, 2), {
        mode: 0o600,
      });
      await fs.rename(file + ".tmp", file);
      return next;
    });
  writing = task;
  return task;
}
