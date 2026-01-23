const { spawn } = require('child_process');
const path = require('path');
const { chromium } = require('playwright');

const projectDir = path.resolve(__dirname);

async function startServer() {
  console.log('starting vite dev server');
  const server = spawn('cmd.exe', ['/c', 'npm', 'run', 'dev', '--', '--host', '127.0.0.1', '--port', '4173'], {
    cwd: projectDir,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  server.stdout.on('data', (data) => {
    const text = data.toString();
    process.stdout.write('[vite stdout] ' + text);
  });
  server.stderr.on('data', (data) => {
    process.stderr.write('[vite stderr] ' + data.toString());
  });

  await new Promise((resolve) => {
    const timeout = setTimeout(() => {
      console.log('vite server start timeout');
      resolve();
    }, 5000);
    server.stdout.on('data', (data) => {
      const text = data.toString();
      if (text.includes('Local:')) {
        clearTimeout(timeout);
        console.log('vite server ready');
        resolve();
      }
    });
  });

  return server;
}

async function run() {
  const server = await startServer();
  console.log('launching browser');
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on('console', (msg) => {
    console.log('playwright console [' + msg.type() + '] ' + msg.text());
  });
  console.log('navigating to page');
  await page.goto('http://127.0.0.1:4173', { waitUntil: 'networkidle' });
  console.log('page loaded');
  await page.waitForTimeout(3000);
  await browser.close();
  console.log('browser closed');
  server.kill('SIGINT');
  console.log('server killed');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
