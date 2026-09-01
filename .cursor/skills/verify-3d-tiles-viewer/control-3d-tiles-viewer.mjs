#!/usr/bin/env node

/**
 * control-3d-tiles-viewer.mjs
 * 
 * CLI for driving and observing the 3D Tiles Viewer app in verification scenarios.
 * Wraps Playwright to provide composable, agent-friendly subcommands.
 */

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE = path.join(__dirname, '../../..');
const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';
const EVIDENCE_DIR = path.join(WORKSPACE, '.cursor/skills/verify-3d-tiles-viewer/evidence');

const COMMANDS = {
  doctor: 'Check if the app is healthy and ready',
  info: 'Get current app state as JSON',
  screenshot: 'Capture a screenshot',
  video: 'Record a video of interactions',
  'load-sample': 'Load the public sample tileset in authoring mode',
  'load-viewer-sample': 'Open viewer.html with the public sample',
  'switch-language': 'Toggle between English and Japanese',
  'switch-theme': 'Toggle between light and dark theme',
  'click-selector': 'Click an element by CSS selector',
  'wait-for': 'Wait for a selector to be visible',
  cleanup: 'Clean up running processes (dry-run by default)',
  help: 'Show this help message',
};

function showHelp() {
  console.log('Usage: control-3d-tiles-viewer.mjs <command> [options]\n');
  console.log('Commands:');
  for (const [cmd, desc] of Object.entries(COMMANDS)) {
    console.log(`  ${cmd.padEnd(20)} ${desc}`);
  }
  console.log('\nGlobal options:');
  console.log('  --help              Show help for a command');
  console.log('  --json              Output as JSON (where applicable)');
  console.log('  --dry-run           Preview without executing (cleanup)');
  console.log('\nExamples:');
  console.log('  control-3d-tiles-viewer.mjs doctor');
  console.log('  control-3d-tiles-viewer.mjs screenshot --output evidence/screenshot.png');
  console.log('  control-3d-tiles-viewer.mjs load-sample');
  console.log('  control-3d-tiles-viewer.mjs cleanup --dry-run');
}

function parseArgs(argv) {
  const args = { command: null, flags: {}, positional: [] };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const [key, val] = arg.slice(2).split('=');
      args.flags[key] = val !== undefined ? val : (argv[i + 1]?.startsWith('--') ? true : argv[++i] || true);
    } else if (!args.command) {
      args.command = arg;
    } else {
      args.positional.push(arg);
    }
  }
  return args;
}

async function ensureEvidenceDir() {
  await fs.mkdir(EVIDENCE_DIR, { recursive: true });
}

async function doctor(flags) {
  const checks = {
    vite: { port: 5173, name: 'Vite dev server', url: `${BASE_URL}/` },
    api: { port: 3001, name: 'Express API', url: 'http://localhost:3001/' },
  };

  const results = {};
  for (const [key, { name, url }] of Object.entries(checks)) {
    try {
      const response = await fetch(url, { method: 'HEAD' });
      results[key] = {
        status: 'ok',
        name,
        url,
        httpStatus: response.status,
        ok: response.status < 500,
      };
    } catch (err) {
      results[key] = {
        status: 'error',
        name,
        url,
        error: err.message,
      };
    }
  }

  const allOk = Object.values(results).every(r => r.status === 'ok' && r.ok);

  if (flags.json) {
    console.log(JSON.stringify({ healthy: allOk, checks: results }, null, 2));
  } else {
    console.log('Health Check:');
    for (const [key, result] of Object.entries(results)) {
      const icon = result.status === 'ok' && result.ok ? '✓' : '✗';
      console.log(`  ${icon} ${result.name}: ${result.status === 'ok' ? `HTTP ${result.httpStatus}` : result.error}`);
    }
    console.log(`\nOverall: ${allOk ? 'HEALTHY' : 'UNHEALTHY'}`);
  }

  return allOk ? 0 : 1;
}

