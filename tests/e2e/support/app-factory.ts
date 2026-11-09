import { startApp } from "../../../src/server/app";
export function createTestApp(o: { hostPort: number; previewPort: number }) {
  return startApp({ hostPort: o.hostPort, previewPort: o.previewPort, devHarness: true });
}
