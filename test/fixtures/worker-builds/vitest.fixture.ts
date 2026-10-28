import { test } from "../../helpers/vitest.ts";
import { exerciseWorkerBuilds } from "./exercise.ts";

test("first case prepares usable builds", async () => exerciseWorkerBuilds(1));
test("second case reuses the worker builds", async () => exerciseWorkerBuilds(2));
