import {
	AutocompleteInteraction,
	CommandInteraction,
	escapeMarkdown,
	Interaction,
	MessageCreateOptions,
	MessagePayload,
	TextBasedChannel,
} from 'discord.js';
import fast from 'fast-sort';
import { levenshtein } from 'string-comparison';

import Connection from '@/structures/connection';

import { prisma } from './database';
import { spotify } from './search';

export async function sendMessageAndDelete(
	channel: TextBasedChannel,
	options: string | MessagePayload | MessageCreateOptions,
	timeout = 3_000
) {
	const message = await channel.send(options);

	return setTimeout(() => {
		message.delete().catch(() => { });
	}, timeout);
}

export function enforceLength(text: string, maxLength: number) {
	return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1)}…`;
}

export async function handleChartAutocomplete(interaction: AutocompleteInteraction) {
	const focused = interaction.options.getFocused(true);
	if (focused.name !== 'name') return;

	const charts = await spotify.getCharts();
	if (!charts.ok) return;

	const name = interaction.options.getString('name', true).toLowerCase();

	fast.inPlaceSort(charts.value)
		.asc(c => levenshtein.distance(c.name.toLowerCase(), name));

	return void interaction.respond(
		charts.value
			.slice(0, 10)
			.map(c => ({ name: c.name, value: c.id }))
	);
}

export async function handleQueueAutocomplete(interaction: AutocompleteInteraction) {
	const focused = interaction.options.getFocused(true);
	if (focused.name !== 'page') return;

	const pageString = interaction.options.getString('page', true);
	let page = parseInt(pageString);
	if (isNaN(page)) page = 1;
	else if (page < 1) page = 1;

	const tracks = await prisma.queue.findMany({
		where: {
			guildId: interaction.guildId!,
		},
		take: 25,
		skip: (page - 1) * 25,
		include: {
			track: {
				include: {
					artist: true,
				},
			},
		},
	});

	const start = (page - 1) * 25 + 1;

	return void interaction.respond(
		tracks.length > 0 ? tracks.map((t, i) => ({
			name: `${start + i}. ${t.track.title} by ${t.track.artist.name}`,
			value: pageString,
		})) : [
			{
				name: 'No songs found.',
				value: '1',
			},
		]
	);
}

export async function handleQueueCommand(interaction: CommandInteraction) {
	let page = interaction.options.get('page', false)?.value as string | number | undefined;

	if (page === undefined) {
		const connection = await Connection.getOrCreate(interaction as Interaction);
		if (!connection) page = 1;
		else page = Math.floor(connection.queue.index / 25) + 1;
	}

	if (typeof page === 'string') {
		page = parseInt(page);
		if (isNaN(page)) page = 1;
	}

	const tracks = await prisma.queue.findMany({
		where: {
			guildId: interaction.guildId!,
		},
		take: 25,
		skip: (page - 1) * 25,
		include: {
			track: {
				include: {
					artist: true,
				},
			},
		},
	});

	return void interaction.reply({
		content: `Queue for **${escapeMarkdown(interaction.guild!.name)}** (Page ${page})`,
		embeds: [
			{
				description: tracks.length > 0 ? tracks.map((t, i) => `\`${(page as number - 1) * 25 + i + 1}.\` **${escapeMarkdown(t.track.title)}** by ${escapeMarkdown(t.track.artist.name)}`).join('\n') : 'No songs found.',
			},
		],
	});
}
