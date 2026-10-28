import { ensureService } from "./service.ts";
const service = await ensureService();
console.log(`${service.origin}/#token=${service.token}`);
