import { Client } from 'discord.js';

import Connection from '@/structures/connection';
import { MAIN_CLIENT } from '@/util/worker';

export function register(client: Client) {
	client.on('voiceStateUpdate', async (oldState, newState) => {
		if (oldState.channelId === newState.channelId || newState !== null || oldState === null) return;

		const connection = await Connection.getOrCreate(oldState);
		if (!connection) return;

		if (oldState.channel?.members.size === 1 && oldState.channel?.members.has(MAIN_CLIENT.user!.id)) {
			return connection.destroy();
		}
	});
}
