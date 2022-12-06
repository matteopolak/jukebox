import {
	AutocompleteInteraction,
	MessageCreateOptions,
	MessagePayload,
	TextBasedChannel,
} from 'discord.js';
import similar from 'string-similarity';

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
	const charts = await spotify.getCharts();
	if (!charts.ok) return;

	const nameToChart = new Map(charts.value.map(c => [c.name.toLowerCase(), c]));

	const closest = similar.findBestMatch(interaction.options.getString('chart', true).toLocaleLowerCase(), [...nameToChart.keys()]);
	const best = closest.ratings.slice(0, 25).map(r => nameToChart.get(r.target)!);

	return void interaction.respond(best.map(c => ({ name: c.name, value: c.id })));
}