async function info(flags) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('#appHeader', { timeout: 10000 });

    const state = await page.evaluate(() => {
      return {
        url: window.location.href,
        title: document.title,
        headerVisible: !!document.querySelector('#appHeader'),
        leftPanelVisible: !!document.querySelector('#leftPanel'),
        cesiumContainerVisible: !!document.querySelector('#cesiumContainer'),
        buildingCount: document.querySelectorAll('.bldg-row').length,
        language: localStorage.getItem('language') || 'en',
        theme: localStorage.getItem('theme') || 'dark',
      };
    });

    if (flags.json) {
      console.log(JSON.stringify(state, null, 2));
    } else {
      console.log('App State:');
      for (const [key, val] of Object.entries(state)) {
        console.log(`  ${key}: ${JSON.stringify(val)}`);
      }
    }
    return 0;
  } catch (err) {
    if (flags.json) {
      console.log(JSON.stringify({ error: err.message }, null, 2));
    } else {
      console.error(`Error: ${err.message}`);
    }
    return 1;
  } finally {
    await browser.close();
  }
}

async function screenshot(flags) {
  await ensureEvidenceDir();
  const outputPath = flags.output || path.join(EVIDENCE_DIR, `screenshot-${Date.now()}.png`);
  const selector = flags.selector || 'body';
  const fullPage = flags['full-page'] === true || flags['full-page'] === 'true';

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();

  try {
    const url = flags.url || BASE_URL;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector(selector, { timeout: 10000 });

    if (flags['wait-ms']) {
      await page.waitForTimeout(parseInt(flags['wait-ms'], 10));
    }

    const screenshotOpts = { path: outputPath, fullPage };
    if (selector !== 'body') {
      const element = await page.locator(selector).first();
      await element.screenshot({ path: outputPath });
    } else {
      await page.screenshot(screenshotOpts);
    }

    if (flags.json) {
      console.log(JSON.stringify({ path: outputPath }, null, 2));
    } else {
      console.log(`Screenshot saved: ${outputPath}`);
    }
    return 0;
  } catch (err) {
    if (flags.json) {
      console.log(JSON.stringify({ error: err.message }, null, 2));
    } else {
      console.error(`Error: ${err.message}`);
    }
    return 1;
  } finally {
    await browser.close();
  }
}

async function video(flags) {
  await ensureEvidenceDir();
  const outputPath = flags.output || path.join(EVIDENCE_DIR, `video-${Date.now()}.webm`);
  const durationMs = parseInt(flags.duration || '10000', 10);

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    recordVideo: { dir: EVIDENCE_DIR, size: { width: 1920, height: 1080 } },
  });
  const page = await context.newPage();

  try {
    const url = flags.url || BASE_URL;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('#appHeader', { timeout: 10000 });

    await page.waitForTimeout(durationMs);

    await page.close();
    await context.close();
    await browser.close();

    const videos = await fs.readdir(EVIDENCE_DIR);
    const latestVideo = videos
      .filter(f => f.endsWith('.webm'))
      .map(f => ({ name: f, path: path.join(EVIDENCE_DIR, f) }))
      .sort((a, b) => {
        const statA = existsSync(a.path) ? require('fs').statSync(a.path) : { mtimeMs: 0 };
        const statB = existsSync(b.path) ? require('fs').statSync(b.path) : { mtimeMs: 0 };
        return statB.mtimeMs - statA.mtimeMs;
      })[0];

    if (latestVideo && outputPath !== latestVideo.path) {
      await fs.rename(latestVideo.path, outputPath);
    }

    if (flags.json) {
      console.log(JSON.stringify({ path: outputPath }, null, 2));
    } else {
      console.log(`Video saved: ${outputPath}`);
    }
    return 0;
  } catch (err) {
    await browser.close();
    if (flags.json) {
      console.log(JSON.stringify({ error: err.message }, null, 2));
    } else {
      console.error(`Error: ${err.message}`);
    }
    return 1;
  }
}

