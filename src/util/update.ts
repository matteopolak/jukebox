import 'dotenv/config';

import { exec } from 'node:child_process';

import ytdl from 'ytdl-core';

const COMMANDS: Record<string, string> = {
	npm: 'npm install ytdl-core@latest',
	pnpm: 'pnpm add ytdl-core@latest',
	yarn: 'yarn add ytdl-core@latest',
};

const INSTALL_COMMAND = COMMANDS[process.env.NODE_PACKAGE_MANAGER!] ?? 'npm install ytdl-core@latest';
const YTDL_API_ENDPOINT = 'https://registry.npmjs.org/ytdl-core/latest';

export let version = ytdl.version as unknown as string;

export async function checkForUpdate() {
	const response = await fetch(YTDL_API_ENDPOINT);
	const data = await response.json();
	const latestVersion = data.version;

	if (latestVersion !== version) {
		version = latestVersion;

		await new Promise(r => {
			exec(INSTALL_COMMAND, r);
		});

		console.log(`Updated ytdl-core to ${latestVersion}`);

		// exit the process. pm2 will restart it
		process.exit(0);
	}
}
