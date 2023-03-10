import { Client, VoiceState } from 'discord.js';

import Connection from '@/structures/connection';
import { Option } from '@/typings/common';
import { MAIN_CLIENT } from '@/util/worker';

export function register(client: Client) {
	client.on('voiceStateUpdate', async (oldState: Option<VoiceState>, newState: Option<VoiceState>) => {
		if (oldState?.channelId === newState?.channelId) return;

		// if there is only one person in the channel and it's the bot, pause the connection
		if (oldState && oldState.channel?.members.size === 1 && oldState.channel?.members.has(MAIN_CLIENT.user!.id)) {
			const connection = await Connection.getOrCreateFromVoice(oldState);
			if (!connection) return;

			return connection.pause(undefined, true);
		}

		// if there are 2 people in the channel and it's the bot and the other person, resume the connection
		if (newState && newState.channel?.members.size === 2 && newState.channel?.members.has(MAIN_CLIENT.user!.id)) {
			const connection = await Connection.getOrCreateFromVoice(newState);
			if (!connection || !connection.autopaused) return;

			return connection.resume();
		}
	});
}