async function loadSample(flags) {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();

  try {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('#appHeader', { timeout: 10000 });

    await page.locator('#addDataBtn').click();
    await page.waitForSelector('#leftAddDataMenu', { state: 'visible', timeout: 5000 });
    await page.locator('#leftAddDataMenu [data-action="add-url"]').click();

    await page.waitForSelector('#urlLoadPopover', { state: 'visible', timeout: 5000 });
    await page.locator('#urlInput').fill('/tiles/sample-indoor/tileset.json');
    await page.locator('#loadUrlBtn').click();

    await page.waitForSelector('.bldg-row .bldg-name', { timeout: 45000 });

    await page.waitForFunction(() => {
      const hook = window.__CESIUM_E2E__;
      return !!hook && ((hook.tileLoadCount ?? 0) > 0 || (hook.allTilesLoadedCount ?? 0) > 0);
    }, null, { timeout: 60000 });

    if (flags.json) {
      console.log(JSON.stringify({ status: 'loaded', tileset: '/tiles/sample-indoor/tileset.json' }, null, 2));
    } else {
      console.log('Sample tileset loaded successfully');
    }

    if (!flags['keep-open']) {
      await browser.close();
    }

    return 0;
  } catch (err) {
    await browser.close();
    if (flags.json) {
      console.log(JSON.stringify({ error: err.message }, null, 2));
    } else {
      console.error(`Error: ${err.message}`);
    }
    return 1;
  }
}

