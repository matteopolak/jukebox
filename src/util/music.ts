import { CommandInteraction } from 'discord.js';
import { Database } from './database';
import { BAD_TITLE_CHARACTER_REGEX, DEFAULT_COMPONENTS } from '../constants';
import { Effect } from '../typings/common.js';
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

	await Database.managers.updateOne(
		{
			guildId: interaction.guildId!,
			channelId: interaction.channelId,
		},
		{
			$set: {
				messageId: message.id,
				queueId: queue.id,
			},
			$setOnInsert: {
				settings: {
					effect: Effect.None,
					repeat: false,
					autoplay: false,
					seek: 0,
					shuffle: false,
					lyrics: false,
				},
				index: 0,
			},
		},
		{ upsert: true }
	);
}

export function cleanTitle(title: string) {
	return title.replace(BAD_TITLE_CHARACTER_REGEX, '');
}
