#!/usr/bin/env node
const { main } = await import("../dist/src/cli.js");
await main(["home", "--offline", "--fields", "bin,description,status,help"]);