async function loadViewerSample(flags) {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();

  try {
    await page.goto(`${BASE_URL}/viewer.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('#appHeader', { timeout: 10000 });
    await page.waitForSelector('#viewerBuildingSelect option:nth-child(2)', { timeout: 45000 });

    if (flags.json) {
      console.log(JSON.stringify({ status: 'loaded', page: 'viewer.html' }, null, 2));
    } else {
      console.log('Viewer page loaded with sample tileset');
    }

    if (!flags['keep-open']) {
      await browser.close();
    }

    return 0;
  } catch (err) {
    await browser.close();
    if (flags.json) {
      console.log(JSON.stringify({ error: err.message }, null, 2));
    } else {
      console.error(`Error: ${err.message}`);
    }
    return 1;
  }
}

async function switchLanguage(flags) {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();

  try {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('#languageToggle', { timeout: 10000 });

    const beforeLang = await page.evaluate(() => localStorage.getItem('language') || 'en');
    await page.locator('#languageToggle').click();
    await page.waitForTimeout(500);
    const afterLang = await page.evaluate(() => localStorage.getItem('language') || 'en');

    if (flags.json) {
      console.log(JSON.stringify({ before: beforeLang, after: afterLang }, null, 2));
    } else {
      console.log(`Language switched: ${beforeLang} → ${afterLang}`);
    }

    if (!flags['keep-open']) {
      await browser.close();
    }

    return 0;
  } catch (err) {
    await browser.close();
    if (flags.json) {
      console.log(JSON.stringify({ error: err.message }, null, 2));
    } else {
      console.error(`Error: ${err.message}`);
    }
    return 1;
  }
}

async function switchTheme(flags) {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();

  try {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('#themeToggle', { timeout: 10000 });

    const beforeTheme = await page.evaluate(() => localStorage.getItem('theme') || 'dark');
    await page.locator('#themeToggle').click();
    await page.waitForTimeout(500);
    const afterTheme = await page.evaluate(() => localStorage.getItem('theme') || 'dark');

    if (flags.json) {
      console.log(JSON.stringify({ before: beforeTheme, after: afterTheme }, null, 2));
    } else {
      console.log(`Theme switched: ${beforeTheme} → ${afterTheme}`);
    }

    if (!flags['keep-open']) {
      await browser.close();
    }

    return 0;
  } catch (err) {
    await browser.close();
    if (flags.json) {
      console.log(JSON.stringify({ error: err.message }, null, 2));
    } else {
      console.error(`Error: ${err.message}`);
    }
    return 1;
  }
}

async function clickSelector(flags) {
  if (!flags.selector) {
    console.error('Error: --selector is required');
    return 1;
  }

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();

  try {
    const url = flags.url || BASE_URL;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector(flags.selector, { timeout: 10000 });
    await page.locator(flags.selector).first().click();

    if (flags['wait-ms']) {
      await page.waitForTimeout(parseInt(flags['wait-ms'], 10));
    }

    if (flags.json) {
      console.log(JSON.stringify({ clicked: flags.selector }, null, 2));
    } else {
      console.log(`Clicked: ${flags.selector}`);
    }

    if (!flags['keep-open']) {
      await browser.close();
    }

    return 0;
  } catch (err) {
    await browser.close();
    if (flags.json) {
      console.log(JSON.stringify({ error: err.message }, null, 2));
    } else {
      console.error(`Error: ${err.message}`);
    }
    return 1;
  }
}

async function waitFor(flags) {
  if (!flags.selector) {
    console.error('Error: --selector is required');
    return 1;
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    const url = flags.url || BASE_URL;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector(flags.selector, { timeout: parseInt(flags.timeout || '10000', 10) });

    if (flags.json) {
      console.log(JSON.stringify({ visible: flags.selector }, null, 2));
    } else {
      console.log(`Selector visible: ${flags.selector}`);
    }
    return 0;
  } catch (err) {
    if (flags.json) {
      console.log(JSON.stringify({ error: err.message }, null, 2));
    } else {
      console.error(`Error: ${err.message}`);
    }
    return 1;
  } finally {
    await browser.close();
  }
}

async function cleanup(flags) {
  const dryRun = flags['dry-run'] === true || flags['dry-run'] === 'true';

  try {
    const { execSync } = await import('node:child_process');
    const psOutput = execSync('ps aux', { encoding: 'utf8' });
    const lines = psOutput.split('\n');
    const targets = lines.filter(line =>
      (line.includes('node') && line.includes('server/dev.js')) ||
      (line.includes('node') && line.includes('server/index.js')) ||
      (line.includes('vite') && !line.includes('grep'))
    );

    if (targets.length === 0) {
      if (flags.json) {
        console.log(JSON.stringify({ found: 0, killed: 0 }, null, 2));
      } else {
        console.log('No dev processes found');
      }
      return 0;
    }

    const pids = targets.map(line => {
      const parts = line.trim().split(/\s+/);
      return parts[1];
    }).filter(Boolean);

    if (dryRun) {
      if (flags.json) {
        console.log(JSON.stringify({ dryRun: true, found: pids.length, pids }, null, 2));
      } else {
        console.log(`[DRY RUN] Would kill ${pids.length} process(es): ${pids.join(', ')}`);
      }
      return 0;
    }

    for (const pid of pids) {
      try {
        execSync(`kill ${pid}`, { encoding: 'utf8' });
      } catch (err) {
        // Process might already be gone
      }
    }

    if (flags.json) {
      console.log(JSON.stringify({ found: pids.length, killed: pids.length }, null, 2));
    } else {
      console.log(`Killed ${pids.length} process(es)`);
    }
    return 0;
  } catch (err) {
    if (flags.json) {
      console.log(JSON.stringify({ error: err.message }, null, 2));
    } else {
      console.error(`Error: ${err.message}`);
    }
    return 1;
  }
}

async function main() {
  const args = parseArgs(process.argv);

  if (args.flags.help || args.command === 'help' || !args.command) {
    showHelp();
    return 0;
  }

  const command = args.command;
  const flags = args.flags;

  switch (command) {
    case 'doctor':
      return await doctor(flags);
    case 'info':
      return await info(flags);
    case 'screenshot':
      return await screenshot(flags);
    case 'video':
      return await video(flags);
    case 'load-sample':
      return await loadSample(flags);
    case 'load-viewer-sample':
      return await loadViewerSample(flags);
    case 'switch-language':
      return await switchLanguage(flags);
    case 'switch-theme':
      return await switchTheme(flags);
    case 'click-selector':
      return await clickSelector(flags);
    case 'wait-for':
      return await waitFor(flags);
    case 'cleanup':
      return await cleanup(flags);
    default:
      console.error(`Unknown command: ${command}`);
      showHelp();
      return 1;
  }
}

main().then(code => process.exit(code)).catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
