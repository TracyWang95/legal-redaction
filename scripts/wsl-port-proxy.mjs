#!/usr/bin/env node
// Copyright 2026 DataInfra-RedactionEverything Contributors
// SPDX-License-Identifier: Apache-2.0

import net from 'node:net';

function usage() {
  console.log(`Usage:
  node scripts/wsl-port-proxy.mjs <target-host> [listen-port] [target-port]

Example:
  node scripts/wsl-port-proxy.mjs 172.21.127.108 8000 8000
`);
}

const targetHost = process.argv[2];
const listenPort = Number.parseInt(process.argv[3] || '8000', 10);
const targetPort = Number.parseInt(process.argv[4] || String(listenPort), 10);

if (!targetHost || !Number.isInteger(listenPort) || !Number.isInteger(targetPort)) {
  usage();
  process.exit(2);
}

const server = net.createServer((client) => {
  const upstream = net.connect(targetPort, targetHost);

  client.pipe(upstream);
  upstream.pipe(client);

  client.on('error', () => upstream.destroy());
  upstream.on('error', (error) => {
    console.error(`upstream ${targetHost}:${targetPort} failed: ${error.message}`);
    client.destroy();
  });
  client.on('close', () => upstream.destroy());
  upstream.on('close', () => client.destroy());
});

server.on('error', (error) => {
  console.error(`listen 127.0.0.1:${listenPort} failed: ${error.message}`);
  process.exit(1);
});

server.listen(listenPort, '127.0.0.1', () => {
  console.log(`proxy 127.0.0.1:${listenPort} -> ${targetHost}:${targetPort}`);
});
