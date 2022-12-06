import {
	AutocompleteInteraction,
	MessageCreateOptions,
	MessagePayload,
	TextBasedChannel,
} from 'discord.js';
import { inPlaceSort } from 'fast-sort';
import { levenshtein } from 'string-comparison';

import { spotify } from './search';

export async function sendMessageAndDelete(
	channel: TextBasedChannel,
	options: string | MessagePayload | MessageCreateOptions,
	timeout = 3_000
) {
	const message = await channel.send(options);

	return setTimeout(() => {
		message.delete().catch(() => {});
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

	inPlaceSort(charts.value)
		.asc(c => levenshtein.distance(c.name.toLowerCase(), name));

	return void interaction.respond(
		charts.value
			.slice(0, 10)
			.map(c => ({ name: c.name, value: c.id }))
	);
}
