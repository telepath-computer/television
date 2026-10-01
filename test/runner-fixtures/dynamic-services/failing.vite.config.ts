import fs from "node:fs";

const firstURL = process.env.TV_DYNAMIC_FIRST_URL;
const reportPath = process.env.TV_DYNAMIC_FAILURE_REPORT;
if (!firstURL) throw new Error("TV_DYNAMIC_FIRST_URL was not published before the failure probe loaded");
if (!reportPath) throw new Error("TV_DYNAMIC_FAILURE_REPORT is required for the failure probe");
fs.writeFileSync(reportPath, `${firstURL}\n`);
throw new Error("intentional later-service config failure");
