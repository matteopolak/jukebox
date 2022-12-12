import { APIActionRowComponent, APIMessageActionRowComponent, CommandInteraction } from 'discord.js';

import { BAD_TITLE_CHARACTER_REGEX, DEFAULT_COMPONENTS } from '@/constants';
import { Effect } from '@/typings/common';
import { prisma } from '@/util/database';
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

	await prisma.manager.upsert(
		{
			where: {
				guildId_channelId: {
					guildId: interaction.guildId!,
					channelId: interaction.channelId,
				},
			},
			create: {
				guildId: interaction.guildId!,
				channelId: interaction.channelId,
				messageId: message.id,
				queueId: queue.id,
				settings: {
					effect: Effect.None,
					repeat: false,
					repeatOne: false,
					autoplay: false,
					seek: 0,
					shuffle: false,
					lyrics: false,
				},
				index: 0,
			},
			update: {
				messageId: message.id,
				queueId: queue.id,
			},
		}
	);
}

export function cleanTitle(title: string) {
	return title.replace(BAD_TITLE_CHARACTER_REGEX, '');
}
