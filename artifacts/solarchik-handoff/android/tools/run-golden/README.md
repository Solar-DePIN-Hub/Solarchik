# Roof run golden traces

`app/src/test/resources/run-golden.json` is produced by the **web** simulation
(`src/lib/game/sim.ts` of the web build) so `RunSimParityTest` can check that the Kotlin port
(`game/run/RunSim.kt`) generates the same roofs, suns and enemies and moves the same way.

Regenerate:

    mkdir -p /tmp/simref/src && cd /tmp/simref && npm i esbuild@0.23
    cp <web>/src/lib/game/sim.ts <web>/src/lib/game/skins.ts src/
    echo 'export type RobotId = string;' > src/robots.ts
    cp <this dir>/ref.ts src/ && npx esbuild src/ref.ts --bundle --platform=node --outfile=ref.js
    node ref.js > <android>/app/src/test/resources/run-golden.json
