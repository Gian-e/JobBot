import { spawn, execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isWin = process.platform === 'win32';
const npmCmd = isWin ? 'npm.cmd' : 'npm';

const backendDir = path.join(__dirname, 'backend');
const frontendDir = path.join(__dirname, 'frontend');

function ensureDependencies(dir, label) {
  if (!fs.existsSync(path.join(dir, 'node_modules'))) {
    console.log(`\x1b[33m[SETUP]\x1b[0m Instalando dependências de ${label}...`);
    execSync(`${npmCmd} install`, { cwd: dir, stdio: 'inherit' });
  }
}

ensureDependencies(backendDir, 'backend');
ensureDependencies(frontendDir, 'frontend');

console.log('\x1b[36m========================================================\x1b[0m');
console.log('\x1b[36m🚀 Iniciando JobBot (Backend :3000 + Frontend :5173)...\x1b[0m');
console.log('\x1b[36m========================================================\x1b[0m');

const children = [];

function spawnService(name, colorCode, cwd, args) {
  const child = spawn(npmCmd, args, {
    cwd,
    shell: isWin,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, FORCE_COLOR: '1' }
  });

  const prefix = `\x1b[${colorCode}m[${name}]\x1b[0m `;

  child.stdout.on('data', (data) => {
    const lines = data.toString().split(/\r?\n/);
    for (const line of lines) {
      if (line.trim()) process.stdout.write(`${prefix}${line}\n`);
    }
  });

  child.stderr.on('data', (data) => {
    const lines = data.toString().split(/\r?\n/);
    for (const line of lines) {
      if (line.trim()) process.stderr.write(`${prefix}${line}\n`);
    }
  });

  child.on('exit', (code) => {
    if (code !== null && code !== 0) {
      console.log(`${prefix}Encerrado com código ${code}`);
    }
  });

  children.push(child);
  return child;
}

spawnService('BACK ', '35', backendDir, ['run', 'dev']);
spawnService('FRONT', '36', frontendDir, ['run', 'dev']);

function cleanup() {
  console.log('\n\x1b[33m[JobBot] Encerrando processos...\x1b[0m');
  for (const child of children) {
    if (!child.killed) {
      if (isWin) {
        spawn('taskkill', ['/pid', String(child.pid), '/f', '/t'], { stdio: 'ignore' });
      } else {
        child.kill('SIGTERM');
      }
    }
  }
  setTimeout(() => process.exit(0), 300);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
