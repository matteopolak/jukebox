import { Client } from 'discord.js';

import Connection from '@/structures/connection';

export function register(client: Client) {
	client.on('voiceStateUpdate', async (oldState, newState) => {
		if (oldState.channelId === newState.channelId || newState !== null || oldState === null) return;

		const connection = await Connection.getOrCreate(oldState);
		if (!connection) return;

		if (oldState.channel?.members.size === 0) {
			return connection.destroy();
		}
	});
}
