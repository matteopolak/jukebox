import { CommandInteraction, NewsChannel, TextChannel } from 'discord.js';
import { managers } from './database';
import { BAD_TITLE_CHARACTER_REGEX, DEFAULT_COMPONENTS } from '../constants';
import { Effect } from '../typings';
import { getChannel, queueClient } from './worker';

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

	const queue = await getChannel(
		queueClient,
		interaction.guildId!,
		interaction.channelId
	).send({
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
		settings: {
			effect: Effect.None,
			repeat: false,
			autoplay: false,
			seek: 0,
			shuffle: false,
			lyrics: false,
		},
	});
}

export function cleanTitle(title: string) {
	return title.replace(BAD_TITLE_CHARACTER_REGEX, '');
}
