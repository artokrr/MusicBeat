#!/bin/sh
# Run from the repository root. Does not modify shared node_modules or install.
set -eu
if node --input-type=module -e "import {createRequire} from 'node:module';const r=createRequire(process.cwd()+'/client/model-test.html');const p=r('three/package.json');if(p.version!=='0.170.0')process.exit(1)" 2>/dev/null; then
  exit 0
fi
# The package blocks package.json subpath exports, so check its entry directly.
if node --input-type=module -e "import {createRequire} from 'node:module';const r=createRequire(process.cwd()+'/client/model-test.html');if(r('three').REVISION!=='170')process.exit(1)" 2>/dev/null; then
  exit 0
fi
mkdir -p tools/out/three client/node_modules
curl --fail --location --silent --show-error https://registry.npmjs.org/three/-/three-0.170.0.tgz -o tools/out/three-0.170.0.tgz
tar -xzf tools/out/three-0.170.0.tgz --strip-components=1 -C tools/out/three
if [ -e client/node_modules/three ] || [ -L client/node_modules/three ]; then
  echo 'client/node_modules/three already exists with another revision; leaving it unchanged' >&2
  exit 1
fi
ln -s ../../tools/out/three client/node_modules/three
