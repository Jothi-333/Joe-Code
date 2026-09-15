import { describe, expect, it } from "vitest"
import { mkdtemp, mkdir, writeFile } from "fs/promises"
import os from "os"
import path from "path"
import { ProjectBrain } from "../ProjectBrain"

describe("DependencyIndex", () => {
 it("resolves relative imports and tracks dependents", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "joe-code-deps-"))
  await mkdir(path.join(root, "src"))
  await writeFile(path.join(root, "src", "User.ts"), "export interface User { id: string }\n")
  await writeFile(path.join(root, "src", "UserService.ts"), "import { User } from './User'\nexport class UserService {}\n")
  await writeFile(path.join(root, "src", "index.ts"), "export { UserService } from './UserService'\n")
  const brain = new ProjectBrain(root)
  await brain.initialize()
  expect(brain.getDependencies("src/UserService.ts")).toContain("src/User.ts")
  expect(brain.getDependents("src/User.ts")).toContain("src/UserService.ts")
  expect(brain.getDependencies("src/index.ts")).toContain("src/UserService.ts")
 })
})
