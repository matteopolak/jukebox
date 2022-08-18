import { CommandInteraction } from 'discord.js';
import { Connection } from '../typings';
import { managers } from './database';
import { DEFAULT_COMPONENTS } from '../constants';

export const connections: Map<string, Connection> = new Map();
export const channelToConnection: Map<string, Connection> = new Map();

export async function createAudioManager(interaction: CommandInteraction) {
	const message = await interaction.channel!.send({
		embeds: [
			{
				title: 'No music playing',
				image: {
					url: 'https://i.ytimg.com/vi/mfycQJrzXCA/hqdefault.jpg',
				},
			},
		],
		components: DEFAULT_COMPONENTS,
	});

	const queue = await interaction.channel!.send({
		content: '\u200b',
	});

	// Delete managers that are in the same channel
	await managers.remove(
		{
			guildId: interaction.guildId!,
			channelId: interaction.channelId,
		},
		{
			multi: true,
		}
	);

	// Create the new manager
	await managers.insert({
		messageId: message.id,
		queueId: queue.id,
		channelId: interaction.channelId,
		guildId: interaction.guildId!,
	});
}
