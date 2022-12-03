import { APIActionRowComponent, APIMessageActionRowComponent, CommandInteraction } from 'discord.js';
import { Database } from '@/util/database';
import { BAD_TITLE_CHARACTER_REGEX, DEFAULT_COMPONENTS } from '@/constants';
import { Effect } from '@/typings/common';
import { getChannel, QUEUE_CLIENT } from '@/util/worker';

export async function createAudioManager(interaction: CommandInteraction) {
	const message = await interaction.channel!.send({
		content: '',
		files: [
			{
				attachment: 'https://i.ytimg.com/vi/mfycQJrzXCA/hqdefault.jpg',
				name: 'thumbnail.jpg',
			},
		],
		components: DEFAULT_COMPONENTS as unknown as APIActionRowComponent<APIMessageActionRowComponent>[],
	});

	const queue = await getChannel(
		QUEUE_CLIENT,
		interaction.guildId!,
		interaction.channelId
	).send({
		content: '\u200b',
	});

	await Database.manager.updateOne(
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
