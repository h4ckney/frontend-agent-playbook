import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { remoteFixture, g } from "./remote-witness-evidence.mjs";
import { approve } from "./governance-evidence.mjs";

export async function migrationFixture() {
  const x = await remoteFixture({ legacy: true });
  try {
    await x.initialize();
    x.sourceAuthority = x.authority;
    x.plan = () =>
      g.planMigration(x.root, x.sourceAuthority, x.remoteAuthority);
    x.approve = () => approve({ ...x, authority: x.sourceAuthority }, x.plan());
    x.apply = (b) => g.migrate(x.root, x.sourceAuthority, x.remoteAuthority, b);
    x.local = () => {
      const main = new DatabaseSync(path.join(x.root, "trust-store.sqlite"), {
        readOnly: true,
      });
      try {
        return {
          version: main.prepare("PRAGMA user_version").get().user_version,
          approval: main
            .prepare("SELECT * FROM governance_receipts ORDER BY requestId")
            .all(),
          policy: main
            .prepare("SELECT id,revision,digest,policy FROM organizations")
            .get(),
          domains: main
            .prepare(
              "SELECT id,anchor,checkpoint,state FROM domains ORDER BY id",
            )
            .all(),
        };
      } finally {
        main.close();
      }
    };
    return x;
  } catch (error) {
    await x.cleanup();
    throw error;
  }
}
