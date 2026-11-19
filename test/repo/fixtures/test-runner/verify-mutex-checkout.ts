import { readFileSync } from "node:fs";
import path from "node:path";
import { mutexCheckout } from "./mutex-checkout.ts";

// Only downstream gate programs are authored substitutes. The verify process,
// its preflight, canonical test child, native fixture and mutex all stay real.
export function verifyMutexCheckout() {
  const f = mutexCheckout();
  const manifest = JSON.parse(readFileSync(path.join(f.root, "package.json"), "utf8"));
  manifest.scripts = Object.fromEntries(["lint", "type-check", "lint:package-manifests"].map(name => [name, `node phase.mjs ${name}`]));
  f.write("package.json", JSON.stringify(manifest));
  f.write("phase.mjs", `import fs from 'node:fs'; import {spawnSync} from 'node:child_process';
const phase=process.argv[2];
const result=spawnSync(process.execPath,${JSON.stringify(["scripts/test/cli.mjs", ...f.args])},{env:{...process.env,TV_TEST_RUNNER_FAKE_LOCAL_PREFLIGHT:'fixture:nested phase reached preflight'},encoding:'utf8'});
fs.writeFileSync('phase-'+phase+'.json',JSON.stringify({status:result.status,output:result.stdout+result.stderr}));
if(process.env.TV_MUTEX_HOLD_PHASE===phase){
  fs.writeFileSync(process.env.TV_MUTEX_READY, String(process.pid));
  const deadline=Date.now()+60000;
  while(!fs.existsSync(process.env.TV_MUTEX_RELEASE)){
    if(Date.now()>deadline) throw new Error('phase not released');
    await new Promise(resolve=>setTimeout(resolve,25));
  }
}
if(process.env.TV_MUTEX_FAIL_PHASE===phase) process.exit(1);
`);
  f.write("scripts/test/vibe-mode-check.mjs", "process.argv[2]='vibe-mode'; await import('../../phase.mjs');");
  f.write(f.file, `import fs from 'node:fs'; import {spawnSync} from 'node:child_process'; import {test,expect} from 'vitest';
test('canonical verify child', async()=>{
  const result=spawnSync(process.execPath,${JSON.stringify(["scripts/test/cli.mjs", ...f.args])},{env:{...process.env,TV_TEST_RUNNER_FAKE_LOCAL_PREFLIGHT:'fixture:nested test reached preflight'},encoding:'utf8'});
  fs.writeFileSync('phase-tests.json',JSON.stringify({status:result.status,output:result.stdout+result.stderr}));
  fs.writeFileSync(process.env.TV_MUTEX_READY, String(process.pid));
  if(!process.env.TV_MUTEX_HOLD_PHASE){
    const deadline=Date.now()+60000;
    while(!fs.existsSync(process.env.TV_MUTEX_RELEASE)){
      if(Date.now()>deadline) throw new Error('native fixture not released');
      await new Promise(resolve=>setTimeout(resolve,25));
    }
  }
  expect(process.env.TV_MUTEX_FAIL).not.toBe('1');
},65000);
`);
  return f;
}
