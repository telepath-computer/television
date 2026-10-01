#!/usr/bin/env bash
set -euo pipefail

npm --workspace @telepath-computer/television-desktop run build

env -u ELECTRON_RUN_AS_NODE electron packages/desktop
